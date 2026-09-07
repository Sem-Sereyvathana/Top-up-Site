"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrency } from "@/lib/currency";
import { useShopCart, ShopKind } from "@/lib/shopCart";
import { Plus, Minus, Check, ShoppingCart, Zap } from "lucide-react";

// Shared cart-and-browse UI for the Game Items and Accounts marketplaces.
// Both storefronts look identical (same grid, same category pills, same
// floating cart bar) but hit different APIs and post different fields — see
// the `kind`/checkout props below. Checking out now happens on a dedicated
// page (see ShopCheckout.tsx) rather than inline at the bottom of this
// browser; this component only owns picking things and adding them to the
// shared cart (or jumping straight to checkout via "Buy Now").

export interface ShopCartCard {
  id: string;
  name: string;
  subLabel?: string | null;
  imageUrl: string | null;
  priceUsd: number;
  badge?: string | null;
  groupKey: string;
  groupLabel: string;
  groupImageUrl?: string | null;
  groupSortOrder: number;
  soldOut?: boolean;
}

interface ShopCartBrowserProps {
  cards: ShopCartCard[];
  /** Which shared cart this browser reads/writes — "items" or "accounts". */
  kind: ShopKind;
  /** Where the dedicated checkout page for this marketplace lives. */
  checkoutHref: string;
  /** Items support buying more than one of the same card; Accounts don't. */
  allowQuantity: boolean;
  emptyStateTitle: string;
  emptyStateBody: string;
  soldOutLabel?: string;
  allProductsLabel?: string;
}

const ALL_KEY = "__all__";
const GENERAL_KEY = "__general__";

interface CardGroup {
  key: string;
  label: string;
  imageUrl: string | null;
  sortOrder: number;
  cards: ShopCartCard[];
}

