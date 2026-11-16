import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireAdminApi } from "@/lib/auth";

const updateSchema = z.object({
  categoryId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  priceUsd: z.number().positive().optional(),
  badge: z.string().nullable().optional(),
  active: z.boolean().optional(),
  soldOut: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  deliveryMode: z.enum(["DIRECT", "MANUAL"]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{  id: string  }> }
) {
  const { id } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }
  const item = await prisma.gameItem.update({
    where: { id: id },
    data: parsed.data,
  });
  await writeAudit({ action: "game-item.update", targetType: "gameItem", targetId: id, details: parsed.data });
  return NextResponse.json(item);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{  id: string  }> }
) {
  const { id } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  await prisma.gameItem.delete({ where: { id: id } });
  await writeAudit({ action: "game-item.delete", targetType: "gameItem", targetId: id });
  return NextResponse.json({ ok: true });
}
