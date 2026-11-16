"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search, X, Loader2 } from "lucide-react";

interface Result {
  kind: "game" | "item" | "account";
  id: string;
  name: string;
  sub: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  href: string;
}

const KIND_LABEL: Record<Result["kind"], string> = {
  game: "Game",
  item: "Item",
  account: "Account",
};

// Header search across games, Game Items and Accounts (/api/search).
//
// One variant for every screen size (mobile used to get a separate
// full-width bar under the brand row — it looked nothing like desktop and
// squeezed the header): a round icon button that opens the same floating
// panel everywhere. The panel anchors right on desktop; on phones it
// stretches to the header's inner width.
export default function HeaderSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const runSearch = useCallback(async (term: string) => {
    const value = term.trim();
    if (value.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`, { cache: "no-store" });
      const data = await res.json();
      setResults([...(data.games ?? []), ...(data.items ?? []), ...(data.accounts ?? [])]);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => runSearch(q), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, runSearch]);

  function goToResults() {
    const term = q.trim();
    if (!term) return;
    setOpen(false);
    inputRef.current?.blur();
    router.push(`/search?q=${encodeURIComponent(term)}`);
  }

  function pick(r: Result) {
    setOpen(false);
    inputRef.current?.blur();
    router.push(r.href);
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) setTimeout(() => inputRef.current?.focus(), 40);
            return next;
          });
        }}
        aria-label="Search"
        aria-expanded={open}
        aria-controls="header-search-panel"
        className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
          open
            ? "border-fox-primary/60 bg-fox-primary/10 text-fox-primary"
            : "border-fox-border bg-fox-card/80 text-fox-text hover:border-fox-primary/60 hover:text-fox-primary"
        }`}
      >
        {open ? <X className="h-5 w-5" strokeWidth={2} /> : <Search className="h-5 w-5" strokeWidth={2} />}
      </button>

      {open && (
        <div
          id="header-search-panel"
          // w-[calc(100vw-2rem)] keeps the panel inside the viewport on
          // phones; sm:w-[22rem] restores the fixed desktop width. Anchored
          // right so it always lines up with the icon that opened it.
          className="absolute right-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-fox-border bg-fox-bg shadow-2xl shadow-black/70 sm:w-[22rem]"
        >
          <div className="relative border-b border-fox-border p-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-fox-muted" strokeWidth={2} />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); goToResults(); }
                else if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search games, items, accounts…"
              aria-label="Search"
              className="w-full rounded-lg border border-fox-border/60 bg-fox-card py-2 pl-9 pr-8 text-sm text-white placeholder:text-fox-muted focus:border-fox-primary focus:outline-none"
            />
            {loading ? (
              <Loader2 className="absolute right-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-fox-muted" />
            ) : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <DropdownResults
              q={q}
              loading={loading}
              results={results}
              onPick={pick}
              onSeeAll={goToResults}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DropdownResults({
  q,
  loading,
  results,
  onPick,
  onSeeAll,
}: {
  q: string;
  loading: boolean;
  results: Result[];
  onPick: (r: Result) => void;
  onSeeAll: () => void;
}) {
  if (results.length === 0) {
    return loading ? (
      <p className="px-4 py-6 text-center text-sm text-fox-muted">Searching…</p>
    ) : (
      <p className="px-4 py-6 text-center text-sm text-fox-muted">No matches for “{q.trim()}”.</p>
    );
  }

  return (
    <>
      <div className="divide-y divide-fox-border/40">
        {results.map((r) => (
          <button
            key={`${r.kind}-${r.id}`}
            type="button"
            onClick={() => onPick(r)}
            className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-fox-card"
          >
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-fox-border bg-fox-surface">
              {r.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fox-text">{r.name}</div>
              <div className="truncate text-[11px] text-fox-muted">
                {KIND_LABEL[r.kind]}
                {r.sub ? ` · ${r.sub}` : ""}
              </div>
            </div>
            {r.priceUsd !== null && (
              <span className="shrink-0 text-xs font-semibold text-fox-primary">
                ${r.priceUsd.toFixed(2)}
              </span>
            )}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onSeeAll}
        className="w-full border-t border-fox-border bg-fox-card/60 px-4 py-2.5 text-center text-xs font-semibold text-fox-primary hover:bg-fox-card"
      >
        See all results for “{q.trim()}”
      </button>
    </>
  );
}
