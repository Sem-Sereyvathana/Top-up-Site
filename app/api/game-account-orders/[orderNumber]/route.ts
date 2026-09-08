import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const patchSchema = z.object({
  transactionId: z.string().optional(),
  paymentUrl: z.string().url().optional(),
});

const REVEAL_STATUSES = new Set(["PAID", "DELIVERED"]);

// MULTI accounts hand over one real login per unit purchased (see
// lib/gameAccountFulfillment.ts), formatted in the same
// "Username/Email: ...\nPassword: ...\nNotes: ..." shape the single-login
// (UNIQUE) case already uses, so the receipt UI's parser keeps working
// unchanged. Multiple units are joined with a separator the UI splits on.
function formatCredentials(it: {
  gameAccount: { credentials: string | null; stockMode: string };
  stockItems: { username: string; password: string; notes: string | null }[];
}) {
  if (it.gameAccount.stockMode === "MULTI") {
    if (it.stockItems.length === 0) return null;
    return it.stockItems
      .map((s) => {
        const lines = [`Username/Email: ${s.username}`, `Password: ${s.password}`];
        if (s.notes) lines.push(`Notes: ${s.notes}`);
        return lines.join("\n");
      })
      .join("\n---\n");
  }
  return it.gameAccount.credentials;
}

// Nothing flips a PENDING order to FAILED once its payment window passes
// unless KHPay sends an expiry webhook for it — so a buyer re-opening an
// old, abandoned order here would otherwise see it sit as "PENDING"
// forever. Lazily close it out here too, same as the order-creation route,
// so the account it was holding is freed up for a new order.
async function expireIfStale(orderId: string, paymentExpiresAt: Date | null, createdAt: Date) {
  const now = new Date();
  const isStale = paymentExpiresAt
    ? paymentExpiresAt < now
    : now.getTime() - createdAt.getTime() > 30 * 60 * 1000;
  if (!isStale) return false;
  await prisma.gameAccountOrder.updateMany({
    where: { id: orderId, status: "PENDING" },
    data: { status: "FAILED", failureReason: "Payment window expired" },
  });
  return true;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  const order = await prisma.gameAccountOrder.findUnique({
    where: { orderNumber: params.orderNumber.toUpperCase() },
    include: {
      items: {
        select: {
          title: true,
          quantity: true,
          unitPriceUsd: true,
          gameAccount: { select: { credentials: true, stockMode: true } },
          // For MULTI accounts each unit sold is its own real login,
          // assigned to this exact order line once payment cleared — see
          // lib/gameAccountFulfillment.ts.
          stockItems: { select: { username: true, password: true, notes: true } },
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status === "PENDING") {
    const expired = await expireIfStale(order.id, order.paymentExpiresAt, order.createdAt);
    if (expired) order.status = "FAILED";
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });

  // Login handover only ever leaves the server once payment has actually
  // cleared, and only for DIRECT orders — MANUAL orders never expose it,
  // buyers arrange handover with admin over Telegram instead.
  const canReveal = order.deliveryMode === "DIRECT" && REVEAL_STATUSES.has(order.status);

  return NextResponse.json({
    orderNumber: order.orderNumber,
    status: order.status,
    items: order.items.map((it) => ({
      title: it.title,
      quantity: it.quantity,
      unitPriceUsd: it.unitPriceUsd,
      credentials: canReveal ? formatCredentials(it) : null,
    })),
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
    khpayKey: order.status === "PENDING" ? (process.env.KHPAY_API_KEY || null) : null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
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

  const updated = await prisma.gameAccountOrder.update({
    where: { id: order.id },
    data: {
      ...(parsed.data.transactionId ? { paymentRef: parsed.data.transactionId } : {}),
      ...(parsed.data.paymentUrl ? { paymentUrl: parsed.data.paymentUrl } : {}),
    },
  });

  return NextResponse.json({ ok: true, orderNumber: updated.orderNumber });
}
