"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";

// Polls the public stock endpoint so this stays in sync with whatever the
// admin sets on the Robux Stock page, without needing a page refresh.
const POLL_MS = 15000;

export default function RobuxStockBadge() {
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const r = await fetch("/api/robux-stock", { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setTotal(data.totalRobux);
      } catch {
        // Ignore transient errors — keep showing the last known value.
      }
    }

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (total === null) return null;

  const inStock = total > 0;

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
        inStock
          ? "border-green-400/30 bg-green-500/10 text-green-300"
          : "border-red-400/30 bg-red-500/10 text-red-300"
      }`}
    >
      <Coins className="h-3.5 w-3.5" strokeWidth={2.5} />
      {inStock ? (
        <span>{total.toLocaleString()} Robux available in stock</span>
      ) : (
        <span>Out of stock — check back soon</span>
      )}
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${inStock ? "animate-pulse" : ""}`} />
    </div>
  );
}
