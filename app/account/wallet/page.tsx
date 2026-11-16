"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { useCurrency } from "@/lib/currency";
import { Loader2, Plus, ArrowDownLeft, ArrowUpRight, ShieldCheck, Wallet } from "lucide-react";

interface WalletTx {
  id: string;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  note: string | null;
  createdAt: string;
}

const TYPE_LABEL: Record<string, string> = {
  TOPUP: "Wallet top-up",
  PURCHASE: "Order paid",
  REFUND: "Refund",
  ADMIN_ADJUST: "Admin adjustment",
};

export default function WalletPage() {
  const { user, loading: userLoading, refresh } = useCurrentUser();
  const { format } = useCurrency();

  const [txs, setTxs] = useState<WalletTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [topUpAmount, setTopUpAmount] = useState("5");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Active top-up being paid for (poll for confirmation)
  const [pending, setPending] = useState<{ orderNumber: string; paymentUrl: string | null; qrString: string | null } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/wallet", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setTxs(data.transactions ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user, load]);

  // Poll the active top-up until the webhook credits it.
  useEffect(() => {
    if (!pending) return;
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/wallet/${pending.orderNumber}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "PAID") {
          setPending(null);
          await Promise.all([load(), refresh()]);
        } else if (data.status === "FAILED") {
          setPending(null);
          setError("The payment did not go through. You can try again.");
        }
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pending, load, refresh]);

  async function startTopUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const usd = parseFloat(topUpAmount);
    if (!Number.isFinite(usd) || usd <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setStarting(true);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsd: usd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the top-up.");
      setPending({ orderNumber: data.orderNumber, paymentUrl: data.paymentUrl, qrString: data.qrString });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-2xl sm:text-3xl font-bold mb-6 flex items-center gap-3">
          <Wallet className="h-7 w-7 text-fox-primary" /> Wallet
        </h1>

        {userLoading ? (
          <div className="py-16 text-center text-fox-muted">Loading…</div>
        ) : !user ? (
          <div className="card p-10 text-center">
            <p className="text-fox-muted mb-4">Sign in to use your wallet.</p>
            <a href="/login" className="btn-primary text-sm">Sign in</a>
          </div>
        ) : (
          <>
            {/* Balance card */}
            <div className="card-glow p-6 mb-6 border border-fox-primary/20">
              <div className="text-xs uppercase tracking-widest text-fox-muted mb-1">Balance</div>
              <div className="font-display text-4xl font-bold text-fox-primary">
                {format(user.walletUsd)}
              </div>
            </div>

            {/* Top-up */}
            <div className="card p-5 mb-6">
              <h2 className="font-display font-bold mb-3">Top up wallet</h2>
              {pending ? (
                <div className="rounded-lg border border-fox-primary/40 bg-fox-primary/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Loader2 className="h-4 w-4 animate-spin text-fox-primary" />
                    <span className="text-sm font-medium">
                      Waiting for payment of {pending.orderNumber}…
                    </span>
                  </div>
                  <p className="text-xs text-fox-muted mb-3">
                    Complete the KHQR payment. The balance appears here automatically.
                  </p>
                  {pending.paymentUrl && (
                    <a href={pending.paymentUrl} target="_blank" rel="noreferrer" className="btn-primary text-sm inline-flex items-center gap-2">
                      Open payment page
                    </a>
                  )}
                </div>
              ) : (
                <form onSubmit={startTopUp} className="flex flex-col sm:flex-row gap-3 sm:items-end">
                  <div className="flex-1">
                    <label className="label">Amount (USD)</label>
                    <input
                      type="number"
                      step="0.25"
                      min="1"
                      max="1000"
                      value={topUpAmount}
                      onChange={(e) => setTopUpAmount(e.target.value)}
                      className="input"
                    />
                  </div>
                  <button type="submit" disabled={starting} className="btn-primary text-sm disabled:opacity-50">
                    {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Create payment QR
                  </button>
                </form>
              )}
              {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
              <div className="flex items-center gap-2 mt-4 text-xs text-fox-muted">
                <ShieldCheck className="h-3.5 w-3.5" />
                Credited automatically after payment — usually within seconds.
              </div>
            </div>

            {/* History */}
            <div className="card p-5">
              <h2 className="font-display font-bold mb-4">Transactions</h2>
              {loading ? (
                <div className="text-fox-muted text-sm py-4">Loading…</div>
              ) : txs.length === 0 ? (
                <p className="text-fox-muted text-sm py-4">No transactions yet.</p>
              ) : (
                <div className="divide-y divide-fox-border/50">
                  {txs.map((tx) => {
                    const positive = tx.amountCents > 0;
                    return (
                      <div key={tx.id} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-full ${positive ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                            {positive ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                          </div>
                          <div>
                            <div className="text-sm font-medium">{TYPE_LABEL[tx.type] ?? tx.type}</div>
                            <div className="text-xs text-fox-muted">
                              {tx.note || "—"} · {new Date(tx.createdAt).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-bold ${positive ? "text-green-400" : "text-red-400"}`}>
                            {positive ? "+" : ""}${(tx.amountCents / 100).toFixed(2)}
                          </div>
                          <div className="text-xs text-fox-muted">
                            bal ${(tx.balanceAfterCents / 100).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
