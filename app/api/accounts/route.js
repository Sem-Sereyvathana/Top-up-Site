import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";

const accountSchema = z.object({
  gameId: z.string().min(1).optional().nullable(),
  title: z.string().min(1),
  rank: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  priceUsd: z.number().positive(),
  sold: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export async function GET(req) {
  const gameId = req.nextUrl.searchParams.get("gameId");
  const accounts = await prisma.gameAccount.findMany({
    where: gameId ? { gameId } : undefined,
    include: { Game: { select: { name: true, slug: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(accounts);
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const account = await prisma.gameAccount.create({ data: parsed.data });
  await writeAudit({ action: "game-account.create", targetType: "gameAccount", targetId: account.id });
  return NextResponse.json(account);
}
