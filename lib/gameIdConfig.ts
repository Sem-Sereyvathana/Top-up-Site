// Which games get the "Check User ID" (nickname verification) feature, and
// how their ID form looks. Pure data — safe to import from client and server.
//
// To add a game: add one entry here (slug pattern + whether it has a
// separate Zone/Server box), then teach lib/uidLookup.ts (or the paid
// provider in lib/idCheckProvider.ts) how to look it up.

export type GameIdKey =
  | "mobile-legends"
  | "free-fire"
  | "pubg-mobile"
  | "magic-chess";

export interface GameIdConfig {
  key: GameIdKey;
  /** Matched against the game's slug, e.g. mobile-legend-cambodia */
  match: RegExp;
  /** true → shows a separate Zone ID box next to User ID */
  needsServer: boolean;
  /** Label / placeholder of that second box (each game names it differently). */
  serverLabel?: string;
  serverPlaceholder?: string;
}

export const GAME_ID_CONFIGS: GameIdConfig[] = [
  // Also matches the singular spelling and per-server slugs
  // (mobile-legend, mobile-legends-khmer, mobile-legend-cambodia, ...).
  { key: "mobile-legends", match: /^mobile-legends?(-|$)/, needsServer: true, serverLabel: "Zone ID", serverPlaceholder: "1234" },
  { key: "free-fire", match: /^free-fire(-|$)/, needsServer: false },
  // These are checked through the SabayStore supplier (lib/idCheckProvider.ts)
  // and need the game to be linked with `npm run db:sync-sabay`.
  { key: "pubg-mobile", match: /^pubg(-|$)/, needsServer: false },
  { key: "magic-chess", match: /^magic-chess(-|$)/, needsServer: true, serverLabel: "Server ID", serverPlaceholder: "1234" },
];

// Your store game slug -> SabayStore game slug. Used by the ID check when a
// game has not been linked yet with `npm run db:sync-sabay` (Game.supplierSlug
// empty). Keep in sync with DEFAULT_LINKS in prisma/scripts/sync-sabay-packages.ts.
// The supplier slug decides the region, so every server/region of a game is
// checked against its own supplier game.
export const SUPPLIER_SLUG_FALLBACK: Record<string, string> = {
  "valorant-th": "valorant-th",
  "valorant-philippines": "valorant-ph",
  "valorant-khmer": "valorant-kh",
  "valorant-indonesia": "valorant-id",
  "magic-chess-go-go-global": "magic-chess-go-go-global",
  "free-fire-philippines": "free-fire-ph",
  "free-fire-indonesia": "free-fire-id",
  "free-fire-global": "free-fire-my-sg",
  "mobile-legend-indonesia": "mobile-legends-indonesia",
  "mobile-legend-philippines": "mobile-legends-philippines",
  "mobile-legend-cambodia": "mobile-legends-global",
  "eafc-mobile-khmer": "eafc-mobile-kh",
  "8-ball-pool-global": "8-ball-pool",
  "league-of-legends-khmer": "league-of-legends-kh",
  "pubg-mobile": "pubg-mobile-auto",
};

/** null → no lookup is set up for this game yet. */
export function getGameIdConfig(slug: string): GameIdConfig | null {
  return GAME_ID_CONFIGS.find((c) => c.match.test(slug)) ?? null;
}

export type LookupResult =
  | { status: "verified"; name: string }
  | { status: "not_found" } // the service answered: this ID doesn't exist
  | { status: "unavailable" } // the service failed / timed out
  | { status: "unsupported" }; // no lookup set up for this game yet
