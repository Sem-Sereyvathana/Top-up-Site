"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Download } from "lucide-react";

// Shared gift-card codes card, used by both the single top-up order tracker
// (app/order) and the combined GRP- tracker (app/order/group).
//
// Each pack (e.g. "279 Robux") renders as its own mini-box INSIDE the one
// big codes card — pack header, its codes, a copy button per row — so a
// mixed multi-pack order stays readable instead of one long flat list.
// "Copy all" and download-as-text live in the big card's header.

export interface GiftCodeGroup {
  label: string;
  codes: string[];
}

export default function GiftCodesCard({ groups }: { groups: GiftCodeGroup[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const total = groups.reduce((s, g) => s + g.codes.length, 0);
  const VISIBLE = 5;

  // Groups shown when collapsed: reveal packs one by one until the visible
  // budget is used up (a pack is never split across the fold).
  const collapsedGroups = (() => {
    const out: GiftCodeGroup[] = [];
    let used = 0;
    for (const g of groups) {
      if (used >= VISIBLE) break;
      out.push(g);
      used += g.codes.length;
    }
    return out;
  })();
  const shown = showAll ? groups : collapsedGroups;

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked — the row is selectable anyway */
    }
  }

  const allText = groups
    .map((g) => `${g.label}:\n${g.codes.map((c) => `  ${c}`).join("\n")}`)
    .join("\n\n");

  function download() {
    const blob = new Blob([allText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gift-card-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-fox-border bg-fox-card/40">
      <div className="flex items-center justify-between border-b border-fox-border/70 px-4 py-3">
        <h3 className="font-display text-sm font-bold">Codes</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => copy(allText, "__all__")}
            title="Copy all codes"
            aria-label="Copy all codes"
            className="rounded-md border border-fox-border p-2 text-fox-muted hover:bg-fox-card hover:text-white"
          >
            {copied === "__all__" ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={download}
            title="Download codes"
            aria-label="Download codes"
            className="rounded-md border border-fox-border p-2 text-fox-muted hover:bg-fox-card hover:text-white"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* One mini-box per pack, inside the big card */}
      <div className="space-y-3 p-3 sm:p-4">
        {shown.map((g, gi) => (
          <div key={`${g.label}-${gi}`} className="overflow-hidden rounded-lg border border-fox-border/70 bg-fox-bg/40">
            <div className="flex items-center justify-between border-b border-fox-border/50 px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fox-muted">{g.label}</span>
              <button
                type="button"
                onClick={() => copy(g.codes.join("\n"), `pack-${gi}`)}
                title={`Copy all ${g.label} codes`}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-fox-muted hover:text-white"
              >
                {copied === `pack-${gi}` ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Copy
              </button>
            </div>
            <div className="divide-y divide-fox-border/40">
              {g.codes.map((code, ci) => {
                const key = `${gi}-${ci}`;
                return (
                  <div key={key} className="flex items-center gap-2 px-3 py-2">
                    <code className="min-w-0 flex-1 select-all truncate font-mono text-sm text-fox-text">{code}</code>
                    <button
                      type="button"
                      onClick={() => copy(code, key)}
                      aria-label="Copy code"
                      className="shrink-0 rounded-md border border-fox-border/70 p-1.5 text-fox-muted hover:bg-fox-card hover:text-white"
                    >
                      {copied === key ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {total > VISIBLE && (
        <div className="border-t border-fox-border/70 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="rounded-lg border border-fox-border px-3 py-1.5 text-xs font-medium text-fox-text hover:bg-fox-card"
          >
            {showAll ? "Show fewer codes" : `Show all codes (${total})`}
          </button>
        </div>
      )}

      <p className="border-t border-fox-border/70 px-4 py-2.5 text-[11px] text-fox-muted">
        Keep these codes private. Redeem them on roblox.com/redeem.
      </p>
    </div>
  );
}
