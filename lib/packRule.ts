import type { FzOfferInfo } from "./fazercards";

// The selling rule of the FazerCards price watcher (see lib/fazerWatch.ts):
//   your selling price - FazerCards' live cost >= minimum profit
// Kept in its own file so it can be tested without a database.

export const MIN_PROFIT_USD = (() => {
  const raw = process.env.FAZER_MIN_PROFIT_USD;
  const v = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(v) && v >= 0 ? v : 0.01;
})();

const micro = (usd: number) => Math.round(usd * 1_000_000);

export type PackDecision = { open: true } | { open: false; why: string };

/** Should this pack be on sale right now? costs = one entry per FazerCards order the pack is made of. */
export function decidePack(
  priceUsd: number,
  costs: (FzOfferInfo | undefined)[],
  minProfitUsd: number = MIN_PROFIT_USD
): PackDecision {
  if (costs.length === 0 || costs.some((c) => !c)) return { open: false, why: "FazerCards doesn't list this offer" };
  const known = costs as FzOfferInfo[];
  if (known.some((c) => c.stock !== null && c.stock <= 0)) return { open: false, why: "out of stock at FazerCards" };
  const cost = known.reduce((sum, c) => sum + micro(c.cost), 0);
  const profit = micro(priceUsd) - cost;
  if (profit < micro(minProfitUsd)) {
    return {
      open: false,
      why: `cost $${(cost / 1e6).toFixed(2)} vs price $${priceUsd.toFixed(2)} (profit $${(profit / 1e6).toFixed(2)}, needs $${minProfitUsd.toFixed(2)})`,
    };
  }
  return { open: true };
}
