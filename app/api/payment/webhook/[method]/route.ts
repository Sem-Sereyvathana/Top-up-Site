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
import { NextRequest, NextResponse } from "next/server";

// KHPay webhook receiver.
//   URL:     /api/payment/webhook/khpay
//   Events:  payment.paid | payment.expired | payment.failed
//   Signing: HMAC-SHA256 of raw body using your webhook secret
//            delivered in the `X-Webhook-Signature: sha256=<hex>` header.
//
// The route is parameterized so legacy paths still resolve; unknown methods
// are rejected with 400.

export async function POST(
  req: NextRequest,
  { params }: { params: { method: string } }
) {
  // 120 requests/min per IP — generous, since KHPay legitimately bursts
  // retries on timeout and this endpoint has no user-facing "too many
  // attempts" UI to fall back on. This isn't here to stop KHPay; it's here
  // so a flood of junk POSTs (bad signature or not) can't force unlimited
  // HMAC computations and DB lookups per second on a public, unauthenticated
  // route. Signature verification below is still the real gate — this is
  // just a cost/DoS backstop in front of it.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`webhook:${ip}`, 120, 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const method = params.method.toUpperCase() as PaymentMethod;

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
    // Verify amount matches to prevent tampering
    const paidAmount = parseFloat(String(data.amount ?? "0"));
    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - order.amountUsd) > 0.01) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "FAILED",
          failureReason: `Amount mismatch: got ${paidAmount}, expected ${order.amountUsd}`,
        },
      });
      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
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

    // Take one unit off the product's stock (no-op for unlimited-stock products).
    await decrementStockForOrder(order.id);

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
  }

  return NextResponse.json({ ok: true });
}
