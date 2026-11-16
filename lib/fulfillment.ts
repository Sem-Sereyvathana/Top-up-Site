import { isSimulationMode, isDemoMode } from "./simMode";
import { prisma } from "./prisma";
import { isGiftcardGame } from "./utils";
import { notifyTelegram, escapeHtml } from "./telegram";
import { refundOrderToWallet } from "./wallet";
import {
  isFazerConfigured, KEY_PREFIX, partsFor, fieldsFor, placeTopup, buyGiftcard,
  classifyError, type FzOrder, type FzPart,
} from "./fazercards";

// Called once an order's payment is confirmed (real KHPay webhook or the
// local dev simulator).
//
// Delivery follows the game's own deliveryMode (set per game in Admin →
// Games), the same DIRECT / MANUAL distinction the Accounts and Game Items
// marketplaces already use:
//
//   MANUAL — the admin and the customer talk before it can be completed
//            (Robux Quick Log-In: the buyer must message first so the admin
//            can log into their account). The order STOPS at PAID and waits
//            for the admin to click "Mark Delivered" — it is never marked
//            DELIVERED automatically.
//   DIRECT — the admin can complete it alone, no conversation. This splits
//            into two cases, decided by whether the package has a
//            FazerCards offer:
//              * with an offer (Mobile Legends, Free Fire, Valorant, Robux
//                gift cards, …) — delivered automatically: PROCESSING while
//                FazerCards works on it, DELIVERED once FazerCards confirms.
//              * with no offer (Robux Send) — the admin sends it themselves
//                from the buyer's username, so the order stops at PAID and
//                waits for "Mark Delivered".
//
// Nothing is ever marked DELIVERED without FazerCards confirming it or the
// admin doing it by hand. If the supplier can't deliver (low balance, sold
// out, a hard rejection), the order is parked at PAID with a note + Telegram
// alert so it lands in the admin's manual queue.
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
    include: {
      game: true,
      product: true,
      items: { include: { product: { select: { supplierOfferId: true } } } },
    },
  });
  if (!order || order.status === "DELIVERED") return null;

  // ── Demo mode ────────────────────────────────────────────────────────
  // Pretend payment succeeds, but DELIVERY still follows the real rules:
  // a game the admin delivers by hand (MANUAL, or DIRECT with no FazerCards
  // offer such as Robux Send) stops at PAID exactly like it would in
  // production, so the manual queues and the whole admin flow stay
  // walkable. Only games that are actually automatic (FazerCards-linked)
  // flip straight to DELIVERED with obviously-fake content.
  if (isDemoMode()) {
    const now = new Date();
    const demoCodes = order.items.length > 0
      ? order.items.flatMap((it) =>
          Array.from({ length: it.quantity }, (_, i) =>
            `DEMO-${it.name.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 10)}-${i + 1}`
          )
        )
      : [`DEMO-${order.product.name.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 10)}`];

    const hasOffer =
      !!order.game.supplierSlug &&
      (!!order.product.supplierOfferId ||
        (order.items.length > 0 && order.items.every((it) => !!it.product.supplierOfferId)));
    const autoInDemo = order.game.deliveryMode === "DIRECT" && hasOffer;

    const claimed = await prisma.order.updateMany({
      where: { id: order.id, status: "PENDING" },
      data: autoInDemo
        ? {
            status: "DELIVERED",
            paidAt: order.paidAt ?? now,
            deliveredAt: now,
            ...(opts.paymentRef ? { paymentRef: opts.paymentRef } : {}),
            deliveryNote: isGiftcardGame(order.game)
              ? `Giftcard code: ${demoCodes.join(", ")}  [DEMO MODE — not a real code]`
              : `DEMO MODE — simulated delivery of ${order.items.length > 0 ? `${order.items.length} package(s)` : order.product.name} for ${order.playerUid}. Nothing was sent to the game.`,
          }
        : {
            // Manual / admin-delivered game: demo payment, real delivery
            // rule — it waits for "Mark Delivered" like any paid order.
            status: "PAID",
            paidAt: order.paidAt ?? now,
            ...(opts.paymentRef ? { paymentRef: opts.paymentRef } : {}),
            deliveryNote: "DEMO MODE — payment simulated. This game is delivered by hand, so mark it Delivered when done.",
          },
    });
    return claimed.count === 0 ? null : autoInDemo ? "DELIVERED" : "PAID";
  }

  // Simulation mode never spends real supplier balance. Deliberately not
  // gated on isRobuxGame any more: whether FazerCards can deliver a package
  // is decided by the offer link, and Robux Send / Quick Log-In simply have
  // no offer, so viaSupplier is false for them anyway.
  const viaSupplier =
    !!order.game.supplierSlug &&
    // The primary product must have an offer (single-package orders), OR the
    // order is a multi-pack cart whose lines carry offers (Robux Giftcard
    // cart: `product` is only the first line).
    (!!order.product.supplierOfferId ||
      (order.items.length > 0 &&
        order.items.every((it) => !!it.product.supplierOfferId))) &&
    !isSimulationMode();
  const supplierReady = viaSupplier && isFazerConfigured();

  // Gift cards must never be marked DELIVERED without a code: when they are
  // not bought automatically (simulation mode / no key) they stop at PAID.
  const isGiftcard = isGiftcardGame(order.game);

  // The game's own delivery mode decides who completes the order — see the
  // comment above finalizeOrderAfterPayment. Anything unrecognised is
  // treated as MANUAL (the safe default: wait for the admin).
  const isManual = order.game.deliveryMode !== "DIRECT";

  // Only a DIRECT game with a FazerCards offer can move itself along; every
  // other order stops at PAID until the admin marks it Delivered.
  const nextStatus: "PAID" | "PROCESSING" =
    !isManual && supplierReady ? "PROCESSING" : "PAID";
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
      ...(viaSupplier && !supplierReady
        ? { deliveryNote: "FAZER_API_KEY is not set — top up this order manually." }
        : {}),
      ...(isGiftcard && !viaSupplier
        ? { deliveryNote: "Robux gift card: not bought automatically (simulation mode) — send the code manually." }
        : {}),
      ...(opts.paymentRef ? { paymentRef: opts.paymentRef } : {}),
    },
  });
  if (claimed.count === 0) return null;

  if (supplierReady) {
    await dispatchToFazer(order.id);
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

// FazerCards' refusal for "this pack isn't served in your account's region"
// reads (from their own dashboard): "This pack is not available for your
// account's region. Please choose a pack for your region." Match loosely on
// the region wording, since the exact phrasing may shift — but require BOTH
// "region" and one of the "not available/doesn't match" cues so an unrelated
// failure is never mistaken for a refundable region mismatch.
function looksLikeRegionMismatch(reason: string | null | undefined): boolean {
  const text = (reason ?? "").toLowerCase();
  if (!text.includes("region")) return false;
  return ["not available", "isn't available", "not supported", "doesn't match", "does not match", "choose a pack", "wrong region"].some(
    (cue) => text.includes(cue)
  );
}

async function alertSupplierProblem(orderNumber: string, uid: string, reason: string) {
  await notifyTelegram(
    `⚠️ <b>Auto top-up needs attention</b>\n` +
      `<b>#${escapeHtml(orderNumber)}</b>\n` +
      `UID: <code>${escapeHtml(uid)}</code>\n` +
      `${escapeHtml(reason)}`
  ).catch(() => {});
}

// Snapshot what the supplier charges us for this order onto Order.costUsd.
// Real FazerCards cost when reachable; otherwise the admin-set Product.costUsd
// flagged estimated. Never throws — profit reporting is worth less than the
// order itself.
async function snapshotSupplierCost(order: {
  id: string;
  game: { supplierSlug: string | null };
  product: { id: string; supplierOfferId: string | null; costUsd: number | null };
}): Promise<{ costUsd?: number; costEstimated?: boolean } | null> {
  try {
    const { isFazerConfigured, readOffers } = await import("./fazercards");
    if (isFazerConfigured() && order.product.supplierOfferId && order.game.supplierSlug) {
      const offers = await readOffers(order.game.supplierSlug, "topup");
      const info = offers.get(order.product.supplierOfferId);
      if (info && Number.isFinite(info.cost) && info.cost > 0) {
        return { costUsd: Math.round(info.cost * 100) / 100, costEstimated: false };
      }
    }
  } catch {
    // fall through to estimate
  }
  if (order.product.costUsd !== null && order.product.costUsd !== undefined && order.product.costUsd > 0) {
    return { costUsd: order.product.costUsd, costEstimated: true };
  }
  return null;
}

// Called while a customer/admin is looking at an order that is still
// PROCESSING (see GET /api/orders/[orderNumber]): re-sends the supplier order
// (same idempotency key, so never a double purchase) or checks how it is
// going. Never throws.
export async function syncSupplierOrder(orderId: string) {
  try {
    if (isFazerConfigured()) await dispatchToFazer(orderId);
  } catch (err) {
    console.error("[supplier] sync failed", err);
  }
}

// ======================================================================
// FazerCards delivery
// ======================================================================
// A pack is one or SEVERAL FazerCards orders (e.g. "234_23 + 78_8" or
// "2x weekly_pass"), placed one after another for the same Player ID.
// Each has a fixed idempotency key (site + order number + part), so calling
// this again — page polling, the watcher, a webhook replay — can never buy
// anything twice: FazerCards hands back the original order. That is also how
// an order resumes after a timeout or a low-balance wait, with no extra
// tables. Same rules as the Telegram bot (gametopup.py):
//   * unclear answer (timeout / 5xx / rate limit) -> keep waiting, never fail
//   * nothing delivered and FazerCards says no     -> parked at PAID + alert
//   * some parts delivered, a later one failed      -> parked at PAID, "PARTIAL"
//   * our FazerCards balance too low               -> keeps waiting + alert
const lastFazerRun = new Map<string, number>();

type FazerOutcome =
  | { state: "delivered"; ids: string[]; codes: string[] }
  | { state: "wait"; ids: string[]; noFunds: boolean }
  | { state: "failed"; ids: string[]; reason: string; delivered: number; total: number; soldOut: boolean };

// One "pack" to buy = one Product's FazerCards order, repeated `quantity`
// times. A single-package order has exactly one entry (quantity 1); a
// multi-package cart (Roblox Giftcard) can have several.
type PackLine = { supplierOfferId: string | null; quantity: number };

/** @internal exported for tests */
export function packLinesFor(order: {
  product: { supplierOfferId: string | null };
  items?: { productId: string; quantity: number }[];
}, productsById: Map<string, { supplierOfferId: string | null }>): PackLine[] {
  // Cart orders store their real lines on OrderItem; the primary `product`
  // is only a snapshot of the first line. Fall back to `product` for every
  // non-cart order.
  if (order.items && order.items.length > 0) {
    return order.items.map((it) => ({
      supplierOfferId: productsById.get(it.productId)?.supplierOfferId ?? null,
      quantity: it.quantity,
    }));
  }
  return [{ supplierOfferId: order.product.supplierOfferId, quantity: 1 }];
}

async function runFazerParts(order: {
  orderNumber: string;
  playerUid: string;
  serverId: string | null;
  game: { supplierSlug: string | null };
  product: { supplierOfferId: string | null };
  items?: { productId: string; quantity: number }[];
}, productsById: Map<string, { supplierOfferId: string | null }>): Promise<FazerOutcome> {
  // Flatten to individual FazerCards purchases: each pack line expanded by
  // its quantity, using the same "category:cardId" / offer parsing as before.
  const packLines = packLinesFor(order, productsById);
  const parts: FzPart[] = [];
  for (const line of packLines) {
    if (!line.supplierOfferId) return { state: "failed", ids: [], delivered: 0, total: 0, reason: "One of the selected packages has no supplier offer.", soldOut: false };
    const lineParts = partsFor(order.game.supplierSlug || "", line.supplierOfferId);
    // partsFor already expands "2x offer" specs; multiply by the line qty too.
    for (let q = 0; q < line.quantity; q++) parts.push(...lineParts);
  }
  const ids: string[] = [];
  const codes: string[] = [];
  let delivered = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const key = `${KEY_PREFIX}-${order.orderNumber}-p${i}a0`;
    let res: FzOrder;
    try {
      res =
        part.kind === "giftcard"
          ? await buyGiftcard(part.category, part.cardId, key)
          : await placeTopup(part.category, part.offerId, fieldsFor(part.category, order.playerUid, order.serverId), key);
    } catch (err: any) {
      const kind = classifyError(err);
      if (kind === "nofunds") return { state: "wait", ids, noFunds: true };
      if (kind === "ambiguous") return { state: "wait", ids, noFunds: false };
      return {
        state: "failed", ids, delivered, total: parts.length,
        reason: String(err?.message || kind).slice(0, 200), soldOut: kind === "soldout",
      };
    }
    if (res.id) ids.push(res.id);
    if (res.status === "completed") {
      delivered++;
      codes.push(...res.codes);
      continue;
    }
    if (res.status === "failed" || res.status === "refund") {
      return {
        state: "failed", ids, delivered, total: parts.length,
        reason: (res.reason || `supplier status: ${res.status}`).slice(0, 200), soldOut: false,
      };
    }
    return { state: "wait", ids, noFunds: false }; // still created / processing at FazerCards
  }
  return { state: "delivered", ids, codes };
}

