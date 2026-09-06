import Link from "next/link";
import RobuxStockBadge from "@/components/RobuxStockBadge";

interface GameCardProps {
  slug: string;
  name: string;
  publisher?: string | null;
  currencyName: string;
  imageUrl: string;
  featured?: boolean;
  active?: boolean;
  robuxStock?: number | null;
}

function GameCardContent({
  name,
  imageUrl,
  featured,
  active,
  robuxStock,
}: {
  name: string;
  imageUrl: string;
  featured?: boolean;
  active: boolean;
  robuxStock?: number | null;
}) {
  return (
    <div className="relative flex flex-col items-center rounded-2xl border border-fox-border/60 bg-fox-card p-4 sm:p-5 transition-all duration-500 group-hover:border-transparent group-hover:bg-fox-card/90">
      <div className="relative w-full aspect-square overflow-hidden rounded-xl bg-fox-surface mb-4">
        <div
          className={
            active
              ? "absolute inset-0 bg-gradient-to-br from-fox-primary/20 to-fox-accent/10 bg-cover bg-center transition-transform duration-700 ease-out group-hover:scale-110"
              : "absolute inset-0 bg-gradient-to-br from-fox-primary/20 to-fox-accent/10 bg-cover bg-center grayscale opacity-50"
          }
          style={imageUrl ? { backgroundImage: "url(" + imageUrl + ")" } : {}}
        />

        {active && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
            <div className="absolute -inset-y-1 -left-full w-1/2 rotate-12 bg-gradient-to-r from-transparent via-white/25 to-transparent transition-all duration-700 ease-out group-hover:left-[150%]" />
          </div>
        )}

        {active && featured && (
          <div className="absolute top-2 left-2 badge-best flex items-center gap-1 text-[9px]">
            <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
            </svg>
            HOT
          </div>
        )}

        {!active && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="rounded-full border border-fox-border/80 bg-fox-card/90 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-fox-muted">
              Coming Soon
            </span>
          </div>
        )}
      </div>

      {active && robuxStock !== null && robuxStock !== undefined && (
        <div className="w-full">
          <RobuxStockBadge compact initialTotal={robuxStock} />
        </div>
      )}

      <h3
        className={
          active
            ? "font-display font-bold text-sm sm:text-base text-center leading-tight mb-3 transition-colors duration-300 group-hover:text-fox-gold"
            : "font-display font-bold text-sm sm:text-base text-center leading-tight mb-3 text-fox-muted"
        }
      >
        {name}
      </h3>

      <button
        type="button"
        disabled={!active}
        className={
          active
            ? "w-full rounded-xl bg-gradient-to-r from-fox-primary to-fox-accent py-2.5 text-sm font-bold text-black uppercase tracking-wider transition-all duration-300 group-hover:shadow-lg group-hover:shadow-fox-primary/40 group-hover:scale-[1.03] active:scale-[0.97]"
            : "w-full cursor-not-allowed rounded-xl bg-fox-surface py-2.5 text-sm font-bold text-fox-muted uppercase tracking-wider"
        }
      >
        {active ? "Top Up" : "Coming Soon"}
      </button>
    </div>
  );
}

export default function GameCard({ slug, name, publisher, currencyName, imageUrl, featured, active = true, robuxStock = null }: GameCardProps) {
  if (!active) {
    return (
      <div
        aria-disabled="true"
        title={name + " (coming soon)"}
        className="game-card group relative block cursor-not-allowed rounded-2xl opacity-70"
      >
        <GameCardContent name={name} imageUrl={imageUrl} featured={featured} active={false} robuxStock={robuxStock} />
      </div>
    );
  }

  return (
    <Link
      href={"/games/" + slug}
      className="game-card group relative block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-fox-primary/60"
    >
      <span
        className="pointer-events-none absolute -inset-[1px] rounded-2xl bg-gradient-to-br from-fox-primary via-fox-accent to-fox-gold opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        aria-hidden
      />
      <GameCardContent
        name={name}
        imageUrl={imageUrl}
        featured={featured}
        active={true}
        robuxStock={robuxStock}
      />
    </Link>
  );
}
