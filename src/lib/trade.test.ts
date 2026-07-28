/**
 * Trade service tests. These hit a real Postgres — the whole point of the
 * service is its transactional behaviour, which an in-memory fake would not
 * exercise. Every test builds its own market and users under a unique prefix
 * and tears them down afterwards, so runs don't collide with seed data.
 *
 * Requires the local database (see CLAUDE.md): docker start market-db
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { buyShares, sellShares, quoteTrade, marketPrices, positionValue, TradeError } from "./trade";
import { priceYes, tradeCost } from "./lmsr";
import { loadEnv } from "./loadEnv";

loadEnv();

const prisma = new PrismaClient();

/** Everything this file creates is tagged with this so cleanup is exact. */
const RUN = `test-${randomUUID().slice(0, 8)}`;

async function makeUser(balance = 10000): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${randomUUID()}@example.test`, balance, name: "Test Trader" },
    select: { id: true },
  });
  return user.id;
}

async function makeMarket(
  opts: { b?: number; status?: "OPEN" | "CLOSED" | "RESOLVED"; closesAt?: Date } = {},
): Promise<string> {
  const creatorId = await makeUser();
  const market = await prisma.market.create({
    data: {
      slug: `${RUN}-${randomUUID().slice(0, 8)}`,
      question: "Does the trade service work?",
      rules: "Resolves YES if the tests pass.",
      b: opts.b ?? 500,
      status: opts.status ?? "OPEN",
      closesAt: opts.closesAt ?? new Date(Date.now() + 86_400_000),
      creatorId,
    },
    select: { id: true },
  });
  return market.id;
}

async function balanceOf(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { balance: true },
  });
  return user.balance.toNumber();
}

async function sharesOf(userId: string, marketId: string, outcome: "YES" | "NO"): Promise<number> {
  const position = await prisma.position.findUnique({
    where: { userId_marketId_outcome: { userId, marketId, outcome } },
    select: { shares: true },
  });
  return position?.shares.toNumber() ?? 0;
}

before(async () => {
  // Fail loudly and early rather than letting every test time out.
  await prisma.$queryRaw`SELECT 1`;
});

after(async () => {
  await prisma.market.deleteMany({ where: { slug: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.$disconnect();
});

describe("buyShares", () => {
  it("debits points, credits shares and moves the price", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    const before = await balanceOf(userId);
    const result = await buyShares({ userId, marketId, outcome: "YES", shares: 100 }, prisma);

    assert.equal(result.side, "BUY");
    assert.equal(result.shares, 100);
    assert.ok(result.cost > 0, "a buy must cost points");
    assert.equal(result.sharesAfter, 100);
    assert.equal(result.balanceAfter, before - result.cost);
    assert.equal(await balanceOf(userId), before - result.cost);

    // A fresh market sits at 0.5; buying YES must push it up.
    assert.ok(Math.abs(result.priceYesBefore - 0.5) < 1e-9);
    assert.ok(result.priceYesAfter > result.priceYesBefore);
  });

  it("writes market state, a trade row and a price point together", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    const result = await buyShares({ userId, marketId, outcome: "NO", shares: 50 }, prisma);

    const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.equal(market.qNo.toNumber(), 50);
    assert.equal(market.qYes.toNumber(), 0);
    assert.equal(market.tradeCount, 1);
    assert.equal(market.volume.toNumber(), result.cost);

    const trades = await prisma.trade.findMany({ where: { marketId } });
    assert.equal(trades.length, 1);
    assert.equal(trades[0].side, "BUY");
    assert.equal(trades[0].outcome, "NO");
    assert.equal(trades[0].shares.toNumber(), 50);
    assert.equal(trades[0].qNoAfter.toNumber(), 50);

    const points = await prisma.pricePoint.findMany({ where: { marketId } });
    assert.equal(points.length, 1);
    assert.ok(points[0].priceYes.toNumber() < 0.5, "buying NO lowers the YES price");
  });

  it("charges the LMSR cost, matching the pure engine", async () => {
    const marketId = await makeMarket({ b: 500 });
    const userId = await makeUser();

    const expected = tradeCost({ qYes: 0, qNo: 0, b: 500 }, "YES", 250);
    const result = await buyShares({ userId, marketId, outcome: "YES", shares: 250 }, prisma);

    assert.ok(Math.abs(result.cost - expected) < 1e-4);
  });

  it("spends at most the given budget", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    const result = await buyShares({ userId, marketId, outcome: "YES", budget: 500 }, prisma);

    assert.ok(result.cost <= 500, `cost ${result.cost} must not exceed the 500 point budget`);
    assert.ok(result.cost > 499, "and should get close to it");
    assert.ok(result.shares > 500, "at a price near 0.5, 500 points buys ~1000 shares");
  });

  it("accumulates into an existing position rather than creating a second one", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    await buyShares({ userId, marketId, outcome: "YES", shares: 30 }, prisma);
    const second = await buyShares({ userId, marketId, outcome: "YES", shares: 20 }, prisma);

    assert.equal(second.sharesAfter, 50);
    const positions = await prisma.position.findMany({ where: { userId, marketId } });
    assert.equal(positions.length, 1);
    assert.equal(positions[0].shares.toNumber(), 50);
  });

  it("costs more per share the more you buy — slippage is real", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    const small = await buyShares({ userId, marketId, outcome: "YES", shares: 10 }, prisma);
    const large = await buyShares({ userId, marketId, outcome: "YES", shares: 400 }, prisma);

    assert.ok(large.avgPrice > small.avgPrice);
  });
});

describe("buyShares rejections", () => {
  it("refuses a trade the trader cannot afford, leaving nothing behind", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser(10);

    await assert.rejects(
      () => buyShares({ userId, marketId, outcome: "YES", shares: 1000 }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "INSUFFICIENT_BALANCE",
    );

    assert.equal(await balanceOf(userId), 10);
    const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.equal(market.qYes.toNumber(), 0, "a failed trade must not move the market");
    assert.equal(market.tradeCount, 0);
    assert.equal(await prisma.trade.count({ where: { marketId } }), 0);
    assert.equal(await prisma.pricePoint.count({ where: { marketId } }), 0);
  });

  it("refuses to trade a closed market", async () => {
    const marketId = await makeMarket({ status: "CLOSED" });
    const userId = await makeUser();

    await assert.rejects(
      () => buyShares({ userId, marketId, outcome: "YES", shares: 10 }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "MARKET_CLOSED",
    );
  });

  it("refuses to trade past the close time even while status is OPEN", async () => {
    const marketId = await makeMarket({ closesAt: new Date(Date.now() - 1000) });
    const userId = await makeUser();

    await assert.rejects(
      () => buyShares({ userId, marketId, outcome: "YES", shares: 10 }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "MARKET_CLOSED",
    );
  });

  it("rejects sizes below the minimum and ambiguous sizing", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    await assert.rejects(
      () => buyShares({ userId, marketId, outcome: "YES", shares: 0.001 }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "INVALID_SIZE",
    );
    await assert.rejects(
      () => buyShares({ userId, marketId, outcome: "YES", shares: -5 }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "INVALID_SIZE",
    );
    await assert.rejects(
      () => buyShares({ userId, marketId, outcome: "YES", shares: 10, budget: 10 }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "INVALID_SIZE",
    );
    await assert.rejects(
      () => buyShares({ userId, marketId, outcome: "YES" }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "INVALID_SIZE",
    );
  });

  it("reports a missing market and a missing user distinctly", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    await assert.rejects(
      () => buyShares({ userId, marketId: "nonexistent", outcome: "YES", shares: 10 }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "MARKET_NOT_FOUND",
    );
    await assert.rejects(
      () => buyShares({ userId: "nonexistent", marketId, outcome: "YES", shares: 10 }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "USER_NOT_FOUND",
    );
  });
});

describe("sellShares", () => {
  it("returns points, reduces the position and moves the price back", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    const bought = await buyShares({ userId, marketId, outcome: "YES", shares: 100 }, prisma);
    const midBalance = await balanceOf(userId);

    const sold = await sellShares({ userId, marketId, outcome: "YES", shares: 40 }, prisma);

    assert.equal(sold.side, "SELL");
    assert.ok(sold.cost > 0, "proceeds are reported positive");
    assert.equal(sold.sharesAfter, 60);
    assert.equal(await balanceOf(userId), midBalance + sold.cost);
    assert.ok(sold.priceYesAfter < bought.priceYesAfter, "selling YES pushes the price down");

    const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.equal(market.qYes.toNumber(), 60);
    assert.equal(market.tradeCount, 2);
  });

  it("round-trips to break-even — LMSR is path independent, there is no spread", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();
    const start = await balanceOf(userId);

    await buyShares({ userId, marketId, outcome: "YES", shares: 200 }, prisma);
    await sellShares({ userId, marketId, outcome: "YES", shares: 200 }, prisma);

    // Cost depends only on start and end state, so an untouched round trip
    // returns exactly what it cost. Only 4dp storage rounding separates them.
    const end = await balanceOf(userId);
    assert.ok(Math.abs(end - start) < 0.01, `expected break-even, drifted by ${end - start}`);

    const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.equal(market.qYes.toNumber(), 0, "the market returns to its starting state");
    assert.ok(market.volume.toNumber() > 0, "both legs count toward volume");
  });

  it("is profitable only if the price moved in between", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();
    const other = await makeUser();
    const start = await balanceOf(userId);

    await buyShares({ userId, marketId, outcome: "YES", shares: 200 }, prisma);
    await buyShares({ userId: other, marketId, outcome: "YES", shares: 800 }, prisma);
    await sellShares({ userId, marketId, outcome: "YES", shares: 200 }, prisma);

    assert.ok(await balanceOf(userId) > start, "selling into a risen price should pay");
  });

  it("refuses to sell more shares than are held, changing nothing", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    await buyShares({ userId, marketId, outcome: "YES", shares: 50 }, prisma);
    const balance = await balanceOf(userId);

    await assert.rejects(
      () => sellShares({ userId, marketId, outcome: "YES", shares: 51 }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "INSUFFICIENT_SHARES",
    );

    assert.equal(await sharesOf(userId, marketId, "YES"), 50);
    assert.equal(await balanceOf(userId), balance);
    assert.equal(await prisma.trade.count({ where: { marketId } }), 1);
  });

  it("refuses to sell a side the trader has no position in", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    await buyShares({ userId, marketId, outcome: "YES", shares: 50 }, prisma);

    await assert.rejects(
      () => sellShares({ userId, marketId, outcome: "NO", shares: 1 }, prisma),
      (err: unknown) => err instanceof TradeError && err.code === "INSUFFICIENT_SHARES",
    );
  });
});

describe("concurrency", () => {
  it("serialises simultaneous trades on one market without losing any", async () => {
    const marketId = await makeMarket();
    const traders = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser(), makeUser()]);

    // Fired together, these all read the market at once under READ COMMITTED.
    // Without the FOR UPDATE lock the later writes would clobber the earlier
    // ones and qYes would end well below 250.
    await Promise.all(
      traders.map((userId) => buyShares({ userId, marketId, outcome: "YES", shares: 50 }, prisma)),
    );

    const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.equal(market.qYes.toNumber(), 250);
    assert.equal(market.tradeCount, 5);
    assert.equal(await prisma.trade.count({ where: { marketId } }), 5);
    assert.equal(await prisma.pricePoint.count({ where: { marketId } }), 5);
  });

  it("does not let one user's points be spent twice across markets", async () => {
    const [marketA, marketB] = await Promise.all([makeMarket(), makeMarket()]);
    const userId = await makeUser(100);

    // Each trade alone is affordable; both together are not. The market locks
    // don't help here (different markets), so the conditional balance decrement
    // has to be what stops it.
    const results = await Promise.allSettled([
      buyShares({ userId, marketId: marketA, outcome: "YES", budget: 80 }, prisma),
      buyShares({ userId, marketId: marketB, outcome: "YES", budget: 80 }, prisma),
    ]);

    const settled = results.filter((r) => r.status === "fulfilled").length;
    assert.ok(settled >= 1, "at least one trade should succeed");
    assert.ok(await balanceOf(userId) >= 0, "balance must never go negative");
  });
});

describe("quoteTrade", () => {
  it("predicts the cost of the trade that follows it", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();

    const quote = await quoteTrade({ marketId, outcome: "YES", side: "BUY", shares: 120 }, prisma);
    const actual = await buyShares({ userId, marketId, outcome: "YES", shares: 120 }, prisma);

    assert.equal(quote.shares, actual.shares);
    assert.ok(Math.abs(quote.cost - actual.cost) < 1e-4);
    assert.ok(Math.abs(quote.priceYesAfter - actual.priceYesAfter) < 1e-9);
  });

  it("quotes a sell without needing a position", async () => {
    const marketId = await makeMarket();
    const quote = await quoteTrade({ marketId, outcome: "YES", side: "SELL", shares: 10 }, prisma);

    assert.equal(quote.side, "SELL");
    assert.ok(quote.cost > 0);
    assert.ok(quote.priceYesAfter < quote.priceYesBefore);
  });

  it("changes nothing in the database", async () => {
    const marketId = await makeMarket();
    await quoteTrade({ marketId, outcome: "YES", side: "BUY", shares: 100 }, prisma);

    const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.equal(market.qYes.toNumber(), 0);
    assert.equal(market.tradeCount, 0);
  });
});

describe("read helpers", () => {
  it("reports prices that sum to 1 and track the engine", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();
    await buyShares({ userId, marketId, outcome: "YES", shares: 300 }, prisma);

    const { yes, no } = await marketPrices(marketId, prisma);
    assert.ok(Math.abs(yes + no - 1) < 1e-12);
    assert.ok(Math.abs(yes - priceYes({ qYes: 300, qNo: 0, b: 500 })) < 1e-9);
  });

  it("marks a position at what selling it now would actually return", async () => {
    const marketId = await makeMarket();
    const userId = await makeUser();
    const bought = await buyShares({ userId, marketId, outcome: "YES", shares: 200 }, prisma);

    const [position] = await positionValue({ userId, marketId }, prisma);
    assert.equal(position.outcome, "YES");
    assert.equal(position.shares, 200);
    assert.equal(position.costBasis, bought.cost);
    // Nobody else has traded, so the exit value is still the entry cost.
    assert.ok(Math.abs(position.markValue - position.costBasis) < 0.01);

    // Once someone pushes the price up, the mark follows it.
    const other = await makeUser();
    await buyShares({ userId: other, marketId, outcome: "YES", shares: 500 }, prisma);
    const [after] = await positionValue({ userId, marketId }, prisma);
    assert.ok(after.markValue > position.markValue, "a rising price marks the position up");
  });
});
