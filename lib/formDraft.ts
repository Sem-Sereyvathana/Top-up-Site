// Tiny helper for keeping a half-filled form across the Google sign-in
// redirect. The draft is written only at the moment a guest presses
// Pay/Checkout and is asked to sign in, expires after 30 minutes, and every
// storage call is wrapped in try/catch — storage can be blocked (private
// mode, blocked cookies) and that must never break the page.
//
// Pure data + injectable storage/clock so it can be unit-tested.

export const DRAFT_TTL_MS = 30 * 60 * 1000;

function defaultStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function saveDraft<T>(
  key: string,
  data: T,
  storage: Storage | undefined = defaultStorage(),
  now: number = Date.now()
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ t: now, d: data }));
  } catch {}
}

export function loadDraft<T = unknown>(
  key: string,
  storage: Storage | undefined = defaultStorage(),
  now: number = Date.now()
): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.t !== "number") return null;
    if (now - obj.t > DRAFT_TTL_MS) {
      storage.removeItem(key);
      return null;
    }
    return obj.d as T;
  } catch {
    return null;
  }
}

export function clearDraft(
  key: string,
  storage: Storage | undefined = defaultStorage()
): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {}
}
