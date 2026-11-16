import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { QUICK_LOGIN_SLUG, GIFTCARD_SLUG } from "@/lib/utils";
import { requireAdminApi } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") || undefined;
  const q = searchParams.get("q")?.trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const perPage = Math.min(100, parseInt(searchParams.get("perPage") || "25"));
  // Used by the dedicated /admin/robux-orders page — Robux/Roblox orders need
  // manual top-up (unlike every other game, which auto-delivers), so admins
  // work through them on their own queue separate from the general list.
  const robuxOnly = searchParams.get("robuxOnly") === "1";
  // Used by /admin/quick-login-orders — Robux Quick Login orders get their
  // own queue (separate from both Robux Send and the automated games).
  const quickLoginOnly = searchParams.get("quickLoginOnly") === "1";

  const where: any = {};
  if (status && status !== "ALL") where.status = status;
  if (q) {
    where.OR = [
      { orderNumber: { contains: q.toUpperCase(), mode: "insensitive" as const } },
      { playerUid: { contains: q, mode: "insensitive" as const } },
      { customerEmail: { contains: q, mode: "insensitive" as const } },
    ];
  }
  // Keep Roblox/Robux orders completely separate from automated game orders.
  // robuxOnly=1 is used by /admin/robux-orders. Every normal request excludes them.
  const quickLoginFilter = { slug: QUICK_LOGIN_SLUG };
  // Robux SEND only. Gift cards share currencyName "Robux" but are delivered
  // automatically by FazerCards, so they belong with the other top-up games
  // on the general Orders tab, not in the manual send queue.
  const robuxGameFilter = {
    OR: [
      { slug: "roblox" },
      { currencyName: { contains: "robux", mode: "insensitive" as const } },
    ],
    NOT: { slug: { in: [QUICK_LOGIN_SLUG, GIFTCARD_SLUG] } },
  };

  if (quickLoginOnly) {
    where.game = quickLoginFilter;
  } else if (robuxOnly) {
    where.game = robuxGameFilter;
  } else {
    where.NOT = { game: { OR: [robuxGameFilter, quickLoginFilter] } };
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        game: { select: { name: true, slug: true } },
        product: { select: { name: true, amount: true } },
        // Only present for multi-package cart orders (Roblox) — used to show
        // the combined Robux total instead of just the first package.
        items: { select: { name: true, amount: true, bonus: true, quantity: true } },
        // Buyer's Telegram identity (username) for the direct-contact button
        // on the admin order queues. Null for guests / Google sign-ins.
        user: { select: { telegramUsername: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({
    orders,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage),
  });
}
