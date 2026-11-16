import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";

// Admin list view for Game Item marketplace orders. Protected by
// middleware.ts (matches /api/admin/:path*) — no extra auth check needed
// here, same as every other /api/admin/* route in this codebase.
export async function GET(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") || "ALL";
  const q = searchParams.get("q")?.trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = 20;

  const where: any = {};
  if (status !== "ALL") where.status = status;
  if (q) {
    where.OR = [
      { orderNumber: { contains: q, mode: "insensitive" } },
      { buyerUsername: { contains: q, mode: "insensitive" } },
      { customerContact: { contains: q, mode: "insensitive" } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.gameItemOrder.findMany({
      where,
      include: { items: { select: { name: true, quantity: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.gameItemOrder.count({ where }),
  ]);

  return NextResponse.json({
    orders,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
