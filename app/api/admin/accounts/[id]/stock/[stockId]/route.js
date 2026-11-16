import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { requireAdminApi } from "@/lib/auth";

export async function DELETE(_req, { params }) {
  const { id, stockId } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const item = await prisma.gameAccountStockItem.findUnique({ where: { id: stockId } });
  if (!item || item.gameAccountId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (item.status !== "AVAILABLE") {
    return NextResponse.json(
      { error: "Can't remove a unit that's already been sold/assigned to an order." },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.gameAccountStockItem.delete({ where: { id: stockId } }),
    prisma.gameAccount.update({ where: { id: id }, data: { stock: { decrement: 1 } } }),
  ]);

  await writeAudit({
    action: "game-account.stock.remove",
    targetType: "gameAccount",
    targetId: id,
    details: { stockId: stockId },
  });

  return NextResponse.json({ ok: true });
}
