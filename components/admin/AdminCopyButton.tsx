"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

// Small "copy to clipboard" button for the admin order queues. Used where the
// admin needs one value to hand (e.g. the buyer's in-game username for an
// item they deliver themselves).
export default function AdminCopyButton({
  value,
  label = "Copy",
  title,
  className = "",
}: {
  value: string;
  label?: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing to undo */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={title ?? `Copy ${value}`}
      className={`inline-flex items-center gap-1 rounded-lg border border-fox-border px-2.5 py-1.5 text-[11px] font-semibold text-fox-muted transition-colors hover:border-fox-primary/60 hover:text-fox-primary ${className}`}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}
