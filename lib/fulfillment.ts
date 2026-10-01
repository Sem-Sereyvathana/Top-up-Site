import { prisma } from "./prisma";
import { isRobuxGame } from "./utils";
import { isSabayConfigured, placeSabayOrder, getSabayOrder, type SabayOrderResult } from "./sabay";
import { notifyTelegram, escapeHtml } from "./telegram";

// Called once an order's payment is confirmed (real KHPay webhook or the
// local dev simulator). Roblox/Robux always needs a human to actually top up
// the account on Roblox's side, so those orders deliberately stop at PAID —
// they show up in the admin's dedicated Robux Orders queue for manual
// fulfillment (see app/admin/(protected)/robux-orders). Every other game
// (Mobile Legends, PUBG, Free Fire, etc.) has no manual step left once
// payment clears, so those are marked DELIVERED immediately.
//
// Games/packages linked to the SabayStore supplier (Game.supplierSlug +
// Product.supplierOfferId, set by `npm run db:sync-sabay`) are topped up
// automatically through their API: the order goes PROCESSING, the supplier
// order is placed, and it flips to DELIVERED as soon as the supplier
// confirms. If the supplier can't deliver, the order is parked at PAID with
// a note + Telegram alert so it lands in the admin's manual queue.
//
// Returns the status the order was moved to, or null if there was nothing
// to do (order missing or already DELIVERED) — callers use this to decide
// what to log/notify.
export async function finalizeOrderAfterPayment(
  orderId: string,
  opts: { paymentRef?: string } = {}
): Promise<"PAID" | "PROCESSING" | "DELIVERED" | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { game: true, product: true },
  });
  if (!order || order.status === "DELIVERED") return null;

  // Simulation mode never spends real supplier balance.
  const viaSupplier =
    !isRobuxGame(order.game) &&
    !!order.game.supplierSlug &&
    !!order.product.supplierOfferId &&
    process.env.PAYMENT_SIMULATION_MODE !== "true";
  const supplierReady = viaSupplier && isSabayConfigured();

  const nextStatus: "PAID" | "PROCESSING" | "DELIVERED" = isRobuxGame(order.game)
    ? "PAID"
    : viaSupplier
      ? supplierReady
        ? "PROCESSING"
        : "PAID"
      : "DELIVERED";
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
      ...(viaSupplier && !supplierReady
        ? { deliveryNote: "SABAY_API_KEY is not set — top up this order manually." }
        : {}),
      ...(opts.paymentRef ? { paymentRef: opts.paymentRef } : {}),
    },
  });
  if (claimed.count === 0) return null;

  if (supplierReady) {
    await dispatchToSupplier(order.id, { poll: true });
    const after = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true },
    });
    if (after?.status === "DELIVERED" || after?.status === "PAID" || after?.status === "PROCESSING") {
      return after.status;
    }
  }

  return nextStatus;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function alertSupplierProblem(orderNumber: string, uid: string, reason: string) {
  await notifyTelegram(
    `⚠️ <b>Auto top-up needs attention</b>\n` +
      `<b>#${escapeHtml(orderNumber)}</b>\n` +
      `UID: <code>${escapeHtml(uid)}</code>\n` +
      `${escapeHtml(reason)}`
  ).catch(() => {});
}

// Applies a supplier order result to our order. Every write is guarded with
// status: "PROCESSING" so a repeated/concurrent call can't double-apply.
async function applySupplierResult(
  order: { id: string; orderNumber: string; playerUid: string },
  result: Extract<SabayOrderResult, { ok: true }>
) {
  if (result.status === "DELIVERED") {
    await prisma.order.updateMany({
      where: { id: order.id, status: "PROCESSING" },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        supplierOrderNumber: result.orderNumber,
        deliveryNote: `Auto top-up delivered (supplier ${result.orderNumber})`,
      },
    });
  } else if (result.status === "REFUNDED") {
    const reason = `Supplier could not deliver (${result.orderNumber}): ${result.reason || "refunded to supplier balance"}. Top up manually or refund the customer.`;
    const moved = await prisma.order.updateMany({
      where: { id: order.id, status: "PROCESSING" },
      data: {
        status: "PAID",
        supplierOrderNumber: result.orderNumber,
        failureReason: reason,
      },
    });
    if (moved.count > 0) await alertSupplierProblem(order.orderNumber, order.playerUid, reason);
  } else {
    // Still PROCESSING at the supplier — remember their order number.
    await prisma.order.updateMany({
      where: { id: order.id, status: "PROCESSING" },
      data: { supplierOrderNumber: result.orderNumber },
    });
  }
}

// Places the supplier order for a paid order. Never throws. `clientRef` is our
// order number, so calling this again for the same order is always safe.
async function dispatchToSupplier(orderId: string, opts: { poll: boolean }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { game: true, product: true },
  });
  if (!order || order.status !== "PROCESSING") return;
  if (!order.game.supplierSlug || !order.product.supplierOfferId) return;

  let result = await placeSabayOrder({
    gameSlug: order.game.supplierSlug,
    offerId: order.product.supplierOfferId,
    playerId: order.playerUid,
    serverId: order.serverId,
    clientRef: order.orderNumber,
  });

  if (!result.ok) {
    if (result.retryable) return; // stays PROCESSING; syncSupplierOrder retries safely
    const reason = `Auto top-up failed: ${result.error}. Top up manually or refund the customer.`;
    const moved = await prisma.order.updateMany({
      where: { id: order.id, status: "PROCESSING" },
      data: { status: "PAID", failureReason: reason },
    });
    if (moved.count > 0) await alertSupplierProblem(order.orderNumber, order.playerUid, reason);
    return;
  }

  // Delivery is normally within seconds — wait briefly so the customer sees
  // DELIVERED straight away; anything slower is picked up by syncSupplierOrder.
  for (let i = 0; opts.poll && result.ok && result.status === "PROCESSING" && i < 4; i++) {
    await sleep(1500);
    const next = await getSabayOrder(result.orderNumber);
    if (next?.ok) result = next;
  }

  if (result.ok) await applySupplierResult(order, result);
}

// Called while a customer/admin is looking at an order that is still
// PROCESSING (see GET /api/orders/[orderNumber]): re-sends the supplier order
// if we never got their answer, or checks how it is going. Never throws.
export async function syncSupplierOrder(orderId: string) {
  try {
    if (!isSabayConfigured()) return;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, playerUid: true, status: true, supplierOrderNumber: true },
    });
    if (!order || order.status !== "PROCESSING") return;

    if (!order.supplierOrderNumber) {
      await dispatchToSupplier(order.id, { poll: false });
      return;
    }
    const remote = await getSabayOrder(order.supplierOrderNumber);
    if (remote?.ok) await applySupplierResult(order, remote);
  } catch (err) {
    console.error("[supplier] sync failed", err);
  }
}
