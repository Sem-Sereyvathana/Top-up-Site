"use client";

import { useMemo, useState } from "react";
import PriceTag from "@/components/PriceTag";

export interface GameItemForBrowser {
  id: string;
  name: string;
  imageUrl: string | null;
  priceUsd: number;
  badge: string | null;
  Category: {
    name: string;
    slug: string;
    imageUrl: string | null;
    sortOrder: number;
  } | null;
}

interface CategoryGroup {
  key: string;
  label: string;
  imageUrl: string | null;
  sortOrder: number;
  items: GameItemForBrowser[];
}

const GENERAL_KEY = "__general__";
const ALL_KEY = "__all__";

export default function GameItemsBrowser({
  items,
}: {
  items: GameItemForBrowser[];
}) {
  const [selected, setSelected] = useState<string>(ALL_KEY);

  const groups = useMemo(() => {
    const map = new Map<string, CategoryGroup>();

    for (const item of items) {
      const key = item.Category?.slug ?? GENERAL_KEY;
      const existing = map.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(key, {
          key,
          label: item.Category?.name ?? "General",
          imageUrl: item.Category?.imageUrl ?? null,
          sortOrder: item.Category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
          items: [item],
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.key === GENERAL_KEY) return 1;
      if (b.key === GENERAL_KEY) return -1;
      return a.sortOrder - b.sortOrder;
    });
  }, [items]);

  const visibleGroups =
    selected === ALL_KEY ? groups : groups.filter((g) => g.key === selected);

  return (
    <div>
      {/* Category pill bar */}
      <div className="mb-8 flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <CategoryPill
          active={selected === ALL_KEY}
          label="Tất cả sản phẩm"
          onClick={() => setSelected(ALL_KEY)}
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
              <path
                d="M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          }
        />
        {groups.map((g) => (
          <CategoryPill
            key={g.key}
            active={selected === g.key}
            label={g.label}
            onClick={() => setSelected(g.key)}
            icon={
              g.imageUrl ? (
                <span
                  className="h-5 w-5 shrink-0 rounded bg-cover bg-center"
                  style={{ backgroundImage: `url(${g.imageUrl})` }}
                />
              ) : undefined
            }
          />
        ))}
      </div>

      {visibleGroups.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-10">
          {visibleGroups.map((group) => (
            <section key={group.key}>
              <div className="mb-4 flex items-center gap-3 rounded-xl bg-gradient-to-r from-fox-primary to-fox-accent px-4 py-3 shadow-glow-sm">
                {group.imageUrl && (
                  <span
                    className="h-6 w-6 shrink-0 rounded bg-cover bg-center"
                    style={{ backgroundImage: `url(${group.imageUrl})` }}
                  />
                )}
                <h2 className="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
                  {group.label}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {group.items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-fox-border/70 bg-fox-card/50 p-4 backdrop-blur-md transition-transform hover:-translate-y-1 hover:border-fox-primary/60"
                  >
                    <div
                      className="mb-3 aspect-square rounded-xl bg-fox-bg/60 bg-cover bg-center"
                      style={
                        item.imageUrl
                          ? { backgroundImage: `url(${item.imageUrl})` }
                          : undefined
                      }
                    />
                    {item.badge && (
                      <span className="mb-1 inline-block rounded-full bg-fox-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fox-primary">
                        {item.badge}
                      </span>
                    )}
                    <p className="text-xs uppercase tracking-wide text-fox-muted">
                      {item.Category?.name || "General"}
                    </p>
                    <h3 className="mt-1 font-medium text-fox-text">
                      {item.name}
                    </h3>
                    <PriceTag
                      priceUsd={item.priceUsd}
                      className="mt-2 block text-sm font-semibold text-fox-primary"
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryPill({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors sm:text-sm " +
        (active
          ? "border-fox-primary bg-fox-primary text-white shadow-glow-sm"
          : "border-fox-border/70 bg-fox-card/60 text-fox-text hover:border-fox-primary/60")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-fox-border/70 bg-fox-card/40 px-6 py-16 text-center backdrop-blur-md">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent shadow-lg shadow-fox-primary/30">
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-black">
          <path
            d="M20 7L12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-fox-text">
        Items coming soon
      </h2>
      <p className="text-sm text-fox-muted">
        We&apos;re stocking the shelves. Check back shortly for skins,
        bundles, and rare in-game items.
      </p>
    </div>
  );
}
