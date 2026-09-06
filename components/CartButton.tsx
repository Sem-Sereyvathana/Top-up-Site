"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ShoppingCart, X } from "lucide-react";
import { useShopCart } from "@/lib/shopCart";
import { useCurrency } from "@/lib/currency";

// Cart is scoped to the Game Items marketplace only — Accounts are unique,
// one-off listings (no quantity, no real "cart" concept), so they're bought
// straight from /accounts and never show up in this navbar widget.

export default function CartButton({ className = "" }: { className?: string }) {
  const { linesFor, countFor, removeLine } = useShopCart();
  const { format } = useCurrency();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const itemLines = linesFor("items");
  const totalCount = countFor("items");
  const subtotal = itemLines.reduce((sum, l) => sum + l.card.priceUsd * l.quantity, 0);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Cart"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-fox-border bg-fox-card/80 text-fox-text transition-colors hover:border-fox-primary/60 hover:text-fox-primary"
      >
        <ShoppingCart className="h-5 w-5" />
        {totalCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-r from-fox-primary to-fox-accent px-1 text-[10px] font-bold text-black shadow-md shadow-fox-primary/40">
            {totalCount > 99 ? "99+" : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] rounded-2xl border border-fox-border bg-fox-surface/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-bold uppercase tracking-wider text-fox-muted">
              Game Items Cart
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-fox-muted hover:text-fox-text"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {itemLines.length === 0 ? (
            <p className="py-6 text-center text-sm text-fox-muted">Your cart is empty.</p>
          ) : (
            <div>
              <div className="space-y-2">
                {itemLines.map((l) => (
                  <div key={l.card.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-fox-text">
                      {l.card.name}
                      {l.quantity > 1 ? ` ×${l.quantity}` : ""}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-xs text-fox-muted">
                        {format(l.card.priceUsd * l.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLine("items", l.card.id)}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-fox-border pt-2">
                <span className="text-xs text-fox-muted">Subtotal</span>
                <span className="text-sm font-bold text-fox-primary">{format(subtotal)}</span>
              </div>

              <Link
                href="/game-items/checkout"
                onClick={() => setOpen(false)}
                className="btn-primary mt-3 w-full !py-2 text-sm"
              >
                Checkout
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
