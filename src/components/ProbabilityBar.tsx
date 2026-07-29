import { formatProbability } from "@/lib/format";

/**
 * The YES share of a market, as a bar.
 *
 * The number is always rendered alongside the bar rather than being encoded in
 * the fill alone — the bar is a quick visual cue, not the information itself.
 * `role="img"` with a label keeps it meaningful to a screen reader without
 * announcing two decorative divs.
 */
export function ProbabilityBar({
  priceYes,
  size = "md",
}: {
  priceYes: number;
  size?: "sm" | "md";
}) {
  const percent = Math.round(priceYes * 100);
  const height = size === "sm" ? "h-1.5" : "h-2.5";

  return (
    <div
      className={`w-full ${height} overflow-hidden rounded-full bg-no-soft`}
      role="img"
      aria-label={`${formatProbability(priceYes)} chance of yes`}
    >
      <div
        className="h-full rounded-full bg-yes transition-[width] duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
