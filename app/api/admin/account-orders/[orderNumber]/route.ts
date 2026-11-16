import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";

const updateSchema = z.object({
  status: z.enum(["PENDING", "PAID", "DELIVERED", "FAILED", "REFUNDED", "CANCELLED"]).optional(),
  deliveryNote: z.string().optional(),
  failureReason: z.string().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const { orderNumber } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const order = await prisma.gameAccountOrder.findUnique({
    where: { orderNumber: orderNumber },
    include: {
      items: {
        include: {
          gameAccount: { select: { credentials: true, title: true, stockMode: true } },
          // Which real login(s) this line actually got handed, for MULTI
          // accounts — see lib/gameAccountFulfillment.ts.
          stockItems: { select: { username: true, password: true, notes: true } },
        },
      },
    },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const { orderNumber } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const order = await prisma.gameAccountOrder.findUnique({ where: { orderNumber: orderNumber } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: any = { ...parsed.data };
  if (parsed.data.status === "DELIVERED" && !order.deliveredAt) data.deliveredAt = new Date();
  if (parsed.data.status === "PAID" && !order.paidAt) data.paidAt = new Date();

  const updated = await prisma.gameAccountOrder.update({ where: { id: order.id }, data });

  await writeAudit({
    action: "game-account-order.update",
    targetType: "gameAccountOrder",
    targetId: order.id,
    details: parsed.data,
  });

  return NextResponse.json(updated);
}
