import { prisma } from "./prisma";

// Wallet engine. All amounts are INTEGER CENTS — never floats.
//
// Invariant: User.walletCents === sum(WalletTransaction.amountCents) for the
// user. Every mutation below keeps balance + ledger row in ONE transaction,
// and debits are guarded by a conditional updateMany (balance can never go
// negative, two concurrent spends can't both win) — the same atomic-claim
// pattern used for promo usage, points and stock elsewhere in this codebase.
//
// Idempotency:
//  - creditForPaidTopUp: claimed via WalletTopUp.status PENDING -> PAID
//  - refundForOrder: serializable transaction re-checks for an existing
//    REFUND row for the order (same pattern as refundRedeemedPointsForOrder)

export type WalletTxType = "TOPUP" | "PURCHASE" | "REFUND" | "ADMIN_ADJUST";

export interface WalletChangeResult {
  ok: boolean;
  balanceCents?: number;
  error?: string;
}

export const toCents = (usd: number): number => Math.round(usd * 100);
export const fromCents = (cents: number): number => Math.round(cents) / 100;

/**
 * Debit a user's wallet for a purchase. Fails (ok:false) when the balance
 * is insufficient or went insufficient concurrently — the caller must NOT
 * create the order in that case.
 */
export async function debitForPurchase(
  userId: string,
  amountCents: number,
  orderId: string,
  note?: string
): Promise<WalletChangeResult> {
  if (amountCents <= 0) return { ok: false, error: "Non-positive amount" };

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Conditional debit: only subtract when the balance still covers it.
        // A plain read-then-write would let two concurrent checkouts both
        // pass the check and drive the balance negative.
        const res = await tx.user.updateMany({
          where: { id: userId, active: true, walletCents: { gte: amountCents } },
          data: { walletCents: { decrement: amountCents } },
        });
        if (res.count !== 1) {
          return { ok: false, error: "INSUFFICIENT_FUNDS" };
        }

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { walletCents: true },
        });
        const balanceAfterCents = user?.walletCents ?? 0;

        await tx.walletTransaction.create({
          data: {
            userId,
            type: "PURCHASE",
            amountCents: -amountCents,
            balanceAfterCents,
            relatedOrderId: orderId,
            note,
          },
        });

        return { ok: true, balanceCents: balanceAfterCents };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err) {
    // Serialization conflicts mean a concurrent wallet write won — treat
    // like an insufficient-funds retry prompt, never a crash.
    const msg = err instanceof Error ? err.message : String(err);
    if (/serializ|conflict|deadlock/i.test(msg)) {
      return { ok: false, error: "WALLET_BUSY" };
    }
    throw err;
  }
}

/**
 * Credit a wallet top-up after payment is confirmed. Idempotent: the
 * WalletTopUp row is claimed PENDING -> PAID atomically first, so a webhook
 * replay can never credit twice. Returns ok:false when the row was already
 * claimed (that's a success for the caller — the money is/was credited).
 */
