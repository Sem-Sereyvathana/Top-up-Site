"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useCurrency } from "@/lib/currency";
import { useShopCart, readBuyNow, getPendingOrder, setPendingOrder, clearPendingOrder, ShopKind, ShopCartLine } from "@/lib/shopCart";
import {
  ArrowRight,
  Lock,
  Loader2,
  AlertCircle,
  UserRoundCheck,
  ShoppingCart,
  Clock,
} from "lucide-react";

interface ShopCheckoutProps {
  kind: ShopKind;
  checkoutEndpoint: string;
  cartItemIdField: "gameItemId" | "gameAccountId";
  requireUsername: boolean;
  usernameLabel?: string;
  usernamePlaceholder?: string;
  backHref: string;
  pageTitle: string;
  // Where this marketplace's payment/QR screen lives for a given order
  // number — used to offer "resume payment" instead of the form below when
  // there's already an unpaid order sitting from a previous visit.
  paymentPageHref: (orderNumber: string) => string;
  // Whether to show the "Telegram / phone / email" field in the Payment
  // step. Both marketplaces pass false: neither needs it anymore. A MANUAL
  // order (Accounts or Game Items) sends the buyer straight to admin's
  // Telegram, with the order number and items pre-filled, right after
  // payment is confirmed — see MarketplaceOrderTracker's
  // autoRedirectManualPaid. Kept as a prop (rather than deleted outright)
  // in case a future marketplace still wants to collect it upfront.
  collectContact?: boolean;
}

