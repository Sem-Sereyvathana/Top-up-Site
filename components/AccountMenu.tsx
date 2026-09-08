"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { User, Coins, LogOut, ChevronDown } from "lucide-react";

// Shown in the Header. Guests see Sign in / Create account links; logged-in
// users see a dropdown with their points balance and account/logout.
//
// `inline`: used for the mobile hamburger panel. That panel animates open
// via `max-h-* overflow-hidden` (see Header.tsx), which clips any popover
// that tries to render below its trigger — so the normal floating dropdown
// below is invisible there, making "My account"/"Sign out" unreachable on
// mobile. When `inline` is set, a logged-in user gets those two links laid
// out directly in the flow instead of behind a popover. Guests are
// unaffected either way — their Sign in/Sign up links were never a popover.
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
    return <div className={`h-9 w-20 rounded-lg bg-fox-card/60 animate-pulse ${className}`} />;
  }

  if (!user) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Link
          href="/login"
          onClick={onNavigate}
          className="rounded-lg px-3 py-2 text-sm font-medium text-fox-text/80 hover:text-fox-primary transition-colors"
        >
          Sign in
        </Link>
        <Link
          href="/register"
          onClick={onNavigate}
          className="rounded-lg border border-fox-border bg-fox-card/80 px-3 py-2 text-sm font-medium text-fox-text hover:border-fox-primary/60 hover:text-fox-primary transition-all"
        >
          Sign up
        </Link>
      </div>
    );
  }

  if (inline) {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <div className="flex items-center justify-between rounded-lg border border-fox-border bg-fox-card/60 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-fox-text">
            <User className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            <span className="truncate">{user.name || user.email || user.phone}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-fox-primary text-xs font-semibold">
            <Coins className="h-3 w-3" strokeWidth={2.5} />
            {user.points.toLocaleString()}
          </span>
        </div>
        <Link
          href="/account"
          onClick={onNavigate}
          className="rounded-lg px-4 py-3 text-sm font-medium text-fox-text/90 hover:bg-fox-card hover:text-fox-primary transition-colors"
        >
          My account
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
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-fox-border bg-fox-card/80 px-3 py-2 text-sm font-medium text-fox-text hover:border-fox-primary/60 transition-all"
      >
        <User className="h-4 w-4" strokeWidth={2.5} />
        <span className="hidden sm:inline max-w-[100px] truncate">
          {user.name || user.email || user.phone}
        </span>
        <span className="inline-flex items-center gap-1 text-fox-primary text-xs font-semibold">
          <Coins className="h-3 w-3" strokeWidth={2.5} />
          {user.points.toLocaleString()}
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
