import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") || undefined;
  const q = searchParams.get("q")?.trim();

  // This export belongs to the normal automated-game Orders page, so never
  // include Roblox/Robux orders in it.
  const robuxGameFilter = {
    OR: [
      { slug: "roblox" },
      { currencyName: { contains: "robux", mode: "insensitive" as const } },
    ],
  };

  const where: Record<string, unknown> = {
    NOT: { game: robuxGameFilter },
  };
  if (status && status !== "ALL") where.status = status;
  if (q) {
    where.OR = [
      { orderNumber: { contains: q.toUpperCase(), mode: "insensitive" as const } },
      { playerUid: { contains: q, mode: "insensitive" as const } },
      { customerEmail: { contains: q, mode: "insensitive" as const } },
      { customerPhone: { contains: q, mode: "insensitive" as const } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    include: {
      game: { select: { name: true } },
      product: { select: { name: true } },
      // Only present for multi-package cart orders (Roblox) — combined into
      // a single Robux total in the "Product" column below.
      items: { select: { amount: true, quantity: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const header = [
    "Order #",
    "Status",
    "Game",
    "Product",
    "Player UID",
    "Server",
    "Amount USD",
    "Amount KHR",
    "Email",
    "Phone",
    "Payment Method",
    "Payment Ref",
    "Created",
    "Paid",
    "Delivered",
  ];

  const rows = orders.map((o) =>
    [
      o.orderNumber,
      o.status,
      o.game?.name,
      o.items && o.items.length > 0
        ? `${o.items.reduce((sum, it) => sum + Math.max(0, it.amount) * it.quantity, 0)} Robux (${o.items.length} packages)`
        : o.product?.name,
      o.playerUid,
      o.serverId,
      o.amountUsd.toFixed(2),
      o.amountKhr,
      o.customerEmail,
      o.customerPhone,
      o.paymentMethod,
      o.paymentRef,
      o.createdAt.toISOString(),
      o.paidAt?.toISOString() ?? "",
      o.deliveredAt?.toISOString() ?? "",
    ]
      .map(csvCell)
      .join(",")
  );

  const csv = [header.map(csvCell).join(","), ...rows].join("\n");
  const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
