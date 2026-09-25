import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import GameItemAddToCart from "@/components/GameItemAddToCart";
import type { ShopCartCard } from "@/components/ShopCartBrowser";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

async function getItem(id: string) {
  return prisma.gameItem.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      priceUsd: true,
      badge: true,
      soldOut: true,
      active: true,
      Category: { select: { name: true, slug: true } },
    },
  });
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const item = await getItem(params.id);
  if (!item) return { title: "Game Item — SHARUSTORE" };
  return {
    title: `${item.name} — SHARUSTORE`,
    description: item.description || `Buy ${item.name} — instant delivery, secure payment.`,
  };
}

export default async function GameItemDetailsPage({ params }: { params: { id: string } }) {
  const item = await getItem(params.id);
  if (!item || !item.active) notFound();

  const card: ShopCartCard = {
    id: item.id,
    name: item.name,
    imageUrl: item.imageUrl,
    priceUsd: item.priceUsd,
    badge: item.badge,
    groupKey: item.Category?.slug ?? "__general__",
    groupLabel: item.Category?.name ?? "General",
    groupSortOrder: 0,
    soldOut: item.soldOut,
  };

  return (
    <>
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <Link
          href="/game-items"
          className="mb-6 inline-flex items-center gap-2 text-sm text-fox-muted hover:text-fox-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          All items
        </Link>

        <div className="grid gap-8 sm:grid-cols-2">
          <div
            className={`aspect-square overflow-hidden rounded-2xl border border-fox-border bg-fox-card/50 ${
              item.soldOut ? "opacity-60 grayscale" : ""
            }`}
          >
            {item.imageUrl && (
              // Main image for this detail page — loads eagerly since it's
              // the primary visible content, not an off-screen list item.
              <img
                src={item.imageUrl}
                alt={item.name}
                decoding="async"
                className="h-full w-full object-cover"
              />
            )}
          </div>

          <div className="flex flex-col">
            <p className="text-xs uppercase tracking-wide text-fox-muted">
              {item.Category?.name || "General"}
            </p>
            <h1 className="font-display mt-1 text-2xl font-bold sm:text-3xl">{item.name}</h1>

            {item.badge && (
              <span className="mt-2 inline-block w-fit rounded-full bg-fox-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-fox-primary">
                {item.badge}
              </span>
            )}

            {item.description && (
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-fox-muted">
                {item.description}
              </p>
            )}

            <div className="mt-6">
              <GameItemAddToCart card={card} />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
