import { prisma } from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import TopUpForm from "@/components/TopUpForm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Zap } from "lucide-react";
import { isRobuxGame } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: { slug: string } }) {
  const game = await prisma.game.findUnique({
    where: { slug: params.slug },
    include: {
      products: {
        where: { active: true },
        orderBy: [{ priceUsd: "asc" }, { sortOrder: "asc" }],
      },
    },
  });

  if (!game || !game.active) notFound();

  const robuxStock = isRobuxGame(game)
    ? (await prisma.robuxStock.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })).totalRobux
    : null;

  return (
    <>
      <Header />

      {/* Game banner */}
      <section className="relative overflow-hidden border-b border-fox-border">
        {game.bannerUrl && (
          // Above-the-fold banner for this page — loads eagerly since it's
          // the first thing visible, not an off-screen list item.
          <img
            src={game.bannerUrl}
            alt=""
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover opacity-30"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-fox-bg via-fox-bg/90 to-fox-bg/70" />

        <div className="relative mx-auto max-w-6xl px-4 py-8 sm:py-12 sm:px-6 lg:px-8">
          <Link
            href="/#games"
            className="inline-flex items-center gap-2 text-sm text-fox-muted hover:text-fox-primary transition-colors mb-4 sm:mb-6"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            All games
          </Link>

          <div className="flex items-center gap-4 sm:gap-6">
            <div className="h-20 w-20 sm:h-28 sm:w-28 rounded-2xl border-2 border-fox-border bg-fox-card shadow-xl shrink-0 overflow-hidden">
              <img
                src={game.imageUrl}
                alt={game.name}
                decoding="async"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              {game.publisher && (
                <p className="text-[10px] sm:text-xs uppercase tracking-widest text-fox-muted mb-1">
                  {game.publisher}
                </p>
              )}
              <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight mb-1 sm:mb-2">
                {game.name}
              </h1>
              <div className="flex items-center gap-3">
                <p className="text-fox-accent text-xs sm:text-sm">
                  Top up {game.currencyName}
                </p>
                <span className="inline-flex items-center gap-1 rounded-full border border-green-400/30 bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-300">
                  <Zap className="h-2.5 w-2.5" strokeWidth={3} />
                  Instant delivery
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12 sm:px-6 lg:px-8">
        <TopUpForm
          game={{
            id: game.id,
            slug: game.slug,
            name: game.name,
            currencyName: game.currencyName,
            uidLabel: game.uidLabel,
            uidExample: game.uidExample,
          }}
          robuxStock={robuxStock}
          products={game.products.map((p) => ({
            id: p.id,
            name: p.name,
            amount: p.amount,
            bonus: p.bonus,
            priceUsd: p.priceUsd,
            badge: p.badge,
            imageUrl: p.imageUrl,
            stock: p.stock,
          }))}
        />
      </main>

      <Footer />
    </>
  );
}
