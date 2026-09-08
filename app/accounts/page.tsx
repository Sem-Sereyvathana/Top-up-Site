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
  const [accounts, banners, settings] = await Promise.all([
    prisma.gameAccount.findMany({
      where: { active: true },
      select: {
        id: true,
        title: true,
        rank: true,
        imageUrl: true,
        priceUsd: true,
        sold: true,
        stockMode: true,
        stock: true,
        Game: { select: { name: true, slug: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
    prisma.heroBanner.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.settings.findUnique({ where: { id: 1 } }),
  ]);

  // Unique, one-of-a-kind listings skip the cart/checkout flow entirely —
  // buyers are sent straight to admin on Telegram to arrange the deal.
  const adminContactUrl = settings?.supportTelegram
    ? `https://t.me/${settings.supportTelegram.replace(/^@/, "")}`
    : null;

  const cards: ShopCartCard[] = accounts.map((acc) => {
    const isMulti = acc.stockMode === "MULTI";
    return {
      id: acc.id,
      name: acc.title,
      subLabel: acc.rank,
      imageUrl: acc.imageUrl,
      priceUsd: acc.priceUsd,
      groupKey: acc.Game?.slug ?? "__general__",
      groupLabel: acc.Game?.name ?? "General",
      groupSortOrder: 0,
      // Multi-stock accounts sell out based on remaining `stock`; unique
      // accounts still use the existing `sold` flag.
      soldOut: isMulti ? acc.stock <= 0 : acc.sold,
      // Unique accounts can only ever be bought one at a time; multi-stock
      // accounts can be bought up to however many are left.
      maxQty: isMulti ? acc.stock : 1,
      // Unique listings are display-only — no cart, straight to admin.
      contactAdminUrl: !isMulti && !acc.sold ? adminContactUrl : null,
    };
  });

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
          detailsBaseHref="/accounts"
          emptyStateTitle="Listings coming soon"
          emptyStateBody="We're verifying accounts for sale. Check back shortly for listings across your favorite games."
          soldOutLabel="Sold"
        />
      </main>
      <Footer />
    </>
  );
}
