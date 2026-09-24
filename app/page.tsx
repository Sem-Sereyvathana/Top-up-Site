import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import GameFilterBar from "@/components/GameFilterBar";
import HeroCarousel from "@/components/HeroCarousel";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [games, banners] = await Promise.all([
    prisma.game.findMany({
      orderBy: [{ active: "desc" }, { featured: "desc" }, { sortOrder: "asc" }],
      include: { Group: true },
    }),
    prisma.heroBanner.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const gamesForFilter = games.map((game) => ({
    id: game.id,
    slug: game.slug,
    name: game.name,
    groupName: game.Group?.name ?? null,
    publisher: game.publisher,
    currencyName: game.currencyName,
    imageUrl: game.imageUrl,
    featured: game.featured,
    active: game.active,
  }));

  return (
    <>
      <Header />

      {/* 1. Running Marquee Welcome Banner */}
      <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 py-2.5 text-white font-bold text-xs sm:text-sm tracking-wide shadow-md">
        <div className="flex w-max animate-marquee space-x-8 whitespace-nowrap">
          <span>🎉 WELCOME TO SHARUSTORE — CAMBODIA&apos;S FASTEST &amp; MOST SECURE GAME TOP-UP STORE! ⚡ 24/7 INSTANT DELIVERY </span>
          <span>🎉 WELCOME TO SHARUSTORE — CAMBODIA&apos;S FASTEST &amp; MOST SECURE GAME TOP-UP STORE! ⚡ 24/7 INSTANT DELIVERY </span>
          <span>🎉 WELCOME TO SHARUSTORE — CAMBODIA&apos;S FASTEST &amp; MOST SECURE GAME TOP-UP STORE! ⚡ 24/7 INSTANT DELIVERY </span>
        </div>
      </div>

      {/* 2. Display Ad Banner Carousel */}
      <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <HeroCarousel banners={banners} />
      </section>

      {/* 3. Game categories: filter pills + grid */}
      <section id="games" className="relative mx-auto max-w-7xl px-4 pt-6 pb-16 sm:px-6 lg:px-8">
        {games.length === 0 ? (
          <div className="text-center py-16 text-fox-muted">
            <p>
              No games available. Run{" "}
              <code className="text-fox-primary font-mono">npm run db:seed</code> to populate.
            </p>
          </div>
        ) : (
          <GameFilterBar games={gamesForFilter} />
        )}
      </section>

      <Footer />
    </>
  );
}