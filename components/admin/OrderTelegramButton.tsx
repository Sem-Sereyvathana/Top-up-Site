"use client";

import { useEffect, useState } from "react";

// "Telegram" button for admin order rows (Robux + Quick Login queues).
// Opens a direct chat with the BUYER's Telegram account (t.me/<username>)
// — live chat was removed in favour of Telegram. The buyer's telegram
// username arrives with their order when they sign in with Telegram.
//
// The order rows pass whatever buyer identity they already have; this
// component just renders the link state (no username -> disabled with a
// tooltip). Nothing here calls an API — it's a plain link.

export default function OrderTelegramButton({
  buyerTelegramUsername,
  orderNumber,
}: {
  buyerTelegramUsername: string | null | undefined;
  orderNumber: string;
}) {
  const handle = (buyerTelegramUsername ?? "").replace(/^@/, "").trim();

  if (!handle || !/^[A-Za-z0-9_]{3,32}$/.test(handle)) {
    return (
      <span
        className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-fox-muted/60 cursor-not-allowed"
        title={`No Telegram on file for the buyer of ${orderNumber} (guest or Google sign-in)`}
      >
        ✈️ No Telegram
      </span>
    );
  }

  return (
    <a
      href={`https://t.me/${handle}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open Telegram chat with @${handle} (buyer of ${orderNumber})`}
      className="inline-flex items-center rounded-lg border border-blue-400/40 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold text-blue-300 transition-colors hover:bg-blue-400/20"
    >
      ✈️ @{handle}
    </a>
  );
}
