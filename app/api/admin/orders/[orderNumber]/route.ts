import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { notifyTelegram, escapeHtml } from "@/lib/telegram";
import { awardPointsForOrder, refundRedeemedPointsForOrder } from "@/lib/loyalty";
import { decrementStockForOrder, restoreStockForOrder } from "@/lib/stock";
import { refundOrderToWallet } from "@/lib/wallet";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";

const updateSchema = z.object({
  status: z.enum([
    "PENDING",
    "PAID",
    "PROCESSING",
    "DELIVERED",
    "FAILED",
    "REFUNDED",
    "CANCELLED",
  ]).optional(),
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

  const order = await prisma.order.findUnique({
    where: { orderNumber: orderNumber },
    include: {
      game: true,
      product: true,
      // Only present for multi-package cart orders (Roblox) — see
      // TopUpForm's cart mode / app/api/orders/route.ts.
      items: true,
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

  const order = await prisma.order.findUnique({
    where: { orderNumber: orderNumber },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: any = { ...parsed.data };
  if (parsed.data.status === "DELIVERED" && !order.deliveredAt) {
    data.deliveredAt = new Date();
  }
  if (parsed.data.status === "PAID" && !order.paidAt) {
    data.paidAt = new Date();
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data,
  });

  // Stock counters are decremented with a guard so they never go negative;
  // if the units were already gone, flag it on the order (without clobbering
  // a note the admin typed in this same request).
  const flagStockProblem = async (problem: string | null) => {
    if (!problem || parsed.data.deliveryNote) return;
    await prisma.order.update({
      where: { id: order.id },
      data: { deliveryNote: `PAID but stock problem: ${problem}. Deliver manually or refund.` },
    });
  };

  if (parsed.data.status === "PAID") {
    await awardPointsForOrder(order.id);
    await flagStockProblem(await decrementStockForOrder(order.id));
  } else if (parsed.data.status === "DELIVERED") {
    // Some orders (e.g. manually top-up games like Roblox) get marked
    // DELIVERED directly without ever passing through an explicit PAID
    // step — decrementStockForOrder is idempotent (guarded by the
    // `stockDecremented` flag) so it's safe to call here too.
    await awardPointsForOrder(order.id);
    await flagStockProblem(await decrementStockForOrder(order.id));
  } else if (
    parsed.data.status === "FAILED" ||
    parsed.data.status === "CANCELLED" ||
    parsed.data.status === "REFUNDED"
  ) {
    await refundRedeemedPointsForOrder(order.id);
    await restoreStockForOrder(order.id);
    // Money the customer actually paid returns to their wallet (idempotent
    // per order — repeated status flips can't double-refund).
    await refundOrderToWallet(order);
  }

  if (parsed.data.status && parsed.data.status !== order.status) {
    await writeAudit({
      action: `order.status.${parsed.data.status.toLowerCase()}`,
      targetType: "order",
      targetId: order.orderNumber,
      details: `${order.status} â†’ ${parsed.data.status}`,
    });
    if (parsed.data.status === "DELIVERED" || parsed.data.status === "PAID") {
      await notifyTelegram(
        `âœ… <b>Order ${escapeHtml(parsed.data.status)}</b>\n` +
          `#${escapeHtml(order.orderNumber)} — $${order.amountUsd.toFixed(2)}\n` +
          `UID: <code>${escapeHtml(order.playerUid)}</code>`
      );
    }
  } else if (parsed.data.deliveryNote || parsed.data.failureReason) {
    await writeAudit({
      action: "order.note",
      targetType: "order",
      targetId: order.orderNumber,
      details: parsed.data.deliveryNote || parsed.data.failureReason,
    });
  }

  return NextResponse.json(updated);
}
