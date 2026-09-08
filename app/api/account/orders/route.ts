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
export async function GET() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [topUpOrders, gameItemOrders, gameAccountOrders] = await Promise.all([
    prisma.order.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { game: true, product: true },
    }),
    prisma.gameItemOrder.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { items: { select: { name: true, quantity: true } } },
    }),
    prisma.gameAccountOrder.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { items: { select: { title: true, quantity: true } } },
    }),
  ]);

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
      viewHref: `/order/items?number=${o.orderNumber}`,
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
      viewHref: `/order/accounts?number=${o.orderNumber}`,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ orders });
}
