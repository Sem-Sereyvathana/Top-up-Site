"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Save, X, Image as ImageIcon } from "lucide-react";

interface Category {
  id: string;
  name: string;
  imageUrl: string | null;
  sortOrder: number;
  deliveryMode: "DIRECT" | "MANUAL";
}

interface GameItem {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceUsd: number;
  badge: string | null;
  active: boolean;
  sortOrder: number;
  Category?: { name: string; slug: string } | null;
}

const empty = {
  categoryId: "",
  name: "",
  description: "",
  imageUrl: "",
  priceUsd: 0,
  badge: "",
  active: true,
  sortOrder: 0,
};

const emptyCategory = { name: "", imageUrl: "", deliveryMode: "DIRECT" as "DIRECT" | "MANUAL" };

export default function GameItemsAdminPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GameItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline category manager
  const [catForm, setCatForm] = useState(emptyCategory);
  const [catUploading, setCatUploading] = useState(false);
  const [catSaving, setCatSaving] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    const [cRes, iRes] = await Promise.all([
      fetch("/api/admin/game-item-categories").then((r) => r.json()),
      fetch("/api/admin/game-items").then((r) => r.json()),
    ]);
    setCategories(cRes);
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
      categoryId: item.categoryId || "",
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

  async function uploadCatImage(file: File) {
    setCatUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      setCatForm((f) => ({ ...f, imageUrl: data.url }));
    }
    setCatUploading(false);
  }

  function openEditCategory(cat: Category) {
    setEditingCatId(cat.id);
    setCatForm({ name: cat.name, imageUrl: cat.imageUrl || "", deliveryMode: cat.deliveryMode });
  }

  function closeCategoryForm() {
    setEditingCatId(null);
    setCatForm(emptyCategory);
  }

  async function saveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catForm.name.trim()) return;
    setCatSaving(true);
    const payload = { name: catForm.name, imageUrl: catForm.imageUrl || null, deliveryMode: catForm.deliveryMode };
    const url = editingCatId
      ? `/api/admin/game-item-categories/${editingCatId}`
      : "/api/admin/game-item-categories";
    const method = editingCatId ? "PATCH" : "POST";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setCatSaving(false);
    closeCategoryForm();
    await loadAll();
  }

  async function deleteCategory(cat: Category) {
    if (
      !confirm(
        `Delete category "${cat.name}"? Items in it will become uncategorized (General), not deleted.`
      )
    )
      return;
    await fetch(`/api/admin/game-item-categories/${cat.id}`, { method: "DELETE" });
    await loadAll();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      categoryId: form.categoryId || null,
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

      {/* Inline category manager — categories here are independent of the
          Top-up "Games" list; they only exist for the storefront items page. */}
      <div className="card p-5 mb-8">
        <h2 className="font-semibold mb-1">Categories</h2>
        <p className="text-fox-muted text-xs mb-4">
          Your own item categories (e.g. Blox Fruits, GAG). Not linked to the Top-up games list.
        </p>

        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-2 rounded-lg border border-fox-border bg-fox-surface px-3 py-1.5"
              >
                {cat.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cat.imageUrl} alt="" className="h-5 w-5 rounded object-cover" />
                ) : (
                  <div className="h-5 w-5 rounded bg-fox-bg/60" />
                )}
                <span className="text-sm">{cat.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    cat.deliveryMode === "DIRECT"
                      ? "bg-green-400/10 text-green-400"
                      : "bg-yellow-400/10 text-yellow-400"
                  }`}
                  title={cat.deliveryMode === "DIRECT" ? "Admin delivers directly, no chat needed" : "Buyer is pointed to Telegram after paying"}
                >
                  {cat.deliveryMode === "DIRECT" ? "Direct" : "Manual"}
                </span>
                <button
                  type="button"
                  onClick={() => openEditCategory(cat)}
                  className="text-fox-accent text-xs hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => deleteCategory(cat)}
                  className="text-red-400 text-xs hover:underline"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={saveCategory} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="label">{editingCatId ? "Edit category name" : "New category name"}</label>
            <input
              className="input"
              placeholder="e.g. Blox Fruits"
              value={catForm.name}
              onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
            />
          </div>
          <div className="min-w-[150px]">
            <label className="label">Delivery</label>
            <select
              className="input"
              value={catForm.deliveryMode}
              onChange={(e) => setCatForm({ ...catForm, deliveryMode: e.target.value as "DIRECT" | "MANUAL" })}
            >
              <option value="DIRECT">Direct (admin sends it in-game)</option>
              <option value="MANUAL">Manual (buyer messages Telegram)</option>
            </select>
          </div>
          <div>
            <label className="btn-ghost cursor-pointer">
              <ImageIcon className="h-4 w-4" />
              {catUploading ? "Uploading..." : "Icon"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadCatImage(e.target.files[0])}
              />
            </label>
          </div>
          {catForm.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={catForm.imageUrl} alt="" className="h-9 w-9 rounded-lg border border-fox-border object-cover" />
          )}
          <button type="submit" disabled={catSaving || !catForm.name.trim()} className="btn-primary">
            <Save className="h-4 w-4" /> {catSaving ? "Saving..." : editingCatId ? "Save" : "Add category"}
          </button>
          {editingCatId && (
            <button type="button" onClick={closeCategoryForm} className="btn-ghost">
              <X className="h-4 w-4" /> Cancel
            </button>
          )}
        </form>
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
              <label className="label">Category</label>
              <select
                className="input"
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">— General (no category) —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
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
                  <th className="text-left px-5 py-3">Category</th>
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
                    <td className="px-5 py-3 text-fox-muted">{item.Category?.name || "General"}</td>
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
