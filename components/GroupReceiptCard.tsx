"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Check, Lock, Send, Store, Gamepad2 } from "lucide-react";
import { toTelegramUrlWithText } from "@/lib/telegramLink";

// ONE independent receipt inside a combined (GRP-) order.
//
// A cart payment is not one merged receipt: each part is its own receipt
// that happens to share a page (and a History entry) with the others. Each
// card therefore carries its own status and updates on its own — the
// account can already say Delivered while a manual item is still Processing.
//
// Used by BOTH /order/group and the History page so the two never drift.
//
// Account credentials are never in the page payload. "Show details" asks the
// server (POST .../items/[itemId]/reveal), which re-checks that the requester
// owns the order and that it is paid before returning anything.

export interface ReceiptPart {
  kind: "item" | "account";
  orderNumber: string;
  title: string;
  detail: string;
  amountUsd: number;
  status: string;
  // Item only: MANUAL = the buyer must message the admin before it can be
  // handed over, so the Telegram button shows while it's PAID/PROCESSING.
  needsCustomerContact?: boolean;
  buyerUsername?: string;
  // Account only: whether there is a login to fetch, and which line to fetch
  // it for (the reveal endpoint is scoped to that order line).
  hasCredentials?: boolean;
  itemId?: string;
}

const STATUS_META: Record<string, { label: string; color: string; desc: string }> = {
  PENDING: {
    label: "Awaiting Payment",
    color: "text-yellow-400 border-yellow-400/40 bg-yellow-400/10",
    desc: "Waiting for your payment",
  },
  PAID: {
    label: "Payment Received",
    color: "text-blue-400 border-blue-400/40 bg-blue-400/10",
    desc: "Paid — being prepared",
  },
  PROCESSING: {
    label: "Processing",
    color: "text-blue-400 border-blue-400/40 bg-blue-400/10",
    desc: "Being delivered",
  },
  DELIVERED: {
    label: "Delivered",
    color: "text-green-400 border-green-400/40 bg-green-400/10",
    desc: "All set",
  },
  FAILED: {
    label: "Failed",
    color: "text-red-400 border-red-400/40 bg-red-400/10",
    desc: "Contact support",
  },
  REFUNDED: {
    label: "Refunded",
    color: "text-fox-muted border-fox-border bg-fox-card",
    desc: "Refunded",
  },
  CANCELLED: {
    label: "Cancelled",
    color: "text-fox-muted border-fox-border bg-fox-card",
    desc: "Cancelled",
  },
};

// Same parsing the single account receipt uses (see app/order/accounts).
function parseCredentials(raw: string) {
  const userMatch = raw.match(/^(?:username\/email|username|email)\s*:\s*(.+)$/im);
  const passMatch = raw.match(/^password\s*:\s*(.+)$/im);
  const notesMatch = raw.match(/^notes\s*:\s*([\s\S]*)$/im);
  if (userMatch || passMatch) {
    return {
      username: userMatch?.[1]?.trim() || "",
      password: passMatch?.[1]?.trim() || "",
      notes: notesMatch?.[1]?.trim() || "",
    };
  }
  return null;
}

function splitBlocks(credentials: string): string[] {
  return credentials.split(/\n-{3,}\n/);
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — nothing to undo */
        }
      }}
      className="inline-flex items-center gap-1 rounded-md bg-black/20 px-2 py-1 text-[10px] font-semibold text-green-200 hover:bg-black/30"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label ?? "Copy"}
    </button>
  );
}

