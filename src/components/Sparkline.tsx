import type { PricePoint } from "@/lib/markets";

/**
 * Tiny YES-price path for a market card. Pure SVG, rendered on the server —
 * recharts would drag a client bundle onto every card to draw an 80×32 line.
 *
 * Drawn `stepAfter`, like the detail chart — prices are flat between trades
 * and jump when one lands.
 *
 * The Y window is where this deliberately differs from the detail chart's
 * hard 0–100% pin. In a 32px box a full pin renders every realistic move as
 * a ~5px wiggle, which defeats the point of drawing it. But naive auto-fit
 * commits the opposite sin the pin exists to prevent: a 48→52% drift blown
 * up into a collapse. The compromise is a **floored window**: fitted to the
 * data but never narrower than 30 percentage points, so exaggeration is
 * bounded at ~3× rather than unbounded. A quiet market still draws calm; a
 * real move fills the box.
 *
 * Colour comes from `currentColor`, so the caller sets it with a text token
 * (`text-yes` for a live market, `text-faint` for a settled one). The line is
 * never the only encoding — the card states the probability and the 24h move
 * as text right next to it.
 */

const W = 80;
const H = 32;
/** Keeps stroke caps and the end dot inside the viewBox. */
const PAD = 3;

/** Half of the minimum Y window: never show a span tighter than 30pp. */
const MIN_HALF_WINDOW = 0.15;

const fmt = (n: number) => +n.toFixed(1);

export function Sparkline({
  points,
  className = "",
}: {
  points: PricePoint[];
  className?: string;
}) {
  if (points.length === 0) return null;

  const t0 = points[0].t;
  const span = points[points.length - 1].t - t0;
  const x = (t: number) => fmt(PAD + ((t - t0) / span) * (W - 2 * PAD));

  // Floored window, centred on the data, shifted (never shrunk) back inside
  // [0, 1] when it overflows an edge. The 1.15 pad stops extremes from
  // sitting exactly on the box edge.
  const prices = points.map((p) => p.priceYes);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const half = Math.min(0.5, Math.max(MIN_HALF_WINDOW, ((hi - lo) / 2) * 1.15));
  let bottom = (lo + hi) / 2 - half;
  let top = (lo + hi) / 2 + half;
  if (bottom < 0) {
    top -= bottom;
    bottom = 0;
  }
  if (top > 1) {
    bottom -= top - 1;
    top = 1;
  }
  const y = (p: number) => fmt(PAD + (1 - (p - bottom) / (top - bottom)) * (H - 2 * PAD));

  // A single point (or several at one instant) still draws as a flat line
  // across the full width — a lone dot reads as a rendering bug.
  const flat = points.length === 1 || span === 0;

  let d: string;
  if (flat) {
    d = `M ${PAD} ${y(points[0].priceYes)} H ${W - PAD}`;
  } else {
    d = `M ${x(points[0].t)} ${y(points[0].priceYes)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` H ${x(points[i].t)} V ${y(points[i].priceYes)}`;
    }
  }

  const last = points[points.length - 1];
  const endX = flat ? W - PAD : x(last.t);
  const endY = y(last.priceYes);
  const startX = flat ? PAD : x(points[0].t);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label="price history"
    >
      <path d={`${d} V ${H - PAD} H ${startX} Z`} fill="currentColor" fillOpacity={0.08} />
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Where the price is now — the one point on the path that matters. */}
      <circle cx={endX} cy={endY} r={2.5} fill="currentColor" />
    </svg>
  );
}
