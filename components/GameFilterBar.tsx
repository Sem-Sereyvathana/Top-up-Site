"use client";

import GameCard from "@/components/GameCard";
import TrendingGameCard from "@/components/TrendingGameCard";

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

// Home-page game grid.
//
// The old category pills ("ALL GAMES", per-group tabs) and the inline search
// box were removed: search now lives in the header and opens its own results
// page, and the grid no longer needs filtering. Games you mark "featured"
// (the HOT flag in Admin → Games) are pulled out into a highlighted
// "Trending Game" row above the main grid.
export default function GameFilterBar({ games }: { games: GameForFilter[] }) {
  const trending = games.filter((g) => g.featured).slice(0, 12);

  return (
    <div>
      {trending.length > 0 && (
        <div className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-fox-gold" aria-hidden>★</span>
            <h2 className="font-display text-base font-bold sm:text-lg">Trending Game</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
            {trending.map((game, i) => (
              <div key={game.id} className="fade-up" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
                <TrendingGameCard
                  slug={game.slug}
                  name={game.name}
                  imageUrl={game.imageUrl}
                  active={game.active}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <span className="text-fox-primary" aria-hidden>🎮</span>
        <h2 className="font-display text-base font-bold sm:text-lg">All Games</h2>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        {games.map((game, i) => (
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

      {games.length === 0 && (
        <div className="text-center py-16 text-fox-muted">
          <p>No games available yet.</p>
        </div>
      )}
    </div>
  );
}
