import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { generateOrderNumber, isValidUid, calcKhr, isRobuxGame } from "@/lib/utils";
import { initiatePayment } from "@/lib/payment";
import { getCurrentUser } from "@/lib/userAuth";
import { getPointsSettings } from "@/lib/loyalty";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// A single line in a multi-package cart order. Cart orders are currently
// only allowed for Roblox (enforced below, not here) — every other game
// keeps using the plain `productId` field exactly as before.
const cartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(50),
});

const createOrderSchema = z
  .object({
    gameId: z.string().min(1),
    // Legacy single-package flow — still required for every non-cart order.
    productId: z.string().min(1).optional(),
    // New multi-package cart flow (Roblox only).
    items: z.array(cartItemSchema).min(1).max(10).optional(),
    playerUid: z.string().min(3).max(20),
    serverId: z.string().optional(),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().optional(),
    paymentMethod: z.enum(["KHPAY"]),
    promoCode: z.string().optional(),
    playerNickname: z.string().max(100).optional(),
    // Loyalty points the logged-in user wants to redeem on this order (ignored for guests)
    pointsToRedeem: z.number().int().min(0).optional(),
  })
  .refine((d) => !!d.productId || (d.items && d.items.length > 0), {
    message: "productId or items is required",
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

    // Validate game + product(s) and pricing.
    //
    // Two shapes come through here: the original single-package order
    // (`data.productId`, used by every game exactly as before) and the new
    // multi-package cart order (`data.items`, Roblox only — see TopUpForm's
    // cart mode). Both converge on the same `game`, `product` (the "primary"
    // package for legacy single-product fields/messages) and `lineItems`
    // (what actually gets created as OrderItem rows + charged) so everything
    // below — promo codes, points, order creation, payment init — is shared.
    const isCartOrder = !!data.items && data.items.length > 0;

    let game: Awaited<ReturnType<typeof prisma.game.findUnique>>;
    let product: Awaited<ReturnType<typeof prisma.product.findUnique>>;
    let settings: Awaited<ReturnType<typeof prisma.settings.findUnique>>;
    let lineItems: { product: NonNullable<typeof product>; quantity: number }[] = [];
    let subtotalUsd = 0;

    if (isCartOrder) {
      [game, settings] = await Promise.all([
        prisma.game.findUnique({ where: { id: data.gameId } }),
        prisma.settings.findUnique({ where: { id: 1 } }),
      ]);

      if (!game || !game.active) {
        return NextResponse.json({ error: "Game not found" }, { status: 404 });
      }
      // Multi-package cart checkout is only wired up for Roblox for now.
      // Uses the same isRobuxGame() check as the client (TopUpForm) so the
      // two never drift apart — previously this checked slug === "roblox"
      // only, which rejected carts for any Roblox game whose slug wasn't
      // literally "roblox" even though the client had already shown cart UI.
      if (!isRobuxGame(game)) {
        return NextResponse.json(
          { error: "Selecting multiple packages isn't supported for this game." },
          { status: 400 }
        );
      }

      const ids = data.items!.map((i) => i.productId);
      const found = await prisma.product.findMany({ where: { id: { in: ids } } });
      const byId = new Map(found.map((p) => [p.id, p]));

      for (const it of data.items!) {
        const p = byId.get(it.productId);
        if (!p || !p.active || p.gameId !== game.id) {
          return NextResponse.json({ error: "One of the selected packages is no longer available" }, { status: 404 });
        }
        if (p.stock !== null && p.stock < it.quantity) {
          return NextResponse.json({ error: `"${p.name}" just sold out — remove it and try again` }, { status: 409 });
        }
        lineItems.push({ product: p, quantity: it.quantity });
      }

      // Roblox uses the admin-managed Robux stock as inventory. Check it again
      // on the server so it can't be bypassed by calling the orders API
      // directly — the combined amount across every line must fit.
      const robuxStock = await prisma.robuxStock.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1 },
      });
      const requiredRobux = lineItems.reduce(
        (sum, li) => sum + Math.max(0, li.product.amount) * li.quantity,
        0
      );
      if (requiredRobux > 0 && robuxStock.totalRobux < requiredRobux) {
        return NextResponse.json({ error: "Stock is not enough" }, { status: 409 });
      }

      product = lineItems[0].product;
      subtotalUsd = Math.round(
        lineItems.reduce((sum, li) => sum + li.product.priceUsd * li.quantity, 0) * 100
      ) / 100;
    } else {
      [game, product, settings] = await Promise.all([
        prisma.game.findUnique({ where: { id: data.gameId } }),
        prisma.product.findUnique({ where: { id: data.productId! } }),
        prisma.settings.findUnique({ where: { id: 1 } }),
      ]);

      if (!game || !game.active) {
        return NextResponse.json({ error: "Game not found" }, { status: 404 });
      }
      if (!product || !product.active || product.gameId !== game.id) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
      if (product.stock !== null && product.stock <= 0) {
        return NextResponse.json({ error: "This package is out of stock" }, { status: 409 });
      }

      // Roblox uses the admin-managed Robux stock as inventory. Check it again
      // on the server so a disabled package cannot be bypassed by calling the
      // orders API directly.
      if (isRobuxGame(game)) {
        const robuxStock = await prisma.robuxStock.upsert({
          where: { id: 1 },
          update: {},
          create: { id: 1 },
        });
        const requiredRobux = Math.max(0, product.amount);
        if (product.amount > 0 && robuxStock.totalRobux < requiredRobux) {
          return NextResponse.json({ error: "Stock is not enough" }, { status: 409 });
        }
      }

      subtotalUsd = product.priceUsd;
      lineItems = [{ product, quantity: 1 }];
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
    let finalPrice = subtotalUsd;

    if (data.promoCode) {
      const promo = await prisma.promoCode.findUnique({
        where: { code: data.promoCode.toUpperCase().trim() },
      });
      if (
        promo &&
        promo.active &&
        (!promo.expiresAt || promo.expiresAt >= new Date()) &&
        (promo.maxUses === 0 || promo.usedCount < promo.maxUses) &&
        subtotalUsd >= promo.minOrderUsd
      ) {
        discountUsd =
          promo.discountType === "PERCENT"
            ? (subtotalUsd * promo.discountValue) / 100
            : promo.discountValue;
        discountUsd = Math.min(discountUsd, subtotalUsd);
        discountUsd = Math.round(discountUsd * 100) / 100;
        finalPrice = Math.round((subtotalUsd - discountUsd) * 100) / 100;
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
          // Only multi-package cart orders (Roblox) get a line-item
          // breakdown — every other order leaves this empty, exactly as
          // before.
          ...(isCartOrder
            ? {
                items: {
                  create: lineItems.map((li) => ({
                    productId: li.product.id,
                    name: li.product.name,
                    amount: li.product.amount,
                    bonus: li.product.bonus,
                    quantity: li.quantity,
                    unitPriceUsd: li.product.priceUsd,
                  })),
                },
              }
            : {}),
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

    // For a multi-package cart, describe every line instead of just the
    // primary product — single-package orders (every other game, plus a
    // one-package Roblox order) get exactly the same string as before.
    const packageDescription =
      lineItems.length > 1
        ? lineItems.map((li) => `${li.product.name} x${li.quantity}`).join(", ")
        : product.name;

    let khpayPageUrl: string | null = null;
    try {
      const init = await initiatePayment({
        orderNumber: order.orderNumber,
        amountUsd: order.amountUsd,
        method: data.paymentMethod,
        returnUrl: `${publicUrl}/order?number=${order.orderNumber}`,
        cancelUrl: `${publicUrl}/games/${game.slug}`,
        callbackUrl: `${publicUrl}/api/payment/webhook/khpay`,
        note: `SHARUSTORE · ${game.name} · ${packageDescription}`,
        customerEmail: data.customerEmail,
        metadata: {
          game_slug: game.slug,
          product_name: packageDescription,
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
