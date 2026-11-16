"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gamepad2, House, ReceiptText, Store, User } from "lucide-react";

// Mobile-only bottom tab bar. Replaces the hamburger menu and the footer on
// small screens (md and up keep the normal header nav + footer).
const TABS = [
  { href: "/", label: "Home", Icon: House },
  { href: "/game-items", label: "Item", Icon: Gamepad2 },
  { href: "/accounts", label: "Account", Icon: Store },
  { href: "/history", label: "Orders", Icon: ReceiptText },
  { href: "/account", label: "Profile", Icon: User },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  // "/account" must not match "/accounts"
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MobileBottomNav() {
  const pathname = usePathname() || "";
  if (pathname.startsWith("/admin")) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-fox-border/70 bg-fox-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1.5">
        {TABS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors ${
                  active ? "text-fox-primary" : "text-fox-muted hover:text-fox-text"
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${
                    active
                      ? "bg-fox-primary/15 shadow-[0_0_14px] shadow-fox-primary/40"
                      : ""
                  }`}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
