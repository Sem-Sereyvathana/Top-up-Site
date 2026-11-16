import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

// Active packages for one game (by id or slug). Public and read-only: used by
// the combined checkout's "add a top-up" slot to list packages without
// loading the whole game page. Prices are the normal (non-reseller) list
// prices; the order API recomputes what the buyer actually pays server-side.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{  slug: string  }> }
) {
  const { slug } = await params;
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`products:${ip}`, 120, 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const key = slug;
  const game = await prisma.game.findFirst({
    where: { OR: [{ id: key }, { slug: key }], active: true },
    select: { id: true },
  });
  if (!game) {
    return NextResponse.json({ products: [] });
  }

  const products = await prisma.product.findMany({
    where: { gameId: game.id, active: true },
    orderBy: [{ priceUsd: "asc" }, { sortOrder: "asc" }],
    select: { id: true, name: true, amount: true, priceUsd: true, stock: true },
  });

  return NextResponse.json({
    products: products
      .filter((p) => p.stock === null || p.stock > 0)
      .map((p) => ({ id: p.id, name: p.name, amount: p.amount, priceUsd: p.priceUsd })),
  });
}
