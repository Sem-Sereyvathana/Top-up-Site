import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { promoAppliesToProductIds, promoDiscountBaseUsd } from "@/lib/promo";

const schema = z.object({
  code: z.string().min(1),
  orderAmountUsd: z.number().positive(),
  // IDs of the product(s) in the cart, so package-restricted coupons can be
  // checked. Matched by ID because package names repeat across games.
  productIds: z.array(z.string().max(60)).max(20).optional(),
  // Per-line totals; a restricted coupon discounts only the matching line(s).
  lineItems: z
    .array(
      z.object({
        productId: z.string().max(60),
        lineTotalUsd: z.number().min(0),
      })
    )
    .max(20)
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Without a limit here, this endpoint is a free oracle for brute-forcing
    // valid promo codes — same tight limit as login/register.
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`promo-validate:${ip}`, 10, 10 * 60 * 1000))) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { code, orderAmountUsd } = parsed.data;
    const promo = await prisma.promoCode.findUnique({
      where: { code: code.toUpperCase().trim() },
    });

    if (!promo || !promo.active) {
      return NextResponse.json({ error: "Invalid promo code" }, { status: 404 });
    }

    if (promo.expiresAt && promo.expiresAt < new Date()) {
      return NextResponse.json({ error: "This promo code has expired" }, { status: 400 });
    }

    if (promo.maxUses > 0 && promo.usedCount >= promo.maxUses) {
      return NextResponse.json({ error: "This promo code has reached its usage limit" }, { status: 400 });
    }

    if (orderAmountUsd < promo.minOrderUsd) {
      return NextResponse.json(
        { error: `Minimum order of $${promo.minOrderUsd.toFixed(2)} required` },
        { status: 400 }
      );
    }

    // Package restriction: the coupon only works when the exact package the
    // admin picked is in the cart. Show its name in the error so the shopper
    // knows what to switch to.
    let restrictedProductName: string | null = null;
    if (promo.applicableProductId) {
      const restrictedProduct = await prisma.product.findUnique({
        where: { id: promo.applicableProductId },
        select: { name: true },
      });
      restrictedProductName = restrictedProduct?.name ?? "the selected package";

      if (!promoAppliesToProductIds(promo.applicableProductId, parsed.data.productIds ?? [])) {
        return NextResponse.json(
          { error: `This promo code only works on "${restrictedProductName}"` },
          { status: 400 }
        );
      }
    }

    // Discount base: a package-restricted coupon discounts only the matching
    // line(s) — otherwise one cheap matching item paired with expensive
    // unrelated ones would discount the whole cart.
    const lineItems: { productId: string; lineTotalUsd: number }[] =
      parsed.data.lineItems ?? [];
    const discountBase = lineItems.length
      ? promoDiscountBaseUsd(promo.applicableProductId, lineItems)
      : orderAmountUsd;

    if (discountBase <= 0) {
      return NextResponse.json(
        { error: `This promo code only works on "${restrictedProductName ?? "the selected package"}"` },
        { status: 400 }
      );
    }

    let discountUsd =
      promo.discountType === "PERCENT"
        ? (discountBase * promo.discountValue) / 100
        : promo.discountValue;

    // Cap discount at what the coupon may actually discount: for a restricted
    // coupon that's the matching line(s), for an unrestricted one the order.
    discountUsd = Math.min(discountUsd, discountBase);
    discountUsd = Math.round(discountUsd * 100) / 100;

    return NextResponse.json({
      valid: true,
      code: promo.code,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      discountUsd,
      finalAmountUsd: Math.round((orderAmountUsd - discountUsd) * 100) / 100,
      // Non-null when the coupon is tied to one package — the storefront
      // shows it and re-validates it if the shopper changes package.
      applicableProductId: promo.applicableProductId ?? null,
      applicableProductName: restrictedProductName,
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
