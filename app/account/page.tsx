"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useCurrentUser } from "@/lib/useCurrentUser";
import {
  User,
  Mail,
  Phone,
  Coins,
  History as HistoryIcon,
  LogOut,
  LogIn,
} from "lucide-react";

// The real "My account" page for signed-in customers — linked from the
// AccountMenu dropdown in the Header ("My account"). Shows who they're
// signed in as and their loyalty points balance, with a link into their
// order history and a sign-out action. Intentionally simple/read-only:
// there's no profile-edit API yet, so this just surfaces what /api/auth/me
// already returns.
export default function AccountPage() {
  const router = useRouter();
  const { user, loading, refresh } = useCurrentUser();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    await refresh();
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:py-16 sm:px-6 lg:px-8">
        <h1 className="font-display text-2xl sm:text-3xl font-bold mb-6">My account</h1>

        {loading ? (
          <div className="space-y-2.5">
            {[0, 1].map((i) => (
              <div key={i} className="card h-20 animate-pulse" />
            ))}
          </div>
        ) : !user ? (
          <div className="card p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-fox-border bg-fox-card text-fox-primary">
              <LogIn className="h-5 w-5" strokeWidth={2} />
            </div>
            <h2 className="font-semibold text-lg mb-1">Connect Telegram to view your account</h2>
            <p className="text-sm text-fox-muted mb-5">
              Connect Telegram to see your profile, points balance, and order history.
            </p>
            <div className="flex items-center justify-center">
              <Link href="/login" className="btn-primary">Connect Telegram</Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4 fade-up">
            {/* Profile summary */}
            <div className="card p-5 sm:p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-fox-border bg-fox-card text-fox-primary">
                  <User className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{user.name || "Unnamed account"}</p>
                  <p className="text-xs text-fox-muted">Signed in</p>
                </div>
              </div>

              <div className="space-y-2.5 text-sm">
                {user.email && (
                  <div className="flex items-center gap-2.5 text-fox-text/90">
                    <Mail className="h-4 w-4 text-fox-muted shrink-0" strokeWidth={2} />
                    <span className="truncate">{user.email}</span>
                  </div>
                )}
                {user.phone && (
                  <div className="flex items-center gap-2.5 text-fox-text/90">
                    <Phone className="h-4 w-4 text-fox-muted shrink-0" strokeWidth={2} />
                    <span>{user.phone}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Points balance */}
            <div className="card p-5 sm:p-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-fox-border bg-fox-card text-fox-primary">
                  <Coins className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{user.points.toLocaleString()} points</p>
                  <p className="text-xs text-fox-muted">
                    ≈ ${user.pointsValueUsd.toFixed(2)} · redeemable at checkout once you have{" "}
                    {user.minRedeemPoints.toLocaleString()}+
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="card p-5 sm:p-6 space-y-2">
              <Link
                href="/history"
                className="flex items-center justify-between rounded-lg border border-fox-border bg-fox-card/60 px-4 py-3 text-sm font-medium hover:border-fox-primary/60 hover:text-fox-primary transition-all"
              >
                <span className="flex items-center gap-2.5">
                  <HistoryIcon className="h-4 w-4" strokeWidth={2} />
                  Order history
                </span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 rounded-lg border border-fox-border bg-fox-card/60 px-4 py-3 text-sm font-medium text-red-400 hover:border-red-400/60 transition-all"
              >
                <LogOut className="h-4 w-4" strokeWidth={2} />
                Sign out
              </button>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
