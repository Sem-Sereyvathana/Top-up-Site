import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { verifyWebhook, PaymentMethod } from "@/lib/payment";
import { notifyTelegram, escapeHtml } from "@/lib/telegram";
import { awardPointsForOrder, refundRedeemedPointsForOrder } from "@/lib/loyalty";
import { decrementStockForOrder, restoreStockForOrder } from "@/lib/stock";
import { finalizeOrderAfterPayment } from "@/lib/fulfillment";
import { handleGameItemOrderWebhook } from "@/lib/gameItemFulfillment";
import { handleGameAccountOrderWebhook } from "@/lib/gameAccountFulfillment";
import { checkRateLimit } from "@/lib/rateLimit";
import { creditForPaidTopUp, refundOrderToWallet } from "@/lib/wallet";
import { queueTopupReceipt } from "@/lib/receipt";
import { finalizePaymentGroup } from "@/lib/paymentGroup";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/clientIp";

// KHPay webhook receiver.
//   URL:     /api/payment/webhook/khpay
//   Events:  payment.paid | payment.expired | payment.failed
//   Signing: HMAC-SHA256 of raw body using your webhook secret
//            delivered in the `X-Webhook-Signature: sha256=<hex>` header.
//
// The route is parameterized so legacy paths still resolve; unknown methods
// are rejected with 400.

// Wallet top-ups (WT-) credit the buyer's wallet instead of delivering a
// product. Credited exactly once: creditForPaidTopUp claims the row
// PENDING -> PAID atomically, so webhook replays are harmless.
async function handleWalletTopUpWebhook(
  orderNumber: string,
  event: string,
  data: any,
  transactionId: string | undefined
): Promise<NextResponse> {
  const topUp = await prisma.walletTopUp.findUnique({ where: { orderNumber } });
  if (!topUp) {
    return NextResponse.json({ error: "Wallet top-up not found" }, { status: 404 });
  }

  if (event === "payment.paid") {
    const paidAmount = parseFloat(String(data.amount ?? "0"));
    const expectedUsd = topUp.amountCents / 100;
    const amountOk = Number.isFinite(paidAmount) && Math.abs(paidAmount - expectedUsd) <= 0.01;
    const currency: string | undefined = data.currency;
    const currencyOk = !currency || currency.toUpperCase() === "USD";

    if (!amountOk || !currencyOk) {
      const reason = `Wallet top-up mismatch: got ${paidAmount} ${currency ?? ""}, expected ${expectedUsd} USD`;
      await prisma.walletTopUp.update({
        where: { id: topUp.id },
        data: { status: "FAILED" },
      }).catch(() => {});
      await notifyTelegram(
        `🚨 <b>Wallet top-up mismatch ${escapeHtml(topUp.orderNumber)}</b>\n${escapeHtml(reason)}`
      ).catch(() => {});
      return NextResponse.json({ error: "Payment mismatch" }, { status: 400 });
    }

    const result = await creditForPaidTopUp(topUp.id);
    if (!result.ok) {
      // Something went wrong crediting — leave it retryable and alert.
      await notifyTelegram(
        `🚨 <b>Wallet top-up credit failed ${escapeHtml(topUp.orderNumber)}</b>\n${escapeHtml(result.error ?? "unknown")}`
      ).catch(() => {});
      return NextResponse.json({ error: "Credit failed" }, { status: 500 });
    }

    await prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: {
        status: "PAID",
        paidAt: topUp.paidAt ?? new Date(),
        ...(transactionId ? { paymentRef: transactionId } : {}),
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, alreadyCredited: !!result.alreadyCredited });
  }

  if (event === "payment.expired" || event === "payment.failed") {
    await prisma.walletTopUp.updateMany({
      where: { id: topUp.id, status: "PENDING" },
      data: { status: "FAILED" },
    });
  }

  return NextResponse.json({ ok: true });
}

