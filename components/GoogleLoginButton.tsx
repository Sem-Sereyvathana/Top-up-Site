"use client";

import { useState } from "react";

// Plain top-level redirect to our own /api/auth/google, which then sends
// the browser on to Google's consent screen. No popup, no iframe, no
// third-party cookies involved — this is the same pattern Google
// recommends and it works consistently across browsers.
export default function GoogleLoginButton({
  next = "/account",
  size = "large",
  label = "Continue with Google",
  compactLabel = "Connect",
  compact = false,
  // Deprecated alias kept so existing callers (AccountMenu) keep working.
  // The button is no longer icon-only: it now shows `compactLabel` on
  // narrow screens instead of dropping the text.
  compactIconOnly = false,
}: {
  next?: string;
  size?: "small" | "medium" | "large";
  label?: string;
  // Shown instead of `label` below the `sm` breakpoint, so the same button
  // can read "Continue with Google" on wider screens and something shorter
  // like "Connect" once space gets tight (e.g. the mobile header bar).
  compactLabel?: string;
  // Below `sm`, shrink padding, icon and type so the button still fits
  // next to the store name in the header without truncating it to
  // "SHARUSTO...". Text stays visible at every width.
  compact?: boolean;
  /** @deprecated use `compact` */
  compactIconOnly?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const isCompact = compact || compactIconOnly;

  // Literal (non-interpolated) strings so Tailwind's scanner picks up
  // every class it needs to generate.
  const sizeClasses: Record<string, string> = {
    small: "px-4 py-2 text-sm gap-2",
    medium: "px-5 py-2.5 text-sm gap-2",
    large: "px-6 py-3 text-base gap-2",
  };

  const compactClasses: Record<string, string> = {
    small: "px-2.5 py-1.5 text-xs gap-1.5 sm:px-4 sm:py-2 sm:text-sm sm:gap-2",
    medium: "px-3 py-2 text-xs gap-1.5 sm:px-5 sm:py-2.5 sm:text-sm sm:gap-2",
    large: "px-3 py-2 text-xs gap-1.5 sm:px-6 sm:py-3 sm:text-base sm:gap-2",
  };

  const iconClasses = isCompact ? "h-3.5 w-3.5 sm:h-4 sm:w-4" : "h-4 w-4";

  function handleClick() {
    setLoading(true);
    window.location.href = `/api/auth/google?next=${encodeURIComponent(next)}`;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-label={label}
      className={`inline-flex max-w-full shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-white/15 bg-white font-medium text-gray-800 transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fox-primary disabled:opacity-60 ${
        isCompact ? compactClasses[size] : sizeClasses[size]
      }`}
    >
      <svg viewBox="0 0 24 24" className={`${iconClasses} shrink-0`} aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.6 5.6 0 0 1-2.4 3.66v3h3.87c2.26-2.09 3.58-5.17 3.58-8.9Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.87-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.11A12 12 0 0 0 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.28a12 12 0 0 0 0 10.79l3.99-3.11Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l3.99 3.1C6.22 6.86 8.87 4.75 12 4.75Z"
        />
      </svg>
      {loading ? (
        <span className="truncate">…</span>
      ) : (
        <>
          <span className="hidden truncate sm:inline">{label}</span>
          <span className="truncate sm:hidden">{compactLabel}</span>
        </>
      )}
    </button>
  );
}
