"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Copy, AlertCircle } from "lucide-react";

interface Status {
  enabled: boolean;
}

// Self-contained "app authentication" (TOTP) enroll/disable card for the
// Settings page. Deliberately its own component with its own state/fetches
// — this is per-admin-account security, not part of the site-wide Settings
// form/save button above it.
export default function TwoFactorSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<"idle" | "enrolling" | "backup-codes">("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/auth/totp/status")
      .then((r) => r.json())
      .then((d: Status) => setEnabled(!!d.enabled))
      .catch(() => setEnabled(false));
  }, []);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/auth/totp/setup");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start enrollment");
      setQrDataUrl(data.qrDataUrl);
      setSecret(data.secret);
      setStep("enrolling");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/auth/totp/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Incorrect code");
      setBackupCodes(data.backupCodes);
      setStep("backup-codes");
      setEnabled(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/auth/totp/setup", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't disable");
      setEnabled(false);
      setShowDisable(false);
      setDisablePassword("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function finishSetup() {
    setStep("idle");
    setQrDataUrl(null);
    setSecret(null);
    setCode("");
    setBackupCodes([]);
  }

  return (
    <div className="card p-6 max-w-2xl mt-6">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-5 w-5 text-fox-primary" />
        <h2 className="font-semibold">App Authentication (2FA)</h2>
      </div>
      <p className="text-xs text-fox-muted mb-4">
        Require a code from an authenticator app (Google Authenticator, Authy, etc.) after your password, for your own admin login.
      </p>

      {enabled === null ? (
        <p className="text-sm text-fox-muted">Loading...</p>
      ) : step === "backup-codes" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Save these backup codes now — they won&apos;t be shown again. Each one works once, if you lose your device.
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm">
            {backupCodes.map((c) => (
              <div key={c} className="rounded-lg border border-fox-border bg-fox-card/60 px-3 py-2 text-center">
                {c}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="text-sm text-fox-muted hover:text-fox-text"
            onClick={() => {
              navigator.clipboard.writeText(backupCodes.join("\n"));
            }}
          >
            <span className="inline-flex items-center gap-1">
              <Copy className="h-3.5 w-3.5" /> Copy all
            </span>
          </button>
          <button type="button" onClick={finishSetup} className="btn-primary w-full">
            Done
          </button>
        </div>
      ) : step === "enrolling" ? (
        <form onSubmit={confirmEnroll} className="space-y-4">
          <p className="text-sm text-fox-muted">Scan this with your authenticator app, then enter the code it shows.</p>
          {qrDataUrl && (
            <img src={qrDataUrl} alt="Scan with your authenticator app" className="rounded-lg border border-fox-border bg-white p-2 mx-auto" width={200} height={200} />
          )}
          {secret && (
            <p className="text-xs text-fox-muted text-center">
              Can&apos;t scan? Enter manually: <span className="font-mono text-fox-text">{secret}</span>
            </p>
          )}
          <div>
            <label className="label">6-digit code</label>
            <input
              className="input tracking-[0.3em] text-center font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary flex-1">
              {busy ? "Verifying..." : "Enable"}
            </button>
            <button type="button" onClick={finishSetup} className="btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      ) : enabled ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-400">
            <ShieldCheck className="h-4 w-4" /> App authentication is enabled.
          </div>
          {!showDisable ? (
            <button type="button" onClick={() => setShowDisable(true)} className="text-sm text-red-400 hover:underline">
              Disable app authentication
            </button>
          ) : (
            <form onSubmit={disable} className="space-y-3 rounded-lg border border-fox-border p-4">
              <label className="label">Confirm your password to disable</label>
              <input
                type="password"
                className="input"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                required
                autoFocus
              />
              {error && <p className="text-sm text-red-300">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="btn-primary flex-1">
                  {busy ? "Disabling..." : "Confirm disable"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setShowDisable(false);
                    setDisablePassword("");
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button type="button" onClick={startEnroll} disabled={busy} className="btn-primary">
            {busy ? "Starting..." : "Enable app authentication"}
          </button>
        </div>
      )}
    </div>
  );
}
