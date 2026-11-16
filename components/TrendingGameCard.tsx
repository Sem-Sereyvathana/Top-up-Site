import Link from "next/link";

interface TrendingGameCardProps {
  slug: string;
  name: string;
  imageUrl: string;
  active?: boolean;
}

// Spotlight card used in the "Trending Game" row on the home page.
//
// Deliberately heavier than the normal GameCard: a glossy art panel with a
// bright gradient ring, a soft outer glow, and the orange "⚡ TOP UP" button
// from the reference design — so trending titles read as premium picks
// instead of just another tile in the grid.
export default function TrendingGameCard({
  slug,
  name,
  imageUrl,
  active = true,
}: TrendingGameCardProps) {
  const content = (
    <div className="relative h-full">
      {/* Outer glow behind the whole card */}
      <div className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-br from-fox-primary/50 via-fox-gold/30 to-fox-accent/40 opacity-60 blur-md transition-opacity duration-500 group-hover:opacity-100" />

      {/* Bright gradient ring */}
      <div className="relative rounded-2xl bg-gradient-to-br from-fox-primary via-fox-gold to-fox-accent p-[2px] transition-transform duration-500 group-hover:-translate-y-1">
        <div className="overflow-hidden rounded-[14px] bg-fox-card">
          {/* Glossy art */}
          <div className="relative aspect-[4/3] overflow-hidden bg-fox-surface">
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={name}
                loading="lazy"
                decoding="async"
                className={`h-full w-full object-cover transition-transform duration-700 group-hover:scale-110 ${
                  active ? "" : "grayscale opacity-60"
                }`}
              />
            )}

            {/* Glassy reflection sweep */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-white/10" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />

            {/* Sweeping shine on hover */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -inset-y-1 -left-full w-1/2 rotate-12 bg-gradient-to-r from-transparent via-white/40 to-transparent transition-all duration-700 ease-out group-hover:left-[150%]" />
            </div>

            {active && (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-fox-gold px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-black shadow-md">
                ★ HOT
              </span>
            )}

            {!active && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-fox-muted">
                  នឹងមកដល់ឆាប់ៗនេះ
                </span>
              </span>
            )}

            <h3 className="absolute inset-x-2 bottom-1.5 line-clamp-2 font-display text-[11px] font-bold leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] sm:text-sm">
              {name}
            </h3>
          </div>

          {/* Orange button */}
          <div className="p-2">
            <span
              className={
                active
                  ? "flex w-full items-center justify-center gap-1 rounded-lg bg-gradient-to-b from-amber-400 to-orange-500 py-1.5 text-[10px] font-black uppercase tracking-wider text-white shadow-[0_2px_0_#b45309,0_4px_10px_rgba(249,115,22,0.45)] transition-all duration-300 group-hover:from-amber-300 group-hover:to-orange-400 group-hover:-translate-y-0.5 sm:py-2 sm:text-xs"
                  : "flex w-full items-center justify-center rounded-lg bg-fox-surface py-1.5 text-[10px] font-bold uppercase tracking-wider text-fox-muted sm:py-2 sm:text-xs"
              }
            >
              {active ? (
                <>
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
                  </svg>
                  Top Up
                </>
              ) : (
                "Coming Soon"
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  if (!active) {
    return (
      <div aria-disabled="true" className="group relative block h-full cursor-not-allowed opacity-80">
        {content}
      </div>
    );
  }

  return (
    <Link href={"/games/" + slug} className="group relative block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-fox-primary/70">
      {content}
    </Link>
  );
}
