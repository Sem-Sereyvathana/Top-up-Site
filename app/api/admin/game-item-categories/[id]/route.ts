import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  imageUrl: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  deliveryMode: z.enum(["DIRECT", "MANUAL"]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }
  const category = await prisma.gameItemCategory.update({
    where: { id: params.id },
    data: parsed.data,
  });
  await writeAudit({
    action: "game-item-category.update",
    targetType: "gameItemCategory",
    targetId: params.id,
    details: parsed.data,
  });
  return NextResponse.json(category);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Items in this category simply fall back to "General" (categoryId is
  // nullable with onDelete: SetNull at the DB level) — deleting a category
  // never deletes or orphans an item.
  await prisma.gameItemCategory.delete({ where: { id: params.id } });
  await writeAudit({
    action: "game-item-category.delete",
    targetType: "gameItemCategory",
    targetId: params.id,
  });
  return NextResponse.json({ ok: true });
}
