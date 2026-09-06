import { prisma } from "./prisma";
import { notifyTelegram, escapeHtml } from "./telegram";
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
    const paidAmount = parseFloat(String(data.amount ?? "0"));
    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - order.amountUsd) > 0.01) {
      await prisma.gameItemOrder.update({
        where: { id: order.id },
        data: {
          status: "FAILED",
          failureReason: `Amount mismatch: got ${paidAmount}, expected ${order.amountUsd}`,
        },
      });
      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
    }

    const now = new Date();
    await prisma.gameItemOrder.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paidAt: now,
        ...(transactionId ? { paymentRef: transactionId } : {}),
      },
    });

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
