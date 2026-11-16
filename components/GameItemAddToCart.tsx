"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useCurrency } from "@/lib/currency";
import { useShopCart } from "@/lib/shopCart";
import type { ShopCartCard } from "@/components/ShopCartBrowser";
import { Plus, Minus, ShoppingCart } from "lucide-react";

// Mirrors the Add/quantity controls on the Game Items grid (ShopCartBrowser)
// but for a single card on its dedicated details page. Modeled directly on
// AccountAddToCart.tsx — same layout, wired to the "items" cart instead.
//
// "Buy now" always goes to the COMBINED checkout (/cart/checkout) and shows
// the FULL cart total — items + accounts — because that's what will actually
// be paid, no matter where the buy button was clicked.
export default function GameItemAddToCart({ card }: { card: ShopCartCard }) {
  const { format } = useCurrency();
  const router = useRouter();
  const { linesFor, toggleCard, changeQty, removeLine } = useShopCart();

  const qty = useMemo(() => {
    const line = linesFor("items").find((l) => l.card.id === card.id);
    return line?.quantity ?? 0;
  }, [linesFor, card.id]);

  // The combined cart's total across BOTH marketplace carts — the button
  // below checks out everything, so it advertises everything.
  const cartTotal = useMemo(
    () =>
      [...linesFor("items"), ...linesFor("accounts")].reduce(
        (s, l) => s + l.card.priceUsd * l.quantity,
        0
      ),
    [linesFor]
  );

  const inCart = qty > 0;
  const effectiveMax = card.maxQty ?? 20;
  const cardAllowsQty = effectiveMax > 1;

  if (card.soldOut) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300">
        អស់ហើយ
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {cardAllowsQty ? (
        inCart ? (
          <div className="flex items-center justify-between rounded-xl border border-fox-primary/40 bg-fox-bg/60 px-3 py-2.5">
            <button
              type="button"
              onClick={() => changeQty("items", card.id, -1, effectiveMax)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-fox-text hover:bg-fox-card"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-base font-semibold">{qty}</span>
            <button
              type="button"
              disabled={qty >= effectiveMax}
              onClick={() => changeQty("items", card.id, 1, effectiveMax)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-fox-text hover:bg-fox-card disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => toggleCard("items", card)}
            className="btn-primary w-full"
          >
            <Plus className="h-4 w-4" /> ដាក់ចូលកន្ត្រក
          </button>
        )
      ) : inCart ? (
        <button
          type="button"
          onClick={() => removeLine("items", card.id)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400 hover:bg-red-500/20"
        >
          Remove from cart
        </button>
      ) : (
        <button
          type="button"
          onClick={() => toggleCard("items", card)}
          className="btn-primary w-full"
        >
          <Plus className="h-4 w-4" /> ដាក់ចូលកន្ត្រក
        </button>
      )}

      {inCart && (
        <button
          type="button"
          onClick={() => router.push("/cart/checkout")}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fox-primary to-fox-accent py-3 text-sm font-bold text-black hover:opacity-90"
        >
          <ShoppingCart className="h-4 w-4" strokeWidth={2.5} />
          ទិញឥឡូវនេះ · {format(cartTotal)}
        </button>
      )}
    </div>
  );
}
