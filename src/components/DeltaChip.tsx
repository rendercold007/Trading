/**
 * 24-hour move, in whole percentage points.
 *
 * Direction is carried three ways — arrow, colour, and the screen-reader text
 * — because colour alone is never enough, and the blue/red pair being far more
 * separable than the green/rose one it replaced doesn't change that.
 *
 * A move that rounds to zero renders nothing: a "±0" chip is noise pretending
 * to be signal. So is a chip on a market where nothing has ever traded, which
 * is why callers pass `null` rather than `0` for that case.
 */
export function DeltaChip({ delta, size = "sm" }: { delta: number; size?: "sm" | "md" }) {
  const pp = Math.round(Math.abs(delta) * 100);
  if (pp === 0) return null;

  const up = delta > 0;
  const text = size === "md" ? "text-xs" : "text-[11px]";

  return (
    <span
      className={`tabular inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-semibold ${text}
                  ${up ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss"}`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {pp}
      <span className="sr-only">
        {up ? "up" : "down"} {pp} percentage points in the last day
      </span>
    </span>
  );
}
