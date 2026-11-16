import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { generateOrderNumber, isValidUid, calcKhr, isRobuxGame, isGiftcardGame, usesRobuxStock } from "@/lib/utils";
import { initiatePayment } from "@/lib/payment";
import { getCurrentUser } from "@/lib/userAuth";
import { getPointsSettings } from "@/lib/loyalty";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { promoAppliesToProductIds, promoDiscountBaseUsd } from "@/lib/promo";
import { buyerIsReseller, buyerPriceTotalWithRates, normalPriceTotal, unitPriceForBuyerWithRates, productPricingKind } from "@/lib/reseller";
import { getResellerRates, derivedCostUsd } from "@/lib/resellerRates";
import { toCents } from "@/lib/wallet";
import { queueTopupReceipt } from "@/lib/receipt";
import { finalizeOrderAfterPayment } from "@/lib/fulfillment";
import { awardPointsForOrder } from "@/lib/loyalty";
import { decrementStockForOrder } from "@/lib/stock";
import { notifyTelegram, escapeHtml } from "@/lib/telegram";
import { lookupGameId } from "@/lib/uidLookup";
import { regionRuleFor, regionAllowed, regionScopeDescription } from "@/lib/regionRules";

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
    // Pay from the wallet balance instead of the KHPay QR. Requires sign-in
    // and a balance covering the full total (no partial wallet+QR).
    payWithWallet: z.boolean().optional(),
  })
  .refine((d) => !!d.productId || (d.items && d.items.length > 0), {
    message: "productId or items is required",
  });

