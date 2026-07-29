/**
 * Leaderboard and portfolio aggregates.
 *
 * Ranking is deliberately **not** raw point total. With open registration
 * anyone can farm the board by making many accounts, gambling wildly with each
 * and keeping the lucky ones — a strategy that maximises variance, not skill.
 * Two things blunt it, both from CLAUDE.md:
 *
 *   1. A minimum number of settled markets before an account is ranked at all,
 *      so a single lucky bet cannot reach the top.
 *   2. A Brier score alongside net worth, which measures whether someone's
 *      stated probabilities were actually right rather than whether they got
 *      paid. Being confidently wrong costs you here even if you got lucky once.
 *
 * Read-only.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./db";
import { roundPoints, tradeCost, type MarketState, type Outcome } from "./lmsr";

type Db = PrismaClient | Prisma.TransactionClient;

/** Settled markets a trader must have taken part in before they are ranked. */
export const MIN_SETTLED_FOR_RANK = 3;

export interface LeaderboardEntry {
  userId: string;
  handle: string;
  /** Spendable points. */
  balance: number;
  /** Balance plus what open positions would fetch if sold now. */
  netWorth: number;
  /** netWorth - 10,000. Negative means down on the starting stake. */
  profit: number;
  /** Settled markets this trader had a position in. */
  settledMarkets: number;
  /**
   * Mean squared error between stated probability and outcome, 0–1.
   * Lower is better. Null until they have settled markets to score.
   */
  brier: number | null;
  /** Null when the trader has not yet met the minimum to be ranked. */
  rank: number | null;
}

const STARTING_BALANCE = 10_000;

/**
 * A trader's implied probability for one market, from what they actually paid.
 *
 * Buying YES at 30¢ says "I think this is at least 30% likely"; buying NO at
 * 30¢ says the same about the other side, so it counts as a 70% YES belief.
 * Weighted by shares, so a large conviction bet moves the score more than a
 * token one. Sells are ignored — exiting is a liquidity decision, not a
 * statement about the outcome.
 */
function impliedYesProbability(
  trades: Array<{ outcome: Outcome; side: "BUY" | "SELL"; shares: number; avgPrice: number }>,
): number | null {
  let weighted = 0;
  let weight = 0;

  for (const trade of trades) {
    if (trade.side !== "BUY") continue;
    const belief = trade.outcome === "YES" ? trade.avgPrice : 1 - trade.avgPrice;
    weighted += belief * trade.shares;
    weight += trade.shares;
  }

  if (weight === 0) return null;
  // Clamp: LMSR prices are open on (0,1) but rounding can nudge them out.
  return Math.min(1, Math.max(0, weighted / weight));
}

/**
 * Build the leaderboard.
 *
 * Deliberately computed in one pass over a bounded set of rows rather than in
 * SQL: the mark-to-market step needs the LMSR cost function, which lives in
 * TypeScript. At this scale that is fine. If the trade table ever grows past
 * what fits comfortably in memory, this wants a materialised view refreshed on
 * settlement, not a cleverer query.
 */
