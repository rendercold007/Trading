/**
 * Transactional trade service — the only supported way to move shares or points.
 *
 * Everything the LMSR maths knows about lives in `./lmsr`; this module owns the
 * database side: locking, validation, and writing the six things a single trade
 * touches (Trade, Position, User.balance, Market.qYes/qNo, the denormalised
 * volume counters, and PricePoint) inside one transaction.
 *
 * Concurrency: every trade takes a `SELECT ... FOR UPDATE` row lock on its
 * Market before reading state. Postgres' default READ COMMITTED isolation would
 * otherwise let two simultaneous trades both read qYes=0 and both write their
 * own result, losing one of them and minting points from nothing. The lock
 * serialises trades per market, which is exactly the granularity we want —
 * trades in different markets never contend.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./db";
import { enforce as enforceRateLimit } from "./rateLimit";
import {
  applyTrade,
  averagePrice,
  priceYes,
  prices,
  roundPoints,
  sharesForBudget,
  tradeCost,
  type MarketState,
  type Outcome,
} from "./lmsr";

/**
 * Smallest tradeable size. Storage precision is 4dp, but `tradeCost` subtracts
 * two large costs and goes float-noisy for sub-0.001-share trades, so the floor
 * sits an order of magnitude clear of that.
 */
export const MIN_TRADE_SHARES = 0.01;

/** Smallest budget for a spend-N-points buy. */
export const MIN_TRADE_BUDGET = 0.01;

export type TradeErrorCode =
  | "MARKET_NOT_FOUND"
  | "MARKET_CLOSED"
  | "USER_NOT_FOUND"
  | "INVALID_SIZE"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_SHARES";

export class TradeError extends Error {
  readonly code: TradeErrorCode;

  constructor(code: TradeErrorCode, message: string) {
    super(message);
    this.name = "TradeError";
    this.code = code;
  }
}

/** Anything with the Prisma model methods — the client itself or a `$transaction` handle. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Escape hatch for callers that are not user requests — the seed script, admin
 * tooling, tests. **Never set this from a request handler**: the limit is
 * enforced here rather than in the route precisely so that forgetting it in one
 * route cannot leave a hole.
 */
export interface TradeOptions {
  skipRateLimit?: boolean;
}

/**
 * Spend a trade token before doing any work.
 *
 * Deliberately outside `$transaction`: the limiter writes a row, and doing that
 * inside the trade transaction would hold the market lock for the duration and
 * make a rejected trade's bookkeeping roll back with it.
 */
async function checkTradeRateLimit(
  userId: string,
  opts: TradeOptions | undefined,
  db: Db,
): Promise<void> {
  if (opts?.skipRateLimit) return;
  await enforceRateLimit("trade", userId, db);
}

export interface TradeResult {
  tradeId: string;
  marketId: string;
  outcome: Outcome;
  side: "BUY" | "SELL";
  /** Shares bought or sold, always positive. */
  shares: number;
  /** Points paid (BUY) or received (SELL), always positive. */
  cost: number;
  /** Realised fill price, cost / shares. */
  avgPrice: number;
  /** The trader's spendable points after the trade. */
  balanceAfter: number;
  /** The trader's holding in this outcome after the trade. */
  sharesAfter: number;
  /** Market probability before and after, for "you moved the price" UI. */
  priceYesBefore: number;
  priceYesAfter: number;
}

export interface Quote {
  outcome: Outcome;
  side: "BUY" | "SELL";
  shares: number;
  cost: number;
  avgPrice: number;
  priceYesBefore: number;
  priceYesAfter: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDecimal(value: number): Prisma.Decimal {
  // Via a fixed-precision string so the stored value is exactly the number we
  // validated against, not a binary-float approximation of it.
  return new Prisma.Decimal(value.toFixed(4));
}

function toPriceDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(6));
}

/** Round down to storage precision — used where rounding up would overspend. */
function floorShares(value: number): number {
  return Math.floor(value * 1e4) / 1e4;
}

interface LockedMarket {
  id: string;
  state: MarketState;
}

/**
 * Take the per-market write lock and return the market's current LMSR state.
 *
 * The `FOR UPDATE` query only selects the id: holding the lock is its whole
 * job. The typed read that follows is guaranteed to see the latest committed
 * row because no other trade on this market can be mid-transaction.
 */
