import { prisma } from "./prisma";
import { notifyTelegram, escapeHtml } from "./telegram";
import { NextResponse } from "next/server";

// Webhook handling for Accounts marketplace orders — same pattern as
// gameItemFulfillment.ts. On a confirmed payment, inside the same
// transaction that marks the order PAID: unique-login accounts flip to
// sold = true (unchanged behaviour); multi-stock + Direct-delivery accounts
// have `quantity` real stock units (GameAccountStockItem) pulled out of
// their pool and assigned to this order's line, so every buyer gets their
// own login instead of everyone sharing one; multi-stock + Manual-delivery
// accounts keep the old behaviour of just decrementing the counter, since
// there's no auto-reveal to buyers to worry about there.
export async function handleGameAccountOrderWebhook(
  orderNumber: string,
  event: string,
  data: any,
  transactionId?: string
) {
  const order = await prisma.gameAccountOrder.findUnique({
    where: { orderNumber },
    include: {
      items: {
        include: { gameAccount: { select: { id: true, stockMode: true, deliveryMode: true } } },
      },
    },
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

    try {
      await prisma.$transaction(async (tx) => {
        await tx.gameAccountOrder.update({
          where: { id: order.id },
          data: {
            status: "PAID",
            paidAt: now,
            ...(transactionId ? { paymentRef: transactionId } : {}),
          },
        });

        if (uniqueIds.length) {
          // Also flip `active` off here — a sold unique-login account has
          // nothing left to sell, so it shouldn't keep showing as "Active"
          // in the admin table (see GET /api/admin/accounts, which now
          // hides sold+inactive accounts from the default list too).
          await tx.gameAccount.updateMany({
            where: { id: { in: uniqueIds } },
            data: { sold: true, active: false },
          });
        }

        for (const it of multiItems) {
          if (it.gameAccount.deliveryMode === "DIRECT") {
            // Claim `quantity` real units from this account's pool, oldest
            // first. If there aren't enough left (e.g. a race with another
            // order, or stock was never topped up), bail out of the whole
            // transaction rather than deliver a partial/duplicate login.
            const picked = await tx.gameAccountStockItem.findMany({
              where: { gameAccountId: it.gameAccountId, status: "AVAILABLE" },
              orderBy: { createdAt: "asc" },
              take: it.quantity,
              select: { id: true },
            });
            if (picked.length < it.quantity) {
              throw new Error(`INSUFFICIENT_STOCK:${it.title}`);
            }
            await tx.gameAccountStockItem.updateMany({
              where: { id: { in: picked.map((p) => p.id) } },
              data: { status: "ASSIGNED", orderItemId: it.id, assignedAt: now },
            });
          }
          await tx.gameAccount.update({
            where: { id: it.gameAccountId },
            data: { stock: { decrement: it.quantity } },
          });
        }
      });
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.startsWith("INSUFFICIENT_STOCK:")) {
        const title = msg.split(":").slice(1).join(":");
        await prisma.gameAccountOrder.update({
          where: { id: order.id },
          data: { status: "FAILED", failureReason: `Out of stock: ${title}` },
        });
        await notifyTelegram(
          `⚠️ <b>Paid order couldn't be fulfilled — out of stock</b>\n` +
            `<b>#${escapeHtml(order.orderNumber)}</b>\n${escapeHtml(title)}\n` +
            `Payment was received but there wasn't enough stock to deliver. Refund the buyer or top up stock and resolve manually.`
        );
        return NextResponse.json({ error: "Out of stock" }, { status: 409 });
      }
      throw err;
    }

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
