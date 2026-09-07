"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useCurrentUser } from "@/lib/useCurrentUser";
import {
  Zap,
  ShoppingBag,
  UserRound,
  ChevronRight,
  ChevronLeft,
  PackageOpen,
  LogIn,
} from "lucide-react";

interface HistoryOrder {
  type: "TOPUP" | "GAME_ITEM" | "GAME_ACCOUNT";
  orderNumber: string;
  status: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  amountUsd: number;
  createdAt: string;
  viewHref: string;
}

type FilterKey = "ALL" | HistoryOrder["type"];

const STATUS_META: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Awaiting Payment", color: "text-yellow-400 border-yellow-400/40 bg-yellow-400/10" },
  PAID: { label: "Payment Received", color: "text-blue-400 border-blue-400/40 bg-blue-400/10" },
  PROCESSING: { label: "Processing", color: "text-blue-400 border-blue-400/40 bg-blue-400/10" },
  DELIVERED: { label: "Delivered", color: "text-green-400 border-green-400/40 bg-green-400/10" },
  FAILED: { label: "Failed", color: "text-red-400 border-red-400/40 bg-red-400/10" },
  REFUNDED: { label: "Refunded", color: "text-fox-muted border-fox-border bg-fox-card" },
  CANCELLED: { label: "Cancelled", color: "text-fox-muted border-fox-border bg-fox-card" },
};

const TYPE_META: Record<HistoryOrder["type"], { label: string; Icon: typeof Zap }> = {
  TOPUP: { label: "Top up", Icon: Zap },
  GAME_ITEM: { label: "Game Items", Icon: ShoppingBag },
  GAME_ACCOUNT: { label: "Account", Icon: UserRound },
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "TOPUP", label: "Top up" },
  { key: "GAME_ITEM", label: "Game Items" },
  { key: "GAME_ACCOUNT", label: "Account" },
];

const PAGE_SIZE = 6;

export default function HistoryPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const [orders, setOrders] = useState<HistoryOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/orders", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load your order history");
        const data = await res.json();
        if (!cancelled) setOrders(data.orders);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    return filter === "ALL" ? orders : orders.filter((o) => o.type === filter);
  }, [orders, filter]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageOrders = filteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function selectFilter(key: FilterKey) {
    setFilter(key);
    setPage(1);
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16 sm:px-6 lg:px-8">
        {userLoading ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card h-16 animate-pulse" />
            ))}
          </div>
        ) : !user ? (
          <div className="card p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-fox-border bg-fox-card text-fox-primary">
              <LogIn className="h-5 w-5" strokeWidth={2} />
            </div>
            <h2 className="font-semibold text-lg mb-1">Sign in to view your history</h2>
            <p className="text-sm text-fox-muted mb-5">
              Your order history is tied to your account so we can keep it safe and up to date.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link href="/login" className="btn-primary">Sign in</Link>
              <Link href="/register" className="btn-ghost">Create account</Link>
            </div>
          </div>
        ) : error ? (
          <div className="card p-6 text-center text-sm text-red-400">{error}</div>
        ) : orders === null ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card h-16 animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-fox-border bg-fox-card text-fox-muted">
              <PackageOpen className="h-5 w-5" strokeWidth={2} />
            </div>
            <h2 className="font-semibold text-lg mb-1">No orders yet</h2>
            <p className="text-sm text-fox-muted mb-5">Once you make a purchase, it'll show up here.</p>
            <Link href="/game-items" className="btn-primary">Browse Game Items</Link>
          </div>
        ) : (
          <>
            {/* Filter pills — same style as the Game Items category bar */}
            <div className="mb-5 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => selectFilter(f.key)}
                  className={`shrink-0 rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors sm:text-sm ${
                    filter === f.key
                      ? "border-fox-primary bg-fox-primary text-white shadow-glow-sm"
                      : "border-fox-border/70 bg-fox-card/60 text-fox-text hover:border-fox-primary/60"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredOrders.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-sm text-fox-muted">No orders in this category yet.</p>
              </div>
            ) : (
              <div className="space-y-2.5 fade-up">
                {pageOrders.map((order) => {
                  const meta = STATUS_META[order.status] ?? STATUS_META.PENDING;
                  const { label: typeLabel, Icon } = TYPE_META[order.type];
                  return (
                    <div
                      key={`${order.type}-${order.orderNumber}`}
                      className="card p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center gap-3"
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-fox-border bg-fox-card text-fox-primary">
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{order.title}</p>
                          <p className="text-[11px] text-fox-muted flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                            <span>{typeLabel}</span>
                            <span aria-hidden>·</span>
                            <span className="font-mono">{order.orderNumber}</span>
                            <span aria-hidden>·</span>
                            <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="text-right">
                          <div className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.color}`}>
                            {meta.label}
                          </div>
                          <p className="text-xs font-bold text-fox-primary mt-0.5">${order.amountUsd.toFixed(2)}</p>
                        </div>
                        <Link
                          href={order.viewHref}
                          className="inline-flex items-center gap-1 rounded-lg border border-fox-border bg-fox-card/80 px-2.5 py-1.5 text-[11px] font-semibold text-fox-text hover:border-fox-primary/60 hover:text-fox-primary transition-all shrink-0"
                        >
                          View
                          <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-fox-border bg-fox-card/80 text-fox-text disabled:opacity-30 hover:border-fox-primary/60 hover:text-fox-primary transition-all"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-semibold transition-all ${
                      p === currentPage
                        ? "border-fox-primary bg-fox-primary text-black"
                        : "border-fox-border bg-fox-card/80 text-fox-text hover:border-fox-primary/60 hover:text-fox-primary"
                    }`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-fox-border bg-fox-card/80 text-fox-text disabled:opacity-30 hover:border-fox-primary/60 hover:text-fox-primary transition-all"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
