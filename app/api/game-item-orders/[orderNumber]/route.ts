import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";

const patchSchema = z.object({
  transactionId: z.string().optional(),
  paymentUrl: z.string().url().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  // Same reasoning as app/api/orders/[orderNumber]/route.ts — generous
  // limit to allow for legitimate checkout polling, no credentials
  // returned by this route so a looser cap is fine here.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`order-lookup:item:${ip}`, 200, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Please wait a bit and try again." }, { status: 429 });
  }
  const order = await prisma.gameItemOrder.findUnique({
    where: { orderNumber: params.orderNumber.toUpperCase() },
    include: {
      items: { select: { name: true, quantity: true, unitPriceUsd: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });

  return NextResponse.json({
    orderNumber: order.orderNumber,
    status: order.status,
    items: order.items,
    buyerUsername: order.buyerUsername,
    deliveryMode: order.deliveryMode,
    amountUsd: order.amountUsd,
    amountKhr: order.amountKhr,
    paymentMethod: order.paymentMethod,
    paymentRef: order.paymentRef,
    paymentUrl: order.paymentUrl,
    qrString: order.qrString,
    paymentExpiresAt: order.paymentExpiresAt,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    deliveredAt: order.deliveredAt,
    supportTelegram: settings?.supportTelegram ?? null,
  });
}

// Same narrow client-side fallback as /api/orders/[orderNumber] — only lets
// the checkout page record a KHPay transaction it created itself after our
// server-side call was blocked, while the order is still PENDING.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const order = await prisma.gameItemOrder.findUnique({
    where: { orderNumber: params.orderNumber.toUpperCase() },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "PENDING") {
    return NextResponse.json({ error: "Order is no longer pending" }, { status: 409 });
  }

  const updated = await prisma.gameItemOrder.update({
    where: { id: order.id },
    data: {
      ...(parsed.data.transactionId ? { paymentRef: parsed.data.transactionId } : {}),
      ...(parsed.data.paymentUrl ? { paymentUrl: parsed.data.paymentUrl } : {}),
    },
  });

  return NextResponse.json({ ok: true, orderNumber: updated.orderNumber });
}
