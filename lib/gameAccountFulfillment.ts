import { prisma } from "./prisma";
import { notifyTelegram, escapeHtml } from "./telegram";
import { NextResponse } from "next/server";

// Webhook handling for Accounts marketplace orders — same pattern as
// gameItemFulfillment.ts. On a confirmed payment, inside the same
// transaction that marks the order PAID: unique-login accounts flip to
// sold = true (unchanged behaviour); multi-stock accounts instead have
// their `stock` decremented by the quantity purchased.
export async function handleGameAccountOrderWebhook(
  orderNumber: string,
  event: string,
  data: any,
  transactionId?: string
) {
  const order = await prisma.gameAccountOrder.findUnique({
    where: { orderNumber },
    include: { items: { include: { gameAccount: { select: { id: true, stockMode: true } } } } },
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
    const uniqueIds = order.items
      .filter((it) => it.gameAccount.stockMode !== "MULTI")
      .map((it) => it.gameAccountId);
    const multiItems = order.items.filter((it) => it.gameAccount.stockMode === "MULTI");

    await prisma.$transaction([
      prisma.gameAccountOrder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paidAt: now,
          ...(transactionId ? { paymentRef: transactionId } : {}),
        },
      }),
      ...(uniqueIds.length
        ? [
            prisma.gameAccount.updateMany({
              where: { id: { in: uniqueIds } },
              data: { sold: true },
            }),
          ]
        : []),
      ...multiItems.map((it) =>
        prisma.gameAccount.update({
          where: { id: it.gameAccountId },
          data: { stock: { decrement: it.quantity } },
        })
      ),
    ]);

    const baseUrl = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
    const link = baseUrl
      ? `\n<a href="${baseUrl}/admin/account-orders">Open in admin</a>`
      : "";
    const lines = order.items
      .map((it) => (it.quantity > 1 ? `${it.title} ×${it.quantity}` : it.title))
      .join(", ");

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
