import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateSchema = z.object({
  status: z.enum(["PENDING", "PAID", "DELIVERED", "FAILED", "REFUNDED", "CANCELLED"]).optional(),
  deliveryNote: z.string().optional(),
  failureReason: z.string().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  const order = await prisma.gameItemOrder.findUnique({
    where: { orderNumber: params.orderNumber },
    include: { items: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const order = await prisma.gameItemOrder.findUnique({ where: { orderNumber: params.orderNumber } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: any = { ...parsed.data };
  if (parsed.data.status === "DELIVERED" && !order.deliveredAt) data.deliveredAt = new Date();
  if (parsed.data.status === "PAID" && !order.paidAt) data.paidAt = new Date();

  const updated = await prisma.gameItemOrder.update({ where: { id: order.id }, data });

  await writeAudit({
    action: "game-item-order.update",
    targetType: "gameItemOrder",
    targetId: order.id,
    details: parsed.data,
  });

  return NextResponse.json(updated);
}