export async function getLeaderboard(
  limit = 50,
  db: Db = defaultPrisma,
): Promise<LeaderboardEntry[]> {
  const users = await db.user.findMany({
    select: { id: true, handle: true, name: true, balance: true },
  });

  const markets = await db.market.findMany({
    select: {
      id: true,
      status: true,
      qYes: true,
      qNo: true,
      b: true,
      resolution: { select: { outcome: true } },
    },
  });

  const marketById = new Map(
    markets.map((m) => [
      m.id,
      {
        status: m.status,
        state: { qYes: m.qYes.toNumber(), qNo: m.qNo.toNumber(), b: m.b.toNumber() } as MarketState,
        resolvedOutcome: (m.resolution?.outcome as Outcome | undefined) ?? null,
      },
    ]),
  );

  const positions = await db.position.findMany({
    where: { shares: { gt: 0 } },
    select: { userId: true, marketId: true, outcome: true, shares: true },
  });

  const trades = await db.trade.findMany({
    select: {
      userId: true,
      marketId: true,
      outcome: true,
      side: true,
      shares: true,
      avgPrice: true,
    },
  });

  // Open-position value, per user.
  const openValue = new Map<string, number>();
  // Which settled markets each user took part in.
  const settledByUser = new Map<string, Set<string>>();
  // Trades grouped by user+market, for the Brier calculation.
  const tradesByUserMarket = new Map<
    string,
    Array<{ outcome: Outcome; side: "BUY" | "SELL"; shares: number; avgPrice: number }>
  >();

  for (const position of positions) {
    const market = marketById.get(position.marketId);
    // A settled market's shares have already been paid out or written off, so
    // counting them again would double-count the payout.
    if (!market || market.status !== "OPEN") continue;

    const shares = position.shares.toNumber();
    const value = roundPoints(-tradeCost(market.state, position.outcome as Outcome, -shares));
    openValue.set(position.userId, (openValue.get(position.userId) ?? 0) + value);
  }

  for (const trade of trades) {
    const market = marketById.get(trade.marketId);
    if (!market) continue;

    const key = `${trade.userId}:${trade.marketId}`;
    const list = tradesByUserMarket.get(key) ?? [];
    list.push({
      outcome: trade.outcome as Outcome,
      side: trade.side as "BUY" | "SELL",
      shares: trade.shares.toNumber(),
      avgPrice: trade.avgPrice.toNumber(),
    });
    tradesByUserMarket.set(key, list);

    if (market.status === "RESOLVED" && market.resolvedOutcome) {
      const set = settledByUser.get(trade.userId) ?? new Set<string>();
      set.add(trade.marketId);
      settledByUser.set(trade.userId, set);
    }
  }

  const entries: LeaderboardEntry[] = users.map((user) => {
    const settled = settledByUser.get(user.id) ?? new Set<string>();

    let brierSum = 0;
    let brierCount = 0;
    for (const marketId of settled) {
      const market = marketById.get(marketId);
      if (!market?.resolvedOutcome) continue;

      const belief = impliedYesProbability(tradesByUserMarket.get(`${user.id}:${marketId}`) ?? []);
      if (belief === null) continue;

      const actual = market.resolvedOutcome === "YES" ? 1 : 0;
      brierSum += (belief - actual) ** 2;
      brierCount += 1;
    }

    const balance = user.balance.toNumber();
    const netWorth = roundPoints(balance + (openValue.get(user.id) ?? 0));

    return {
      userId: user.id,
      handle: user.handle ?? user.name ?? "anonymous",
      balance: roundPoints(balance),
      netWorth,
      profit: roundPoints(netWorth - STARTING_BALANCE),
      settledMarkets: settled.size,
      brier: brierCount > 0 ? Math.round((brierSum / brierCount) * 1000) / 1000 : null,
      rank: null,
    };
  });

  // Rank only those who have settled enough markets to have a record worth
  // reading. Everyone else still appears, unranked, so a new trader can find
  // themselves and see how far off qualifying they are.
  const ranked = entries
    .filter((e) => e.settledMarkets >= MIN_SETTLED_FOR_RANK)
    .sort((a, b) => b.profit - a.profit);

  ranked.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  const unranked = entries
    .filter((e) => e.settledMarkets < MIN_SETTLED_FOR_RANK)
    .sort((a, b) => b.profit - a.profit);

  return [...ranked, ...unranked].slice(0, limit);
}

export interface PortfolioHolding {
  marketId: string;
  slug: string;
  question: string;
  status: string;
  outcome: Outcome;
  shares: number;
  costBasis: number;
  markValue: number;
  unrealised: number;
  priceYes: number;
}

/** Every open position a trader holds, marked to market. */
export async function getPortfolio(
  userId: string,
  db: Db = defaultPrisma,
): Promise<PortfolioHolding[]> {
  const positions = await db.position.findMany({
    where: { userId, shares: { gt: 0 } },
    select: {
      marketId: true,
      outcome: true,
      shares: true,
      costBasis: true,
      market: {
        select: { slug: true, question: true, status: true, qYes: true, qNo: true, b: true },
      },
    },
  });

  return positions
    .map((position) => {
      const state: MarketState = {
        qYes: position.market.qYes.toNumber(),
        qNo: position.market.qNo.toNumber(),
        b: position.market.b.toNumber(),
      };
      const shares = position.shares.toNumber();
      const costBasis = position.costBasis.toNumber();
      const outcome = position.outcome as Outcome;

      // A settled market's shares are already cashed out; their live mark is
      // meaningless, so show the payout that actually happened.
      const markValue =
        position.market.status === "RESOLVED"
          ? 0
          : roundPoints(-tradeCost(state, outcome, -shares));

      const d = (state.qNo - state.qYes) / state.b;
      const priceYes = 1 / (1 + Math.exp(d));

      return {
        marketId: position.marketId,
        slug: position.market.slug,
        question: position.market.question,
        status: position.market.status,
        outcome,
        shares,
        costBasis,
        markValue,
        unrealised: roundPoints(markValue - costBasis),
        priceYes,
      };
    })
    .sort((a, b) => b.markValue - a.markValue);
}
