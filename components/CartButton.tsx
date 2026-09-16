"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { useShopCart, ShopKind } from "@/lib/shopCart";

// Shared navbar cart widget for both marketplaces — Game Items and
// Accounts each have their own cart (see lib/shopCart.tsx's per-kind
// storage), so this takes `kind` to know which one to show.
//
// This used to open an inline dropdown panel anchored under the icon, but
// on narrow screens the panel (fixed width) could overflow past the edge
// of the viewport with no way to scroll to the clipped part — item names
// got cut off and were unreadable. It's just a link to a dedicated cart
// page now (see ShopCartPage.tsx), which has all the room it needs and a
// back button of its own.

export default function CartButton({
  kind,
  cartHref,
  className = "",
}: {
  kind: ShopKind;
  cartHref: string;
  className?: string;
}) {
  const { countFor } = useShopCart();
  const totalCount = countFor(kind);

  return (
    <Link
      href={cartHref}
      aria-label="Cart"
      className={`relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-fox-border bg-fox-card/80 text-fox-text transition-colors hover:border-fox-primary/60 hover:text-fox-primary ${className}`}
    >
      <ShoppingCart className="h-5 w-5" />
      {totalCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-r from-fox-primary to-fox-accent px-1 text-[10px] font-bold text-black shadow-md shadow-fox-primary/40">
          {totalCount > 99 ? "99+" : totalCount}
        </span>
      )}
    </Link>
  );
}
