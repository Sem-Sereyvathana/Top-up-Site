import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PriceTag from "@/components/PriceTag";
import HeroCarousel from "@/components/HeroCarousel";

export const metadata: Metadata = {
  title: "Game Items — SHARUTOPUP",
  description: "Buy in-game items, skins, and bundles — instant delivery.",
};

// Always hit the DB fresh so newly-added/edited/removed items show up
// immediately without waiting on a stale build/cache.
export const dynamic = "force-dynamic";

export default async function GameItemsPage() {
  const [items, banners] = await Promise.all([
    prisma.gameItem.findMany({
      where: { active: true },
      include: { Game: { select: { name: true, slug: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
    prisma.heroBanner.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return (
    <>
      <Header />
      <div className="pt-8">
        <HeroCarousel banners={banners} />
      </div>
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">

        {items.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-fox-border/70 bg-fox-card/40 px-6 py-16 text-center backdrop-blur-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent shadow-lg shadow-fox-primary/30">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-black">
                <path
                  d="M20 7L12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-fox-text">
              Items coming soon
            </h2>
            <p className="text-sm text-fox-muted">
              We&apos;re stocking the shelves. Check back shortly for skins,
              bundles, and rare in-game items.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-fox-border/70 bg-fox-card/50 p-4 backdrop-blur-md transition-transform hover:-translate-y-1 hover:border-fox-primary/60"
              >
                <div
                  className="mb-3 aspect-square rounded-xl bg-fox-bg/60 bg-cover bg-center"
                  style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined}
                />
                {item.badge && (
                  <span className="mb-1 inline-block rounded-full bg-fox-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fox-primary">
                    {item.badge}
                  </span>
                )}
                <p className="text-xs uppercase tracking-wide text-fox-muted">
                  {item.Game?.name || "General"}
                </p>
                <h3 className="mt-1 font-medium text-fox-text">{item.name}</h3>
                <PriceTag
                  priceUsd={item.priceUsd}
                  className="mt-2 block text-sm font-semibold text-fox-primary"
                />
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
