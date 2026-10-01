// SabayStore partner (reseller) API client — the supplier that actually
// delivers the top-up once a customer has paid us.
// Docs: https://sabaystore.com/reseller   (only host we ever call is
// sabaystore.com/api/reseller — supplier hosts behind it are private).
//
// .env:
//   SABAY_API_KEY=sk_sabay_...          (from your reseller dashboard)
//   SABAY_BASE_URL=https://sabaystore.com   (optional)

const BASE = (process.env.SABAY_BASE_URL || "https://sabaystore.com").trim().replace(/\/$/, "");

export function isSabayConfigured(): boolean {
  return !!(process.env.SABAY_API_KEY || "").trim();
}

export type SabayOrderStatus = "PROCESSING" | "DELIVERED" | "REFUNDED" | string;

export type SabayOrderResult =
  | {
      ok: true;
      orderNumber: string;
      status: SabayOrderStatus;
      amount: number;
      reason: string | null;
    }
  | {
      ok: false;
      // true → we don't know whether the supplier got the order (timeout /
      // network / 5xx). Safe to send again with the same clientRef: the
      // supplier returns the original order instead of charging twice.
      retryable: boolean;
      httpStatus?: number;
      outOfStock?: boolean;
      error: string;
    };

async function sabayFetch(path: string, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${(process.env.SABAY_API_KEY || "").trim()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers || {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseOrder(data: any): SabayOrderResult | null {
  const o = data?.order;
  if (!data?.ok || !o?.orderNumber) return null;
  return {
    ok: true,
    orderNumber: String(o.orderNumber),
    status: String(o.status || "PROCESSING").toUpperCase(),
    amount: Number(o.amount) || 0,
    reason: o.reason ? String(o.reason) : null,
  };
}

/**
 * Place a paid order with the supplier. Balance is deducted immediately on
 * their side. `clientRef` (our order number) makes this safe to repeat.
 */
export async function placeSabayOrder(args: {
  gameSlug: string;
  offerId: string;
  playerId: string;
  serverId?: string | null;
  clientRef: string;
}): Promise<SabayOrderResult> {
  try {
    const res = await sabayFetch("/api/reseller/order", {
      method: "POST",
      body: JSON.stringify({
        gameSlug: args.gameSlug,
        offerId: args.offerId,
        playerId: args.playerId,
        serverId: args.serverId || null,
        clientRef: args.clientRef,
      }),
    });
    const data: any = await res.json().catch(() => null);

    if (res.ok) {
      const parsed = parseOrder(data);
      if (parsed) return parsed;
      return { ok: false, retryable: true, httpStatus: res.status, error: "Unexpected supplier response" };
    }

    const message = String(data?.error || data?.message || `HTTP ${res.status}`);
    if (res.status === 401) {
      return { ok: false, retryable: false, httpStatus: 401, error: `Supplier API key rejected (${message})` };
    }
    if (res.status === 402) {
      return { ok: false, retryable: false, httpStatus: 402, error: `Supplier balance too low (${message})` };
    }
    if (res.status === 404) {
      return { ok: false, retryable: false, httpStatus: 404, error: `Supplier game/offer not found (${message})` };
    }
    if (res.status === 503) {
      return {
        ok: false,
        retryable: false,
        httpStatus: 503,
        outOfStock: !!data?.outOfStock,
        error: data?.outOfStock ? "Pack out of stock at supplier" : `Supplier unavailable/paused (${message})`,
      };
    }
    // Other 4xx = bad request from our side; other 5xx = unknown outcome.
    return { ok: false, retryable: res.status >= 500, httpStatus: res.status, error: message };
  } catch (err: any) {
    return { ok: false, retryable: true, error: err?.name === "AbortError" ? "Supplier timed out" : String(err?.message || err) };
  }
}

/** Where one of our supplier orders stands (PROCESSING → DELIVERED / REFUNDED). */
export async function getSabayOrder(orderNumber: string): Promise<SabayOrderResult | null> {
  try {
    const res = await sabayFetch(`/api/reseller/order/${encodeURIComponent(orderNumber)}`, {}, 10000);
    if (!res.ok) return null;
    return parseOrder(await res.json().catch(() => null));
  } catch {
    return null;
  }
}

export type SabayIdState = "valid" | "invalid" | "wrongRegion" | "unknown" | "unsupported";

/**
 * Player-ID / nickname check against the supplier. Returns null when the
 * supplier can't be reached (caller falls back to other lookups).
 */
export async function checkSabayId(args: {
  gameSlug: string;
  playerId: string;
  serverId?: string | null;
}): Promise<{ state: SabayIdState; nickname?: string; region?: string; suggestedSlug?: string } | null> {
  try {
    const res = await sabayFetch(
      "/api/reseller/check-id",
      {
        method: "POST",
        body: JSON.stringify({
          gameSlug: args.gameSlug,
          playerId: args.playerId,
          serverId: args.serverId || null,
        }),
      },
      6000
    );
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    if (!data?.ok || typeof data.state !== "string") return null;
    return {
      state: data.state as SabayIdState,
      nickname: data.nickname ? String(data.nickname) : undefined,
      region: data.region ? String(data.region) : undefined,
      suggestedSlug: data.suggestedSlug ? String(data.suggestedSlug) : undefined,
    };
  } catch {
    return null;
  }
}
