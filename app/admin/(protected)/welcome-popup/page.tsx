"use client";

import { useEffect, useState } from "react";
import { Save, X, Image as ImageIcon } from "lucide-react";

interface PopupForm {
  enabled: boolean;
  imageUrl: string;
  title: string;
  body: string;
  bullets: string;
  telegramUrl: string;
  buttonLabel: string;
  closeLabel: string;
  reshow: boolean;
}

const empty: PopupForm = {
  enabled: false,
  imageUrl: "",
  title: "",
  body: "",
  bullets: "",
  telegramUrl: "",
  buttonLabel: "Join Telegram",
  closeLabel: "Close",
  reshow: false,
};

export default function WelcomePopupAdminPage() {
  const [form, setForm] = useState<PopupForm>(empty);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/popup");
        if (!res.ok) throw new Error("load failed");
        const p = await res.json();
        setForm({
          enabled: !!p.enabled,
          imageUrl: p.imageUrl ?? "",
          title: p.title ?? "",
          body: p.body ?? "",
          bullets: p.bullets ?? "",
          telegramUrl: p.telegramUrl ?? "",
          buttonLabel: p.buttonLabel || "Join Telegram",
          closeLabel: p.closeLabel || "Close",
          reshow: false,
        });
      } catch {
        setLoadError(
          "Couldn't load the popup settings. If this is the first time, run `npx prisma db push` so the WelcomePopup table exists, then reload."
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error ||
            (res.status === 401
              ? "You're logged out — sign in again."
              : "Upload failed. Check the CLOUDINARY_* values in .env.")
        );
      }
      setForm((f) => ({ ...f, imageUrl: data.url }));
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/admin/popup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          imageUrl: form.imageUrl || null,
          body: form.body || null,
          bullets: form.bullets || null,
          telegramUrl: form.telegramUrl || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      setForm((f) => ({ ...f, reshow: false }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-fox-muted text-sm">Loading...</div>;

  if (loadError) {
    return (
      <div className="p-4 sm:p-8">
        <div className="card p-5 text-sm text-red-400">{loadError}</div>
      </div>
    );
  }

  const nothingToShow = !form.title.trim() && !form.body.trim() && !form.imageUrl;

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl sm:text-3xl font-bold">Welcome Popup</h1>
        <p className="text-fox-muted text-sm">
          Shown once to each visitor on the first page they open. It doesn&apos;t appear on checkout,
          order, login or admin pages.
        </p>
      </div>

      <div className="card p-5 space-y-5">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          <span className="text-sm font-medium">Show the popup to visitors</span>
        </label>
        {form.enabled && nothingToShow && (
          <p className="text-xs text-yellow-400">
            Add a title, text or image first — an empty popup is never shown.
          </p>
        )}

        <div>
          <label className="label">Image</label>
          <div className="flex items-center gap-3">
            <input
              type="text"
              className="input flex-1"
              placeholder="https://... (or use Upload)"
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
            {form.imageUrl && (
              <button
                type="button"
                onClick={() => setForm({ ...form, imageUrl: "" })}
                className="text-fox-muted hover:text-red-400"
                title="Remove image"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-fox-muted">Wide banner images work best (about 3:1, e.g. 1200×400).</p>
          {form.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="mt-3 max-h-40 rounded-lg border border-fox-border object-cover"
            />
          )}
        </div>

        <div>
          <label className="label">Title</label>
          <input
            className="input"
            value={form.title}
            maxLength={200}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        <div>
          <label className="label">Text</label>
          <textarea
            className="input min-h-[90px]"
            value={form.body}
            maxLength={2000}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </div>

        <div>
          <label className="label">Checklist</label>
          <textarea
            className="input min-h-[110px]"
            value={form.bullets}
            maxLength={2000}
            onChange={(e) => setForm({ ...form, bullets: e.target.value })}
            placeholder={"One item per line, e.g.\nSpecial discounts\nNew products"}
          />
          <p className="mt-1 text-xs text-fox-muted">Each line becomes a ✓ item. Leave empty for none.</p>
        </div>

        <div>
          <label className="label">Telegram link</label>
          <input
            className="input"
            value={form.telegramUrl}
            onChange={(e) => setForm({ ...form, telegramUrl: e.target.value })}
            placeholder="https://t.me/yourchannel"
          />
          <p className="mt-1 text-xs text-fox-muted">
            Must start with https://. Leave empty to hide the Telegram button.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Telegram button text</label>
            <input
              className="input"
              value={form.buttonLabel}
              maxLength={60}
              onChange={(e) => setForm({ ...form, buttonLabel: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Close button text</label>
            <input
              className="input"
              value={form.closeLabel}
              maxLength={60}
              onChange={(e) => setForm({ ...form, closeLabel: e.target.value })}
            />
          </div>
        </div>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.reshow}
            onChange={(e) => setForm({ ...form, reshow: e.target.checked })}
          />
          <span className="text-sm">
            Show again to everyone
            <span className="block text-xs text-fox-muted">
              Tick this when you save a new promotion, so visitors who already closed the old popup
              see it once more.
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || uploading || !form.buttonLabel.trim() || !form.closeLabel.trim()}
            className="btn-primary"
          >
            <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save changes"}
          </button>
          {saved && <span className="text-sm text-green-400">✓ Saved</span>}
        </div>
      </div>
    </div>
  );
}
