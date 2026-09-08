"use client";

import { useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Package, CheckCircle2, XCircle, Truck, CreditCard, Send, History } from "lucide-react";

// Order-status tracker shared by the Game Items and Accounts marketplaces.
// Mirrors app/order/page.tsx (Top-up's tracker) but stops at PAID rather
// than auto-advancing to DELIVERED — both new marketplaces always need a
// human (admin) to hit "Mark delivered" themselves once the items/account
// have actually been handed over. See lib/gameItemFulfillment and
// lib/gameAccountFulfillment.
//
// No manual search box here — orders are reached either via the ?number=
// query param (post-payment redirect) or from the account History page,
// which lists every past order with a direct link straight here.

interface MarketplaceOrderInfo {
  orderNumber: string;
  status: string;
  amountUsd: number;
  paymentMethod: string;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  deliveryMode: string;
  supportTelegram: string | null;
  [key: string]: unknown;
}

const TIMELINE_STEPS = [
  { key: "PENDING", label: "Order Created", Icon: Package },
  { key: "PAID", label: "Payment Received", Icon: CreditCard },
  { key: "DELIVERED", label: "Delivered", Icon: Truck },
];

const STATUS_ORDER: Record<string, number> = {
  PENDING: 0,
  PAID: 1,
  DELIVERED: 2,
  FAILED: -1,
  REFUNDED: -1,
  CANCELLED: -1,
};

const STATUS_META: Record<string, { label: string; color: string; desc: string }> = {
  PENDING: { label: "Awaiting Payment", color: "text-yellow-400 border-yellow-400/40 bg-yellow-400/10", desc: "Waiting for your payment" },
  PAID: { label: "Payment Received", color: "text-blue-400 border-blue-400/40 bg-blue-400/10", desc: "Queued for delivery" },
  DELIVERED: { label: "Delivered", color: "text-green-400 border-green-400/40 bg-green-400/10", desc: "All set!" },
  FAILED: { label: "Failed", color: "text-red-400 border-red-400/40 bg-red-400/10", desc: "Something went wrong — contact support" },
  REFUNDED: { label: "Refunded", color: "text-fox-muted border-fox-border bg-fox-card", desc: "Order refunded" },
  CANCELLED: { label: "Cancelled", color: "text-fox-muted border-fox-border bg-fox-card", desc: "Order was cancelled" },
};

const TERMINAL_STATUSES = new Set(["DELIVERED", "FAILED", "REFUNDED", "CANCELLED"]);

