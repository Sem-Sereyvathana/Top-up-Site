// Resolves the public https base URL to use for payment gateway callbacks.
// Prefers PUBLIC_APP_URL, then NEXT_PUBLIC_BASE_URL, then the request's own
// origin — but only if that candidate is a real public http(s) URL (KHPay
// rejects localhost/private IPs, so those are skipped in favour of the next
// candidate). Shared by every route that talks to KHPay server-side.
export function resolvePublicUrl(requestOrigin: string): string {
  const isPublicHttpUrl = (value?: string | null): value is string => {
    if (!value) return false;
    if (!/^https?:\/\//i.test(value)) return false;
    return !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(value);
  };
  const envPublic = process.env.PUBLIC_APP_URL;
  const envBase = process.env.NEXT_PUBLIC_BASE_URL;
  const base = isPublicHttpUrl(envPublic)
    ? envPublic
    : isPublicHttpUrl(envBase)
    ? envBase
    : requestOrigin;
  return base.replace(/\/$/, "");
}

// Generate human-friendly order number: RT-XXXXXX
//
// Order numbers double as bearer tokens — anyone who has one can look up
// that order's status, player UID, and amount via the public tracker
// endpoint (no login required, by design, for guest checkout). That makes
// them security-sensitive, so this must use a CSPRNG rather than
// Math.random() (which is predictable: observing a handful of outputs is
// enough to reconstruct V8's internal PRNG state and predict future ones).
// crypto.randomInt() pulls from the OS's cryptographically secure random
// source and is unbiased across the character set, unlike using
// randomBytes() with a manual modulo.
import { randomInt } from "crypto";

export function generateOrderNumber(prefix: string = "RT"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let n = "";
  for (let i = 0; i < 6; i++) {
    n += chars[randomInt(0, chars.length)];
  }
  return `${prefix}-${n}`;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatKhr(amount: number): string {
  return `${Math.round(amount).toLocaleString("en-US")} ៛`;
}

export function calcKhr(usd: number, rate: number = 4100): number {
  return Math.round(usd * rate / 100) * 100; // round to nearest 100 KHR
}

// Validate player identifier - accepts numeric UIDs (e.g. Mobile Legends,
// Free Fire) as well as alphanumeric usernames (e.g. Roblox), 3-20 chars,
// letters/numbers/underscores only.
export function isValidUid(uid: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(uid.trim());
}

// Validate server zone id
export function isValidServerId(sid: string): boolean {
  return /^\d{1,5}$/.test(sid.trim());
}

// Whether a game supports the multi-package cart flow (currently: Roblox).
// IMPORTANT: this must be the exact same check on the client (TopUpForm,
// to decide whether to render cart UI) and the server (the orders API, to
// decide whether to accept an `items` array). If these ever drift apart,
// the client can offer multi-select for a game the server then rejects.
export function isRobuxGame(game: { slug: string; currencyName: string }): boolean {
  return game.slug === "roblox" || game.currencyName.toLowerCase().includes("robux");
}
