import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";

export async function DELETE(_req, { params }) {
  const item = await prisma.gameAccountStockItem.findUnique({ where: { id: params.stockId } });
  if (!item || item.gameAccountId !== params.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (item.status !== "AVAILABLE") {
    return NextResponse.json(
      { error: "Can't remove a unit that's already been sold/assigned to an order." },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.gameAccountStockItem.delete({ where: { id: params.stockId } }),
    prisma.gameAccount.update({ where: { id: params.id }, data: { stock: { decrement: 1 } } }),
  ]);

  await writeAudit({
    action: "game-account.stock.remove",
    targetType: "gameAccount",
    targetId: params.id,
    details: { stockId: params.stockId },
  });

  return NextResponse.json({ ok: true });
}
