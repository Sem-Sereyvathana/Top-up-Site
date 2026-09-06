import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { generateOrderNumber, calcKhr } from "@/lib/utils";
import { initiatePayment } from "@/lib/payment";
import { resolveDeliveryMode } from "@/lib/deliveryMode";
import { getCurrentUser } from "@/lib/userAuth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Game Items marketplace checkout. Mirrors the shape of /api/orders (Top-up)
// but writes to its own GameItemOrder/GameItemOrderItem tables — see
// prisma/schema.prisma for why these are kept independent.

const cartItemSchema = z.object({
  gameItemId: z.string().min(1),
  quantity: z.number().int().min(1).max(50),
});

const createSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(20),
  buyerUsername: z.string().min(1).max(60),
  customerContact: z.string().max(120).optional(),
  paymentMethod: z.enum(["KHPAY"]),
});

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

    const ids = data.items.map((i) => i.gameItemId);
    const found = await prisma.gameItem.findMany({
      where: { id: { in: ids } },
    });
    const byId = new Map(found.map((it) => [it.id, it]));

    const lineItems: { gameItem: (typeof found)[number]; quantity: number }[] = [];
    for (const it of data.items) {
      const gi = byId.get(it.gameItemId);
      if (!gi || !gi.active) {
        return NextResponse.json({ error: "One of the selected items is no longer available" }, { status: 404 });
      }
      lineItems.push({ gameItem: gi, quantity: it.quantity });
    }

    const deliveryMode = resolveDeliveryMode(
      lineItems.map((li) => li.gameItem.deliveryMode)
    );

    const subtotalUsd =
      Math.round(
        lineItems.reduce((sum, li) => sum + li.gameItem.priceUsd * li.quantity, 0) * 100
      ) / 100;

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const exchangeRate = settings?.exchangeRate ?? 4100;
    const orderNumber = generateOrderNumber("GI");
    const userAgent = req.headers.get("user-agent") ?? "unknown";

    // Guest checkout stays fully supported — a session only exists if the
    // buyer happens to be signed in, in which case we tag the order so it
    // shows up in their account History.
    const session = await getCurrentUser();

    const order = await prisma.gameItemOrder.create({
      data: {
        orderNumber,
        buyerUsername: data.buyerUsername.trim(),
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
          create: lineItems.map((li) => ({
            gameItemId: li.gameItem.id,
            name: li.gameItem.name,
            quantity: li.quantity,
            unitPriceUsd: li.gameItem.priceUsd,
          })),
        },
      },
    });

    const requestOrigin = req.nextUrl.origin;
    const envBase = process.env.NEXT_PUBLIC_BASE_URL;
    const baseUrl = (isPublicHttpUrl(envBase) ? envBase : requestOrigin).replace(/\/$/, "");
    const envPublic = process.env.PUBLIC_APP_URL;
    const publicUrl = (isPublicHttpUrl(envPublic) ? envPublic : baseUrl).replace(/\/$/, "");

    const packageDescription = lineItems
      .map((li) => `${li.gameItem.name} x${li.quantity}`)
      .join(", ");

    let khpayPageUrl: string | null = null;
    try {
      const init = await initiatePayment({
        orderNumber: order.orderNumber,
        amountUsd: order.amountUsd,
        method: data.paymentMethod,
        returnUrl: `${publicUrl}/order/items?number=${order.orderNumber}`,
        cancelUrl: `${publicUrl}/game-items`,
        callbackUrl: `${publicUrl}/api/payment/webhook/khpay`,
        note: `SHARUTOPUP · Game Items · ${packageDescription}`,
        metadata: {
          order_number: order.orderNumber,
          kind: "game_item",
        },
      });

      if (init.redirectUrl && /^https:\/\/khpay\.site\//i.test(init.redirectUrl)) {
        khpayPageUrl = init.redirectUrl;
      }

      await prisma.gameItemOrder.update({
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
        "[game-item-orders] Server-side payment init failed, will use client widget:",
        paymentErr instanceof Error ? paymentErr.message : paymentErr
      );
    }

    return NextResponse.json({
      orderNumber: order.orderNumber,
      redirectUrl: khpayPageUrl || `${baseUrl}/checkout/items/${order.orderNumber}`,
    });
  } catch (err) {
    console.error("Game item order create error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
