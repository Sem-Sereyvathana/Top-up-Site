"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrency } from "@/lib/currency";
import DualPrice from "./DualPrice";
import { useShopCart, ShopKind } from "@/lib/shopCart";
import { Plus, Minus, Check, ShoppingCart, MessageCircle } from "lucide-react";

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
  /**
   * Per-card cap on quantity, independent of the browser-level
   * `allowQuantity` prop. Used by the Accounts marketplace, where a single
   * page mixes one-per-listing accounts (maxQty omitted/1) with stackable
   * stock accounts (maxQty = remaining stock). When omitted, the card falls
   * back to the browser-level `allowQuantity` (capped at 20).
   */
  maxQty?: number;
  /**
   * Set only for one-of-a-kind (stockMode = "UNIQUE") accounts. When present,
   * this card skips the cart/checkout flow entirely: the card shows a "Buy"
   * action instead of "+ Add", and clicking it sends the buyer straight to
   * this admin contact link (e.g. Telegram) to arrange the deal manually,
   * rather than adding anything to the cart.
   */
  contactAdminUrl?: string | null;
}

interface ShopCartBrowserProps {
  cards: ShopCartCard[];
  /** Which shared cart this browser reads/writes — "items" or "accounts". */
  kind: ShopKind;
  /** Where the dedicated checkout page for this marketplace lives. */
  checkoutHref: string;
  /** Default for cards that don't set their own `maxQty`. */
  allowQuantity: boolean;
  emptyStateTitle: string;
  emptyStateBody: string;
  soldOutLabel?: string;
  allProductsLabel?: string;
  /**
   * When set, clicking anywhere on a card's body (outside the Add/qty
   * controls) navigates to `${detailsBaseHref}/${card.id}` — a dedicated
   * details page — instead of toggling the cart. When omitted, falls back
   * to the original behaviour (click-to-add for cards that don't support
   * quantity).
   */
  detailsBaseHref?: string;
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
  detailsBaseHref,
}: ShopCartBrowserProps) {
  const { format } = useCurrency();
  const router = useRouter();
  const { linesFor, toggleCard, changeQty, removeLine } = useShopCart();
  const [selectedGroup, setSelectedGroup] = useState<string>(ALL_KEY);

  const cartLines = linesFor(kind);

  // Listings that sold out (or were deactivated) since being added to the
  // cart are excluded from `cards` by the server query now, rather than
  // shown greyed-out — but a cart line added *before* that happened would
  // otherwise sit there as a phantom entry (still counted in the header
  // badge, still sent to checkout, where it'd fail with a 409). Drop any
  // cart line whose card isn't in the current listing so the cart always
  // matches what's actually still buyable.
  useEffect(() => {
    const availableIds = new Set(cards.map((c) => c.id));
    for (const line of cartLines) {
      if (!availableIds.has(line.card.id)) removeLine(kind, line.card.id);
    }
    // Only re-run when the listing itself changes — cartLines intentionally
    // excluded so removing a line here doesn't immediately re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, kind]);
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
                  <span className="h-6 w-6 shrink-0 overflow-hidden rounded">
                    <img
                      src={group.imageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </span>
                )}
                <h2 className="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
                  {group.label}
                </h2>
              </div>

              <div className={kind === "items" ? "grid grid-cols-[repeat(auto-fill,minmax(150px,150px))] justify-start gap-3" : "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"}>
                {group.cards.map((card) => {
                  const qty = cart[card.id] ?? 0;
                  const inCart = qty > 0;
                  // Effective per-card cap: an explicit `maxQty` (e.g. an
                  // account's remaining stock) always wins; otherwise fall
                  // back to the browser-level default.
                  const effectiveMax = card.maxQty ?? (allowQuantity ? 20 : 1);
                  const cardAllowsQty = effectiveMax > 1;
                  const goToDetails = () => {
                    if (detailsBaseHref) router.push(`${detailsBaseHref}/${card.id}`);
                  };
                  const handleCardActivate = () => {
                    if (card.soldOut) return;
                    // Admin-contact cards are just a display — tapping the
                    // card body still opens the details page (if any) rather
                    // than acting on the cart.
                    if (detailsBaseHref) {
                      goToDetails();
                      return;
                    }
                    if (card.contactAdminUrl) return;
                    if (!cardAllowsQty) toggleCard(kind, card);
                  };
                  return (
                    <div
                      role="button"
                      tabIndex={card.soldOut ? -1 : 0}
                      key={card.id}
                      aria-disabled={card.soldOut || undefined}
                      onClick={handleCardActivate}
                      onKeyDown={(e) => {
                        if (card.soldOut) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleCardActivate();
                        }
                      }}
                      className={`relative rounded-2xl border ${kind === "items" ? "p-3" : "p-4"} text-left backdrop-blur-md transition-transform ${
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
                      {card.badge && !inCart && !card.soldOut && (
                        <span className="absolute right-3 top-3 z-10 badge-best flex items-center gap-1 text-[9px]">
                          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
                          </svg>
                          {card.badge}
                        </span>
                      )}
                      <div
                        className={`${kind === "items" ? "mb-2" : "mb-3"} aspect-square overflow-hidden rounded-xl bg-fox-bg/60 ${card.soldOut ? "opacity-40 grayscale" : ""}`}
                      >
                        {card.imageUrl && (
                          <img
                            src={card.imageUrl}
                            alt={card.name}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      {card.subLabel && (
                        <p className="text-xs uppercase tracking-wide text-fox-muted">{card.subLabel}</p>
                      )}
                      <h3 className={kind === "items" ? "mt-1 text-sm font-medium text-fox-text line-clamp-1" : "mt-1 font-medium text-fox-text"}>{card.name}</h3>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-fox-primary"><DualPrice usd={card.priceUsd} /></span>
                      </div>

                      {!card.soldOut && (
                        <div className="mt-3 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {card.contactAdminUrl ? (
                            <a
                              href={card.contactAdminUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex w-full items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-fox-primary to-fox-accent py-1.5 text-xs font-bold text-black hover:opacity-90"
                            >
                              <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.5} />
                              Buy
                            </a>
                          ) : cardAllowsQty ? (
                            inCart ? (
                              <div className="flex items-center justify-between rounded-lg border border-fox-primary/40 bg-fox-bg/60 px-2 py-1.5">
                                <button
                                  type="button"
                                  onClick={() => changeQty(kind, card.id, -1, effectiveMax)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-fox-text hover:bg-fox-card"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <span className="text-sm font-semibold">{qty}</span>
                                <button
                                  type="button"
                                  disabled={qty >= effectiveMax}
                                  onClick={() => changeQty(kind, card.id, 1, effectiveMax)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-fox-text hover:bg-fox-card disabled:opacity-30 disabled:hover:bg-transparent"
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
                                ដាក់ចូលកន្ត្រក
                              </button>
                            )
                          ) : (
                            inCart ? (
                              <button
                                type="button"
                                onClick={() => removeLine(kind, card.id)}
                                className="w-full rounded-lg border border-red-500/40 bg-red-500/10 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20"
                              >
                                Remove
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleCard(kind, card)}
                                className="w-full rounded-lg border border-fox-primary/40 bg-fox-primary/10 py-1.5 text-xs font-semibold text-fox-primary hover:bg-fox-primary/20"
                              >
                                ដាក់ចូលកន្ត្រក
                              </button>
                            )
                          )}

                          {inCart && (
                            <button
                              type="button"
                              onClick={() => router.push(checkoutHref)}
                              className="flex w-full items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-fox-primary to-fox-accent py-1.5 text-xs font-bold text-black hover:opacity-90"
                            >
                              <ShoppingCart className="h-3.5 w-3.5" strokeWidth={2.5} />
                              ទិញឥឡូវនេះ
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
        <span className="h-5 w-5 shrink-0 overflow-hidden rounded">
          <img src={imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        </span>
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
