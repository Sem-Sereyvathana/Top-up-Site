"use client";

import MarketplaceOrderTracker from "@/components/MarketplaceOrderTracker";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

// Accounts are stocked with a structured "Username/Email: ...\nPassword:
// ...\nNotes: ..." string (set from the admin's Accounts form). Parsing it
// back out lets this receipt show clearly labeled Username/Email + Password
// rows — the thing that makes an Account order's receipt/history view look
// different from a Top-up or Game Item order. Falls back to the raw text
// for any older account stocked before this format existed.
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

function CredentialRow({ label, value, field, copiedField, onCopy }: { label: string; value: string; field: string; copiedField: string | null; onCopy: (field: string, value: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-black/20 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-green-400/70">{label}</p>
        <p className="truncate font-mono text-xs text-green-100">{value || "—"}</p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(field, value)}
        className="shrink-0 text-green-300 hover:text-green-100"
      >
        {copiedField === field ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

// A multi-stock account's line can hand over more than one distinct login
// (one per unit purchased — see lib/gameAccountFulfillment.ts), joined by
// this separator so the receipt still comes back as a single string.
function splitCredentialBlocks(credentials: string): string[] {
  return credentials.split(/\n-{3,}\n/);
}

function SingleCredential({
  label,
  credentials,
  copiedPrefix,
  copiedField,
  onCopy,
}: {
  label: string | null;
  credentials: string;
  copiedPrefix: string;
  copiedField: string | null;
  onCopy: (field: string, value: string) => void;
}) {
  const parsed = parseCredentials(credentials);
  return (
    <div className="space-y-2">
      {label && <p className="text-xs font-semibold text-green-300/90">{label}</p>}
      {parsed ? (
        <div className="space-y-2">
          <CredentialRow
            label="Username / Email"
            value={parsed.username}
            field={`${copiedPrefix}-username`}
            copiedField={copiedField}
            onCopy={onCopy}
          />
          <CredentialRow
            label="Password"
            value={parsed.password}
            field={`${copiedPrefix}-password`}
            copiedField={copiedField}
            onCopy={onCopy}
          />
          {parsed.notes && (
            <div className="rounded-md bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-green-400/70">Notes</p>
              <p className="whitespace-pre-wrap text-xs text-green-100">{parsed.notes}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <pre className="whitespace-pre-wrap font-mono text-xs text-green-100">{credentials}</pre>
          <button
            type="button"
            onClick={() => onCopy(`${copiedPrefix}-raw`, credentials)}
            className="shrink-0 text-green-300 hover:text-green-100"
          >
            {copiedField === `${copiedPrefix}-raw` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );
}

// Receipt for one account line.
//
// The login is MASKED by default and is not in the page at all until the
// buyer presses "Show details" — that button calls the server (which
// re-checks that the requester owns the order and that it is paid) and only
// then does the password reach the browser. Hiding a password that was
// already in the payload would protect nothing.
function CredentialsBox({
  title,
  orderNumber,
  itemId,
}: {
  title: string;
  orderNumber: string;
  itemId: string;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocks = credentials ? splitCredentialBlocks(credentials) : [];

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/game-account-orders/${encodeURIComponent(orderNumber)}/items/${encodeURIComponent(itemId)}/reveal`,
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

  function hide() {
    setCredentials(null);
    setCopiedField(null);
  }

  async function copy(field: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }

  return (
    <div className="rounded-lg border border-green-400/40 bg-green-400/10 p-4 text-sm text-green-200">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-semibold text-green-300">Your account login — {title}</p>
        {credentials ? (
          <button
            type="button"
            onClick={hide}
            className="shrink-0 rounded-lg border border-green-400/40 px-3 py-1 text-xs font-semibold text-green-200 hover:bg-green-400/10"
          >
            Hide details
          </button>
        ) : (
          <button
            type="button"
            onClick={reveal}
            disabled={loading}
            className="shrink-0 rounded-lg border border-green-400/40 px-3 py-1 text-xs font-semibold text-green-200 hover:bg-green-400/10 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Show details"}
          </button>
        )}
      </div>

      {credentials ? (
        <div className="space-y-4">
          {blocks.map((block, i) => (
            <SingleCredential
              key={i}
              label={blocks.length > 1 ? `Account ${i + 1} of ${blocks.length}` : null}
              credentials={block}
              copiedPrefix={`b${i}`}
              copiedField={copiedField}
              onCopy={copy}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-md bg-black/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-green-400/70">Username / Email</p>
            <p className="font-mono text-xs text-green-100">••••••••••••</p>
          </div>
          <div className="rounded-md bg-black/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-green-400/70">Password</p>
            <p className="font-mono text-xs text-green-100">••••••••••••</p>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}

function AccountsPolicy() {
  return (
    <>
      <p className="font-semibold text-fox-text">Delivery &amp; Refund Policy</p>
      <p>
        Paid orders are delivered automatically when the account is in stock, or shortly after via Telegram
        for manual orders. Save your login details as soon as you receive them — for security, each account
        is handed over once and access details may be changed afterward.
      </p>
      <p>
        Refunds can only be issued before an account has been delivered. Once login credentials have been
        sent, the sale is final. If something looks wrong with the account you received, contact support on
        Telegram right away with your order number.
      </p>
    </>
  );
}

export default function AccountsOrderTrackerPage() {
  return (
    <MarketplaceOrderTracker
      apiBase="/api/game-account-orders"
      hideTimeline
      policyContent={<AccountsPolicy />}
      autoRedirectManualPaid
      buildTelegramMessage={(order: any) => {
        const titles = order.items
          .map((it: any) => (it.quantity > 1 ? `${it.title} ×${it.quantity}` : it.title))
          .join(", ");
        return `Hi! I just paid for order #${order.orderNumber} (${titles}) — $${order.amountUsd.toFixed(
          2
        )}. Please help arrange the account handover!`;
      }}
      renderDetails={(order: any) => (
        <div className="flex justify-between">
          <span className="text-fox-muted">Accounts</span>
          <span className="text-right text-xs font-medium space-y-0.5">
            {order.items.map((it: any, i: number) => (
              <div key={i}>{it.quantity > 1 ? `${it.title} ×${it.quantity}` : it.title}</div>
            ))}
          </span>
        </div>
      )}
      renderPostPaidExtra={(order: any) => (
        <>
          {order.items
            .filter((it: any) => it.hasCredentials)
            .map((it: any) => (
              <CredentialsBox
                key={it.id}
                title={it.quantity > 1 ? `${it.title} ×${it.quantity}` : it.title}
                orderNumber={order.orderNumber}
                itemId={it.id}
              />
            ))}
          {(order.status === "PAID" || order.status === "DELIVERED") &&
            order.items.every((it: any) => !it.hasCredentials) && (
              <div className="rounded-lg border border-blue-400/40 bg-blue-400/10 p-4 text-sm text-blue-300">
                Payment received — we&apos;re preparing your login details now. Contact support on Telegram
                if they don&apos;t appear.
              </div>
            )}
        </>
      )}
    />
  );
}
