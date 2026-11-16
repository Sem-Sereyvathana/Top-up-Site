"use client";

import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import TelegramLoginButton from "@/components/TelegramLoginButton";
import GoogleLoginButton from "@/components/GoogleLoginButton";
import { useTelegramBotUsername } from "@/lib/useTelegramBotUsername";
import { User } from "lucide-react";

// Sign-in page. Telegram is the login (the site gets the customer's
// telegram id/username for order handover), verified server-side against
// the configured bot token. Google stays as a small fallback for customers
// who prefer it. The bot username is resolved server-side from the bot
// token (see lib/telegramLogin.ts) — the admin only has to paste the token
// in Admin → Settings.
export default function LoginPage() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/account";
  const error = searchParams.get("error");
  const botUsername = useTelegramBotUsername();

  return (
    <>
      <Header />
      <main className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="card p-6 sm:p-8 text-center">
          <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent text-black">
            <User className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-xl font-bold mb-2">Sign in</h1>
          <p className="text-sm text-fox-muted mb-8">
            Sign in with Telegram to track orders, earn loyalty points and reach support
            instantly. First time here? Signing in creates your account automatically.
          </p>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-col items-center gap-5">
            {botUsername ? (
              <TelegramLoginButton botUsername={botUsername} next={next} size="large" />
            ) : (
              <p className="text-sm text-fox-muted">
                Telegram sign-in isn&apos;t set up yet. Add your bot token in{" "}
                <span className="text-fox-text">Admin → Settings</span> to enable it.
              </p>
            )}

            <div className="w-full rounded-lg border border-fox-border bg-fox-card/40 px-4 py-3 text-left">
              <p className="text-sm font-medium text-fox-text">Having trouble with Telegram?</p>
              <p className="mt-0.5 text-xs text-fox-muted mb-3">
                You can also sign in with Google instead.
              </p>
              <GoogleLoginButton next={next} size="medium" label="Continue with Google" compactLabel="Continue with Google" />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
