"use client";

import MarketplaceOrderTracker from "@/components/MarketplaceOrderTracker";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

function CredentialsBox({ credentials }: { credentials: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-green-400/40 bg-green-400/10 p-4 text-sm text-green-200">
      <p className="mb-2 font-semibold text-green-300">Your account login</p>
      <div className="flex items-start justify-between gap-3">
        <pre className="whitespace-pre-wrap font-mono text-xs text-green-100">{credentials}</pre>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(credentials);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 text-green-300 hover:text-green-100"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function AccountsOrderTrackerPage() {
  return (
    <MarketplaceOrderTracker
      apiBase="/api/game-account-orders"
      placeholder="AC-XXXXXX"
      renderDetails={(order: any) => (
        <div className="flex justify-between">
          <span className="text-fox-muted">Accounts</span>
          <span className="text-right text-xs font-medium space-y-0.5">
            {order.items.map((it: any, i: number) => (
              <div key={i}>{it.title}</div>
            ))}
          </span>
        </div>
      )}
      renderPostPaidExtra={(order: any) => (
        <>
          {order.deliveryMode === "DIRECT" &&
            order.items
              .filter((it: any) => it.credentials)
              .map((it: any, i: number) => <CredentialsBox key={i} credentials={`${it.title}\n${it.credentials}`} />)}
          {order.deliveryMode === "DIRECT" && order.items.every((it: any) => !it.credentials) && order.status === "PAID" && (
            <div className="rounded-lg border border-blue-400/40 bg-blue-400/10 p-4 text-sm text-blue-300">
              Payment received — we're preparing your login details now.
            </div>
          )}
        </>
      )}
    />
  );
}
