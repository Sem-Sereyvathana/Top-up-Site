"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    [key: string]: any;
  }
}

// Renders Telegram's official "Login with Telegram" widget (an iframe
// Telegram controls) and, once the user approves the login inside it,
// sends the signed payload to our own /api/auth/telegram route to verify
// it and create a session.
export default function TelegramLoginButton({
  next = "/account",
  size = "large",
}: {
  next?: string;
  size?: "small" | "medium" | "large";
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/[:]/g, "");
  const callbackName = `onTelegramAuth_${reactId}`;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

  useEffect(() => {
    if (!botUsername || !containerRef.current) return;

    window[callbackName] = async (tgUser: TelegramUser) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tgUser),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Telegram login failed");
        router.push(next);
        router.refresh();
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername.replace(/^@/, ""));
    script.setAttribute("data-size", size);
    script.setAttribute("data-radius", "10");
    script.setAttribute("data-onauth", `${callbackName}(user)`);
    script.setAttribute("data-request-access", "write");

    containerRef.current.appendChild(script);

    return () => {
      delete window[callbackName];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botUsername, size]);

  if (!botUsername) {
    // Not configured yet (TELEGRAM_BOT_TOKEN / NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
    // missing from .env) — quietly hide the widget rather than showing a
    // broken button.
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} className={loading ? "pointer-events-none opacity-50" : ""} />
      {loading && <p className="text-xs text-fox-muted">Signing in...</p>}
      {error && (
        <div className="w-full rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
