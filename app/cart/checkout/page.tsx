"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useCurrency } from "@/lib/currency";
import { useShopCart, setGroupPendingOrder, clearGroupPendingOrder, getGroupPendingOrder } from "@/lib/shopCart";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { requireLogin, isLoginRequired, GOOGLE_LOGIN_REQUIRED } from "@/lib/loginGate";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  ShoppingCart,
  Wallet,
  Check,
  Gamepad2,
  Store,
  UserRoundCheck,
  AlertCircle,
  Clock,
} from "lucide-react";

// Combined checkout — one payment for Game Items + Accounts.
//
// The cart only ever holds marketplace items and accounts. Game top-up is a
// separate checkout (picked and paid on the game's own page) and is never
// mixed in here.
//
// Contact info: the buyer never types a Telegram handle here. When game
// items are in the basket, the Roblox username must be verified with the
// same "check user" flow as any item checkout; the signed-in buyer's
// Telegram username is recorded server-side (checkout-group API) so a
// manual handover can always reach them.

export default function CombinedCheckoutPage() {
  const router = useRouter();
  const { format } = useCurrency();
  const { linesFor, clear } = useShopCart();
  const { user } = useCurrentUser();

  const itemLines = linesFor("items");
  const accountLines = linesFor("accounts");

  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payWithWallet, setPayWithWallet] = useState(false);

  // Roblox "check user" verification — required when the basket contains
  // game items (they're delivered into an in-game account). Accounts don't
  // need it (the login handover happens after payment), so an accounts-only
  // basket skips this block entirely.
  const [robloxChecking, setRobloxChecking] = useState(false);
  const [robloxAccount, setRobloxAccount] = useState<{
    id: number;
    name: string;
    displayName: string;
    avatarUrl: string;
  } | null>(null);
  const [robloxError, setRobloxError] = useState<string | null>(null);

  async function checkAvatar() {
    if (!username.trim()) return;
    setRobloxChecking(true);
    setRobloxError(null);
    setRobloxAccount(null);
    try {
      const res = await fetch("/api/roblox/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Account not found");
      setRobloxAccount(data);
    } catch (err: any) {
      setRobloxError(err.message || "Couldn't verify that username. Double-check it and try again.");
    } finally {
      setRobloxChecking(false);
    }
  }

  const itemsTotal = itemLines.reduce((s, l) => s + l.card.priceUsd * l.quantity, 0);
  const accountsTotal = accountLines.reduce((s, l) => s + l.card.priceUsd * l.quantity, 0);
  const total = Math.round((itemsTotal + accountsTotal) * 100) / 100;

  const needsUsername = itemLines.length > 0;
  const walletCanCover = !!user && total > 0 && user.walletUsd >= total;

  // ── Resume an abandoned group payment ──
  // Mirrors the single-store checkouts: if the buyer has an unpaid combined
  // order from a previous visit, offer to jump straight back to its payment
  // screen instead of letting them create a duplicate.
  const [resumeOrderNumber, setResumeOrderNumber] = useState<string | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const pending = getGroupPendingOrder();
      if (!pending?.orderNumber) {
        setResumeChecked(true);
        return;
      }
      try {
        const res = await fetch(`/api/checkout-group/${encodeURIComponent(pending.orderNumber)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("not found");
        const data = await res.json();
        const expired = data.paymentExpiresAt && new Date(data.paymentExpiresAt).getTime() <= Date.now();
        if (data.status === "PENDING" && !expired) {
          setResumeOrderNumber(pending.orderNumber);
        } else {
          clearGroupPendingOrder();
        }
      } catch {
        clearGroupPendingOrder();
      } finally {
        setResumeChecked(true);
      }
    })();
    // Only ever runs once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startNewOrderInstead() {
    clearGroupPendingOrder();
    setResumeOrderNumber(null);
  }

  const canSubmit =
    total > 0 &&
    (!needsUsername || (username.trim().length > 0 && !!robloxAccount));

  const emptyCart = itemLines.length === 0 && accountLines.length === 0;

  async function handleCheckout() {
    if (!canSubmit || submitting) return;

    if (!user && GOOGLE_LOGIN_REQUIRED) {
      requireLogin();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod: "KHPAY",
          payWithWallet: payWithWallet || undefined,
          buyerUsername: username.trim() || undefined,
          // No customerContact — the buyer's Telegram username is attached
          // server-side from their account (checkout-group API).
          ...(itemLines.length > 0
            ? { items: itemLines.map((l) => ({ gameItemId: l.card.id, quantity: l.quantity })) }
            : {}),
          ...(accountLines.length > 0
            ? { accounts: accountLines.map((l) => ({ gameAccountId: l.card.id, quantity: l.quantity })) }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (isLoginRequired(res, data)) {
          requireLogin();
          setSubmitting(false);
          return;
        }
        throw new Error(data.error || "Failed to create order");
      }
      if (payWithWallet) {
        // Wallet payment finalizes the group server-side before this call
        // even returns — there is no payment screen to clear the cart later,
        // so clear it now.
        clear("items");
        clear("accounts");
      }
      // Remember this group so coming back here (e.g. from the payment
      // screen's "Cancel and go back") offers to resume instead of
      // duplicating the order. Cleared once the payment lands (the group
      // payment screen / tracker's onPaid) or when it expires.
      setGroupPendingOrder({ orderNumber: data.orderNumber, createdAt: Date.now() });
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setError(err.message || "Failed to create order");
      setSubmitting(false);
    }
  }

  // Groups don't clear the cart at order-creation time for KHQR payments —
  // the payment screen clears it once payment lands. Wallet payments clear
  // it in handleCheckout (they finalize immediately).

  if (emptyCart && resumeChecked && !resumeOrderNumber) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-3xl px-4 py-16">
          <div className="card p-10 text-center">
            <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-fox-muted/40" />
            <p className="text-fox-muted">Your cart is empty.</p>
            <div className="mt-5 flex justify-center gap-3">
              <Link href="/game-items" className="btn-ghost text-sm">Browse items</Link>
              <Link href="/accounts" className="btn-primary text-sm">Browse accounts</Link>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-fox-border bg-fox-card/80 hover:border-fox-primary/60"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Checkout</h1>
        </div>

        {!resumeChecked ? (
          <div className="flex items-center justify-center py-24 text-fox-muted">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Loading...
          </div>
        ) : resumeOrderNumber ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-fox-primary/40 bg-fox-primary/5 px-6 py-16 text-center backdrop-blur-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent shadow-lg shadow-fox-primary/30">
              <Clock className="h-6 w-6 text-black" />
            </div>
            <h2 className="text-lg font-semibold text-fox-text">You have a payment in progress</h2>
            <p className="text-sm text-fox-muted">
              Order <span className="font-mono text-fox-text">{resumeOrderNumber}</span> is still waiting to be
              paid — pick up right where you left off instead of filling everything in again.
            </p>
            <Link href={`/checkout/group/${resumeOrderNumber}`} className="btn-primary mt-2 w-full sm:w-auto">
              Continue to Payment
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={startNewOrderInstead}
              className="text-xs text-fox-muted hover:text-fox-text hover:underline"
            >
              Start a new order instead
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Basket */}
            <div className="card p-5 space-y-4">
              <h2 className="font-display font-bold">Your order</h2>

              {itemLines.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fox-muted">
                    <Gamepad2 className="h-3.5 w-3.5" /> Game Items
                  </div>
                  {itemLines.map((l) => (
                    <div key={l.card.id} className="flex justify-between py-1 text-sm">
                      <span className="truncate">
                        {l.card.name}
                        {l.quantity > 1 ? ` ×${l.quantity}` : ""}
                      </span>
                      <span className="shrink-0 font-semibold">{format(l.card.priceUsd * l.quantity)}</span>
                    </div>
                  ))}
                </div>
              )}

              {accountLines.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fox-muted">
                    <Store className="h-3.5 w-3.5" /> Accounts
                  </div>
                  {accountLines.map((l) => (
                    <div key={l.card.id} className="flex justify-between py-1 text-sm">
                      <span className="truncate">
                        {l.card.name}
                        {l.quantity > 1 ? ` ×${l.quantity}` : ""}
                      </span>
                      <span className="shrink-0 font-semibold">{format(l.card.priceUsd * l.quantity)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between border-t border-fox-border pt-3">
                <span className="font-semibold">Total</span>
                <span className="font-display text-xl font-bold text-fox-primary">{format(total)}</span>
              </div>
            </div>

            {/* Game username — only when game items are in the basket.
                Accounts don't need it: their login handover happens after
                payment. The Roblox check-user flow is REQUIRED here (same
                as the items checkout), so typos never reach delivery. */}
            {needsUsername && (
              <div className="card p-5 space-y-3">
                <h2 className="font-display font-bold">Your game username</h2>
                <input
                  className="input"
                  placeholder="Username in the game for item delivery"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setRobloxAccount(null);
                    setRobloxError(null);
                  }}
                />

                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={checkAvatar}
                    disabled={robloxChecking || !username.trim()}
                    className="btn-ghost w-full sm:w-auto self-start text-sm disabled:opacity-50"
                  >
                    {robloxChecking ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Checking…
                      </>
                    ) : (
                      "ពិនិត្យមើលអាខោន"
                    )}
                  </button>

                  {robloxAccount && (
                    <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 flex items-center gap-4">
                      <img
                        src={robloxAccount.avatarUrl}
                        alt="Roblox avatar"
                        loading="lazy"
                        decoding="async"
                        className="h-20 w-20 rounded-xl border border-fox-border object-cover bg-fox-bg"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-green-200">{robloxAccount.displayName}</span>
                          <UserRoundCheck className="h-4 w-4 text-green-400" />
                        </div>
                        <div className="text-sm text-fox-muted">@{robloxAccount.name}</div>
                        <div className="text-xs text-fox-muted mt-1 font-mono">User ID: {robloxAccount.id}</div>
                      </div>
                    </div>
                  )}

                  {robloxError && (
                    <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
                      {robloxError}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Payment */}
            <div className="card p-5 space-y-3">
              <h2 className="font-display font-bold">Payment</h2>

              {user && (
                <button
                  type="button"
                  onClick={() => setPayWithWallet((v) => !v)}
                  disabled={!walletCanCover && !payWithWallet}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    payWithWallet
                      ? "border-fox-primary/60 bg-fox-primary/10"
                      : "border-fox-border hover:border-fox-primary/40"
                  } ${!walletCanCover && !payWithWallet ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 font-semibold">
                        <Wallet className="h-4 w-4" /> Wallet ${user.walletUsd.toFixed(2)}
                      </div>
                      <div className="text-sm text-fox-muted">
                        {!walletCanCover
                          ? `Balance not enough (need $${total.toFixed(2)})`
                          : "Pay instantly from your wallet"}
                      </div>
                    </div>
                    {payWithWallet && <Check className="h-5 w-5 text-fox-primary" />}
                  </div>
                </button>
              )}

              <div className={`rounded-xl border p-4 ${payWithWallet ? "border-fox-border opacity-60" : "border-fox-primary/40 bg-fox-primary/5"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">KHQR Payment</div>
                    <div className="text-sm text-fox-muted">Scan once — every item is paid together</div>
                  </div>
                  {!payWithWallet && <Check className="h-5 w-5 text-fox-primary" />}
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
              )}

              {needsUsername && username.trim().length > 0 && !robloxAccount && !error && (
                <div className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Check your avatar above before you can pay.
                </div>
              )}

              <button
                type="button"
                onClick={handleCheckout}
                disabled={!canSubmit || submitting}
                className="btn-primary w-full disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" /> Creating order…
                  </>
                ) : needsUsername && !robloxAccount ? (
                  <>សូមចុចពិនិត្យមើលអាខោនរបស់អ្នកសិន</>
                ) : (
                  <>Pay {format(total)}</>
                )}
              </button>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
