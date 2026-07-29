/**
 * Request parsing for the trade endpoints.
 *
 * Everything arriving from a browser is `unknown` until proved otherwise. These
 * parsers are the single place that turns it into typed values, so the routes
 * and the trade service can both assume well-formed input.
 *
 * Hand-written rather than schema-library-driven: the surface is two small
 * shapes, and the failure messages are better when written for a human looking
 * at a trade form.
 *
 * Note these validate *shape*, not *policy* — minimum trade size, sufficient
 * balance and market state are the trade service's business, checked under its
 * lock where they cannot go stale between check and use.
 */

import { ValidationError } from "./apiError";
import type { Outcome } from "./lmsr";

export type TradeSide = "BUY" | "SELL";

export interface TradeRequest {
  marketId: string;
  outcome: Outcome;
  side: TradeSide;
  /** Exactly one of these is set. */
  shares?: number;
  budget?: number;
}

export interface QuoteRequest {
  marketId: string;
  outcome: Outcome;
  side: TradeSide;
  shares?: number;
  budget?: number;
}

/** Upper bound on a single request, well beyond any sane trade. */
const MAX_REQUEST_MAGNITUDE = 1e9;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} is required`, field);
  }
  return value.trim();
}

function requireOutcome(value: unknown): Outcome {
  const raw = requireString(value, "outcome").toUpperCase();
  if (raw !== "YES" && raw !== "NO") {
    throw new ValidationError('outcome must be "YES" or "NO"', "outcome");
  }
  return raw;
}

function requireSide(value: unknown): TradeSide {
  const raw = requireString(value, "side").toUpperCase();
  if (raw !== "BUY" && raw !== "SELL") {
    throw new ValidationError('side must be "BUY" or "SELL"', "side");
  }
  return raw;
}

/**
 * Accept a positive finite number, from a JSON number or a numeric string.
 *
 * Strings are allowed because a form input yields one and making every caller
 * remember to coerce is a bug waiting to happen. `NaN`, `Infinity`, negatives
 * and zero are all rejected here rather than deeper in, where they would turn
 * into confusing LMSR errors — or worse, a "sell" expressed as a negative buy.
 */
function requirePositiveNumber(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;

  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new ValidationError(`${field} must be a number`, field);
  }
  if (parsed <= 0) {
    throw new ValidationError(`${field} must be greater than zero`, field);
  }
  if (parsed > MAX_REQUEST_MAGNITUDE) {
    throw new ValidationError(`${field} is unreasonably large`, field);
  }
  return parsed;
}

/**
 * Enforce that exactly one sizing mode was given, and that `budget` is only
 * used where it means something.
 */
function parseSizing(
  raw: Record<string, unknown>,
  side: TradeSide,
): { shares?: number; budget?: number } {
  // An empty string counts as absent — that is what a cleared form field sends.
  const present = (v: unknown) => v !== undefined && v !== null && v !== "";
  const hasShares = present(raw.shares);
  const hasBudget = present(raw.budget);

  if (hasShares && hasBudget) {
    throw new ValidationError("specify either shares or budget, not both");
  }
  if (!hasShares && !hasBudget) {
    throw new ValidationError("specify either shares or budget");
  }

  if (hasBudget) {
    if (side === "SELL") {
      // Selling by budget is ambiguous — it would mean "sell until I have
      // received N points", which is not what any UI wants to express.
      throw new ValidationError("budget applies to buys only; sell by shares", "budget");
    }
    return { budget: requirePositiveNumber(raw.budget, "budget") };
  }

  return { shares: requirePositiveNumber(raw.shares, "shares") };
}

/** Parse the body of `POST /api/trade`. */
export function parseTradeBody(body: unknown): TradeRequest {
  const raw = asRecord(body);
  const side = requireSide(raw.side);

  return {
    marketId: requireString(raw.marketId, "marketId"),
    outcome: requireOutcome(raw.outcome),
    side,
    ...parseSizing(raw, side),
  };
}

/**
 * Parse the query string of `GET /api/quote`.
 *
 * A quote is a read with no side effects, so it is a GET — shareable, cacheable
 * by the browser, and safe to fire on every keystroke in the trade form.
 */
export function parseQuoteQuery(params: URLSearchParams): QuoteRequest {
  const raw: Record<string, unknown> = {
    marketId: params.get("marketId") ?? undefined,
    outcome: params.get("outcome") ?? undefined,
    side: params.get("side") ?? "BUY",
    shares: params.get("shares") ?? undefined,
    budget: params.get("budget") ?? undefined,
  };

  const side = requireSide(raw.side);

  return {
    marketId: requireString(raw.marketId, "marketId"),
    outcome: requireOutcome(raw.outcome),
    side,
    ...parseSizing(raw, side),
  };
}
