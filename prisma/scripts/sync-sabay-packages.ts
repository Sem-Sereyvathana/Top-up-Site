/**
 * Sync your store's packages + prices with the SabayStore reseller price list
 * (prisma/data/sabaystore-reseller-prices.csv), and link each game / package
 * to the supplier so paid orders are topped up automatically.
 *
 * Run AFTER `npx prisma db push` (adds Game.supplierSlug, Product.supplierOfferId,
 * Order.supplierOrderNumber).
 *
 * A supplier game is matched to one of YOUR games when, in this order:
 *   1. your Game.supplierSlug already equals the supplier slug, or
 *   2. you pass  --link <your-game-slug>=<supplier-slug>, or
 *   3. your Game.slug is in DEFAULT_LINKS below (your current store games), or
 *   4. your Game.slug is exactly the supplier slug (e.g. "blood-strike").
 * Supplier games with no match are listed and skipped — nothing is created.
 *
 * For each matched game, per CSV row:
 *   - an existing package (same supplier offer id, else same name, else same
 *     amount) is UPDATED: name, price = "Your sell price USD", supplier link;
 *     badge / image / stock are left alone
 *   - otherwise a new package is created
 *   - your packages that are not in the supplier list are set inactive
 *     (never deleted — old orders still point at them)
 *
 * Usage (dry run by default — prints what would change, writes nothing):
 *   npm run db:sync-sabay -- --link free-fire=free-fire-my-sg --link mobile-legends=mobile-legends-global
 *   npm run db:sync-sabay -- --apply --link free-fire=free-fire-my-sg ...
 *   npm run db:sync-sabay -- --apply --only free-fire-my-sg      (one supplier game)
 *   npm run db:sync-sabay -- --apply --keep-extra                (don't deactivate your other packages)
 *   npm run db:sync-sabay -- --apply --margin 10                 (sell = supplier cost + 10%, instead of the CSV "Your sell price")
 */
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------- args ----------
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const KEEP_EXTRA = argv.includes("--keep-extra");
const links = new Map<string, string>(); // supplierSlug -> your game slug
let only: string | null = null;
let margin: number | null = null; // percent on top of supplier cost; null = use CSV sell price
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--link" && argv[i + 1]) {
    const [mine, theirs] = argv[++i].split("=");
    if (mine && theirs) links.set(theirs.trim(), mine.trim());
  } else if (argv[i] === "--only" && argv[i + 1]) {
    only = argv[++i].trim();
  } else if (argv[i] === "--margin" && argv[i + 1]) {
    margin = parseFloat(argv[++i]);
    if (!isFinite(margin) || margin < 0) throw new Error("--margin must be a number like 10");
  }
}

// Your store's game slug -> SabayStore game slug. Edit here if you add games.
// (Roblox is not on the supplier, so it is not listed and is never touched.)
// NOTE: mobile-legend-cambodia -> mobile-legends-global is an assumption:
// SabayStore's Cambodian Mobile Legends page is the "Global" one.
const DEFAULT_LINKS: Record<string, string> = {
  "valorant-th": "valorant-th",
  "valorant-philippines": "valorant-ph",
  "valorant-khmer": "valorant-kh",
  "valorant-indonesia": "valorant-id",
  "magic-chess-go-go-global": "magic-chess-go-go-global",
  "free-fire-philippines": "free-fire-ph",
  "free-fire-indonesia": "free-fire-id",
  "free-fire-global": "free-fire-my-sg",
  "mobile-legend-indonesia": "mobile-legends-indonesia",
  "mobile-legend-philippines": "mobile-legends-philippines",
  "mobile-legend-cambodia": "mobile-legends-global",
  "eafc-mobile-khmer": "eafc-mobile-kh",
  "8-ball-pool-global": "8-ball-pool",
  "league-of-legends-khmer": "league-of-legends-kh",
  "pubg-mobile": "pubg-mobile-auto",
};
const defaultLinkFor = (supplierSlug: string) =>
  Object.keys(DEFAULT_LINKS).find((mine) => DEFAULT_LINKS[mine] === supplierSlug);

// ---------- csv ----------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((v) => v !== "")) rows.push(row); }
  return rows;
}

// ---------- supplier game name -> supplier slug ----------
const SLUG_OVERRIDES: Record<string, string> = {
  "Free Fire (KH/MY/SG)": "free-fire-my-sg",
  "PUBG Mobile": "pubg-mobile-auto",
  "Call of Duty Mobile - Garena (SG/MY)": "cod-mobile-garena-sgmy",
};
function supplierSlugFor(gameName: string): string {
  return (
    SLUG_OVERRIDES[gameName] ||
    gameName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  );
}

// "1060 Diamonds" -> 1060, "20 000 Coins" -> 20000, "Weekly Pass" -> 0
function amountFromName(name: string): number {
  const m = name.trim().match(/^(\d{1,3}(?: \d{3})+|\d+)\s+[A-Za-z]/);
  return m ? parseInt(m[1].replace(/\s/g, ""), 10) : 0;
}
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

interface Row { game: string; pkg: string; cost: number; sell: number; offerId: string }

