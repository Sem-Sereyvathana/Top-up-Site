"use client";

import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { usePathname } from "next/navigation";
import { toTelegramUrl } from "@/lib/telegramLink";

// Floating "chat with us on Telegram" button — replaces the old built-in
// live chat. Clicking opens the support Telegram (Settings.supportTelegram,
// editable in Admin → Settings) in a new tab. Hidden on the checkout flow
// so it never covers payment UI, and hidden in the admin panel entirely —
// the admin seeing this button would just open their own support chat.
const BTN = 56;
const EDGE = 8;
const MOBILE_NAV = 72;
const HIDDEN_ON = [/^\/checkout/, /^\/order/, /^\/admin/];

export default function TelegramChatButton() {
  const [telegram, setTelegram] = useState<string>("");
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.supportTelegram) setTelegram(data.supportTelegram);
      })
      .catch(() => {});
  }, []);

  if (!telegram) return null;
  if (HIDDEN_ON.some((re) => re.test(pathname))) return null;

  const url = toTelegramUrl(telegram);
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on Telegram"
      className="fixed z-40 flex items-center justify-center rounded-full shadow-lg shadow-fox-primary/30 bg-gradient-to-br from-fox-primary to-fox-accent text-black transition hover:scale-105"
      style={{
        width: BTN,
        height: BTN,
        right: EDGE + 8,
        bottom: `calc(${EDGE + MOBILE_NAV}px + env(safe-area-inset-bottom))`,
      }}
    >
      <Send className="h-6 w-6" strokeWidth={2.2} />
    </a>
  );
}
