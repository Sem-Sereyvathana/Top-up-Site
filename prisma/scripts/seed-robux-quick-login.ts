/**
 * Creates the "Robux Quick Login" game page + its packages.
 *
 * Safe to run more than once: the game is upserted by slug and a package is
 * only created if one with the same Robux amount doesn't exist yet, so it
 * never overwrites prices you've already changed in the admin panel.
 *
 * After running it, manage everything in the admin panel:
 *   Admin -> Products  (pick "Robux Quick Login") to change prices / hide packages
 *   Admin -> Games     to change the image, banner, name or switch the page off
 *
 * Usage:
 *   npx tsx prisma/scripts/seed-robux-quick-login.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SLUG = "robux-quick-login";

// [robux, priceUsd] — from the Quick Login price poster.
const PACKAGES: [number, number][] = [
  [80, 0.9],
  [160, 1.8],
  [240, 2.7],
  [320, 3.6],
  [500, 4.4],
  [580, 5.3],
  [660, 6.2],
  [740, 7.1],
  [820, 8.0],
  [1000, 8.7],
  [2000, 17.4],
  [10000, 85.0],
];

async function main() {
  // Borrow the existing Roblox game's artwork until you upload a new one.
  const roblox = await prisma.game.findUnique({ where: { slug: "roblox" } });

  const game = await prisma.game.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
      slug: SLUG,
      name: "Robux Quick Login",
      publisher: "Roblox",
      description: "Buy Robux with Quick Login — done in 2-3 minutes.",
      imageUrl: roblox?.imageUrl ?? "",
      bannerUrl: roblox?.bannerUrl ?? null,
      currencyName: "Robux",
      uidLabel: "Roblox Username",
      uidExample: "Builderman",
      featured: false,
      active: true,
      sortOrder: 0,
    },
  });

  const existing = await prisma.product.findMany({
    where: { gameId: game.id },
    select: { amount: true },
  });
  const have = new Set(existing.map((p) => p.amount));

  let created = 0;
  for (let i = 0; i < PACKAGES.length; i++) {
    const [amount, priceUsd] = PACKAGES[i];
    if (have.has(amount)) continue;
    await prisma.product.create({
      data: {
        gameId: game.id,
        name: `${amount.toLocaleString("en-US")} Robux`,
        amount,
        priceUsd,
        sortOrder: i,
      },
    });
    created++;
  }

  console.log(`Game "${game.name}" ready at /games/${SLUG}. Added ${created} package(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
