import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/userAuth";
import { NextResponse } from "next/server";

// Order history for the currently logged-in user only.
export async function GET() {
  const session = await getCurrentUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orders = await prisma.order.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { game: true, product: true },
  });

  return NextResponse.json({ orders });
}
