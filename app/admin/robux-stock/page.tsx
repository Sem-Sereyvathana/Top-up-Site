"use client";

import { useEffect, useState } from "react";

interface AuditEntry {
  id: string;
  adminEmail: string | null;
  action: string;
  details: string | null;
  createdAt: string;
}

export default function AdminRobuxStockPage() {
  const [total, setTotal] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<"add" | "remove" | "set" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);

  async function load() {
    const r = await fetch("/api/admin/robux-stock");
    const data = await r.json();
    setTotal(data.totalRobux);
    setUpdatedAt(data.updatedAt);
  }

  async function loadHistory() {
    const r = await fetch("/api/admin/audit-logs?action=robux_stock&perPage=20");
    const data = await r.json();
    setHistory(data.logs || []);
  }

  useEffect(() => {
    load();
    loadHistory();
  }, []);

  async function submit(op: "add" | "remove" | "set") {
    const n = Number(amount);
    if (!amount || Number.isNaN(n) || n < 0) {
      setMessage("Enter a valid, non-negative amount.");
      return;
    }
    setSaving(op);
    setMessage(null);
    try {
      const r = await fetch("/api/admin/robux-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, amount: n, note: note || undefined }),
      });
      if (!r.ok) throw new Error("Request failed");
      const data = await r.json();
      setTotal(data.totalRobux);
      setUpdatedAt(data.updatedAt);
      setAmount("");
      setNote("");
      setMessage(
        op === "add"
          ? `Added ${n.toLocaleString()} Robux to stock.`
          : op === "remove"
          ? `Removed ${n.toLocaleString()} Robux from stock.`
          : `Stock set to ${n.toLocaleString()} Robux.`
      );
      loadHistory();
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <h1 className="font-display text-2xl sm:text-3xl font-bold mb-2">Robux Stock</h1>
      <p className="text-fox-muted text-sm mb-6">
        Manage how much Robux you have available to deliver. Customers see this total live on the Roblox top-up page.
      </p>

      <div className="card p-6 mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-fox-muted mb-1">Current stock</div>
          <div className="font-display text-4xl font-bold text-fox-primary">
            {total === null ? "…" : total.toLocaleString()}
            <span className="text-lg text-fox-muted font-normal ml-2">Robux</span>
          </div>
          {updatedAt && (
            <div className="text-xs text-fox-muted mt-1">
              Last updated {new Date(updatedAt).toLocaleString()}
            </div>
          )}
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
            total !== null && total > 0
              ? "border border-green-400/30 bg-green-500/10 text-green-300"
              : "border border-red-400/30 bg-red-500/10 text-red-300"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          {total !== null && total > 0 ? "In stock" : "Out of stock"}
        </div>
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="font-semibold">Adjust stock</h2>

        <div>
          <label className="label">Amount (Robux)</label>
          <input
            className="input"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 10000"
          />
        </div>

        <div>
          <label className="label">Note (optional)</label>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Restocked from reseller"
          />
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            disabled={saving !== null}
            onClick={() => submit("add")}
            className="btn-primary px-5 py-2 disabled:opacity-50"
          >
            {saving === "add" ? "Adding…" : "+ Add to stock"}
          </button>
          <button
            type="button"
            disabled={saving !== null}
            onClick={() => submit("remove")}
            className="px-5 py-2 rounded-lg border border-fox-border hover:border-red-400/50 hover:text-red-300 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving === "remove" ? "Removing…" : "− Remove from stock"}
          </button>
          <button
            type="button"
            disabled={saving !== null}
            onClick={() => submit("set")}
            className="px-5 py-2 rounded-lg border border-fox-border hover:border-fox-primary/50 hover:text-fox-primary text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving === "set" ? "Setting…" : "Set exact total"}
          </button>
        </div>

        {message && <p className="text-sm text-fox-accent">{message}</p>}
      </div>

      <div className="card p-6 mt-6">
        <h2 className="font-semibold mb-4">Recent activity</h2>
        {history.length === 0 ? (
          <p className="text-sm text-fox-muted">No stock changes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-fox-muted border-b border-fox-border">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Admin</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fox-border/60">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2 pr-4 text-fox-muted whitespace-nowrap">
                      {new Date(h.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">{h.adminEmail || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-fox-accent">{h.action}</td>
                    <td className="py-2 pr-4 text-xs text-fox-muted max-w-xs truncate" title={h.details ?? undefined}>
                      {h.details || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
