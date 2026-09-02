"use client";

import { useCurrency } from "@/lib/currency";

export default function PriceTag({
  priceUsd,
  className,
}: {
  priceUsd: number;
  className?: string;
}) {
  const { format } = useCurrency();
  return <span className={className}>{format(priceUsd)}</span>;
}
