/**
 * One-off backfill for the Game Items category split.
 *
 * Run this ONCE, right after `npx prisma db push` (which adds the new
 * GameItemCategory table and GameItem.categoryId column).
 *
 * For every GameItem that currently points at a Top-up `Game` (gameId),
 * this creates a matching GameItemCategory (same name/slug/image) if one
 * doesn't already exist, and sets categoryId on that item. Items with no
 * gameId are left uncategorized ("General") — nothing to do there.
 *
 * Safe to run more than once (it only creates a category per game the
 * first time, and re-running just re-points already-correct items).
 *
 * Usage:
 *   npx tsx prisma/scripts/backfill-item-categories.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "category";
  let candidate = root;
  let n = 2;
  while (await prisma.gameItemCategory.findUnique({ where: { slug: candidate } })) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

async function main() {
  const itemsWithGame = await prisma.gameItem.findMany({
    where: { gameId: { not: null } },
    include: { Game: true },
  });

  if (itemsWithGame.length === 0) {
    console.log("No game-linked items found — nothing to backfill.");
    return;
  }

  const gameIdToCategoryId = new Map<string, string>();

  for (const item of itemsWithGame) {
    if (!item.Game) continue;

    let categoryId = gameIdToCategoryId.get(item.Game.id);

    if (!categoryId) {
      // Re-running the script should reuse a category made from a
      // previous run rather than creating a duplicate.
      const existing = await prisma.gameItemCategory.findUnique({
        where: { slug: item.Game.slug },
      });

      const category =
        existing ??
        (await prisma.gameItemCategory.create({
          data: {
            name: item.Game.name,
            slug: await uniqueSlug(item.Game.name),
            imageUrl: item.Game.imageUrl,
            sortOrder: item.Game.sortOrder,
          },
        }));

      categoryId = category.id;
      gameIdToCategoryId.set(item.Game.id, categoryId);
      console.log(`Category ready: "${category.name}" (${category.id})`);
    }

    await prisma.gameItem.update({
      where: { id: item.id },
      data: { categoryId },
    });
    console.log(`  → item "${item.name}" linked to category ${categoryId}`);
  }

  console.log(`\nDone. Backfilled ${itemsWithGame.length} item(s) across ${gameIdToCategoryId.size} categor${gameIdToCategoryId.size === 1 ? "y" : "ies"}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