async function main() {
  const file = path.join(process.cwd(), "prisma", "data", "sabaystore-reseller-prices.csv");
  const rows = parseCsv(fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
  const head = rows.shift()!.map((h) => h.trim());
  const ix = (n: string) => head.indexOf(n);
  const [iG, iP, iC, iS, iO] = [ix("Game"), ix("Package"), ix("You pay USD"), ix("Your sell price USD"), ix("Offer ID")];
  if ([iG, iP, iC, iS, iO].some((n) => n < 0)) throw new Error(`Unexpected CSV header: ${head.join(", ")}`);

  // group by supplier game; if an offer id appears twice, keep the row with the
  // higher cost/price so your margin holds whichever variant the supplier bills.
  const byGame = new Map<string, Map<string, Row & { order: number }>>();
  rows.forEach((r, order) => {
    const cost = parseFloat(r[iC]);
    const sell = margin === null ? parseFloat(r[iS]) : Math.ceil(cost * (1 + margin / 100) * 100 - 1e-9) / 100;
    const row: Row = { game: r[iG].trim(), pkg: r[iP].trim(), cost, sell, offerId: r[iO].trim() };
    if (!row.game || !row.pkg || !row.offerId || !(row.sell > 0)) return;
    const slug = supplierSlugFor(row.game);
    const g = byGame.get(slug) ?? new Map();
    const prev = g.get(row.offerId);
    if (!prev || row.cost > prev.cost) g.set(row.offerId, { ...row, order: prev?.order ?? order });
    byGame.set(slug, g);
  });

  const games = await prisma.game.findMany({ include: { products: true } });
  const unmatched: string[] = [];
  let created = 0, updated = 0, deactivated = 0, linkedGames = 0;

  for (const [supplierSlug, offers] of Array.from(byGame.entries())) {
    if (only && only !== supplierSlug) continue;
    const gameName = Array.from(offers.values())[0].game;
    const game =
      games.find((g) => g.supplierSlug === supplierSlug) ||
      (links.has(supplierSlug) ? games.find((g) => g.slug === links.get(supplierSlug)) : undefined) ||
      games.find((g) => g.slug === defaultLinkFor(supplierSlug)) ||
      games.find((g) => g.slug === supplierSlug);
    if (!game) { unmatched.push(`${supplierSlug}  (${gameName})`); continue; }
    linkedGames++;

    console.log(`\n▶ ${game.name}  ⇄  ${supplierSlug}  (${offers.size} supplier packages)`);
    if (APPLY && game.supplierSlug !== supplierSlug) {
      await prisma.game.update({ where: { id: game.id }, data: { supplierSlug } });
    }

    const claimed = new Set<string>();
    const existing = game.products;
    const pickExisting = (o: Row) =>
      existing.find((p) => !claimed.has(p.id) && p.supplierOfferId === o.offerId) ||
      existing.find((p) => !claimed.has(p.id) && norm(p.name) === norm(o.pkg)) ||
      (amountFromName(o.pkg) > 0
        ? existing.find((p) => !claimed.has(p.id) && !p.supplierOfferId && p.amount === amountFromName(o.pkg) && p.bonus === 0)
        : undefined);

    const sorted = Array.from(offers.values()).sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length; i++) {
      const o = sorted[i];
      const data = {
        name: o.pkg,
        amount: amountFromName(o.pkg),
        bonus: 0,
        priceUsd: o.sell,
        supplierOfferId: o.offerId,
        sortOrder: i,
        active: true,
      };
      const p = pickExisting(o);
      if (p) {
        claimed.add(p.id);
        const changed = p.name !== data.name || p.priceUsd !== data.priceUsd || p.supplierOfferId !== data.supplierOfferId || !p.active;
        console.log(`  ${changed ? "~" : "="} ${o.pkg}  ${p.priceUsd !== o.sell ? `$${p.priceUsd} → ` : ""}$${o.sell.toFixed(2)}  [${o.offerId}]`);
        if (changed) updated++;
        if (APPLY) await prisma.product.update({ where: { id: p.id }, data });
      } else {
        console.log(`  + ${o.pkg}  $${o.sell.toFixed(2)}  [${o.offerId}]`);
        created++;
        if (APPLY) await prisma.product.create({ data: { ...data, gameId: game.id } });
      }
    }

    if (!KEEP_EXTRA) {
      for (const p of existing) {
        if (claimed.has(p.id) || !p.active) continue;
        console.log(`  - (inactive) ${p.name}  $${p.priceUsd}  — not in supplier list`);
        deactivated++;
        if (APPLY) await prisma.product.update({ where: { id: p.id }, data: { active: false } });
      }
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (nothing written — add --apply)"}: ` +
    `${linkedGames} games linked, ${created} packages created, ${updated} updated, ${deactivated} set inactive.`);
  if (unmatched.length) {
    console.log(`\nSupplier games with no matching game in your store (skipped):`);
    unmatched.forEach((u) => console.log(`  • ${u}`));
    console.log(`Link one with:  --link <your-game-slug>=<supplier-slug>`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
