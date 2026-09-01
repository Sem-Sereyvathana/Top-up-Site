import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { generateOrderNumber, isValidUid, calcKhr } from "@/lib/utils";
import { initiatePayment } from "@/lib/payment";
import { getCurrentUser } from "@/lib/userAuth";
import { getPointsSettings } from "@/lib/loyalty";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createOrderSchema = z.object({
  gameId: z.string().min(1),
  productId: z.string().min(1),
  playerUid: z.string().min(5).max(20),
  serverId: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  paymentMethod: z.enum(["KHPAY"]),
  promoCode: z.string().optional(),
  playerNickname: z.string().max(100).optional(),
  // Loyalty points the logged-in user wants to redeem on this order (ignored for guests)
  pointsToRedeem: z.number().int().min(0).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const isPublicHttpUrl = (value?: string | null): value is string => {
      if (!value) return false;
      if (!/^https?:\/\//i.test(value)) return false;
      return !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(value);
    };

    const body = await req.json();
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const data = parsed.data;

    if (!isValidUid(data.playerUid)) {
      return NextResponse.json({ error: "Invalid UID format" }, { status: 400 });
    }

    // Maintenance mode blocks new orders site-wide.
    const maintSettings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (maintSettings?.maintenanceMode) {
      return NextResponse.json(
        { error: maintSettings.maintenanceMessage || "Ordering is temporarily disabled for maintenance." },
        { status: 503 }
      );
    }

    // Banlist: block orders from flagged emails, phones, IPs or UIDs.
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const banCandidates = [
      { type: "email", value: data.customerEmail?.toLowerCase() },
      { type: "phone", value: data.customerPhone?.toLowerCase() },
      { type: "ip", value: ipAddress.toLowerCase() },
      { type: "uid", value: data.playerUid.toLowerCase() },
    ].filter((c): c is { type: string; value: string } => !!c.value);

    if (banCandidates.length > 0) {
      const blocked = await prisma.blockedIdentity.findFirst({
        where: { OR: banCandidates.map((c) => ({ type: c.type, value: c.value })) },
      });
      if (blocked) {
        return NextResponse.json(
          { error: "This order cannot be processed. Contact support if you believe this is a mistake." },
          { status: 403 }
        );
      }
    }

    // Validate game + product match and pricing
    const [game, product, settings] = await Promise.all([
      prisma.game.findUnique({ where: { id: data.gameId } }),
      prisma.product.findUnique({ where: { id: data.productId } }),
      prisma.settings.findUnique({ where: { id: 1 } }),
    ]);

    if (!game || !game.active) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }
    if (!product || !product.active || product.gameId !== game.id) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (game.requiresServer && !data.serverId) {
      return NextResponse.json({ error: "Server is required for this game" }, { status: 400 });
    }

    // Create the order
    const orderNumber = generateOrderNumber();
    const userAgent = req.headers.get("user-agent") ?? "unknown";
    const exchangeRate = settings?.exchangeRate ?? 4100;

    // Guest checkout stays fully supported — a session only exists if the
    // shopper is logged in, and only logged-in users can redeem points.
    const session = await getCurrentUser();

    // Promo code handling + order creation in a single transaction to
    // prevent race conditions on the promo usage counter.
    let promoCodeId: string | null = null;
    let discountUsd = 0;
    let finalPrice = product.priceUsd;

    if (data.promoCode) {
      const promo = await prisma.promoCode.findUnique({
        where: { code: data.promoCode.toUpperCase().trim() },
      });
      if (
        promo &&
        promo.active &&
        (!promo.expiresAt || promo.expiresAt >= new Date()) &&
        (promo.maxUses === 0 || promo.usedCount < promo.maxUses) &&
        product.priceUsd >= promo.minOrderUsd
      ) {
        discountUsd =
          promo.discountType === "PERCENT"
            ? (product.priceUsd * promo.discountValue) / 100
            : promo.discountValue;
        discountUsd = Math.min(discountUsd, product.priceUsd);
        discountUsd = Math.round(discountUsd * 100) / 100;
        finalPrice = Math.round((product.priceUsd - discountUsd) * 100) / 100;
        promoCodeId = promo.id;
      }
    }

    // Points redemption — only for logged-in users, on top of any promo
    // discount, capped so the order never goes below $0.
    let pointsRedeemed = 0;
    let pointsDiscountUsd = 0;
    let redeemingUser: { id: string; points: number } | null = null;

    if (session && data.pointsToRedeem && data.pointsToRedeem > 0) {
      const { pointsRedeemRate, minRedeemPoints } = await getPointsSettings();
      const dbUser = await prisma.user.findUnique({ where: { id: session.userId } });

      if (dbUser && dbUser.active && pointsRedeemRate > 0) {
        const requested = Math.min(data.pointsToRedeem, dbUser.points);
        if (requested >= minRedeemPoints) {
          const requestedDiscount = Math.round((requested / pointsRedeemRate) * 100) / 100;
          pointsDiscountUsd = Math.min(requestedDiscount, finalPrice);
          // Recompute the exact points spent for the (possibly capped) discount
          pointsRedeemed = Math.round(pointsDiscountUsd * pointsRedeemRate);
          finalPrice = Math.round((finalPrice - pointsDiscountUsd) * 100) / 100;
          redeemingUser = { id: dbUser.id, points: dbUser.points };
        }
      }
    }

    const order = await prisma.$transaction(async (tx) => {
      if (promoCodeId) {
        await tx.promoCode.update({
          where: { id: promoCodeId },
          data: { usedCount: { increment: 1 } },
        });
      }
      if (redeemingUser && pointsRedeemed > 0) {
        await tx.user.update({
          where: { id: redeemingUser.id },
          data: { points: { decrement: pointsRedeemed } },
        });
      }
      const created = await tx.order.create({
        data: {
          orderNumber,
          gameId: game.id,
          productId: product.id,
          playerUid: data.playerUid,
          serverId: data.serverId,
          playerNickname: data.playerNickname,
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone,
          amountUsd: finalPrice,
          amountKhr: calcKhr(finalPrice, exchangeRate),
          paymentMethod: data.paymentMethod,
          status: "PENDING",
          ipAddress,
          userAgent,
          promoCodeId,
          discountUsd,
          userId: session?.userId,
          pointsRedeemed,
          pointsDiscountUsd,
        },
      });
      if (redeemingUser && pointsRedeemed > 0) {
        await tx.pointsLedger.create({
          data: {
            userId: redeemingUser.id,
            orderId: created.id,
            type: "REDEEM",
            points: -pointsRedeemed,
            note: `Redeemed on ${created.orderNumber}`,
          },
        });
      }
      return created;
    });

    // Initiate payment with the gateway — if it fails (e.g. Cloudflare blocks
    // the server-side request), the order still exists and the checkout page
    // will fall back to the KHPay client-side widget.
    const requestOrigin = req.nextUrl.origin;
    const envBase = process.env.NEXT_PUBLIC_BASE_URL;
    const baseUrl = (isPublicHttpUrl(envBase) ? envBase : requestOrigin).replace(/\/$/, "");
    const envPublic = process.env.PUBLIC_APP_URL;
    const publicUrl = (isPublicHttpUrl(envPublic) ? envPublic : baseUrl).replace(/\/$/, "");

    let khpayPageUrl: string | null = null;
    try {
      const init = await initiatePayment({
        orderNumber: order.orderNumber,
        amountUsd: order.amountUsd,
        method: data.paymentMethod,
        returnUrl: `${publicUrl}/order?number=${order.orderNumber}`,
        cancelUrl: `${publicUrl}/games/${game.slug}`,
        callbackUrl: `${publicUrl}/api/payment/webhook/khpay`,
        note: `RITHTOPUP · ${game.name} · ${product.name}`,
        customerEmail: data.customerEmail,
        metadata: {
          game_slug: game.slug,
          product_name: product.name,
          player_uid: data.playerUid,
        },
      });

      // Capture the KHPay hosted payment page URL (e.g. https://khpay.site/pay/txn_...)
      if (init.redirectUrl && /^https:\/\/khpay\.site\//i.test(init.redirectUrl)) {
        khpayPageUrl = init.redirectUrl;
      }

      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentRef: init.paymentRef,
          paymentUrl: init.redirectUrl,
          qrString: init.qrString ?? null,
          paymentExpiresAt: init.expiresAt,
        },
      });
    } catch (paymentErr) {
      // Server-side KHPay call failed (likely Cloudflare challenge).
      // Order is already created — checkout page will use client-side widget.
      console.warn("[orders] Server-side payment init failed, will use client widget:", paymentErr instanceof Error ? paymentErr.message : paymentErr);
    }

    // If KHPay returned a hosted payment page, redirect there directly.
    // Otherwise fall back to our checkout page (client-side widget).
    return NextResponse.json({
      orderNumber: order.orderNumber,
      redirectUrl: khpayPageUrl || `${baseUrl}/checkout/${order.orderNumber}`,
    });
  } catch (err) {
    console.error("Order create error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
