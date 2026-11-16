import { prisma } from "@/lib/prisma";
import Link from "next/link";
import MonthlyRevenueChart from "@/components/MonthlyRevenueChart";
import {
  ShoppingBag,
  DollarSign,
  TrendingUp,
  Package,
  ArrowRight,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Dashboard = the old dashboard + the Revenue tab, merged.
//
//   * Three slim "today" tiles that reset every day at 00:00 (UTC+7):
//       - Total orders   — every order placed today
//       - Total revenue  — money actually collected today
//       - Profit         — raw profit across every package sold today,
//                          whatever its status (pending/failed included), so
//                          this is a running business figure, not an
//                          accounting one. Refunded/cancelled are excluded.
//   * Monthly revenue chart (current month, day by day) rendered in the same
//     card style as Recent Orders below it.
//   * Recent Orders table, unchanged.
//
// The separate /admin/revenue page was removed — this replaces it.
//
// Day boundaries use UTC+7 (Cambodia), same as the old Revenue tab.

const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

function startOfDayUtc7(date: Date): Date {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TZ_OFFSET_MS);
}

function startOfMonthUtc7(date: Date): Date {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MS);
  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TZ_OFFSET_MS);
}

// Statuses that represent money actually collected.
const COLLECTED = ["PAID", "PROCESSING", "DELIVERED"];
// Statuses the profit tile counts (everything except refunded/cancelled —
// those never became a sale). Deliberately includes PENDING and FAILED per
// the operator's request: this tile is a daily business overview, not a
// ledger.
const PROFIT_STATUSES = ["PENDING", "PAID", "PROCESSING", "DELIVERED", "FAILED"];

