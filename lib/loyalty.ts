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
  if (!order || !order.userId) return;

  // RACE-SAFE claim: flip pointsAwarded false -> true atomically. Only the
  // caller whose updateMany matches 1 row gets to credit points — a second
  // concurrent caller (webhook + recovery job + admin route) matches 0 rows
  // and returns, so points can never be awarded twice.
  const claimed = await prisma.order.updateMany({
    where: { id: orderId, pointsAwarded: false },
    data: { pointsAwarded: true },
  });
  if (claimed.count === 0) return;

  const { pointsPerUsd } = await getPointsSettings();
  const earned = Math.floor(order.amountUsd * pointsPerUsd);
  if (earned <= 0) return;

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
      data: { pointsEarned: earned },
    }),
  ]);
}

// Called when a PENDING order that had points redeemed ends up FAILED /
// CANCELLED / REFUNDED — gives the spent points back.
//
// Idempotency without a schema change: re-check the REFUND ledger entry
// INSIDE a serializable transaction, so two concurrent callers (webhook +
// recovery job) can't both pass the findFirst check and double-refund. If
// a concurrent transaction commits first, this one's create fails the
// serialization conflict and Prisma throws — the caller's catch treats a
// duplicate as success (the refund exists, which is the goal).
export async function refundRedeemedPointsForOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || !order.userId || order.pointsRedeemed <= 0) return;

  try {
    await prisma.$transaction(
      async (tx) => {
        const existingRefund = await tx.pointsLedger.findFirst({
          where: { orderId: order.id, type: "REFUND" },
        });
        if (existingRefund) return;

        await tx.user.update({
          where: { id: order.userId! },
          data: { points: { increment: order.pointsRedeemed } },
        });
        await tx.pointsLedger.create({
          data: {
            userId: order.userId!,
            orderId: order.id,
            type: "REFUND",
            points: order.pointsRedeemed,
            note: `Refund for ${order.orderNumber}`,
          },
        });
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err) {
    // A serialization failure means a concurrent refund won — that is the
    // desired outcome (points refunded exactly once), so don't surface it.
    const msg = err instanceof Error ? err.message : String(err);
    if (/serializ|conflict|deadlock/i.test(msg)) {
      console.warn(`[loyalty] refund for ${order.orderNumber} already handled concurrently`);
      return;
    }
    throw err;
  }
}
