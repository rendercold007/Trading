/**
 * Logarithmic Market Scoring Rule (Hanson's LMSR) for binary markets.
 *
 * The market maker holds outstanding share counts q = (qYes, qNo) and prices
 * every trade off the cost function
 *
 *     C(q) = b * ln( e^(qYes/b) + e^(qNo/b) )
 *
 * A trade that moves outstanding shares from q to q' costs C(q') - C(q).
 * Positive cost means the trader pays; negative means they receive points back.
 *
 * `b` is the liquidity parameter: larger b means deeper markets where a given
 * trade moves the price less, at the cost of a larger maximum subsidy. The most
 * the market maker can ever lose over the life of a binary market is b * ln(2).
 *
 * All functions here are pure and operate on plain numbers. Callers are
 * responsible for rounding to storage precision — see `roundPoints`.
 */

/** Points are stored to 4 decimal places; shares to 4 as well. */
export const POINT_PRECISION = 4;

/** Guard against absurd inputs that would produce meaningless prices. */
const MAX_ABS_SHARES = 1e9;

export interface MarketState {
  /** Outstanding YES shares held by traders. */
  qYes: number;
  /** Outstanding NO shares held by traders. */
  qNo: number;
  /** Liquidity parameter. Must be > 0. */
  b: number;
}

export type Outcome = "YES" | "NO";

export class LmsrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LmsrError";
  }
}

function assertValidState(state: MarketState): void {
  const { qYes, qNo, b } = state;
  if (!Number.isFinite(b) || b <= 0) {
    throw new LmsrError(`liquidity parameter b must be a positive finite number, got ${b}`);
  }
  if (!Number.isFinite(qYes) || !Number.isFinite(qNo)) {
    throw new LmsrError(`share quantities must be finite, got qYes=${qYes} qNo=${qNo}`);
  }
  if (Math.abs(qYes) > MAX_ABS_SHARES || Math.abs(qNo) > MAX_ABS_SHARES) {
    throw new LmsrError(`share quantities exceed the supported range of ±${MAX_ABS_SHARES}`);
  }
}

/**
 * Cost function C(q), computed with the log-sum-exp trick.
 *
 * Naively evaluating e^(q/b) overflows to Infinity once q/b exceeds ~709, which
 * happens in normal use (b=500, q=400000). Factoring out the larger exponent
 * keeps every intermediate term in [0, 1] and makes the result exact for the
 * dominant term regardless of scale.
 */
export function cost(state: MarketState): number {
  assertValidState(state);
  const { qYes, qNo, b } = state;
  const aYes = qYes / b;
  const aNo = qNo / b;
  const max = Math.max(aYes, aNo);
  return b * (max + Math.log(Math.exp(aYes - max) + Math.exp(aNo - max)));
}

/**
 * Instantaneous price of YES, i.e. the marginal cost of the next infinitesimal
 * YES share. Equals the market's implied probability and always lies in (0, 1).
 *
 * Computed as a logistic of the scaled share difference, which is algebraically
 * identical to e^(qYes/b) / (e^(qYes/b) + e^(qNo/b)) but never overflows.
 */
export function priceYes(state: MarketState): number {
  assertValidState(state);
  const { qYes, qNo, b } = state;
  const d = (qNo - qYes) / b;
  // 1 / (1 + e^d), branched to keep the exponent negative on both sides.
  if (d >= 0) {
    const e = Math.exp(-d);
    return e / (1 + e);
  }
  return 1 / (1 + Math.exp(d));
}

/** Instantaneous price of NO. `priceYes + priceNo === 1` up to float error. */
export function priceNo(state: MarketState): number {
  return 1 - priceYes(state);
}

/** Both prices at once, as a convenience for rendering. */
export function prices(state: MarketState): { yes: number; no: number } {
  const yes = priceYes(state);
  return { yes, no: 1 - yes };
}

/**
 * Cost of trading `shares` of `outcome`.
 *
 * Positive `shares` buys (returns a positive cost the trader pays).
 * Negative `shares` sells (returns a negative cost, i.e. proceeds to the trader).
 *
 * Note the cost is strictly convex in `shares`: buying 200 shares costs more
 * than twice buying 100, because the trader moves the price against themselves.
 * That slippage is the market maker's protection and the reason prices converge
 * on the crowd's belief.
 */
