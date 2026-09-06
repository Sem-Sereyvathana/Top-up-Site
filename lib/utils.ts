// Generate human-friendly order number: RT-XXXXXX
export function generateOrderNumber(prefix: string = "RT"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let n = "";
  for (let i = 0; i < 6; i++) {
    n += chars[Math.floor(Math.random() * chars.length)];
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
