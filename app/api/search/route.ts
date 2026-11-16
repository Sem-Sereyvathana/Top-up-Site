import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";

export const dynamic = "force-dynamic";

// Site-wide storefront search — powers the header search box on every
// screen. Searches three catalogues at once and returns lightweight
// suggestions so the client can show a dropdown and a full results page:
//
//   * games    → /games/<slug>            (Top-up game pages)
//   * items    → /game-items/<id>          (Game Items marketplace)
//   * accounts → /accounts/<id>            (Accounts marketplace)
//
// A result's `href` is where clicking it should go. Inactive listings are
// excluded; sold-out ones still appear (the destination page shows them
// greyed out), matching how the storefronts behave.
//
// Public: no session required. Rate limited per IP so it can't be used to
// scrape the catalogue at speed.

const MAX_PER_KIND = 8;

type Result = {
  kind: "game" | "item" | "account";
  id: string;
  slug: string | null;
  name: string;
  sub: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  href: string;
};

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!(await checkRateLimit(`search:${ip}`, 120, 60 * 1000))) {
    return NextResponse.json({ error: "Too many searches. Please slow down." }, { status: 429 });
  }

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return NextResponse.json({ games: [], items: [], accounts: [], total: 0 });
  }

  // Case-insensitive partial match. Postgres `mode: "insensitive"` keeps the
  // DB doing the filtering so we never ship the whole catalogue to the API.
  const contains = { contains: q, mode: "insensitive" as const };

  const [games, items, accounts] = await Promise.all([
    prisma.game.findMany({
      where: {
        active: true,
        OR: [{ name: contains }, { publisher: contains }, { currencyName: contains }],
      },
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }],
      take: MAX_PER_KIND,
      select: { id: true, slug: true, name: true, publisher: true, imageUrl: true },
    }),
    prisma.gameItem.findMany({
      where: {
        active: true,
        OR: [{ name: contains }, { description: contains }],
      },
      orderBy: [{ sortOrder: "asc" }],
      take: MAX_PER_KIND,
      select: { id: true, name: true, priceUsd: true, imageUrl: true, Category: { select: { name: true } } },
    }),
    prisma.gameAccount.findMany({
      where: {
        active: true,
        archived: false,
        OR: [{ title: contains }, { rank: contains }, { description: contains }],
      },
      orderBy: [{ sortOrder: "asc" }],
      take: MAX_PER_KIND,
      select: { id: true, title: true, rank: true, priceUsd: true, imageUrl: true, stockMode: true, sold: true, stock: true },
    }),
  ]);

  const gameResults: Result[] = games.map((g) => ({
    kind: "game",
    id: g.id,
    slug: g.slug,
    name: g.name,
    sub: g.publisher,
    imageUrl: g.imageUrl,
    priceUsd: null,
    href: `/games/${g.slug}`,
  }));

  const itemResults: Result[] = items.map((it) => ({
    kind: "item",
    id: it.id,
    slug: null,
    name: it.name,
    sub: it.Category?.name ?? "Game Item",
    imageUrl: it.imageUrl,
    priceUsd: it.priceUsd,
    href: `/game-items/${it.id}`,
  }));

  const accountResults: Result[] = accounts.map((a) => ({
    kind: "account",
    id: a.id,
    slug: null,
    name: a.title,
    sub: a.rank ?? "Account",
    imageUrl: a.imageUrl,
    priceUsd: a.priceUsd,
    href: `/accounts/${a.id}`,
  }));

  const total = gameResults.length + itemResults.length + accountResults.length;
  return NextResponse.json({
    games: gameResults,
    items: itemResults,
    accounts: accountResults,
    total,
  });
}
