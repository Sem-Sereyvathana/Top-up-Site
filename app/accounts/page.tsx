import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ShopCartBrowser, { ShopCartCard } from "@/components/ShopCartBrowser";

export const metadata: Metadata = {
  title: "Accounts — SHARUSTORE",
  description: "Buy verified game accounts — instant handover, secure payment.",
};

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const [accounts] = await Promise.all([
    prisma.gameAccount.findMany({
      // Sold-out listings are excluded outright rather than shown greyed
      // out with a "Sold" badge — a buyer can't buy them anyway, and
      // leaving them visible just invites a race with whoever's actually
      // paying for it (see the 409 "just reserved by another buyer" case).
      // UNIQUE accounts are sold-out once `sold` flips true; MULTI accounts
      // are sold-out once their pooled `stock` hits zero.
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
        Category: { select: { name: true, slug: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  const cards: ShopCartCard[] = accounts.map((acc) => {
    const isMulti = acc.stockMode === "MULTI";
    return {
      id: acc.id,
      name: acc.title,
      subLabel: acc.rank,
      imageUrl: acc.imageUrl,
      priceUsd: acc.priceUsd,
      groupKey: acc.Category ? `cat-${acc.Category.slug}` : (acc.Game?.slug ?? "__general__"),
      groupLabel: acc.Category?.name ?? acc.Game?.name ?? "General",
      groupSortOrder: 0,
      // Sold-out listings stay visible (greyed out with a "Sold" badge)
      // instead of disappearing — admin still has `active` to pull a
      // listing entirely if it isn't selling well.
      soldOut: isMulti ? acc.stock <= 0 : acc.sold,
      // Unique accounts can only ever be bought one at a time; multi-stock
      // accounts can be bought up to however many are left.
      maxQty: isMulti ? acc.stock : 1,
      // Live remaining stock shown next to the card title. Unique listings
      // show 1 while unsold (then disappear/grey out via soldOut above);
      // pooled listings show their actual remaining count.
      stockCount: isMulti ? acc.stock : acc.sold ? 0 : 1,
      // Every account — unique or multi-stock, DIRECT or MANUAL delivery —
      // goes through the normal cart/checkout/payment flow now. Manual
      // handover accounts only get sent to admin's Telegram *after* the
      // order is actually paid (see MarketplaceOrderTracker's
      // autoRedirectManualPaid), so admin never gets messages from people
      // who never paid.
    };
  });

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <ShopCartBrowser
          cards={cards}
          kind="accounts"
          checkoutHref="/accounts/checkout"
          allowQuantity={false}
          detailsBaseHref="/accounts"
          emptyStateTitle="នឹងមកដល់ឆាប់ៗនេះ"
          emptyStateBody="We're verifying accounts for sale. Check back shortly for listings across your favorite games."
          soldOutLabel="អស់ហើយ"
        />
      </main>
      <Footer />
    </>
  );
}
