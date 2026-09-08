import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  imageUrl: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
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
  const category = await prisma.gameAccountCategory.update({
    where: { id: params.id },
    data: parsed.data,
  });
  await writeAudit({
    action: "game-account-category.update",
    targetType: "gameAccountCategory",
    targetId: params.id,
    details: parsed.data,
  });
  return NextResponse.json(category);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Accounts in this category simply fall back to "General" (categoryId is
  // nullable with onDelete: SetNull at the DB level) — deleting a category
  // never deletes or orphans an account.
  await prisma.gameAccountCategory.delete({ where: { id: params.id } });
  await writeAudit({
    action: "game-account-category.delete",
    targetType: "gameAccountCategory",
    targetId: params.id,
  });
  return NextResponse.json({ ok: true });
}
