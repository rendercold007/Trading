"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PricePoint } from "@/lib/markets";
import { formatProbability } from "@/lib/format";

/**
 * Probability over time.
 *
 * The Y axis is pinned to 0–100% rather than fitted to the data. An auto-scaled
 * axis makes a market that drifted between 48% and 52% look every bit as
 * dramatic as one that collapsed from 90% to 10%, which is actively misleading
 * on a page whose whole purpose is conveying likelihood.
 */

const DAY = 86_400_000;

const RANGES = [
  { key: "1D", label: "1D", ms: DAY },
  { key: "1W", label: "1W", ms: 7 * DAY },
  { key: "1M", label: "1M", ms: 30 * DAY },
  { key: "ALL", label: "All", ms: Number.POSITIVE_INFINITY },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

export function ProbabilityChart({ history }: { history: PricePoint[] }) {
  /**
   * "All" is the default, and deliberately so on two counts. Most markets here
   * are younger than a month, so a shorter default would open on a window
   * wider than the data. And every other range has to read the clock — a
   * `Date.now()` during the server render would disagree with the one during
   * hydration and mismatch the SVG. Starting on the one range that needs no
   * clock keeps first paint deterministic; the others only run after a click.
   */
  const [range, setRange] = useState<RangeKey>("ALL");

  /**
   * A range is offered only if the market has more history than it covers.
   * Showing "1M" on a market three days old gives the reader a control that
   * draws exactly the same picture as the one next to it.
   */
  const span = history.length > 1 ? history[history.length - 1].t - history[0].t : 0;
  const ranges = RANGES.filter((r) => r.ms < span || r.key === "ALL");

  const { series, domain } = useMemo(
    () => buildSeries(history, range),
    [history, range],
  );

  const spansMultipleDays =
    series.length > 1 && series[series.length - 1].t - series[0].t > DAY;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">Probability over time</h2>

        {ranges.length > 1 && (
          <div className="flex gap-0.5 rounded-lg bg-page p-0.5" role="group" aria-label="Chart range">
            {ranges.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                aria-pressed={range === r.key}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                  range === r.key
                    ? "bg-surface text-fg shadow-sm"
                    : "text-muted hover:text-fg"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          {/* No negative left margin — it clips the "100%" tick to "0%". */}
          <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="probFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart)" stopOpacity={0.26} />
                <stop offset="100%" stopColor="var(--chart)" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />

            <XAxis
              dataKey="t"
              type="number"
              domain={domain}
              scale="time"
              // Within a single day, dates are noise — every tick would read the
              // same. Show clock time instead, and only fall back to dates once
              // the window on screen is actually longer than a day.
              tickFormatter={(t: number) =>
                spansMultipleDays
                  ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                  : new Date(t).toLocaleTimeString("en-IN", {
                      hour: "numeric",
                      minute: "2-digit",
                    })
              }
              tick={{ fill: "var(--faint)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />

            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: "var(--faint)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={38}
            />

            <Tooltip
              cursor={{ stroke: "var(--faint)", strokeDasharray: "3 3" }}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--fg)",
              }}
              labelFormatter={(t: number) =>
                new Date(t).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })
              }
              formatter={(value: number) => [formatProbability(value / 100), "Chance of yes"]}
            />

            <Area
              // Step, not a curve. The price is constant between trades and jumps
              // when one lands. A monotone curve draws a smooth glide through
              // probabilities the market never actually quoted — which on a chart
              // whose entire job is conveying likelihood is a lie, not a
              // smoothing choice.
              type="stepAfter"
              dataKey="probability"
              stroke="var(--chart)"
              strokeWidth={2}
              fill="url(#probFill)"
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 3.5, fill: "var(--chart)", stroke: "var(--surface)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface Point {
  t: number;
  probability: number;
}

/**
 * The points to draw, and the X domain to draw them in.
 *
 * "All" spans first trade to last, never padding out to now — a market that
 * goes quiet for a week would otherwise have its whole path squashed into the
 * left edge.
 *
 * A fixed range is the opposite case: "the last 7 days" that visibly stops
 * three days ago is lying about recency, so a windowed view is pinned to
 * `[cutoff, now]`. Two synthetic points make that honest. One carries the
 * price that was already in effect when the window opened, so the line starts
 * at the left edge instead of mid-air; the other carries the current price
 * forward to now, so the flat stretch since the last trade is visible as
 * exactly that — a market nobody has traded.
 */
function buildSeries(
  history: PricePoint[],
  range: RangeKey,
): { series: Point[]; domain: [number, number] | ["dataMin", "dataMax"] } {
  const all: Point[] = history.map((p) => ({ t: p.t, probability: p.priceYes * 100 }));

  if (range === "ALL") {
    // One point is a dot, not a line. Duplicate it so there is something to draw.
    const series = all.length === 1 ? [all[0], { ...all[0], t: all[0].t + 1 }] : all;
    return { series, domain: ["dataMin", "dataMax"] };
  }

  const ms = RANGES.find((r) => r.key === range)!.ms;
  const now = Date.now();
  const cutoff = now - ms;

  const inWindow = all.filter((p) => p.t >= cutoff);
  const carried = all.filter((p) => p.t < cutoff).pop();

  const series: Point[] = [];
  if (carried) series.push({ t: cutoff, probability: carried.probability });
  series.push(...inWindow);

  const last = series[series.length - 1];
  if (last && last.t < now) series.push({ t: now, probability: last.probability });

  return { series, domain: [cutoff, now] };
}
