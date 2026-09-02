"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Save, X, Image as ImageIcon } from "lucide-react";

interface Game {
  id: string;
  name: string;
}

interface GameItem {
  id: string;
  gameId: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceUsd: number;
  badge: string | null;
  active: boolean;
  sortOrder: number;
  Game?: { name: string; slug: string } | null;
}

const empty = {
  gameId: "",
  name: "",
  description: "",
  imageUrl: "",
  priceUsd: 0,
  badge: "",
  active: true,
  sortOrder: 0,
};

export default function GameItemsAdminPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [items, setItems] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GameItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    const [gRes, iRes] = await Promise.all([
      fetch("/api/admin/games").then((r) => r.json()),
      fetch("/api/admin/game-items").then((r) => r.json()),
    ]);
    setGames(gRes);
    setItems(iRes);
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

  function openEdit(item: GameItem) {
    setCreating(false);
    setEditing(item);
    setError(null);
    setForm({
      gameId: item.gameId || "",
      name: item.name,
      description: item.description || "",
      imageUrl: item.imageUrl || "",
      priceUsd: item.priceUsd,
      badge: item.badge || "",
      active: item.active,
      sortOrder: item.sortOrder,
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
      name: form.name,
      description: form.description || null,
      imageUrl: form.imageUrl || null,
      priceUsd: Number(form.priceUsd),
      badge: form.badge || null,
      active: form.active,
      sortOrder: Number(form.sortOrder),
    };
    const url = editing ? `/api/admin/game-items/${editing.id}` : "/api/admin/game-items";
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

  async function toggleActive(item: GameItem) {
    await fetch(`/api/admin/game-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !item.active }),
    });
    await loadAll();
  }

  async function remove(item: GameItem) {
    if (!confirm(`Delete "${item.name}"?`)) return;
    await fetch(`/api/admin/game-items/${item.id}`, { method: "DELETE" });
    await loadAll();
  }

  const showForm = creating || editing;

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Game Items</h1>
          <p className="text-fox-muted text-sm">Skins, bundles, and in-game items.</p>
        </div>
        <button onClick={openNew} className="btn-primary">
          <Plus className="h-4 w-4" /> Add Item
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="card p-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{editing ? `Edit — ${editing.name}` : "New item"}</h2>
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
              <label className="label">Name *</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <textarea
                className="input"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
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
              <label className="label">Badge</label>
              <input
                className="input"
                placeholder="Hot / New / Limited"
                value={form.badge}
                onChange={(e) => setForm({ ...form, badge: e.target.value })}
              />
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
            <div className="flex items-end">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button type="submit" disabled={saving || !form.name || form.priceUsd <= 0} className="btn-primary">
              <Save className="h-4 w-4" /> {saving ? "Saving..." : editing ? "Save changes" : "Create item"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-fox-muted text-sm">Loading...</div>
      ) : items.length === 0 ? (
        <div className="card p-10 text-center text-fox-muted text-sm">
          No game items yet — click &quot;Add Item&quot; to create one.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-fox-surface text-fox-muted text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-5 py-3">Item</th>
                  <th className="text-left px-5 py-3">Game</th>
                  <th className="text-right px-5 py-3">Price USD</th>
                  <th className="text-left px-5 py-3">Badge</th>
                  <th className="text-center px-5 py-3">Active</th>
                  <th className="text-right px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fox-border">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-fox-surface/50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-fox-border" />
                        ) : (
                          <div className="h-10 w-10 rounded-lg bg-fox-bg/60 border border-fox-border" />
                        )}
                        <span className="font-medium">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-fox-muted">{item.Game?.name || "General"}</td>
                    <td className="px-5 py-3 text-right font-mono text-fox-primary">${item.priceUsd.toFixed(2)}</td>
                    <td className="px-5 py-3 text-xs">{item.badge || "—"}</td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => toggleActive(item)}>
                        <span className={`inline-block h-5 w-9 rounded-full relative transition-colors ${item.active ? "bg-green-500" : "bg-fox-border"}`}>
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${item.active ? "translate-x-4" : "translate-x-0.5"}`} />
                        </span>
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right space-x-3">
                      <button onClick={() => openEdit(item)} className="text-fox-accent text-xs hover:underline">Edit</button>
                      <button onClick={() => remove(item)} className="text-red-400 text-xs hover:underline inline-flex items-center gap-1">
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
