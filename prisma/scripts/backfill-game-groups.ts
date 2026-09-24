/**
 * One-off backfill for the Top-up Games group split.
 *
 * Run this ONCE, right after `npx prisma db push` (which adds the new
 * GameGroup table and Game.groupId column).
 *
 * For every distinct existing Game.groupName value, this creates a matching
 * GameGroup (same name, no banner yet — add one later in the admin UI) if
 * one doesn't already exist, and sets groupId on every game that had that
 * groupName. Games with no groupName are left ungrouped — nothing to do
 * there.
 *
 * Safe to run more than once (it only creates a group per name the first
 * time, and re-running just re-points already-correct games).
 *
 * Usage:
 *   npx tsx prisma/scripts/backfill-game-groups.ts
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
  const root = slugify(base) || "group";
  let candidate = root;
  let n = 2;
  while (await prisma.gameGroup.findUnique({ where: { slug: candidate } })) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

async function main() {
  const gamesWithGroupName = await prisma.game.findMany({
    where: { groupName: { not: null } },
  });

  const named = gamesWithGroupName.filter((g) => g.groupName && g.groupName.trim());

  if (named.length === 0) {
    console.log("No games with a groupName found — nothing to backfill.");
    return;
  }

  const nameToGroupId = new Map<string, string>();

  for (const game of named) {
    const name = game.groupName!.trim();
    let groupId = nameToGroupId.get(name);

    if (!groupId) {
      // Re-running the script should reuse a group made from a previous
      // run rather than creating a duplicate.
      const existing = await prisma.gameGroup.findFirst({ where: { name } });

      const group =
        existing ??
        (await prisma.gameGroup.create({
          data: { name, slug: await uniqueSlug(name) },
        }));

      groupId = group.id;
      nameToGroupId.set(name, groupId);
      console.log(`Group ready: "${group.name}" (${group.id})`);
    }

    await prisma.game.update({ where: { id: game.id }, data: { groupId } });
    console.log(`  → game "${game.name}" linked to group ${groupId}`);
  }

  console.log(`\nDone. Backfilled ${named.length} game(s) across ${nameToGroupId.size} group${nameToGroupId.size === 1 ? "" : "s"}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
