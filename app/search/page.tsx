"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Search as SearchIcon, Loader2 } from "lucide-react";

interface Result {
  kind: "game" | "item" | "account";
  id: string;
  name: string;
  sub: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  href: string;
}

const SECTIONS: { key: "games" | "items" | "accounts"; title: string }[] = [
  { key: "games", title: "Games" },
  { key: "items", title: "Game Items" },
  { key: "accounts", title: "Accounts" },
];

function SearchResults() {
  const params = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const [data, setData] = useState<{ games: Result[]; items: Result[]; accounts: Result[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!q) {
      setLoading(false);
      setData({ games: [], items: [], accounts: [] });
      return;
    }
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { games: [], items: [], accounts: [] }))
      .then(setData)
      .catch(() => setData({ games: [], items: [], accounts: [] }))
      .finally(() => setLoading(false));
  }, [q]);

  const total = data ? data.games.length + data.items.length + data.accounts.length : 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">
          Search results
        </h1>
        <p className="mt-1 text-sm text-fox-muted">
          {q ? (
            <>
              For <span className="text-fox-text">“{q}”</span>
              {!loading && data && <> · {total} result{total === 1 ? "" : "s"}</>}
            </>
          ) : (
            "Type something in the search box to find games, items and accounts."
          )}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-fox-primary" />
        </div>
      ) : total === 0 ? (
        <div className="card p-10 text-center">
          <SearchIcon className="mx-auto mb-3 h-10 w-10 text-fox-muted/40" />
          <p className="text-fox-muted">Nothing matched “{q}”. Try a shorter or different keyword.</p>
          <Link href="/" className="btn-primary mt-5 inline-flex text-sm">Back to home</Link>
        </div>
      ) : (
        <div className="space-y-8">
          {SECTIONS.map((section) => {
            const rows = data ? data[section.key] : [];
            if (rows.length === 0) return null;
            return (
              <section key={section.key}>
                <h2 className="mb-3 font-display text-lg font-bold">
                  {section.title}
                  <span className="ml-2 text-xs font-normal text-fox-muted">{rows.length}</span>
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {rows.map((r) => (
                    <Link
                      key={`${r.kind}-${r.id}`}
                      href={r.href}
                      className="group card overflow-hidden p-0 transition-all hover:-translate-y-0.5 hover:border-fox-primary/50"
                    >
                      <div className="aspect-square w-full overflow-hidden bg-fox-surface">
                        {r.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.imageUrl}
                            alt={r.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-fox-muted/30">
                            <SearchIcon className="h-8 w-8" />
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="line-clamp-2 text-sm font-semibold leading-tight">{r.name}</div>
                        {r.sub && <div className="mt-0.5 truncate text-[11px] text-fox-muted">{r.sub}</div>}
                        {r.priceUsd !== null && (
                          <div className="mt-1.5 text-sm font-bold text-fox-primary">
                            ${r.priceUsd.toFixed(2)}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <>
      <Header />
      <Suspense fallback={<div className="py-20 text-center text-fox-muted">Loading…</div>}>
        <SearchResults />
      </Suspense>
      <Footer />
    </>
  );
}
