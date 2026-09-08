import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";

const updateSchema = z.object({
  gameId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).optional(),
  rank: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  priceUsd: z.number().positive().optional(),
  sold: z.boolean().optional(),
  stockMode: z.enum(["UNIQUE", "MULTI"]).optional(),
  stock: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  credentials: z.string().optional().nullable(),
});

export async function PATCH(req, { params }) {
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }
  const account = await prisma.gameAccount.update({
    where: { id: params.id },
    data: parsed.data,
  });
  await writeAudit({ action: "game-account.update", targetType: "gameAccount", targetId: params.id, details: parsed.data });
  // Now behind admin auth (see route.js in the parent folder) — safe to
  // echo credentials back like every other admin CRUD route does.
  return NextResponse.json(account);
}

export async function DELETE(_req, { params }) {
  await prisma.gameAccount.delete({ where: { id: params.id } });
  await writeAudit({ action: "game-account.delete", targetType: "gameAccount", targetId: params.id });
  return NextResponse.json({ ok: true });
}
