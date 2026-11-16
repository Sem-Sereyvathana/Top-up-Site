import { prisma } from "./prisma";
import { derivedResellerPriceUsd, type RateConfig } from "./resellerRates";

// Reseller pricing for the Top-up storefront (Product-based games).
//
// Rules (operator spec):
//  - A reseller (User.isReseller) pays a DERIVED reseller price on Robux
//    Send and Quick Log-In packages only (rate × amount/100 or rate × face
//    value, capped at the normal price). Every other product charges a
//    reseller the normal price.
//  - Non-resellers always pay priceUsd.
//  - The charge is ALWAYS computed here from DB values — the client never
//    sends prices.

export interface PriceableProduct {
  id: string;
  name?: string;
  amount: number;
  priceUsd: number;
  gameId: string;
  game?: { slug: string; currencyName: string } | null;
  // Legacy per-product override (old pricing page wrote this directly).
  // New code derives reseller prices from rates instead — this field is
  // only honoured by the legacy unitPriceForBuyer below.
  resellerPriceUsd?: number | null;
}

/** Which of the three pricing kinds a product is (drives rate derivation). */
export function productPricingKind(
  product: Pick<PriceableProduct, "gameId">,
  game: { slug: string; currencyName?: string } | null | undefined
): "robux-send" | "quick-login" | "game" {
  const slug = game?.slug ?? "";
  if (slug === "robux-quick-login") return "quick-login";
  // Robux Send = any Robux game except Quick Login and the gift card game
  // (same shape as lib/utils isRobuxGame, but game-shaped).
  if (slug === "roblox" || slug === "robux-send" || (game?.currencyName ?? "").toLowerCase().includes("robux")) {
    if (slug === "robux-giftcard") return "game";
    return "robux-send";
  }
  return "game";
}

/**
 * The unit price this buyer pays for one product. For Robux Send /
 * Quick Log-In with a rate configured, a reseller pays the derived price;
 * everything else falls back to the normal price.
 */
export function unitPriceForBuyerWithRates(
  product: PriceableProduct,
  isReseller: boolean,
  game: { slug: string; currencyName: string } | null | undefined,
  rates: RateConfig
): number {
  if (!isReseller) return product.priceUsd;
  const kind = productPricingKind(product, game);
  const derived = derivedResellerPriceUsd(kind, product.amount, product.priceUsd, rates);
  // No rate set / non-qualifying product -> reseller pays the normal price.
  return derived ?? product.priceUsd;
}

/** Kept for the legacy tests/callers: honours a direct per-product resellerPriceUsd. */
export function unitPriceForBuyer(
  product: PriceableProduct,
  isReseller: boolean
): number {
  if (
    isReseller &&
    product.resellerPriceUsd !== null &&
    product.resellerPriceUsd !== undefined
  ) {
    return product.resellerPriceUsd;
  }
  return product.priceUsd;
}

/**
 * What the same cart would cost a NORMAL customer, for receipt/reporting
 * (the receipt must always show the normal customer price, never the
 * reseller price).
 */
export function normalPriceTotal(
  lines: { product: PriceableProduct; quantity: number }[]
): number {
  const total = lines.reduce(
    (sum, li) => sum + li.product.priceUsd * li.quantity,
    0
  );
  return Math.round(total * 100) / 100;
}

/** What THIS buyer pays for the cart (rate-derived), promo/points applied later. */
export function buyerPriceTotalWithRates(
  lines: { product: PriceableProduct; quantity: number }[],
  isReseller: boolean,
  gamesById: Map<string, { slug: string; currencyName: string }>,
  rates: RateConfig
): number {
  const total = lines.reduce(
    (sum, li) =>
      sum +
      unitPriceForBuyerWithRates(li.product, isReseller, gamesById.get(li.product.gameId), rates) *
        li.quantity,
    0
  );
  return Math.round(total * 100) / 100;
}

/**
 * Fetch the current user's reseller flag (fresh from the DB each request —
 * promoting/demoting must take effect immediately, not on next login).
 */
export async function buyerIsReseller(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isReseller: true, active: true },
  });
  return !!user?.active && !!user.isReseller;
}
