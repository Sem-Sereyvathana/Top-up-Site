import { prisma } from "./prisma";
import { isRobuxGame } from "./utils";

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
export async function decrementStockForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, game: true },
  });
  if (!order || order.stockDecremented) return;

  const robuxGame = isRobuxGame(order.game);

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
            data: { stock: { decrement: i.quantity } },
          })
        ),
      ...(robuxAmount > 0
        ? [
            prisma.robuxStock.upsert({
              where: { id: 1 },
              update: { totalRobux: { decrement: robuxAmount } },
              create: { id: 1, totalRobux: -robuxAmount },
            }),
          ]
        : []),
      prisma.order.update({ where: { id: order.id }, data: { stockDecremented: true } }),
    ]);
    return;
  }

  const product = await prisma.product.findUnique({ where: { id: order.productId } });
  const robuxAmount = robuxGame && product ? Math.max(0, product.amount) : 0;

  if (!product || (product.stock === null && robuxAmount === 0)) {
    // Unlimited stock and nothing to draw from the Robux pool — still mark
    // as processed so we never re-check it.
    await prisma.order.update({ where: { id: order.id }, data: { stockDecremented: true } });
    return;
  }

  await prisma.$transaction([
    ...(product.stock !== null
      ? [
          prisma.product.update({
            where: { id: product.id },
            data: { stock: { decrement: 1 } },
          }),
        ]
      : []),
    ...(robuxAmount > 0
      ? [
          prisma.robuxStock.upsert({
            where: { id: 1 },
            update: { totalRobux: { decrement: robuxAmount } },
            create: { id: 1, totalRobux: -robuxAmount },
          }),
        ]
      : []),
    prisma.order.update({
      where: { id: order.id },
      data: { stockDecremented: true },
    }),
  ]);
}

// Called when a previously-paid order ends up FAILED / CANCELLED / REFUNDED
// — gives the unit(s) back to stock. Idempotent via the same flag.
export async function restoreStockForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, game: true },
  });
  if (!order || !order.stockDecremented) return;

  const robuxGame = isRobuxGame(order.game);

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
