"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import GiftCodesCard from "@/components/GiftCodesCard";
import GroupReceiptCard, { type ReceiptPart } from "@/components/GroupReceiptCard";
import { useShopCart, getGroupPendingOrder, clearGroupPendingOrder } from "@/lib/shopCart";
import {
  Package,
  CheckCircle2,
  XCircle,
  Truck,
  CreditCard,
  FileText,
  History,
  Gamepad2,
  Store,
  Coins,
  PlayCircle,
  X,
} from "lucide-react";

// Order tracker for a COMBINED multi-store order (GRP- numbers).
//
// Shows every line the buyer paid for in one card with one total and one
// timeline — plus the gift-card codes block at the bottom, since gift cards
// are the only line that needs a redeem step.

interface GroupLine {
  kind: "topup" | "item" | "account" | "giftcard";
  title: string;
  detail: string;
  quantity: number;
  amountUsd: number;
  status: string;
  codes?: string[];
}

interface GroupOrder {
  orderNumber: string;
  status: string;
  amountUsd: number;
  amountKhr?: number | null;
  paymentMethod: string;
  paymentUrl?: string | null;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  supportTelegram?: string | null;
  lines: GroupLine[];
  // Each part of the cart as its OWN receipt — stacked on this page. There
  // is no merged receipt and no overall status; each card updates alone.
  receipts?: ReceiptPart[];
}

const TERMINAL = new Set(["DELIVERED", "FAILED", "REFUNDED", "CANCELLED"]);

const STATUS_META: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Awaiting Payment", color: "text-yellow-400 border-yellow-400/40 bg-yellow-400/10" },
  PAID: { label: "Payment Received", color: "text-blue-400 border-blue-400/40 bg-blue-400/10" },
  PROCESSING: { label: "Processing", color: "text-blue-400 border-blue-400/40 bg-blue-400/10" },
  DELIVERED: { label: "Delivered", color: "text-green-400 border-green-400/40 bg-green-400/10" },
  FAILED: { label: "Failed", color: "text-red-400 border-red-400/40 bg-red-400/10" },
  REFUNDED: { label: "Refunded", color: "text-fox-muted border-fox-border bg-fox-card" },
  CANCELLED: { label: "Cancelled", color: "text-fox-muted border-fox-border bg-fox-card" },
};

const KIND_ICON = {
  topup: Coins,
  item: Gamepad2,
  account: Store,
  giftcard: Coins,
} as const;

