/**
 * One-off backfill for moving Account delivery mode from the linked Game
 * down to the account level (GameAccount.deliveryMode is new).
 *
 * Run this ONCE, right after `npx prisma db push` (which adds the new
 * GameAccount.deliveryMode and GameAccount.categoryId columns):
 *
 *   npx tsx prisma/scripts/backfill-account-deliverymode.ts
 *
 * For every GameAccount that's linked to a Game, this copies that Game's
 * current deliveryMode onto the account (falling back to "MANUAL" — the
 * same default the app already used for accounts with no linked Game), so
 * nothing you've already configured in the admin panel changes behaviour.
 *
 * Safe to run more than once.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const games = await prisma.game.findMany({
    select: { id: true, name: true, deliveryMode: true },
  });
  const gameModeById = new Map(games.map((g) => [g.id, g.deliveryMode]));

  const accounts = await prisma.gameAccount.findMany({
    select: { id: true, title: true, gameId: true },
  });

  if (accounts.length === 0) {
    console.log("No accounts found — nothing to backfill.");
    return;
  }

  let updated = 0;
  for (const acc of accounts) {
    const mode = (acc.gameId && gameModeById.get(acc.gameId)) || "MANUAL";
    await prisma.gameAccount.update({
      where: { id: acc.id },
      data: { deliveryMode: mode },
    });
    console.log(`  → "${acc.title}" set to ${mode}`);
    updated += 1;
  }

  console.log(`\nDone. Backfilled ${updated} account(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
