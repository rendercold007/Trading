"use client";

import { useMemo } from "react";
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
export function ProbabilityChart({ history }: { history: PricePoint[] }) {
  const data = useMemo(
    () => history.map((p) => ({ t: p.t, probability: p.priceYes * 100 })),
    [history],
  );

  // One point is a dot, not a line. Duplicate it so there is something to draw.
  const series = data.length === 1 ? [data[0], { ...data[0], t: data[0].t + 1 }] : data;

  const spansMultipleDays =
    series.length > 1 && series[series.length - 1].t - series[0].t > 86_400_000;

  return (
    <div className="h-56 w-full sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        {/* No negative left margin — it clips the "100%" tick to "0%". */}
        <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="probFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--yes)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--yes)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />

          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            // Within a single day, dates are noise — every tick would read the
            // same. Show clock time instead, and only fall back to dates once
            // the market has actually been running longer than a day.
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
            stroke="var(--yes)"
            strokeWidth={2}
            fill="url(#probFill)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