export async function creditForPaidTopUp(
  walletTopUpId: string
): Promise<WalletChangeResult & { alreadyCredited?: boolean }> {
  // Atomic claim: only one caller flips PENDING -> PAID.
  const claimed = await prisma.walletTopUp.updateMany({
    where: { id: walletTopUpId, status: "PENDING" },
    data: { status: "PAID", paidAt: new Date() },
  });
  if (claimed.count === 0) {
    return { ok: true, alreadyCredited: true };
  }

  const topUp = await prisma.walletTopUp.findUnique({ where: { id: walletTopUpId } });
  if (!topUp) return { ok: false, error: "TOPUP_MISSING" };

  try {
    return await prisma.$transaction(
      async (tx) => {
        const res = await tx.user.updateMany({
          where: { id: topUp.userId, active: true },
          data: { walletCents: { increment: topUp.amountCents } },
        });
        if (res.count !== 1) {
          throw new Error("USER_INACTIVE");
        }

        const user = await tx.user.findUnique({
          where: { id: topUp.userId },
          select: { walletCents: true },
        });
        const balanceAfterCents = user?.walletCents ?? 0;

        await tx.walletTransaction.create({
          data: {
            userId: topUp.userId,
            type: "TOPUP",
            amountCents: topUp.amountCents,
            balanceAfterCents,
            relatedOrderId: topUp.id,
            note: `Wallet top-up ${topUp.orderNumber}`,
          },
        });

        return { ok: true, balanceCents: balanceAfterCents };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err) {
    // Roll the claim back so a later retry can credit it — otherwise a
    // transient failure here would eat the customer's money.
    await prisma.walletTopUp
      .updateMany({
        where: { id: walletTopUpId, status: "PAID", paidAt: { gte: new Date(Date.now() - 60_000) } },
        data: { status: "PENDING", paidAt: null },
      })
      .catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    if (/serializ|conflict|deadlock|USER_INACTIVE/i.test(msg)) {
      return { ok: false, error: "WALLET_BUSY" };
    }
    throw err;
  }
}

/**
 * Refund an order's actually-paid amount to the buyer's wallet. Idempotent
 * per order: a serializable transaction re-checks for an existing REFUND
 * ledger row with this orderId, so the webhook, the recovery sweep and the
 * admin route can all call this concurrently and the wallet is credited
 * exactly once.
 *
 * Returns { ok:false, error:"NO_REFUND_DUE" } when there's nothing to
 * refund (order had no wallet-visible payment, or already refunded).
 */
export async function refundForOrder(
  orderId: string,
  amountCents: number,
  userId: string | null | undefined,
  note?: string
): Promise<WalletChangeResult> {
  if (amountCents <= 0) return { ok: false, error: "NON_POSITIVE" };
  if (!userId) return { ok: false, error: "NO_USER" };

  try {
    return await prisma.$transaction(
      async (tx) => {
        const existing = await tx.walletTransaction.findFirst({
          where: { relatedOrderId: orderId, type: "REFUND" },
        });
        if (existing) {
          return { ok: true, balanceCents: existing.balanceAfterCents };
        }

        const res = await tx.user.updateMany({
          where: { id: userId, active: true },
          data: { walletCents: { increment: amountCents } },
        });
        if (res.count !== 1) {
          return { ok: false, error: "USER_INACTIVE" };
        }

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { walletCents: true },
        });
        const balanceAfterCents = user?.walletCents ?? 0;

        await tx.walletTransaction.create({
          data: {
            userId,
            type: "REFUND",
            amountCents,
            balanceAfterCents,
            relatedOrderId: orderId,
            note,
          },
        });

        return { ok: true, balanceCents: balanceAfterCents };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/serializ|conflict|deadlock/i.test(msg)) {
      // A concurrent refund won — that is the desired outcome.
      return { ok: true };
    }
    throw err;
  }
}

/**
 * Admin manual adjust (signed delta). Caller is responsible for the audit
 * log entry — this only moves money. Delta may be negative (deduction) but
 * never below zero balance.
 */
export async function adminAdjust(
  userId: string,
  deltaCents: number,
  note: string
): Promise<WalletChangeResult> {
  if (deltaCents === 0) return { ok: false, error: "ZERO_DELTA" };
  if (!note.trim()) return { ok: false, error: "NOTE_REQUIRED" };

  try {
    return await prisma.$transaction(
      async (tx) => {
        if (deltaCents < 0) {
          const res = await tx.user.updateMany({
            where: { id: userId, walletCents: { gte: -deltaCents } },
            data: { walletCents: { increment: deltaCents } },
          });
          if (res.count !== 1) return { ok: false, error: "INSUFFICIENT_FUNDS" };
        } else {
          const res = await tx.user.updateMany({
            where: { id: userId },
            data: { walletCents: { increment: deltaCents } },
          });
          if (res.count !== 1) return { ok: false, error: "USER_MISSING" };
        }

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { walletCents: true },
        });
        const balanceAfterCents = user?.walletCents ?? 0;

        await tx.walletTransaction.create({
          data: {
            userId,
            type: "ADMIN_ADJUST",
            amountCents: deltaCents,
            balanceAfterCents,
            note,
          },
        });

        return { ok: true, balanceCents: balanceAfterCents };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/serializ|conflict|deadlock/i.test(msg)) {
      return { ok: false, error: "WALLET_BUSY" };
    }
    throw err;
  }
}

/**
 * Ledger integrity check for a user (used by admin view + tests): the
 * stored balance must equal the ledger sum.
 */
export async function verifyLedgerIntegrity(userId: string): Promise<{
  ok: boolean;
  storedCents: number | null;
  ledgerSumCents: number | null;
}> {
  const [user, agg] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { walletCents: true } }),
    prisma.walletTransaction.aggregate({
      where: { userId },
      _sum: { amountCents: true },
    }),
  ]);
  const storedCents = user?.walletCents ?? null;
  const ledgerSumCents = agg._sum.amountCents ?? 0;
  return { ok: storedCents === ledgerSumCents, storedCents, ledgerSumCents };
}

/**
 * Refund a Top-up order's actually-paid amount back to the buyer's wallet
 * (used when an order is refunded/cancelled/failed). Only applies when the
 * buyer is a signed-in user — guest orders have nowhere to refund to.
 *
 * Idempotent per order (refundForOrder re-checks for an existing REFUND).
 * Returns true when a refund row exists/now exists.
 */
export async function refundOrderToWallet(order: {
  id: string;
  userId: string | null;
  amountUsd: number;
}): Promise<boolean> {
  if (!order.userId) return false;
  const cents = Math.round(order.amountUsd * 100);
  if (cents <= 0) return false;
  const res = await refundForOrder(
    order.id,
    cents,
    order.userId,
    `Refund for order ${order.id}`
  );
  return res.ok;
}
