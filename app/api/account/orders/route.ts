import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/userAuth";
import { NextResponse } from "next/server";

// Unified order history for the currently logged-in user. Merges Top-up
// orders, Game Items marketplace orders, and Accounts marketplace orders
// (three separate tables — see prisma/schema.prisma) into one list, newest
// first, for the History page. Each entry carries a `viewHref` pointing at
// the right order-tracker route for its type so the page can just link
// straight there.
// Only these statuses show up in the user's own History page — paid,
// still-processing, and delivered orders. PENDING ("Awaiting Payment"),
// FAILED, and CANCELLED orders are hidden here but remain fully visible
// in the admin panel.
const VISIBLE_TO_USER = ["PAID", "PROCESSING", "DELIVERED"];

export async function GET() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [topUpOrders, gameItemOrders, gameAccountOrders, groups] = await Promise.all([
    prisma.order.findMany({
      where: { userId: session.userId, status: { in: VISIBLE_TO_USER }, paymentGroupId: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { game: true, product: true },
    }),
    prisma.gameItemOrder.findMany({
      where: { userId: session.userId, status: { in: VISIBLE_TO_USER }, paymentGroupId: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { items: { select: { name: true, quantity: true } } },
    }),
    prisma.gameAccountOrder.findMany({
      where: { userId: session.userId, status: { in: VISIBLE_TO_USER }, paymentGroupId: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { items: { select: { title: true, quantity: true } } },
    }),
    // Combined cart payments (Game Items + Accounts paid together).
    prisma.paymentGroup.findMany({
      where: { userId: session.userId, status: { in: VISIBLE_TO_USER } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  // One History entry per combined payment — NOT one row per child order.
  // Two child orders paid by one QR are one purchase to the buyer; the
  // entry opens the group page, which stacks their independent receipts.
  const groupedItemOrders = new Map<string, typeof gameItemOrders>();
  const groupedAccountOrders = new Map<string, typeof gameAccountOrders>();
  if (groups.length > 0) {
    const ids = groups.map((g) => g.id);
    const [gItems, gAccounts] = await Promise.all([
      prisma.gameItemOrder.findMany({
        where: { paymentGroupId: { in: ids } },
        include: { items: { select: { name: true, quantity: true } } },
      }),
      prisma.gameAccountOrder.findMany({
        where: { paymentGroupId: { in: ids } },
        include: { items: { select: { title: true, quantity: true } } },
      }),
    ]);
    for (const o of gItems) {
      if (!o.paymentGroupId) continue;
      const list = groupedItemOrders.get(o.paymentGroupId) ?? [];
      list.push(o);
      groupedItemOrders.set(o.paymentGroupId, list);
    }
    for (const o of gAccounts) {
      if (!o.paymentGroupId) continue;
      const list = groupedAccountOrders.get(o.paymentGroupId) ?? [];
      list.push(o);
      groupedAccountOrders.set(o.paymentGroupId, list);
    }
  }

  const orders = [
    ...topUpOrders.map((o) => ({
      type: "TOPUP" as const,
      orderNumber: o.orderNumber,
      status: o.status,
      title: o.product?.name || "Top-up",
      subtitle: o.game?.name ?? null,
      imageUrl: o.product?.imageUrl || o.game?.imageUrl || null,
      amountUsd: o.amountUsd,
      createdAt: o.createdAt,
      viewHref: `/order?number=${o.orderNumber}`,
    })),
    ...gameItemOrders.map((o) => ({
      type: "GAME_ITEM" as const,
      orderNumber: o.orderNumber,
      status: o.status,
      title: o.items.map((it) => `${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`).join(", "),
      subtitle: "Game Items",
      imageUrl: null as string | null,
      amountUsd: o.amountUsd,
      createdAt: o.createdAt,
      viewHref: `/order/items?number=${o.orderNumber}&from=history`,
    })),
    ...gameAccountOrders.map((o) => ({
      type: "GAME_ACCOUNT" as const,
      orderNumber: o.orderNumber,
      status: o.status,
      title: o.items.map((it) => `${it.title}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`).join(", "),
      subtitle: "Account",
      imageUrl: null as string | null,
      amountUsd: o.amountUsd,
      createdAt: o.createdAt,
      viewHref: `/order/accounts?number=${o.orderNumber}&from=history`,
    })),
    ...groups.map((g) => {
      const items = groupedItemOrders.get(g.id) ?? [];
      const accounts = groupedAccountOrders.get(g.id) ?? [];
      const parts: string[] = [];
      for (const o of items) {
        parts.push(o.items.map((it) => `${it.name}${it.quantity > 1 ? ` x${it.quantity}` : ""}`).join(", "));
      }
      for (const o of accounts) {
        parts.push(o.items.map((it) => `${it.title}${it.quantity > 1 ? ` x${it.quantity}` : ""}`).join(", "));
      }
      // The group has no single status of its own to show in a list; the
      // page it opens shows each part's status separately.
      return {
        type: "GROUP" as const,
        orderNumber: g.orderNumber,
        status: g.status,
        title: parts.filter(Boolean).join(" + ") || "Cart order",
        subtitle: "Cart order",
        imageUrl: null as string | null,
        amountUsd: g.amountUsd,
        createdAt: g.createdAt,
        viewHref: `/order/group?number=${g.orderNumber}&from=history`,
      };
    }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ orders });
}
