"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Save, X, Image as ImageIcon, Upload, ChevronDown, ChevronUp } from "lucide-react";
import { parseAccountStockText } from "@/lib/accountStockParser";

interface Category {
  id: string;
  name: string;
  imageUrl: string | null;
  sortOrder: number;
}

interface GameAccount {
  id: string;
  gameId: string | null;
  categoryId: string | null;
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
  deliveryMode: "DIRECT" | "MANUAL";
  credentials: string | null;
  Game?: { name: string; slug: string } | null;
  Category?: { name: string; slug: string } | null;
}

interface StockItem {
  id: string;
  username: string;
  password: string;
  notes: string | null;
  status: "AVAILABLE" | "ASSIGNED";
  createdAt: string;
}

const empty = {
  categoryId: "",
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
  deliveryMode: "MANUAL" as "DIRECT" | "MANUAL",
  credUsername: "",
  credPassword: "",
  credNotes: "",
  credLegacy: "",
  // Pasted/uploaded here while creating a brand-new Multiple-stock + Direct
  // account; added as real stock right after the account itself is
  // created (see save()). Ignored once an account already exists — from
  // then on, Auto Top Up posts straight to the stock pool instead.
  stockText: "",
};

const emptyCategory = { name: "", imageUrl: "" };

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<GameAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GameAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sold unique-login accounts are done being sold — keeping them mixed
  // into the main table just floods it as more sell. They're tucked into
  // a collapsed section below instead (still editable/deletable from
  // there); their order-history rows keep working either way since those
  // store their own title/price snapshot.
  const [showSold, setShowSold] = useState(false);

  // Inline category manager — same pattern as the Game Items page: these
  // labels are the admin's own, independent of the Top-up "Games" list.
  const [catForm, setCatForm] = useState(emptyCategory);
  const [catUploading, setCatUploading] = useState(false);
  const [catSaving, setCatSaving] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);

  // Auto Top Up — the credential pool for "Multiple stock" + Direct
  // accounts (see GameAccountStockItem). Loaded whenever a pooled account
  // is opened for editing.
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const stockFileRef = useRef<HTMLInputElement>(null);

  async function loadAll() {
    setLoading(true);
    const [cRes, aRes] = await Promise.all([
      fetch("/api/admin/game-account-categories").then((r) => r.json()),
      fetch("/api/admin/accounts").then((r) => r.json()),
    ]);
    setCategories(cRes);
    setAccounts(aRes);
    setLoading(false);
  }

  async function loadStock(accountId: string) {
    setStockLoading(true);
    const res = await fetch(`/api/admin/accounts/${accountId}/stock`);
    const data = await res.json().catch(() => ({ items: [] }));
    setStockItems(data.items || []);
    setStockLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  function isPooled(f: { stockMode: string; deliveryMode: string }) {
    return f.stockMode === "MULTI" && f.deliveryMode === "DIRECT";
  }

  function openNew() {
    setCreating(true);
    setEditing(null);
    setError(null);
    setForm(empty);
    setTopUpOpen(false);
    setStockItems([]);
    setTopUpError(null);
  }

  function openEdit(acc: GameAccount, expandTopUp = false) {
    setCreating(false);
    setEditing(acc);
    setError(null);
    setTopUpError(null);
    const cred = parseCredentials(acc.credentials);
    setForm({
      categoryId: acc.categoryId || "",
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
      deliveryMode: acc.deliveryMode,
      credUsername: cred.username,
      credPassword: cred.password,
      credNotes: cred.notes,
      credLegacy: cred.legacy,
      stockText: "",
    });
    if (isPooled(acc)) {
      setTopUpOpen(expandTopUp);
      loadStock(acc.id);
    } else {
      setTopUpOpen(false);
      setStockItems([]);
    }
  }

  // Entry point for the "Auto Top Up" button on each row — opens that
  // account straight into its stock pool panel instead of the plain edit
  // view, so adding more accounts is a one-click trip from the table.
  function openTopUp(acc: GameAccount) {
    openEdit(acc, true);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setForm(empty);
    setError(null);
    setTopUpOpen(false);
    setStockItems([]);
    setTopUpError(null);
  }

  function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function handleStockFile(file: File) {
    const text = await readFileAsText(file).catch(() => "");
    if (!text.trim()) return;
    setForm((f) => ({ ...f, stockText: f.stockText ? `${f.stockText}\n${text}` : text }));
  }

  // Immediately posts whatever's pasted/uploaded into the pool for an
  // account that already exists — used from the edit view. For a
  // brand-new account there's no id yet, so that text rides along with
  // the "Create account" submit instead (see save()).
  async function addStockNow() {
    if (!editing) return;
    const preview = parseAccountStockText(form.stockText);
    if (preview.length === 0) {
      setTopUpError("Paste or upload some accounts first — one per line, e.g. alice@gmail.com:hunter2.");
      return;
    }
    setTopUpBusy(true);
    setTopUpError(null);
    const res = await fetch(`/api/admin/accounts/${editing.id}/stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: form.stockText }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTopUpError(data.error || "Failed to add stock.");
      setTopUpBusy(false);
      return;
    }
    setForm((f) => ({ ...f, stockText: "" }));
    await loadStock(editing.id);
    await loadAll();
    setTopUpBusy(false);
  }

  async function deleteStockItem(stockId: string) {
    if (!editing) return;
    if (!confirm("Remove this account from stock? It hasn't been sold yet.")) return;
    const res = await fetch(`/api/admin/accounts/${editing.id}/stock/${stockId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to remove.");
      return;
    }
    await loadStock(editing.id);
    await loadAll();
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
    setCatForm({ name: cat.name, imageUrl: cat.imageUrl || "" });
  }

  function closeCategoryForm() {
    setEditingCatId(null);
    setCatForm(emptyCategory);
  }

  async function saveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catForm.name.trim()) return;
    setCatSaving(true);
    const payload = { name: catForm.name, imageUrl: catForm.imageUrl || null };
    const url = editingCatId
      ? `/api/admin/game-account-categories/${editingCatId}`
      : "/api/admin/game-account-categories";
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
        `Delete label "${cat.name}"? Accounts using it will become uncategorized (General), not deleted.`
      )
    )
      return;
    await fetch(`/api/admin/game-account-categories/${cat.id}`, { method: "DELETE" });
    await loadAll();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!form.priceUsd || Number(form.priceUsd) <= 0) {
      setError("Price (USD) must be greater than 0.");
      return;
    }
    setSaving(true);
    const payload: any = {
      categoryId: form.categoryId || null,
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
      deliveryMode: form.deliveryMode,
      // UNIQUE accounts still carry their single login on `credentials`;
      // MULTI + DIRECT accounts are stocked entirely through the Auto Top
      // Up pool instead, so there's nothing meaningful to save here.
      credentials: form.stockMode === "UNIQUE" ? buildCredentials(form) : null,
    };
    if (!editing && isPooled(form) && form.stockText.trim()) {
      // Brand-new pooled account — whatever was pasted/uploaded into Auto
      // Top Up before saving rides along and becomes its starting stock.
      payload.stockText = form.stockText;
    }
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
    const res = await fetch(`/api/admin/accounts/${acc.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Couldn't delete this account.");
      return;
    }
    await loadAll();
  }

  const showForm = creating || editing;
  const soldAccounts = accounts.filter((a) => a.stockMode === "UNIQUE" && a.sold);
  const liveAccounts = accounts.filter((a) => !(a.stockMode === "UNIQUE" && a.sold));

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

      {/* Inline label manager — these labels are the admin's own, independent
          of the Top-up "Games" list, so accounts aren't limited to picking
          from games that already have a full Top-up entry. Same pattern as
          the Categories manager on the Game Items page. */}
      <div className="card p-5 mb-8">
        <h2 className="font-semibold mb-1">Labels</h2>
        <p className="text-fox-muted text-xs mb-4">
          Your own game/type labels (e.g. Free Fire, Valorant) — used to group accounts below.
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
            <label className="label">{editingCatId ? "Edit label name" : "New label name"}</label>
            <input
              className="input"
              placeholder="e.g. Free Fire"
              value={catForm.name}
              onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
            />
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
            <Save className="h-4 w-4" /> {catSaving ? "Saving..." : editingCatId ? "Save" : "Add label"}
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
            <h2 className="font-semibold">{editing ? `Edit — ${editing.title}` : "New account"}</h2>
            <button type="button" onClick={closeForm} className="text-xs text-fox-muted hover:text-fox-text inline-flex items-center gap-1">
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Label</label>
              <select
                className="input"
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">— General (no label) —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
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
            <div>
              <label className="label">Delivery</label>
              <select
                className="input"
                value={form.deliveryMode}
                onChange={(e) => setForm({ ...form, deliveryMode: e.target.value as "DIRECT" | "MANUAL" })}
              >
                <option value="DIRECT">Direct (auto-revealed to buyer once paid)</option>
                <option value="MANUAL">Manual (buyer messages Telegram)</option>
              </select>
            </div>
            {form.stockMode === "MULTI" && (
              <div>
                <label className="label">Stock quantity</label>
                {isPooled(form) ? (
                  <>
                    <div className="input flex items-center justify-between bg-fox-bg/40 text-fox-muted cursor-not-allowed">
                      <span>
                        {editing ? (stockLoading ? "Loading…" : `${form.stock} available`) : "0 — add via Auto Top Up below"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-fox-muted/70">
                      Managed automatically from real stocked accounts — use Auto Top Up below to add or remove units instead of typing a number here.
                    </p>
                  </>
                ) : (
                  <>
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
                  </>
                )}
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
            {form.deliveryMode === "DIRECT" && form.stockMode === "UNIQUE" && (
              <>
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
                Username/Email and Password are handed to the buyer automatically — on their payment receipt and again if they revisit it from Order History — once this order is paid.
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
              </>
            )}
            {isPooled(form) && (
              <div className="sm:col-span-2 rounded-lg border border-fox-border bg-fox-bg/30 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm">Stock pool — Auto Top Up</p>
                    <p className="text-xs text-fox-muted/70">
                      Each buyer gets their own real login instead of everyone sharing one. Paste a list or drop a file — one account per line.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTopUpOpen((v) => !v)}
                    className="btn-ghost shrink-0"
                  >
                    <Upload className="h-4 w-4" /> Auto Top Up
                    {topUpOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </div>

                {topUpOpen && (
                  <div className="mt-4 space-y-3">
                    <textarea
                      className="input font-mono text-xs"
                      rows={5}
                      placeholder={"alice@gmail.com:hunter2\nbob@gmail.com:p@ssw0rd\ncarol@gmail.com,anotherPass123"}
                      value={form.stockText}
                      onChange={(e) => setForm({ ...form, stockText: e.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="btn-ghost cursor-pointer">
                        <Upload className="h-4 w-4" /> Upload .txt / .csv
                        <input
                          ref={stockFileRef}
                          type="file"
                          accept=".txt,.csv,text/plain,text/csv"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleStockFile(f);
                            if (stockFileRef.current) stockFileRef.current.value = "";
                          }}
                        />
                      </label>
                      <span className="text-xs text-fox-muted">
                        {parseAccountStockText(form.stockText).length} account(s) detected
                      </span>
                      {editing ? (
                        <button
                          type="button"
                          onClick={addStockNow}
                          disabled={topUpBusy || parseAccountStockText(form.stockText).length === 0}
                          className="btn-primary ml-auto"
                        >
                          <Plus className="h-4 w-4" /> {topUpBusy ? "Adding..." : "Add to stock"}
                        </button>
                      ) : (
                        <span className="text-xs text-fox-muted/70 ml-auto">
                          Added automatically once you create this account below.
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-fox-muted/60">
                      One account per line: <code>user:pass</code>, <code>user,pass</code>, or <code>user|pass</code> —
                      or paste blocks in the same Username/Email + Password + Notes format used above.
                    </p>
                    {topUpError && (
                      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                        {topUpError}
                      </div>
                    )}

                    {editing && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold text-fox-muted mb-2">
                          Currently in stock {stockLoading ? "(loading…)" : `(${stockItems.filter((s) => s.status === "AVAILABLE").length} available)`}
                        </p>
                        {stockItems.filter((s) => s.status === "AVAILABLE").length === 0 ? (
                          <p className="text-xs text-fox-muted/60">No unsold accounts yet — add some above.</p>
                        ) : (
                          <div className="max-h-48 overflow-y-auto rounded-lg border border-fox-border divide-y divide-fox-border">
                            {stockItems
                              .filter((s) => s.status === "AVAILABLE")
                              .map((s) => (
                                <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-mono">
                                  <span className="truncate">{s.username} : {s.password}</span>
                                  <button
                                    type="button"
                                    onClick={() => deleteStockItem(s.id)}
                                    className="shrink-0 text-red-400 hover:text-red-300"
                                    title="Remove from stock"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))}
                          </div>
                        )}
                        {stockItems.some((s) => s.status === "ASSIGNED") && (
                          <p className="mt-2 text-xs text-fox-muted/60">
                            {stockItems.filter((s) => s.status === "ASSIGNED").length} already sold/delivered (kept for order history, not shown here).
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
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
            <button type="submit" disabled={saving} className="btn-primary">
              <Save className="h-4 w-4" /> {saving ? "Saving..." : editing ? "Save changes" : "Create account"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-fox-muted text-sm">Loading...</div>
      ) : liveAccounts.length === 0 && soldAccounts.length === 0 ? (
        <div className="card p-10 text-center text-fox-muted text-sm">
          No accounts yet — click &quot;Add Account&quot; to create one.
        </div>
      ) : liveAccounts.length === 0 ? (
        <div className="card p-10 text-center text-fox-muted text-sm">
          Everything you&apos;ve listed has sold — click &quot;Add Account&quot; to list more.
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
                {liveAccounts.map((acc) => (
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
                    <td className="px-5 py-3 text-fox-muted">{acc.Category?.name || acc.Game?.name || "General"}</td>
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
                      {isPooled(acc) && (
                        <button onClick={() => openTopUp(acc)} className="text-fox-accent text-xs hover:underline inline-flex items-center gap-1">
                          <Upload className="h-3 w-3" /> Auto Top Up
                        </button>
                      )}
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

      {soldAccounts.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowSold((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-fox-muted hover:text-fox-text"
          >
            {showSold ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Sold ({soldAccounts.length}) — kept for order history, hidden from the shop
          </button>
          {showSold && (
            <div className="card overflow-hidden mt-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-fox-surface text-fox-muted text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-5 py-3">Account</th>
                      <th className="text-left px-5 py-3">Game</th>
                      <th className="text-right px-5 py-3">Price USD</th>
                      <th className="text-right px-5 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-fox-border">
                    {soldAccounts.map((acc) => (
                      <tr key={acc.id} className="hover:bg-fox-surface/50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            {acc.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={acc.imageUrl} alt="" className="h-10 w-14 rounded-lg object-cover border border-fox-border opacity-60" />
                            ) : (
                              <div className="h-10 w-14 rounded-lg bg-fox-bg/60 border border-fox-border" />
                            )}
                            <span className="font-medium text-fox-muted">{acc.title}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-fox-muted">{acc.Category?.name || acc.Game?.name || "General"}</td>
                        <td className="px-5 py-3 text-right font-mono text-fox-muted">${acc.priceUsd.toFixed(2)}</td>
                        <td className="px-5 py-3 text-right space-x-3">
                          <button onClick={() => openEdit(acc)} className="text-fox-accent text-xs hover:underline">View</button>
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
      )}
    </div>
  );
}