export default function ShopCheckout({
  kind,
  checkoutEndpoint,
  cartItemIdField,
  requireUsername,
  usernameLabel = "In-game Username",
  usernamePlaceholder = "Your username in this game",
  backHref,
  pageTitle,
  paymentPageHref,
  collectContact = true,
}: ShopCheckoutProps) {
  const { format } = useCurrency();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { linesFor, removeLine } = useShopCart();

  const isBuyNow = searchParams.get("buyNow") === "1";
  const [buyNowLine, setBuyNowLine] = useState<ShopCartLine | null>(null);
  const [buyNowLoaded, setBuyNowLoaded] = useState(false);

  useEffect(() => {
    if (isBuyNow) {
      const card = readBuyNow();
      setBuyNowLine(card ? { card, quantity: 1 } : null);
    }
    setBuyNowLoaded(true);
  }, [isBuyNow]);

  // If the buyer already has an unpaid order sitting from a previous visit
  // (they left the payment screen instead of paying), offer to jump
  // straight back to it instead of making them fill this form in again.
  const [resumeOrderNumber, setResumeOrderNumber] = useState<string | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);

  useEffect(() => {
    const pending = getPendingOrder(kind);
    const mode = isBuyNow ? "buyNow" : "cart";
    if (!pending || pending.mode !== mode) {
      setResumeChecked(true);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${checkoutEndpoint}/${encodeURIComponent(pending.orderNumber)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("not found");
        const data = await res.json();
        const expired = data.paymentExpiresAt && new Date(data.paymentExpiresAt).getTime() <= Date.now();
        const stillPayable = data.status === "PENDING" && !expired;
        if (stillPayable) {
          setResumeOrderNumber(pending.orderNumber);
        } else {
          clearPendingOrder(kind);
        }
      } catch {
        clearPendingOrder(kind);
      } finally {
        setResumeChecked(true);
      }
    })();
    // Only ever needs to run once per visit — deliberately not re-running
    // when isBuyNow/kind flip within the same mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startNewOrderInstead() {
    clearPendingOrder(kind);
    setResumeOrderNumber(null);
  }

  const cartLines = linesFor(kind);
  const lines = isBuyNow ? (buyNowLine ? [buyNowLine] : []) : cartLines;

  const [username, setUsername] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const subtotal = lines.reduce((sum, l) => sum + l.card.priceUsd * l.quantity, 0);

  const canSubmit =
    lines.length > 0 &&
    (!requireUsername || (username.trim().length > 0 && !!robloxAccount)) &&
    !submitting;

  async function handleCheckout() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        paymentMethod: "KHPAY",
      };
      if (collectContact) payload.customerContact = contact.trim() || undefined;
      if (requireUsername) payload.buyerUsername = username.trim();

      // Both marketplaces (Game Items and Accounts) now check out the same
      // way — quantity per line — so both send `items`. Accounts still
      // enforces quantity 1 for unique-login accounts server-side, and up
      // to remaining stock for multi-stock ones.
      payload.items = lines.map((l) => ({
        [cartItemIdField]: l.card.id,
        quantity: l.quantity,
      }));

      const res = await fetch(checkoutEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create order");

      // Cart (and buyNow selection) is intentionally left untouched here —
      // the order still isn't paid yet. It only gets cleared once payment
      // actually goes through (see MarketplaceCheckout's onPaid), so if the
      // buyer navigates away or the QR expires before paying, their picks
      // are still sitting in the cart instead of vanishing. We do remember
      // this order number, though, so coming back here offers to resume
      // straight to payment instead of re-asking for the form.
      setPendingOrder(kind, {
        orderNumber: data.orderNumber,
        mode: isBuyNow ? "buyNow" : "cart",
        createdAt: Date.now(),
      });

      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setError(err.message || "Failed to create order");
      setSubmitting(false);
    }
  }

  const stepNum = (n: number) => (requireUsername ? n : n - 1);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="font-display text-2xl font-bold mb-8 sm:text-3xl">{pageTitle}</h1>

        {!buyNowLoaded || !resumeChecked ? (
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
            <Link href={paymentPageHref(resumeOrderNumber)} className="btn-primary mt-2 w-full sm:w-auto">
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
        ) : lines.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-fox-border/70 bg-fox-card/40 px-6 py-16 text-center backdrop-blur-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent shadow-lg shadow-fox-primary/30">
              <ShoppingCart className="h-6 w-6 text-black" />
            </div>
            <h2 className="text-lg font-semibold text-fox-text">Your cart is empty</h2>
            <p className="text-sm text-fox-muted">Pick something out first, then come back here to check out.</p>
            <Link href={backHref} className="btn-primary mt-2">
              Back to shop
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {/* STEP — YOUR ORDER */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
                  {stepNum(1)}
                </div>
                <h2 className="font-display text-xl font-bold">Your Order</h2>
              </div>

              <div className="card p-5 sm:p-6">
                <div className="space-y-2">
                  {lines.map((l) => (
                    <div key={l.card.id} className="flex items-center justify-between text-sm">
                      <span className="text-fox-text">
                        {l.card.name}
                        {l.quantity > 1 ? ` ×${l.quantity}` : ""}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-fox-muted">{format(l.card.priceUsd * l.quantity)}</span>
                        {!isBuyNow && (
                          <button
                            type="button"
                            onClick={() => removeLine(kind, l.card.id)}
                            className="text-xs text-red-400 hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-fox-border pt-3">
                  <span className="text-sm text-fox-muted">Subtotal</span>
                  <span className="font-display text-xl font-bold text-fox-primary">{format(subtotal)}</span>
                </div>
              </div>
            </div>

            {/* STEP — ACCOUNT INFO */}
            {requireUsername && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
                    {stepNum(2)}
                  </div>
                  <h2 className="font-display text-xl font-bold">Enter Account Info</h2>
                </div>

                <div className="card p-5 sm:p-6 space-y-4">
                  <div>
                    <label className="label">{usernameLabel}</label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setRobloxAccount(null);
                        setRobloxError(null);
                      }}
                      placeholder={usernamePlaceholder}
                      className="input font-mono text-lg py-3.5"
                      required
                    />
                  </div>

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
                        "Check Avatar"
                      )}
                    </button>

                    {robloxAccount && (
                      <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 flex items-center gap-4">
                        <img
                          src={robloxAccount.avatarUrl}
                          alt="Roblox avatar"
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
              </div>
            )}

            {/* STEP — CONTACT + PAYMENT */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fox-primary to-fox-accent font-display font-bold text-black shadow-lg shadow-fox-primary/40">
                  {stepNum(requireUsername ? 3 : 2)}
                </div>
                <h2 className="font-display text-xl font-bold">Payment</h2>
              </div>

              <div className="card p-5 sm:p-6 space-y-4">
                {collectContact && (
                  <div>
                    <label className="label">
                      Telegram / phone / email <span className="font-normal text-fox-muted/60">(optional)</span>
                    </label>
                    <input
                      className="input"
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      placeholder="@yourhandle"
                    />
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                {requireUsername && username.trim().length > 0 && !robloxAccount && !error && (
                  <div className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Check your avatar above before you can pay.
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={!canSubmit}
                  className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Creating Order…
                    </>
                  ) : (
                    <>
                      Pay {format(subtotal)}
                      <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-2 text-xs text-fox-muted">
                  <Lock className="h-3.5 w-3.5" />
                  Secure payment
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
