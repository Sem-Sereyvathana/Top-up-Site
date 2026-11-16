import { prisma } from "./prisma";
import { notifyTelegram, escapeHtml } from "./telegram";
import { isDemoMode } from "./simMode";
import { NextResponse } from "next/server";

// Webhook handling for Game Items marketplace orders — mirrors the Top-up
// webhook branch in app/api/payment/webhook/[method]/route.ts but writes to
// GameItemOrder instead of Order. Orders always stop at PAID; admin marks
// DELIVERED by hand once they've actually handed the items over (either
// straight into the buyer's account, or after a Telegram chat).
export async function handleGameItemOrderWebhook(
  orderNumber: string,
  event: string,
  data: any,
  transactionId?: string
) {
  const order = await prisma.gameItemOrder.findUnique({
    where: { orderNumber },
    include: { items: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status !== "PENDING") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (event === "payment.paid") {
    // Amount + currency + transaction-id cross-checks (see the Top-up
    // webhook for the full rationale). On any mismatch: do NOT deliver,
    // do NOT silently fail — record the reason and alert the operator.
    const paidAmount = parseFloat(String(data.amount ?? "0"));
    const amountOk = Number.isFinite(paidAmount) && Math.abs(paidAmount - order.amountUsd) <= 0.01;
    const currency: string | undefined = data.currency;
    const currencyOk = !currency || currency.toUpperCase() === "USD";
    const txOk = !transactionId || !order.paymentRef || transactionId === order.paymentRef;

    if (!amountOk || !currencyOk || !txOk) {
      const reason = [
        !amountOk && `Amount mismatch: got ${paidAmount}, expected ${order.amountUsd}`,
        !currencyOk && `Currency mismatch: got ${currency}, expected USD`,
        !txOk && `Transaction ID mismatch: got ${transactionId}, stored ${order.paymentRef}`,
      ]
        .filter(Boolean)
        .join("; ");

      await prisma.gameItemOrder.update({
        where: { id: order.id },
        data: { failureReason: `PAYMENT MISMATCH — ${reason}` },
      });

      await notifyTelegram(
        `🚨 <b>Payment mismatch on Game Item order ${escapeHtml(order.orderNumber)}</b>\n` +
          `${escapeHtml(reason)}\n` +
          `Order NOT marked paid. Manual review required.`
      );

      console.error(`[webhook] Payment mismatch for ${order.orderNumber}: ${reason}`);
      return NextResponse.json({ error: "Payment mismatch" }, { status: 400 });
    }

    const now = new Date();
    // Atomic claim (mirrors lib/fulfillment.ts): the `where` re-checks
    // status=PENDING in the same statement, so a duplicate/concurrent
    // delivery of this webhook updates 0 rows instead of re-firing the
    // Telegram alert below for a payment that was already processed.
    const claimed = await prisma.gameItemOrder.updateMany({
      where: { id: order.id, status: "PENDING" },
      data: {
        // Game Items always stop at PAID: even a DIRECT item needs a human
        // (the admin) to hand it over, so the admin marks DELIVERED from the
        // queue. Demo mode follows the same rule — it only fakes the
        // payment, not the delivery, so the admin flow stays walkable.
        status: "PAID",
        paidAt: now,
        ...(isDemoMode() ? { deliveryNote: "DEMO MODE — payment simulated. Hand these items over, then mark Delivered." } : {}),
        ...(transactionId ? { paymentRef: transactionId } : {}),
      },
    });
    if (claimed.count === 0) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const baseUrl = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
    const link = baseUrl
      ? `\n<a href="${baseUrl}/admin/game-item-orders">Open in admin</a>`
      : "";
    const lines = order.items.map((it) => `${it.name} x${it.quantity}`).join(", ");

    await notifyTelegram(
      `🎁 <b>New paid Game Item order</b>\n` +
        `<b>#${escapeHtml(order.orderNumber)}</b>\n` +
        `${escapeHtml(lines)}\n` +
        `Username: <code>${escapeHtml(order.buyerUsername)}</code>\n` +
        `Delivery: ${order.deliveryMode}${order.customerContact ? ` · Contact: ${escapeHtml(order.customerContact)}` : ""}\n` +
        `Amount: $${order.amountUsd.toFixed(2)}${link}`
    );
  } else if (event === "payment.expired" || event === "payment.failed") {
    await prisma.gameItemOrder.update({
      where: { id: order.id },
      data: { status: "FAILED", failureReason: `KHPay: ${event}` },
    });
  }

  return NextResponse.json({ ok: true });
}
