"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Save, X, Image as ImageIcon } from "lucide-react";

interface Game {
  id: string;
  name: string;
}

interface GameAccount {
  id: string;
  gameId: string | null;
  title: string;
  rank: string | null;
  description: string | null;
  imageUrl: string | null;
  priceUsd: number;
  sold: boolean;
  stockMode: "UNIQUE" | "MULTI";
  stock: number;
  active: boolean;
  sortOrder: number;
  credentials: string | null;
  Game?: { name: string; slug: string } | null;
}

const empty = {
  gameId: "",
  title: "",
  rank: "",
  description: "",
  imageUrl: "",
  priceUsd: 0,
  sold: false,
  stockMode: "UNIQUE" as "UNIQUE" | "MULTI",
  stock: 1,
  active: true,
  sortOrder: 0,
  credUsername: "",
  credPassword: "",
  credNotes: "",
  credLegacy: "",
};

// The Login handover is stored on the account as one `credentials` string
// (no schema change needed), but the admin form always writes it in this
// fixed shape so it can reliably be split back into Username/Email +
// Password everywhere it's shown to a buyer (receipt + history "View").
function parseCredentials(raw: string | null | undefined) {
  const text = raw || "";
  const userMatch = text.match(/^(?:username\/email|username|email)\s*:\s*(.+)$/im);
  const passMatch = text.match(/^password\s*:\s*(.+)$/im);
  const notesMatch = text.match(/^notes\s*:\s*([\s\S]*)$/im);
  if (userMatch || passMatch) {
    return {
      username: userMatch?.[1]?.trim() || "",
      password: passMatch?.[1]?.trim() || "",
      notes: notesMatch?.[1]?.trim() || "",
      legacy: "",
    };
  }
  // Didn't match the structured format — most likely an older free-text
  // entry saved before this change. Keep it intact as "legacy" instead of
  // silently discarding it; admin can retype it into the two fields above.
  return { username: "", password: "", notes: "", legacy: text };
}

function buildCredentials(form: { credUsername: string; credPassword: string; credNotes: string; credLegacy: string }) {
  const username = form.credUsername.trim();
  const password = form.credPassword.trim();
  if (!username && !password) return form.credLegacy || null;
  const lines = [`Username/Email: ${username}`, `Password: ${password}`];
  if (form.credNotes.trim()) lines.push(`Notes: ${form.credNotes.trim()}`);
  return lines.join("\n");
}

