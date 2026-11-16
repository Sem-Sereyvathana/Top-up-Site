import type { GameIdKey, LookupResult } from "@/lib/gameIdConfig";
import { isFazerConfigured, validatePlayer, fieldsFor } from "@/lib/fazercards";

// Player-ID checking before charging.
//
// FazerCards is the only provider used: it validates the Player ID for the
// games it delivers (Mobile Legends, Free Fire, Magic Chess Go Go, PUBG) and
// returns the in-game nickname, which is what the top-up form shows before
// checkout. This is the same call the Telegram bot makes before charging.
//
// Games FazerCards can't validate (Valorant, EA FC) simply fall through to
// the free community lookups in lib/uidLookup.ts, or to manual entry.
//
// There is deliberately no paid third-party ID-check provider configured —
// FazerCards covers it, so the old ID_CHECK_API_URL / ID_CHECK_API_KEY slots
// were removed.

// FazerCards player-ID validation (same call the Telegram bot makes before
// charging). Returns null (-> next
// lookup) whenever FazerCards can't tell, so a sale is never blocked by it.
async function lookupViaFazer(
  gameKey: GameIdKey,
  uid: string,
  server?: string,
): Promise<LookupResult | null> {
  if (!isFazerConfigured()) return null;
  const r = await validatePlayer(gameKey, fieldsFor("", uid, server));
  if (r.verdict === "ok") return { status: "verified", name: r.name || "Player found", region: r.region };
  if (r.verdict === "invalid") return { status: "not_found" };
  return null;
}

export async function lookupViaProvider(
  game: GameIdKey,
  uid: string,
  server?: string,
  _storeSlug?: string,
): Promise<LookupResult | null> {
  return await lookupViaFazer(game, uid, server);
}
