import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// PUBLIC read-only route.
//
// NOTE: this route has no auth middleware (only /admin/* and /api/admin/*
// are protected — see middleware.ts), so it's reachable by anyone, not just
// the admin panel. `credentials` (login handover) must never appear here —
// it's stripped below.
//
// The old POST handler that created game accounts lived here. It had no
// login check, so anyone on the internet could create accounts and set
// their price or credentials. It has been removed. The admin panel uses
// the authenticated /api/admin/accounts route instead.

export async function GET(req) {
  const gameId = req.nextUrl.searchParams.get("gameId");
  const accounts = await prisma.gameAccount.findMany({
    where: gameId ? { gameId } : undefined,
    include: { Game: { select: { name: true, slug: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  const safe = accounts.map(({ credentials, ...rest }) => rest);
  return NextResponse.json(safe);
}
