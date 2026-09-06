import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import HeroCarousel from "@/components/HeroCarousel";
import ShopCartBrowser, { ShopCartCard } from "@/components/ShopCartBrowser";

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

  const cards: ShopCartCard[] = accounts.map((acc) => ({
    id: acc.id,
    name: acc.title,
    subLabel: acc.rank,
    imageUrl: acc.imageUrl,
    priceUsd: acc.priceUsd,
    groupKey: acc.Game?.slug ?? "__general__",
    groupLabel: acc.Game?.name ?? "General",
    groupSortOrder: 0,
    soldOut: acc.sold,
  }));

  return (
    <>
      <Header />
      <div className="pt-8">
        <HeroCarousel banners={banners} />
      </div>
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <ShopCartBrowser
          cards={cards}
          kind="accounts"
          checkoutHref="/accounts/checkout"
          allowQuantity={false}
          emptyStateTitle="Listings coming soon"
          emptyStateBody="We're verifying accounts for sale. Check back shortly for listings across your favorite games."
          soldOutLabel="Sold"
        />
      </main>
      <Footer />
    </>
  );
}
