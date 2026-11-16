import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { getCurrentUserRecord } from "@/lib/userAuth";
import { getClientIp } from "@/lib/clientIp";

const patchSchema = z.object({
  // No transactionId — the payment reference is server-set only (see the
  // matching note in app/api/orders/[orderNumber]/route.ts).
  // Hard allowlist: the only payment provider this site uses is KHPay.
  // Accepting an arbitrary URL here would let anyone replace a pending
  // order's payment link with a phishing page (the checkout page
  // auto-redirects to this value).
  paymentUrl: z
    .string()
    .url()
    .refine((u) => /^https:\/\/khpay\.site\//i.test(u), {
      message: "paymentUrl must be a https://khpay.site/ link",
    })
    .optional(),
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
  req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const { orderNumber } = await params;
  // This route can hand back plaintext account credentials once an order
  // is PAID/DELIVERED, keyed only by the order number in the URL — so
  // unlike most public lookups, this one needs a tight limit to make
  // guessing/brute-forcing order numbers impractical.
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`order-lookup:account:${ip}`, 20, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Please wait a bit and try again." }, { status: 429 });
  }

  const order = await prisma.gameAccountOrder.findUnique({
    where: { orderNumber: orderNumber.toUpperCase() },
    include: {
      items: {
        select: {
          id: true,
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

  // Owner-only, CRITICAL: this route hands back plaintext game-account
  // logins/passwords. An order number alone (guessable) must NEVER be
  // enough — only the signed-in buyer who placed the order may see it.
  // Everyone else gets the same 404 as a non-existent order.
  const user = await getCurrentUserRecord();
  if (!user || !order.userId || user.id !== order.userId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status === "PENDING") {
    const expired = await expireIfStale(order.id, order.paymentExpiresAt, order.createdAt);
    if (expired) order.status = "FAILED";
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });

  // Login handover only ever leaves the server once the order is actually
  // paid. Accounts have one delivery mode (delivered automatically on
  // payment — see lib/gameAccountFulfillment.ts), so PAID and DELIVERED both
  // count; anything earlier (PENDING / FAILED / REFUNDED / CANCELLED) never
  // reveals the credentials.
  //
  // The credentials are NOT included in this payload at all. The receipt
  // masks them by default and only fetches them when the buyer presses
  // "Show details" (POST .../items/[itemId]/reveal), which re-checks
  // ownership and payment server-side. Sending them here and hiding them in
  // the UI would put a working login in the browser regardless.
  const canReveal = REVEAL_STATUSES.has(order.status);

  return NextResponse.json({
    orderNumber: order.orderNumber,
    status: order.status,
    items: order.items.map((it) => ({
      // The reveal endpoint is keyed by line id; it's this order's own line
      // (the lookup there is scoped to the order), so it leaks nothing.
      id: it.id,
      title: it.title,
      quantity: it.quantity,
      unitPriceUsd: it.unitPriceUsd,
      // Whether there is a login to reveal — lets the receipt offer "Show
      // details" only when something will actually come back.
      hasCredentials: canReveal && !!formatCredentials(it),
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
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const { orderNumber } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const order = await prisma.gameAccountOrder.findUnique({
    where: { orderNumber: orderNumber.toUpperCase() },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Owner-only: only the signed-in buyer may update the payment reference
  // on their own PENDING order.
  const user = await getCurrentUserRecord();
  if (!user || !order.userId || user.id !== order.userId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status !== "PENDING") {
    return NextResponse.json({ error: "Order is no longer pending" }, { status: 409 });
  }

  const updated = await prisma.gameAccountOrder.update({
    where: { id: order.id },
    data: {
      ...(parsed.data.paymentUrl ? { paymentUrl: parsed.data.paymentUrl } : {}),
    },
  });

  return NextResponse.json({ ok: true, orderNumber: updated.orderNumber });
}
