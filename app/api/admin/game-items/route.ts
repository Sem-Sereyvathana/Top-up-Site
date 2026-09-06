import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";

const gameItemSchema = z.object({
  categoryId: z.string().min(1).optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  priceUsd: z.number().positive(),
  badge: z.string().optional().nullable(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export async function GET(req: NextRequest) {
  const categoryId = req.nextUrl.searchParams.get("categoryId");
  const items = await prisma.gameItem.findMany({
    where: categoryId ? { categoryId } : undefined,
    include: { Category: { select: { name: true, slug: true } } },
    orderBy: [{ Category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = gameItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const item = await prisma.gameItem.create({ data: parsed.data });
  await writeAudit({ action: "game-item.create", targetType: "gameItem", targetId: item.id });
  return NextResponse.json(item);
}
