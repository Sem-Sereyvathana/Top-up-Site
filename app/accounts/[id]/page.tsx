import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AccountAddToCart from "@/components/AccountAddToCart";
import type { ShopCartCard } from "@/components/ShopCartBrowser";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

async function getAccount(id: string) {
  // Never select `credentials` here — this page (and everything it feeds)
  // is public, and the login handover must stay admin-only until an order
  // for it is actually paid.
  return prisma.gameAccount.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      rank: true,
      description: true,
      imageUrl: true,
      priceUsd: true,
      sold: true,
      stockMode: true,
      stock: true,
      active: true,
      Game: { select: { name: true, slug: true } },
      Category: { select: { name: true, slug: true } },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const account = await getAccount(id);
  if (!account) return { title: "Account — SHARUSTORE" };
  return {
    title: `${account.title} — SHARUSTORE`,
    description: account.description || `Buy ${account.title} — verified account, secure payment.`,
  };
}

export default async function AccountDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await getAccount(id);
  if (!account || !account.active) notFound();

  const isMulti = account.stockMode === "MULTI";
  const soldOut = isMulti ? account.stock <= 0 : account.sold;

  const card: ShopCartCard = {
    id: account.id,
    name: account.title,
    subLabel: account.rank,
    imageUrl: account.imageUrl,
    priceUsd: account.priceUsd,
    groupKey: account.Category ? `cat-${account.Category.slug}` : (account.Game?.slug ?? "__general__"),
    groupLabel: account.Category?.name ?? account.Game?.name ?? "General",
    groupSortOrder: 0,
    soldOut,
    // Every account goes through the normal cart/checkout/payment flow
    // now — unique accounts are simply capped at quantity 1.
    maxQty: isMulti ? account.stock : 1,
  };

  return (
    <>
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <Link
          href="/accounts"
          className="mb-6 inline-flex items-center gap-2 text-sm text-fox-muted hover:text-fox-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          All accounts
        </Link>

        <div className="grid gap-8 sm:grid-cols-2">
          <div
            className={`aspect-square overflow-hidden rounded-2xl border border-fox-border bg-fox-card/50 ${
              soldOut ? "opacity-60 grayscale" : ""
            }`}
          >
            {account.imageUrl && (
              // Main image for this detail page — loads eagerly since it's
              // the primary visible content, not an off-screen list item.
              <img
                src={account.imageUrl}
                alt={account.title}
                decoding="async"
                className="h-full w-full object-cover"
              />
            )}
          </div>

          <div className="flex flex-col">
            <p className="text-xs uppercase tracking-wide text-fox-muted">
              {account.Category?.name || account.Game?.name || "General"}
            </p>
            <h1 className="font-display mt-1 text-2xl font-bold sm:text-3xl">{account.title}</h1>

            {account.rank && (
              <span className="mt-2 inline-block w-fit rounded-full bg-fox-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-fox-primary">
                {account.rank}
              </span>
            )}

            {account.description && (
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-fox-muted">
                {account.description}
              </p>
            )}

            <div className="mt-6">
              <AccountAddToCart card={card} />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
