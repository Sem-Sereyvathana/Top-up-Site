// Shared rules for promo codes (coupons).

/**
 * True when a coupon may be used on an order whose product IDs are given.
 *
 * A coupon with no `applicableProductId` works on any product, any game.
 * Otherwise at least one product in the order must be exactly the one the
 * admin picked — matched by ID, not name, because package names are generic
 * ("Weekly x2", "Monthly x3" repeat across games) and a name match would
 * leak the discount into the wrong game.
 */
export function promoAppliesToProductIds(
  applicableProductId: string | null | undefined,
  productIds: string[]
): boolean {
  if (!applicableProductId) return true;
  return productIds.some((id) => id === applicableProductId);
}

/**
 * The part of an order a coupon's discount is calculated from.
 *
 * A coupon with no product restriction discounts the whole order. A
 * restricted one discounts only the matching line(s) — so pairing one cheap
 * matching item with expensive unrelated items can't discount the lot.
 * Returns 0 when nothing matches (the coupon then isn't usable at all).
 */
export function promoDiscountBaseUsd(
  applicableProductId: string | null | undefined,
  lines: { productId: string; lineTotalUsd: number }[]
): number {
  if (!applicableProductId) {
    return lines.reduce((sum, line) => sum + line.lineTotalUsd, 0);
  }

  const base = lines
    .filter((line) => line.productId === applicableProductId)
    .reduce((sum, line) => sum + line.lineTotalUsd, 0);

  return Math.round(base * 100) / 100;
}
