import type { GameIdKey, LookupResult } from "@/lib/gameIdConfig";

// Slot for a paid ID-check provider (MooGold or any other supplier that
// offers a "validate user / nickname" API). Not connected yet.
//
// To connect one:
//   1. Put its address and key in .env (ID_CHECK_API_URL / ID_CHECK_API_KEY).
//   2. Fill in the request below using the provider's documentation and
//      return a LookupResult.
// While this returns null, lib/uidLookup.ts falls back to the free
// community lookups.

export async function lookupViaProvider(
  _game: GameIdKey,
  _uid: string,
  _server?: string,
): Promise<LookupResult | null> {
  const url = process.env.ID_CHECK_API_URL;
  const key = process.env.ID_CHECK_API_KEY;
  if (!url || !key) return null; // not connected yet

  // TODO: call the provider here once one is chosen.
  return null;
}
