import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/userAuth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Lets TopUpForm pre-fill the UID / Zone-Server boxes with whatever the
// signed-in user last used for this game, so they don't have to type it
// again on their next top up. Only ever reads that one user's own orders.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ saved: null });

  const gameId = new URL(req.url).searchParams.get("gameId");
  if (!gameId) {
    return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  }

  const last = await prisma.order.findFirst({
    where: { userId: user.userId, gameId },
    orderBy: { createdAt: "desc" },
    select: { playerUid: true, serverId: true },
  });

  if (!last?.playerUid) return NextResponse.json({ saved: null });

  return NextResponse.json({
    saved: { uid: last.playerUid, serverId: last.serverId || "" },
  });
}
