"use client";

import { useEffect, useState } from "react";

const STATUSES = ["ALL", "PENDING", "PAID", "DELIVERED", "FAILED", "REFUNDED", "CANCELLED"];

const PILL_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
  PAID: "bg-blue-400/10 text-blue-400 border-blue-400/30",
  DELIVERED: "bg-green-400/10 text-green-400 border-green-400/30",
  FAILED: "bg-red-400/10 text-red-400 border-red-400/30",
  REFUNDED: "bg-fox-muted/10 text-fox-muted border-fox-border",
  CANCELLED: "bg-fox-muted/10 text-fox-muted border-fox-border",
};

interface OrderRow {
  id: string;
  orderNumber: string;
  customerContact: string | null;
  deliveryMode: string;
  amountUsd: number;
  status: string;
  createdAt: string;
  items: { title: string; quantity: number }[];
}

export default function AdminAccountOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [status, setStatus] = useState("ALL");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ status, page: String(page) });
    if (q) params.set("q", q);
    const res = await fetch(`/api/admin/account-orders?${params}`);
    const data = await res.json();
    setOrders(data.orders);
    setTotalPages(data.totalPages);
    setLoading(false);

    try {
      const countRes = await fetch(`/api/admin/account-orders?status=PAID&page=1`);
      const countData = await countRes.json();
      setPendingCount(countData.total ?? 0);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page]);

  async function markDelivered(order: OrderRow) {
    setUpdatingId(order.id);
    await fetch(`/api/admin/account-orders/${order.orderNumber}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DELIVERED" }),
    });
    setUpdatingId(null);
    await load();
  }

  return (
    <div className="p-8">
      <h1 className="font-display text-3xl font-bold mb-2">Account Orders</h1>
      <p className="text-fox-muted mb-6">
        Orders from the Accounts storefront. Independent from Top-up orders and Game Item orders.
      </p>

      {pendingCount > 0 && status !== "PAID" && (
        <button
          onClick={() => {
            setStatus("PAID");
            setPage(1);
          }}
          className="mb-6 flex w-full items-center justify-between rounded-2xl border border-fox-primary/50 bg-fox-primary/10 px-5 py-4 text-left transition-colors hover:bg-fox-primary/20"
        >
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fox-primary opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-fox-primary" />
            </span>
            <div>
              <div className="font-display text-base font-bold text-fox-text">
                {pendingCount} order{pendingCount === 1 ? "" : "s"} waiting for handover
              </div>
              <div className="text-xs text-fox-muted">Click to filter by PAID status.</div>
            </div>
          </div>
          <span className="text-fox-primary">→</span>
        </button>
      )}

      <div className="card p-4 mb-6 flex flex-wrap gap-3">
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
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
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            load();
          }}
        >
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search order # or contact"
            className="input text-sm flex-1"
          />
          <button type="submit" className="btn-ghost text-sm px-4 py-2">
            Search
          </button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-fox-surface text-fox-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Order #</th>
                <th className="text-left px-5 py-3">Accounts</th>
                <th className="text-left px-5 py-3">Contact</th>
                <th className="text-center px-5 py-3">Delivery</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Created</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fox-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-fox-muted">
                    Loading...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="text-4xl mb-3">🕹️</div>
                    <p className="text-fox-muted mb-1">No orders match these filters</p>
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className={`hover:bg-fox-surface/50 ${o.status === "PAID" ? "bg-fox-primary/5" : ""}`}>
                    <td className="px-5 py-3 font-mono text-fox-primary">{o.orderNumber}</td>
                    <td className="px-5 py-3 text-fox-muted text-xs">
                      {o.items.map((it, i) => (
                        <div key={i}>{it.quantity > 1 ? `${it.title} ×${it.quantity}` : it.title}</div>
                      ))}
                    </td>
                    <td className="px-5 py-3 text-xs text-fox-muted">{o.customerContact || "—"}</td>
                    <td className="px-5 py-3 text-center">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          o.deliveryMode === "DIRECT" ? "bg-green-400/10 text-green-400" : "bg-yellow-400/10 text-yellow-400"
                        }`}
                      >
                        {o.deliveryMode}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono">${o.amountUsd.toFixed(2)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${PILL_COLORS[o.status]}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-fox-muted text-xs">{new Date(o.createdAt).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right">
                      {o.status === "PAID" && (
                        <button
                          onClick={() => markDelivered(o)}
                          disabled={updatingId === o.id}
                          className="text-xs font-semibold text-fox-primary hover:underline disabled:opacity-50"
                        >
                          {updatingId === o.id ? "Saving..." : "Mark Delivered"}
                        </button>
                      )}
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
            <span className="text-fox-muted">
              Page {page} of {totalPages}
            </span>
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
