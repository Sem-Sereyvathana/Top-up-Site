import { prisma } from "./prisma";
import { isRobuxGame, isQuickLoginGame, isGiftcardGame } from "./utils";

// Revenue & profit reporting (admin Revenue tab).
//
// ═══ POLICY (documented, per operator requirements) ═══
//
// COMPLETED orders:  PAID, PROCESSING, DELIVERED  — counted in revenue.
//   (PAID/PROCESSING have real money taken; excluding them would
//    understate today's sales until someone marks them delivered.)
// EXCLUDED: PENDING (no money yet), FAILED, CANCELLED, REFUNDED — refunded
//   money leaves the business, so counting it would overstate revenue.
//
// PROFIT per order = (price actually paid) − (cost snapshot on the order).
//   - Reseller orders: revenue is what the reseller really paid.
//   - costUsd null (old orders / no cost set): falls back to the CURRENT
//     cost on the product/item and is flagged "estimated" in the UI.
//
// DAY/MONTH boundaries use UTC+7 (Cambodia): a day is 00:00–24:00 ICT.

export const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

export const REVENUE_STATUSES = ["PAID", "PROCESSING", "DELIVERED"] as const;

/** Midnight (UTC+7) of the given date, expressed as a real UTC Date. */
export function startOfUtc7Day(date: Date): Date {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TZ_OFFSET_MS);
}

export function endOfUtc7Day(date: Date): Date {
  const start = startOfUtc7Day(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** First day-of-month midnight (UTC+7) containing `date`. */
export function startOfUtc7Month(date: Date): Date {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MS);
  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TZ_OFFSET_MS);
}

export function endOfUtc7Month(date: Date): Date {
  const start = startOfUtc7Month(date);
  const next = new Date(start.getTime() + TZ_OFFSET_MS);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return new Date(next.getTime() - TZ_OFFSET_MS);
}

export interface CategoryBreakdown {
  key: string;          // "robux-send" | "quick-login" | "giftcard" | "game:<name>" | "items" | "accounts"
  label: string;        // display name
  orders: number;
  revenueUsd: number;
  profitUsd: number;
  estimatedCount: number; // orders whose profit used a current-cost estimate
}

export interface RevenueSummary {
  revenueUsd: number;
  costUsd: number;
  profitUsd: number;
  profitPercent: number | null; // null when revenue is 0
  orders: number;
  estimatedCount: number;
  // Orders left out of the profit figure because no cost was known (old
  // orders, or a supplier cost that was never captured).
  unknownCostCount: number;
  categories: CategoryBreakdown[];
}

