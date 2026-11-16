import { prisma } from "./prisma";

// Server-side config for the Telegram Login Widget.
//
// Two things are needed to show/serve Telegram sign-in:
//   * the BOT TOKEN — the admin pastes it in Admin → Settings ("Telegram
//     Notifications"), or it comes from the TELEGRAM_BOT_TOKEN env var. The
//     same token already powers order alerts, so there is nothing extra to
//     configure for that part.
//   * the BOT USERNAME — required by telegram-widget.js. Rather than make
//     the admin look it up in @BotFather, we ask Telegram (getMe) once and
//     cache the answer; TELEGRAM_BOT_USERNAME / NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
//     can override it if ever needed.
//
// Everything here is server-only (uses the token), so the browser gets the
// username via /api/settings, which is public.

const ME_TTL_MS = 60 * 60 * 1000; // re-check the bot username hourly
const ME_TIMEOUT_MS = 2500; // never let /api/settings wait on this

let cachedUsername: string | null = null;
let cachedAt = 0;

function envBotUsername(): string | null {
  const raw =
    process.env.TELEGRAM_BOT_USERNAME ||
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ||
    "";
  const name = raw.trim().replace(/^@/, "");
  return name || null;
}

async function botToken(): Promise<string | null> {
  const settings = await prisma.settings
    .findUnique({ where: { id: 1 }, select: { telegramBotToken: true } })
    .catch(() => null);
  return settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || null;
}

/**
 * The bot's @username (without the @) that the login widget must be pointed
 * at, or null when Telegram login isn't set up. Cached for an hour; a failed
 * getMe is not cached, so the next request simply tries again.
 */
export async function getTelegramBotUsername(): Promise<string | null> {
  const override = envBotUsername();
  if (override) return override;

  if (cachedUsername && Date.now() - cachedAt < ME_TTL_MS) return cachedUsername;

  const token = await botToken();
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ME_TIMEOUT_MS);
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const username = String(data?.result?.username || "").trim();
    if (!username) return null;

    cachedUsername = username;
    cachedAt = Date.now();
    return username;
  } catch {
    return null;
  }
}

/** The bot token used to verify login payloads (DB first, then env). */
export async function getTelegramBotToken(): Promise<string | null> {
  return botToken();
}
