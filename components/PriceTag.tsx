"use client";

import DualPrice from "./DualPrice";

export default function PriceTag({
  priceUsd,
  className,
}: {
  priceUsd: number;
  className?: string;
}) {
  return <DualPrice usd={priceUsd} className={className} />;
}
