import { SUPPLIER_SLUG_FALLBACK, type GameIdKey, type LookupResult } from "@/lib/gameIdConfig";
import { prisma } from "@/lib/prisma";
import { isSabayConfigured, checkSabayId } from "@/lib/sabay";

// Slot for a paid ID-check provider (MooGold or any other supplier that
// offers a "validate user / nickname" API). Not connected yet.
//
// To connect one:
//   1. Put its address and key in .env (ID_CHECK_API_URL / ID_CHECK_API_KEY).
//   2. Fill in the request below using the provider's documentation and
//      return a LookupResult.
// While this returns null, lib/uidLookup.ts falls back to the free
// community lookups.

// SabayStore check-id: used for any of your games that is linked to a
// supplier game (Game.supplierSlug, set by `npm run db:sync-sabay`).
// Returns null (-> next lookup in lib/uidLookup.ts) when the game isn't
// linked, the key isn't set, or the supplier can't tell / is unreachable.
async function lookupViaSabay(
  storeSlug: string,
  uid: string,
  server?: string,
): Promise<LookupResult | null> {
  if (!isSabayConfigured()) return null;
  const game = await prisma.game
    .findUnique({ where: { slug: storeSlug }, select: { supplierSlug: true } })
    .catch(() => null);
  // Linked game first; otherwise the built-in store-slug -> supplier-slug map.
  const supplierSlug = game?.supplierSlug || SUPPLIER_SLUG_FALLBACK[storeSlug];
  if (!supplierSlug) return null;

  const r = await checkSabayId({ gameSlug: supplierSlug, playerId: uid, serverId: server });
  if (!r) return null;
  if (r.state === "valid" && r.nickname) return { status: "verified", name: r.nickname };
  // An account in another region can't be topped up from this game page, so
  // it's treated like "not found" and blocks the order.
  if (r.state === "invalid" || r.state === "wrongRegion") return { status: "not_found" };
  return null; // unknown / unsupported -> fall back
}

export async function lookupViaProvider(
  _game: GameIdKey,
  _uid: string,
  _server?: string,
  _storeSlug?: string,
): Promise<LookupResult | null> {
  if (_storeSlug) {
    const viaSabay = await lookupViaSabay(_storeSlug, _uid, _server);
    if (viaSabay) return viaSabay;
  }

  const url = process.env.ID_CHECK_API_URL;
  const key = process.env.ID_CHECK_API_KEY;
  if (!url || !key) return null; // not connected yet

  // TODO: call the provider here once one is chosen.
  return null;
}
