import { prisma } from "./prisma";
import { isRobuxGame } from "./utils";

// Called once an order's payment is confirmed (real KHPay webhook or the
// local dev simulator). Roblox/Robux always needs a human to actually top up
// the account on Roblox's side, so those orders deliberately stop at PAID —
// they show up in the admin's dedicated Robux Orders queue for manual
// fulfillment (see app/admin/(protected)/robux-orders). Every other game
// (Mobile Legends, PUBG, Free Fire, etc.) has no manual step left once
// payment clears, so those are marked DELIVERED immediately.
//
// Returns the status the order was moved to, or null if there was nothing
// to do (order missing or already DELIVERED) — callers use this to decide
// what to log/notify.
export async function finalizeOrderAfterPayment(
  orderId: string,
  opts: { paymentRef?: string } = {}
): Promise<"PAID" | "DELIVERED" | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { game: true },
  });
  if (!order || order.status === "DELIVERED") return null;

  const nextStatus: "PAID" | "DELIVERED" = isRobuxGame(order.game) ? "PAID" : "DELIVERED";
  const now = new Date();

  // Atomic claim, not a plain update: the `where` re-checks status=PENDING
  // as part of the same statement, so if a duplicate/concurrent delivery
  // of the same webhook (KHPay retries on timeout, or a replayed request)
  // races this one, only the first to reach the DB actually flips the row
  // — the loser's `where` no longer matches and updates 0 rows. Callers
  // use that (count === 0 -> null) to skip the points/stock/notify side
  // effects that follow, instead of re-crediting them.
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: "PENDING" },
    data: {
      status: nextStatus,
      paidAt: order.paidAt ?? now,
      ...(nextStatus === "DELIVERED" ? { deliveredAt: now } : {}),
      ...(opts.paymentRef ? { paymentRef: opts.paymentRef } : {}),
    },
  });
  if (claimed.count === 0) return null;

  return nextStatus;
}