async function lockMarketForTrading(tx: Prisma.TransactionClient, marketId: string): Promise<LockedMarket> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Market" WHERE id = ${marketId} FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new TradeError("MARKET_NOT_FOUND", `no market with id ${marketId}`);
  }

  const market = await tx.market.findUniqueOrThrow({
    where: { id: marketId },
    select: { id: true, status: true, closesAt: true, b: true, qYes: true, qNo: true },
  });

  if (market.status !== "OPEN") {
    throw new TradeError("MARKET_CLOSED", `market is ${market.status.toLowerCase()}, not open for trading`);
  }
  if (market.closesAt.getTime() <= Date.now()) {
    throw new TradeError("MARKET_CLOSED", "market has passed its close time");
  }

  return {
    id: market.id,
    state: {
      qYes: market.qYes.toNumber(),
      qNo: market.qNo.toNumber(),
      b: market.b.toNumber(),
    },
  };
}

/**
 * Write the market/position/trade/history rows shared by both sides of a trade.
 * `signedShares` is positive for a buy and negative for a sell.
 */
async function recordTrade(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    marketId: string;
    outcome: Outcome;
    side: "BUY" | "SELL";
    shares: number;
    cost: number;
    stateAfter: MarketState;
  },
): Promise<{ tradeId: string; priceYesAfter: number }> {
  const { userId, marketId, outcome, side, shares, cost, stateAfter } = args;
  const priceYesAfter = priceYes(stateAfter);
  const avgPrice = cost / shares;

  await tx.market.update({
    where: { id: marketId },
    data: {
      qYes: toDecimal(stateAfter.qYes),
      qNo: toDecimal(stateAfter.qNo),
      // Volume counts points changing hands in either direction.
      volume: { increment: toDecimal(cost) },
      tradeCount: { increment: 1 },
    },
  });

  const trade = await tx.trade.create({
    data: {
      userId,
      marketId,
      outcome,
      side,
      shares: toDecimal(shares),
      cost: toDecimal(cost),
      avgPrice: toPriceDecimal(avgPrice),
      qYesAfter: toDecimal(stateAfter.qYes),
      qNoAfter: toDecimal(stateAfter.qNo),
      priceYesAfter: toPriceDecimal(priceYesAfter),
    },
    select: { id: true },
  });

  await tx.pricePoint.create({
    data: { marketId, priceYes: toPriceDecimal(priceYesAfter) },
  });

  return { tradeId: trade.id, priceYesAfter };
}

// ---------------------------------------------------------------------------
// Quoting (read-only)
// ---------------------------------------------------------------------------

/**
 * Price a hypothetical trade without touching anything. Safe to call on every
 * keystroke in the trade form.
 *
 * Quotes are advisory: another trade can land between the quote and the fill,
 * which is why `buyShares`/`sellShares` re-price under the lock rather than
 * trusting a cost passed in from the client.
 */
export async function quoteTrade(
  args: {
    marketId: string;
    outcome: Outcome;
    side: "BUY" | "SELL";
    /** Exact share count. Mutually exclusive with `budget`. */
    shares?: number;
    /** Points to spend. BUY only. */
    budget?: number;
  },
  db: Db = defaultPrisma,
): Promise<Quote> {
  const { marketId, outcome, side } = args;

  const market = await db.market.findUnique({
    where: { id: marketId },
    select: { b: true, qYes: true, qNo: true },
  });
  if (!market) {
    throw new TradeError("MARKET_NOT_FOUND", `no market with id ${marketId}`);
  }

  const state: MarketState = {
    qYes: market.qYes.toNumber(),
    qNo: market.qNo.toNumber(),
    b: market.b.toNumber(),
  };

  const shares = resolveSize(state, outcome, side, args.shares, args.budget);
  const signed = side === "BUY" ? shares : -shares;
  const cost = roundPoints(Math.abs(tradeCost(state, outcome, signed)));
  const stateAfter = applyTrade(state, outcome, signed);

  return {
    outcome,
    side,
    shares,
    cost,
    avgPrice: cost / shares,
    priceYesBefore: priceYes(state),
    priceYesAfter: priceYes(stateAfter),
  };
}

/**
 * Turn the caller's `shares` or `budget` into a validated share count.
 * Budget-derived sizes round *down* so the resulting cost never exceeds what
 * the trader asked to spend.
 */
