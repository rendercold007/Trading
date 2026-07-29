/**
 * Settlement tests. Real Postgres — the idempotency guard is a row lock plus a
 * status check inside a transaction, which cannot be tested any other way.
 *
 * Requires the local database (see CLAUDE.md): docker start market-db
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { ResolveError, closeMarket, resolveMarket, voidMarket } from "./resolve";
import { buyShares } from "./trade";
import { loadEnv } from "./loadEnv";

loadEnv();

const prisma = new PrismaClient();
const RUN = `restest-${randomUUID().slice(0, 8)}`;
const createdUserIds: string[] = [];

async function makeUser(balance = 10000): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${randomUUID()}@example.test`, balance },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeMarket(): Promise<string> {
  const creatorId = await makeUser();
  const market = await prisma.market.create({
    data: {
      slug: `${RUN}-${randomUUID().slice(0, 8)}`,
      question: "Does settlement work?",
      rules: "Resolves YES if it does.",
      closesAt: new Date(Date.now() + 86_400_000),
      creatorId,
    },
    select: { id: true },
  });
  return market.id;
}

const balanceOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance.toNumber();

after(async () => {
  await prisma.market.deleteMany({ where: { slug: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.rateLimit.deleteMany({
    where: { key: { in: createdUserIds.map((id) => `trade:${id}`) } },
  });
  await prisma.$disconnect();
});

describe("resolveMarket", () => {
  it("pays winners 1 point per share and nothing to losers", async () => {
    const marketId = await makeMarket();
    const winner = await makeUser();
    const loser = await makeUser();

    const bought = await buyShares(
      { userId: winner, marketId, outcome: "YES", shares: 100, skipRateLimit: true },
      prisma,
    );
    await buyShares(
      { userId: loser, marketId, outcome: "NO", shares: 80, skipRateLimit: true },
      prisma,
    );

    const winnerBefore = await balanceOf(winner);
    const loserBefore = await balanceOf(loser);

    const result = await resolveMarket(
      {
        marketId,
        outcome: "YES",
        reason: "Confirmed by the official scorecard at example.com/result",
        resolvedById: winner,
      },
      prisma,
    );

    assert.equal(result.totalPaidOut, 100, "100 winning shares pay 100 points");
    assert.equal(result.paidUsers, 1);
    assert.equal(await balanceOf(winner), winnerBefore + 100);
    assert.equal(await balanceOf(loser), loserBefore, "losing shares pay nothing");

    // The winner should be up overall: they paid less than 1 point per share.
    assert.ok(100 > bought.cost, "winning shares cost under a point each");
  });

  it("writes an auditable Resolution row", async () => {
    const marketId = await makeMarket();
    const admin = await makeUser();
    await buyShares(
      { userId: admin, marketId, outcome: "YES", shares: 10, skipRateLimit: true },
      prisma,
    );

    await resolveMarket(
      {
        marketId,
        outcome: "YES",
        reason: "Source: https://example.com/official-result published 2 Aug",
        resolvedById: admin,
      },
      prisma,
    );

    const resolution = await prisma.resolution.findUniqueOrThrow({ where: { marketId } });
    assert.equal(resolution.outcome, "YES");
    assert.equal(resolution.resolvedById, admin);
    assert.match(resolution.reason, /example\.com/);
    assert.equal(resolution.totalPaidOut.toNumber(), 10);

    const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.equal(market.status, "RESOLVED");
    assert.ok(market.resolvedAt, "resolvedAt must be stamped");
  });

  it("refuses to settle twice — the double-payout guard", async () => {
    const marketId = await makeMarket();
    const holder = await makeUser();
    await buyShares(
      { userId: holder, marketId, outcome: "YES", shares: 50, skipRateLimit: true },
      prisma,
    );

    await resolveMarket(
      { marketId, outcome: "YES", reason: "First resolution, properly sourced", resolvedById: holder },
      prisma,
    );
    const afterFirst = await balanceOf(holder);

    await assert.rejects(
      () =>
        resolveMarket(
          { marketId, outcome: "YES", reason: "Trying to pay out again", resolvedById: holder },
          prisma,
        ),
      (err: unknown) => err instanceof ResolveError && err.code === "ALREADY_SETTLED",
    );

    assert.equal(await balanceOf(holder), afterFirst, "no points may be minted by a retry");
    assert.equal(await prisma.resolution.count({ where: { marketId } }), 1);
  });

  it("survives two admins resolving simultaneously", async () => {
    const marketId = await makeMarket();
    const holder = await makeUser();
    await buyShares(
      { userId: holder, marketId, outcome: "YES", shares: 200, skipRateLimit: true },
      prisma,
    );
    const before = await balanceOf(holder);

    // Fired together. Without the FOR UPDATE lock plus the in-transaction
    // status check, both would see an OPEN market and both would pay out.
    const results = await Promise.allSettled([
      resolveMarket(
        { marketId, outcome: "YES", reason: "Resolution attempt from admin one", resolvedById: holder },
        prisma,
      ),
      resolveMarket(
        { marketId, outcome: "YES", reason: "Resolution attempt from admin two", resolvedById: holder },
        prisma,
      ),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    assert.equal(succeeded, 1, "exactly one resolution may succeed");
    assert.equal(await balanceOf(holder), before + 200, "paid exactly once");
    assert.equal(await prisma.resolution.count({ where: { marketId } }), 1);
  });

  it("demands a substantive reason", async () => {
    const marketId = await makeMarket();
    const admin = await makeUser();

    for (const reason of ["", "   ", "yes"]) {
      await assert.rejects(
        () => resolveMarket({ marketId, outcome: "YES", reason, resolvedById: admin }, prisma),
        (err: unknown) => err instanceof ResolveError && err.code === "REASON_REQUIRED",
      );
    }

    const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.equal(market.status, "OPEN", "a rejected resolution must not change status");
  });

  it("reports a missing market rather than failing obscurely", async () => {
    await assert.rejects(
      () =>
        resolveMarket(
          { marketId: "nonexistent", outcome: "YES", reason: "Well sourced reason here", resolvedById: "x" },
          prisma,
        ),
      (err: unknown) => err instanceof ResolveError && err.code === "MARKET_NOT_FOUND",
    );
  });

  it("resolves a market with no trades without paying anyone", async () => {
    const marketId = await makeMarket();
    const admin = await makeUser();

    const result = await resolveMarket(
      { marketId, outcome: "NO", reason: "Nobody traded, resolving for the record", resolvedById: admin },
      prisma,
    );

    assert.equal(result.totalPaidOut, 0);
    assert.equal(result.paidUsers, 0);
  });
});

describe("voidMarket", () => {
  it("refunds net cost basis and marks the market voided", async () => {
    const marketId = await makeMarket();
    const trader = await makeUser();
    const start = await balanceOf(trader);

    await buyShares(
      { userId: trader, marketId, outcome: "YES", shares: 100, skipRateLimit: true },
      prisma,
    );
    const afterBuy = await balanceOf(trader);
    assert.ok(afterBuy < start, "buying costs points");

    const result = await voidMarket(
      { marketId, reason: "Question turned out to be unresolvable as written", resolvedById: trader },
      prisma,
    );

    assert.ok(Math.abs((await balanceOf(trader)) - start) < 0.01, "voiding makes the trader whole");
    assert.ok(result.totalPaidOut > 0);

    const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.equal(market.status, "VOIDED");
  });

  it("cannot void an already-resolved market", async () => {
    const marketId = await makeMarket();
    const admin = await makeUser();
    await resolveMarket(
      { marketId, outcome: "YES", reason: "Resolved properly with a source", resolvedById: admin },
      prisma,
    );

    await assert.rejects(
      () => voidMarket({ marketId, reason: "Changed my mind about this one", resolvedById: admin }, prisma),
      (err: unknown) => err instanceof ResolveError && err.code === "ALREADY_SETTLED",
    );
  });
});

describe("closeMarket", () => {
  it("halts trading without settling", async () => {
    const marketId = await makeMarket();
    const trader = await makeUser();

    await closeMarket(marketId, prisma);

    const market = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.equal(market.status, "CLOSED");
    assert.equal(market.resolvedAt, null, "closing is not settling");

    await assert.rejects(
      () => buyShares({ userId: trader, marketId, outcome: "YES", shares: 1, skipRateLimit: true }, prisma),
      (err: unknown) => err instanceof Error && /closed|not open/i.test(err.message),
    );
  });

  it("still allows resolution afterwards", async () => {
    const marketId = await makeMarket();
    const holder = await makeUser();
    await buyShares(
      { userId: holder, marketId, outcome: "YES", shares: 20, skipRateLimit: true },
      prisma,
    );

    await closeMarket(marketId, prisma);
    const result = await resolveMarket(
      { marketId, outcome: "YES", reason: "Closed early, then resolved on the result", resolvedById: holder },
      prisma,
    );

    assert.equal(result.totalPaidOut, 20);
  });
});
