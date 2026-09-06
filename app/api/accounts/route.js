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
  // Admin-only login handover, only ever sent back to a buyer once their
  // order is PAID and the account's game has deliveryMode = "DIRECT".
  credentials: z.string().optional().nullable(),
});

export async function GET(req) {
  // NOTE: this route has no auth middleware (only /admin/* and /api/admin/*
  // are protected — see middleware.ts), so it's reachable by anyone, not
  // just the admin panel. `credentials` (login handover) must never appear
  // here — it's stripped below even though admin's edit form would
  // otherwise like to see it prefilled. Admin can still overwrite it via
  // PATCH; only reading it back is blocked.
  const gameId = req.nextUrl.searchParams.get("gameId");
  const accounts = await prisma.gameAccount.findMany({
    where: gameId ? { gameId } : undefined,
    include: { Game: { select: { name: true, slug: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  const safe = accounts.map(({ credentials, ...rest }) => rest);
  return NextResponse.json(safe);
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
  const { credentials, ...safe } = account;
  return NextResponse.json(safe);
}
