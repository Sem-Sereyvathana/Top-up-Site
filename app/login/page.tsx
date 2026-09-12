"use client";

import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import GoogleLoginButton from "@/components/GoogleLoginButton";
import { User } from "lucide-react";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/account";
  const error = searchParams.get("error");

  return (
    <>
      <Header />
      <main className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="card p-6 sm:p-8 text-center">
          <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent text-black">
            <User className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-xl font-bold mb-2">Sign in with Google</h1>
          <p className="text-sm text-fox-muted mb-8">
            Connect your Google account to track orders and earn loyalty points.
            First time here? Connecting creates your account automatically.
          </p>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-center">
            <GoogleLoginButton next={next} size="large" />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
