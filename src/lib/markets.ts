/**
 * Market reads for the UI.
 *
 * Pages and components go through here rather than reaching for Prisma
 * directly, for two reasons: `Decimal` and `Date` are converted to plain
 * numbers once, in one place (a `Decimal` handed to a client component throws
 * at the serialisation boundary), and the LMSR price is always derived through
 * `src/lib/lmsr.ts` instead of being recomputed inline in a component.
 *
 * Read-only. Anything that writes belongs in `src/lib/trade.ts`.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./db";
import { priceYes as lmsrPriceYes, roundPoints, tradeCost, type MarketState } from "./lmsr";
import type { Outcome } from "./lmsr";

type Db = PrismaClient | Prisma.TransactionClient;

export type MarketStatus = "OPEN" | "CLOSED" | "RESOLVED" | "VOIDED";

export interface MarketSummary {
  id: string;
  slug: string;
  question: string;
  category: string | null;
  status: MarketStatus;
  /** Milliseconds since epoch — safe to hand to a client component. */
  closesAt: number;
  /** Current implied probability of YES, 0–1. */
  priceYes: number;
  volume: number;
  tradeCount: number;
  /** Set only once resolved. */
  resolvedOutcome: Outcome | null;
  /**
   * Downsampled YES-price path for the card sparkline, oldest first. Never
   * empty — a market with no trades gets its opening 50/50 as a single point.
   */
  spark: PricePoint[];
  /**
   * Change in `priceYes` over the trailing 24 hours (or since open, for a
   * younger market). Null when the market has never traded — "hasn't moved"
   * and "nothing has happened yet" deserve different UI.
   */
  delta24h: number | null;
}

export interface PricePoint {
  t: number;
  priceYes: number;
}

export interface MarketDetail extends MarketSummary {
  rules: string;
  b: number;
  qYes: number;
  qNo: number;
  createdAt: number;
  history: PricePoint[];
  resolution: {
    outcome: Outcome;
    reason: string;
    resolvedAt: number;
    resolvedBy: string | null;
    totalPaidOut: number;
  } | null;
}

/** A viewer's stake in one market, marked at what selling now would return. */
export interface HeldPosition {
  outcome: Outcome;
  shares: number;
  costBasis: number;
  /** Points returned by selling the whole position right now. */
  markValue: number;
  /** `markValue - costBasis`. Negative is a loss. */
  unrealised: number;
}

/** Trading is refused past `closesAt` even while status still reads OPEN. */
export function isTradeable(market: Pick<MarketSummary, "status" | "closesAt">): boolean {
  return market.status === "OPEN" && market.closesAt > Date.now();
}

const SUMMARY_SELECT = {
  id: true,
  slug: true,
  question: true,
  category: true,
  status: true,
  closesAt: true,
  createdAt: true,
  volume: true,
  tradeCount: true,
  qYes: true,
  qNo: true,
  b: true,
  resolution: { select: { outcome: true } },
} satisfies Prisma.MarketSelect;

type SummaryRow = Prisma.MarketGetPayload<{ select: typeof SUMMARY_SELECT }>;

function toState(row: { qYes: Prisma.Decimal; qNo: Prisma.Decimal; b: Prisma.Decimal }): MarketState {
  return { qYes: row.qYes.toNumber(), qNo: row.qNo.toNumber(), b: row.b.toNumber() };
}

/** Points a card sparkline keeps. Enough to show shape; small enough to inline in HTML. */
const SPARK_POINTS = 32;

/**
 * Evenly thin a series to at most `max` points, always keeping the first and
 * last. The sparkline wants the shape of the path, not every trade.
 */
