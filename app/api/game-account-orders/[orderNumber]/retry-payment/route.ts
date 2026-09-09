import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { initiatePayment } from "@/lib/payment";
import { resolvePublicUrl } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rateLimit";

// Server-side equivalent of app/api/orders/[orderNumber]/retry-payment —
// see that file for why this exists (avoids ever sending KHPAY_API_KEY to
// the browser).
export async function POST(
  req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await checkRateLimit(`retry-payment:account:${ip}`, 10, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Please wait a bit and try again." }, { status: 429 });
  }

  const order = await prisma.gameAccountOrder.findUnique({
    where: { orderNumber: params.orderNumber.toUpperCase() },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "PENDING") {
    return NextResponse.json({ error: "Order is no longer pending" }, { status: 409 });
  }
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
      returnUrl: `${publicUrl}/order/accounts?number=${order.orderNumber}`,
      cancelUrl: `${publicUrl}/accounts`,
      callbackUrl: `${publicUrl}/api/payment/webhook/khpay`,
      note: `SHARUSTORE Order ${order.orderNumber}`,
      metadata: { order_number: order.orderNumber },
    });

    const isKhpayUrl = init.redirectUrl && /^https:\/\/khpay\.site\//i.test(init.redirectUrl);
    await prisma.gameAccountOrder.update({
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
