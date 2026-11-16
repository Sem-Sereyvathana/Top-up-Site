import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { generateOrderNumber, resolvePublicUrl } from "@/lib/utils";
import { initiatePayment } from "@/lib/payment";
import { getCurrentUserRecord } from "@/lib/userAuth";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { fromCents, verifyLedgerIntegrity } from "@/lib/wallet";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Wallet API: GET = balance + recent transactions; POST = start a wallet
// top-up (one KHPay QR per top-up, credited exactly once by the webhook).

const createTopUpSchema = z.object({
  amountUsd: z.number().positive().max(1000),
});

export async function GET() {
  const user = await getCurrentUserRecord();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const [transactions, integrity] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    verifyLedgerIntegrity(user.id),
  ]);

  return NextResponse.json({
    balanceCents: user.walletCents,
    balanceUsd: fromCents(user.walletCents),
    transactions,
    integrityOk: integrity.ok,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserRecord();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const ip = getClientIp(req);
  // 10 top-up attempts per 10 minutes — same shape as order creation.
  if (!(await checkRateLimit(`wallet-topup:${user.id}`, 10, 10 * 60 * 1000, { failClosed: true }))) {
    return NextResponse.json(
      { error: "Too many top-up attempts. Please wait a bit and try again." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = createTopUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }
  const amountCents = Math.round(parsed.data.amountUsd * 100);
  if (amountCents < 100) {
    return NextResponse.json({ error: "Minimum top-up is $1.00" }, { status: 400 });
  }

  const topUp = await prisma.walletTopUp.create({
    data: {
      orderNumber: generateOrderNumber("WT"),
      userId: user.id,
      amountCents,
      status: "PENDING",
      paymentMethod: "KHPAY",
    },
  });

  const publicUrl = resolvePublicUrl(req.nextUrl.origin);

  try {
    const init = await initiatePayment({
      orderNumber: topUp.orderNumber,
      amountUsd: amountCents / 100,
      method: "KHPAY",
      returnUrl: `${publicUrl}/account/wallet?topup=${topUp.orderNumber}`,
      cancelUrl: `${publicUrl}/account/wallet`,
      callbackUrl: `${publicUrl}/api/payment/webhook/khpay`,
      note: `SHARUSTORE wallet top-up ${topUp.orderNumber}`,
      metadata: { order_number: topUp.orderNumber, kind: "wallet_topup" },
    });

    await prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: {
        paymentRef: init.paymentRef,
        paymentUrl: init.redirectUrl,
        qrString: init.qrString ?? null,
        paymentExpiresAt: init.expiresAt,
      },
    });

    return NextResponse.json({
      orderNumber: topUp.orderNumber,
      paymentUrl: init.redirectUrl,
      qrString: init.qrString ?? null,
    });
  } catch (err) {
    console.error("[wallet] top-up payment init failed:", err);
    await prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: { status: "FAILED" },
    }).catch(() => {});
    return NextResponse.json(
      { error: "Could not start the payment. Please try again shortly." },
      { status: 502 }
    );
  }
}