export default function MarketplaceOrderTracker({
  apiBase,
  renderDetails,
  renderPostPaidExtra,
  buildTelegramMessage,
  autoRedirectManualPaid = false,
  hideTimeline = false,
  policyContent,
}: {
  apiBase: string;
  renderDetails: (order: MarketplaceOrderInfo) => ReactNode;
  renderPostPaidExtra?: (order: MarketplaceOrderInfo) => ReactNode;
  // Builds the pre-filled Telegram message text for a MANUAL order once
  // it's PAID, e.g. including the order number and items so admin can
  // verify at a glance. Optional — plain link with no pre-filled text if
  // omitted.
  buildTelegramMessage?: (order: MarketplaceOrderInfo) => string;
  // When true, automatically navigates the browser to admin's Telegram
  // (with buildTelegramMessage pre-filled) the moment a MANUAL order is
  // seen as PAID, instead of just showing a button the buyer has to tap.
  autoRedirectManualPaid?: boolean;
  // When true, skips the Order Created / Payment Received / Delivered
  // step tracker entirely (still shows the failed-state block if the
  // order failed) and shows `policyContent` in its place instead.
  hideTimeline?: boolean;
  policyContent?: ReactNode;
}) {
  const searchParams = useSearchParams();
  const [order, setOrder] = useState<MarketplaceOrderInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const telegramRedirectedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (orderNum: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${apiBase}/${encodeURIComponent(orderNum)}`);
          if (!res.ok) return;
          const data: MarketplaceOrderInfo = await res.json();
          setOrder(data);
          if (TERMINAL_STATUSES.has(data.status)) stopPolling();
        } catch {
          /* silent */
        }
      }, 3000);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopPolling, apiBase]
  );

  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    const num = searchParams?.get("number");
    if (num && !order && !loading) {
      const upperNum = num.trim().toUpperCase();
      setLoading(true);
      setError(null);
      (async () => {
        try {
          const res = await fetch(`${apiBase}/${encodeURIComponent(upperNum)}`);
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error || "Order not found");
          }
          const data: MarketplaceOrderInfo = await res.json();
          setOrder(data);
          if (!TERMINAL_STATUSES.has(data.status)) startPolling(data.orderNumber);
        } catch (err: any) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const meta = order ? STATUS_META[order.status] : null;
  const currentStep = order ? STATUS_ORDER[order.status] ?? -1 : -1;
  const isFailed = order ? currentStep === -1 : false;
  const isPolling = order ? !TERMINAL_STATUSES.has(order.status) : false;

  const needsManualTelegram =
    !!order && order.status === "PAID" && order.deliveryMode === "MANUAL" && !!order.supportTelegram;
  const telegramUrl = needsManualTelegram
    ? `https://t.me/${order!.supportTelegram!.replace(/^@/, "")}${
        buildTelegramMessage ? `?text=${encodeURIComponent(buildTelegramMessage(order!))}` : ""
      }`
    : null;

  useEffect(() => {
    if (!autoRedirectManualPaid || !needsManualTelegram || !telegramUrl) return;
    if (telegramRedirectedRef.current) return;
    telegramRedirectedRef.current = true;
    window.location.href = telegramUrl;
  }, [autoRedirectManualPaid, needsManualTelegram, telegramUrl]);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:py-16 sm:px-6 lg:px-8">
        {loading && !order && (
          <div className="card h-40 animate-pulse mb-8" />
        )}

        {error && (
          <div className="card p-6 mb-8 text-center">
            <p className="text-sm text-red-400 flex items-center justify-center gap-2 mb-4">
              <XCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
              {error}
            </p>
            <Link href="/history" className="btn-ghost inline-flex items-center gap-2">
              <History className="h-4 w-4" strokeWidth={2} />
              View order history
            </Link>
          </div>
        )}

        {!loading && !order && !error && (
          <div className="card p-8 mb-8 text-center">
            <p className="text-sm text-fox-muted mb-4">
              We couldn't find an order number in this link. You can view all your past orders in History.
            </p>
            <Link href="/history" className="btn-primary inline-flex items-center gap-2">
              <History className="h-4 w-4" strokeWidth={2} />
              Go to History
            </Link>
          </div>
        )}

        {order && meta && (
          <div className="card overflow-hidden fade-up">
            <div className="p-5 sm:p-6 border-b border-fox-border">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-fox-muted mb-1">Order</p>
                  <p className="font-mono font-bold text-lg sm:text-xl">{order.orderNumber}</p>
                </div>
                <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${meta.color}`}>{meta.label}</div>
              </div>
              {isPolling && (
                <div className="flex items-center gap-2 mt-2 text-xs text-fox-muted">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
                  </span>
                  Auto-updating every 3 seconds
                </div>
              )}
            </div>

            {!isFailed && hideTimeline && policyContent && (
              <div className="px-5 sm:px-6 py-5 border-b border-fox-border text-sm text-fox-muted space-y-2">
                {policyContent}
              </div>
            )}

            {!isFailed && !hideTimeline && (
              <div className="px-5 sm:px-6 py-6 border-b border-fox-border">
                <div className="flex items-center justify-between">
                  {TIMELINE_STEPS.map((step, i) => {
                    const isReached = currentStep >= i;
                    const isCurrent = currentStep === i;
                    return (
                      <div key={step.key} className="flex flex-1 items-center">
                        <div className="flex flex-col items-center gap-2">
                          <div
                            className={`relative flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full border-2 transition-all duration-700 ${
                              isReached ? "border-green-400 bg-green-400/20 text-green-400" : "border-fox-border bg-fox-card text-fox-muted"
                            }`}
                          >
                            {isReached ? (
                              <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
                            ) : (
                              <step.Icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2} />
                            )}
                            {isCurrent && <span className="absolute inset-0 rounded-full border-2 border-green-400 animate-ping opacity-30" />}
                          </div>
                          <span className={`text-[10px] sm:text-xs font-medium text-center ${isReached ? "text-green-400" : "text-fox-muted"}`}>
                            {step.label}
                          </span>
                        </div>
                        {i < TIMELINE_STEPS.length - 1 && (
                          <div className="flex-1 mx-2 sm:mx-3">
                            <div className="relative h-1 rounded-full bg-fox-border overflow-hidden">
                              <div
                                className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-green-400 to-green-500 transition-all duration-1000 ease-out ${
                                  currentStep > i ? "w-full" : "w-0"
                                }`}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {isFailed && (
              <div className="px-5 sm:px-6 py-5 border-b border-fox-border">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-red-400/60 bg-red-400/10 text-red-400">
                    <XCircle className="h-5 w-5" strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-semibold text-red-400">{meta.label}</p>
                    <p className="text-sm text-fox-muted">{meta.desc}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="p-5 sm:p-6 space-y-3 text-sm">
              {renderDetails(order)}
              <div className="flex justify-between">
                <span className="text-fox-muted">Payment</span>
                <span className="font-medium">{order.paymentMethod.replace("_", " ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fox-muted">Amount</span>
                <span className="font-bold text-fox-primary">${order.amountUsd.toFixed(2)}</span>
              </div>
              <div className="border-t border-fox-border pt-3 space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-fox-muted">Created</span>
                  <span>{new Date(order.createdAt).toLocaleString()}</span>
                </div>
                {order.paidAt && (
                  <div className="flex justify-between text-xs">
                    <span className="text-fox-muted">Paid</span>
                    <span>{new Date(order.paidAt).toLocaleString()}</span>
                  </div>
                )}
                {order.deliveredAt && (
                  <div className="flex justify-between text-xs">
                    <span className="text-fox-muted">Delivered</span>
                    <span className="text-green-400">{new Date(order.deliveredAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            {order.status === "FAILED" && (
              <div className="mx-5 sm:mx-6 mb-5 sm:mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
                Something went wrong. Please contact{" "}
                <strong>{order.supportTelegram ? `@${order.supportTelegram.replace(/^@/, "")}` : "support"}</strong> on Telegram with your order number.
              </div>
            )}

            {(order.status === "PAID" || order.status === "DELIVERED") && renderPostPaidExtra && (
              <div className="mx-5 sm:mx-6 mb-5 sm:mb-6 space-y-3">{renderPostPaidExtra(order)}</div>
            )}

            {needsManualTelegram && telegramUrl && (
              <div className="mx-5 sm:mx-6 mb-5 sm:mb-6">
                {autoRedirectManualPaid && (
                  <p className="mb-2 text-center text-xs text-fox-muted">
                    Redirecting you to Telegram to confirm your order…
                  </p>
                )}
                <a
                  href={telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full rounded-xl border border-[#229ED9]/40 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#229ED9] py-3 text-sm font-medium transition-colors"
                >
                  <Send className="h-4 w-4" strokeWidth={2} />
                  {autoRedirectManualPaid
                    ? "Open Telegram manually"
                    : `Message @${order.supportTelegram!.replace(/^@/, "")} to arrange delivery`}
                </a>
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
