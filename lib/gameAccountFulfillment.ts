import { prisma } from "./prisma";
import { notifyTelegram, escapeHtml } from "./telegram";
import { NextResponse } from "next/server";

// Webhook handling for Accounts marketplace orders — same pattern as
// gameItemFulfillment.ts. The one thing unique to accounts: on a confirmed
// payment we flip every purchased GameAccount to sold = true inside the
// same transaction that marks the order PAID, so it instantly disappears
// from the storefront and can never be double-sold.
export async function handleGameAccountOrderWebhook(
  orderNumber: string,
  event: string,
  data: any,
  transactionId?: string
) {
  const order = await prisma.gameAccountOrder.findUnique({
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
      await prisma.gameAccountOrder.update({
        where: { id: order.id },
        data: {
          status: "FAILED",
          failureReason: `Amount mismatch: got ${paidAmount}, expected ${order.amountUsd}`,
        },
      });
      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.gameAccountOrder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paidAt: now,
          ...(transactionId ? { paymentRef: transactionId } : {}),
        },
      }),
      prisma.gameAccount.updateMany({
        where: { id: { in: order.items.map((it) => it.gameAccountId) } },
        data: { sold: true },
      }),
    ]);

    const baseUrl = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
    const link = baseUrl
      ? `\n<a href="${baseUrl}/admin/account-orders">Open in admin</a>`
      : "";
    const lines = order.items.map((it) => it.title).join(", ");

    await notifyTelegram(
      `🕹️ <b>New paid Account order</b>\n` +
        `<b>#${escapeHtml(order.orderNumber)}</b>\n` +
        `${escapeHtml(lines)}\n` +
        `Delivery: ${order.deliveryMode}${order.customerContact ? ` · Contact: ${escapeHtml(order.customerContact)}` : ""}\n` +
        `Amount: $${order.amountUsd.toFixed(2)}${link}`
    );
  } else if (event === "payment.expired" || event === "payment.failed") {
    await prisma.gameAccountOrder.update({
      where: { id: order.id },
      data: { status: "FAILED", failureReason: `KHPay: ${event}` },
    });
  }

  return NextResponse.json({ ok: true });
}
