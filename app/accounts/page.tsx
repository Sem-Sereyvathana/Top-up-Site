import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PriceTag from "@/components/PriceTag";
import HeroCarousel from "@/components/HeroCarousel";

export const metadata: Metadata = {
  title: "Accounts — SHARUTOPUP",
  description: "Buy verified game accounts — instant handover, secure payment.",
};

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const [accounts, banners] = await Promise.all([
    prisma.gameAccount.findMany({
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

        {accounts.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-fox-border/70 bg-fox-card/40 px-6 py-16 text-center backdrop-blur-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent shadow-lg shadow-fox-primary/30">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-black">
                <path
                  d="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-fox-text">
              Listings coming soon
            </h2>
            <p className="text-sm text-fox-muted">
              We&apos;re verifying accounts for sale. Check back shortly for
              listings across your favorite games.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="relative rounded-2xl border border-fox-border/70 bg-fox-card/50 p-4 backdrop-blur-md transition-transform hover:-translate-y-1 hover:border-fox-primary/60"
              >
                {acc.sold && (
                  <span className="absolute right-3 top-3 z-10 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    Sold
                  </span>
                )}
                <div
                  className={`mb-3 aspect-video rounded-xl bg-fox-bg/60 bg-cover bg-center ${acc.sold ? "opacity-40 grayscale" : ""}`}
                  style={acc.imageUrl ? { backgroundImage: `url(${acc.imageUrl})` } : undefined}
                />
                <p className="text-xs uppercase tracking-wide text-fox-muted">
                  {acc.Game?.name || "General"}
                  {acc.rank ? ` · ${acc.rank}` : ""}
                </p>
                <h3 className="mt-1 font-medium text-fox-text">{acc.title}</h3>
                <PriceTag
                  priceUsd={acc.priceUsd}
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
