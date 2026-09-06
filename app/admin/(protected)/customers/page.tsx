"use client";

import { useEffect, useState } from "react";

interface Customer {
  key: string;
  email: string | null;
  phone: string | null;
  totalOrders: number;
  paidOrders: number;
  lifetimeUsd: number;
  lastOrderAt: string;
  uidCount: number;
}

interface RegisteredUser {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  points: number;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  _count: { orders: number };
}

function RegisteredUsers() {
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const d = await res.json();
      setUsers(d.users);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function adjustPoints(userId: string) {
    const input = window.prompt("Points to add (use a negative number to deduct):");
    if (!input) return;
    const delta = parseInt(input, 10);
    if (!Number.isFinite(delta) || delta === 0) return;
    const note = window.prompt("Note for this adjustment (optional):") || undefined;

    setBusyId(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, delta, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to adjust points");
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-10">
      <h2 className="font-display text-xl font-bold mb-2">Registered Accounts</h2>
      <p className="text-fox-muted text-sm mb-4">
        Signed-up customers and their loyalty points balance.
      </p>

      {loading ? (
        <div className="text-fox-muted text-sm">Loading...</div>
      ) : users.length === 0 ? (
        <div className="card p-10 text-center text-fox-muted text-sm">No registered accounts yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-fox-muted border-b border-fox-border">
              <tr>
                <th className="py-3 px-4">Account</th>
                <th className="py-3 px-4 text-right">Points</th>
                <th className="py-3 px-4 text-right">Orders</th>
                <th className="py-3 px-4">Joined</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fox-border/60">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-fox-surface/40">
                  <td className="py-2 px-4">
                    <div className="font-medium">{u.name || u.email || u.phone}</div>
                    <div className="text-xs text-fox-muted">{[u.email, u.phone].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="py-2 px-4 text-right font-bold text-fox-primary">{u.points.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right">{u._count.orders}</td>
                  <td className="py-2 px-4 text-xs text-fox-muted whitespace-nowrap">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 px-4 text-right">
                    <button
                      onClick={() => adjustPoints(u.id)}
                      disabled={busyId === u.id}
                      className="btn-ghost text-xs disabled:opacity-50"
                    >
                      Adjust points
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CustomersPage() {
  const [data, setData] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch("/api/admin/customers");
      if (res.ok) {
        const d = await res.json();
        setData(d.customers);
      }
      setLoading(false);
    })();
  }, []);

  const filtered = q
    ? data.filter((c) => [c.email, c.phone, c.key].some((v) => (v || "").toLowerCase().includes(q.toLowerCase())))
    : data;

  return (
    <div className="p-4 sm:p-8">
      <h1 className="font-display text-2xl sm:text-3xl font-bold mb-2">Customers</h1>
      <p className="text-fox-muted text-sm mb-6">Aggregated by email or phone. Sorted by lifetime value.</p>

      <input
        className="input mb-4 max-w-md"
        placeholder="Search email / phone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {loading ? (
        <div className="text-fox-muted text-sm">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-fox-muted text-sm">No customers yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-fox-muted border-b border-fox-border">
              <tr>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4 text-right">Lifetime $</th>
                <th className="py-3 px-4 text-right">Paid orders</th>
                <th className="py-3 px-4 text-right">Total orders</th>
                <th className="py-3 px-4 text-right">UIDs</th>
                <th className="py-3 px-4">Last order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fox-border/60">
              {filtered.map((c) => (
                <tr key={c.key} className="hover:bg-fox-surface/40">
                  <td className="py-2 px-4">
                    <div className="font-medium">{c.email || c.phone || c.key}</div>
                    {c.email && c.phone && <div className="text-xs text-fox-muted">{c.phone}</div>}
                  </td>
                  <td className="py-2 px-4 text-right font-bold text-fox-primary">${c.lifetimeUsd.toFixed(2)}</td>
                  <td className="py-2 px-4 text-right">{c.paidOrders}</td>
                  <td className="py-2 px-4 text-right text-fox-muted">{c.totalOrders}</td>
                  <td className="py-2 px-4 text-right">{c.uidCount}</td>
                  <td className="py-2 px-4 text-xs text-fox-muted whitespace-nowrap">{new Date(c.lastOrderAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RegisteredUsers />
    </div>
  );
}
