"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function AdminAccountsPage() {
  const searchParams = useSearchParams();
  const gameIdFilter = searchParams.get("gameId") || "";

  const [games, setGames] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedGame, setSelectedGame] = useState(gameIdFilter);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [gRes, aRes] = await Promise.all([
      fetch("/api/admin/games").then((r) => r.json()),
      fetch(`/api/admin/accounts${selectedGame ? `?gameId=${selectedGame}` : ""}`).then((r) => r.json()),
    ]);
    setGames(gRes);
    setAccounts(aRes);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGame]);

  async function toggleActive(a: any) {
    await fetch(`/api/admin/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !a.active }),
    });
    await loadAll();
  }

  async function toggleSold(a: any) {
    await fetch(`/api/admin/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sold: !a.sold }),
    });
    await loadAll();
  }

  async function deleteAccount(a: any) {
    if (!confirm(`Delete "${a.title}"?`)) return;
    await fetch(`/api/admin/accounts/${a.id}`, { method: "DELETE" });
    await loadAll();
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold">Game Accounts</h1>
          <p className="text-fox-muted">Pre-leveled or rare accounts for sale.</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary">+ Add Account</button>
      </div>

      <div className="card p-4 mb-6">
        <label className="label">Filter by game</label>
        <select
          className="input max-w-sm"
          value={selectedGame}
          onChange={(e) => setSelectedGame(e.target.value)}
        >
          <option value="">All games</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      {(creating || editing) && (
        <AccountForm
          games={games}
          defaultGameId={selectedGame}
          initial={editing}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await loadAll(); }}
        />
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-fox-surface text-fox-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Image</th>
                <th className="text-left px-5 py-3">Game</th>
                <th className="text-left px-5 py-3">Title</th>
                <th className="text-left px-5 py-3">Rank</th>
                <th className="text-right px-5 py-3">Price USD</th>
                <th className="text-center px-5 py-3">Sold</th>
                <th className="text-center px-5 py-3">Active</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fox-border">
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-fox-muted">Loading...</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-16 text-center">
                    <div className="text-4xl mb-3">🕹️</div>
                    <p className="text-fox-muted mb-1">No accounts yet</p>
                    <p className="text-xs text-fox-muted/60 mb-3">List pre-leveled or rare accounts for sale.</p>
                    <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-fox-primary px-4 py-2 text-sm font-semibold text-black hover:bg-fox-primary/90 transition-colors">+ Add Account</button>
                </td></tr>
              ) : (
                accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-fox-surface/50">
                    <td className="px-5 py-3">
                      {a.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-fox-border" />
                      ) : (
                        <div className="h-10 w-10 rounded-lg border border-dashed border-fox-border" />
                      )}
                    </td>
                    <td className="px-5 py-3 text-fox-muted">{a.Game?.name || "—"}</td>
                    <td className="px-5 py-3 font-medium">{a.title}</td>
                    <td className="px-5 py-3 text-xs">{a.rank || "—"}</td>
                    <td className="px-5 py-3 text-right font-mono text-fox-primary">${a.priceUsd.toFixed(2)}</td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => toggleSold(a)}>
                        <span className={`inline-block h-5 w-9 rounded-full relative transition-colors ${a.sold ? "bg-red-500" : "bg-fox-border"}`}>
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${a.sold ? "translate-x-4" : "translate-x-0.5"}`} />
                        </span>
                      </button>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => toggleActive(a)}>
                        <span className={`inline-block h-5 w-9 rounded-full relative transition-colors ${a.active ? "bg-green-500" : "bg-fox-border"}`}>
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${a.active ? "translate-x-4" : "translate-x-0.5"}`} />
                        </span>
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right space-x-2">
                      <button onClick={() => setEditing(a)} className="text-fox-accent text-xs hover:underline">Edit</button>
                      <button onClick={() => deleteAccount(a)} className="text-red-400 text-xs hover:underline">Delete</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AccountForm({ games, defaultGameId, initial, onCancel, onSaved }: any) {
  const [form, setForm] = useState({
    gameId: initial?.gameId || defaultGameId || "",
    title: initial?.title || "",
    rank: initial?.rank || "",
    description: initial?.description || "",
    imageUrl: initial?.imageUrl || "",
    priceUsd: initial?.priceUsd ?? 0,
    sold: initial?.sold ?? false,
    active: initial?.active ?? true,
    sortOrder: initial?.sortOrder ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      gameId: form.gameId || null,
      priceUsd: Number(form.priceUsd),
      sortOrder: Number(form.sortOrder),
      rank: form.rank || null,
      description: form.description || null,
      imageUrl: form.imageUrl || null,
    };
    const url = initial ? `/api/admin/accounts/${initial.id}` : "/api/admin/accounts";
    const method = initial ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed");
      setSaving(false);
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={save} className="card p-6 mb-6">
      <h3 className="font-semibold text-lg mb-4">{initial ? "Edit Account" : "New Account"}</h3>
      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <div className="md:col-span-3">
          <label className="label">Game (optional)</label>
          <select
            className="input"
            value={form.gameId}
            onChange={(e) => setForm({ ...form, gameId: e.target.value })}
          >
            <option value="">— none / unspecified —</option>
            {games.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">Title (e.g. &quot;Mythic Glory Account&quot;)</label>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <div>
          <label className="label">Rank / Level</label>
          <input className="input" value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })} />
        </div>
        <div className="md:col-span-3">
          <label className="label">Description</label>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="md:col-span-3">
          <label className="label">Image</label>
          <ImageField value={form.imageUrl} onChange={(v) => setForm({ ...form, imageUrl: v })} />
        </div>
        <div>
          <label className="label">Price (USD)</label>
          <input className="input" type="number" step="0.01" value={form.priceUsd} onChange={(e) => setForm({ ...form, priceUsd: e.target.value })} required />
        </div>
        <div>
          <label className="label">Sort Order</label>
          <input className="input" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
        </div>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.sold} onChange={(e) => setForm({ ...form, sold: e.target.checked })} />
            Sold
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300 mb-4">{error}</div>}

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : initial ? "Save" : "Create"}</button>
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}

function ImageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File) {
    setErr(null);
    if (file.size > 5 * 1024 * 1024) {
      setErr("Max 5MB.");
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      onChange(data.url);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {value ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-fox-border bg-fox-bg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-fox-border bg-fox-bg text-xs text-fox-muted">
            No image
          </div>
        )}
        <label className="btn-ghost cursor-pointer text-sm">
          {uploading ? "Uploading..." : value ? "Replace" : "Upload"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-red-400 hover:underline"
          >
            Clear
          </button>
        )}
      </div>
      <input
        className="input font-mono text-xs"
        placeholder="or paste an image URL"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
