import { prisma } from "./prisma";

// Loyalty points: earned when an order is actually paid, redeemable at
// checkout for a discount on a later order. All balance changes go through
// PointsLedger so the running total is always reconstructable/auditable.

export async function getPointsSettings() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  return {
    pointsPerUsd: settings?.pointsPerUsd ?? 1,
    pointsRedeemRate: settings?.pointsRedeemRate ?? 100,
    minRedeemPoints: settings?.minRedeemPoints ?? 100,
  };
}

// Converts a points amount into a USD discount using the configured rate.
export async function pointsToUsd(points: number): Promise<number> {
  const { pointsRedeemRate } = await getPointsSettings();
  if (pointsRedeemRate <= 0) return 0;
  return Math.round((points / pointsRedeemRate) * 100) / 100;
}

// Called once an order transitions into PAID. Idempotent via the
// `pointsAwarded` flag on Order, so it's safe to call from both the webhook
// and the admin manual-status-update route without double-crediting.
export async function awardPointsForOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || !order.userId || order.pointsAwarded) return;

  const { pointsPerUsd } = await getPointsSettings();
  const earned = Math.floor(order.amountUsd * pointsPerUsd);
  if (earned <= 0) {
    await prisma.order.update({ where: { id: order.id }, data: { pointsAwarded: true } });
    return;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: order.userId },
      data: { points: { increment: earned } },
    }),
    prisma.pointsLedger.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        type: "EARN",
        points: earned,
        note: `Order ${order.orderNumber}`,
      },
    }),
    prisma.order.update({
      where: { id: order.id },
      data: { pointsEarned: earned, pointsAwarded: true },
    }),
  ]);
}

// Called when a PENDING order that had points redeemed ends up FAILED /
// CANCELLED / REFUNDED — gives the spent points back. Idempotent: it checks
// for an existing REFUND ledger entry for this order before crediting again.
export async function refundRedeemedPointsForOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || !order.userId || order.pointsRedeemed <= 0) return;

  const existingRefund = await prisma.pointsLedger.findFirst({
    where: { orderId: order.id, type: "REFUND" },
  });
  if (existingRefund) return;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: order.userId },
      data: { points: { increment: order.pointsRedeemed } },
    }),
    prisma.pointsLedger.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        type: "REFUND",
        points: order.pointsRedeemed,
        note: `Refund for ${order.orderNumber}`,
      },
    }),
  ]);
}
