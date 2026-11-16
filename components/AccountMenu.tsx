"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useCurrentUser } from "@/lib/useCurrentUser";
import GoogleLoginButton from "@/components/GoogleLoginButton";
import TelegramLoginButton from "@/components/TelegramLoginButton";
import { useTelegramBotUsername } from "@/lib/useTelegramBotUsername";
import { User, Coins, LogOut, ChevronDown, Wallet } from "lucide-react";

// Shown in the Header. Guests see "Continue with Telegram" directly (the
// sign-in is Telegram-first — it gives us their Telegram id/username for
// order handover) with a small Google fallback. Logged-in users see a
// dropdown with their points balance and account/logout.
//
// `inline`: used for the mobile hamburger panel. That panel animates open
// via `max-h-* overflow-hidden` (see Header.tsx), which clips any popover
// that tries to render below its trigger — so the normal floating dropdown
// below is invisible there, making "My account"/"Sign out" unreachable on
// mobile. When `inline` is set, a logged-in user gets those two links laid
// out directly in the flow instead of behind a popover, and a guest gets a
// slightly larger Google button sized for the panel.
export default function AccountMenu({
  className = "",
  inline = false,
  onNavigate,
}: {
  className?: string;
  inline?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { user, loading, refresh } = useCurrentUser();
  const botUsername = useTelegramBotUsername();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setOpen(false);
    onNavigate?.();
    await refresh();
    router.push("/");
    router.refresh();
  }

  if (loading) {
    return <div className={`h-9 w-9 sm:w-20 rounded-lg bg-fox-card/60 animate-pulse ${className}`} />;
  }

  if (!user) {
    // Telegram-first sign-in. The official Telegram login widget is the
    // button here; if Telegram login isn't configured yet (no bot token),
    // fall back to the /login page, which explains the options. Google is
    // only offered inside the mobile panel, as a small fallback link.
    //
    // NB: the header bar is tight on phones (logo + nav), so the /login link
    // uses a short mobile label and grows to the full one from `sm` up.
    return (
      <div className={`flex flex-col items-end gap-1.5 ${className}`}>
        {botUsername ? (
          <TelegramLoginButton
            botUsername={botUsername}
            size={inline ? "medium" : "small"}
            label="Sign in with Telegram"
          />
        ) : (
          <Link
            href="/login"
            className="btn-primary whitespace-nowrap px-3 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm"
          >
            <span className="sm:hidden">Sign in</span>
            <span className="hidden sm:inline">Sign in with Telegram</span>
          </Link>
        )}
        {inline && (
          <GoogleLoginButton size="small" label="Use Google instead" />
        )}
      </div>
    );
  }

  if (inline) {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <Link
          href="/account"
          onClick={onNavigate}
          className="rounded-lg px-4 py-3 text-sm font-medium text-fox-text/90 hover:bg-fox-card hover:text-fox-primary transition-colors"
        >
          ករណីរបស់ខ្ញុំ
        </Link>
        <Link
          href="/account/wallet"
          onClick={onNavigate}
          className="flex items-center justify-between rounded-lg px-4 py-3 text-sm font-medium text-fox-text/90 hover:bg-fox-card hover:text-fox-primary transition-colors"
        >
          <span className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Wallet
          </span>
          <span className="font-semibold text-green-400">${user.walletUsd.toFixed(2)}</span>
        </Link>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-sm font-medium text-fox-text/90 hover:bg-fox-card hover:text-red-400 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={2.5} />
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className={`relative hidden md:block ${className}`} ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-fox-border bg-fox-card/80 px-3 py-2 text-sm font-medium text-fox-text hover:border-fox-primary/60 transition-all"
      >
        <User className="h-4 w-4" strokeWidth={2.5} />
        <span className="hidden sm:inline max-w-[100px] truncate">
          {user.name || user.email || user.phone}
        </span>
        <span className="hidden sm:inline-flex items-center gap-1 text-fox-primary text-xs font-semibold">
          <Coins className="h-3 w-3" strokeWidth={2.5} />
          {user.points.toLocaleString()}
        </span>
        <span className="hidden sm:inline-flex items-center gap-1 text-green-400 text-xs font-semibold">
          <Wallet className="h-3 w-3" strokeWidth={2.5} />
          ${user.walletUsd.toFixed(2)}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-fox-muted" strokeWidth={2.5} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-48 rounded-xl border border-fox-border bg-fox-bg/95 backdrop-blur-xl shadow-xl shadow-black/30 py-1.5 z-50">
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-fox-text/90 hover:bg-fox-card hover:text-fox-primary transition-colors"
          >
            My account
          </Link>
          <Link
            href="/account/wallet"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between px-4 py-2 text-sm text-fox-text/90 hover:bg-fox-card hover:text-fox-primary transition-colors"
          >
            <span className="flex items-center gap-2">
              <Wallet className="h-3.5 w-3.5" />
              Wallet
            </span>
            <span className="font-semibold text-green-400">${user.walletUsd.toFixed(2)}</span>
          </Link>
          <button
            onClick={handleLogout}
            className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-fox-text/90 hover:bg-fox-card hover:text-red-400 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={2.5} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
