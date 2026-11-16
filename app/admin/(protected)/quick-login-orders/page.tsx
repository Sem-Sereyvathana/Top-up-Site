"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import OrderTelegramButton from "@/components/admin/OrderTelegramButton";

// Robux Quick Login orders. The customer pays on the site, then messages us
// on Telegram — so before doing anything for a Telegram message, find the
// order here and check the Payment column: only orders marked "Paid" were
// actually confirmed by the payment provider. Uses ?quickLoginOnly=1 on
// /api/admin/orders.

const STATUSES = ["ALL", "PENDING", "PAID", "PROCESSING", "DELIVERED", "FAILED", "REFUNDED", "CANCELLED"];

const PILL_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
  PAID: "bg-blue-400/10 text-blue-400 border-blue-400/30",
  PROCESSING: "bg-blue-400/10 text-blue-400 border-blue-400/30",
  DELIVERED: "bg-green-400/10 text-green-400 border-green-400/30",
  FAILED: "bg-red-400/10 text-red-400 border-red-400/30",
  REFUNDED: "bg-fox-muted/10 text-fox-muted border-fox-border",
  CANCELLED: "bg-fox-muted/10 text-fox-muted border-fox-border",
};

const PAID_STATUSES = new Set(["PAID", "PROCESSING", "DELIVERED"]);

// Whether the customer really paid. Status only becomes PAID/PROCESSING/
// DELIVERED once the payment provider confirms the payment.
function paymentBadge(o: any): { label: string; cls: string; detail?: string } {
  if (PAID_STATUSES.has(o.status)) {
    return {
      label: "✓ Paid",
      cls: "bg-green-400/10 text-green-400 border-green-400/30",
      detail: o.paidAt ? new Date(o.paidAt).toLocaleString() : undefined,
    };
  }
  if (o.status === "PENDING") {
    return { label: "Not paid yet", cls: "bg-yellow-400/10 text-yellow-400 border-yellow-400/30" };
  }
  if (o.status === "REFUNDED") {
    return { label: "Refunded", cls: "bg-fox-muted/10 text-fox-muted border-fox-border" };
  }
  return { label: "✗ Not paid", cls: "bg-red-400/10 text-red-400 border-red-400/30" };
}

function packageLabel(o: any): string {
  if (o.items && o.items.length > 0) {
    const total = o.items.reduce((sum: number, it: any) => sum + Math.max(0, it.amount) * it.quantity, 0);
    return `${total.toLocaleString()} Robux (${o.items.length} package${o.items.length > 1 ? "s" : ""})`;
  }
  return o.product?.amount > 0 ? `${o.product.amount.toLocaleString()} Robux` : o.product?.name ?? "—";
}

export default function QuickLoginOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [status, setStatus] = useState("PAID"); // default to what actually needs action
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ status, page: String(page), quickLoginOnly: "1" });
    if (q) params.set("q", q);
    const res = await fetch(`/api/admin/orders?${params}`);
    const data = await res.json();
    setOrders(data.orders ?? []);
    setTotalPages(data.totalPages ?? 1);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page]);

  async function setOrderStatus(orderNumber: string, newStatus: string) {
    setUpdatingId(orderNumber);
    await fetch(`/api/admin/orders/${orderNumber}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    await load();
    setUpdatingId(null);
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            ⚡ Quick Login Orders
          </h1>
          <p className="text-fox-muted mt-1">
            Customers who message you on Telegram — look up their order here and check that it was really paid.
          </p>
        </div>
      </div>

      {status !== "PAID" && (
        <button
          onClick={() => { setStatus("PAID"); setPage(1); }}
          className="mt-4 mb-6 flex w-full items-center justify-between rounded-2xl border border-fox-primary/50 bg-fox-primary/10 px-5 py-4 text-left transition-colors hover:bg-fox-primary/20"
        >
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fox-primary opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-fox-primary" />
            </span>
            <div className="font-display text-base font-bold text-fox-text">
              View paid orders waiting for you
            </div>
          </div>
          <span className="text-fox-primary">→</span>
        </button>
      )}

      <div className="card p-4 mb-6 mt-4 flex flex-wrap gap-3">
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={`px-3 py-1.5 text-xs rounded-lg font-semibold transition-colors ${
                status === s ? "bg-fox-primary text-black" : "bg-fox-surface text-fox-muted hover:text-fox-text"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <form
          className="flex gap-2 flex-1 min-w-[300px]"
          onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }}
        >
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search order # or Roblox username"
            className="input text-sm flex-1"
          />
          <button type="submit" className="btn-ghost text-sm px-4 py-2">Search</button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-fox-surface text-fox-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Order #</th>
                <th className="text-left px-5 py-3">Package</th>
                <th className="text-left px-5 py-3">Roblox Username</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Payment</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Created</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fox-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-fox-muted">Loading...</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="text-4xl mb-3">⚡</div>
                    <p className="text-fox-muted mb-1">No Quick Login orders match these filters</p>
                    <p className="text-xs text-fox-muted/60">Nothing waiting right now.</p>
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className={`hover:bg-fox-surface/50 ${o.status === "PAID" ? "bg-fox-primary/5" : ""}`}>
                    <td className="px-5 py-3">
                      <Link href={`/admin/orders/${o.orderNumber}?from=quicklogin`} className="font-mono text-fox-primary hover:underline">
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-medium">{packageLabel(o)}</td>
                    <td className="px-5 py-3 font-mono text-xs text-fox-accent">{o.playerUid}</td>
                    <td className="px-5 py-3 text-right font-mono">${o.amountUsd.toFixed(2)}</td>
                    <td className="px-5 py-3">
                      {(() => {
                        const pay = paymentBadge(o);
                        return (
                          <div>
                            <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${pay.cls}`}>
                              {pay.label}
                            </span>
                            {pay.detail && <div className="mt-1 text-[10px] text-fox-muted">{pay.detail}</div>}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${PILL_COLORS[o.status]}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-fox-muted text-xs">{new Date(o.createdAt).toLocaleString()}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-2">
                        {(o.status === "PAID" || o.status === "PROCESSING") && (
                          <button
                            onClick={() => setOrderStatus(o.orderNumber, "DELIVERED")}
                            disabled={updatingId === o.orderNumber}
                            className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-xs font-semibold text-green-300 transition-colors hover:bg-green-500/20 disabled:opacity-50"
                          >
                            {updatingId === o.orderNumber ? "…" : "Mark Delivered"}
                          </button>
                        )}
                        {o.status === "PAID" && (
                          <button
                            onClick={() => setOrderStatus(o.orderNumber, "PROCESSING")}
                            disabled={updatingId === o.orderNumber}
                            className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 text-xs font-semibold text-yellow-300 transition-colors hover:bg-yellow-500/20 disabled:opacity-50"
                          >
                            Processing
                          </button>
                        )}
                        <Link
                          href={`/admin/orders/${o.orderNumber}?from=quicklogin`}
                          className="rounded-lg border border-fox-border px-3 py-1.5 text-xs font-semibold text-fox-muted transition-colors hover:text-fox-text"
                        >
                          Open
                        </Link>
                        <OrderTelegramButton
                          buyerTelegramUsername={o.user?.telegramUsername}
                          orderNumber={o.orderNumber}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-fox-border flex justify-between items-center text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-ghost disabled:opacity-40 text-xs py-1 px-3"
            >
              ← Prev
            </button>
            <span className="text-fox-muted">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-ghost disabled:opacity-40 text-xs py-1 px-3"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
