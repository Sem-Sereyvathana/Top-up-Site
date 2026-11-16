import { prisma } from "./prisma";
import { finalizeOrderAfterPayment } from "./fulfillment";
import { handleGameItemOrderWebhook } from "./gameItemFulfillment";
import { handleGameAccountOrderWebhook } from "./gameAccountFulfillment";
import { awardPointsForOrder } from "./loyalty";
import { decrementStockForOrder } from "./stock";
import { queueGroupReceipt } from "./receipt";

// Combined multi-store checkout — the payment side.
//
// A PaymentGroup is ONE payment covering a Top-up order, a Game Items order
// and/or an Accounts order bought together. Each child keeps its own row and
// its own fulfilment rules, so nothing about single-store orders changes;
// the group only adds "these were paid by one transaction, send one receipt".
//
// Money: the group's amountUsd is the total of its children. The webhook
// checks the paid amount against the group total, then hands each child to
// the exact same finalizer a standalone order would use.

export const GROUP_PREFIX = "GRP-";

export function isGroupOrderNumber(value: string): boolean {
  return value.toUpperCase().startsWith(GROUP_PREFIX);
}

/** Sum of the children's amounts (what KHPay should be asked to charge). */
export async function computeGroupTotal(groupId: string): Promise<number> {
  const [topup, items, accounts] = await Promise.all([
    prisma.order.findMany({ where: { paymentGroupId: groupId }, select: { amountUsd: true } }),
    prisma.gameItemOrder.findMany({ where: { paymentGroupId: groupId }, select: { amountUsd: true } }),
    prisma.gameAccountOrder.findMany({ where: { paymentGroupId: groupId }, select: { amountUsd: true } }),
  ]);
  const sum = [...topup, ...items, ...accounts].reduce((s, o) => s + o.amountUsd, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Mark a group PAID and run every child's normal post-payment path.
 *
 * Idempotent: the group row is claimed PENDING -> PAID first, so a replayed
 * webhook does nothing. Safe to call for a group whose children are already
 * delivered (each child finalizer is itself idempotent).
 */
export async function finalizePaymentGroup(
  groupId: string,
  opts: { paymentRef?: string } = {}
): Promise<{ ok: boolean; status?: string }> {
  const group = await prisma.paymentGroup.findUnique({ where: { id: groupId } });
  if (!group) return { ok: false };

  // Atomic claim — only the first caller flips the row.
  const claimed = await prisma.paymentGroup.updateMany({
    where: { id: groupId, status: "PENDING" },
    data: {
      status: "PAID",
      paidAt: group.paidAt ?? new Date(),
      ...(opts.paymentRef ? { paymentRef: opts.paymentRef } : {}),
    },
  });
  if (claimed.count === 0) return { ok: true, status: group.status };

  const [topupOrders, itemOrders, accountOrders] = await Promise.all([
    prisma.order.findMany({ where: { paymentGroupId: groupId }, select: { id: true, orderNumber: true } }),
    prisma.gameItemOrder.findMany({ where: { paymentGroupId: groupId }, select: { orderNumber: true, amountUsd: true } }),
    prisma.gameAccountOrder.findMany({ where: { paymentGroupId: groupId }, select: { orderNumber: true, amountUsd: true } }),
  ]);

  // Top-up children go through the normal top-up pipeline (supplier dispatch,
  // gift-card codes, Robux manual queue) plus points and stock.
  for (const o of topupOrders) {
    await finalizeOrderAfterPayment(o.id, { paymentRef: opts.paymentRef });
    await awardPointsForOrder(o.id);
    await decrementStockForOrder(o.id);
  }

  // Marketplaces use their own handlers, exactly as a standalone payment.
  // Their amount check is done against the child's own amount, not the
  // group total.
  for (const o of itemOrders) {
    await handleGameItemOrderWebhook(o.orderNumber, "payment.paid", { amount: o.amountUsd }, opts.paymentRef);
  }
  for (const o of accountOrders) {
    await handleGameAccountOrderWebhook(o.orderNumber, "payment.paid", { amount: o.amountUsd }, opts.paymentRef);
  }

  // ONE receipt for the whole group.
  await queueGroupReceipt(groupId);

  return { ok: true, status: "PAID" };
}

/** Everything the order-status page needs for a combined order. */
export async function loadPaymentGroup(groupId: string) {
  const group = await prisma.paymentGroup.findUnique({ where: { id: groupId } });
  if (!group) return null;

  const [topup, items, accounts] = await Promise.all([
    prisma.order.findMany({
      where: { paymentGroupId: groupId },
      include: {
        game: { select: { name: true, slug: true } },
        product: { select: { name: true } },
        items: { select: { name: true, amount: true, quantity: true, unitPriceUsd: true } },
      },
    }),
    prisma.gameItemOrder.findMany({
      where: { paymentGroupId: groupId },
      include: { items: { select: { name: true, quantity: true, unitPriceUsd: true } } },
    }),
    prisma.gameAccountOrder.findMany({
      where: { paymentGroupId: groupId },
      include: { items: { select: { id: true, title: true, quantity: true, unitPriceUsd: true } } },
    }),
  ]);

  return { group, topup, items, accounts };
}
