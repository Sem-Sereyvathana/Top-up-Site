"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import GoogleLoginButton from "./GoogleLoginButton";
import { LOGIN_REQUIRED_EVENT } from "@/lib/loginGate";

// Content comes from /api/signin-popup, edited in Admin → Sign-in Popup.
// Falls back to this default whenever the admin hasn't turned on a custom
// message (or the request fails) — the sign-in gate itself never depends
// on this content loading.
interface PopupContent {
  imageUrl: string | null;
  title: string;
  body: string;
  bullets: string[];
  closeLabel: string;
}

const DEFAULT_CONTENT: PopupContent = {
  imageUrl: null,
  title: "Sign in to continue",
  body: "Create a free account with Google to top up or buy — it only takes a few seconds.",
  bullets: [],
  closeLabel: "Not now",
};

export default function SignInPopup() {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [next, setNext] = useState("/account");
  const [content, setContent] = useState<PopupContent>(DEFAULT_CONTENT);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Any purchase button calls requireLogin() (lib/loginGate.ts), which
  // dispatches this event. We only fetch the custom content once we
  // actually need to show something, not on every page load.
  useEffect(() => {
    function onRequired(e: Event) {
      const detail = (e as CustomEvent<{ next?: string }>).detail;
      setNext(detail?.next || "/account");

      fetch("/api/signin-popup")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.popup) setContent(data.popup);
        })
        .catch(() => {});

      setOpen(true);
    }
    window.addEventListener(LOGIN_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(LOGIN_REQUIRED_EVENT, onRequired);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setOpen(false);
    setContent(DEFAULT_CONTENT);
  }, []);

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

  if (!open) return null;

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
        aria-labelledby="signin-popup-title"
        className={`relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-fox-border bg-fox-card shadow-2xl transition-all duration-300 motion-reduce:transition-none ${
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.98] opacity-0"
        }`}
      >
        {content.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={content.imageUrl}
            alt=""
            decoding="async"
            className="w-full max-h-56 object-cover"
          />
        )}

        <div className="p-6">
          <h2 id="signin-popup-title" className="font-display text-xl font-bold leading-snug">
            {content.title}
          </h2>

          {content.body && (
            <p className="mt-2 text-sm leading-relaxed text-fox-muted whitespace-pre-line">
              {content.body}
            </p>
          )}

          {content.bullets.length > 0 && (
            <ul className="mt-4 space-y-2">
              {content.bullets.map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-fox-text">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-green-500/15 text-green-400">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            <button
              ref={closeRef}
              type="button"
              onClick={dismiss}
              className="btn-ghost !px-5 !py-2.5 text-sm"
            >
              {content.closeLabel}
            </button>
            <GoogleLoginButton next={next} size="medium" />
          </div>
        </div>
      </div>
    </div>
  );
}
