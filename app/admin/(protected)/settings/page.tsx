"use client";

import { useEffect, useState } from "react";
import TwoFactorSettings from "@/components/admin/TwoFactorSettings";

export default function AdminSettingsPage() {
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then(setForm);
  }, []);

  async function uploadLogo(file: File) {
    setLogoUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      setForm((f: any) => ({ ...f, logoUrl: data.url }));
    }
    setLogoUploading(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteName: form.siteName,
        logoUrl: form.logoUrl || null,
        exchangeRate: Number(form.exchangeRate),
        supportTelegram: form.supportTelegram,
        supportEmail: form.supportEmail,
        maintenanceMode: form.maintenanceMode,
        maintenanceMessage: form.maintenanceMessage || null,
        announcement: form.announcement || null,
        announcementTone: form.announcementTone || "info",
        telegramBotToken: form.telegramBotToken || null,
        telegramChatId: form.telegramChatId || null,
        pointsPerUsd: Number(form.pointsPerUsd),
        pointsRedeemRate: Number(form.pointsRedeemRate),
        minRedeemPoints: Number(form.minRedeemPoints),
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!form) return <div className="p-8 text-fox-muted">Loading...</div>;

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="font-display text-3xl font-bold mb-2">Settings</h1>
      <p className="text-fox-muted mb-6">Site-wide configuration.</p>

      <form onSubmit={save} className="card p-6 space-y-5">
        <div>
          <label className="label">Site Name</label>
          <input className="input" value={form.siteName || ""} onChange={(e) => setForm({ ...form, siteName: e.target.value })} />
        </div>

        <div>
          <label className="label">Site Logo</label>
          <div className="flex items-center gap-4">
            {form.logoUrl ? (
              <img src={form.logoUrl} alt="Logo" className="h-12 w-12 rounded-lg object-contain bg-fox-surface border border-fox-border" />
            ) : (
              <div className="h-12 w-12 rounded-lg border border-dashed border-fox-border flex items-center justify-center text-[10px] text-fox-muted text-center">
                No logo
              </div>
            )}
            <label className="btn-ghost cursor-pointer">
              {logoUploading ? "Uploading..." : form.logoUrl ? "Replace" : "Upload"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
              />
            </label>
            {form.logoUrl && (
              <button
                type="button"
                className="text-xs text-fox-muted hover:text-red-400"
                onClick={() => setForm({ ...form, logoUrl: null })}
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-fox-muted mt-1">Shown in the header in place of the default icon. Leave empty to use the default.</p>
        </div>

        <div>
          <label className="label">Exchange Rate (KHR per 1 USD)</label>
          <input className="input" type="number" value={form.exchangeRate || 4100} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} />
          <p className="text-xs text-fox-muted mt-1">Used to show KHR equivalents alongside USD prices.</p>
        </div>

        <div>
          <label className="label">Support Telegram Handle</label>
          <input className="input" value={form.supportTelegram || ""} onChange={(e) => setForm({ ...form, supportTelegram: e.target.value })} placeholder="@yourhandle" />
        </div>

        <div>
          <label className="label">Support Email</label>
          <input className="input" type="email" value={form.supportEmail || ""} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} />
        </div>

        <div>
          <label className="label">Site-wide Announcement (optional)</label>
          <textarea
            className="input"
            rows={2}
            value={form.announcement || ""}
            onChange={(e) => setForm({ ...form, announcement: e.target.value })}
            placeholder="e.g. Special 10% bonus on Genshin top-ups this weekend!"
          />
          <div className="mt-2 flex gap-2">
            {(["info", "warning", "promo"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, announcementTone: t })}
                className={`text-xs px-3 py-1 rounded-full border ${
                  (form.announcementTone || "info") === t
                    ? "border-fox-primary bg-fox-primary/10 text-fox-primary"
                    : "border-fox-border text-fox-muted"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 p-4 rounded-lg border border-fox-border bg-fox-surface">
          <input
            type="checkbox"
            checked={form.maintenanceMode}
            onChange={(e) => setForm({ ...form, maintenanceMode: e.target.checked })}
          />
          <div className="flex-1">
            <div className="font-medium">Maintenance Mode</div>
            <div className="text-xs text-fox-muted">Blocks all new orders. Existing orders still process.</div>
          </div>
        </label>

        {form.maintenanceMode && (
          <div>
            <label className="label">Maintenance message (shown to customers)</label>
            <input
              className="input"
              value={form.maintenanceMessage || ""}
              onChange={(e) => setForm({ ...form, maintenanceMessage: e.target.value })}
              placeholder="We'll be back in 30 minutes — scheduled maintenance."
            />
          </div>
        )}

        <div className="pt-4 border-t border-fox-border">
          <h2 className="font-semibold mb-1">Telegram Notifications</h2>
          <p className="text-xs text-fox-muted mb-3">Get a message when an order is paid or delivered. Leave empty to disable.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Bot token</label>
              <input
                className="input font-mono text-xs"
                value={form.telegramBotToken || ""}
                onChange={(e) => setForm({ ...form, telegramBotToken: e.target.value })}
                placeholder="123456:ABC-DEF..."
              />
            </div>
            <div>
              <label className="label">Chat ID</label>
              <input
                className="input font-mono text-xs"
                value={form.telegramChatId || ""}
                onChange={(e) => setForm({ ...form, telegramChatId: e.target.value })}
                placeholder="-1001234567890"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-fox-border">
          <h2 className="font-semibold mb-1">Loyalty Points</h2>
          <p className="text-xs text-fox-muted mb-3">Controls how customers earn and redeem points. Guest checkout is unaffected.</p>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Points per $1 paid</label>
              <input
                className="input"
                type="number"
                step="0.1"
                min="0"
                value={form.pointsPerUsd ?? 1}
                onChange={(e) => setForm({ ...form, pointsPerUsd: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Points per $1 discount</label>
              <input
                className="input"
                type="number"
                step="1"
                min="1"
                value={form.pointsRedeemRate ?? 100}
                onChange={(e) => setForm({ ...form, pointsRedeemRate: e.target.value })}
              />
              <p className="text-xs text-fox-muted mt-1">e.g. 100 means 100 pts = $1 off.</p>
            </div>
            <div>
              <label className="label">Minimum points to redeem</label>
              <input
                className="input"
                type="number"
                step="1"
                min="0"
                value={form.minRedeemPoints ?? 100}
                onChange={(e) => setForm({ ...form, minRedeemPoints: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : "Save Settings"}
          </button>
          {saved && <span className="text-sm text-green-400">✓ Saved</span>}
        </div>
      </form>

      <TwoFactorSettings />
    </div>
  );
}
