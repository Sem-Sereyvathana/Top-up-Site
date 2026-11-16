import { prisma } from "./prisma";
import { notifyTelegram, escapeHtml } from "./telegram";
import { awardPointsForOrder } from "./loyalty";
import { decrementStockForOrder } from "./stock";

// Order recovery — a safety net for server restarts / crashes.
//
// Two jobs, both safe to run every minute:
//
// 1) STUCK-ORDER ALERT
//    An order that is PROCESSING (paid, waiting on FazerCards) for longer
//    than STUCK_AFTER_MS gets one Telegram alert, then a reminder every
//    REALERT_EVERY_MS while it is still stuck. The watcher (fazerWatch.ts)
//    is what actually retries delivery — this only makes sure a human knows
//    if retrying is not enough (FazerCards down, balance too low, etc).
//
// 2) FINISH INTERRUPTED POST-PAYMENT STEPS
//    The payment webhook does: claim order -> deliver -> award points ->
//    take stock -> Telegram. If the server restarts after the claim, the
//    webhook retry is skipped (order is no longer PENDING), so points/stock
//    could be left undone. Here we find recently paid orders whose flags
//    (pointsAwarded / stockDecremented) are still false and call the same
//    helpers the webhook uses. Both helpers are idempotent via those flags.
//
// Safety rails:
//   * Only orders paid in the last LOOKBACK_MS are touched, so old/legacy
//     orders are never retroactively credited or decremented.
//   * Only orders paid more than SETTLE_AFTER_MS ago, so we never race a
//     webhook that is still running.
//   * Only PAID / PROCESSING / DELIVERED — FAILED / CANCELLED / REFUNDED
//     orders have their stock deliberately restored and are left alone.
//   * An in-process lock stops two runs from overlapping.
//   * dryRun reports what it WOULD do and changes/sends nothing.

const STUCK_AFTER_MS = 5 * 60 * 1000; // PROCESSING this long = stuck
const REALERT_EVERY_MS = 60 * 60 * 1000; // remind at most once an hour
const SETTLE_AFTER_MS = 2 * 60 * 1000; // let an in-flight webhook finish first
const LOOKBACK_MS = 24 * 60 * 60 * 1000; // never touch orders older than this
const BATCH = 25; // orders repaired per run
const MAX_LISTED = 10; // orders listed in one Telegram message

// Alert de-dupe lives in memory: no schema change needed. After a restart
// you may get one repeat alert for an order that is still stuck — harmless.
const lastAlertAt = new Map<string, number>();
let running = false;

export interface RecoverySummary {
  dryRun: boolean;
  skipped: boolean; // true when another run was already in progress
  stuckOrders: number;
  alerted: number;
  incompleteOrders: number;
  stockCompleted: number;
  pointsCompleted: number;
  receiptsAttempted: number;
  errors: number;
}

export async function runOrderRecovery(
  opts: { dryRun?: boolean } = {}
): Promise<RecoverySummary> {
  const dryRun = !!opts.dryRun;
  const summary: RecoverySummary = {
    dryRun,
    skipped: false,
    stuckOrders: 0,
    alerted: 0,
    incompleteOrders: 0,
    stockCompleted: 0,
    pointsCompleted: 0,
    receiptsAttempted: 0,
    errors: 0,
  };

  if (running) {
    summary.skipped = true;
    return summary;
  }
  running = true;
  try {
    await alertStuckOrders(summary, dryRun);
    await finishPostPaymentSteps(summary, dryRun);
    await retryPendingReceipts(summary, dryRun);
  } finally {
    running = false;
  }
  return summary;
}

