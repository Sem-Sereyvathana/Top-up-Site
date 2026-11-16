"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Save } from "lucide-react";

interface RateLimits {
  min: number;
  max: number;
}

interface PricingRow {
  id: string;
  name: string;
  amount: number;
  bonus: number;
  normalPriceUsd: number;
  resellerPriceUsd: number | null;
  costUsd: number | null;
  normalProfitUsd: number | null;
  resellerProfitUsd: number | null;
  warning: string | null;
}

interface PricingData {
  rates: {
    resellerRobuxSendRate: number | null;
    costRobuxSendRate: number | null;
    resellerQuickLoginRate: number | null;
    costQuickLoginRate: number | null;
  };
  limits: {
    resellerRobuxSend: RateLimits;
    costRobuxSend: RateLimits;
    resellerQuickLogin: RateLimits;
    costQuickLogin: RateLimits;
  };
  robuxSend: PricingRow[];
  quickLogin: PricingRow[];
}

const fmt = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "—" : `$${v.toFixed(digits)}`;

// Admin: Reseller Rates.
//
// EXACTLY two sections — Robux Send and Quick Log-In. These are the only
// products with an admin-set cost (FazerCards doesn't supply them); every
// other game is intentionally absent: resellers there pay the normal price
// and their cost comes from FazerCards at dispatch. Normal prices are shown
// read-only and are never changed from this page.
export default function AdminPricingPage() {
  const [data, setData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Editable rate inputs (strings so the box can be empty while typing).
  const [rsReseller, setRsReseller] = useState("");
  const [rsCost, setRsCost] = useState("");
  const [qlReseller, setQlReseller] = useState("");
  const [qlCost, setQlCost] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pricing");
      const d: PricingData = await res.json();
      setData(d);
      setRsReseller(d.rates.resellerRobuxSendRate?.toString() ?? "");
      setRsCost(d.rates.costRobuxSendRate?.toString() ?? "");
      setQlReseller(d.rates.resellerQuickLoginRate?.toString() ?? "");
      setQlCost(d.rates.costQuickLoginRate?.toString() ?? "");
    } catch {
      setMessage({ ok: false, text: "Could not load rates" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveRates(section: "robuxSend" | "quickLogin") {
    setSaving(true);
    setMessage(null);
    try {
      const body =
        section === "robuxSend"
          ? {
              resellerRobuxSendRate: rsReseller.trim() === "" ? null : parseFloat(rsReseller),
              costRobuxSendRate: rsCost.trim() === "" ? null : parseFloat(rsCost),
            }
          : {
              resellerQuickLoginRate: qlReseller.trim() === "" ? null : parseFloat(qlReseller),
              costQuickLoginRate: qlCost.trim() === "" ? null : parseFloat(qlCost),
            };
      // Client-side guard so a typo doesn't even leave the page — the API
      // clamps + validates again regardless.
      for (const [k, v] of Object.entries(body)) {
        if (v === null) continue;
        const limits =
          k === "resellerRobuxSendRate"
            ? data!.limits.resellerRobuxSend
            : k === "costRobuxSendRate"
              ? data!.limits.costRobuxSend
              : k === "resellerQuickLoginRate"
                ? data!.limits.resellerQuickLogin
                : data!.limits.costQuickLogin;
        if (!Number.isFinite(v as number) || (v as number) < limits.min || (v as number) > limits.max) {
          throw new Error(`${k} must be between ${limits.min} and ${limits.max}`);
        }
      }
      const res = await fetch("/api/admin/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      setMessage({ ok: true, text: "Rates saved — prices update immediately for new orders." });
      await load();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  const section = (
    title: string,
    subtitle: string,
    rows: PricingRow[],
    inputs: React.ReactNode,
    saveLabel: string,
    onSave: () => void,
    keyPrefix: string
  ) => (
    <div className="card p-5 mb-6">
      <h2 className="font-display font-bold mb-1">{title}</h2>
      <p className="text-fox-muted text-xs mb-4">{subtitle}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end mb-5">{inputs}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-fox-border text-fox-muted text-left">
              <th className="py-2 px-2 font-medium">Package</th>
              <th className="py-2 px-2 font-medium">Normal price</th>
              <th className="py-2 px-2 font-medium">Reseller price</th>
              <th className="py-2 px-2 font-medium">My cost</th>
              <th className="py-2 px-2 font-medium">Profit (normal)</th>
              <th className="py-2 px-2 font-medium">Profit (reseller)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={`${keyPrefix}-${p.id}`} className="border-b border-fox-border/50">
                <td className="py-2 px-2 font-medium">
                  {p.amount.toLocaleString()}
                  {p.bonus > 0 ? ` +${p.bonus}` : ""} {keyPrefix === "ql" ? "R" : "Robux"}
                  {p.warning && (
                    <span
                      className="ml-2 inline-flex items-center gap-1 text-red-400 text-xs"
                      title={p.warning}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      below cost
                    </span>
                  )}
                </td>
                <td className="py-2 px-2 text-fox-muted">{fmt(p.normalPriceUsd)}</td>
                <td className="py-2 px-2">{fmt(p.resellerPriceUsd)}</td>
                <td className="py-2 px-2">{fmt(p.costUsd, 4)}</td>
                <td className={`py-2 px-2 ${p.normalProfitUsd !== null && p.normalProfitUsd < 0 ? "text-red-400" : "text-green-400"}`}>
                  {fmt(p.normalProfitUsd, 4)}
                </td>
                <td className={`py-2 px-2 ${p.resellerProfitUsd !== null && p.resellerProfitUsd < 0 ? "text-red-400" : "text-green-400"}`}>
                  {fmt(p.resellerProfitUsd, 4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fox-muted mt-3">
        Read-only preview — derived from the rates above. Normal prices are set on the Products
        page and are never changed here. Saving affects new orders only.
      </p>
      <div className="mt-4">
        <button onClick={onSave} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saveLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Reseller Rates</h1>
          <p className="text-fox-muted text-sm">
            Robux Send &amp; Quick Log-In only — everything else prices itself from FazerCards.
          </p>
        </div>
        <button onClick={load} className="btn-ghost text-sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Reload
        </button>
      </div>

      {message && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            message.ok
              ? "border-green-500/40 bg-green-500/10 text-green-300"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {loading || !data ? (
        <div className="text-center py-12 text-fox-muted">Loading…</div>
      ) : (
        <>
          {section(
            "🚀 Robux Send",
            "Reseller rate and your cost, in $ per 100 Robux. Reseller price of a package = Robux ÷ 100 × rate (capped at the normal price). Cost = Robux ÷ 100 × your cost.",
            data.robuxSend,
            <>
              <div>
                <label className="label">
                  Reseller rate ($ / 100 Robux) — {data.limits.resellerRobuxSend.min}–{data.limits.resellerRobuxSend.max}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={data.limits.resellerRobuxSend.min}
                  max={data.limits.resellerRobuxSend.max}
                  value={rsReseller}
                  onChange={(e) => setRsReseller(e.target.value)}
                  className="input"
                  placeholder="0.85"
                />
              </div>
              <div>
                <label className="label">
                  My cost ($ / 100 Robux) — {data.limits.costRobuxSend.min}–{data.limits.costRobuxSend.max}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={data.limits.costRobuxSend.min}
                  max={data.limits.costRobuxSend.max}
                  value={rsCost}
                  onChange={(e) => setRsCost(e.target.value)}
                  className="input"
                  placeholder="0.70"
                />
              </div>
            </>,
            "Save Robux Send rates",
            () => saveRates("robuxSend"),
            "rs"
          )}

          {section(
            "⚡ Quick Log-In",
            "Reseller rate = multiplier on face value (e.g. 0.86). My cost rate = cents per $1 of face value (e.g. 78.12 → $0.7812 per $1) — you work this out yourself, no formula. Face values: 80R=$1 … 10000R=$100.",
            data.quickLogin,
            <>
              <div>
                <label className="label">
                  Reseller rate (× face value) — {data.limits.resellerQuickLogin.min}–{data.limits.resellerQuickLogin.max}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={data.limits.resellerQuickLogin.min}
                  max={data.limits.resellerQuickLogin.max}
                  value={qlReseller}
                  onChange={(e) => setQlReseller(e.target.value)}
                  className="input"
                  placeholder="0.86"
                />
              </div>
              <div>
                <label className="label">
                  My cost rate (¢ per $1) — {data.limits.costQuickLogin.min}–{data.limits.costQuickLogin.max}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={data.limits.costQuickLogin.min}
                  max={data.limits.costQuickLogin.max}
                  value={qlCost}
                  onChange={(e) => setQlCost(e.target.value)}
                  className="input"
                  placeholder="78.12"
                />
              </div>
            </>,
            "Save Quick Log-In rates",
            () => saveRates("quickLogin"),
            "ql"
          )}
        </>
      )}
    </div>
  );
}