function addToCategories(
  categories: Map<string, CategoryBreakdown>,
  key: string,
  label: string,
  revenue: number,
  profit: number | null,
  estimated: boolean
) {
  let cat = categories.get(key);
  if (!cat) {
    cat = { key, label, orders: 0, revenueUsd: 0, profitUsd: 0, estimatedCount: 0 };
    categories.set(key, cat);
  }
  cat.orders += 1;
  cat.revenueUsd += revenue;
  if (profit !== null) cat.profitUsd += profit;
  if (estimated) cat.estimatedCount += 1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Top-up orders (Order table): Robux Send / Quick Login / ML & other games /
 * Giftcard, plus per-game detail for non-robux games.
 */
export async function topupCategoryFor(order: {
  game: { slug: string; name: string; currencyName: string };
}): Promise<{ key: string; label: string }> {
  if (isGiftcardGame(order.game)) return { key: "giftcard", label: "Giftcard" };
  if (isQuickLoginGame(order.game)) return { key: "quick-login", label: "Robux Quick Log-In" };
  if (isRobuxGame(order.game)) return { key: "robux-send", label: "Robux Send" };
  return { key: `game:${order.game.slug}`, label: order.game.name };
}

/** Range aggregation across all three order tables. */
export async function computeRevenueSummary(
  fromUtc: Date,
  toUtc: Date
): Promise<RevenueSummary> {
  const categories = new Map<string, CategoryBreakdown>();

  let revenueUsd = 0;
  let costUsd = 0;
  let orders = 0;
  let estimatedCount = 0;
  // Orders that still have no cost even after falling back to current product
  // cost: excluded from profit, shown as a warning count.
  let unknownCostCount = 0;

  // "Clear revenue" marker: never deletes orders — it records a cutoff, and
  // anything COMPLETED before the newest cutoff is excluded from summaries
  // from then on. Orders keep living normally (refunds, audit trail intact).
  const reset = await prisma.revenueReset.findFirst({
    orderBy: { cutoff: "desc" },
    select: { cutoff: true },
  });
  const clearedBefore = reset?.cutoff ?? null;
  const clearedBy = (order: { paidAt: Date | null; createdAt: Date }): boolean =>
    clearedBefore !== null && (order.paidAt ?? order.createdAt) < clearedBefore;

  // ── Top-up orders ──────────────────────────────────────────────
  const topupOrders = await prisma.order.findMany({
    where: {
      status: { in: [...REVENUE_STATUSES] },
      OR: [
        { paidAt: { gte: fromUtc, lt: toUtc } },
        // Old orders may predate paidAt: fall back to createdAt within range.
        { AND: [{ paidAt: null }, { createdAt: { gte: fromUtc, lt: toUtc } }] },
      ],
    },
    include: { game: true, items: true },
  });

  // Current costs for orders missing a snapshot (estimated profit).
  const missingCostProductIds = [
    ...new Set(
      topupOrders
        .filter((o) => o.costUsd === null)
        .map((o) => (o.items.length > 0 ? o.items[0].productId : o.productId))
    ),
  ];
  const costById = new Map<string, number | null>();
  if (missingCostProductIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: missingCostProductIds } },
      select: { id: true, costUsd: true },
    });
    for (const p of products) costById.set(p.id, p.costUsd);
  }

  for (const o of topupOrders) {
    if (clearedBy(o)) continue; // "Clear revenue" marker — excluded

    const revenue = o.amountUsd;
    let profit: number | null = null;
    let estimated = false;

    let cost = o.costUsd;
    if (cost === null) {
      const pid = o.items.length > 0 ? o.items[0].productId : o.productId;
      const currentCost = pid ? costById.get(pid) ?? null : null;
      if (currentCost !== null) {
        cost = currentCost;
        estimated = true;
      }
    }
    if (cost !== null) {
      profit = round2(revenue - cost);
    }

    revenueUsd += revenue;
    if (cost !== null) costUsd += cost;
    if (estimated) estimatedCount += 1;
    if (cost === null) unknownCostCount += 1; // excluded from profit, warned
    orders += 1;

    const cat = await topupCategoryFor(o);
    addToCategories(categories, cat.key, cat.label, revenue, profit, estimated);
  }

  // ── Game-item orders (GI-) ─────────────────────────────────────
  const itemOrders = await prisma.gameItemOrder.findMany({
    where: {
      status: { in: [...REVENUE_STATUSES] },
      OR: [
        { paidAt: { gte: fromUtc, lt: toUtc } },
        { AND: [{ paidAt: null }, { createdAt: { gte: fromUtc, lt: toUtc } }] },
      ],
    },
    include: { items: true },
  });

  const missingItemIds = [
    ...new Set(itemOrders.filter((o) => o.costUsd === null).flatMap((o) => o.items.map((i) => i.gameItemId))),
  ];
  const itemCostById = new Map<string, number | null>();
  if (missingItemIds.length > 0) {
    const items = await prisma.gameItem.findMany({
      where: { id: { in: missingItemIds } },
      select: { id: true, costUsd: true },
    });
    for (const i of items) itemCostById.set(i.id, i.costUsd);
  }

  for (const o of itemOrders) {
    if (clearedBy(o)) continue; // "Clear revenue" marker — excluded

    const revenue = o.amountUsd;
    let cost = o.costUsd;
    let estimated = false;
    if (cost === null) {
      // Sum per-item current costs × qty as the estimate.
      let est = 0;
      let known = false;
      for (const it of o.items) {
        const c = itemCostById.get(it.gameItemId) ?? null;
        if (c !== null) {
          est += c * it.quantity;
          known = true;
        }
      }
      if (known) {
        cost = round2(est);
        estimated = true;
      }
    }
    const profit = cost !== null ? round2(revenue - cost) : null;

    revenueUsd += revenue;
    if (cost !== null) costUsd += cost;
    if (estimated) estimatedCount += 1;
    if (cost === null) unknownCostCount += 1;
    orders += 1;

    addToCategories(categories, "items", "Game Items", revenue, profit, estimated);
  }

  // ── Account orders (AC-) ───────────────────────────────────────
  const accountOrders = await prisma.gameAccountOrder.findMany({
    where: {
      status: { in: [...REVENUE_STATUSES] },
      OR: [
        { paidAt: { gte: fromUtc, lt: toUtc } },
        { AND: [{ paidAt: null }, { createdAt: { gte: fromUtc, lt: toUtc } }] },
      ],
    },
    include: { items: true },
  });

  const missingAccIds = [
    ...new Set(accountOrders.filter((o) => o.costUsd === null).flatMap((o) => o.items.map((i) => i.gameAccountId))),
  ];
  const accCostById = new Map<string, number | null>();
  if (missingAccIds.length > 0) {
    const accounts = await prisma.gameAccount.findMany({
      where: { id: { in: missingAccIds } },
      select: { id: true, costUsd: true },
    });
    for (const a of accounts) accCostById.set(a.id, a.costUsd);
  }

  for (const o of accountOrders) {
    if (clearedBy(o)) continue; // "Clear revenue" marker — excluded

    const revenue = o.amountUsd;
    let cost = o.costUsd;
    let estimated = false;
    if (cost === null) {
      let est = 0;
      let known = false;
      for (const it of o.items) {
        const c = accCostById.get(it.gameAccountId) ?? null;
        if (c !== null) {
          est += c;
          known = true;
        }
      }
      if (known) {
        cost = round2(est);
        estimated = true;
      }
    }
    const profit = cost !== null ? round2(revenue - cost) : null;

    revenueUsd += revenue;
    if (cost !== null) costUsd += cost;
    if (estimated) estimatedCount += 1;
    if (cost === null) unknownCostCount += 1;
    orders += 1;

    addToCategories(categories, "accounts", "Accounts", revenue, profit, estimated);
  }

  const totalProfit = round2(revenueUsd - round2(costUsd));
  const cats = [...categories.values()]
    .map((c) => ({
      ...c,
      revenueUsd: round2(c.revenueUsd),
      profitUsd: round2(c.profitUsd),
    }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd);

  return {
    revenueUsd: round2(revenueUsd),
    costUsd: round2(costUsd),
    profitUsd: totalProfit,
    profitPercent: revenueUsd > 0 ? round2((totalProfit / revenueUsd) * 100) : null,
    orders,
    estimatedCount,
    // Orders excluded from profit because no cost was known (old orders or
    // supplier cost never captured). The UI shows this as a warning count.
    unknownCostCount: estimatedCount,
    categories: cats,
  };
}

/** Per-day rows for the monthly view (each row uses UTC+7 day bounds). */
export async function computeDailyRows(monthFromUtc: Date, days: number) {
  const rows: { date: string; revenueUsd: number; profitUsd: number; orders: number; profitPercent: number | null }[] = [];
  for (let i = 0; i < days; i++) {
    const from = new Date(monthFromUtc.getTime() + i * 24 * 60 * 60 * 1000);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    if (to.getTime() > Date.now() + 24 * 60 * 60 * 1000) break;
    const s = await computeRevenueSummary(from, to);
    rows.push({
      date: new Date(from.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10),
      revenueUsd: s.revenueUsd,
      profitUsd: s.profitUsd,
      orders: s.orders,
      profitPercent: s.profitPercent,
    });
  }
  return rows;
}