async function alertStuckOrders(summary: RecoverySummary, dryRun: boolean) {
  const now = Date.now();
  const stuck = await prisma.order.findMany({
    where: {
      status: "PROCESSING",
      paidAt: { lt: new Date(now - STUCK_AFTER_MS) },
    },
    orderBy: { paidAt: "asc" },
    take: 50,
    select: {
      id: true,
      orderNumber: true,
      playerUid: true,
      paidAt: true,
      game: { select: { name: true } },
    },
  });
  summary.stuckOrders = stuck.length;

  // Forget orders that are no longer stuck, so the map can't grow forever
  // and a later stall on the same order would alert again.
  const stuckIds = new Set(stuck.map((o) => o.id));
  for (const id of Array.from(lastAlertAt.keys())) {
    if (!stuckIds.has(id)) lastAlertAt.delete(id);
  }

  const due = stuck.filter(
    (o) => now - (lastAlertAt.get(o.id) ?? 0) >= REALERT_EVERY_MS
  );
  if (due.length === 0) return;

  summary.alerted = due.length;
  if (dryRun) return;

  const listed = due.slice(0, MAX_LISTED).map((o) => {
    const mins = o.paidAt ? Math.round((now - o.paidAt.getTime()) / 60000) : 0;
    return `• <b>#${escapeHtml(o.orderNumber)}</b> — ${escapeHtml(o.game.name)} — UID <code>${escapeHtml(o.playerUid)}</code> — ${mins} min`;
  });
  const more = due.length > MAX_LISTED ? `\n…and ${due.length - MAX_LISTED} more` : "";

  // Only record lastAlertAt when Telegram actually accepted the message —
  // otherwise a failed send would silence the alert for another hour.
  const sent = await notifyTelegram(
    `⏳ <b>Paid orders not delivered yet</b>\n` +
      `${listed.join("\n")}${more}\n\n` +
      `The watcher keeps retrying automatically (safe — no double top-up). ` +
      `If this keeps repeating, check FazerCards balance/status or deliver manually.`
  ).catch(() => false);

  if (sent) {
    for (const o of due) lastAlertAt.set(o.id, now);
  }
}

async function finishPostPaymentSteps(summary: RecoverySummary, dryRun: boolean) {
  const now = Date.now();
  const candidates = await prisma.order.findMany({
    where: {
      status: { in: ["PAID", "PROCESSING", "DELIVERED"] },
      paidAt: {
        gte: new Date(now - LOOKBACK_MS),
        lt: new Date(now - SETTLE_AFTER_MS),
      },
      OR: [
        { stockDecremented: false },
        // Guest orders (no userId) never earn points, so skip them —
        // otherwise they'd match this query forever.
        { pointsAwarded: false, userId: { not: null } },
      ],
    },
    orderBy: { paidAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      stockDecremented: true,
      pointsAwarded: true,
    },
  });
  summary.incompleteOrders = candidates.length;
  if (candidates.length === 0 || dryRun) return;

  const fixed: string[] = [];
  for (const o of candidates) {
    let touched = false;
    try {
      if (!o.stockDecremented) {
        // idempotent via stockDecremented; guarded so it can't go negative
        const stockProblem = await decrementStockForOrder(o.id);
        if (stockProblem) {
          await prisma.order.update({
            where: { id: o.id },
            data: { deliveryNote: `PAID but stock problem: ${stockProblem}. Deliver manually or refund.` },
          });
        }
        summary.stockCompleted++;
        touched = true;
      }
      if (!o.pointsAwarded && o.userId) {
        await awardPointsForOrder(o.id); // idempotent via pointsAwarded
        summary.pointsCompleted++;
        touched = true;
      }
      if (touched) fixed.push(o.orderNumber);
    } catch (err) {
      summary.errors++;
      console.error("[order-recovery] failed for", o.orderNumber, err);
    }
  }

  if (fixed.length > 0) {
    const listed = fixed.slice(0, MAX_LISTED).map((n) => `#${escapeHtml(n)}`).join(", ");
    const more = fixed.length > MAX_LISTED ? ` …and ${fixed.length - MAX_LISTED} more` : "";
    await notifyTelegram(
      `🛠 <b>Recovered ${fixed.length} order(s)</b> after an interrupted payment step ` +
        `(points/stock completed): ${listed}${more}`
    ).catch(() => {});
  }
}

// Retry any proof-channel receipts that are still unsent (Telegram was down,
// webhook fired but the send failed, etc). processPendingReceipts is idempotent
// per receipt row and never throws.
export async function retryPendingReceipts(summary: RecoverySummary, dryRun: boolean) {
  if (dryRun) return;
  try {
    const pending = await prisma.receiptLog.findMany({
      where: { status: { in: ["PENDING", "FAILED"] } },
      take: 25,
      select: { id: true },
    });
    if (pending.length === 0) return;
    const { processPendingReceipts } = await import("./receipt");
    await processPendingReceipts(25);
    summary.receiptsAttempted = pending.length;
  } catch (err) {
    summary.errors++;
    console.error("[order-recovery] receipt retry failed:", err);
  }
}
