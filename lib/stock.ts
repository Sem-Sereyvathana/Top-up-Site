import { prisma } from "./prisma";

// Product stock: `stock` is nullable on Product. `null` means "unlimited /
// not tracked" and is skipped entirely. A number means "this many left" —
// it only ever goes down when an order is actually paid, and is given back
// if that paid order later fails / gets cancelled / gets refunded.
//
// Idempotent via the `stockDecremented` flag on Order, so it's safe to call
// from the payment webhook, the local payment simulator, and the admin
// manual-status-update route without double-counting.

// Called once an order transitions into PAID.
export async function decrementStockForOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.stockDecremented) return;

  const product = await prisma.product.findUnique({ where: { id: order.productId } });
  if (!product || product.stock === null) {
    // Unlimited stock — still mark as processed so we never re-check it.
    await prisma.order.update({ where: { id: order.id }, data: { stockDecremented: true } });
    return;
  }

  await prisma.$transaction([
    prisma.product.update({
      where: { id: product.id },
      data: { stock: { decrement: 1 } },
    }),
    prisma.order.update({
      where: { id: order.id },
      data: { stockDecremented: true },
    }),
  ]);
}

// Called when a previously-paid order ends up FAILED / CANCELLED / REFUNDED
// — gives the unit back to stock. Idempotent via the same flag.
export async function restoreStockForOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || !order.stockDecremented) return;

  const product = await prisma.product.findUnique({ where: { id: order.productId } });

  await prisma.$transaction([
    ...(product && product.stock !== null
      ? [
          prisma.product.update({
            where: { id: product.id },
            data: { stock: { increment: 1 } },
          }),
        ]
      : []),
    prisma.order.update({
      where: { id: order.id },
      data: { stockDecremented: false },
    }),
  ]);
}
