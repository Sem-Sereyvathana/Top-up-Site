"use client";

import { useEffect, useState } from "react";

export interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  linkUrl: string | null;
  ctaLabel: string | null;
}

const FALLBACK_BANNERS: Banner[] = [
  {
    id: "fallback-1",
    title: "Promo 1",
    subtitle: null,
    imageUrl:
      "https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1200&auto=format&fit=crop",
    linkUrl: null,
    ctaLabel: null,
  },
  {
    id: "fallback-2",
    title: "Promo 2",
    subtitle: null,
    imageUrl:
      "https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=1200&auto=format&fit=crop",
    linkUrl: null,
    ctaLabel: null,
  },
];

export default function HeroCarousel({ banners }: { banners: Banner[] }) {
  const [idx, setIdx] = useState(0);

  const displayBanners =
    banners && banners.length > 0 ? banners : FALLBACK_BANNERS;

  useEffect(() => {
    if (displayBanners.length <= 1) return;
    const t = setInterval(
      () => setIdx((i) => (i + 1) % displayBanners.length),
      4000
    );
    return () => clearInterval(t);
  }, [displayBanners.length]);

  return (
    <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="relative h-48 sm:h-72 lg:h-80 w-full overflow-hidden rounded-2xl border border-fox-border bg-fox-card shadow-2xl pointer-events-none select-none">
        {displayBanners.map((banner, i) => (
          <div
            key={banner.id || i}
            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
              i === idx ? "opacity-100 z-10" : "opacity-0 z-0"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={banner.imageUrl}
              alt={banner.title || "Display Banner"}
              className="h-full w-full object-cover"
            />
          </div>
        ))}

        {/* Minimal dot indicators */}
        {displayBanners.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-2">
            {displayBanners.map((_, i) => (
              <div
                key={i}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === idx ? "w-6 bg-fox-primary" : "w-2 bg-white/50"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}