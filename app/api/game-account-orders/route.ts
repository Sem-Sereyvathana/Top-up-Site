import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { generateOrderNumber, calcKhr } from "@/lib/utils";
import { initiatePayment } from "@/lib/payment";
import { resolveDeliveryMode } from "@/lib/deliveryMode";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Accounts marketplace checkout. Same pattern as game-item-orders, kept on
// its own GameAccountOrder/GameAccountOrderItem tables — never joined
// against GameItemOrder or the Top-up Order model.

const createSchema = z.object({
  gameAccountIds: z.array(z.string().min(1)).min(1).max(10),
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
    const ids = Array.from(new Set(data.gameAccountIds));

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

    for (const id of ids) {
      const acc = byId.get(id);
      if (!acc || !acc.active) {
        return NextResponse.json({ error: "One of the selected accounts is no longer available" }, { status: 404 });
      }
      if (acc.sold) {
        return NextResponse.json({ error: `"${acc.title}" was just sold — remove it and try again` }, { status: 409 });
      }
    }

    // Reject if any selected account is already held by a live order —
    // prevents two buyers both paying for the same account.
    const alreadyHeld = await prisma.gameAccountOrderItem.findFirst({
      where: {
        gameAccountId: { in: ids },
        order: { status: { in: HOLDING_STATUSES } },
      },
    });
    if (alreadyHeld) {
      return NextResponse.json(
        { error: "One of the selected accounts was just reserved by another buyer — remove it and try again" },
        { status: 409 }
      );
    }

    const deliveryMode = resolveDeliveryMode(ids.map((id) => byId.get(id)!.Game?.deliveryMode));

    if (deliveryMode === "MANUAL" && !data.customerContact?.trim()) {
      return NextResponse.json(
        { error: "Please leave a Telegram, phone, or email so we can reach you to arrange handover." },
        { status: 400 }
      );
    }

    const subtotalUsd =
      Math.round(ids.reduce((sum, id) => sum + byId.get(id)!.priceUsd, 0) * 100) / 100;

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const exchangeRate = settings?.exchangeRate ?? 4100;
    const orderNumber = generateOrderNumber("AC");
    const userAgent = req.headers.get("user-agent") ?? "unknown";

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
        items: {
          create: ids.map((id) => ({
            gameAccountId: id,
            title: byId.get(id)!.title,
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

    const packageDescription = ids.map((id) => byId.get(id)!.title).join(", ");

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
