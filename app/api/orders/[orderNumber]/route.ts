import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { syncSupplierOrder } from "@/lib/fulfillment";
import { getCurrentUserRecord } from "@/lib/userAuth";
import { isGiftcardGame } from "@/lib/utils";
import { getClientIp } from "@/lib/clientIp";

// Customer-facing order status endpoint — polled by the checkout page while
// a payment is pending. (Invoice PDF generation lives separately at
// /api/orders/[orderNumber]/invoice — this file used to be an accidental
// duplicate of that and never returned the JSON the checkout page expects.)

const patchSchema = z.object({
  // NOTE: no transactionId here. The payment reference is set by the server
  // when it talks to KHPay (and confirmed by the signed webhook) — letting
  // the browser write it would let a buyer put someone else's (cheaper)
  // transaction ID on their order and hollow out the webhook's cross-check.
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const orderNumber = (await params).orderNumber.toUpperCase();
  // Generous limit — the checkout page legitimately polls this every 3s
  // while a payment is pending, so this needs headroom for normal use.
  // It doesn't return credentials (unlike the account-orders route), so a
  // looser limit here is fine; it still rules out large-scale enumeration.
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`order-lookup:topup:${ip}`, 200, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Please wait a bit and try again." }, { status: 429 });
  }

  // Auto top-up still waiting on the supplier? Check on it now (no-op for
  // every other order).
  const pending = await prisma.order.findUnique({
    where: { orderNumber },
    select: { id: true, status: true },
  });
  if (pending?.status === "PROCESSING") await syncSupplierOrder(pending.id);

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: {
      game: { select: { name: true, slug: true } },
      product: { select: { name: true } },
      items: { select: { name: true, amount: true, bonus: true, quantity: true, unitPriceUsd: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Owner-only: an order number alone (6 characters, guessable) must never
  // reveal order details. Only the signed-in buyer who placed the order may
  // see it — everyone else gets the same 404 as a non-existent order.
  const user = await getCurrentUserRecord();
  if (!user || !order.userId || user.id !== order.userId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // A delivered gift-card code goes to the buyer — we already know the
  // requester IS the buyer (owner-only check above), so no extra check.
  let giftCode: string | null = null;
  // Same codes, grouped per pack so the order page can show "279 Robux"
  // above its codes instead of one long run-on string. The DEMO marker (if
  // any) is stripped from this list and kept on `giftCode`.
  let giftCodes: { label: string; codes: string[] }[] = [];
  if (
    isGiftcardGame(order.game) &&
    order.status === "DELIVERED" &&
    order.deliveryNote?.startsWith("Giftcard code: ")
  ) {
    giftCode = order.deliveryNote.slice("Giftcard code: ".length);

    const raw = giftCode
      .replace(/\s*\[DEMO MODE.*\]$/i, "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    // Codes are created per OrderItem line (product name + quantity), in
    // the same order the items were stored, so pair them up by walking the
    // lines. Any leftover codes go under "Other".
    let i = 0;
    for (const it of order.items) {
      const take = raw.slice(i, i + it.quantity);
      i += it.quantity;
      if (take.length > 0) giftCodes.push({ label: it.name, codes: take });
    }
    if (i < raw.length) giftCodes.push({ label: "Other", codes: raw.slice(i) });
  }

  return NextResponse.json({
    giftCode,
    giftCodes,
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
    // True when the supplier refused the pack because the buyer's account is
    // in a region this pack doesn't serve. The owner already got their money
    // back to their wallet — the page uses this to explain why, instead of
    // showing a generic failure. `failureReason` itself is NOT sent: it can
    // carry internal detail (supplier ids, partial-delivery notes).
    regionMismatch: order.failureReason?.toLowerCase().includes("region mismatch") ?? false,
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
  { params }: { params: Promise<{  orderNumber: string  }> }
) {
  const { orderNumber } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
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

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      ...(parsed.data.paymentUrl ? { paymentUrl: parsed.data.paymentUrl } : {}),
    },
  });

  return NextResponse.json({ ok: true, orderNumber: updated.orderNumber });
}