export default function ShopCartBrowser({
  cards,
  kind,
  checkoutHref,
  allowQuantity,
  emptyStateTitle,
  emptyStateBody,
  soldOutLabel = "Sold",
  allProductsLabel = "All products",
}: ShopCartBrowserProps) {
  const { format } = useCurrency();
  const router = useRouter();
  const { linesFor, toggleCard, changeQty, setBuyNow } = useShopCart();
  const [selectedGroup, setSelectedGroup] = useState<string>(ALL_KEY);

  const cartLines = linesFor(kind);
  const cart = useMemo(() => {
    const map: Record<string, number> = {};
    for (const line of cartLines) map[line.card.id] = line.quantity;
    return map;
  }, [cartLines]);

  const groups = useMemo(() => {
    const map = new Map<string, CardGroup>();
    for (const card of cards) {
      const key = card.groupKey || GENERAL_KEY;
      const existing = map.get(key);
      if (existing) {
        existing.cards.push(card);
      } else {
        map.set(key, {
          key,
          label: card.groupLabel || "General",
          imageUrl: card.groupImageUrl ?? null,
          sortOrder: card.groupSortOrder ?? Number.MAX_SAFE_INTEGER,
          cards: [card],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === GENERAL_KEY) return 1;
      if (b.key === GENERAL_KEY) return -1;
      return a.sortOrder - b.sortOrder;
    });
  }, [cards]);

  const visibleGroups =
    selectedGroup === ALL_KEY ? groups : groups.filter((g) => g.key === selectedGroup);

  const subtotal = cartLines.reduce((sum, l) => sum + l.card.priceUsd * l.quantity, 0);

  function buyNow(card: ShopCartCard) {
    if (card.soldOut) return;
    setBuyNow(card);
    router.push(`${checkoutHref}?buyNow=1`);
  }

  return (
    <div className="pb-28">
      {/* Category pill bar */}
      <div className="mb-8 flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <CategoryPill
          active={selectedGroup === ALL_KEY}
          label={allProductsLabel}
          onClick={() => setSelectedGroup(ALL_KEY)}
        />
        {groups.map((g) => (
          <CategoryPill
            key={g.key}
            active={selectedGroup === g.key}
            label={g.label}
            imageUrl={g.imageUrl}
            onClick={() => setSelectedGroup(g.key)}
          />
        ))}
      </div>

      {visibleGroups.length === 0 ? (
        <EmptyState title={emptyStateTitle} body={emptyStateBody} />
      ) : (
        <div className="space-y-10">
          {visibleGroups.map((group) => (
            <section key={group.key}>
              <div className="mb-4 flex items-center gap-3 rounded-xl bg-gradient-to-r from-fox-primary to-fox-accent px-4 py-3 shadow-glow-sm">
                {group.imageUrl && (
                  <span
                    className="h-6 w-6 shrink-0 rounded bg-cover bg-center"
                    style={{ backgroundImage: `url(${group.imageUrl})` }}
                  />
                )}
                <h2 className="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
                  {group.label}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {group.cards.map((card) => {
                  const qty = cart[card.id] ?? 0;
                  const inCart = qty > 0;
                  return (
                    <div
                      role="button"
                      tabIndex={card.soldOut ? -1 : 0}
                      key={card.id}
                      aria-disabled={card.soldOut || undefined}
                      onClick={() => !card.soldOut && !allowQuantity && toggleCard(kind, card)}
                      onKeyDown={(e) => {
                        if (card.soldOut || allowQuantity) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleCard(kind, card);
                        }
                      }}
                      className={`relative rounded-2xl border p-4 text-left backdrop-blur-md transition-transform ${
                        card.soldOut
                          ? "cursor-not-allowed border-fox-border/50 bg-fox-card/30 opacity-60"
                          : inCart
                            ? "border-fox-primary bg-fox-primary/10 shadow-glow-sm"
                            : "border-fox-border/70 bg-fox-card/50 hover:-translate-y-1 hover:border-fox-primary/60"
                      }`}
                    >
                      {card.soldOut && (
                        <span className="absolute right-3 top-3 z-10 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                          {soldOutLabel}
                        </span>
                      )}
                      {inCart && !card.soldOut && (
                        <span className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-fox-primary text-black">
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        </span>
                      )}
                      <div
                        className={`mb-3 aspect-square rounded-xl bg-fox-bg/60 bg-cover bg-center ${card.soldOut ? "opacity-40 grayscale" : ""}`}
                        style={card.imageUrl ? { backgroundImage: `url(${card.imageUrl})` } : undefined}
                      />
                      {card.badge && (
                        <span className="mb-1 inline-block rounded-full bg-fox-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fox-primary">
                          {card.badge}
                        </span>
                      )}
                      {card.subLabel && (
                        <p className="text-xs uppercase tracking-wide text-fox-muted">{card.subLabel}</p>
                      )}
                      <h3 className="mt-1 font-medium text-fox-text">{card.name}</h3>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-fox-primary">{format(card.priceUsd)}</span>
                      </div>

                      {!card.soldOut && (
                        <div className="mt-3 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {allowQuantity &&
                            (inCart ? (
                              <div className="flex items-center justify-between rounded-lg border border-fox-primary/40 bg-fox-bg/60 px-2 py-1.5">
                                <button
                                  type="button"
                                  onClick={() => changeQty(kind, card.id, -1)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-fox-text hover:bg-fox-card"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <span className="text-sm font-semibold">{qty}</span>
                                <button
                                  type="button"
                                  onClick={() => changeQty(kind, card.id, 1)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-fox-text hover:bg-fox-card"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleCard(kind, card)}
                                className="w-full rounded-lg border border-fox-primary/40 bg-fox-primary/10 py-1.5 text-xs font-semibold text-fox-primary hover:bg-fox-primary/20"
                              >
                                + Add
                              </button>
                            ))}

                          {!inCart && (
                            <button
                              type="button"
                              onClick={() => buyNow(card)}
                              className="flex w-full items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-fox-primary to-fox-accent py-1.5 text-xs font-bold text-black hover:opacity-90"
                            >
                              <Zap className="h-3.5 w-3.5" strokeWidth={2.5} />
                              Buy Now
                            </button>
                          )}

                          {inCart && (
                            <button
                              type="button"
                              onClick={() => router.push(checkoutHref)}
                              className="flex w-full items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-fox-primary to-fox-accent py-1.5 text-xs font-bold text-black hover:opacity-90"
                            >
                              <ShoppingCart className="h-3.5 w-3.5" strokeWidth={2.5} />
                              Go to Checkout
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Sticky cart bar — appears once something's selected, routes to the dedicated checkout page */}
      {cartLines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-fox-border bg-fox-surface/95 px-4 py-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm text-fox-text">
              <ShoppingCart className="h-4 w-4 text-fox-primary" />
              {cartLines.length} selected · <span className="font-semibold text-fox-primary">{format(subtotal)}</span>
            </span>
            <button
              type="button"
              onClick={() => router.push(checkoutHref)}
              className="btn-primary !py-2 text-sm"
            >
              Checkout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryPill({
  active,
  label,
  imageUrl,
  onClick,
}: {
  active: boolean;
  label: string;
  imageUrl?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors sm:text-sm " +
        (active
          ? "border-fox-primary bg-fox-primary text-white shadow-glow-sm"
          : "border-fox-border/70 bg-fox-card/60 text-fox-text hover:border-fox-primary/60")
      }
    >
      {imageUrl && (
        <span className="h-5 w-5 shrink-0 rounded bg-cover bg-center" style={{ backgroundImage: `url(${imageUrl})` }} />
      )}
      {label}
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-fox-border/70 bg-fox-card/40 px-6 py-16 text-center backdrop-blur-md">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent shadow-lg shadow-fox-primary/30">
        <ShoppingCart className="h-6 w-6 text-black" />
      </div>
      <h2 className="text-lg font-semibold text-fox-text">{title}</h2>
      <p className="text-sm text-fox-muted">{body}</p>
    </div>
  );
}
