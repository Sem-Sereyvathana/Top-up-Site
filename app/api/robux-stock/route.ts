import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// Public, read-only: just the current total so the storefront can show
// "X Robux in stock" and keep it in sync with the admin panel.
export async function GET() {
  const stock = await prisma.robuxStock.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return NextResponse.json({ totalRobux: stock.totalRobux, updatedAt: stock.updatedAt });
}
