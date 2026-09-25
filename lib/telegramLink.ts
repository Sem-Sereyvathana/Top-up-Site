// Turns whatever the admin typed into Settings → Support Telegram
// ("@sharustore", "sharustore", "t.me/sharustore", "https://t.me/sharustore")
// into a safe, clickable URL. Returns null when the value isn't something we
// can confidently link to, so callers fall back to plain text.
//
// Pure data — safe to import from client and server.

const HANDLE_RE = /^[A-Za-z0-9_]{3,32}$/;
const TME_PATH_RE = /^(?:t\.me|telegram\.me)\/[A-Za-z0-9_+\-/]+$/i;

export function toTelegramUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;

  // Already a full link. Only ever hand out http(s) — never javascript: etc.
  if (/^https?:\/\//i.test(v)) {
    try {
      new URL(v);
      return v;
    } catch {
      return null;
    }
  }

  // t.me/handle written without a scheme.
  if (TME_PATH_RE.test(v)) return `https://${v}`;

  // "@handle" or just "handle".
  const handle = v.startsWith("@") ? v.slice(1) : v;
  if (HANDLE_RE.test(handle)) return `https://t.me/${handle}`;

  return null;
}
