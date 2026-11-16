import { prisma } from "./prisma";
import { isFazerConfigured, partsFor, readOffers, type FzOfferInfo } from "./fazercards";
import { decidePack } from "./packRule";
import { notifyTelegram, escapeHtml } from "./telegram";
import { syncSupplierOrder } from "./fulfillment";

// Price watcher — same rule as the Telegram bot's profit guard:
//
//     your selling price  -  FazerCards' live cost   >=   minimum profit
//
// A pack that fails the rule (or that FazerCards has run out of) is closed by
// setting its stock to 0, which the storefront shows as sold out and the order
// API refuses. Your selling price is NEVER changed. When the cost comes back
// down (or stock returns) the pack opens again by itself.
//
// Only packs that are ACTIVE and have a supplier offer are looked at. To keep a
// pack closed for good, hide it (active = off) instead of setting stock to 0 —
// a stock of 0 on a watched pack is treated as "closed by the watcher".
//
// Not re-checked at payment time on purpose: a customer who is already paying
// when the cost jumps still gets served (a small, accepted loss).

export interface WatchSummary {
  checked: number;
  closed: string[];
  reopened: string[];
  skippedCategories: string[];
  resumedOrders: number;
}

export async function runFazerWatch(): Promise<WatchSummary> {
  const summary: WatchSummary = { checked: 0, closed: [], reopened: [], skippedCategories: [], resumedOrders: 0 };
  if (!isFazerConfigured()) return summary;

  const products = await prisma.product.findMany({
    where: { active: true, supplierOfferId: { not: null }, game: { active: true, supplierSlug: { not: null } } },
    include: { game: { select: { name: true, supplierSlug: true } } },
  });

  // One FazerCards read per category (and kind), not per pack.
  const cache = new Map<string, Map<string, FzOfferInfo> | null>();
  async function offersFor(category: string, kind: "topup" | "giftcard") {
    const key = `${kind}|${category}`;
    if (!cache.has(key)) {
      try {
        cache.set(key, await readOffers(category, kind));
      } catch (err) {
        console.warn("[fazer-watch] could not read", key, err);
        cache.set(key, null);
        summary.skippedCategories.push(category);
      }
    }
    return cache.get(key)!;
  }

  for (const p of products) {
    let parts;
    try {
      parts = partsFor(p.game.supplierSlug!, p.supplierOfferId!);
    } catch {
      continue; // an offer text we can't read: leave the pack alone
    }
    const costs: (FzOfferInfo | undefined)[] = [];
    let readFailed = false;
    for (const part of parts) {
      const map = await offersFor(part.category, part.kind);
      if (!map) {
        readFailed = true; // FazerCards unreachable: change nothing for this pack
        break;
      }
      costs.push(map.get(part.kind === "giftcard" ? part.cardId : part.offerId));
    }
    if (readFailed) continue;
    summary.checked++;

    const decision = decidePack(p.priceUsd, costs);
    const label = `${p.game.name} — ${p.name}`;
    if (!decision.open && p.stock !== 0) {
      await prisma.product.update({ where: { id: p.id }, data: { stock: 0 } });
      summary.closed.push(`${label}: ${decision.why}`);
    } else if (decision.open && p.stock === 0) {
      await prisma.product.update({ where: { id: p.id }, data: { stock: null } });
      summary.reopened.push(label);
    }
  }

  // Orders still waiting on FazerCards (slow delivery, or a low-balance wait
  // that has since been topped up): give them a nudge. Safe: same keys.
  const waiting = await prisma.order.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: new Date(Date.now() - 60_000) },
      game: { supplierSlug: { not: null } },
    },
    select: { id: true },
    take: 20,
  });
  for (const o of waiting) {
    await syncSupplierOrder(o.id);
    summary.resumedOrders++;
  }

  if (summary.closed.length || summary.reopened.length) {
    const lines: string[] = [];
    if (summary.closed.length) {
      lines.push("🔒 <b>Closed (not profitable / out of stock)</b>", ...summary.closed.map((s) => `• ${escapeHtml(s)}`));
    }
    if (summary.reopened.length) {
      lines.push("🔓 <b>Reopened</b>", ...summary.reopened.map((s) => `• ${escapeHtml(s)}`));
    }
    await notifyTelegram(lines.join("\n")).catch(() => {});
  }
  return summary;
}
