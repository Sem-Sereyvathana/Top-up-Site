"use client";

import { useCurrency } from "@/lib/currency";

/** Price with USD and KHR side by side (or stacked when `stacked`). */
export default function DualPrice({
  usd,
  className = "",
  khrClassName = "",
  stacked = false,
}: {
  usd: number;
  className?: string;
  khrClassName?: string;
  stacked?: boolean;
}) {
  const { toKhr } = useCurrency();
  return (
    <span
      className={`inline-flex ${
        stacked ? "flex-col" : "flex-wrap items-baseline gap-x-2"
      } ${className}`}
    >
      <span>${usd.toFixed(2)}</span>
      <span className={`text-[0.65em] font-semibold text-fox-muted ${khrClassName}`}>
        {toKhr(usd).toLocaleString("en-US")} ៛
      </span>
    </span>
  );
}
