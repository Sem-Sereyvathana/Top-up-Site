"use client";

import { useEffect, useState } from "react";
import { Activity, Coins, Sparkles } from "lucide-react";

// Polls the public stock endpoint so this stays in sync with whatever the
// admin sets on the Robux Stock page, without needing a page refresh.
const POLL_MS = 15000;

export default function RobuxStockBadge({ compact = false, initialTotal = null, onTotalChange }: { compact?: boolean; initialTotal?: number | null; onTotalChange?: (total: number) => void }) {
  const [total, setTotal] = useState<number | null>(initialTotal);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const r = await fetch("/api/robux-stock", { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) {
          setTotal(data.totalRobux);
          onTotalChange?.(data.totalRobux);
        }
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
  }, [onTotalChange]);

  if (total === null) return null;

  const inStock = total > 0;

  if (compact) {
    return (
      <div
        className={`mt-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${
          inStock
            ? "border-emerald-400/20 bg-emerald-400/[0.07]"
            : "border-red-400/20 bg-red-400/[0.07]"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${inStock ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}>
            <Coins className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-fox-muted">Robux stock</div>
            <div className="truncate text-sm font-bold text-fox-text">
              {inStock ? `${total.toLocaleString()} available` : "Out of stock"}
            </div>
          </div>
        </div>
        <span className={`h-2 w-2 shrink-0 rounded-full ${inStock ? "bg-emerald-300 animate-pulse" : "bg-red-300"}`} />
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 ${
        inStock
          ? "border-emerald-400/25 bg-gradient-to-br from-emerald-400/[0.08] via-fox-card/70 to-fox-card/40 shadow-lg shadow-emerald-500/5"
          : "border-red-400/25 bg-gradient-to-br from-red-400/[0.08] via-fox-card/70 to-fox-card/40"
      }`}
    >
      <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-emerald-400/10 blur-3xl" />
      <div className="relative flex items-center justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-fox-muted">
            <Activity className="h-3.5 w-3.5" strokeWidth={2.5} />
            Live stock
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`font-display text-3xl font-bold leading-none sm:text-4xl ${inStock ? "text-emerald-300" : "text-red-300"}`}>
              {inStock ? total.toLocaleString() : "0"}
            </span>
            <span className="text-sm font-semibold text-fox-muted">Robux</span>
          </div>
          <p className="mt-2 text-xs text-fox-muted">{inStock ? "Available for instant delivery" : "Currently unavailable"}</p>
        </div>

        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${inStock ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-300" : "border-red-300/20 bg-red-300/10 text-red-300"}`}>
          {inStock ? <Sparkles className="h-5 w-5" strokeWidth={2.2} /> : <Coins className="h-5 w-5" strokeWidth={2.2} />}
        </div>
      </div>

      <div className="relative mt-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
        <span className={`h-2 w-2 rounded-full ${inStock ? "bg-emerald-300 animate-pulse" : "bg-red-300"}`} />
        <span className={inStock ? "text-emerald-300" : "text-red-300"}>
          {inStock ? "In stock now" : "Out of stock"}
        </span>
        <span className="text-fox-muted">• updated live</span>
      </div>
    </div>
  );
}
