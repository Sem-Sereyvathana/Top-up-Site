"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Shared client hook for the Telegram login widget's bot username.
//
// The username is derived server-side from the configured bot token (see
// lib/telegramLogin.ts) and served by /api/settings. While it loads — and
// when Telegram login isn't configured at all — this returns null, and
// callers show their Google fallback.
//
// Reads the build-time env var first so a statically-known username renders
// the widget on the very first paint instead of waiting for the fetch.

let cached: string | null | undefined;

export function useTelegramBotUsername(): string | null {
  // Re-render whenever the route changes: the Telegram login widget renders
  // its button in an iframe only for the page that was loaded when it was
  // created, so the header must rebuild it after client-side navigation
  // (otherwise the button disappears on the second page the user visits).
  const pathname = usePathname();

  const [username, setUsername] = useState<string | null>(() => {
    const env = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
    return env ? env.replace(/^@/, "") : (cached ?? null);
  });

  useEffect(() => {
    if (cached !== undefined) {
      setUsername(cached);
      return;
    }
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const name = data?.telegramBotUsername ? String(data.telegramBotUsername).replace(/^@/, "") : null;
        cached = name;
        if (!cancelled) setUsername(name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Consumed in the dependency array of downstream effects so they rerun on
  // navigation; kept off the return value so callers are unaffected.
  void pathname;

  return username;
}
