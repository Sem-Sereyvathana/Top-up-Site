// FazerCards supplier client — a TypeScript port of the Telegram bot's
// supplier.py (which is live and working). Same API, same safety rules:
//
//   * Every purchase carries an Idempotency-Key. Asking again with the SAME
//     key never buys twice: FazerCards hands back the original order.
//   * "Definitely did not charge us" (bad id, sold out, bad key) is a hard
//     failure. "Not sure" (timeout, 5xx, rate limit) is NEVER treated as a
//     failure — the order just waits and is checked again with the same key.
//
// Settings (.env): FAZER_API_KEY (that is all; FazerCards is the only supplier).

const BASE_URL = (process.env.FAZER_BASE_URL || "https://api.fzr.cards/api/v2").replace(/\/+$/, "");
const PLACEHOLDERS = new Set(["", "put-your-fazercards-api-key-here"]);

export function isFazerConfigured(): boolean {
  return !PLACEHOLDERS.has((process.env.FAZER_API_KEY || "").trim());
}

/** Prefix of every idempotency key (keeps the site's keys apart from the bot's). */
export const KEY_PREFIX = (process.env.FAZER_KEY_PREFIX || "site").trim();

export class FzError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface FzOptions {
  query?: Record<string, string | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
}

async function fz(method: "GET" | "POST", path: string, opts: FzOptions = {}): Promise<any> {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {
    "X-API-Key": (process.env.FAZER_API_KEY || "").trim(),
    Accept: "application/json",
    "User-Agent": "sharustore-site",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new FzError(0, "network", err?.name === "AbortError" ? "timeout" : String(err?.message || err));
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      (typeof data?.message === "string" && data.message) ||
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.error?.message === "string" && data.error.message) ||
      `HTTP ${res.status}`;
    throw new FzError(res.status, typeof data?.code === "string" ? data.code : "", message);
  }
  return data;
}

// ---------------------------------------------------------------- errors
export type FzFailure = "nofunds" | "soldout" | "rejected" | "ambiguous";

const NO_FUNDS = [
  "insufficient", "not enough balance", "low balance", "balance is too low", "no funds",
  "not enough funds", "top up your balance", "insufficient_balance", "insufficient_funds",
];
const NO_STOCK = ["out of stock", "out_of_stock", "no stock", "sold out", "sold_out", "unavailable", "not available"];

/** Same four outcomes as the bot. Anything unclear is "ambiguous" (never refunded). */
export function classifyError(err: unknown): FzFailure {
  if (!(err instanceof FzError)) return "ambiguous";
  const text = `${err.code} ${err.message}`.toLowerCase();
  if (err.status === 429) return "ambiguous"; // rate limit: retry, not a failure
  if (err.status === 402 || NO_FUNDS.some((w) => text.includes(w))) return "nofunds";
  if ([400, 401, 403, 404].includes(err.status)) {
    return NO_STOCK.some((w) => text.includes(w)) ? "soldout" : "rejected";
  }
  return "ambiguous";
}

// ---------------------------------------------------------------- offers
/** '2x 234_23 + 78_8' -> ['234_23','234_23','78_8'] (one entry per separate FazerCards order). */
export function parseOffers(spec: string): string[] {
  const offers: string[] = [];
  for (const token of spec.split("+")) {
    const m = /^\s*(?:(\d+)\s*x\s+)?([a-z0-9_]+)\s*$/.exec(token);
    if (!m) throw new Error(`bad top-up offer spec "${spec}"`);
    for (let i = 0; i < Number(m[1] || 1); i++) offers.push(m[2]);
  }
  return offers;
}

export type FzPart =
  | { kind: "topup"; category: string; offerId: string }
  | { kind: "giftcard"; category: string; cardId: string };

/** What FazerCards orders make up one pack. Gift cards are stored as "category:card_id". */
export function partsFor(supplierSlug: string, supplierOfferId: string): FzPart[] {
  const spec = supplierOfferId.trim();
  if (spec.includes(":")) {
    const [category, cardId] = spec.split(":");
    return [{ kind: "giftcard", category: category.trim(), cardId: cardId.trim() }];
  }
  return parseOffers(spec).map((offerId) => ({ kind: "topup" as const, category: supplierSlug, offerId }));
}

