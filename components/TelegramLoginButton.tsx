"use client";

import { useState } from "react";
import { Send } from "lucide-react";

// Sends the user to Telegram's own redirect-based OAuth page
// (oauth.telegram.org) instead of embedding Telegram's JS widget in an
// iframe. The old iframe widget relies on cross-site cookies/storage that
// Chrome blocks for some users (their "Signature mismatch" / silently
// broken widget symptom) — a plain top-level redirect avoids that
// entirely and works the same way in every browser.
//
// Flow:
//   1. User clicks the button -> full-page navigation to oauth.telegram.org
//   2. Telegram shows its own login/approve screen
//   3. Telegram redirects back to /api/auth/telegram/callback with the
//      signed auth payload as query params
//   4. That route verifies the signature (same HMAC check as before) and
//      creates the session, then redirects to `next`
export default function TelegramLoginButton({
  next = "/account",
  size = "large",
}: {
  next?: string;
  size?: "small" | "medium" | "large";
}) {
  const [loading, setLoading] = useState(false);

  const botId = process.env.NEXT_PUBLIC_TELEGRAM_BOT_ID;

  if (!botId) {
    // Not configured yet (NEXT_PUBLIC_TELEGRAM_BOT_ID missing from .env) —
    // quietly hide the button rather than showing a broken one.
    return null;
  }

  const sizeClasses: Record<string, string> = {
    small: "px-4 py-2 text-sm",
    medium: "px-5 py-2.5 text-sm",
    large: "px-6 py-3 text-base",
  };

  function handleClick() {
    setLoading(true);
    const origin = window.location.origin;
    const returnTo = `${origin}/api/auth/telegram/callback?next=${encodeURIComponent(next)}`;
    const authUrl =
      `https://oauth.telegram.org/auth?bot_id=${encodeURIComponent(botId!)}` +
      `&origin=${encodeURIComponent(origin)}` +
      `&embed=0&request_access=write` +
      `&return_to=${encodeURIComponent(returnTo)}`;
    window.location.href = authUrl;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-[#2AABEE] font-medium text-white transition hover:bg-[#229ED9] disabled:opacity-60 ${sizeClasses[size]}`}
    >
      <Send className="h-4 w-4" strokeWidth={2.5} />
      {loading ? "Redirecting..." : "Log in with Telegram"}
    </button>
  );
}
