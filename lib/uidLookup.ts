/**
 * Game-specific UID → in-game nickname lookup.
 *
 * Order of attempts: paid provider (lib/idCheckProvider.ts, when connected),
 * then the free community services below (no auth, best-effort).
 * Every request has a timeout and never throws.
 */

import {
  getGameIdConfig,
  type LookupResult,
} from "@/lib/gameIdConfig";
import { lookupViaProvider } from "@/lib/idCheckProvider";

// ---------- helpers ----------

interface IsanResponse {
  success?: boolean;
  name?: string;
  message?: string;
}

const RANK: Record<LookupResult["status"], number> = {
  verified: 3,
  not_found: 2,
  unavailable: 1,
  unsupported: 0,
};

function best(a: LookupResult, b: LookupResult): LookupResult {
  return RANK[b.status] > RANK[a.status] ? b : a;
}

// verified → got a name; not_found → the service answered (HTTP 200) with
// success:false; unavailable → network error, timeout, bad reply or HTTP error.
async function fetchIsan(url: string): Promise<LookupResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data: IsanResponse | null = await res.json().catch(() => null);
    if (data?.success && data.name) return { status: "verified", name: data.name };
    if (res.ok && data && data.success === false) return { status: "not_found" };
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

// ---------- per-game lookups ----------

export async function lookupMobileLegends(
  uid: string,
  zone: string,
): Promise<LookupResult> {
  const base = "https://api.isan.eu.org/nickname/ml";
  const id = encodeURIComponent(uid);
  const server = encodeURIComponent(zone);

  // Documented format first, then the older path format as a backup.
  const a = await fetchIsan(`${base}?id=${id}&server=${server}`);
  if (a.status === "verified") return a;
  const b = await fetchIsan(`${base}/${id}/${server}`);
  return best(a, b);
}

export async function lookupFreeFire(uid: string): Promise<LookupResult> {
  // CamRapidSecure FreeFire validator
  // GET https://v1.camrapidx.com/validate_user/FreeFire_LevelUpPass.php?UserID=<uid>
  // Returns: { status: "APPROVED", username: "PlayerName#", ... }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(
      `https://v1.camrapidx.com/validate_user/FreeFire_LevelUpPass.php?UserID=${encodeURIComponent(uid)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "SHARUSTORE/1.0",
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    clearTimeout(timer);

    if (!res.ok) return { status: "unavailable" };

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return { status: "unavailable" };

    if (
      data.status === "APPROVED" &&
      typeof data.username === "string" &&
      data.username.length > 0
    ) {
      return { status: "verified", name: data.username };
    }
    if (typeof data.status === "string") return { status: "not_found" };
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

// ---------- router ----------

/**
 * Looks up the in-game nickname for a game slug + UID + optional server.
 */
export async function lookupGameId(
  gameSlug: string,
  uid: string,
  server?: string,
): Promise<LookupResult> {
  const cfg = getGameIdConfig(gameSlug);
  if (!cfg) return { status: "unsupported" };

  // Paid provider first (when connected).
  const viaProvider = await lookupViaProvider(cfg.key, uid, server, gameSlug);
  if (viaProvider) return viaProvider;

  switch (cfg.key) {
    case "mobile-legends":
      return server
        ? lookupMobileLegends(uid, server)
        : { status: "unavailable" };
    case "free-fire":
      return lookupFreeFire(uid);
    default:
      // Genshin / Honkai: Star Rail — no working lookup until a provider is connected.
      return { status: "unsupported" };
  }
}

/** Kept for older callers: nickname or null. */
export async function lookupNickname(
  gameSlug: string,
  uid: string,
  server?: string,
): Promise<string | null> {
  const r = await lookupGameId(gameSlug, uid, server);
  return r.status === "verified" ? r.name : null;
}
