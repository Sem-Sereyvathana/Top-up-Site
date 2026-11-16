"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useCurrency } from "@/lib/currency";
import { useShopCart } from "@/lib/shopCart";
import { ArrowLeft, Minus, Plus, ShoppingCart, Trash2, Gamepad2, Store } from "lucide-react";

// COMBINED cart — every line the shopper has picked across the two
// marketplace carts (Game Items + Accounts) in one list, checked out in a
// single payment.
//
// Top-up packages are never part of a cart: they are picked on the game page
// and paid from there, on their own separate checkout.
export default function CombinedCartPage() {
  const router = useRouter();
  const { format } = useCurrency();
  const { linesFor, changeQty, removeLine } = useShopCart();

  const itemLines = linesFor("items");
  const accountLines = linesFor("accounts");
  const groups = [
    { key: "items" as const, label: "Game Items", Icon: Gamepad2, lines: itemLines },
    { key: "accounts" as const, label: "Accounts", Icon: Store, lines: accountLines },
  ].filter((g) => g.lines.length > 0);

  const total = [...itemLines, ...accountLines].reduce((s, l) => s + l.card.priceUsd * l.quantity, 0);

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/");
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
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Cart</h1>
        </div>

        {groups.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-fox-border/70 bg-fox-card/40 px-6 py-16 text-center backdrop-blur-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent shadow-lg shadow-fox-primary/30">
              <ShoppingCart className="h-6 w-6 text-black" />
            </div>
            <h2 className="text-lg font-semibold text-fox-text">Your cart is empty</h2>
            <p className="text-sm text-fox-muted">Pick something out first, then come back here to check out.</p>
            <Link href="/" className="btn-primary mt-2">Continue shopping</Link>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.key}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fox-muted">
                  <group.Icon className="h-4 w-4" />
                  {group.label}
                </h2>
                <div className="card divide-y divide-fox-border/60 p-0">
                  {group.lines.map((l) => (
                    <div key={l.card.id} className="flex items-center gap-4 p-4 sm:p-5">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-fox-bg/60">
                        {l.card.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.card.imageUrl} alt={l.card.name} loading="lazy" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        {l.card.subLabel && (
                          <p className="text-xs uppercase tracking-wide text-fox-muted">{l.card.subLabel}</p>
                        )}
                        <h3 className="truncate font-medium text-fox-text">{l.card.name}</h3>
                        <p className="text-sm font-semibold text-fox-primary">{format(l.card.priceUsd)}</p>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <div className="flex items-center gap-1 rounded-lg border border-fox-border bg-fox-bg/60 px-1.5 py-1">
                          <button
                            type="button"
                            onClick={() => changeQty(group.key, l.card.id, -1, l.card.maxQty)}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-fox-text hover:bg-fox-card"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-6 text-center text-sm font-semibold">{l.quantity}</span>
                          <button
                            type="button"
                            disabled={!!l.card.maxQty && l.quantity >= l.card.maxQty}
                            onClick={() => changeQty(group.key, l.card.id, 1, l.card.maxQty)}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-fox-text hover:bg-fox-card disabled:opacity-30"
                            aria-label="Increase quantity"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(group.key, l.card.id)}
                          className="flex items-center gap-1 text-xs text-red-400 hover:underline"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="card flex items-center justify-between p-5 sm:p-6">
              <span className="text-sm text-fox-muted">តម្លៃសរុប</span>
              <span className="font-display text-xl font-bold text-fox-primary">{format(total)}</span>
            </div>

            <button
              type="button"
              onClick={() => router.push("/cart/checkout")}
              className="btn-primary w-full"
            >
              ទិញឥឡូវនេះ
              <ShoppingCart className="h-5 w-5" />
            </button>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
