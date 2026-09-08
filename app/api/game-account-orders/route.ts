import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { generateOrderNumber, calcKhr } from "@/lib/utils";
import { initiatePayment } from "@/lib/payment";
import { resolveDeliveryMode } from "@/lib/deliveryMode";
import { getCurrentUser } from "@/lib/userAuth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Accounts marketplace checkout. Same pattern as game-item-orders, kept on
// its own GameAccountOrder/GameAccountOrderItem tables — never joined
// against GameItemOrder or the Top-up Order model.

const cartItemSchema = z.object({
  gameAccountId: z.string().min(1),
  // Unique-login accounts are still capped at 1 below (there's only ever
  // one login to hand over); multi-stock accounts can go higher, up to
  // whatever's left in stock.
  quantity: z.number().int().min(1).max(20),
});

const createSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(20),
  customerContact: z.string().max(120).optional(),
  paymentMethod: z.enum(["KHPAY"]),
});

// Orders in these statuses still "hold" an account — a second buyer can't
// select it until the first order fails/expires or the account is marked
// delivered/sold elsewhere.
const HOLDING_STATUSES = ["PENDING", "PAID", "DELIVERED"];

export async function POST(req: NextRequest) {
  try {
    const isPublicHttpUrl = (value?: string | null): value is string => {
      if (!value) return false;
      if (!/^https?:\/\//i.test(value)) return false;
      return !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(value);
    };

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const data = parsed.data;
    // Same gameAccountId sent twice in one request (e.g. a double-click
    // race) — merge into a single line rather than creating two order
    // items for the same account.
    const mergedItems = new Map<string, number>();
    for (const it of data.items) {
      mergedItems.set(it.gameAccountId, (mergedItems.get(it.gameAccountId) ?? 0) + it.quantity);
    }
    const ids = Array.from(mergedItems.keys());

    const maintSettings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (maintSettings?.maintenanceMode) {
      return NextResponse.json(
        { error: maintSettings.maintenanceMessage || "Ordering is temporarily disabled for maintenance." },
        { status: 503 }
      );
    }

    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const blocked = await prisma.blockedIdentity.findFirst({
      where: { OR: [{ type: "ip", value: ipAddress.toLowerCase() }] },
    });
    if (blocked) {
      return NextResponse.json(
        { error: "This order cannot be processed. Contact support if you believe this is a mistake." },
        { status: 403 }
      );
    }

    const accounts = await prisma.gameAccount.findMany({
      where: { id: { in: ids } },
      include: { Game: { select: { deliveryMode: true } } },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const uniqueIds: string[] = [];
    const multiIds: string[] = [];

    for (const id of ids) {
      const acc = byId.get(id);
      const qty = mergedItems.get(id)!;
      if (!acc || !acc.active) {
        return NextResponse.json({ error: "One of the selected accounts is no longer available" }, { status: 404 });
      }
      if (acc.stockMode === "MULTI") {
        multiIds.push(id);
        if (qty > acc.stock) {
          return NextResponse.json(
            { error: `Only ${acc.stock} left of "${acc.title}" — lower the quantity and try again` },
            { status: 409 }
          );
        }
      } else {
        uniqueIds.push(id);
        if (acc.sold) {
          return NextResponse.json({ error: `"${acc.title}" was just sold — remove it and try again` }, { status: 409 });
        }
        if (qty > 1) {
          return NextResponse.json({ error: `"${acc.title}" only has one login — quantity can't exceed 1` }, { status: 400 });
        }
      }
    }

    // Reject if a unique-login account is already held by a live order —
    // prevents two buyers both paying for the same login. Multi-stock
    // accounts don't need this per-order hold; their availability is
    // checked against remaining stock (below) instead.
    if (uniqueIds.length) {
      const alreadyHeld = await prisma.gameAccountOrderItem.findFirst({
        where: {
          gameAccountId: { in: uniqueIds },
          order: { status: { in: HOLDING_STATUSES } },
        },
      });
      if (alreadyHeld) {
        return NextResponse.json(
          { error: "One of the selected accounts was just reserved by another buyer — remove it and try again" },
          { status: 409 }
        );
      }
    }

    // For multi-stock accounts, `stock` only ever gets decremented once an
    // order is actually PAID (see lib/gameAccountFulfillment.ts), so other
    // still-pending orders can silently oversell it in the meantime. Guard
    // against that by also subtracting whatever's currently held by live
    // orders from the stock check.
    if (multiIds.length) {
      const held = await prisma.gameAccountOrderItem.groupBy({
        by: ["gameAccountId"],
        where: {
          gameAccountId: { in: multiIds },
          order: { status: { in: HOLDING_STATUSES } },
        },
        _sum: { quantity: true },
      });
      const heldById = new Map(held.map((h) => [h.gameAccountId, h._sum.quantity ?? 0]));
      for (const id of multiIds) {
        const acc = byId.get(id)!;
        const requested = mergedItems.get(id)!;
        const alreadyHeld = heldById.get(id) ?? 0;
        if (requested + alreadyHeld > acc.stock) {
          const remaining = Math.max(0, acc.stock - alreadyHeld);
          return NextResponse.json(
            { error: `Only ${remaining} left of "${acc.title}" right now — lower the quantity and try again` },
            { status: 409 }
          );
        }
      }
    }

    const deliveryMode = resolveDeliveryMode(ids.map((id) => byId.get(id)!.Game?.deliveryMode));

    if (deliveryMode === "MANUAL" && !data.customerContact?.trim()) {
      return NextResponse.json(
        { error: "Please leave a Telegram, phone, or email so we can reach you to arrange handover." },
        { status: 400 }
      );
    }

    const subtotalUsd =
      Math.round(
        ids.reduce((sum, id) => sum + byId.get(id)!.priceUsd * mergedItems.get(id)!, 0) * 100
      ) / 100;

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const exchangeRate = settings?.exchangeRate ?? 4100;
    const orderNumber = generateOrderNumber("AC");
    const userAgent = req.headers.get("user-agent") ?? "unknown";

    // Guest checkout stays fully supported — a session only exists if the
    // buyer happens to be signed in, in which case we tag the order so it
    // shows up in their account History.
    const session = await getCurrentUser();

    const order = await prisma.gameAccountOrder.create({
      data: {
        orderNumber,
        customerContact: data.customerContact?.trim() || undefined,
        amountUsd: subtotalUsd,
        amountKhr: calcKhr(subtotalUsd, exchangeRate),
        paymentMethod: data.paymentMethod,
        deliveryMode,
        status: "PENDING",
        ipAddress,
        userAgent,
        userId: session?.userId,
        items: {
          create: ids.map((id) => ({
            gameAccountId: id,
            title: byId.get(id)!.title,
            quantity: mergedItems.get(id)!,
            unitPriceUsd: byId.get(id)!.priceUsd,
          })),
        },
      },
    });

    const requestOrigin = req.nextUrl.origin;
    const envBase = process.env.NEXT_PUBLIC_BASE_URL;
    const baseUrl = (isPublicHttpUrl(envBase) ? envBase : requestOrigin).replace(/\/$/, "");
    const envPublic = process.env.PUBLIC_APP_URL;
    const publicUrl = (isPublicHttpUrl(envPublic) ? envPublic : baseUrl).replace(/\/$/, "");

    const packageDescription = ids
      .map((id) => {
        const qty = mergedItems.get(id)!;
        return qty > 1 ? `${byId.get(id)!.title} ×${qty}` : byId.get(id)!.title;
      })
      .join(", ");

    let khpayPageUrl: string | null = null;
    try {
      const init = await initiatePayment({
        orderNumber: order.orderNumber,
        amountUsd: order.amountUsd,
        method: data.paymentMethod,
        returnUrl: `${publicUrl}/order/accounts?number=${order.orderNumber}`,
        cancelUrl: `${publicUrl}/accounts`,
        callbackUrl: `${publicUrl}/api/payment/webhook/khpay`,
        note: `SHARUTOPUP · Accounts · ${packageDescription}`,
        metadata: {
          order_number: order.orderNumber,
          kind: "game_account",
        },
      });

      if (init.redirectUrl && /^https:\/\/khpay\.site\//i.test(init.redirectUrl)) {
        khpayPageUrl = init.redirectUrl;
      }

      await prisma.gameAccountOrder.update({
        where: { id: order.id },
        data: {
          paymentRef: init.paymentRef,
          paymentUrl: init.redirectUrl,
          qrString: init.qrString ?? null,
          paymentExpiresAt: init.expiresAt,
        },
      });
    } catch (paymentErr) {
      console.warn(
        "[game-account-orders] Server-side payment init failed, will use client widget:",
        paymentErr instanceof Error ? paymentErr.message : paymentErr
      );
    }

    return NextResponse.json({
      orderNumber: order.orderNumber,
      redirectUrl: khpayPageUrl || `${baseUrl}/checkout/accounts/${order.orderNumber}`,
    });
  } catch (err) {
    console.error("Account order create error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