function LoginRows({ credentials }: { credentials: string }) {
  return (
    <div className="space-y-2">
      {splitBlocks(credentials).map((block, i) => {
        const parsed = parseCredentials(block);
        return (
          <div key={i} className="space-y-2">
            {splitBlocks(credentials).length > 1 && (
              <p className="text-[11px] font-semibold text-green-300/90">
                Account {i + 1} of {splitBlocks(credentials).length}
              </p>
            )}
            {parsed ? (
              <>
                <div className="flex items-center justify-between gap-2 rounded-md bg-black/20 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wide text-green-400/70">Username / Email</p>
                    <p className="truncate font-mono text-xs text-green-100">{parsed.username || "—"}</p>
                  </div>
                  <CopyButton value={parsed.username} />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md bg-black/20 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wide text-green-400/70">Password</p>
                    <p className="truncate font-mono text-xs text-green-100">{parsed.password || "—"}</p>
                  </div>
                  <CopyButton value={parsed.password} />
                </div>
                {parsed.notes && (
                  <div className="rounded-md bg-black/20 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-green-400/70">Notes</p>
                    <p className="whitespace-pre-wrap text-xs text-green-100">{parsed.notes}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <pre className="whitespace-pre-wrap font-mono text-xs text-green-100">{block}</pre>
                <CopyButton value={block} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function GroupReceiptCard({
  part,
  supportTelegram,
}: {
  part: ReceiptPart;
  supportTelegram: string | null;
}) {
  const meta = STATUS_META[part.status] ?? STATUS_META.PENDING;
  const Icon = part.kind === "account" ? Store : Gamepad2;

  const [credentials, setCredentials] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The contact button belongs to a MANUAL item, and only while it actually
  // needs the buyer to act: once the order is Delivered there is nothing
  // left to arrange, so the button goes away.
  const showContact =
    part.kind === "item" &&
    !!part.needsCustomerContact &&
    (part.status === "PAID" || part.status === "PROCESSING");

  const telegramHref = showContact
    ? toTelegramUrlWithText(
        supportTelegram,
        `Hi! I just paid for order #${part.orderNumber} (${part.title}) — $${part.amountUsd.toFixed(
          2
        )}. My in-game username is ${part.buyerUsername ?? "—"}. Please help arrange delivery!`
      )
    : null;

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/game-account-orders/${encodeURIComponent(part.orderNumber)}/items/${encodeURIComponent(
          part.itemId ?? ""
        )}/reveal`,
        { method: "POST", cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load the login details.");
      setCredentials(data.credentials);
    } catch (err: any) {
      setError(err.message || "Couldn't load the login details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-fox-border p-4">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fox-muted" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{part.title}</p>
            <p className="truncate text-[11px] text-fox-muted">{part.detail}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.color}`}>
            {meta.label}
          </div>
          <p className="mt-0.5 text-xs font-bold text-fox-primary">${part.amountUsd.toFixed(2)}</p>
        </div>
      </div>

      <div className="space-y-2 p-4">
        <p className="text-[11px] text-fox-muted">{meta.desc}</p>

        {part.kind === "item" && (
          <div className="flex justify-between text-xs">
            <span className="text-fox-muted">Username</span>
            <span className="font-mono">{part.buyerUsername ?? "—"}</span>
          </div>
        )}

        {showContact && (
          <a
            href={telegramHref ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#229ED9]/40 bg-[#229ED9]/10 py-2.5 text-sm font-medium text-[#229ED9] transition-colors hover:bg-[#229ED9]/20"
          >
            <Send className="h-4 w-4" />
            Contact admin on Telegram
          </a>
        )}

        {part.kind === "account" && part.hasCredentials && (
          <div className="space-y-2 rounded-lg border border-green-400/40 bg-green-400/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-green-300">Your account login</p>
              {credentials ? (
                <button
                  type="button"
                  onClick={() => setCredentials(null)}
                  className="rounded-lg border border-green-400/40 px-2.5 py-1 text-[10px] font-semibold text-green-200 hover:bg-green-400/10"
                >
                  Hide details
                </button>
              ) : (
                <button
                  type="button"
                  onClick={reveal}
                  disabled={loading}
                  className="inline-flex items-center gap-1 rounded-lg border border-green-400/40 px-2.5 py-1 text-[10px] font-semibold text-green-200 hover:bg-green-400/10 disabled:opacity-50"
                >
                  <Lock className="h-3 w-3" />
                  {loading ? "Loading…" : "Show details"}
                </button>
              )}
            </div>

            {credentials ? (
              <LoginRows credentials={credentials} />
            ) : (
              <div className="space-y-1.5">
                <div className="rounded-md bg-black/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-green-400/70">Username / Email</p>
                  <p className="font-mono text-xs text-green-100">••••••••••••</p>
                </div>
                <div className="rounded-md bg-black/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-green-400/70">Password</p>
                  <p className="font-mono text-xs text-green-100">••••••••••••</p>
                </div>
                {error && <p className="text-[11px] text-red-300">{error}</p>}
              </div>
            )}
          </div>
        )}

        {part.status === "DELIVERED" && part.kind === "account" && (
          <p className="flex items-center gap-1.5 text-[11px] text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Login delivered — save it now.
          </p>
        )}
      </div>
    </div>
  );
}