function GroupTracker() {
  const params = useSearchParams();
  const [order, setOrder] = useState<GroupOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemVideoUrl, setRedeemVideoUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const paidFiredRef = useRef(false);
  const { clear } = useShopCart();

  const num = params.get("number") || "";

  const load = useCallback(async () => {
    if (!num) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/checkout-group/${encodeURIComponent(num)}`, { cache: "no-store" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Order not found");
      }
      const data: GroupOrder = await res.json();
      setOrder(data);
      if (TERMINAL.has(data.status) && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [num]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while the payment/delivery is still in flight.
  useEffect(() => {
    if (!order || TERMINAL.has(order.status)) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(load, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [order?.status, load]);

  // Once the group is actually paid, the combined cart that funded it can
  // be cleared — but ONLY if this group is the one the cart was for (the
  // resume key is written at checkout time). An old paid group opened from
  // History must never wipe a buyer's fresh picks.
  useEffect(() => {
    if (!order?.paidAt || paidFiredRef.current) return;
    const pending = getGroupPendingOrder();
    if (pending?.orderNumber !== order.orderNumber) return;
    paidFiredRef.current = true;
    clear("items");
    clear("accounts");
    clearGroupPendingOrder();
  }, [order?.paidAt, order?.orderNumber, clear]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRedeemVideoUrl(d?.redeemVideoUrl || null))
      .catch(() => {});
  }, []);

  const giftLines = order?.lines.filter((l) => l.kind === "giftcard") ?? [];
  const hasGiftcard = giftLines.length > 0;
  const meta = order ? STATUS_META[order.status] ?? STATUS_META.PENDING : null;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
        {loading && !order && <div className="card mb-8 h-40 animate-pulse" />}

        {error && (
          <div className="card mb-8 p-6 text-center">
            <p className="mb-4 flex items-center justify-center gap-2 text-sm text-red-400">
              <XCircle className="h-4 w-4" /> {error}
            </p>
            <Link href="/history" className="btn-ghost inline-flex items-center gap-2">
              <History className="h-4 w-4" /> View order history
            </Link>
          </div>
        )}

        {order && meta && (
          <div className="card fade-up overflow-hidden">
            <div className="border-b border-fox-border p-5 sm:p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-widest text-fox-muted">Combined order</p>
                  <p className="font-mono text-lg font-bold sm:text-xl">{order.orderNumber}</p>
                </div>
                <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${meta.color}`}>
                  {meta.label}
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="border-b border-fox-border p-5 sm:p-6">
              <div className="flex items-center">
                {[
                  { key: "created", label: "Order Created", Icon: Package },
                  { key: "paid", label: "Payment Received", Icon: CreditCard },
                  { key: "delivered", label: "Delivered", Icon: Truck },
                ].map((step, i, arr) => {
                  const done =
                    step.key === "created" ||
                    (step.key === "paid" && !!order.paidAt) ||
                    (step.key === "delivered" && !!order.deliveredAt);
                  return (
                    <div key={step.key} className="flex flex-1 items-center">
                      <div className="flex flex-col items-center gap-1.5">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-full border-2 ${
                            done ? "border-green-400 bg-green-400/10 text-green-400" : "border-fox-border text-fox-muted"
                          }`}
                        >
                          <step.Icon className="h-4 w-4" />
                        </div>
                        <span className={`text-[10px] ${done ? "text-green-400" : "text-fox-muted"}`}>
                          {step.label}
                        </span>
                      </div>
                      {i < arr.length - 1 && (
                        <div className={`mx-2 h-0.5 flex-1 ${done ? "bg-green-400/60" : "bg-fox-border"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Stacked, INDEPENDENT receipts. Order is set server-side:
                auto-delivered part first, then the account, then a manual
                item (which is the one the buyer has to act on). */}
            {order.receipts && order.receipts.length > 0 && (
              <div className="space-y-2.5 p-5 sm:p-6">
                {order.receipts.map((r, i) => (
                  <GroupReceiptCard
                    key={`${r.orderNumber}-${r.itemId ?? r.kind}-${i}`}
                    part={r}
                    supportTelegram={order.supportTelegram ?? null}
                  />
                ))}
              </div>
            )}

            {/* Gift cards (never part of an item+account cart today, but kept
                so a legacy group still shows its codes). */}
            {order.lines.some((l) => l.kind === "giftcard") && (
              <div className="space-y-2 px-5 pb-5 text-sm sm:px-6 sm:pb-6">
                {order.lines
                  .filter((l) => l.kind === "giftcard")
                  .map((l, i) => (
                    <div key={i} className="flex justify-between border-b border-fox-border/40 py-2">
                      <span className="truncate">{l.title}</span>
                      <span className="shrink-0 font-semibold">${l.amountUsd.toFixed(2)}</span>
                    </div>
                  ))}
              </div>
            )}

            <div className="px-5 pb-5 text-sm sm:px-6 sm:pb-6">
              <div className="flex justify-between pt-3">
                <span className="font-semibold">Total</span>
                <span className="font-display text-lg font-bold text-fox-primary">
                  ${order.amountUsd.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between text-xs text-fox-muted">
                <span>Payment</span>
                <span>{order.paymentMethod.replace("_", " ")}</span>
              </div>
              <div className="flex justify-between text-xs text-fox-muted">
                <span>Created</span>
                <span>{new Date(order.createdAt).toLocaleString()}</span>
              </div>
              {order.paidAt && (
                <div className="flex justify-between text-xs text-fox-muted">
                  <span>Paid</span>
                  <span>{new Date(order.paidAt).toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Gift cards always last */}
            {hasGiftcard && (
              <div className="mx-5 mb-5 space-y-3 sm:mx-6 sm:mb-6">
                <div className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-300">
                  <CheckCircle2 className="h-5 w-5 shrink-0" /> Your gift card codes are below.
                </div>

                {giftLines.map((l, gi) =>
                  l.codes && l.codes.length > 0 ? (
                    <GiftCodesCard key={gi} groups={[{ label: l.title, codes: l.codes }]} />
                  ) : null
                )}

                <button
                  type="button"
                  onClick={() => setRedeemOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-fox-primary/40 bg-fox-primary/10 py-3 text-sm font-semibold text-fox-primary transition-colors hover:bg-fox-primary/20"
                >
                  <PlayCircle className="h-4 w-4" />
                  ចុចទីនេះដើម្បីមើលរបៀបប្រើកូដ
                </button>
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />

      {redeemOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div aria-hidden className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setRedeemOpen(false)} />
          <div className="relative w-full max-w-2xl rounded-2xl border border-fox-border bg-fox-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-fox-border px-5 py-3">
              <h2 className="font-display font-bold">របៀបប្រើកូដ</h2>
              <button
                type="button"
                onClick={() => setRedeemOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-fox-muted hover:bg-fox-surface hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              {redeemVideoUrl && (
                <div className="space-y-2">
                  {/youtube\.com|youtu\.be|vimeo\.com|facebook\.com/i.test(redeemVideoUrl) ? (
                    <iframe
                      src={redeemVideoUrl}
                      title="How to redeem your code"
                      className="aspect-video w-full rounded-lg border border-fox-border"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <video src={redeemVideoUrl} controls autoPlay playsInline className="w-full rounded-lg border border-fox-border bg-black" />
                  )}
                  <p className="text-center text-[11px] text-fox-muted">
                    ប្រសិនបើវីដេអូមិនដំណើរការ សូមអានការណែនាំខាងក្រោម។
                  </p>
                </div>
              )}
              <ol className="list-decimal space-y-2 pl-5 text-sm text-fox-text/90">
                <li>Go to <span className="font-mono text-fox-primary">roblox.com/redeem</span> and sign in.</li>
                <li>Enter the gift card code shown on this page.</li>
                <li>Confirm — the Robux (or credit) is added to your account.</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function GroupOrderPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-fox-muted">Loading…</div>}>
      <GroupTracker />
    </Suspense>
  );
}
