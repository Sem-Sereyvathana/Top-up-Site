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
  const group = await prisma.gameGroup.update({
    where: { id: params.id },
    data: parsed.data,
  });
  await writeAudit({
    action: "game-group.update",
    targetType: "gameGroup",
    targetId: params.id,
    details: parsed.data,
  });
  return NextResponse.json(group);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Games in this group simply fall back to ungrouped (groupId is nullable
  // with onDelete: SetNull at the DB level) — deleting a group never
  // deletes or orphans a game.
  await prisma.gameGroup.delete({ where: { id: params.id } });
  await writeAudit({
    action: "game-group.delete",
    targetType: "gameGroup",
    targetId: params.id,
  });
  return NextResponse.json({ ok: true });
}
