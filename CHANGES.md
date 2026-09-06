# Multi-package Robux selection + combined admin total

Drop these files into your project at the same paths (they overwrite the
existing files). Nothing outside this list was touched — every other game's
top-up page and flow is byte-for-byte the same as before.

## What changed

1. **`components/TopUpForm.tsx`**
   Robux/Roblox package grid is now multi-select: tap a package to add it,
   tap again to remove it, use the +/− stepper to change quantity. You can
   combine as many packages as you like in one checkout. Every other game's
   package grid still works exactly like before (single pick).
   The order summary (desktop sidebar + mobile sticky bar) now lists each
   picked package and the combined Robux total when on the Robux page.

   (The backend for this — the `OrderItem` table, `/api/orders` accepting
   an `items[]` array, and stock checks — already existed in your project;
   it just wasn't wired up to the UI yet. I only touched the UI.)

2. **Admin — Orders list** (`app/admin/(protected)/orders/page.tsx` +
   `app/api/admin/orders/route.ts`)
   A multi-package order now shows as **one row** with the combined Robux
   total, e.g. `1,100 Robux (2 packages)`, instead of just the first
   package's name.

3. **Admin — Order detail page**
   (`app/admin/(protected)/orders/[orderNumber]/page.tsx` +
   `app/api/admin/orders/[orderNumber]/route.ts`)
   Shows the combined total plus a per-package breakdown line, and the
   "copy package" quick-action button copies the combined total.

4. **Admin — Dashboard homepage** (`app/admin/(protected)/page.tsx`)
   Recent-orders table shows the same combined total for cart orders.

5. **Admin — CSV export** (`app/api/admin/orders/export/route.ts`)
   The "Product" column shows the combined total for cart orders.

6. **Admin — Telegram "new paid order" notification**
   (`app/api/payment/webhook/[method]/route.ts`)
   Shows the combined Robux total instead of just the first package, so
   whoever fulfills orders from Telegram sees the right number.
   (Also fixed some mangled/garbled characters — 💰 and — — that were
   broken encoding in the original file; purely cosmetic, no logic change.)

7. **Customer checkout page** (`app/checkout/[orderNumber]/page.tsx`)
   Shows the combined total + per-package breakdown for cart orders instead
   of just the first package.

8. **Customer order-confirmation page** (`app/order/page.tsx`)
   Same fix as checkout — shows the full multi-package breakdown.

9. **PDF invoice** (`app/api/orders/[orderNumber]/invoice/route.ts`)
   The items table now renders one row per package for cart orders. A
   normal single-package order still renders exactly the same single row
   as before (including the exact same TOTAL/discount handling).

## Why these last few (7–9) were included

You asked for multi-select on the Robux page and a combined total in the
admin dashboard. Once multiple packages can be picked, the customer's own
checkout screen, order-confirmation screen, and downloadable invoice would
otherwise still only show the *first* package — which would look like a
bug/mistake to the customer. I fixed those too so the whole flow is
consistent end to end. If you'd rather I hadn't touched those, they're
easy to revert — just don't copy files 7–9 back in.

## Not touched

- Every other game's top-up page/flow (single-select, unchanged).
- Database schema — no migration needed, the `OrderItem` table already
  existed in your `prisma/schema.prisma`.
- The "recent orders" ticker on the homepage and the order-lookup-by-email
  search results still show just the first package name — these are
  decorative/lightweight, not receipts, so I left them as-is to keep the
  change set minimal.

## To apply

Copy the files into your repo at the matching paths, then:

```
npm run build   # or npm run dev
```

No `prisma migrate` needed — no schema changes.
