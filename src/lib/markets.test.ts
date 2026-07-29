import { test } from "node:test";
import assert from "node:assert/strict";

import { downsample, trailingDelta, type PricePoint } from "./markets";

/**
 * Covers the pure chart-prep helpers only. The query functions in this module
 * are thin Prisma reads exercised through the pages; the logic worth pinning
 * down is the sparkline thinning and the 24h-delta baseline, both of which
 * have edge cases that would fail silently as a wrong-looking card.
 */

const at = (t: number, priceYes: number): PricePoint => ({ t, priceYes });

const series = (n: number): PricePoint[] =>
  Array.from({ length: n }, (_, i) => at(i * 1000, i / n));

// --- downsample -------------------------------------------------------------

test("a series already within budget is returned unchanged", () => {
  const points = series(10);
  assert.deepEqual(downsample(points, 32), points);
});

test("a long series is thinned to exactly the budget", () => {
  assert.equal(downsample(series(500), 32).length, 32);
});

test("thinning always keeps the first and last points", () => {
  const points = series(500);
  const out = downsample(points, 32);
  assert.deepEqual(out[0], points[0]);
  assert.deepEqual(out[out.length - 1], points[points.length - 1]);
});

test("thinned output preserves time order without duplicates", () => {
  const out = downsample(series(500), 32);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].t > out[i - 1].t, `t must strictly increase at index ${i}`);
  }
});

test("a budget below two points returns the series untouched", () => {
  const points = series(10);
  assert.deepEqual(downsample(points, 1), points);
});

// --- trailingDelta ----------------------------------------------------------

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

test("no history means the baseline is the 50/50 open", () => {
  assert.equal(trailingDelta([], 0.62, NOW), 0.62 - 0.5);
});

test("all trades inside the window still baseline at the open", () => {
  // A market whose whole life fits in 24h: its "day move" is its move since open.
  const history = [at(NOW - 3_600_000, 0.7), at(NOW - 60_000, 0.8)];
  assert.equal(trailingDelta(history, 0.8, NOW), 0.8 - 0.5);
});

test("the baseline is the last trade at or before the cutoff", () => {
  const history = [
    at(NOW - 3 * DAY, 0.3),
    at(NOW - 2 * DAY, 0.4), // ← price in effect when the window opened
    at(NOW - 3_600_000, 0.9),
  ];
  close(trailingDelta(history, 0.9, NOW), 0.5);
});

test("a trade exactly on the cutoff counts as the baseline", () => {
  const history = [at(NOW - DAY, 0.25)];
  close(trailingDelta(history, 0.75, NOW), 0.5);
});

test("an unmoved price reports a zero delta", () => {
  const history = [at(NOW - 2 * DAY, 0.6)];
  close(trailingDelta(history, 0.6, NOW), 0);
});

/** Assert two floats agree to within `eps`. */
function close(actual: number, expected: number, eps = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} to be within ${eps} of ${expected}`,
  );
}
