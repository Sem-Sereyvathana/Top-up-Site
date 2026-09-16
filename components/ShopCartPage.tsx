"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useCurrency } from "@/lib/currency";
import { useShopCart, ShopKind } from "@/lib/shopCart";
import { ArrowLeft, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

// Dedicated cart page — replaces the old header dropdown, which had no room
// to breathe on mobile (long item names got clipped, and the panel could
// overflow off the side of the screen). This is a full page instead: same
// cart data (useShopCart), just laid out with room to show every line, a
// back button up top, and +/- qty controls instead of only "Remove".

export default function ShopCartPage({
  kind,
  title,
  backHref,
  checkoutHref,
  allowQuantity,
}: {
  kind: ShopKind;
  title: string;
  /** Where the back button and the empty-state "Continue shopping" link go. */
  backHref: string;
  checkoutHref: string;
  /** Whether lines here can have their quantity adjusted (vs. just removed). */
  allowQuantity: boolean;
}) {
  const router = useRouter();
  const { format } = useCurrency();
  const { linesFor, changeQty, removeLine } = useShopCart();

  const lines = linesFor(kind);
  const subtotal = lines.reduce((sum, l) => sum + l.card.priceUsd * l.quantity, 0);

  function goBack() {
    // router.back() falls through to backHref if there's no history entry
    // to return to (e.g. the cart page was opened directly / refreshed).
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(backHref);
    }
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            aria-label="Back"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-fox-border bg-fox-card/80 text-fox-text transition-colors hover:border-fox-primary/60 hover:text-fox-primary"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{title}</h1>
        </div>

        {lines.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-fox-border/70 bg-fox-card/40 px-6 py-16 text-center backdrop-blur-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent shadow-lg shadow-fox-primary/30">
              <ShoppingCart className="h-6 w-6 text-black" />
            </div>
            <h2 className="text-lg font-semibold text-fox-text">Your cart is empty</h2>
            <p className="text-sm text-fox-muted">Pick something out first, then come back here to check out.</p>
            <Link href={backHref} className="btn-primary mt-2">
              Continue shopping
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="card divide-y divide-fox-border/60 p-0">
              {lines.map((l) => (
                <div key={l.card.id} className="flex items-center gap-4 p-4 sm:p-5">
                  <div
                    className="h-16 w-16 shrink-0 rounded-xl bg-fox-bg/60 bg-cover bg-center"
                    style={l.card.imageUrl ? { backgroundImage: `url(${l.card.imageUrl})` } : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    {l.card.subLabel && (
                      <p className="text-xs uppercase tracking-wide text-fox-muted">{l.card.subLabel}</p>
                    )}
                    <h3 className="truncate font-medium text-fox-text">{l.card.name}</h3>
                    <p className="text-sm font-semibold text-fox-primary">{format(l.card.priceUsd)}</p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {allowQuantity ? (
                      <div className="flex items-center gap-1 rounded-lg border border-fox-border bg-fox-bg/60 px-1.5 py-1">
                        <button
                          type="button"
                          onClick={() => changeQty(kind, l.card.id, -1, l.card.maxQty)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-fox-text hover:bg-fox-card"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold">{l.quantity}</span>
                        <button
                          type="button"
                          disabled={!!l.card.maxQty && l.quantity >= l.card.maxQty}
                          onClick={() => changeQty(kind, l.card.id, 1, l.card.maxQty)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-fox-text hover:bg-fox-card disabled:opacity-30 disabled:hover:bg-transparent"
                          aria-label="Increase quantity"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-fox-muted">Qty {l.quantity}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeLine(kind, l.card.id)}
                      className="flex items-center gap-1 text-xs text-red-400 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="card flex items-center justify-between p-5 sm:p-6">
              <span className="text-sm text-fox-muted">Subtotal</span>
              <span className="font-display text-xl font-bold text-fox-primary">{format(subtotal)}</span>
            </div>

            <button
              type="button"
              onClick={() => router.push(checkoutHref)}
              className="btn-primary w-full"
            >
              Checkout
              <ShoppingCart className="h-5 w-5" />
            </button>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