function resolveSize(
  state: MarketState,
  outcome: Outcome,
  side: "BUY" | "SELL",
  shares?: number,
  budget?: number,
): number {
  if ((shares === undefined) === (budget === undefined)) {
    throw new TradeError("INVALID_SIZE", "specify exactly one of `shares` or `budget`");
  }

  if (budget !== undefined) {
    if (side !== "BUY") {
      throw new TradeError("INVALID_SIZE", "`budget` is only meaningful for a BUY");
    }
    if (!Number.isFinite(budget) || budget < MIN_TRADE_BUDGET) {
      throw new TradeError("INVALID_SIZE", `budget must be at least ${MIN_TRADE_BUDGET} points`);
    }
    const raw = floorShares(sharesForBudget(state, outcome, budget));
    if (raw < MIN_TRADE_SHARES) {
      throw new TradeError("INVALID_SIZE", `budget of ${budget} points buys less than ${MIN_TRADE_SHARES} shares`);
    }
    return raw;
  }

  const size = roundPoints(shares!);
  if (!Number.isFinite(size) || size < MIN_TRADE_SHARES) {
    throw new TradeError("INVALID_SIZE", `trade size must be at least ${MIN_TRADE_SHARES} shares`);
  }
  return size;
}

// ---------------------------------------------------------------------------
// Buying
// ---------------------------------------------------------------------------

/**
 * Buy `shares` of `outcome`, or as many shares as `budget` points will cover.
 *
 * The whole thing runs in one transaction: if any step fails the trader's
 * points, their position and the market's share counts all stay exactly as they
 * were. A partially applied trade is not representable.
 */
export async function buyShares(
  args: {
    userId: string;
    marketId: string;
    outcome: Outcome;
    shares?: number;
    budget?: number;
  } & TradeOptions,
  db: PrismaClient = defaultPrisma,
): Promise<TradeResult> {
  const { userId, marketId, outcome } = args;

  await checkTradeRateLimit(userId, args, db);

  return db.$transaction(async (tx) => {
    const { state } = await lockMarketForTrading(tx, marketId);

    const shares = resolveSize(state, outcome, "BUY", args.shares, args.budget);
    const cost = roundPoints(tradeCost(state, outcome, shares));
    const stateAfter = applyTrade(state, outcome, shares);

    // Conditional decrement rather than read-then-write: this is atomic, so a
    // user firing two trades at once in different markets (where the market
    // locks don't serialise them) still can't spend the same points twice.
    const debited = await tx.user.updateMany({
      where: { id: userId, balance: { gte: toDecimal(cost) } },
      data: { balance: { decrement: toDecimal(cost) } },
    });
    if (debited.count === 0) {
      const exists = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!exists) {
        throw new TradeError("USER_NOT_FOUND", `no user with id ${userId}`);
      }
      throw new TradeError("INSUFFICIENT_BALANCE", `this trade costs ${cost} points, which exceeds your balance`);
    }

    const position = await tx.position.upsert({
      where: { userId_marketId_outcome: { userId, marketId, outcome } },
      create: {
        userId,
        marketId,
        outcome,
        shares: toDecimal(shares),
        costBasis: toDecimal(cost),
      },
      update: {
        shares: { increment: toDecimal(shares) },
        costBasis: { increment: toDecimal(cost) },
      },
      select: { shares: true },
    });

    const { tradeId, priceYesAfter } = await recordTrade(tx, {
      userId,
      marketId,
      outcome,
      side: "BUY",
      shares,
      cost,
      stateAfter,
    });

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true },
    });

    return {
      tradeId,
      marketId,
      outcome,
      side: "BUY" as const,
      shares,
      cost,
      avgPrice: cost / shares,
      balanceAfter: user.balance.toNumber(),
      sharesAfter: position.shares.toNumber(),
      priceYesBefore: priceYes(state),
      priceYesAfter,
    };
  });
}

// ---------------------------------------------------------------------------
// Selling
// ---------------------------------------------------------------------------

/**
 * Sell `shares` of an outcome back to the market maker.
 *
 * There is no shorting: a sell can only ever close part of a position the
 * trader already holds, so the position decrement is the real size check.
 */