/** Form-field keys FazerCards expects per game (first = Player ID, second = Server/Zone ID). */
const FIELD_KEYS: Record<string, string[]> = {
  valorant_kh: ["riot_id"],
};

export function fieldsFor(category: string, playerId: string, serverId?: string | null): Record<string, string> {
  const keys = FIELD_KEYS[category] || ["player_id", "server_id"];
  const values = [playerId, serverId || ""];
  const out: Record<string, string> = {};
  keys.forEach((k, i) => {
    if (values[i]) out[k] = String(values[i]);
  });
  return out;
}

// ---------------------------------------------------------------- orders
export interface FzOrder {
  id: string;
  status: string; // created | processing | pending | completed | failed | refund
  codes: string[];
  reason: string;
}

function toOrder(o: any): FzOrder {
  const codes = Array.isArray(o?.cards) ? o.cards : Array.isArray(o?.keys) ? o.keys : [];
  return {
    id: String(o?.id || ""),
    status: String(o?.status || "").toLowerCase(),
    codes: codes.map((c: unknown) => String(c)),
    reason: String(o?.fail_reason || o?.failReason || ""),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WORKING = new Set(["created", "processing", "pending"]);

export async function getOrder(id: string): Promise<FzOrder> {
  const data = await fz("GET", `/orders/${encodeURIComponent(id)}`);
  return toOrder(data?.order);
}

/** Looks at an order for up to waitMs; returns whatever it is by then. Never throws. */
async function settle(order: FzOrder, waitMs: number): Promise<FzOrder> {
  const until = Date.now() + waitMs;
  let current = order;
  while (WORKING.has(current.status) && Date.now() < until) {
    await sleep(2000);
    try {
      current = await getOrder(current.id);
    } catch {
      break;
    }
  }
  return current;
}

/** Throws FzError (use classifyError). Replaying the same key returns the original order. */
export async function placeTopup(
  category: string,
  offerId: string,
  fields: Record<string, string>,
  idempotencyKey: string,
  waitMs = 8000
): Promise<FzOrder> {
  const data = await fz("POST", "/topups/order", {
    body: { category_id: category, offer_id: offerId, fields },
    idempotencyKey,
  });
  const order = toOrder(data?.order);
  if (!order.id) throw new FzError(0, "no_id", "Supplier reply had no order id");
  return settle(order, waitMs);
}

export async function buyGiftcard(
  category: string,
  cardId: string,
  idempotencyKey: string,
  waitMs = 8000
): Promise<FzOrder> {
  const data = await fz("POST", "/giftcards/order", {
    body: { category_id: category, card_id: cardId, quantity: 1 },
    idempotencyKey,
  });
  const order = toOrder(data?.order);
  if (!order.id) throw new FzError(0, "no_id", "Supplier reply had no order id");
  return settle(order, waitMs);
}

// ---------------------------------------------------------------- prices (used by the watcher)
export interface FzOfferInfo {
  cost: number; // USD, what ONE order of this offer costs us
  stock: number | null; // null = unknown (treated as in stock)
}

function stockNumber(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === "" || String(v).trim() === "?") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** offer id -> cost + stock, read live from FazerCards. kind "giftcard" reads gift-card denominations. */
export async function readOffers(category: string, kind: "topup" | "giftcard"): Promise<Map<string, FzOfferInfo>> {
  const data =
    kind === "giftcard"
      ? await fz("GET", "/giftcards/cards", { query: { category_id: category } })
      : await fz("GET", "/topups/offers", { query: { category_id: category } });
  const out = new Map<string, FzOfferInfo>();
  for (const o of data?.offers || []) {
    const id = String(kind === "giftcard" ? o.card_id : o.offer_id || "");
    const cost = Number(o.price_usd);
    if (id && Number.isFinite(cost) && cost > 0) out.set(id, { cost, stock: stockNumber(o.stock) });
  }
  return out;
}

// ---------------------------------------------------------------- Player ID check
const VALIDATE_HINTS: Record<string, string[]> = {
  "mobile-legends": ["mobile legends", "mlbb"],
  "free-fire": ["free fire"],
  "magic-chess": ["magic chess"],
  "pubg-mobile": ["pubg"],
};

let validateGamesCache: { at: number; items: any[] } = { at: 0, items: [] };

async function validateGames(): Promise<any[]> {
  if (validateGamesCache.items.length && Date.now() - validateGamesCache.at < 3600_000) {
    return validateGamesCache.items;
  }
  const data = await fz("GET", "/topups/validate-id", { timeoutMs: 6000 });
  const items = Array.isArray(data?.items) ? data.items : [];
  validateGamesCache = { at: Date.now(), items };
  return items;
}

/** The fields FazerCards' validation wants, filled from ours (same keys, else same order). */
export function validatePayload(wanted: string[], fields: Record<string, string>): Record<string, string> | null {
  if (!wanted.length) return null;
  if (wanted.every((k) => k in fields)) return Object.fromEntries(wanted.map((k) => [k, fields[k]]));
  const values = Object.values(fields);
  if (wanted.length === values.length) return Object.fromEntries(wanted.map((k, i) => [k, values[i]]));
  return null;
}

const NOT_FOUND_WORDS = ["not found", "invalid", "incorrect", "does not exist", "doesn't exist", "no such", "unknown player", "wrong"];

// `region` is what FazerCards says about the account (e.g. "Cambodia",
// "US") — present on a successful validation, absent on a failed one. It is
// the buyer's ACCOUNT region, not the pack's; comparing it against the
// game's allowed regions is the pre-purchase region gate (see
// lib/regionCheck.ts / app/api/lookup-uid).
export type FzValidation =
  | { verdict: "ok"; name: string; region?: string }
  | { verdict: "invalid" }
  | { verdict: "skip" };

/** Checks a Player ID before charging. Never throws; any problem = "skip" (the site then falls back). */
export async function validatePlayer(gameKey: string, fields: Record<string, string>): Promise<FzValidation> {
  try {
    const hints = VALIDATE_HINTS[gameKey];
    if (!hints) return { verdict: "skip" };
    const items = await validateGames();
    const entry = items.find((it) => {
      const label = `${it.category_id || ""} ${it.name || ""}`.toLowerCase().replace(/_/g, " ");
      return hints.some((h) => label.includes(h));
    });
    if (!entry) return { verdict: "skip" };
    const wanted = (entry.fields || []).map((f: any) => String(f.key)).filter(Boolean);
    const payload = validatePayload(wanted, fields);
    if (!payload) return { verdict: "skip" };

    let data: any;
    try {
      data = await fz("POST", "/topups/validate-id", {
        body: { category_id: String(entry.category_id), fields: payload },
        timeoutMs: 8000,
      });
    } catch (err) {
      if (err instanceof FzError && err.status === 400) {
        const text = `${err.code} ${err.message}`.toLowerCase();
        return NOT_FOUND_WORDS.some((w) => text.includes(w)) ? { verdict: "invalid" } : { verdict: "skip" };
      }
      return { verdict: "skip" };
    }
    if (!data || typeof data !== "object") return { verdict: "skip" };
    for (const flag of ["valid", "is_valid", "success", "found"]) {
      if (data[flag] === false) return { verdict: "invalid" };
    }
    // FazerCards reports the account's region on a successful check (e.g.
    // "region":"Cambodia"). Carry it through so callers can gate checkout
    // on it; trimmed to a sane length since it goes into responses.
    const rawRegion = [data, data.data && typeof data.data === "object" ? data.data : {}]
      .map((src: any) => (typeof src?.region === "string" ? src.region.trim() : ""))
      .find(Boolean);
    const region = rawRegion ? rawRegion.slice(0, 40) : undefined;
    for (const src of [data, data.data && typeof data.data === "object" ? data.data : {}]) {
      for (const key of ["nickname", "username", "player_name", "name", "nick"]) {
        const v = (src as any)[key];
        if (typeof v === "string" && v.trim()) return { verdict: "ok", name: v.trim().slice(0, 40), region };
      }
    }
    return ["valid", "is_valid", "success", "found"].some((f) => data[f] === true)
      ? { verdict: "ok", name: "", region }
      : { verdict: "skip" };
  } catch {
    return { verdict: "skip" };
  }
}
