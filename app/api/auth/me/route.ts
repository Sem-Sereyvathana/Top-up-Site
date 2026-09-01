import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/userAuth";
import { getPointsSettings, pointsToUsd } from "@/lib/loyalty";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ user: null });

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) return NextResponse.json({ user: null });

  const { minRedeemPoints } = await getPointsSettings();

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      points: user.points,
      pointsValueUsd: await pointsToUsd(user.points),
      minRedeemPoints,
    },
  });
}
