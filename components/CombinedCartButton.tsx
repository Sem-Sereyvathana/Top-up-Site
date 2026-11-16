"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { useShopCart } from "@/lib/shopCart";

// Header cart button for the COMBINED cart. Its badge counts both
// marketplace carts together (Game Items + Accounts), because that's what
// the combined checkout pays for in one go.
export default function CombinedCartButton({ className = "" }: { className?: string }) {
  const { countFor } = useShopCart();
  const total = countFor("items") + countFor("accounts");

  return (
    <Link
      href="/cart"
      aria-label="Cart"
      className={`relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-fox-border bg-fox-card/80 text-fox-text transition-colors hover:border-fox-primary/60 hover:text-fox-primary ${className}`}
    >
      <ShoppingCart className="h-5 w-5" />
      {total > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-r from-fox-primary to-fox-accent px-1 text-[10px] font-bold text-black shadow-md shadow-fox-primary/40">
          {total > 99 ? "99+" : total}
        </span>
      )}
    </Link>
  );
}
