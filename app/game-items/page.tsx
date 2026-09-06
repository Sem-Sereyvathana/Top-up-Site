import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import GameItemsBrowser from "@/components/GameItemsBrowser";

export const metadata: Metadata = {
  title: "Game Items — SHARUTOPUP",
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

  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <GameItemsBrowser items={items} />
      </main>
      <Footer />
    </>
  );
}
