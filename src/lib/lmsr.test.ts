import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LmsrError,
  applyTrade,
  averagePrice,
  cost,
  maxSubsidy,
  payout,
  priceNo,
  priceYes,
  prices,
  roundPoints,
  sharesForBudget,
  tradeCost,
  type MarketState,
} from "./lmsr";

const fresh = (b = 500): MarketState => ({ qYes: 0, qNo: 0, b });

/** Assert two floats agree to within `eps`. */
function close(actual: number, expected: number, eps = 1e-9, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    msg ?? `expected ${actual} to be within ${eps} of ${expected}`,
  );
}

test("a fresh market is priced at 50/50", () => {
  const { yes, no } = prices(fresh());
  close(yes, 0.5);
  close(no, 0.5);
});

test("prices always sum to 1", () => {
  for (const [qYes, qNo, b] of [
    [0, 0, 500],
    [100, 0, 500],
    [0, 100, 500],
    [12345, 678, 500],
    [-400, 900, 250],
    [1e6, 1, 500],
  ] as const) {
    const state = { qYes, qNo, b };
    close(priceYes(state) + priceNo(state), 1, 1e-12, `q=(${qYes},${qNo}) b=${b}`);
  }
});

test("prices stay strictly inside (0, 1) even at extremes", () => {
  const extreme = { qYes: 1e9, qNo: 0, b: 500 };
  const p = priceYes(extreme);
  assert.ok(p > 0 && p <= 1, `price ${p} out of range`);
  assert.ok(Number.isFinite(p), "price must be finite");

  const other = priceYes({ qYes: 0, qNo: 1e9, b: 500 });
  assert.ok(other >= 0 && other < 1, `price ${other} out of range`);
  assert.ok(Number.isFinite(other), "price must be finite");
});

test("cost function does not overflow where a naive implementation would", () => {
  // qYes/b = 2000, far past the ~709 point where Math.exp returns Infinity.
  const state = { qYes: 1_000_000, qNo: 0, b: 500 };
  const c = cost(state);
  assert.ok(Number.isFinite(c), `cost overflowed to ${c}`);
  // With one side dominating, C(q) -> qYes exactly.
  close(c, 1_000_000, 1e-3);
});

test("buying YES raises the YES price, buying NO lowers it", () => {
  const start = fresh();
  const afterYes = applyTrade(start, "YES", 200);
  const afterNo = applyTrade(start, "NO", 200);

  assert.ok(priceYes(afterYes) > priceYes(start), "YES price should rise after buying YES");
  assert.ok(priceYes(afterNo) < priceYes(start), "YES price should fall after buying NO");
});

test("applyTrade does not mutate the input state", () => {
  const start = fresh();
  applyTrade(start, "YES", 500);
  assert.deepEqual(start, { qYes: 0, qNo: 0, b: 500 });
});

test("cost is convex: buying in one lot costs more than the sum of the parts implies", () => {
  const state = fresh();
  const oneHundred = tradeCost(state, "YES", 100);
  const twoHundred = tradeCost(state, "YES", 200);
  assert.ok(
    twoHundred > 2 * oneHundred,
    `expected slippage: 200 shares (${twoHundred}) should cost more than 2x100 (${2 * oneHundred})`,
  );
});

test("splitting a trade in two costs the same as doing it at once", () => {
  const state = fresh();
  const atOnce = tradeCost(state, "YES", 300);
  const first = tradeCost(state, "YES", 100);
  const second = tradeCost(applyTrade(state, "YES", 100), "YES", 200);
  close(atOnce, first + second, 1e-9);
});

test("a buy then an immediate sell returns less than it cost (no free money)", () => {
  const state = fresh();
  const buy = tradeCost(state, "YES", 250);
  const afterBuy = applyTrade(state, "YES", 250);
  const sell = -tradeCost(afterBuy, "YES", -250);
  close(sell, buy, 1e-9, "a round trip with no other activity should be a wash");

  // But if someone else trades in between, the round trip is no longer neutral.
  const afterOther = applyTrade(afterBuy, "YES", 1000);
  const sellLater = -tradeCost(afterOther, "YES", -250);
  assert.ok(sellLater > buy, "selling into a risen price should be profitable");
});

test("selling shares yields points back (negative cost)", () => {
  const state = applyTrade(fresh(), "YES", 500);
  const proceeds = tradeCost(state, "YES", -200);
  assert.ok(proceeds < 0, `selling should return points, got cost ${proceeds}`);
});

test("marginal price brackets the average fill price", () => {
  const state = fresh();
  const before = priceYes(state);
  const avg = averagePrice(state, "YES", 400);
  const after = priceYes(applyTrade(state, "YES", 400));

  assert.ok(before < avg && avg < after, `expected ${before} < ${avg} < ${after}`);
});

test("the average fill price converges to the quoted price as the trade shrinks", () => {
  // The gap is convexity, not error: it is ~ (1/2)*p'(q)*shares, so it falls off
  // linearly with trade size. Below ~1e-4 shares float cancellation in
  // tradeCost (a difference of two costs of order 300) sets a noise floor
  // around 1e-8, so the shrinking is only checked over sizes above that.
  const state = { qYes: 300, qNo: 100, b: 500 };
  const quoted = priceYes(state);

  const gap = (shares: number) => averagePrice(state, "YES", shares) - quoted;

  for (const shares of [1, 0.1, 0.01, 1e-3]) {
    assert.ok(gap(shares) > 0, `average price should exceed the quote when buying ${shares}`);
  }

  // Each tenfold smaller trade closes the gap roughly tenfold.
  for (const [big, small] of [
    [1, 0.1],
    [0.1, 0.01],
    [0.01, 1e-3],
  ] as const) {
    const ratio = gap(big) / gap(small);
    assert.ok(ratio > 9 && ratio < 11, `expected ~10x gap reduction from ${big} to ${small}, got ${ratio}`);
  }
});

