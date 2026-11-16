import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { getCurrentUserRecord } from "@/lib/userAuth";
import { fromCents } from "@/lib/wallet";
import { NextRequest, NextResponse } from "next/server";

// Wallet top-up status — polled by the wallet page while a KHPay payment is
// pending. Owner-only, like every other order-lookup route.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const { orderNumber } = await params;
  const user = await getCurrentUserRecord();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const topUp = await prisma.walletTopUp.findUnique({
    where: { orderNumber: orderNumber.toUpperCase() },
  });
  if (!topUp || topUp.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    orderNumber: topUp.orderNumber,
    status: topUp.status,
    amountUsd: fromCents(topUp.amountCents),
    paymentUrl: topUp.paymentUrl,
    qrString: topUp.qrString,
    paymentExpiresAt: topUp.paymentExpiresAt,
    paidAt: topUp.paidAt,
  });
}
