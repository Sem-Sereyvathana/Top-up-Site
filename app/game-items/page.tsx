import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ShopCartBrowser, { ShopCartCard } from "@/components/ShopCartBrowser";

export const metadata: Metadata = {
  title: "Game Items — SHARUSTORE",
  description: "Buy in-game items, skins, and bundles — instant delivery.",
};

// Always hit the DB fresh so newly-added/edited/removed items show up
// immediately without waiting on a stale build/cache.
export const dynamic = "force-dynamic";

export default async function GameItemsPage() {
  const items = await prisma.gameItem.findMany({
    where: { active: true },
    include: {
      Category: { select: { name: true, slug: true, imageUrl: true, sortOrder: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  const cards: ShopCartCard[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    imageUrl: item.imageUrl,
    priceUsd: item.priceUsd,
    badge: item.badge,
    groupKey: item.Category?.slug ?? "__general__",
    groupLabel: item.Category?.name ?? "General",
    groupImageUrl: item.Category?.imageUrl ?? null,
    groupSortOrder: item.Category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    // Sold-out items stay visible (greyed out, Add disabled) instead of
    // disappearing — admin still has `active` to pull a listing entirely.
    soldOut: item.soldOut,
  }));

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <ShopCartBrowser
          cards={cards}
          kind="items"
          checkoutHref="/game-items/checkout"
          allowQuantity
          detailsBaseHref="/game-items"
          emptyStateTitle="នឹងមកដល់ឆាប់ៗនេះ"
          emptyStateBody="We're stocking the shelves. Check back shortly for skins, bundles, and rare in-game items."
          soldOutLabel="អស់ហើយ"
        />
      </main>
      <Footer />
    </>
  );
}
