"use client";

interface Day {
  date: string;
  revenue: number;
  profit: number;
  orders: number;
}

// Monthly revenue bar chart for the admin dashboard — one bar per day of the
// current month, revenue height with a profit line drawn on top. Built as
// plain SVG so no chart library is needed (same approach as the old
// RevenueSparkline). Hover a bar for that day's numbers.
export default function MonthlyRevenueChart({ data }: { data: Day[] }) {
  if (data.length === 0) {
    return <div className="py-10 text-center text-sm text-fox-muted">No data yet.</div>;
  }

  const width = 720;
  const height = 180;
  const padX = 6;
  const padTop = 8;
  const padBottom = 22; // room for day labels
  const plotH = height - padTop - padBottom;

  const max = Math.max(1, ...data.map((d) => Math.max(d.revenue, d.profit)));
  const slot = (width - padX * 2) / data.length;
  const barW = Math.max(2, slot * 0.62);

  // Profit line: y position per day, scaled to the same max.
  const linePoints = data
    .map((d, i) => {
      const x = padX + i * slot + slot / 2;
      const y = padTop + plotH - (Math.max(0, d.profit) / max) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="monthly-rev" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#FF6B1A" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#FFB800" stopOpacity="0.25" />
          </linearGradient>
        </defs>

        {/* Baseline */}
        <line
          x1={padX}
          x2={width - padX}
          y1={padTop + plotH}
          y2={padTop + plotH}
          stroke="currentColor"
          className="text-fox-border"
          strokeWidth="1"
        />

        {/* Revenue bars */}
        {data.map((d, i) => {
          const h = (d.revenue / max) * plotH;
          const x = padX + i * slot + (slot - barW) / 2;
          const y = padTop + plotH - h;
          const labelX = padX + i * slot + slot / 2;
          // Show every 5th day label so a 31-day month stays readable.
          const showLabel = i === 0 || (i + 1) % 5 === 0 || i === data.length - 1;
          return (
            <g key={d.date}>
              <rect x={x} y={y} width={barW} height={Math.max(0, h)} rx={2} fill="url(#monthly-rev)">
                <title>{`${d.date}: $${d.revenue.toFixed(2)} revenue · $${d.profit.toFixed(2)} profit · ${d.orders} orders`}</title>
              </rect>
              {showLabel && (
                <text
                  x={labelX}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-current text-fox-muted"
                  style={{ fontSize: 9 }}
                >
                  {d.date.slice(8)}
                </text>
              )}
            </g>
          );
        })}

        {/* Profit line */}
        {data.some((d) => d.profit !== 0) && (
          <polyline
            points={linePoints}
            fill="none"
            stroke="#34d399"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      <div className="mt-3 flex items-center gap-4 text-[11px] text-fox-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-gradient-to-b from-fox-primary to-fox-gold/40" />
          Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-green-400" />
          Profit
        </span>
      </div>
    </div>
  );
}