export function tradeCost(state: MarketState, outcome: Outcome, shares: number): number {
  assertValidState(state);
  if (!Number.isFinite(shares)) {
    throw new LmsrError(`share count must be finite, got ${shares}`);
  }
  if (shares === 0) return 0;

  const after: MarketState =
    outcome === "YES"
      ? { ...state, qYes: state.qYes + shares }
      : { ...state, qNo: state.qNo + shares };

  return cost(after) - cost(state);
}

/** The market state after a trade is applied. Does not mutate the input. */
export function applyTrade(
  state: MarketState,
  outcome: Outcome,
  shares: number,
): MarketState {
  assertValidState(state);
  const next =
    outcome === "YES"
      ? { ...state, qYes: state.qYes + shares }
      : { ...state, qNo: state.qNo + shares };
  assertValidState(next);
  return next;
}

/**
 * Average price paid per share for a trade — what the UI should show as the
 * "fill price", as distinct from the pre-trade quoted price.
 */
export function averagePrice(
  state: MarketState,
  outcome: Outcome,
  shares: number,
): number {
  if (shares === 0) throw new LmsrError("average price is undefined for a zero-share trade");
  return tradeCost(state, outcome, shares) / shares;
}

/**
 * Inverse of `tradeCost`: how many shares of `outcome` can be bought for exactly
 * `budget` points. This is what powers a "spend 500 points" input.
 *
 * Solved in closed form. Buying `d` shares of YES costs
 *
 *     Δ = b*ln(e^((qYes+d)/b) + e^(qNo/b)) - C
 *
 * Rearranging for d gives
 *
 *     d = b*ln( e^((C+Δ)/b) - e^(qNo/b) ) - qYes
 *
 * which we evaluate in a shifted frame (everything relative to the larger
 * exponent) so no term overflows.
 */
export function sharesForBudget(
  state: MarketState,
  outcome: Outcome,
  budget: number,
): number {
  assertValidState(state);
  if (!Number.isFinite(budget)) {
    throw new LmsrError(`budget must be finite, got ${budget}`);
  }
  if (budget <= 0) return 0;

  const { b } = state;
  const qBuy = outcome === "YES" ? state.qYes : state.qNo;
  const qOther = outcome === "YES" ? state.qNo : state.qYes;

  // Work relative to `shift` so all exponentials stay bounded.
  const shift = Math.max(qBuy / b, qOther / b);
  const c0 = shift + Math.log(Math.exp(qBuy / b - shift) + Math.exp(qOther / b - shift));
  const target = c0 + budget / b;

  // e^(target - shift) - e^(qOther/b - shift), guaranteed positive because
  // target > c0 >= qOther/b whenever budget > 0.
  const inner = Math.exp(target - shift) - Math.exp(qOther / b - shift);
  if (!(inner > 0)) {
    throw new LmsrError("numerical failure solving for shares; budget may be too large");
  }
  const shares = b * (shift + Math.log(inner)) - qBuy;

  if (!Number.isFinite(shares) || shares < 0) {
    throw new LmsrError("numerical failure solving for shares; budget may be too large");
  }
  return shares;
}

/**
 * Maximum the market maker can lose across the life of the market, which is the
 * subsidy the house must be willing to put up. For a binary LMSR this is b*ln(2)
 * regardless of how trading goes.
 */
export function maxSubsidy(b: number): number {
  if (!Number.isFinite(b) || b <= 0) {
    throw new LmsrError(`liquidity parameter b must be a positive finite number, got ${b}`);
  }
  return b * Math.LN2;
}

/**
 * Round to storage precision. Use for every value that crosses into the
 * database so repeated trades can't accumulate float drift.
 */
export function roundPoints(value: number, precision: number = POINT_PRECISION): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/**
 * Payout for holding `shares` of `outcome` once the market resolves to
 * `resolution`. Each winning share is worth exactly 1 point.
 */
export function payout(outcome: Outcome, shares: number, resolution: Outcome): number {
  return outcome === resolution ? shares : 0;
}