// Never throws. Safe to call again at any time.
async function dispatchToFazer(orderId: string) {
  try {
    const last = lastFazerRun.get(orderId) || 0;
    if (Date.now() - last < 4000) return; // page polling: don't hammer FazerCards
    lastFazerRun.set(orderId, Date.now());

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { game: true, product: true, items: { select: { productId: true, quantity: true } } },
    });
    if (!order || order.status !== "PROCESSING") return;
    if (!order.game.supplierSlug) return;
    if (!order.product.supplierOfferId && (!order.items || order.items.length === 0)) return;

    // Resolve every cart line's Product so each line's supplier offer is known.
    let productsById = new Map<string, { supplierOfferId: string | null }>([[order.product.id, order.product]]);
    if (order.items && order.items.length > 0) {
      const found = await prisma.product.findMany({
        where: { id: { in: order.items.map((it) => it.productId) } },
        select: { id: true, supplierOfferId: true },
      });
      productsById = new Map(found.map((p) => [p.id, p]));
    }

    const out = await runFazerParts(order, productsById);
    const supplierIds = out.ids.join(",") || undefined;

    // Snapshot the real supplier cost onto the order (profit reporting).
    // Uses FazerCards' live offer cost; if unavailable, fall back to the
    // admin-set Product.costUsd flagged as estimated.
    const costSnapshot = await snapshotSupplierCost(order);

    if (out.state === "delivered") {
      const giftcard = out.codes.length > 0;
      await prisma.order.updateMany({
        where: { id: order.id, status: "PROCESSING" },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          supplierOrderNumber: supplierIds,
          ...(costSnapshot ?? {}),
          deliveryNote: giftcard
            ? `Giftcard code: ${out.codes.join(", ")}`
            : `Auto top-up delivered (FazerCards ${out.ids.join(", ")})`,
        },
      });
      return;
    }

    if (out.state === "failed") {
      const partial = out.delivered > 0;
      // A region mismatch is the ONE failure that is nobody's fault and can
      // never be fixed by retrying: FazerCards refuses the pack because the
      // buyer's account lives in a region this pack doesn't serve (their
      // wording: "This pack is not available for your account's region"). We
      // can't check that up front for every game, so when it happens the
      // customer's money goes straight back to their wallet instead of
      // waiting for a manual refund.
      const regionMismatch = !partial && looksLikeRegionMismatch(out.reason);
      const reason = partial
        ? `PARTIAL: ${out.delivered} of ${out.total} FazerCards orders were delivered, then: ${out.reason}. Do NOT refund in full — finish the rest manually or refund the difference.`
        : regionMismatch
          ? `Region mismatch: ${out.reason}. Refunded to the buyer's wallet automatically.`
          : `Auto top-up failed: ${out.reason}. Top up manually or refund the customer.`;
      const moved = await prisma.order.updateMany({
        where: { id: order.id, status: "PROCESSING" },
        data: {
          status: "PAID",
          failureReason: reason,
          supplierOrderNumber: supplierIds,
          ...(costSnapshot ?? {}),
        },
      });
      if (moved.count > 0) {
        await alertSupplierProblem(order.orderNumber, order.playerUid, reason);
        // Like the bot: close the pack right away; the watcher reopens it when FazerCards has stock again.
        if (out.soldOut && out.delivered === 0) {
          await prisma.product.updateMany({ where: { id: order.productId, stock: null }, data: { stock: 0 } });
        }
        // FULL supplier failure (nothing delivered) + wallet-paid order:
        // the money comes straight back to the buyer's wallet, exactly once
        // (refundForOrder is idempotent per order). KHPay-paid orders are
        // NOT auto-refunded here — that money sits at the gateway, so it
        // stays a manual decision; the Telegram alert above covers it.
        //
        // Region mismatches are the exception: they are a definite "this
        // pack can never be delivered to this account", so those are
        // refunded to the wallet whatever the payment method was. The
        // customer cannot get money back to their bank/ABA automatically —
        // wallet credit is the agreed fallback.
        if (!partial && (order.paymentMethod === "WALLET" || regionMismatch)) {
          const refunded = await refundOrderToWallet(order);
          if (refunded) {
            await notifyTelegram(
              `↩️ <b>Wallet refunded</b>\n<b>#${escapeHtml(order.orderNumber)}</b> — $${order.amountUsd.toFixed(2)} back to the buyer's wallet` +
                ` (${regionMismatch ? "the pack doesn't match the account's region" : "supplier delivered nothing"}).`
            ).catch(() => {});
          }
        }
      }
      return;
    }

    // wait
    if (supplierIds && supplierIds !== order.supplierOrderNumber) {
      await prisma.order.updateMany({
        where: { id: order.id, status: "PROCESSING" },
        data: { supplierOrderNumber: supplierIds },
      });
    }
    if (out.noFunds) {
      const note = "FazerCards balance too low — waiting, will retry automatically once topped up.";
      if (order.deliveryNote !== note) {
        await prisma.order.updateMany({ where: { id: order.id, status: "PROCESSING" }, data: { deliveryNote: note } });
        await notifyTelegram(
          `🚨 <b>FazerCards balance too low</b>\n<b>#${escapeHtml(order.orderNumber)}</b> is waiting. Please top up your FazerCards balance.`
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[fazercards] dispatch failed", err);
  }
}
