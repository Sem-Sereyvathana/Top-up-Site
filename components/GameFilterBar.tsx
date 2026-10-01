"use client";

import { useState } from "react";
import GameCard from "@/components/GameCard";

interface GameForFilter {
  id: string;
  slug: string;
  name: string;
  groupName?: string | null;
  publisher: string | null;
  currencyName: string;
  imageUrl: string;
  featured: boolean;
  active: boolean;
}

export default function GameFilterBar({ games }: { games: GameForFilter[] }) {
  const [selected, setSelected] = useState<string>("All");

  // A game may belong to a group (e.g. each Mobile Legends server is its own game
  // but they all share one tab). Games without a group keep their own name as tab.
  const tabOf = (g: GameForFilter) => (g.groupName && g.groupName.trim()) || g.name;
  const tabs = Array.from(new Set(games.map(tabOf)));

  const visible = selected === "All" ? games : games.filter((g) => tabOf(g) === selected);

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-1.5 sm:gap-3">
        <button
          type="button"
          onClick={() => setSelected("All")}
          className={
            selected === "All"
              ? "rounded-full bg-gradient-to-r from-fox-primary to-fox-accent px-2.5 py-1 text-[10px] sm:px-4 sm:py-2 sm:text-sm font-bold uppercase tracking-wide sm:tracking-wider text-black"
              : "rounded-full border border-fox-border/60 bg-fox-card px-2.5 py-1 text-[10px] sm:px-4 sm:py-2 sm:text-sm font-bold uppercase tracking-wide sm:tracking-wider text-fox-muted transition-colors hover:text-white"
          }
        >
          All Games
        </button>
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSelected(tab)}
            className={
              selected === tab
                ? "rounded-full bg-gradient-to-r from-fox-primary to-fox-accent px-2.5 py-1 text-[10px] sm:px-4 sm:py-2 sm:text-sm font-bold uppercase tracking-wide sm:tracking-wider text-black"
                : "rounded-full border border-fox-border/60 bg-fox-card px-2.5 py-1 text-[10px] sm:px-4 sm:py-2 sm:text-sm font-bold uppercase tracking-wide sm:tracking-wider text-fox-muted transition-colors hover:text-white"
            }
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4">
        {visible.map((game, i) => (
          <div key={game.id} className="fade-up" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
            <GameCard
              slug={game.slug}
              name={game.name}
              publisher={game.publisher}
              currencyName={game.currencyName}
              imageUrl={game.imageUrl}
              featured={game.featured}
              active={game.active}
            />
          </div>
        ))}
      </div>

      {visible.length === 0 && (
        <div className="text-center py-16 text-fox-muted">
          <p>No games match this filter.</p>
        </div>
      )}
    </div>
  );
}
