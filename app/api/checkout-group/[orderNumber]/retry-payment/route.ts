import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { initiatePayment } from "@/lib/payment";
import { resolvePublicUrl } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rateLimit";
import { getCurrentUserRecord } from "@/lib/userAuth";
import { getClientIp } from "@/lib/clientIp";

// Server-side payment (re)start for a COMBINED multi-store order (GRP-).
// Same job as the per-order retry-payment routes, but the KHPay transaction
// is created against the GROUP total and its payment fields land on the
// group row — the children never see a payment ref of their own.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const { orderNumber } = await params;
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`retry-payment:group:${ip}`, 10, 10 * 60 * 1000, { failClosed: true }))) {
    return NextResponse.json({ error: "Too many requests. Please wait a bit and try again." }, { status: 429 });
  }

  const group = await prisma.paymentGroup.findUnique({
    where: { orderNumber: orderNumber.toUpperCase() },
  });
  if (!group) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Owner-only: only the signed-in buyer may (re)start payment on their own
  // group — checked before any KHPay API call is made.
  const user = await getCurrentUserRecord();
  if (!user || !group.userId || user.id !== group.userId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (group.status !== "PENDING") {
    return NextResponse.json({ error: "Order is no longer pending" }, { status: 409 });
  }
  // Already has a usable KHPay payment — hand it back unchanged.
  if ((group.paymentUrl && /^https:\/\/khpay\.site\//i.test(group.paymentUrl)) || group.qrString) {
    return NextResponse.json({
      paymentUrl: group.paymentUrl,
      qrString: group.qrString,
      paymentExpiresAt: group.paymentExpiresAt,
    });
  }

  const publicUrl = resolvePublicUrl(req.nextUrl.origin);

  try {
    const init = await initiatePayment({
      orderNumber: group.orderNumber,
      amountUsd: group.amountUsd,
      method: "KHPAY",
      returnUrl: `${publicUrl}/order/group?number=${group.orderNumber}`,
      cancelUrl: `${publicUrl}/cart/checkout`,
      callbackUrl: `${publicUrl}/api/payment/webhook/khpay`,
      note: `SHARUSTORE Combined order ${group.orderNumber}`,
      metadata: { order_number: group.orderNumber, kind: "group", group_id: group.id },
    });

    const isKhpayUrl = init.redirectUrl && /^https:\/\/khpay\.site\//i.test(init.redirectUrl);
    await prisma.paymentGroup.update({
      where: { id: group.id },
      data: {
        paymentRef: init.paymentRef || group.paymentRef,
        paymentUrl: isKhpayUrl ? init.redirectUrl : group.paymentUrl,
        qrString: init.qrString || group.qrString,
        paymentExpiresAt: init.expiresAt || group.paymentExpiresAt,
      },
    });

    return NextResponse.json({
      paymentUrl: isKhpayUrl ? init.redirectUrl : group.paymentUrl,
      qrString: init.qrString || group.qrString,
      paymentExpiresAt: init.expiresAt || group.paymentExpiresAt,
    });
  } catch (err) {
    console.error("[retry-payment] group KHPay init failed:", err);
    return NextResponse.json({ error: "Could not start payment. Please try again shortly." }, { status: 502 });
  }
}
