/**
 * One-off backfill for the "Auto Top Up" stock pool
 * (GameAccountStockItem is new).
 *
 * Run this ONCE, right after `npm run db:push` (which adds the new
 * GameAccountStockItem table):
 *
 *   npx tsx prisma/scripts/backfill-account-stock-pool.ts
 *
 * Before this change, a "Multiple stock" + Direct-delivery account had a
 * single shared Username/Email + Password saved on it, and every buyer of
 * that listing was handed that exact same login regardless of how many
 * units it said were in stock. There was never more than one real login on
 * file, so there is nothing meaningfully more correct to backfill than:
 * clone that one saved login into `stock` pool rows, so existing listings
 * keep working exactly as before (still just the one shared login) until
 * you use "Auto Top Up" on each to add the real, distinct accounts.
 *
 * Safe to run more than once — it skips accounts that already have stock
 * pool rows.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseCredentials(raw: string | null) {
  const text = raw || "";
  const userMatch = text.match(/^(?:username\/email|username|email)\s*:\s*(.+)$/im);
  const passMatch = text.match(/^password\s*:\s*(.+)$/im);
  const notesMatch = text.match(/^notes\s*:\s*([\s\S]*)$/im);
  return {
    username: userMatch?.[1]?.trim() || "",
    password: passMatch?.[1]?.trim() || "",
    notes: notesMatch?.[1]?.trim() || "",
  };
}

async function main() {
  const accounts = await prisma.gameAccount.findMany({
    where: { stockMode: "MULTI", deliveryMode: "DIRECT" },
    select: { id: true, title: true, stock: true, credentials: true },
  });

  if (accounts.length === 0) {
    console.log("No Multiple-stock + Direct-delivery accounts found — nothing to backfill.");
    return;
  }

  let seeded = 0;
  let skipped = 0;

  for (const acc of accounts) {
    const existingCount = await prisma.gameAccountStockItem.count({ where: { gameAccountId: acc.id } });
    if (existingCount > 0) {
      console.log(`  → "${acc.title}" already has ${existingCount} stock row(s) — skipped.`);
      skipped += 1;
      continue;
    }

    const { username, password, notes } = parseCredentials(acc.credentials);
    const qty = Math.max(0, acc.stock || 0);

    if (!username || !password || qty === 0) {
      console.log(`  → "${acc.title}" has no usable saved login or 0 stock — left empty, use Auto Top Up to add real accounts.`);
      if (qty !== 0) {
        await prisma.gameAccount.update({ where: { id: acc.id }, data: { stock: 0 } });
      }
      continue;
    }

    await prisma.gameAccountStockItem.createMany({
      data: Array.from({ length: qty }, () => ({
        gameAccountId: acc.id,
        username,
        password,
        notes: notes || null,
      })),
    });

    console.log(
      `  → "${acc.title}": seeded ${qty} stock row(s) from its previously shared login. Replace these with real, distinct accounts via Auto Top Up when you can.`
    );
    seeded += 1;
  }

  console.log(`\nDone. Seeded ${seeded} account(s), skipped ${skipped} already-stocked account(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
