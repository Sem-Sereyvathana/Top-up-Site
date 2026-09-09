import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";

// Customer-facing order status endpoint — polled by the checkout page while
// a payment is pending. (Invoice PDF generation lives separately at
// /api/orders/[orderNumber]/invoice — this file used to be an accidental
// duplicate of that and never returned the JSON the checkout page expects.)

const patchSchema = z.object({
  transactionId: z.string().optional(),
  paymentUrl: z.string().url().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  // Generous limit — the checkout page legitimately polls this every 3s
  // while a payment is pending, so this needs headroom for normal use.
  // It doesn't return credentials (unlike the account-orders route), so a
  // looser limit here is fine; it still rules out large-scale enumeration.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`order-lookup:topup:${ip}`, 200, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Please wait a bit and try again." }, { status: 429 });
  }

  const order = await prisma.order.findUnique({
    where: { orderNumber: params.orderNumber.toUpperCase() },
    include: {
      game: { select: { name: true, slug: true } },
      product: { select: { name: true } },
      items: { select: { name: true, amount: true, bonus: true, quantity: true, unitPriceUsd: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({
    orderNumber: order.orderNumber,
    status: order.status,
    gameName: order.game.name,
    gameSlug: order.game.slug,
    productName: order.product.name,
    items: order.items,
    playerUid: order.playerUid,
    serverId: order.serverId,
    amountUsd: order.amountUsd,
    amountKhr: order.amountKhr,
    paymentMethod: order.paymentMethod,
    paymentRef: order.paymentRef,
    paymentUrl: order.paymentUrl,
    qrString: order.qrString,
    paymentExpiresAt: order.paymentExpiresAt,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    // Only handed to the client so it can fall back to creating the KHPay
    // transaction itself when our server-side call gets blocked — never
    // used for anything other than this specific PENDING-order flow.
  });
}

// Used only by the checkout page itself, while an order is still PENDING, to
// record the KHPay transaction it created client-side after our server-side
// attempt failed (e.g. blocked by Cloudflare). This is intentionally much
// narrower than the admin PATCH at /api/admin/orders/[orderNumber] — it can
// never change order status, amount, or any customer/player field.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { orderNumber: params.orderNumber.toUpperCase() },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "PENDING") {
    return NextResponse.json({ error: "Order is no longer pending" }, { status: 409 });
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      ...(parsed.data.transactionId ? { paymentRef: parsed.data.transactionId } : {}),
      ...(parsed.data.paymentUrl ? { paymentUrl: parsed.data.paymentUrl } : {}),
    },
  });

  return NextResponse.json({ ok: true, orderNumber: updated.orderNumber });
}
