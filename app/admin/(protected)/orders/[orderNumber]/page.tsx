"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const STATUSES = ["PENDING", "PAID", "PROCESSING", "DELIVERED", "FAILED", "REFUNDED", "CANCELLED"];

// For a multi-package Roblox cart order, combine every line into a single
// total (e.g. 1000 + 100 = 1100 Robux) so admins process one clear number
// instead of juggling separate packages. Regular single-package orders
// (order.items is empty) fall back to the plain product name, unchanged.
function packageSummary(order: any): { label: string; totalRobux: number | null } {
  if (order.items && order.items.length > 0) {
    const totalRobux = order.items.reduce(
      (sum: number, it: any) => sum + Math.max(0, it.amount) * it.quantity,
      0
    );
    return { label: `${totalRobux.toLocaleString()} Robux`, totalRobux };
  }
  return { label: order.product.name, totalRobux: null };
}

export default function AdminOrderDetailPage() {
  const params = useParams() as { orderNumber: string };
  const router = useRouter();
  const searchParams = useSearchParams();

  // Robux Orders is the only queue that reuses this shared detail page
  // (see app/admin/(protected)/robux-orders/page.tsx) — its links append
  // ?from=robux so "Back to orders" returns admins to the queue they were
  // actually working from, instead of always dropping them on the general
  // Orders list.
  const backHref = searchParams.get("from") === "robux" ? "/admin/robux-orders" : "/admin/orders";
  const backLabel = searchParams.get("from") === "robux" ? "← Back to Robux orders" : "← Back to orders";
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/admin/orders/${params.orderNumber}`);
    if (res.ok) {
      const data = await res.json();
      setOrder(data);
      setNote(data.deliveryNote || "");
      setReason(data.failureReason || "");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.orderNumber]);

  async function updateStatus(newStatus: string) {
    setUpdating(true);
    await fetch(`/api/admin/orders/${params.orderNumber}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: newStatus,
        deliveryNote: note,
        failureReason: newStatus === "FAILED" ? reason : undefined,
      }),
    });
    await load();
    setUpdating(false);
  }

  async function refreshFromGateway() {
    setUpdating(true);
    const res = await fetch(`/api/admin/orders/${params.orderNumber}/refresh`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      alert(`KHPay says: ${data.remote?.status ?? "unknown"}${data.updated ? " — order updated" : ""}`);
      await load();
    } else {
      const d = await res.json().catch(() => null);
      alert(d?.error || "Refresh failed");
    }
    setUpdating(false);
  }

  if (loading) {
    return <div className="p-8 text-fox-muted">Loading...</div>;
  }
  if (!order) {
    return <div className="p-8 text-fox-muted">Order not found.</div>;
  }

  return (
    <div className="p-8 max-w-4xl">
      <Link href={backHref} className="text-sm text-fox-muted hover:text-fox-primary mb-4 inline-block">
        {backLabel}
      </Link>

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold font-mono">{order.orderNumber}</h1>
          <p className="text-fox-muted">Created {new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <span className="rounded-full border border-fox-primary/40 bg-fox-primary/10 px-4 py-1.5 text-sm font-semibold text-fox-primary">
          {order.status}
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="card p-6">
          <h3 className="text-xs uppercase tracking-wider text-fox-muted mb-4">Customer</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-fox-muted">Email</dt>
              <dd>{order.customerEmail || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fox-muted">Phone</dt>
              <dd>{order.customerPhone || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fox-muted">IP</dt>
              <dd className="font-mono text-xs">{order.ipAddress || "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="card p-6">
          <h3 className="text-xs uppercase tracking-wider text-fox-muted mb-4">Top-up Details</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-fox-muted">Game</dt>
              <dd className="font-medium">{order.game.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fox-muted">Package</dt>
              <dd className="font-medium">{packageSummary(order).label}</dd>
            </div>
            {order.items && order.items.length > 1 && (
              <div className="flex justify-between">
                <dt className="text-fox-muted">Breakdown</dt>
                <dd className="text-right text-xs text-fox-muted space-y-0.5">
                  {order.items.map((it: any) => (
                    <div key={it.id}>
                      {it.amount.toLocaleString()} Robux
                      {it.quantity > 1 ? ` ×${it.quantity}` : ""}
                    </div>
                  ))}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-fox-muted">Player UID</dt>
              <dd className="font-mono text-fox-accent">{order.playerUid}</dd>
            </div>
            {order.serverId && (
              <div className="flex justify-between">
                <dt className="text-fox-muted">Server</dt>
                <dd>{order.serverId}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="card p-6">
          <h3 className="text-xs uppercase tracking-wider text-fox-muted mb-4">Payment</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-fox-muted">Method</dt>
              <dd>{order.paymentMethod.replace("_", " ")}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fox-muted">Amount (USD)</dt>
              <dd className="font-bold text-fox-primary">${order.amountUsd.toFixed(2)}</dd>
            </div>
            {order.amountKhr && (
              <div className="flex justify-between">
                <dt className="text-fox-muted">Amount (KHR)</dt>
                <dd>{order.amountKhr.toLocaleString()} ៛</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-fox-muted">Gateway Ref</dt>
              <dd className="font-mono text-xs">{order.paymentRef || "—"}</dd>
            </div>
            {order.paymentRef && order.status === "PENDING" && (
              <button
                onClick={refreshFromGateway}
                disabled={updating}
                className="btn-ghost text-xs w-full mt-2 disabled:opacity-50"
              >
                🔄 Refresh from KHPay
              </button>
            )}
            {["PAID", "PROCESSING", "DELIVERED"].includes(order.status) && (
              <a
                href={`/api/orders/${encodeURIComponent(order.orderNumber)}/invoice`}
                className="btn-ghost text-xs w-full mt-2 flex items-center justify-center gap-2"
              >
                📄 Download invoice (PDF)
              </a>
            )}
          </dl>
        </div>

        <div className="card p-6">
          <h3 className="text-xs uppercase tracking-wider text-fox-muted mb-4">Timeline</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-fox-muted">Created</dt>
              <dd>{new Date(order.createdAt).toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fox-muted">Paid</dt>
              <dd>{order.paidAt ? new Date(order.paidAt).toLocaleString() : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fox-muted">Delivered</dt>
              <dd className="text-green-400">
                {order.deliveredAt ? new Date(order.deliveredAt).toLocaleString() : "—"}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* ── Fulfillment Panel — quick manual-delivery workflow ── */}
      {(order.status === "PAID" || order.status === "PROCESSING") && (() => {
        const needsAction = order.status === "PAID";
        return (
          <div className={`mb-6 rounded-2xl border p-6 transition-colors ${
            needsAction
              ? "border-fox-primary/50 bg-fox-primary/5"
              : "border-yellow-500/40 bg-yellow-500/5"
          }`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-lg font-bold text-fox-text">
                  {needsAction ? "⚡ Action Required — Fulfill This Order" : "⏳ Fulfillment In Progress"}
                </h3>
                <p className="text-xs text-fox-muted mt-0.5">
                  {needsAction
                    ? "Customer paid. Top up their UID on the game shop, then mark delivered."
                    : "Finish the top-up on the game shop, then mark delivered."}
                </p>
              </div>
            </div>

            {/* Quick-copy fields */}
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <button
                onClick={() => copyToClipboard(order.playerUid, "UID")}
                className="group flex flex-col items-start gap-1 rounded-lg border border-fox-border bg-fox-surface/80 px-4 py-3 text-left transition-colors hover:border-fox-primary/60 hover:bg-fox-surface"
              >
                <span className="text-[10px] uppercase tracking-widest text-fox-muted">Player UID</span>
                <span className="font-mono text-lg font-bold text-fox-accent">{order.playerUid}</span>
                <span className="text-[10px] text-fox-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {copied === "UID" ? "✓ Copied!" : "Click to copy"}
                </span>
              </button>

              {order.serverId && (
                <button
                  onClick={() => copyToClipboard(order.serverId, "Server")}
                  className="group flex flex-col items-start gap-1 rounded-lg border border-fox-border bg-fox-surface/80 px-4 py-3 text-left transition-colors hover:border-fox-primary/60 hover:bg-fox-surface"
                >
                  <span className="text-[10px] uppercase tracking-widest text-fox-muted">Server / Zone</span>
                  <span className="font-mono text-lg font-bold text-fox-text">{order.serverId}</span>
                  <span className="text-[10px] text-fox-primary opacity-0 transition-opacity group-hover:opacity-100">
                    {copied === "Server" ? "✓ Copied!" : "Click to copy"}
                  </span>
                </button>
              )}

              <button
                onClick={() => copyToClipboard(packageSummary(order).label, "Package")}
                className="group flex flex-col items-start gap-1 rounded-lg border border-fox-border bg-fox-surface/80 px-4 py-3 text-left transition-colors hover:border-fox-primary/60 hover:bg-fox-surface"
              >
                <span className="text-[10px] uppercase tracking-widest text-fox-muted">Package</span>
                <span className="text-lg font-bold text-fox-text truncate">{packageSummary(order).label}</span>
                <span className="text-[10px] text-fox-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {copied === "Package" ? "✓ Copied!" : "Click to copy name"}
                </span>
              </button>
            </div>

            {/* Verified player nickname (if captured at order time) */}
            {order.playerNickname && (
              <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2.5 text-sm">
                <span className="text-fox-muted">Verified player: </span>
                <span className="font-semibold text-green-300">{order.playerNickname}</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-3">
              {needsAction && (
                <button
                  onClick={() => updateStatus("PROCESSING")}
                  disabled={updating}
                  className="inline-flex items-center gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm font-semibold text-yellow-300 transition-colors hover:bg-yellow-500/20 disabled:opacity-50"
                >
                  Mark Processing
                </button>
              )}

              <button
                onClick={() => updateStatus("DELIVERED")}
                disabled={updating}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-green-500/30 transition-all hover:shadow-green-500/50 hover:-translate-y-0.5 disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {updating ? "Saving…" : "Mark Delivered"}
              </button>

              <button
                onClick={() => updateStatus("FAILED")}
                disabled={updating}
                className="inline-flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                Mark Failed
              </button>
            </div>
          </div>
        );
      })()}

      <div className="card p-6">
        <h3 className="text-xs uppercase tracking-wider text-fox-muted mb-4">Update Status</h3>

        <div className="mb-4">
          <label className="label">Delivery note (internal)</label>
          <textarea
            className="input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional notes about this delivery..."
          />
        </div>

        {(order.status === "FAILED" || order.failureReason) && (
          <div className="mb-4">
            <label className="label">Failure reason</label>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why did this order fail?"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              disabled={updating || order.status === s}
              onClick={() => updateStatus(s)}
              className={`px-3 py-2 text-xs rounded-lg font-semibold transition-colors disabled:opacity-40 ${
                s === "DELIVERED"
                  ? "bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/40"
                  : s === "FAILED"
                  ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/40"
                  : "bg-fox-surface text-fox-muted hover:text-fox-text border border-fox-border"
              }`}
            >
              {order.status === s ? `✓ ${s}` : `Set ${s}`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
