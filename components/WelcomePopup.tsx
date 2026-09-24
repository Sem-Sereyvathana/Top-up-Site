"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Send } from "lucide-react";

// Content comes from /api/popup, which is edited in Admin → Welcome Popup.
interface PopupData {
  version: number;
  imageUrl: string | null;
  title: string;
  body: string;
  bullets: string[];
  telegramUrl: string | null;
  buttonLabel: string;
  closeLabel: string;
}

const SEEN_KEY = "sharustore_welcome_seen";
const DELAY_MS = 800;

// Never interrupt these: payment / order flows and the admin area.
const SKIP_PREFIXES = ["/admin", "/checkout", "/order", "/login", "/register"];

// A visitor has "seen" the popup once they dismiss it. We store the popup's
// version, so bumping it in admin ("show again") re-shows it to everyone.
// Both storages are wrapped in try/catch: they can throw (private mode,
// blocked cookies) and the popup must never break the page.
function hasSeen(version: number): boolean {
  const v = String(version);
  try {
    if (localStorage.getItem(SEEN_KEY) === v) return true;
  } catch {}
  try {
    if (sessionStorage.getItem(SEEN_KEY) === v) return true;
  } catch {}
  return false;
}

function markSeen(version: number) {
  const v = String(version);
  try {
    localStorage.setItem(SEEN_KEY, v);
  } catch {}
  try {
    sessionStorage.setItem(SEEN_KEY, v);
  } catch {}
}

export default function WelcomePopup() {
  const pathname = usePathname() || "/";
  const skip = SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  const [popup, setPopup] = useState<PopupData | null>(null);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false); // drives the fade-in
  const dismissedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Fetch the popup once we're on a page where it's allowed. Nothing is
  // rendered on the server, so there is no hydration mismatch risk.
  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    fetch("/api/popup")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const p = data?.popup as PopupData | null | undefined;
        if (cancelled || !p || dismissedRef.current || hasSeen(p.version)) return;
        setPopup(p);
        timer = setTimeout(() => setOpen(true), DELAY_MS);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [skip]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    if (popup) markSeen(popup.version);
    setVisible(false);
    setOpen(false);
  }, [popup]);

  // While open: lock page scroll, close on Esc, keep Tab inside the dialog.
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => setVisible(true));
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismiss();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const els = dialogRef.current.querySelectorAll<HTMLElement>("a[href], button");
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, dismiss]);

  if (skip || !open || !popup) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div
        aria-hidden
        onClick={dismiss}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300 motion-reduce:transition-none ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={popup.title ? "welcome-popup-title" : undefined}
        aria-label={popup.title ? undefined : "Welcome"}
        className={`relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-fox-border bg-fox-card shadow-2xl transition-all duration-300 motion-reduce:transition-none ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.98] opacity-0"
        }`}
      >
        {popup.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={popup.imageUrl}
            alt=""
            decoding="async"
            className="w-full max-h-64 object-cover"
          />
        )}

        <div className="p-6">
          {popup.title && (
            <h2
              id="welcome-popup-title"
              className="font-display text-xl font-bold leading-snug"
            >
              {popup.title}
            </h2>
          )}

          {popup.body && (
            <p className="mt-2 text-sm leading-relaxed text-fox-muted whitespace-pre-line">
              {popup.body}
            </p>
          )}

          {popup.bullets.length > 0 && (
            <ul className="mt-4 space-y-2">
              {popup.bullets.map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-fox-text">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-green-500/15 text-green-400">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              ref={closeRef}
              type="button"
              onClick={dismiss}
              className="btn-ghost !px-5 !py-2.5 text-sm"
            >
              {popup.closeLabel}
            </button>

            {popup.telegramUrl && (
              <a
                href={popup.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={dismiss}
                className="btn-primary !px-5 !py-2.5 text-sm"
              >
                <Send className="h-4 w-4" />
                {popup.buttonLabel}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
