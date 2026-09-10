"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import CurrencyToggle from "./CurrencyToggle";
import AccountMenu from "./AccountMenu";
import CartButton from "./CartButton";

const NAV = [
  { href: "/game-items", label: "Game Items" },
  { href: "/accounts", label: "Account" },
  { href: "/history", label: "History" },
];

export default function Header() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Admin-configured logo (Settings.logoUrl) — falls back to the default
  // icon below when nothing has been uploaded yet.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setLogoUrl(data?.logoUrl || null))
      .catch(() => {});
  }, []);

  // First nav item toggles label based on route, but always links home
  const homeItem = { href: "/", label: isHome ? "Home" : "Top up" };
  const fullNav = [homeItem, ...NAV];

  return (
    <header
      className={`sticky top-0 z-40 transition-all duration-300 ${
        scrolled
          ? "border-b border-fox-border/80 bg-fox-bg/80 backdrop-blur-xl shadow-lg shadow-black/30"
          : "border-b border-transparent bg-fox-bg/40 backdrop-blur-md"
      }`}
    >
      {/* Gradient top hairline */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fox-primary/70 to-transparent opacity-60" />

      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 group">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="SHARUSTORE"
              className="h-10 w-10 rounded-xl object-contain transition-transform duration-300 group-hover:scale-110"
            />
          ) : (
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent shadow-lg shadow-fox-primary/30 transition-all duration-300 group-hover:scale-110 group-hover:rotate-6 group-hover:shadow-fox-primary/60">
              <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent opacity-60 blur-lg transition-opacity duration-300 group-hover:opacity-90 -z-10" />
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-black">
                <path
                  d="M12 2L3 7v6c0 5 3.5 9 9 10 5.5-1 9-5 9-10V7l-9-5z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <circle cx="9" cy="11" r="1.5" fill="currentColor" />
                <circle cx="15" cy="11" r="1.5" fill="currentColor" />
                <path
                  d="M9 15s1 2 3 2 3-2 3-2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}
          <div className="flex flex-col leading-none">
            <span className="font-display text-xl font-bold tracking-tight">
              SHARU<span className="text-fox-primary">STORE</span>
            </span>
            <span className="text-[10px] text-fox-muted tracking-widest">
              INSTANT · SECURE · 24/7
            </span>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-1 rounded-full border border-fox-border/70 bg-fox-card/50 px-2 py-1.5 backdrop-blur-md">
          {fullNav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-300 ${
                  active
                    ? "text-black"
                    : "text-fox-text/80 hover:text-fox-primary"
                }`}
              >
                {active && (
                  <span className="absolute inset-0 rounded-full bg-gradient-to-r from-fox-primary to-fox-accent shadow-md shadow-fox-primary/40 -z-0" />
                )}
                <span className="relative z-10">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <CurrencyToggle className="hidden sm:inline-flex" />
          {pathname?.startsWith("/game-items") && (
            <CartButton kind="items" title="Game Items Cart" checkoutHref="/game-items/checkout" />
          )}
          {pathname?.startsWith("/accounts") && (
            <CartButton kind="accounts" title="Accounts Cart" checkoutHref="/accounts/checkout" />
          )}
          <AccountMenu className="hidden sm:block" />

          {/* Mobile burger */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg border border-fox-border bg-fox-card/80 text-fox-text"
            aria-label="Toggle menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileOpen ? (
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile nav panel */}
      <div
        className={`md:hidden overflow-hidden border-t border-fox-border/60 bg-fox-bg/95 backdrop-blur-xl transition-[max-height,opacity] duration-300 ease-out ${
          mobileOpen ? "max-h-[calc(100vh-4.5rem)] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <nav className="flex flex-col p-4 gap-1 overflow-y-auto max-h-[calc(100vh-4.5rem)]">
          {fullNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-4 py-3 text-sm font-medium text-fox-text/90 hover:bg-fox-card hover:text-fox-primary transition-colors"
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-2 flex items-center justify-between rounded-lg border border-fox-border bg-fox-card/60 px-4 py-3">
            <span className="text-xs uppercase tracking-wider text-fox-muted">Display currency</span>
            <CurrencyToggle />
          </div>
          <div className="mt-2">
            <AccountMenu inline onNavigate={() => setMobileOpen(false)} />
          </div>
        </nav>
      </div>
    </header>
  );
}
