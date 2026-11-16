import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { writeAudit } from "@/lib/audit";
import { fetchKhpayStatus } from "@/lib/payment";
import { awardPointsForOrder } from "@/lib/loyalty";
import { decrementStockForOrder } from "@/lib/stock";
import { finalizeOrderAfterPayment } from "@/lib/fulfillment";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";

/**
 * Admin debug endpoint: pulls the latest KHPay status for an order
 * and, if paid, flips the order to PAID (Roblox/Robux) or DELIVERED
 * (every other game) — same rule as the real webhook, for the case where
 * the webhook itself never arrived and an admin refreshes manually.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const { orderNumber } = await params;
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const order = await prisma.order.findUnique({
    where: { orderNumber: orderNumber },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!order.paymentRef || order.paymentRef.startsWith("SIM-")) {
    return NextResponse.json({ error: "No KHPay reference on order" }, { status: 400 });
  }

  const remote = await fetchKhpayStatus(order.paymentRef);

  let updated = order;
  if (remote && (remote.paid || remote.status === "paid") && order.status === "PENDING") {
    const finalStatus = await finalizeOrderAfterPayment(order.id);
    await awardPointsForOrder(order.id);
    const stockProblem = await decrementStockForOrder(order.id);
    if (stockProblem) {
      await prisma.order.update({
        where: { id: order.id },
        data: { deliveryNote: `PAID but stock problem: ${stockProblem}. Deliver manually or refund.` },
      });
    }
    updated = (await prisma.order.findUnique({ where: { id: order.id } })) ?? order;
    await writeAudit({
      action: "order.khpay_refresh.auto_paid",
      targetType: "order",
      targetId: order.id,
      details: { paymentRef: order.paymentRef, remote, newStatus: finalStatus },
    });
  } else if (
    remote &&
    (remote.status === "expired" || remote.status === "failed") &&
    order.status === "PENDING"
  ) {
    updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: "FAILED", failureReason: `KHPay: ${remote.status}` },
    });
    await writeAudit({
      action: "order.khpay_refresh.auto_failed",
      targetType: "order",
      targetId: order.id,
      details: { paymentRef: order.paymentRef, remote },
    });
  }

  await writeAudit({
    action: "order.khpay_refresh",
    targetType: "order",
    targetId: order.id,
    details: { paymentRef: order.paymentRef, remote },
  });

  return NextResponse.json({ remote, order: updated });
}
