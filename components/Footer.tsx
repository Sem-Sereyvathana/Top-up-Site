"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DEFAULT_SITE_NAME,
  DEFAULT_SUPPORT_TELEGRAM,
  splitBrandName,
} from "@/lib/siteBrand";
import { toTelegramUrl } from "@/lib/telegramLink";

export default function Footer() {
  // Admin-configured brand (Settings) — same source as the header.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string>(DEFAULT_SITE_NAME);
  const [telegram, setTelegram] = useState<string>(DEFAULT_SUPPORT_TELEGRAM);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setLogoUrl(data?.logoUrl || null);
        if (data?.siteName) setSiteName(data.siteName);
        if (data?.supportTelegram) setTelegram(data.supportTelegram);
      })
      .catch(() => {});
  }, []);

  const [brandMain, brandAccent] = splitBrandName(siteName);
  const telegramUrl = toTelegramUrl(telegram);

  return (
    <footer className="mt-auto hidden md:block border-t border-fox-border/60 bg-fox-bg/80 text-fox-muted text-xs">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row justify-between items-start gap-8">
          
          {/* Brand Info */}
          <div className="max-w-xs space-y-3">
            <Link href="/" className="flex items-center gap-2">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={siteName}
                  loading="lazy"
                  decoding="async"
                  className="h-8 w-8 rounded-lg object-contain"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-fox-primary to-fox-accent text-white font-display font-bold text-sm">
                  {siteName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="font-display font-extrabold text-base tracking-tight text-fox-text uppercase">
                {brandMain}
                {brandAccent && <span className="text-fox-primary">{brandAccent}</span>}
              </span>
            </Link>
            <p className="text-fox-muted leading-relaxed">
              Cambodia&apos;s fastest game top-up. Instant delivery, secure payment.
            </p>
          </div>

          {/* Support Column */}
          <div>
            <h4 className="font-display text-xs font-bold uppercase tracking-wider text-fox-text mb-3">
              Support
            </h4>
            <ul className="space-y-2">
              <li>
                Telegram:{" "}
                {telegramUrl ? (
                  <a
                    href={telegramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-fox-text hover:text-fox-primary underline underline-offset-2"
                  >
                    {telegram}
                  </a>
                ) : (
                  telegram
                )}
              </li>
              <li>24/7 Service</li>
            </ul>
          </div>

        </div>
      </div>
    </footer>
  );
}
