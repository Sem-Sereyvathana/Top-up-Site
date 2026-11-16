"use client";

import { useEffect, useRef, useState } from "react";

// Telegram Login Widget button.
//
// Renders Telegram's official login widget in an iframe; the widget calls
// our global callback with the signed payload, which POSTs it to
// /api/auth/telegram (server verifies hash + auth_date against the bot
// token) and sets the session cookie. Telegram only renders the widget for
// the domain it's configured for — add the site domain in the bot's
// /setdomain command via @BotFather.
//
// Env needed:
//   NEXT_PUBLIC_TELEGRAM_BOT_USERNAME — bot username WITHOUT the @, e.g.
//   "sharustore_bot" (read at build/runtime via next.config inline; passed
//   in as a prop so this component stays server-agnostic).

declare global {
  interface Window {
    OnTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

export default function TelegramLoginButton({
  botUsername,
  next = "/account",
  size = "large",
  label = "Continue with Telegram",
}: {
  botUsername: string;
  next?: string;
  size?: "small" | "medium" | "large";
  label?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const host = containerRef.current;

    // Global callback the widget invokes with the signed user object.
    window.OnTelegramAuth = async (user: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Telegram sign-in failed");
        // Full reload so server components (header, account menu) re-render
        // with the new session.
        window.location.href = next.startsWith("/") ? next : "/account";
      } catch (err: any) {
        if (mountedRef.current) setError(err.message || "Telegram sign-in failed");
      }
    };

    // Telegram's widget script (only loaded once).
    if (!document.getElementById("telegram-login-script")) {
      const script = document.createElement("script");
      script.id = "telegram-login-script";
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.async = true;
      document.head.appendChild(script);
    }

    // Render the widget button into our container.
    const el = containerRef.current;
    // Captured for the cleanup below (Telegram writes its iframe straight
    // into this element, so React can't remove it for us).
    if (el) {
      el.innerHTML = "";
      const sizePx = size === "large" ? "large" : size === "medium" ? "medium" : "small";
      const widget = document.createElement("script");
      widget.src = "https://telegram.org/js/telegram-widget.js?22";
      widget.setAttribute("data-telegram-login", botUsername);
      widget.setAttribute("data-size", sizePx);
      widget.setAttribute("data-radius", "8");
      widget.setAttribute("data-onauth", "OnTelegramAuth(user)");
      widget.setAttribute("data-request-access", "write");
      el.appendChild(widget);
    }

    return () => {
      mountedRef.current = false;
      // Drop the iframe Telegram rendered. React never managed this DOM
      // (we wrote it imperatively), so without this the button lingers when
      // the header unmounts/rebuilds it — e.g. after navigating pages.
      if (host) host.innerHTML = "";
    };
  }, [botUsername, next, size]);

  return (
    <div>
      <div ref={containerRef} className="flex justify-center min-h-[40px]" />
      {!botUsername && (
        <p className="text-xs text-red-400 text-center mt-2">
          Telegram login is not configured (missing bot username).
        </p>
      )}
      {error && <p className="text-xs text-red-400 text-center mt-2">{error}</p>}
      <noscript>Enable JavaScript to sign in with Telegram.</noscript>
    </div>
  );
}
