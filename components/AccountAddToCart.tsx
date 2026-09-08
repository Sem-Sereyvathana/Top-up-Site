"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useCurrency } from "@/lib/currency";
import { useShopCart } from "@/lib/shopCart";
import type { ShopCartCard } from "@/components/ShopCartBrowser";
import { Plus, Minus, ShoppingCart, Check, MessageCircle } from "lucide-react";

// Mirrors the Add/quantity controls on the Accounts grid (ShopCartBrowser)
// but for a single card on its dedicated details page.
export default function AccountAddToCart({ card }: { card: ShopCartCard }) {
  const { format } = useCurrency();
  const router = useRouter();
  const { linesFor, toggleCard, changeQty } = useShopCart();

  const qty = useMemo(() => {
    const line = linesFor("accounts").find((l) => l.card.id === card.id);
    return line?.quantity ?? 0;
  }, [linesFor, card.id]);

  const inCart = qty > 0;
  const effectiveMax = card.maxQty ?? 1;
  const cardAllowsQty = effectiveMax > 1;

  if (card.soldOut) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300">
        This account is no longer available.
      </div>
    );
  }

  // One-of-a-kind account set up by admin as a display-only listing — no
  // cart, no online checkout. Buying it means talking to admin directly.
  if (card.contactAdminUrl) {
    return (
      <a
        href={card.contactAdminUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fox-primary to-fox-accent py-3 text-sm font-bold text-black hover:opacity-90"
      >
        <MessageCircle className="h-4 w-4" strokeWidth={2.5} />
        Buy — Contact Admin
      </a>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {cardAllowsQty ? (
        inCart ? (
          <div className="flex items-center justify-between rounded-xl border border-fox-primary/40 bg-fox-bg/60 px-3 py-2.5">
            <button
              type="button"
              onClick={() => changeQty("accounts", card.id, -1, effectiveMax)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-fox-text hover:bg-fox-card"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-base font-semibold">{qty}</span>
            <button
              type="button"
              disabled={qty >= effectiveMax}
              onClick={() => changeQty("accounts", card.id, 1, effectiveMax)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-fox-text hover:bg-fox-card disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => toggleCard("accounts", card)}
            className="btn-primary w-full"
          >
            <Plus className="h-4 w-4" /> Add to cart
          </button>
        )
      ) : inCart ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-fox-primary/40 bg-fox-primary/10 px-4 py-3 text-sm font-semibold text-fox-primary">
          <Check className="h-4 w-4" strokeWidth={3} /> In your cart
        </div>
      ) : (
        <button
          type="button"
          onClick={() => toggleCard("accounts", card)}
          className="btn-primary w-full"
        >
          <Plus className="h-4 w-4" /> Add to cart
        </button>
      )}

      {inCart && (
        <button
          type="button"
          onClick={() => router.push("/accounts/checkout")}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fox-primary to-fox-accent py-3 text-sm font-bold text-black hover:opacity-90"
        >
          <ShoppingCart className="h-4 w-4" strokeWidth={2.5} />
          Go to Checkout · {format(card.priceUsd * qty)}
        </button>
      )}
    </div>
  );
}
