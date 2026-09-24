"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Group {
  id: string;
  name: string;
  imageUrl: string | null;
  sortOrder: number;
}

const emptyGroup = { name: "", imageUrl: "" };

export default function AdminGamesPage() {
  const [games, setGames] = useState<any[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  // Inline group manager
  const [groupForm, setGroupForm] = useState(emptyGroup);
  const [groupUploading, setGroupUploading] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [gRes, grpRes] = await Promise.all([
      fetch("/api/admin/games").then((r) => r.json()),
      fetch("/api/admin/game-groups").then((r) => r.json()),
    ]);
    setGames(gRes);
    setGroups(grpRes);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function uploadGroupImage(file: File) {
    setGroupUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      setGroupForm((f) => ({ ...f, imageUrl: data.url }));
    }
    setGroupUploading(false);
  }

  function openEditGroup(group: Group) {
    setEditingGroupId(group.id);
    setGroupForm({ name: group.name, imageUrl: group.imageUrl || "" });
  }

  function closeGroupForm() {
    setEditingGroupId(null);
    setGroupForm(emptyGroup);
  }

  async function saveGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupForm.name.trim()) return;
    setGroupSaving(true);
    const payload = { name: groupForm.name, imageUrl: groupForm.imageUrl || null };
    const url = editingGroupId ? `/api/admin/game-groups/${editingGroupId}` : "/api/admin/game-groups";
    const method = editingGroupId ? "PATCH" : "POST";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setGroupSaving(false);
    closeGroupForm();
    await load();
  }

  async function deleteGroup(group: Group) {
    if (!confirm(`Delete group "${group.name}"? Games in it will become ungrouped, not deleted.`)) return;
    await fetch(`/api/admin/game-groups/${group.id}`, { method: "DELETE" });
    await load();
  }

  async function toggleActive(game: any) {
    await fetch(`/api/admin/games/${game.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !game.active }),
    });
    await load();
  }

  async function toggleFeatured(game: any) {
    await fetch(`/api/admin/games/${game.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured: !game.featured }),
    });
    await load();
  }

  async function deleteGame(game: any) {
    if (!confirm(`Delete "${game.name}" and all its products/orders? This cannot be undone.`)) return;
    await fetch(`/api/admin/games/${game.id}`, { method: "DELETE" });
    await load();
  }

  async function reorder(id: string, direction: "up" | "down") {
    await fetch("/api/admin/games/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, direction }),
    });
    await load();
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold">Games</h1>
          <p className="text-fox-muted">Manage the games you sell top-ups for.</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary">+ Add Game</button>
      </div>

      {/* Inline group manager — create a group (name + banner) once here,
          then pick it from a dropdown on any game below instead of typing
          it out each time. Mirrors the Categories manager on Game Items. */}
      <div className="card p-5 mb-6">
        <h2 className="font-semibold mb-1">Groups</h2>
        <p className="text-fox-muted text-xs mb-4">
          Games sharing a group (e.g. every Mobile Legends server) appear under one filter tab on the home page.
        </p>

        {groups.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {groups.map((group) => (
              <div
                key={group.id}
                className="flex items-center gap-2 rounded-lg border border-fox-border bg-fox-surface px-3 py-1.5"
              >
                {group.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={group.imageUrl} alt="" className="h-5 w-5 rounded object-cover" />
                ) : (
                  <div className="h-5 w-5 rounded bg-fox-bg/60" />
                )}
                <span className="text-sm">{group.name}</span>
                <button type="button" onClick={() => openEditGroup(group)} className="text-fox-accent text-xs hover:underline">
                  Edit
                </button>
                <button type="button" onClick={() => deleteGroup(group)} className="text-red-400 text-xs hover:underline">
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={saveGroup} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="label">{editingGroupId ? "Edit group name" : "New group name"}</label>
            <input
              className="input"
              placeholder="e.g. Mobile Legends"
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
            />
          </div>
          <div>
            <label className="btn-ghost cursor-pointer">
              {groupUploading ? "Uploading..." : "Banner"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadGroupImage(e.target.files[0])}
              />
            </label>
          </div>
          {groupForm.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={groupForm.imageUrl} alt="" className="h-9 w-9 rounded-lg border border-fox-border object-cover" />
          )}
          <button type="submit" disabled={groupSaving || !groupForm.name.trim()} className="btn-primary">
            {groupSaving ? "Saving..." : editingGroupId ? "Save" : "Add group"}
          </button>
          {editingGroupId && (
            <button type="button" onClick={closeGroupForm} className="btn-ghost">
              Cancel
            </button>
          )}
        </form>
      </div>

      {(creating || editing) && (
        <GameForm
          initial={editing}
          groups={groups}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await load();
          }}
        />
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-fox-surface text-fox-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Game</th>
                <th className="text-left px-5 py-3">Slug</th>
                <th className="text-left px-5 py-3">Publisher</th>
                <th className="text-right px-5 py-3">Products</th>
                <th className="text-right px-5 py-3">Orders</th>
                <th className="text-center px-5 py-3">Featured</th>
                <th className="text-center px-5 py-3">Active</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fox-border">
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-fox-muted">Loading...</td></tr>
              ) : games.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-16 text-center">
                    <div className="text-4xl mb-3">🎮</div>
                    <p className="text-fox-muted mb-1">No games yet</p>
                    <p className="text-xs text-fox-muted/60 mb-3">Add your first game to start selling top-ups.</p>
                    <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-fox-primary px-4 py-2 text-sm font-semibold text-black hover:bg-fox-primary/90 transition-colors">+ Add Game</button>
                </td></tr>
              ) : (
                games.map((g, idx) => (
                  <tr key={g.id} className="hover:bg-fox-surface/50">
                    <td className="px-5 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => reorder(g.id, "up")}
                            disabled={idx === 0}
                            className="text-xs text-fox-muted hover:text-fox-primary disabled:opacity-20"
                            title="Move up"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => reorder(g.id, "down")}
                            disabled={idx === games.length - 1}
                            className="text-xs text-fox-muted hover:text-fox-primary disabled:opacity-20"
                            title="Move down"
                          >
                            ▼
                          </button>
                        </div>
                        <span>{g.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-fox-muted">{g.slug}</td>
                    <td className="px-5 py-3 text-fox-muted">{g.publisher || "—"}</td>
                    <td className="px-5 py-3 text-right font-mono">{g._count.products}</td>
                    <td className="px-5 py-3 text-right font-mono">{g._count.orders}</td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => toggleFeatured(g)} className={g.featured ? "text-fox-accent" : "text-fox-muted"}>
                        {g.featured ? "★" : "☆"}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => toggleActive(g)}>
                        <span className={`inline-block h-5 w-9 rounded-full relative transition-colors ${g.active ? "bg-green-500" : "bg-fox-border"}`}>
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${g.active ? "translate-x-4" : "translate-x-0.5"}`} />
                        </span>
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right space-x-2">
                      <Link href={`/admin/products?gameId=${g.id}`} className="text-fox-primary text-xs hover:underline">Products</Link>
                      <button onClick={() => setEditing(g)} className="text-fox-accent text-xs hover:underline">Edit</button>
                      <button onClick={() => deleteGame(g)} className="text-red-400 text-xs hover:underline">Delete</button>
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

function GameForm({ initial, groups, onCancel, onSaved }: { initial: any; groups: Group[]; onCancel: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    slug: initial?.slug || "",
    name: initial?.name || "",
    groupId: initial?.groupId || "",
    publisher: initial?.publisher || "",
    description: initial?.description || "",
    imageUrl: initial?.imageUrl || "",
    bannerUrl: initial?.bannerUrl || "",
    currencyName: initial?.currencyName || "",
    uidLabel: initial?.uidLabel || "Player ID",
    uidExample: initial?.uidExample || "",
    featured: initial?.featured || false,
    active: initial?.active ?? true,
    sortOrder: initial?.sortOrder || 0,
    // Only matters for the Accounts marketplace — see app/accounts.
    deliveryMode: initial?.deliveryMode || "DIRECT",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      groupId: form.groupId || "",
      bannerUrl: form.bannerUrl || undefined,
      description: form.description || undefined,
      publisher: form.publisher || undefined,
      uidExample: form.uidExample || undefined,
    };
    const url = initial ? `/api/admin/games/${initial.id}` : "/api/admin/games";
    const method = initial ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to save");
      setSaving(false);
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={save} className="card p-6 mb-6">
      <h3 className="font-semibold text-lg mb-4">{initial ? "Edit Game" : "Add New Game"}</h3>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div>
          <label className="label">Slug (URL-safe)</label>
          <input
            className="input font-mono"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
            required
          />
        </div>
        <div>
          <label className="label">Group <span className="text-fox-muted/60 font-normal">(optional — e.g. share one filter tab across servers)</span></label>
          <select className="input" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
            <option value="">— No group —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Publisher <span className="text-fox-muted/60 font-normal">(optional)</span></label>
          <input className="input" value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} />
        </div>
        <div>
          <label className="label">Currency Name (e.g. Diamonds)</label>
          <input className="input" value={form.currencyName} onChange={(e) => setForm({ ...form, currencyName: e.target.value })} required />
        </div>
        <div>
          <label className="label">Image (cover)</label>
          <ImageField
            value={form.imageUrl}
            onChange={(v) => setForm({ ...form, imageUrl: v })}
            required
          />
        </div>
        <div>
          <label className="label">Banner (optional, wide)</label>
          <ImageField
            value={form.bannerUrl}
            onChange={(v) => setForm({ ...form, bannerUrl: v })}
          />
        </div>
        <div>
          <label className="label">UID Label</label>
          <input className="input" value={form.uidLabel} onChange={(e) => setForm({ ...form, uidLabel: e.target.value })} />
        </div>
        <div>
          <label className="label">UID Example</label>
          <input className="input" value={form.uidExample} onChange={(e) => setForm({ ...form, uidExample: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <label className="label">Description</label>
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className="label">Sort Order</label>
          <input className="input" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">Accounts delivery</label>
          <select
            className="input"
            value={form.deliveryMode}
            onChange={(e) => setForm({ ...form, deliveryMode: e.target.value })}
          >
            <option value="DIRECT">Direct (admin hands over login right away)</option>
            <option value="MANUAL">Manual (buyer messages Telegram first)</option>
          </select>
          <p className="mt-1 text-xs text-fox-muted/70">Only affects Accounts listed under this game.</p>
        </div>
      </div>

      <div className="flex gap-6 mb-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
          Featured
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Active
        </label>
      </div>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300 mb-4">{error}</div>}

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Saving..." : initial ? "Save Changes" : "Create Game"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
      </div>
    </form>
  );
}

function ImageField({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
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
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
      {err && <div className="text-xs text-red-400">{err}</div>}
    </div>
  );
}
