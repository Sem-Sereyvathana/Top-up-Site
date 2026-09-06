/**
 * One-off backfill for moving Game Item delivery mode from the category
 * level down to the item level.
 *
 * Run this ONCE, right after `npx prisma db push` (which adds the new
 * GameItem.deliveryMode column — GameItemCategory.deliveryMode is kept
 * around as a deprecated column for now, see the comment on it in
 * prisma/schema.prisma, so no data is at risk here):
 *
 *   npx tsx prisma/scripts/backfill-item-deliverymode.ts
 *
 * For every GameItem, this copies its current category's deliveryMode onto
 * the item (falling back to "DIRECT" for uncategorized items), so nothing
 * you've already configured in the admin panel is lost.
 *
 * Safe to run more than once.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const categories = await prisma.gameItemCategory.findMany({
    select: { id: true, name: true, deliveryMode: true },
  });
  const categoryModeById = new Map(categories.map((c) => [c.id, c.deliveryMode]));

  const items = await prisma.gameItem.findMany({
    select: { id: true, name: true, categoryId: true },
  });

  if (items.length === 0) {
    console.log("No game items found — nothing to backfill.");
    return;
  }

  let updated = 0;
  for (const item of items) {
    const mode = (item.categoryId && categoryModeById.get(item.categoryId)) || "DIRECT";
    await prisma.gameItem.update({
      where: { id: item.id },
      data: { deliveryMode: mode },
    });
    console.log(`  → "${item.name}" set to ${mode}`);
    updated += 1;
  }

  console.log(`\nDone. Backfilled ${updated} item(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
