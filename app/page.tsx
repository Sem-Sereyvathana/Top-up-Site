import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import GameCard from "@/components/GameCard";
import RecentOrdersTicker from "@/components/RecentOrdersTicker";
import HeroCarousel from "@/components/HeroCarousel";
import { isRobuxGame } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [games, banners, robuxStock] = await Promise.all([
    prisma.game.findMany({
      orderBy: [{ active: "desc" }, { featured: "desc" }, { sortOrder: "asc" }],
    }),
    prisma.heroBanner.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.robuxStock.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    }),
  ]);

  return (
    <>
      <Header />

      {/* 1. Running Marquee Welcome Banner */}
      <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 py-2.5 text-white font-bold text-xs sm:text-sm tracking-wide shadow-md">
        <div className="flex w-max animate-marquee space-x-8 whitespace-nowrap">
          <span>🎉 WELCOME TO SHARUTOPUP — CAMBODIA&apos;S FASTEST &amp; MOST SECURE GAME TOP-UP STORE! ⚡ 24/7 INSTANT DELIVERY </span>
          <span>🎉 WELCOME TO SHARUTOPUP — CAMBODIA&apos;S FASTEST &amp; MOST SECURE GAME TOP-UP STORE! ⚡ 24/7 INSTANT DELIVERY </span>
          <span>🎉 WELCOME TO SHARUTOPUP — CAMBODIA&apos;S FASTEST &amp; MOST SECURE GAME TOP-UP STORE! ⚡ 24/7 INSTANT DELIVERY </span>
        </div>
      </div>

      {/* 2. Display Ad Banner Carousel */}
      <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <HeroCarousel banners={banners} />
      </section>

      {/* 3. Recent orders ticker */}
      <div className="mt-6">
        <RecentOrdersTicker />
      </div>

      {/* 4. Product Cards Grid */}
      <section id="games" className="relative mx-auto max-w-7xl px-4 py-8 pb-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
          {games.map((game, i) => (
            <div
              key={game.id}
              className="fade-up"
              style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
            >
              <GameCard
                slug={game.slug}
                name={game.name}
                publisher={game.publisher}
                currencyName={game.currencyName}
                imageUrl={game.imageUrl}
                featured={game.featured}
                active={game.active}
                robuxStock={isRobuxGame(game) ? robuxStock.totalRobux : null}
              />
            </div>
          ))}
        </div>

        {games.length === 0 && (
          <div className="text-center py-16 text-fox-muted">
            <p>
              No games available. Run{" "}
              <code className="text-fox-primary font-mono">npm run db:seed</code> to populate.
            </p>
          </div>
        )}
      </section>

      <Footer />
    </>
  );
}