// Combined multi-store order (GRP-). The amount check runs against the
// GROUP total — that's what KHPay charged — then each child order is handed
// to its own finalizer. finalizePaymentGroup() is idempotent, so a replayed
// webhook is a no-op.
async function handlePaymentGroupWebhook(
  orderNumber: string,
  event: string,
  data: any,
  transactionId: string | undefined
): Promise<NextResponse> {
  const group = await prisma.paymentGroup.findUnique({ where: { orderNumber } });
  if (!group) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (group.status !== "PENDING") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (event === "payment.paid") {
    const paidAmount = parseFloat(String(data.amount ?? "0"));
    const amountOk = Number.isFinite(paidAmount) && Math.abs(paidAmount - group.amountUsd) <= 0.01;
    const currency: string | undefined = data.currency;
    const currencyOk = !currency || currency.toUpperCase() === "USD";

    if (!amountOk || !currencyOk) {
      const reason = [
        !amountOk && `Amount mismatch: got ${paidAmount}, expected ${group.amountUsd}`,
        !currencyOk && `Currency mismatch: got ${currency}, expected USD`,
      ].filter(Boolean).join("; ");
      await prisma.paymentGroup.update({
        where: { id: group.id },
        data: { status: "FAILED" },
      }).catch(() => {});
      await notifyTelegram(
        `🚨 <b>Payment mismatch on combined order ${escapeHtml(group.orderNumber)}</b>\n${escapeHtml(reason)}`
      ).catch(() => {});
      return NextResponse.json({ error: "Payment mismatch" }, { status: 400 });
    }

    const result = await finalizePaymentGroup(group.id, {
      paymentRef: transactionId || group.paymentRef || undefined,
    });
    return NextResponse.json({ ok: true, status: result.status });
  }

  if (event === "payment.expired" || event === "payment.failed") {
    await prisma.paymentGroup.updateMany({
      where: { id: group.id, status: "PENDING" },
      data: { status: "FAILED" },
    });
    // Children were never paid — park them so they stop holding stock/
    // accounts instead of sitting PENDING forever.
    await prisma.order.updateMany({
      where: { paymentGroupId: group.id, status: "PENDING" },
      data: { status: "FAILED", failureReason: `KHPay: ${event}` },
    });
    await prisma.gameItemOrder.updateMany({
      where: { paymentGroupId: group.id, status: "PENDING" },
      data: { status: "FAILED", failureReason: `KHPay: ${event}` },
    });
    await prisma.gameAccountOrder.updateMany({
      where: { paymentGroupId: group.id, status: "PENDING" },
      data: { status: "FAILED", failureReason: `KHPay: ${event}` },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{  method: string  }> }
) {
  const method = (await params).method.toUpperCase() as PaymentMethod;
  // 120 requests/min per IP — generous, since KHPay legitimately bursts
  // retries on timeout and this endpoint has no user-facing "too many
  // attempts" UI to fall back on. This isn't here to stop KHPay; it's here
  // so a flood of junk POSTs (bad signature or not) can't force unlimited
  // HMAC computations and DB lookups per second on a public, unauthenticated
  // route. Signature verification below is still the real gate — this is
  // just a cost/DoS backstop in front of it.
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`webhook:${ip}`, 120, 60 * 1000, { failClosed: true }))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (method !== "KHPAY") {
    return NextResponse.json({ error: "Invalid method" }, { status: 400 });
  }

  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });

  const valid = verifyWebhook(method, rawBody, headers);
  if (!valid) {
    console.warn(`[webhook] Invalid signature from ${method}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // KHPay payload shape:
  // { event: "payment.paid", data: { transaction_id, amount, currency, metadata, ... }, timestamp }
  const event: string = payload.event || "";
  const data = payload.data || {};
  const transactionId: string | undefined = data.transaction_id;
  // We set metadata.order_number when creating the QR (see lib/payment.ts)
  const orderNumber: string | undefined =
    data.metadata?.order_number || data.metadata?.orderNumber;

  if (!orderNumber && !transactionId) {
    return NextResponse.json({ error: "Missing identifier" }, { status: 400 });
  }

  // Game Items / Accounts marketplace orders use their own tables (GI-/AC-
  // prefixed order numbers, set in lib/utils.ts generateOrderNumber) and are
  // handled entirely separately from the Top-up Order flow below — nothing
  // past this point touches Order/Product/Game.
  if (orderNumber?.startsWith("GI-")) {
    return handleGameItemOrderWebhook(orderNumber, event, data, transactionId);
  }
  if (orderNumber?.startsWith("AC-")) {
    return handleGameAccountOrderWebhook(orderNumber, event, data, transactionId);
  }
  if (orderNumber?.startsWith("WT-")) {
    return handleWalletTopUpWebhook(orderNumber, event, data, transactionId);
  }
  // Combined multi-store checkout: ONE payment covering a Top-up order plus
  // any Game Items / Accounts bought with it. The group is what KHPay
  // charged, so the amount check runs against the group total and each child
  // is then finalised through its own normal pipeline.
  if (orderNumber?.startsWith("GRP-")) {
    return handlePaymentGroupWebhook(orderNumber, event, data, transactionId);
  }

  const order = orderNumber
    ? await prisma.order.findUnique({ where: { orderNumber } })
    : await prisma.order.findFirst({ where: { paymentRef: transactionId! } });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Idempotency: do nothing if already in a terminal state
  if (order.status !== "PENDING") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (event === "payment.paid") {
    // Verify amount matches to prevent tampered signed events.
    const paidAmount = parseFloat(String(data.amount ?? "0"));
    const amountOk = Number.isFinite(paidAmount) && Math.abs(paidAmount - order.amountUsd) <= 0.01;

    // If the signed event carries a currency, it must be USD.
    const currency: string | undefined = data.currency;
    const currencyOk = !currency || currency.toUpperCase() === "USD";

    // If the signed event carries a transaction_id AND the order already
    // has a paymentRef, they must match (both values may be absent for
    // older QR-only flows — only fail when BOTH sides are present).
    const txId: string | undefined = transactionId;
    const txOk = !txId || !order.paymentRef || txId === order.paymentRef;

    if (!amountOk || !currencyOk || !txOk) {
      const reason = [
        !amountOk && `Amount mismatch: got ${paidAmount}, expected ${order.amountUsd}`,
        !currencyOk && `Currency mismatch: got ${currency}, expected USD`,
        !txOk && `Transaction ID mismatch: got ${txId}, stored ${order.paymentRef}`,
      ]
        .filter(Boolean)
        .join("; ");

      // Record failure reason but do NOT silently fail — the customer paid
      // real money and must not be left with a FAILED order and no alert.
      await prisma.order.update({
        where: { id: order.id },
        data: { failureReason: `PAYMENT MISMATCH — ${reason}` },
      });

      // Immediate Telegram alert so the operator can investigate.
      await notifyTelegram(
        `🚨 <b>Payment mismatch on order ${escapeHtml(order.orderNumber)}</b>\n` +
          `${escapeHtml(reason)}\n` +
          `Order NOT marked paid. Manual review required.`
      );

      console.error(`[webhook] Payment mismatch for ${order.orderNumber}: ${reason}`);
      return NextResponse.json({ error: "Payment mismatch" }, { status: 400 });
    }

    // Roblox/Robux stops at PAID for manual admin fulfillment; every other
    // game (Mobile Legends, PUBG, Free Fire, etc.) has nothing left to do
    // once payment clears, so it's marked DELIVERED right here.
    const claimedStatus = await finalizeOrderAfterPayment(order.id, {
      paymentRef: transactionId || order.paymentRef || undefined,
    });

    // null means a concurrent/duplicate delivery of this same webhook
    // already claimed the order (see the atomic guard in
    // finalizeOrderAfterPayment) — stop here so points, stock, and the
    // Telegram alert below don't fire twice for one payment.
    if (!claimedStatus) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    // Credit loyalty points now that the order is actually paid (no-op for
    // guest orders / already-credited orders).
    await awardPointsForOrder(order.id);

    // Take stock units off (guarded decrements — can never go negative).
    // A non-null result means the order is PAID but the stock was already
    // gone (e.g. two checkouts raced for the last unit): the customer's
    // money IS taken, so the order must not be failed silently — park it
    // with a note and page the operator instead.
    const stockProblem = await decrementStockForOrder(order.id);
    if (stockProblem) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          deliveryNote: `PAID but stock problem: ${stockProblem}. Deliver manually or refund.`,
        },
      });
      await notifyTelegram(
        `🚨 <b>Stock short on PAID order ${escapeHtml(order.orderNumber)}</b>\n` +
          `${escapeHtml(stockProblem)}\n` +
          `Customer has PAID. Deliver manually or refund.`
      ).catch(() => {});
      console.error(`[webhook] stock problem for ${order.orderNumber}: ${stockProblem}`);
    }

    // Public proof-channel receipt — queued in the ReceiptLog outbox and
    // sent by the recovery sweep (also attempted immediately by the
    // checkout page's polling). Never blocks or fails this webhook.
    await queueTopupReceipt(order.id);

    // Fire-and-forget Telegram notification to the operator.
    const fullOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { game: true, product: true, items: true },
    });
    if (fullOrder) {
      const baseUrl = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
      const link = baseUrl ? `\n<a href="${baseUrl}/admin/orders/${fullOrder.orderNumber}">Open in admin</a>` : "";
      // Multi-package cart orders (Roblox) get a combined total instead of
      // just the first package, so the operator sees the real amount to
      // deliver — every other order keeps showing the plain product name.
      const packageLine =
        fullOrder.items.length > 0
          ? `${fullOrder.items.reduce((sum, it) => sum + Math.max(0, it.amount) * it.quantity, 0).toLocaleString()} Robux (${fullOrder.items.length} packages)`
          : fullOrder.product.name;
      await notifyTelegram(
        `💰 <b>${fullOrder.status === "DELIVERED" ? "Order delivered" : "New paid order"}</b>\n` +
          `<b>#${escapeHtml(fullOrder.orderNumber)}</b>\n` +
          `${escapeHtml(fullOrder.game.name)} — ${escapeHtml(packageLine)}\n` +
          `UID: <code>${escapeHtml(fullOrder.playerUid)}</code>\n` +
          `Amount: $${fullOrder.amountUsd.toFixed(2)}${link}`
      );
    }
    // TODO: enqueue fulfillment job (call game distributor API) here.
  } else if (event === "payment.expired" || event === "payment.failed") {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "FAILED",
        failureReason: `KHPay: ${event}`,
      },
    });
    // Give back any points the customer redeemed on this now-failed order.
    await refundRedeemedPointsForOrder(order.id);
    // Give back stock too, in case it was already taken.
    await restoreStockForOrder(order.id);
    // Wallet-paid money returns to the wallet (the gateway never took it —
    // this only fires if a wallet-paid order somehow reaches FAILED).
    await refundOrderToWallet(order);
  }

  return NextResponse.json({ ok: true });
}
