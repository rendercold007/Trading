/**
 * Development seed: a handful of markets with plausible trading history.
 *
 * The point is not just to have rows — it is to have markets whose prices are
 * somewhere other than 50/50 and whose charts have shape, so the list page, the
 * probability chart and the portfolio view can all be judged on realistic data
 * rather than on a flat line at 0.5.
 *
 * Idempotent: markets are upserted by slug and demo traders by email, so
 * re-running it does not duplicate anything. Trades are only generated for
 * markets that have none yet.
 *
 * Never run against production — it creates users with fake emails and hands
 * them points.
 */

import { PrismaClient } from "@prisma/client";

import { loadEnv } from "../src/lib/loadEnv";
import { buyShares } from "../src/lib/trade";

loadEnv();

const prisma = new PrismaClient();

/** Demo traders. Emails are on `.invalid`, which is reserved and undeliverable. */
const TRADERS = [
  { email: "priya@seed.invalid", handle: "priya", name: "Priya" },
  { email: "rahul@seed.invalid", handle: "rahul", name: "Rahul" },
  { email: "sam@seed.invalid", handle: "sam", name: "Sam" },
  { email: "mei@seed.invalid", handle: "mei", name: "Mei" },
  { email: "tomas@seed.invalid", handle: "tomas", name: "Tomás" },
];

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

interface SeedMarket {
  slug: string;
  question: string;
  rules: string;
  category: string;
  closesAt: Date;
  /** Roughly where trading should leave the price, as a sanity target. */
  targetProbability: number;
  /** How much trading activity to simulate. */
  activity: "light" | "medium" | "heavy";
}

const MARKETS: SeedMarket[] = [
  {
    slug: "india-win-toss-2026-08-01",
    question: "Will India win the toss in the first Test on 1 August 2026?",
    rules:
      "Resolves YES if India wins the coin toss in the first Test match beginning 1 August 2026, as reported by the official ICC match scorecard. Resolves NO otherwise. If the match is cancelled or the toss does not take place, the market is voided.",
    category: "Cricket",
    closesAt: days(3),
    targetProbability: 0.5,
    activity: "heavy",
  },
  {
    slug: "btc-above-100k-2026",
    question: "Will Bitcoin trade above $100,000 before the end of 2026?",
    rules:
      "Resolves YES if the BTC/USD price on Coinbase exceeds $100,000 at any point before 23:59 UTC on 31 December 2026, per Coinbase's published historical data. Wicks count. Resolves NO otherwise.",
    category: "Crypto",
    closesAt: days(45),
    targetProbability: 0.31,
    activity: "medium",
  },
  {
    slug: "monsoon-above-normal-2026",
    question: "Will the 2026 monsoon be above normal in India?",
    rules:
      "Resolves YES if the IMD's end-of-season report classifies the 2026 southwest monsoon rainfall as 'above normal' (above 104% of the long period average). Resolves NO for any other classification.",
    category: "Weather",
    closesAt: days(60),
    targetProbability: 0.62,
    activity: "medium",
  },
  {
    slug: "nifty-above-25000-august",
    question: "Will the Nifty 50 close above 25,000 on the last trading day of August 2026?",
    rules:
      "Resolves YES if the official NSE closing value of the Nifty 50 index on the final trading day of August 2026 is strictly greater than 25,000. Resolves NO otherwise.",
    category: "Markets",
    closesAt: days(14),
    targetProbability: 0.44,
    activity: "light",
  },
  {
    slug: "chess-world-champion-defends-2026",
    question: "Will the reigning champion retain the World Chess Championship in 2026?",
    rules:
      "Resolves YES if the defending champion retains the title in the 2026 World Chess Championship match, including by drawn match under FIDE tiebreak rules. Resolves NO if the challenger wins.",
    category: "Sport",
    closesAt: days(90),
    targetProbability: 0.71,
    activity: "light",
  },
  {
    slug: "heatwave-delhi-july-2026",
    question: "Did Delhi record a temperature above 45°C in July 2026?",
    rules:
      "Resolves YES if the IMD Safdarjung observatory recorded a maximum temperature strictly above 45.0°C on any day in July 2026. Resolves NO otherwise.",
    category: "Weather",
    // Already past — gives the UI a closed market to render.
    closesAt: days(-1),
    targetProbability: 0.28,
    activity: "light",
  },
];

const TRADE_COUNT = { light: 6, medium: 14, heavy: 26 } as const;