export default function AccountsAdminPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [accounts, setAccounts] = useState<GameAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GameAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    const [gRes, aRes] = await Promise.all([
      fetch("/api/admin/games").then((r) => r.json()),
      fetch("/api/admin/accounts").then((r) => r.json()),
    ]);
    setGames(gRes);
    setAccounts(aRes);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openNew() {
    setCreating(true);
    setEditing(null);
    setError(null);
    setForm(empty);
  }

  function openEdit(acc: GameAccount) {
    setCreating(false);
    setEditing(acc);
    setError(null);
    const cred = parseCredentials(acc.credentials);
    setForm({
      gameId: acc.gameId || "",
      title: acc.title,
      rank: acc.rank || "",
      description: acc.description || "",
      imageUrl: acc.imageUrl || "",
      priceUsd: acc.priceUsd,
      sold: acc.sold,
      stockMode: acc.stockMode,
      stock: acc.stock,
      active: acc.active,
      sortOrder: acc.sortOrder,
      credUsername: cred.username,
      credPassword: cred.password,
      credNotes: cred.notes,
      credLegacy: cred.legacy,
    });
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setForm(empty);
    setError(null);
  }

  async function upload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      setForm((f) => ({ ...f, imageUrl: data.url }));
    }
    setUploading(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      gameId: form.gameId || null,
      title: form.title,
      rank: form.rank || null,
      description: form.description || null,
      imageUrl: form.imageUrl || null,
      priceUsd: Number(form.priceUsd),
      sold: form.sold,
      stockMode: form.stockMode,
      stock: form.stockMode === "MULTI" ? Math.max(0, Number(form.stock)) : 1,
      active: form.active,
      sortOrder: Number(form.sortOrder),
      credentials: buildCredentials(form),
    };
    const url = editing ? `/api/admin/accounts/${editing.id}` : "/api/admin/accounts";
    const method = editing ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to save");
      setSaving(false);
      return;
    }
    setSaving(false);
    closeForm();
    await loadAll();
  }

  async function toggleActive(acc: GameAccount) {
    await fetch(`/api/admin/accounts/${acc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !acc.active }),
    });
    await loadAll();
  }

  async function toggleSold(acc: GameAccount) {
    await fetch(`/api/admin/accounts/${acc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sold: !acc.sold }),
    });
    await loadAll();
  }

  async function remove(acc: GameAccount) {
    if (!confirm(`Delete "${acc.title}"?`)) return;
    await fetch(`/api/admin/accounts/${acc.id}`, { method: "DELETE" });
    await loadAll();
  }

  const showForm = creating || editing;

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Accounts</h1>
          <p className="text-fox-muted text-sm">Verified game accounts for sale.</p>
        </div>
        <button onClick={openNew} className="btn-primary">
          <Plus className="h-4 w-4" /> Add Account
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="card p-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{editing ? `Edit — ${editing.title}` : "New account"}</h2>
            <button type="button" onClick={closeForm} className="text-xs text-fox-muted hover:text-fox-text inline-flex items-center gap-1">
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Game</label>
              <select
                className="input"
                value={form.gameId}
                onChange={(e) => setForm({ ...form, gameId: e.target.value })}
              >
                <option value="">— General (no specific game) —</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Title *</label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Rank</label>
              <input
                className="input"
                placeholder="Mythic, Global Elite, Level 80..."
                value={form.rank}
                onChange={(e) => setForm({ ...form, rank: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Price (USD) *</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                value={form.priceUsd}
                onChange={(e) => setForm({ ...form, priceUsd: Number(e.target.value) })}
                required
              />
            </div>
            <div>
              <label className="label">Stock type</label>
              <select
                className="input"
                value={form.stockMode}
                onChange={(e) => setForm({ ...form, stockMode: e.target.value as "UNIQUE" | "MULTI" })}
              >
                <option value="UNIQUE">Unique login (one buyer only)</option>
                <option value="MULTI">Multiple stock (buyers pick a quantity)</option>
              </select>
            </div>
            {form.stockMode === "MULTI" && (
              <div>
                <label className="label">Stock quantity</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
                />
                <p className="mt-1 text-xs text-fox-muted/70">
                  How many a buyer can purchase in total — buyers can pick any amount up to what&apos;s left. Goes to 0 automatically as orders are paid.
                </p>
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <textarea
                className="input"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <label className="label">
                Username / Email <span className="font-normal text-fox-muted/60">(login handover — admin-only until paid)</span>
              </label>
              <input
                className="input font-mono text-xs"
                placeholder="alice@gmail.com"
                value={form.credUsername}
                onChange={(e) => setForm({ ...form, credUsername: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input font-mono text-xs"
                placeholder="account password"
                value={form.credPassword}
                onChange={(e) => setForm({ ...form, credPassword: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">
                Notes <span className="font-normal text-fox-muted/60">(optional — recovery email, security answers, etc.)</span>
              </label>
              <textarea
                className="input font-mono text-xs"
                rows={2}
                value={form.credNotes}
                onChange={(e) => setForm({ ...form, credNotes: e.target.value })}
              />
              <p className="mt-1 text-xs text-fox-muted/70">
                Username/Email and Password are handed to the buyer automatically — on their payment receipt and again if they revisit it from Order History — once this order is paid. Only revealed if this account&apos;s game has delivery set to &quot;Direct&quot; on the Games page; otherwise buyers are pointed to Telegram after paying.
              </p>
            </div>
            {form.credLegacy && (
              <div className="sm:col-span-2">
                <label className="label text-yellow-400">
                  Previously saved value <span className="font-normal text-fox-muted/60">(older free-text format — didn&apos;t match Username/Password, kept as-is; fill in the fields above to replace it)</span>
                </label>
                <textarea className="input font-mono text-xs" rows={2} value={form.credLegacy} readOnly />
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="label">Image</label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="https://... or /uploads/..."
                  value={form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                />
                <label className="btn-ghost cursor-pointer">
                  <ImageIcon className="h-4 w-4" />
                  {uploading ? "Uploading..." : "Upload"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                  />
                </label>
              </div>
              {form.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.imageUrl} alt="" className="mt-3 h-32 w-32 rounded-lg border border-fox-border object-cover" />
              )}
            </div>
            <div>
              <label className="label">Sort order</label>
              <input
                className="input"
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-end gap-6">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                <span className="text-sm">Active</span>
              </label>
              {form.stockMode === "UNIQUE" && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.sold}
                    onChange={(e) => setForm({ ...form, sold: e.target.checked })}
                  />
                  <span className="text-sm">Sold</span>
                </label>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button type="submit" disabled={saving || !form.title || form.priceUsd <= 0} className="btn-primary">
              <Save className="h-4 w-4" /> {saving ? "Saving..." : editing ? "Save changes" : "Create account"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-fox-muted text-sm">Loading...</div>
      ) : accounts.length === 0 ? (
        <div className="card p-10 text-center text-fox-muted text-sm">
          No accounts yet — click &quot;Add Account&quot; to create one.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-fox-surface text-fox-muted text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-5 py-3">Account</th>
                  <th className="text-left px-5 py-3">Game</th>
                  <th className="text-left px-5 py-3">Rank</th>
                  <th className="text-right px-5 py-3">Price USD</th>
                  <th className="text-center px-5 py-3">Stock</th>
                  <th className="text-center px-5 py-3">Active</th>
                  <th className="text-right px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fox-border">
                {accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-fox-surface/50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {acc.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={acc.imageUrl} alt="" className="h-10 w-14 rounded-lg object-cover border border-fox-border" />
                        ) : (
                          <div className="h-10 w-14 rounded-lg bg-fox-bg/60 border border-fox-border" />
                        )}
                        <span className="font-medium">{acc.title}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-fox-muted">{acc.Game?.name || "General"}</td>
                    <td className="px-5 py-3 text-xs">{acc.rank || "—"}</td>
                    <td className="px-5 py-3 text-right font-mono text-fox-primary">${acc.priceUsd.toFixed(2)}</td>
                    <td className="px-5 py-3 text-center">
                      {acc.stockMode === "MULTI" ? (
                        <span className={`text-xs font-semibold ${acc.stock <= 0 ? "text-red-400" : "text-fox-text"}`}>
                          {acc.stock <= 0 ? "Out of stock" : `${acc.stock} left`}
                        </span>
                      ) : (
                        <button onClick={() => toggleSold(acc)}>
                          <span className={`inline-block h-5 w-9 rounded-full relative transition-colors ${acc.sold ? "bg-red-500" : "bg-fox-border"}`}>
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${acc.sold ? "translate-x-4" : "translate-x-0.5"}`} />
                          </span>
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => toggleActive(acc)}>
                        <span className={`inline-block h-5 w-9 rounded-full relative transition-colors ${acc.active ? "bg-green-500" : "bg-fox-border"}`}>
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${acc.active ? "translate-x-4" : "translate-x-0.5"}`} />
                        </span>
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right space-x-3">
                      <button onClick={() => openEdit(acc)} className="text-fox-accent text-xs hover:underline">Edit</button>
                      <button onClick={() => remove(acc)} className="text-red-400 text-xs hover:underline inline-flex items-center gap-1">
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