export async function POST(req: NextRequest) {
  try {
    // Sign-in is required to place any order. The browser also checks this
    // first (and opens the sign-in popup), but this is the real lock.
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { error: "Please sign in to continue.", code: "LOGIN_REQUIRED" },
        { status: 401 }
      );
    }

    // Keyed by account, not IP — a real shopper doesn't place more than a
    // handful of orders in 10 minutes, and this is what stops a signed-in
    // bot from spamming pending orders / payment-initiation calls.
    if (!(await checkRateLimit(`create-order:topup:${currentUser.userId}`, 10, 10 * 60 * 1000, { failClosed: true }))) {
      return NextResponse.json(
        { error: "Too many orders placed. Please wait a bit and try again." },
        { status: 429 }
      );
    }

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
    const ipAddress = getClientIp(req);
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
      // Multi-package cart checkout is wired up for the Robux games AND the
      // Robux Giftcard page (you can buy several gift-card packs in one
      // order). Uses the same isRobuxGame()/isGiftcardGame() checks as the
      // client (TopUpForm) so the two never drift apart.
      if (!isRobuxGame(game) && !isGiftcardGame(game)) {
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
          return NextResponse.json({ error: `"${p.name}" អស់ហើយ` }, { status: 409 });
        }
        lineItems.push({ product: p, quantity: it.quantity });
      }

      // Roblox uses the admin-managed Robux stock as inventory. Check it again
      // on the server so it can't be bypassed by calling the orders API
      // directly — the combined amount across every line must fit.
      if (usesRobuxStock(game)) {
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
        return NextResponse.json({ error: "អស់ហើយ" }, { status: 409 });
      }

      // Roblox uses the admin-managed Robux stock as inventory. Check it again
      // on the server so a disabled package cannot be bypassed by calling the
      // orders API directly.
      if (usesRobuxStock(game)) {
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

    // ── Region gate (server-side) ──
    // The top-up form also checks this, but that check is only a courtesy —
    // this is the real lock. FazerCards charges us first and refunds OUR
    // balance when the pack doesn't match the account's region, which leaves
    // the customer's money with us and a manual refund to do. So: confirm
    // the account's region BEFORE creating any order or taking payment.
    //
    // Fails OPEN when the region can't be determined (no rule for this game,
    // checker unavailable, game has no lookup) — a lookup outage must not
    // stop people buying. It fails CLOSED only on a definite mismatch.
    const regionRule = regionRuleFor(game.slug);
    if (regionRule) {
      const lookup = await lookupGameId(game.slug, data.playerUid, data.serverId);
      const allowed = regionAllowed(regionRule, lookup.status === "verified" ? lookup.region : null);
      if (allowed === false) {
        return NextResponse.json(
          {
            error:
              `This account is in ${lookup.status === "verified" ? lookup.region : "another region"}, ` +
              `but ${regionRule.label} packs here are for ${regionScopeDescription(regionRule)}. ` +
              `Please check your ID or contact support.`,
            code: "REGION_MISMATCH",
            region: lookup.status === "verified" ? lookup.region ?? null : null,
            allowedRegions: regionRule.allowedRegions ?? null,
            blockedRegions: regionRule.blockedRegions ?? null,
          },
          { status: 409 }
        );
      }
    }

    // Create the order
    const orderNumber = generateOrderNumber();
    const userAgent = req.headers.get("user-agent") ?? "unknown";
    const exchangeRate = settings?.exchangeRate ?? 4100;

    // Guest checkout stays fully supported — a session only exists if the
    // shopper is logged in, and only logged-in users can redeem points.
    const session = await getCurrentUser();

    // ── Reseller pricing ───────────────────────────────────────────
    // A reseller pays a rate-DERIVED price on Robux Send / Quick Log-In
    // packages only (see lib/resellerRates.ts); every other product charges
    // a reseller the normal price. All amounts are recomputed here from DB
    // values — the client never sends prices. normalSubtotalUsd is what a
    // NON-reseller would pay: it goes on the order for receipts (which must
    // always show the normal price) and profit reporting.
    const isReseller = await buyerIsReseller(session?.userId);
    const gamesById = new Map<string, { slug: string; currencyName: string }>([
      [game.id, { slug: game.slug, currencyName: game.currencyName }],
    ]);
    const rates = isReseller ? await getResellerRates() : null;
    const rateConfig = rates ?? {
      resellerRobuxSendRate: null,
      costRobuxSendRate: null,
      resellerQuickLoginRate: null,
      costQuickLoginRate: null,
    };
    const normalSubtotalUsd = normalPriceTotal(lineItems);
    const buyerSubtotalUsd = isReseller
      ? buyerPriceTotalWithRates(lineItems, true, gamesById, rateConfig)
      : normalSubtotalUsd;
    // Everything downstream (promo min-order check, discount caps, KHR
    // conversion) works on what THIS buyer actually pays.
    subtotalUsd = buyerSubtotalUsd;

    // Promo code handling + order creation in a single transaction to
    // prevent race conditions on the promo usage counter.
    let promoCodeId: string | null = null;
    let promoMaxUses = 0;
    let discountUsd = 0;
    let finalPrice = subtotalUsd;

    // Wallet payment: sign-in required, balance must cover the FULL total
    // (no partial wallet+QR). The actual debit happens inside the order
    // transaction below so an aborted order never loses money.
    const payWithWallet = !!data.payWithWallet && !!session;
    // Supplier-linked games snapshot their real cost at dispatch time
    // (lib/fulfillment.ts) instead of using the admin-set Product.costUsd.
    const isSupplierGame = !!game.supplierSlug && lineItems.every((li) => !!li.product.supplierOfferId);

    if (data.promoCode) {
      const promo = await prisma.promoCode.findUnique({
        where: { code: data.promoCode.toUpperCase().trim() },
      });
      // Package restriction is re-checked here (server-side, from the actual
      // line items) so a restricted coupon can't be applied to any other
      // package by calling this API directly. A restricted coupon's discount
      // is also calculated from only the matching line(s), not the whole cart.
      // Lines use the buyer's own unit prices (reseller prices for resellers)
      // so a percentage coupon discounts what the buyer actually pays.
      const promoLines = lineItems.map((li) => ({
        productId: li.product.id,
        lineTotalUsd:
          unitPriceForBuyerWithRates(li.product, isReseller, game, rateConfig) * li.quantity,
      }));

      if (promo?.applicableProductId && !promoAppliesToProductIds(promo.applicableProductId, promoLines.map((l) => l.productId))) {
        // Fail loudly rather than silently ignoring it — the browser already
        // showed the discounted price, so charging full price here would let
        // the customer discover the mismatch only after paying.
        const restricted = await prisma.product.findUnique({
          where: { id: promo.applicableProductId },
          select: { name: true },
        });
        return NextResponse.json(
          { error: `This promo code only works on "${restricted?.name ?? "the selected package"}". Please remove it or pick that package.` },
          { status: 400 }
        );
      }

      if (
        promo &&
        promo.active &&
        (!promo.expiresAt || promo.expiresAt >= new Date()) &&
        (promo.maxUses === 0 || promo.usedCount < promo.maxUses) &&
        subtotalUsd >= promo.minOrderUsd
      ) {
        const discountBase = promoDiscountBaseUsd(promo.applicableProductId, promoLines);
        discountUsd =
          promo.discountType === "PERCENT"
            ? (discountBase * promo.discountValue) / 100
            : promo.discountValue;
        // A restricted coupon can never discount more than the matching
        // line(s) are worth; an unrestricted one never more than the order.
        discountUsd = Math.min(
          discountUsd,
          promo.applicableProductId ? discountBase : subtotalUsd
        );
        discountUsd = Math.round(discountUsd * 100) / 100;
        finalPrice = Math.round((subtotalUsd - discountUsd) * 100) / 100;
        promoCodeId = promo.id;
        promoMaxUses = promo.maxUses;
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
      // RACE-SAFE promo usage: the pre-transaction check above is only an
      // early filter — between it and here another request could have used
      // the last allowed use. Re-check atomically with a conditional
      // updateMany. Prisma can't compare two columns, so when the promo is
      // capped (maxUses > 0) we bound usedCount < maxUses in the WHERE; an
      // uncapped promo (maxUses === 0) has no bound to enforce. If nothing
      // matched, someone else took the last slot — abort.
      if (promoCodeId) {
        const promoRes = await tx.promoCode.updateMany({
          where:
            promoMaxUses > 0
              ? { id: promoCodeId, active: true, usedCount: { lt: promoMaxUses } }
              : { id: promoCodeId, active: true },
          data: { usedCount: { increment: 1 } },
        });
        if (promoRes.count !== 1) {
          throw new Error("PROMO_EXHAUSTED");
        }
      }

      // RACE-SAFE points: only decrement if the balance is still high enough
      // at commit time. If a parallel request already spent these points,
      // count === 0 and we abort instead of driving the balance negative.
      if (redeemingUser && pointsRedeemed > 0) {
        const ptsRes = await tx.user.updateMany({
          where: { id: redeemingUser.id, active: true, points: { gte: pointsRedeemed } },
          data: { points: { decrement: pointsRedeemed } },
        });
        if (ptsRes.count !== 1) {
          throw new Error("POINTS_INSUFFICIENT");
        }
      }

      // RACE-SAFE wallet payment: conditional debit inside the same
      // transaction — an insufficient balance at commit time aborts the
      // whole order, and two concurrent wallet checkouts can never both
      // spend the same balance. Ledger row written here too, so the
      // balance === ledger-sum invariant holds at every instant.
      let walletDebitCents = 0;
      if (payWithWallet && session) {
        walletDebitCents = Math.round(finalPrice * 100);
        if (walletDebitCents <= 0) {
          throw new Error("WALLET_BAD_AMOUNT");
        }
        const walletRes = await tx.user.updateMany({
          where: { id: session.userId, active: true, walletCents: { gte: walletDebitCents } },
          data: { walletCents: { decrement: walletDebitCents } },
        });
        if (walletRes.count !== 1) {
          throw new Error("WALLET_INSUFFICIENT");
        }
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
          paymentMethod: payWithWallet ? "WALLET" : data.paymentMethod,
          status: payWithWallet ? "PAID" : "PENDING",
          ipAddress,
          userAgent,
          promoCodeId,
          discountUsd,
          userId: session?.userId,
          pointsRedeemed,
          pointsDiscountUsd,
          // ── Reseller + cost snapshots ──────────────────────────
          // What a normal customer would pay (receipts show THIS number,
          // never the reseller price) and whether the buyer paid reseller
          // prices. Cost snapshot: ONLY Robux Send / Quick Log-In have a
          // known cost at purchase (derived from the admin's rates); every
          // other product's cost comes from the live FazerCards price at
          // dispatch (see lib/fulfillment.ts) — for them we snapshot null.
          normalPriceUsd: normalSubtotalUsd,
          isResellerOrder: isReseller,
          ...(isReseller && discountUsd === 0 && normalSubtotalUsd !== buyerSubtotalUsd
            ? { discountUsd: Math.round((normalSubtotalUsd - finalPrice) * 100) / 100 }
            : {}),
          ...(isSupplierGame
            ? {}
            : (() => {
                // Rate-derived cost, per line, only for kinds that qualify.
                const lineCost = lineItems.reduce((sum, li) => {
                  const kind = productPricingKind(li.product, game);
                  const unitCost = derivedCostUsd(kind, li.product.amount, rateConfig);
                  return sum + (unitCost ?? 0) * li.quantity;
                }, 0);
                return lineCost > 0
                  ? { costUsd: Math.round(lineCost * 100) / 100 }
                  : {};
              })()),
          ...(payWithWallet ? { paidAt: new Date() } : {}),
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
                    // The buyer's actual unit price (rate-derived reseller
                    // price for resellers) so line totals always sum to
                    // amountUsd.
                    unitPriceUsd: unitPriceForBuyerWithRates(li.product, isReseller, game, rateConfig),
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
      // Wallet ledger entry (balance was already decremented above). Read
      // the fresh balance inside the transaction so balanceAfter is exact.
      if (walletDebitCents > 0 && session) {
        const walletUser = await tx.user.findUnique({
          where: { id: session.userId },
          select: { walletCents: true },
        });
        await tx.walletTransaction.create({
          data: {
            userId: session.userId,
            type: "PURCHASE",
            amountCents: -walletDebitCents,
            balanceAfterCents: walletUser?.walletCents ?? 0,
            relatedOrderId: created.id,
            note: `Order ${created.orderNumber}`,
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

    // Wallet-paid orders are already PAID: finalize them right here (stock,
    // points, supplier dispatch, receipt) and skip KHPay entirely.
    if (payWithWallet) {
      const finalStatus = await finalizeOrderAfterPayment(order.id, {});
      await awardPointsForOrder(order.id);
      const stockProblem = await decrementStockForOrder(order.id);
      if (stockProblem) {
        await prisma.order.update({
          where: { id: order.id },
          data: { deliveryNote: `PAID but stock problem: ${stockProblem}. Deliver manually or refund.` },
        });
        await notifyTelegram(
          `🚨 <b>Stock short on wallet-paid order ${escapeHtml(order.orderNumber)}</b>\n` +
            `${escapeHtml(stockProblem)}\nCustomer has PAID (wallet). Deliver manually or refund.`
        ).catch(() => {});
      }
      // Proof-channel receipt (outbox; never blocks).
      await queueTopupReceipt(order.id);
      void finalStatus;

      return NextResponse.json({
        orderNumber: order.orderNumber,
        redirectUrl: `${baseUrl}/order?number=${order.orderNumber}`,
      });
    }

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
    // Race guards from the order transaction — the requested points or the
    // promo's last use were taken by a parallel request. Nothing was created
    // (the transaction rolled back), so this is a clean "please retry".
    if (err instanceof Error && err.message === "PROMO_EXHAUSTED") {
      return NextResponse.json(
        { error: "That promo code just reached its usage limit. Please continue without it." },
        { status: 409 }
      );
    }
    if (err instanceof Error && err.message === "POINTS_INSUFFICIENT") {
      return NextResponse.json(
        { error: "Your points balance changed. Please refresh and try again." },
        { status: 409 }
      );
    }
    if (err instanceof Error && err.message === "WALLET_INSUFFICIENT") {
      return NextResponse.json(
        { error: "Your wallet balance is not enough. Please top up or pay with QR." },
        { status: 402 }
      );
    }
    if (err instanceof Error && err.message === "WALLET_BAD_AMOUNT") {
      return NextResponse.json(
        { error: "Invalid wallet payment amount." },
        { status: 400 }
      );
    }
    // Never leak internal error text (Prisma messages can include query
    // fragments and column names) to the browser — log it server-side only.
    console.error("Order create error:", err);
    return NextResponse.json({ error: "Could not create the order. Please try again." }, { status: 500 });
  }
}
