import { prisma } from "./prisma";
import { usesRobuxStock } from "./utils";

// Product stock: `stock` is nullable on Product. `null` means "unlimited /
// not tracked" and is skipped entirely. A number means "this many left" —
// it only ever goes down when an order is actually paid, and is given back
// if that paid order later fails / gets cancelled / gets refunded.
//
// Idempotent via the `stockDecremented` flag on Order, so it's safe to call
// from the payment webhook, the local payment simulator, and the admin
// manual-status-update route without double-counting.
//
// Multi-package cart orders (currently only possible for Roblox — see
// TopUpForm's cart mode) attach one or more `OrderItem` rows, each with its
// own quantity. Regular single-package orders never have items, so they fall
// straight through to the original single-product logic below unchanged.
//
// Roblox/Robux games additionally draw from the single admin-managed
// `RobuxStock.totalRobux` pool (see the admin "Robux Stock" page) instead of
// (or on top of) any per-product `stock` count, so every order for a Robux
// game also needs that pool adjusted here.

// Sum of Robux actually being delivered by this order (0 for non-Robux
// orders or line items with no positive `amount`).
function robuxAmountForOrder(
  order: { productId: string; items: { productId: string; amount: number; quantity: number }[] },
  productsById: Map<string, { id: string; amount: number }>
): number {
  if (order.items.length > 0) {
    return order.items.reduce((sum, i) => sum + Math.max(0, i.amount) * i.quantity, 0);
  }
  const p = productsById.get(order.productId);
  return p ? Math.max(0, p.amount) : 0;
}

// Called once an order transitions into PAID.
//
// Returns null on success, or a short human-readable reason when this order
// PAID but the stock it needed was already gone (two checkouts for the last
// unit, both paid). The caller (payment webhook) must NOT silently ignore
// that: the customer's money was taken, so the order stays PAID for manual
// handling and an alert is raised. Stock itself can never go negative.
export async function decrementStockForOrder(orderId: string): Promise<string | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, game: true },
  });
  if (!order) return null;

  // RACE-SAFE claim: flip stockDecremented false -> true atomically BEFORE
  // touching any stock. Only the caller whose updateMany matches 1 row may
  // decrement — concurrent callers (webhook + recovery job + admin route)
  // match 0 rows and return, so stock can never be double-decremented.
  const claimed = await prisma.order.updateMany({
    where: { id: orderId, stockDecremented: false },
    data: { stockDecremented: true },
  });
  if (claimed.count === 0) return null;

  const robuxGame = usesRobuxStock(order.game);
  // Stock problems hit during the guarded decrements below; each is a
  // conditional updateMany so two orders can never drive a counter below 0.
  let problem: string | null = null;

  if (order.items.length > 0) {
    const productIds = order.items.map((i) => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const robuxAmount = robuxGame ? robuxAmountForOrder(order, byId) : 0;

    // Per-product: `stock: { gte: qty }` in the WHERE makes the check and the
    // decrement one atomic statement. count === 0 means someone else took the
    // last unit between our earlier check and now.
    for (const i of order.items) {
      const p = byId.get(i.productId);
      if (!p || p.stock === null || p.stock === undefined) continue;

      const res = await prisma.product.updateMany({
        where: { id: i.productId, stock: { gte: i.quantity } },
        data: { stock: { decrement: i.quantity } },
      });
      if (res.count !== 1) {
        problem = problem ?? `"${p.name}" is out of stock`;
      }
    }

    if (robuxAmount > 0) {
      const res = await prisma.robuxStock.updateMany({
        where: { id: 1, totalRobux: { gte: robuxAmount } },
        data: { totalRobux: { decrement: robuxAmount } },
      });
      if (res.count !== 1) {
        problem = problem ?? `Robux stock is short by ${robuxAmount}`;
      }
    }

    return problem;
  }

  const product = await prisma.product.findUnique({ where: { id: order.productId } });
  const robuxAmount = robuxGame && product ? Math.max(0, product.amount) : 0;

  if (!product) return null;

  if (product.stock !== null) {
    const res = await prisma.product.updateMany({
      where: { id: product.id, stock: { gte: 1 } },
      data: { stock: { decrement: 1 } },
    });
    if (res.count !== 1) problem = `"${product.name}" is out of stock`;
  }

  if (robuxAmount > 0) {
    const res = await prisma.robuxStock.updateMany({
      where: { id: 1, totalRobux: { gte: robuxAmount } },
      data: { totalRobux: { decrement: robuxAmount } },
    });
    if (res.count !== 1) problem = problem ?? `Robux stock is short by ${robuxAmount}`;
  }

  return problem;
}

// Called when a previously-paid order ends up FAILED / CANCELLED / REFUNDED
// — gives the unit(s) back to stock. Idempotent via the same flag, claimed
// atomically (true -> false) so concurrent callers can't restore twice.
export async function restoreStockForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, game: true },
  });
  if (!order) return;

  // RACE-SAFE claim: only the caller that flips stockDecremented true ->
  // false gets to give the stock back.
  const claimed = await prisma.order.updateMany({
    where: { id: orderId, stockDecremented: true },
    data: { stockDecremented: false },
  });
  if (claimed.count === 0) return;

  const robuxGame = usesRobuxStock(order.game);

  if (order.items.length > 0) {
    const productIds = order.items.map((i) => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const robuxAmount = robuxGame ? robuxAmountForOrder(order, byId) : 0;

    await prisma.$transaction([
      ...order.items
        .filter((i) => {
          const p = byId.get(i.productId);
          return p && p.stock !== null && p.stock !== undefined;
        })
        .map((i) =>
          prisma.product.update({
            where: { id: i.productId },
            data: { stock: { increment: i.quantity } },
          })
        ),
      ...(robuxAmount > 0
        ? [
            prisma.robuxStock.upsert({
              where: { id: 1 },
              update: { totalRobux: { increment: robuxAmount } },
              create: { id: 1, totalRobux: robuxAmount },
            }),
          ]
        : []),
      prisma.order.update({ where: { id: order.id }, data: { stockDecremented: false } }),
    ]);
    return;
  }

  const product = await prisma.product.findUnique({ where: { id: order.productId } });
  const robuxAmount = robuxGame && product ? Math.max(0, product.amount) : 0;

  await prisma.$transaction([
    ...(product && product.stock !== null
      ? [
          prisma.product.update({
            where: { id: product.id },
            data: { stock: { increment: 1 } },
          }),
        ]
      : []),
    ...(robuxAmount > 0
      ? [
          prisma.robuxStock.upsert({
            where: { id: 1 },
            update: { totalRobux: { increment: robuxAmount } },
            create: { id: 1, totalRobux: robuxAmount },
          }),
        ]
      : []),
    prisma.order.update({
      where: { id: order.id },
      data: { stockDecremented: false },
    }),
  ]);
}