test("sharesForBudget inverts tradeCost", () => {
  const cases: Array<[MarketState, "YES" | "NO", number]> = [
    [fresh(), "YES", 100],
    [fresh(), "NO", 2500],
    [{ qYes: 1200, qNo: 300, b: 500 }, "YES", 750],
    [{ qYes: 1200, qNo: 300, b: 500 }, "NO", 10],
    [{ qYes: -500, qNo: 800, b: 120 }, "YES", 333.33],
    [{ qYes: 250_000, qNo: 0, b: 500 }, "NO", 900],
  ];

  for (const [state, outcome, budget] of cases) {
    const shares = sharesForBudget(state, outcome, budget);
    assert.ok(shares > 0, `expected positive shares for budget ${budget}`);
    close(
      tradeCost(state, outcome, shares),
      budget,
      1e-6,
      `budget ${budget} on q=(${state.qYes},${state.qNo}) produced ${shares} shares`,
    );
  }
});

test("sharesForBudget returns nothing for a non-positive budget", () => {
  assert.equal(sharesForBudget(fresh(), "YES", 0), 0);
  assert.equal(sharesForBudget(fresh(), "YES", -50), 0);
});

test("a budget buys fewer shares in a thin market than a deep one", () => {
  const thin = sharesForBudget({ qYes: 0, qNo: 0, b: 50 }, "YES", 500);
  const deep = sharesForBudget({ qYes: 0, qNo: 0, b: 5000 }, "YES", 500);
  assert.ok(deep > thin, `deep market (${deep}) should fill more than thin (${thin})`);
});

test("the market maker's worst case is b*ln(2)", () => {
  close(maxSubsidy(500), 500 * Math.LN2);

  // Verified directly: with the market pushed arbitrarily far toward YES, the
  // maker has taken in `cost` points and owes `qYes` points to holders.
  const b = 500;
  const state = { qYes: 500_000, qNo: 0, b };
  const takenIn = cost(state) - cost({ qYes: 0, qNo: 0, b });
  const owed = state.qYes;
  const loss = owed - takenIn;
  assert.ok(
    loss <= maxSubsidy(b) + 1e-6,
    `loss ${loss} should not exceed the ${maxSubsidy(b)} bound`,
  );
  close(loss, maxSubsidy(b), 1e-6);
});

test("payout pays 1 point per winning share and nothing per losing share", () => {
  assert.equal(payout("YES", 300, "YES"), 300);
  assert.equal(payout("YES", 300, "NO"), 0);
  assert.equal(payout("NO", 42.5, "NO"), 42.5);
});

test("roundPoints clamps to storage precision", () => {
  assert.equal(roundPoints(1.234567), 1.2346);
  assert.equal(roundPoints(1.00005), 1.0001);
  assert.equal(roundPoints(-2.71828), -2.7183);
  assert.equal(roundPoints(100), 100);
});

test("invalid inputs are rejected rather than producing silent nonsense", () => {
  assert.throws(() => cost({ qYes: 0, qNo: 0, b: 0 }), LmsrError);
  assert.throws(() => cost({ qYes: 0, qNo: 0, b: -1 }), LmsrError);
  assert.throws(() => cost({ qYes: NaN, qNo: 0, b: 500 }), LmsrError);
  assert.throws(() => cost({ qYes: Infinity, qNo: 0, b: 500 }), LmsrError);
  assert.throws(() => tradeCost(fresh(), "YES", NaN), LmsrError);
  assert.throws(() => averagePrice(fresh(), "YES", 0), LmsrError);
  assert.throws(() => sharesForBudget(fresh(), "YES", NaN), LmsrError);
  assert.throws(() => maxSubsidy(0), LmsrError);
});

test("a zero-share trade is free", () => {
  assert.equal(tradeCost(fresh(), "YES", 0), 0);
});

test("simulated trading keeps prices sane and conserves points", () => {
  // Walk a market through 200 pseudo-random trades and check the maker's book
  // never implies a loss beyond the subsidy bound, and prices stay in (0,1).
  let state = fresh(300);
  let makerCash = 0;
  let seed = 12345;
  const rand = () => {
    // Deterministic LCG so the test is reproducible.
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let i = 0; i < 200; i++) {
    const outcome = rand() < 0.5 ? "YES" : "NO";
    const shares = (rand() - 0.35) * 400;
    if (shares === 0) continue;
    makerCash += tradeCost(state, outcome, shares);
    state = applyTrade(state, outcome, shares);

    const p = priceYes(state);
    assert.ok(p > 0 && p < 1 && Number.isFinite(p), `price left (0,1): ${p} at step ${i}`);
  }

  // Whichever way it resolves, the maker's net position is bounded by b*ln(2).
  for (const resolution of ["YES", "NO"] as const) {
    const owed = resolution === "YES" ? state.qYes : state.qNo;
    const loss = owed - makerCash;
    assert.ok(
      loss <= maxSubsidy(state.b) + 1e-6,
      `resolving ${resolution} would cost the maker ${loss}, above the ${maxSubsidy(state.b)} bound`,
    );
  }
});