export async function sellShares(
  args: {
    userId: string;
    marketId: string;
    outcome: Outcome;
    shares: number;
  } & TradeOptions,
  db: PrismaClient = defaultPrisma,
): Promise<TradeResult> {
  const { userId, marketId, outcome } = args;

  await checkTradeRateLimit(userId, args, db);

  return db.$transaction(async (tx) => {
    const { state } = await lockMarketForTrading(tx, marketId);

    const shares = resolveSize(state, outcome, "SELL", args.shares, undefined);

    // Same conditional-write trick as the balance debit: `gte` in the WHERE
    // clause means we can never sell shares the trader doesn't hold.
    const reduced = await tx.position.updateMany({
      where: { userId, marketId, outcome, shares: { gte: toDecimal(shares) } },
      data: { shares: { decrement: toDecimal(shares) } },
    });
    if (reduced.count === 0) {
      throw new TradeError(
        "INSUFFICIENT_SHARES",
        `you do not hold ${shares} ${outcome} shares in this market`,
      );
    }

    // Proceeds: tradeCost of a negative size is negative (points flowing out of
    // the market maker), so flip the sign for the amount the trader receives.
    const proceeds = roundPoints(-tradeCost(state, outcome, -shares));
    const stateAfter = applyTrade(state, outcome, -shares);

    // costBasis is net points invested — see the schema comment — so proceeds
    // come straight off it. It can go negative once a trader has taken more out
    // than they put in, which is the correct reading of "net".
    const position = await tx.position.update({
      where: { userId_marketId_outcome: { userId, marketId, outcome } },
      data: { costBasis: { decrement: toDecimal(proceeds) } },
      select: { shares: true },
    });

    await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: toDecimal(proceeds) } },
    });

    const { tradeId, priceYesAfter } = await recordTrade(tx, {
      userId,
      marketId,
      outcome,
      side: "SELL",
      shares,
      cost: proceeds,
      stateAfter,
    });

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true },
    });

    return {
      tradeId,
      marketId,
      outcome,
      side: "SELL" as const,
      shares,
      cost: proceeds,
      avgPrice: proceeds / shares,
      balanceAfter: user.balance.toNumber(),
      sharesAfter: position.shares.toNumber(),
      priceYesBefore: priceYes(state),
      priceYesAfter,
    };
  });
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/** Current probability and both prices for a market. */
export async function marketPrices(
  marketId: string,
  db: Db = defaultPrisma,
): Promise<{ yes: number; no: number }> {
  const market = await db.market.findUnique({
    where: { id: marketId },
    select: { b: true, qYes: true, qNo: true },
  });
  if (!market) {
    throw new TradeError("MARKET_NOT_FOUND", `no market with id ${marketId}`);
  }
  return prices({
    qYes: market.qYes.toNumber(),
    qNo: market.qNo.toNumber(),
    b: market.b.toNumber(),
  });
}

/**
 * What a trader's open positions in one market are worth if sold right now,
 * for the portfolio view. Exported here rather than in the page so the mark
 * uses the same engine path as an actual sell.
 */
export async function positionValue(
  args: { userId: string; marketId: string },
  db: Db = defaultPrisma,
): Promise<Array<{ outcome: Outcome; shares: number; costBasis: number; markValue: number }>> {
  const market = await db.market.findUnique({
    where: { id: args.marketId },
    select: { b: true, qYes: true, qNo: true },
  });
  if (!market) {
    throw new TradeError("MARKET_NOT_FOUND", `no market with id ${args.marketId}`);
  }
  const state: MarketState = {
    qYes: market.qYes.toNumber(),
    qNo: market.qNo.toNumber(),
    b: market.b.toNumber(),
  };

  const positions = await db.position.findMany({
    where: { userId: args.userId, marketId: args.marketId, shares: { gt: 0 } },
    select: { outcome: true, shares: true, costBasis: true },
  });

  return positions.map((p) => {
    const shares = p.shares.toNumber();
    return {
      outcome: p.outcome as Outcome,
      shares,
      costBasis: p.costBasis.toNumber(),
      // Liquidation value, net of the slippage the trader would eat on the way out.
      markValue: roundPoints(-tradeCost(state, p.outcome as Outcome, -shares)),
    };
  });
}

/** Re-exported so callers don't need to reach into the engine for a preview. */
export { averagePrice };
