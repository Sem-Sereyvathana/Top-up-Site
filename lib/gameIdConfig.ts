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
  // These are checked through the FazerCards supplier (lib/idCheckProvider.ts).
  { key: "pubg-mobile", match: /^pubg(-|$)/, needsServer: false },
  { key: "magic-chess", match: /^magic-chess(-|$)/, needsServer: true, serverLabel: "Server ID", serverPlaceholder: "1234" },
];

/** null → no lookup is set up for this game yet. */
export function getGameIdConfig(slug: string): GameIdConfig | null {
  return GAME_ID_CONFIGS.find((c) => c.match.test(slug)) ?? null;
}

export type LookupResult =
  | { status: "verified"; name: string; region?: string }
  | { status: "not_found" } // the service answered: this ID doesn't exist
  | { status: "unavailable" } // the service failed / timed out
  | { status: "unsupported" }; // no lookup set up for this game yet
