"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { User, Coins, LogOut, ChevronDown } from "lucide-react";

// Shown in the Header. Guests see Sign in / Create account links; logged-in
// users see a dropdown with their points balance and account/logout.
export default function AccountMenu({ className = "" }: { className?: string }) {
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
          className="rounded-lg px-3 py-2 text-sm font-medium text-fox-text/80 hover:text-fox-primary transition-colors"
        >
          Sign in
        </Link>
        <Link
          href="/register"
          className="rounded-lg border border-fox-border bg-fox-card/80 px-3 py-2 text-sm font-medium text-fox-text hover:border-fox-primary/60 hover:text-fox-primary transition-all"
        >
          Sign up
        </Link>
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