export default async function AdminDashboard() {
  const now = new Date();
  const dayStart = startOfDayUtc7(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const monthStart = startOfMonthUtc7(now);

  const [
    todayOrders,
    todayCollected,
    todayProfitOrders,
    recentOrders,
    monthOrders,
  ] = await Promise.all([
    // Total orders placed today — "placed" uses createdAt so an order that is
    // still PENDING still counts on the day the customer made it.
    prisma.order.count({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
    }),
    // Revenue actually collected today (paidAt, falling back to createdAt for
    // legacy rows without paidAt).
    prisma.order.aggregate({
      where: {
        status: { in: COLLECTED },
        OR: [
          { paidAt: { gte: dayStart, lt: dayEnd } },
          { AND: [{ paidAt: null }, { createdAt: { gte: dayStart, lt: dayEnd } }] },
        ],
      },
      _sum: { amountUsd: true },
    }),
    // Profit tile: every order of today in PROFIT_STATUSES, with the columns
    // needed to work out per-line profit.
    prisma.order.findMany({
      where: {
        status: { in: PROFIT_STATUSES },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      select: {
        amountUsd: true,
        costUsd: true,
        productId: true,
        items: { select: { productId: true, quantity: true, unitPriceUsd: true } },
      },
    }),
    prisma.order.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: {
        game: { select: { name: true } },
        product: { select: { name: true } },
        items: { select: { amount: true, quantity: true } },
      },
    }),
    // Current month for the chart (profit + revenue per day).
    prisma.order.findMany({
      where: {
        status: { in: PROFIT_STATUSES },
        OR: [
          { paidAt: { gte: monthStart } },
          { AND: [{ paidAt: null }, { createdAt: { gte: monthStart } }] },
        ],
      },
      select: {
        amountUsd: true,
        costUsd: true,
        paidAt: true,
        createdAt: true,
        productId: true,
        items: { select: { productId: true, quantity: true, unitPriceUsd: true } },
      },
    }),
  ]);

  // ── Profit: price paid − cost snapshot ──────────────────────────────
  // Orders with no cost snapshot fall back to the product's CURRENT cost
  // (marked "estimated"), matching the old Revenue tab's rule. Cart orders
  // price per line; single-package orders use amountUsd directly.
  const missingCostIds = [
    ...new Set(
      todayProfitOrders
        .filter((o) => o.costUsd === null)
        .map((o) => (o.items.length > 0 ? o.items[0].productId : o.productId))
    ),
  ];
  const costById = new Map<string, number | null>();
  if (missingCostIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: missingCostIds } },
      select: { id: true, costUsd: true },
    });
    for (const p of products) costById.set(p.id, p.costUsd);
  }

  const profitFor = (o: {
    amountUsd: number;
    costUsd: number | null;
    productId: string;
    items: { productId: string; quantity: number; unitPriceUsd: number }[];
  }): number | null => {
    if (o.costUsd !== null && o.costUsd !== undefined) {
      return o.amountUsd - o.costUsd;
    }
    // No snapshot → estimate from the current product cost.
    const pid = o.items.length > 0 ? o.items[0].productId : o.productId;
    const currentCost = costById.get(pid);
    if (currentCost !== null && currentCost !== undefined && currentCost > 0) {
      const units = o.items.reduce((n, it) => n + it.quantity, 0) || 1;
      return o.amountUsd - currentCost * units;
    }
    return null; // completely unknown — excluded from the tile
  };

  let todayProfit = 0;
  for (const o of todayProfitOrders) {
    const p = profitFor(o);
    if (p !== null) todayProfit += p;
  }

  // ── Monthly daily series ───────────────────────────────────────────
  // Same cost fallback, resolved in one query for the whole month.
  const monthMissingIds = [
    ...new Set(
      monthOrders
        .filter((o) => o.costUsd === null)
        .map((o) => (o.items.length > 0 ? o.items[0].productId : o.productId))
    ),
  ];
  if (monthMissingIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: monthMissingIds } },
      select: { id: true, costUsd: true },
    });
    for (const p of products) costById.set(p.id, p.costUsd);
  }

  const dayKey = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
  const daysInMonth = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const buckets = new Map<string, { date: string; revenue: number; profit: number; orders: number }>();
  for (let i = 0; i < daysInMonth; i++) {
    const d = new Date(monthStart.getTime() + i * 24 * 60 * 60 * 1000);
    buckets.set(dayKey(d), { date: dayKey(d), revenue: 0, profit: 0, orders: 0 });
  }
  for (const o of monthOrders) {
    const when = o.paidAt ?? o.createdAt;
    const b = buckets.get(dayKey(when));
    if (!b) continue;
    // Only collected orders add to revenue; profit counts the same statuses
    // as the tile.
    if (COLLECTED.includes((o as { status?: string }).status ?? "")) b.revenue += o.amountUsd;
    const p = profitFor(o);
    if (p !== null) b.profit += p;
    b.orders += 1;
  }
  const monthly = Array.from(buckets.values());
  const monthTotalRevenue = monthly.reduce((s, d) => s + d.revenue, 0);
  const monthTotalProfit = monthly.reduce((s, d) => s + d.profit, 0);

  const money = (n: number) => `$${n.toFixed(2)}`;

  const tiles = [
    {
      label: "Total Orders",
      sub: "today",
      value: todayOrders.toLocaleString(),
      color: "text-fox-text",
      Icon: ShoppingBag,
    },
    {
      label: "Total Revenue",
      sub: "collected today",
      value: money(todayCollected._sum.amountUsd ?? 0),
      color: "text-fox-primary",
      Icon: DollarSign,
    },
    {
      label: "Profit",
      sub: "all packages today",
      // Negative profit is possible (cost > price) — show it in red.
      value: `${todayProfit < 0 ? "-" : ""}${money(Math.abs(todayProfit))}`,
      color: todayProfit >= 0 ? "text-green-400" : "text-red-400",
      Icon: TrendingUp,
    },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Dashboard</h1>
          <p className="text-fox-muted text-sm">Overview of your SHARUSTORE operation.</p>
        </div>
        <Link href="/admin/orders" className="btn-primary">
          View all orders
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </Link>
      </div>

      {/* Three thin daily tiles — reset at 00:00 (UTC+7). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="card flex items-center justify-between px-4 py-3 transition-colors hover:border-fox-primary/40"
          >
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-fox-muted">{t.label}</div>
              <div className={`font-display text-2xl font-bold leading-tight ${t.color}`}>{t.value}</div>
              <div className="text-[10px] text-fox-muted/70">{t.sub}</div>
            </div>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fox-surface/80 ${t.color}`}>
              <t.Icon className="h-4 w-4" strokeWidth={2} />
            </div>
          </div>
        ))}
      </div>

      {/* Monthly revenue — same card style as Recent Orders below. */}
      <div className="card overflow-hidden mb-8">
        <div className="p-4 sm:p-5 border-b border-fox-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-fox-primary" strokeWidth={2} />
            <h2 className="font-semibold">Monthly Revenue</h2>
            <span className="text-xs text-fox-muted">
              {dayKey(monthStart).slice(0, 7)} · UTC+7
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-fox-muted">
            <span>
              <span className="text-fox-primary font-bold text-sm">{money(monthTotalRevenue)}</span> revenue
            </span>
            <span>
              <span className={`font-bold text-sm ${monthTotalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                {money(monthTotalProfit)}
              </span>{" "}
              profit
            </span>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <MonthlyRevenueChart data={monthly} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-fox-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-fox-primary" strokeWidth={2} />
            <h2 className="font-semibold">Recent Orders</h2>
          </div>
          <Link href="/admin/orders" className="text-sm text-fox-primary hover:underline">See all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-fox-surface text-fox-muted text-[10px] sm:text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 sm:px-5 py-3">Order #</th>
                <th className="text-left px-4 sm:px-5 py-3">Game</th>
                <th className="text-left px-4 sm:px-5 py-3 hidden md:table-cell">Product</th>
                <th className="text-left px-4 sm:px-5 py-3 hidden lg:table-cell">UID</th>
                <th className="text-right px-4 sm:px-5 py-3">Amount</th>
                <th className="text-left px-4 sm:px-5 py-3">Status</th>
                <th className="text-left px-4 sm:px-5 py-3 hidden md:table-cell">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fox-border">
              {recentOrders.map((o) => (
                <tr key={o.id} className="hover:bg-fox-surface/50 transition-colors">
                  <td className="px-4 sm:px-5 py-3">
                    <Link href={`/admin/orders/${o.orderNumber}`} className="font-mono text-fox-primary hover:underline text-xs sm:text-sm">
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 sm:px-5 py-3 text-xs sm:text-sm">{o.game.name}</td>
                  <td className="px-4 sm:px-5 py-3 text-fox-muted text-xs sm:text-sm hidden md:table-cell">
                    {o.items && o.items.length > 0
                      ? `${o.items.reduce((sum, it) => sum + Math.max(0, it.amount) * it.quantity, 0).toLocaleString()} Robux (${o.items.length} pkgs)`
                      : o.product.name}
                  </td>
                  <td className="px-4 sm:px-5 py-3 font-mono text-xs hidden lg:table-cell">{o.playerUid}</td>
                  <td className="px-4 sm:px-5 py-3 text-right font-mono text-xs sm:text-sm">${o.amountUsd.toFixed(2)}</td>
                  <td className="px-4 sm:px-5 py-3">
                    <StatusPill status={o.status} />
                  </td>
                  <td className="px-4 sm:px-5 py-3 text-fox-muted text-xs hidden md:table-cell">
                    {new Date(o.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {recentOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Package className="h-10 w-10 text-fox-muted/30 mx-auto mb-3" />
                    <p className="text-fox-muted mb-1">No orders yet</p>
                    <p className="text-xs text-fox-muted/60">Orders will appear here once customers start purchasing.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
    PAID: "bg-blue-400/10 text-blue-400 border-blue-400/30",
    PROCESSING: "bg-blue-400/10 text-blue-400 border-blue-400/30",
    DELIVERED: "bg-green-400/10 text-green-400 border-green-400/30",
    FAILED: "bg-red-400/10 text-red-400 border-red-400/30",
    REFUNDED: "bg-fox-muted/10 text-fox-muted border-fox-border",
    CANCELLED: "bg-fox-muted/10 text-fox-muted border-fox-border",
  };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${colors[status] || ""}`}>
      {status}
    </span>
  );
}
