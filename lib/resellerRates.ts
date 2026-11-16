import { prisma } from "./prisma";

// Reseller rate engine — the ONE place that knows how Robux Send and Quick
// Log-In reseller prices and costs are derived from the admin's rates.
//
// Rules (operator spec):
//  - ONLY Robux Send and Quick Log-In have admin-set rates. Their reseller
//    price = derived from the rate; their cost = derived from the rate.
//  - EVERY other product (FazerCards top-ups, gift cards, marketplace) has
//    NO reseller price and NO manual cost: resellers pay the normal price,
//    and cost comes from the live FazerCards price snapshotted at dispatch.
//  - A reseller price is CAPPED at the package's normal price — a rate can
//    never make a reseller pay more than a normal customer.
//  - Normal prices are NEVER derived from rates; they stay the per-package
//    table set on the Products admin page.
//  - Rounding is half-up to whole cents.

/** Half-up rounding to whole cents — 0.005 -> 0.01, -0.005 -> -0.01. */
export function roundHalfUpCents(usd: number): number {
  return Math.sign(usd) * Math.round(Math.abs(usd) * 100) / 100;
}

/** Face value of a Quick Log-In package in USD, by its Robux amount. */
const QUICK_LOGIN_FACE_VALUE: Record<number, number> = {
  80: 1,
  160: 2,
  240: 3,
  320: 4,
  500: 5,
  580: 6,
  660: 7,
  740: 8,
  820: 9,
  1000: 10,
  2000: 20,
  10000: 100,
};

export function quickLoginFaceValueUsd(amount: number): number | null {
  return QUICK_LOGIN_FACE_VALUE[amount] ?? null;
}

export interface RateConfig {
  // Robux Send: USD per 100 Robux.
  resellerRobuxSendRate: number | null;
  costRobuxSendRate: number | null;
  // Quick Log-In: multiplier on face value / cents per $1 of face value.
  resellerQuickLoginRate: number | null;
  costQuickLoginRate: number | null;
}

export const RESELLER_ROBUX_SEND_RATE_MIN = 0.01;
export const RESELLER_ROBUX_SEND_RATE_MAX = 2;
export const COST_ROBUX_SEND_RATE_MIN = 0.01;
export const COST_ROBUX_SEND_RATE_MAX = 5;
export const RESELLER_QUICK_LOGIN_RATE_MIN = 0.01;
export const RESELLER_QUICK_LOGIN_RATE_MAX = 2;
export const COST_QUICK_LOGIN_RATE_MIN = 5;
export const COST_QUICK_LOGIN_RATE_MAX = 200;

export function clampRate(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Reseller unit price for one package, derived from the rate.
 * Returns null when no rate is set (reseller then pays the normal price)
 * or when the package doesn't qualify (unknown Quick Log-In face value).
 * NEVER above `normalPriceUsd`.
 */
export function derivedResellerPriceUsd(
  kind: "robux-send" | "quick-login" | "game",
  amount: number,
  normalPriceUsd: number,
  rates: RateConfig
): number | null {
  if (kind === "robux-send") {
    const rate = rates.resellerRobuxSendRate;
    if (rate === null || amount <= 0) return null;
    const derived = roundHalfUpCents((amount / 100) * rate);
    return Math.min(derived, normalPriceUsd);
  }
  if (kind === "quick-login") {
    const rate = rates.resellerQuickLoginRate;
    const face = quickLoginFaceValueUsd(amount);
    if (rate === null || face === null) return null;
    const derived = roundHalfUpCents(face * rate);
    return Math.min(derived, normalPriceUsd);
  }
  return null; // every other product: resellers pay the normal price
}

/**
 * Operator cost for one package, derived from the rate. Returns null when
 * no rate is set or the package doesn't qualify. This is ONLY used for
 * Robux Send / Quick Log-In — supplier products get their real cost at
 * dispatch instead.
 *
 * NOT rounded to whole cents (unlike the reseller price): the spec's worked
 * example keeps full precision (80R QL at 78.12¢/$1 = $0.7812). Rounded to
 * 4 decimals only to kill float noise.
 */
export function derivedCostUsd(
  kind: "robux-send" | "quick-login" | "game",
  amount: number,
  rates: RateConfig
): number | null {
  if (kind === "robux-send") {
    const rate = rates.costRobuxSendRate;
    if (rate === null || amount <= 0) return null;
    return Math.round((amount / 100) * rate * 10000) / 10000;
  }
  if (kind === "quick-login") {
    const rate = rates.costQuickLoginRate;
    const face = quickLoginFaceValueUsd(amount);
    if (rate === null || face === null) return null;
    // Rate is cents per $1 of face value: 78.12 -> $0.7812 per $1.
    return Math.round(((face * rate) / 100) * 10000) / 10000;
  }
  return null;
}

/**
 * Live rate config from Settings (nulls when the admin hasn't set them —
 * every caller must then fall back to normal pricing).
 */
export async function getResellerRates(): Promise<RateConfig> {
  const s = await prisma.settings.findUnique({
    where: { id: 1 },
    select: {
      resellerRobuxSendRate: true,
      costRobuxSendRate: true,
      resellerQuickLoginRate: true,
      costQuickLoginRate: true,
    },
  });
  return {
    resellerRobuxSendRate: s?.resellerRobuxSendRate ?? null,
    costRobuxSendRate: s?.costRobuxSendRate ?? null,
    resellerQuickLoginRate: s?.resellerQuickLoginRate ?? null,
    costQuickLoginRate: s?.costQuickLoginRate ?? null,
  };
}
