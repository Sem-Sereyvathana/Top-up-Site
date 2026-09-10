"use client";

import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import TelegramLoginButton from "@/components/TelegramLoginButton";
import { Send } from "lucide-react";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/account";

  return (
    <>
      <Header />
      <main className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="card p-6 sm:p-8 text-center">
          <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent text-black">
            <Send className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-xl font-bold mb-2">Sign in with Telegram</h1>
          <p className="text-sm text-fox-muted mb-8">
            Connect your Telegram account to track orders and earn loyalty points.
            First time here? Connecting creates your account automatically.
          </p>

          <div className="flex justify-center">
            <TelegramLoginButton next={next} size="large" />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