export function downsample<T>(points: T[], max: number): T[] {
  if (max < 2 || points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/**
 * Change in YES price over the trailing 24 hours.
 *
 * The baseline is the price in effect at the cutoff — the last trade at or
 * before it. With no trade that old, the baseline is the opening 50/50 (every
 * market opens at even odds; `q` starts at zero), which also gives a market
 * younger than a day its natural "since open" reading. `history` must be
 * sorted oldest-first.
 */
export function trailingDelta(
  history: PricePoint[],
  currentPriceYes: number,
  now: number = Date.now(),
): number {
  const cutoff = now - 86_400_000;
  let baseline = 0.5;
  for (const p of history) {
    if (p.t > cutoff) break;
    baseline = p.priceYes;
  }
  return currentPriceYes - baseline;
}

function toSummary(row: SummaryRow, history: PricePoint[]): MarketSummary {
  const priceYes = lmsrPriceYes(toState(row));

  // The spark spans the market's *trading life* — first trade to last — not
  // first trade to now. Padding it out to "now" was tried and compresses the
  // whole path into the left edge of the box the moment a market goes quiet
  // for a few days, leaving a dead flat line. The last recorded point is
  // always the current price anyway: price only moves on a trade, and every
  // trade appends a PricePoint.
  const spark =
    history.length === 0
      ? [{ t: row.createdAt.getTime(), priceYes: 0.5 }]
      : downsample(history, SPARK_POINTS);

  return {
    id: row.id,
    slug: row.slug,
    question: row.question,
    category: row.category,
    status: row.status as MarketStatus,
    closesAt: row.closesAt.getTime(),
    priceYes,
    volume: row.volume.toNumber(),
    tradeCount: row.tradeCount,
    resolvedOutcome: (row.resolution?.outcome as Outcome | undefined) ?? null,
    spark,
    delta24h: row.tradeCount > 0 ? trailingDelta(history, priceYes) : null,
  };
}

/**
 * Markets for the list page.
 *
 * Ordered so the page is useful without any filtering: tradeable markets first,
 * then the ones closing soonest, since an imminent close is what makes a market
 * worth looking at now. Settled markets sink to the bottom.
 */
export async function listMarkets(
  opts: { status?: MarketStatus; category?: string; limit?: number } = {},
  db: Db = defaultPrisma,
): Promise<MarketSummary[]> {
  const rows = await db.market.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.category ? { category: opts.category } : {}),
    },
    select: SUMMARY_SELECT,
    orderBy: [{ status: "asc" }, { closesAt: "asc" }],
    take: opts.limit ?? 100,
  });

  // Price history for every listed market in one query, not one per market.
  // Fetching *all* points is fine at this scale (one row per trade); if the
  // table ever gets heavy, this wants a windowed query or a cached spark
  // column on Market — do not turn it into an N+1.
  const points = await db.pricePoint.findMany({
    where: { marketId: { in: rows.map((r) => r.id) } },
    select: { marketId: true, priceYes: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const historyByMarket = new Map<string, PricePoint[]>();
  for (const p of points) {
    const list = historyByMarket.get(p.marketId) ?? [];
    list.push({ t: p.createdAt.getTime(), priceYes: p.priceYes.toNumber() });
    historyByMarket.set(p.marketId, list);
  }

  const summaries = rows.map((row) => toSummary(row, historyByMarket.get(row.id) ?? []));

  // `status` is an enum ordered OPEN, CLOSED, RESOLVED, VOIDED, which happens to
  // be the order we want — but relying on the declaration order of an enum is
  // fragile, so make the intent explicit here.
  const rank: Record<MarketStatus, number> = { OPEN: 0, CLOSED: 1, RESOLVED: 2, VOIDED: 3 };
  return summaries.sort(
    (a, b) => rank[a.status] - rank[b.status] || a.closesAt - b.closesAt,
  );
}

/** Distinct categories present, for a filter row. */
export async function listCategories(db: Db = defaultPrisma): Promise<string[]> {
  const rows = await db.market.findMany({
    where: { category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category!).filter(Boolean);
}

export interface MarketStats {
  openMarkets: number;
  /** Sum of `Market.volume` — points that have changed hands, both directions. */
  pointsTraded: number;
  tradesPlaced: number;
  /** People who have ever placed a trade, not sign-ups — activity, not registrations. */
  traders: number;
}

/** Site-wide totals for the dashboard header. */
export async function marketStats(db: Db = defaultPrisma): Promise<MarketStats> {
  const [openMarkets, sums, traderRows] = await Promise.all([
    db.market.count({ where: { status: "OPEN" } }),
    db.market.aggregate({ _sum: { volume: true, tradeCount: true } }),
    // One row per distinct trader. Fine at this scale; becomes a raw
    // `COUNT(DISTINCT "userId")` if the Trade table ever gets big.
    db.trade.findMany({ distinct: ["userId"], select: { userId: true } }),
  ]);

  return {
    openMarkets,
    pointsTraded: sums._sum.volume?.toNumber() ?? 0,
    tradesPlaced: sums._sum.tradeCount ?? 0,
    traders: traderRows.length,
  };
}

/** One market with everything the detail page renders. Null if the slug is unknown. */
export async function getMarketBySlug(
  slug: string,
  db: Db = defaultPrisma,
): Promise<MarketDetail | null> {
  const row = await db.market.findUnique({
    where: { slug },
    select: {
      ...SUMMARY_SELECT,
      rules: true,
      createdAt: true,
      resolution: {
        select: {
          outcome: true,
          reason: true,
          resolvedAt: true,
          totalPaidOut: true,
          resolvedBy: { select: { handle: true, name: true } },
        },
      },
    },
  });
  if (!row) return null;

  const historyRows = await db.pricePoint.findMany({
    where: { marketId: row.id },
    select: { priceYes: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  const history = historyRows.map((p) => ({
    t: p.createdAt.getTime(),
    priceYes: p.priceYes.toNumber(),
  }));

  const state = toState(row);

  return {
    ...toSummary(
      { ...row, resolution: row.resolution ? { outcome: row.resolution.outcome } : null },
      history,
    ),
    rules: row.rules,
    b: state.b,
    qYes: state.qYes,
    qNo: state.qNo,
    createdAt: row.createdAt.getTime(),
    // A market with no trades has no price points, but the chart should still
    // start somewhere — seed it with the opening 50/50.
    history: history.length > 0 ? history : [{ t: row.createdAt.getTime(), priceYes: 0.5 }],
    resolution: row.resolution
      ? {
          outcome: row.resolution.outcome as Outcome,
          reason: row.resolution.reason,
          resolvedAt: row.resolution.resolvedAt.getTime(),
          resolvedBy: row.resolution.resolvedBy?.handle ?? row.resolution.resolvedBy?.name ?? null,
          totalPaidOut: row.resolution.totalPaidOut.toNumber(),
        }
      : null,
  };
}

/**
 * A viewer's positions in one market, marked to market.
 *
 * The mark is the liquidation value — what the AMM would actually pay for the
 * whole position right now, slippage included — not `shares × price`. On a
 * large holding those differ enough to matter, and quoting the optimistic one
 * would overstate every portfolio on the site.
 */
export async function getPositions(
  userId: string,
  marketId: string,
  db: Db = defaultPrisma,
): Promise<HeldPosition[]> {
  const market = await db.market.findUnique({
    where: { id: marketId },
    select: { qYes: true, qNo: true, b: true },
  });
  if (!market) return [];

  const state = toState(market);
  const rows = await db.position.findMany({
    where: { userId, marketId, shares: { gt: 0 } },
    select: { outcome: true, shares: true, costBasis: true },
  });

  return rows.map((row) => {
    const shares = row.shares.toNumber();
    const costBasis = row.costBasis.toNumber();
    const markValue = roundPoints(-tradeCost(state, row.outcome as Outcome, -shares));
    return {
      outcome: row.outcome as Outcome,
      shares,
      costBasis,
      markValue,
      unrealised: roundPoints(markValue - costBasis),
    };
  });
}

/** Recent trades in a market, for an activity feed on the detail page. */
export async function recentTrades(
  marketId: string,
  limit = 15,
  db: Db = defaultPrisma,
): Promise<
  Array<{
    id: string;
    handle: string;
    outcome: Outcome;
    side: "BUY" | "SELL";
    shares: number;
    cost: number;
    priceYesAfter: number;
    at: number;
  }>
> {
  const rows = await db.trade.findMany({
    where: { marketId },
    select: {
      id: true,
      outcome: true,
      side: true,
      shares: true,
      cost: true,
      priceYesAfter: true,
      createdAt: true,
      user: { select: { handle: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    handle: row.user.handle ?? row.user.name ?? "someone",
    outcome: row.outcome as Outcome,
    side: row.side as "BUY" | "SELL",
    shares: row.shares.toNumber(),
    cost: row.cost.toNumber(),
    priceYesAfter: row.priceYesAfter.toNumber(),
    at: row.createdAt.getTime(),
  }));
}
