import { formatProbability } from "@/lib/format";

/**
 * The YES/NO split of a market, as a two-segment meter.
 *
 * Two solid segments rather than a fill over a track: this is a two-sided
 * market, not progress toward completion, and the NO side is a position
 * someone holds, not the absence of YES. Identity is carried by fixed order —
 * YES always left, NO always right, matching the price labels rendered beside
 * it — never by hue alone, even though the blue/red pair separates far better
 * than the green/rose one it replaced. The gap between segments is a
 * deliberate spacer, and the number is always written next to the bar.
 */
export function ProbabilityBar({
  priceYes,
  size = "md",
}: {
  priceYes: number;
  size?: "sm" | "md";
}) {
  const percent = Math.round(priceYes * 100);
  const height = size === "sm" ? "h-1.5" : "h-2";

  return (
    <div
      className={`flex w-full ${height} gap-[3px]`}
      role="img"
      aria-label={`${formatProbability(priceYes)} chance of yes`}
    >
      {percent > 0 && (
        <div
          className="h-full rounded-full bg-yes transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      )}
      {percent < 100 && <div className="h-full min-w-0 flex-1 rounded-full bg-no" />}
    </div>
  );
}
