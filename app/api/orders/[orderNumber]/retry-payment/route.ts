import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { initiatePayment } from "@/lib/payment";
import { resolvePublicUrl } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rateLimit";
import { getCurrentUserRecord } from "@/lib/userAuth";
import { getClientIp } from "@/lib/clientIp";

// Server-side fallback for when the KHPay call made at order-creation time
// failed (e.g. blocked by Cloudflare). Previously the checkout page handled
// this by fetching the raw KHPAY_API_KEY from GET /api/orders/[orderNumber]
// and calling khpay.site directly from the browser — which meant the real
// payment gateway secret key was sent to every visitor's browser. This route
// does the exact same KHPay call, but from the server, so the key never
// leaves it. The client only ever gets back a payment URL.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const { orderNumber } = await params;
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`retry-payment:topup:${ip}`, 10, 10 * 60 * 1000, { failClosed: true }))) {
    return NextResponse.json({ error: "Too many requests. Please wait a bit and try again." }, { status: 429 });
  }

  const order = await prisma.order.findUnique({
    where: { orderNumber: orderNumber.toUpperCase() },
    include: { game: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Owner-only: only the signed-in buyer may (re)start payment on their own
  // order — and this MUST be checked before any KHPay API call is made.
  const user = await getCurrentUserRecord();
  if (!user || !order.userId || user.id !== order.userId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status !== "PENDING") {
    return NextResponse.json({ error: "Order is no longer pending" }, { status: 409 });
  }
  // Already has a usable KHPay payment — nothing to retry.
  if ((order.paymentUrl && /^https:\/\/khpay\.site\//i.test(order.paymentUrl)) || order.qrString) {
    return NextResponse.json({
      paymentUrl: order.paymentUrl,
      qrString: order.qrString,
      paymentExpiresAt: order.paymentExpiresAt,
    });
  }

  const publicUrl = resolvePublicUrl(req.nextUrl.origin);

  try {
    const init = await initiatePayment({
      orderNumber: order.orderNumber,
      amountUsd: order.amountUsd,
      method: "KHPAY",
      returnUrl: `${publicUrl}/order?number=${order.orderNumber}`,
      cancelUrl: `${publicUrl}/games/${order.game.slug}`,
      callbackUrl: `${publicUrl}/api/payment/webhook/khpay`,
      note: `SHARUSTORE Order ${order.orderNumber}`,
      customerEmail: order.customerEmail || undefined,
      metadata: { order_number: order.orderNumber },
    });

    const isKhpayUrl = init.redirectUrl && /^https:\/\/khpay\.site\//i.test(init.redirectUrl);
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentRef: init.paymentRef || order.paymentRef,
        paymentUrl: isKhpayUrl ? init.redirectUrl : order.paymentUrl,
        qrString: init.qrString || order.qrString,
        paymentExpiresAt: init.expiresAt || order.paymentExpiresAt,
      },
    });

    return NextResponse.json({
      paymentUrl: isKhpayUrl ? init.redirectUrl : order.paymentUrl,
      qrString: init.qrString || order.qrString,
      paymentExpiresAt: init.expiresAt || order.paymentExpiresAt,
    });
  } catch (err) {
    console.error("[retry-payment] KHPay init failed:", err);
    return NextResponse.json({ error: "Could not start payment. Please try again shortly." }, { status: 502 });
  }
}