/**
 * Deterministic pseudo-random, so re-seeding a fresh database twice produces the
 * same charts. Makes "did my change break the chart?" answerable by eye.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

async function upsertTraders(): Promise<string[]> {
  const ids: string[] = [];

  for (const trader of TRADERS) {
    const user = await prisma.user.upsert({
      where: { email: trader.email },
      update: {},
      create: {
        email: trader.email,
        name: trader.name,
        handle: trader.handle,
        balance: 10_000,
      },
      select: { id: true },
    });
    ids.push(user.id);
  }

  return ids;
}

/**
 * Simulate trading that walks the price toward `targetProbability`.
 *
 * Each step buys the side the target is on, sized by how far the price still has
 * to travel, with noise so the chart wobbles instead of sweeping smoothly. It
 * goes through the real trade service — the seeded state is therefore reachable
 * by ordinary trading, which a direct `qYes` write would not guarantee.
 */
async function simulateTrading(
  marketId: string,
  traderIds: string[],
  market: SeedMarket,
  random: () => number,
): Promise<void> {
  const steps = TRADE_COUNT[market.activity];

  for (let i = 0; i < steps; i++) {
    const { priceYes } = await currentPrice(marketId);
    const gap = market.targetProbability - priceYes;

    // Mostly trade toward the target, but let a quarter of trades push back so
    // the chart has genuine two-sided action.
    const contrarian = random() < 0.25;
    const direction = contrarian ? -Math.sign(gap) : Math.sign(gap);
    const outcome = direction >= 0 ? "YES" : "NO";

    const magnitude = Math.abs(gap) * (contrarian ? 0.3 : 1);
    const shares = Math.max(5, Math.round((20 + magnitude * 900) * (0.5 + random())));

    const trader = traderIds[Math.floor(random() * traderIds.length)];

    try {
      await buyShares(
        { userId: trader, marketId, outcome, shares, skipRateLimit: true },
        prisma,
      );
    } catch {
      // A trader running out of points mid-simulation is fine; skip and move on.
    }
  }
}

async function currentPrice(marketId: string): Promise<{ priceYes: number }> {
  const market = await prisma.market.findUniqueOrThrow({
    where: { id: marketId },
    select: { qYes: true, qNo: true, b: true },
  });
  const d = (market.qNo.toNumber() - market.qYes.toNumber()) / market.b.toNumber();
  return { priceYes: 1 / (1 + Math.exp(d)) };
}

async function main(): Promise<void> {
  console.log("Seeding…");

  // Markets need a creator, and creation is admin-only. Prefer a real admin if
  // one has signed in; otherwise make a placeholder so seeding works on a fresh
  // database before anyone has logged in.
  const admin =
    (await prisma.user.findFirst({ where: { isAdmin: true }, select: { id: true } })) ??
    (await prisma.user.upsert({
      where: { email: "admin@seed.invalid" },
      update: {},
      create: {
        email: "admin@seed.invalid",
        name: "Seed Admin",
        handle: "seed-admin",
        isAdmin: true,
      },
      select: { id: true },
    }));

  const traderIds = await upsertTraders();
  console.log(`  ${traderIds.length} demo traders`);

  for (const [index, market] of MARKETS.entries()) {
    // A market whose close time has already passed cannot be traded — the trade
    // service refuses it, correctly. So build every market with a future close
    // time, simulate, then move the clock back at the end for the ones that are
    // meant to look finished.
    const isPastDated = market.closesAt.getTime() <= Date.now();
    const tradeableUntil = isPastDated ? days(1) : market.closesAt;

    const row = await prisma.market.upsert({
      where: { slug: market.slug },
      update: {
        question: market.question,
        rules: market.rules,
        category: market.category,
        closesAt: tradeableUntil,
        status: "OPEN",
      },
      create: {
        slug: market.slug,
        question: market.question,
        rules: market.rules,
        category: market.category,
        closesAt: tradeableUntil,
        creatorId: admin.id,
      },
      select: { id: true, tradeCount: true },
    });

    if (row.tradeCount > 0) {
      console.log(`  ${market.slug} — already has trades, left alone`);
      continue;
    }

    await simulateTrading(row.id, traderIds, market, makeRandom(index * 7919 + 1));

    if (isPastDated) {
      await prisma.market.update({
        where: { id: row.id },
        data: { closesAt: market.closesAt, status: "CLOSED" },
      });
    }

    const { priceYes } = await currentPrice(row.id);
    console.log(
      `  ${market.slug} — ${(priceYes * 100).toFixed(0)}% ` +
        `(target ${(market.targetProbability * 100).toFixed(0)}%)`,
    );
  }

  // The past-dated market should not still be accepting trades.
  await prisma.market.updateMany({
    where: { closesAt: { lt: new Date() }, status: "OPEN" },
    data: { status: "CLOSED" },
  });

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
