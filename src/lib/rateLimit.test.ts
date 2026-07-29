/**
 * Rate limiter tests. Hits real Postgres — the atomicity of the
 * refill-check-consume cycle is the thing worth testing and it lives in SQL.
 *
 * Requires the local database (see CLAUDE.md): docker start market-db
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import {
  POLICIES,
  RateLimitError,
  consume,
  enforce,
  peek,
  pruneStaleBuckets,
  reset,
} from "./rateLimit";
import { buyShares, TradeError } from "./trade";
import { loadEnv } from "./loadEnv";

loadEnv();

const prisma = new PrismaClient();
const RUN = `rltest-${randomUUID().slice(0, 8)}`;

/** A subject nobody else is using, so buckets never collide between tests. */
function subject(label: string): string {
  return `${RUN}-${label}`;
}

/** Buckets keyed by a generated id rather than by RUN, so they need naming. */
const extraBucketKeys: string[] = [];

after(async () => {
  await prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "key" LIKE ${`%${RUN}%`}`;
  if (extraBucketKeys.length > 0) {
    await prisma.rateLimit.deleteMany({ where: { key: { in: extraBucketKeys } } });
  }
  await prisma.market.deleteMany({ where: { slug: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.$disconnect();
});

describe("consume", () => {
  it("allows a fresh subject and reports the remaining budget", async () => {
    const who = subject("fresh");
    const result = await consume("trade", who, prisma);

    assert.equal(result.allowed, true);
    assert.equal(result.remaining, POLICIES.trade.burst - 1);
    assert.equal(result.retryAfter, 0);
  });

  it("allows exactly the burst, then denies", async () => {
    const who = subject("burst");

    for (let i = 0; i < POLICIES.trade.burst; i++) {
      const result = await consume("trade", who, prisma);
      assert.equal(result.allowed, true, `call ${i + 1} should be allowed`);
    }

    const denied = await consume("trade", who, prisma);
    assert.equal(denied.allowed, false, "one past the burst must be denied");
    assert.ok(denied.retryAfter >= 1, "a denial must say how long to wait");
  });

  it("does not consume a token on a denied call", async () => {
    const who = subject("nodrain");
    for (let i = 0; i < POLICIES.trade.burst; i++) await consume("trade", who, prisma);

    const first = await consume("trade", who, prisma);
    const second = await consume("trade", who, prisma);

    assert.equal(first.allowed, false);
    assert.equal(second.allowed, false);
    // Hammering a limit must not push the bucket further negative and extend
    // the lockout beyond the policy.
    assert.ok(
      second.retryAfter <= first.retryAfter + 1,
      `retryAfter grew from ${first.retryAfter} to ${second.retryAfter}`,
    );
  });

  it("keeps separate buckets per subject", async () => {
    const a = subject("alice");
    const b = subject("bob");

    for (let i = 0; i < POLICIES.trade.burst; i++) await consume("trade", a, prisma);

    assert.equal((await consume("trade", a, prisma)).allowed, false);
    assert.equal(
      (await consume("trade", b, prisma)).allowed,
      true,
      "one subject exhausting their budget must not affect anyone else",
    );
  });

  it("keeps separate buckets per policy for the same subject", async () => {
    const who = subject("multipolicy");

    for (let i = 0; i < POLICIES.signup.burst; i++) await consume("signup", who, prisma);
    assert.equal((await consume("signup", who, prisma)).allowed, false);

    assert.equal(
      (await consume("trade", who, prisma)).allowed,
      true,
      "exhausting the signup budget must not block trading",
    );
  });

  it("refills over time", async () => {
    const who = subject("refill");
    for (let i = 0; i < POLICIES.trade.burst; i++) await consume("trade", who, prisma);
    assert.equal((await consume("trade", who, prisma)).allowed, false);

    // Rewind the bucket's clock rather than sleeping for the real refill period.
    await prisma.$executeRaw`
      UPDATE "RateLimit" SET "updatedAt" = now() - interval '60 seconds'
      WHERE "key" = ${`trade:${who}`}
    `;

    const after = await consume("trade", who, prisma);
    assert.equal(after.allowed, true, "60s at 0.25/s should refill 15 tokens");
  });

  it("never refills past the burst ceiling", async () => {
    const who = subject("ceiling");
    await consume("trade", who, prisma);

    await prisma.$executeRaw`
      UPDATE "RateLimit" SET "updatedAt" = now() - interval '30 days'
      WHERE "key" = ${`trade:${who}`}
    `;

    assert.equal(
      await peek("trade", who, prisma),
      POLICIES.trade.burst,
      "an idle bucket tops out at burst, it does not accumulate credit forever",
    );
  });
});

describe("concurrency", () => {
  it("does not let parallel calls exceed the burst", async () => {
    const who = subject("parallel");
    const attempts = POLICIES.trade.burst * 3;

    // All fired at once. A read-then-write limiter would let far more than
    // `burst` through here; the atomic upsert is what prevents it.
    const results = await Promise.all(
      Array.from({ length: attempts }, () => consume("trade", who, prisma)),
    );

    const allowed = results.filter((r) => r.allowed).length;
    assert.equal(
      allowed,
      POLICIES.trade.burst,
      `expected exactly ${POLICIES.trade.burst} to pass, got ${allowed}`,
    );
  });
});

describe("enforce", () => {
  it("returns quietly while under the limit", async () => {
    await enforce("trade", subject("quiet"), prisma);
  });

  it("throws RateLimitError with a usable retryAfter once over", async () => {
    const who = subject("throws");
    for (let i = 0; i < POLICIES.trade.burst; i++) await consume("trade", who, prisma);

    await assert.rejects(
      () => enforce("trade", who, prisma),
      (err: unknown) => {
        assert.ok(err instanceof RateLimitError);
        assert.equal(err.code, "RATE_LIMITED");
        assert.equal(err.policy, "trade");
        assert.ok(err.retryAfter >= 1, "Retry-After must be a positive number of seconds");
        assert.match(err.message, /15 trades per minute/);
        return true;
      },
    );
  });
});

describe("policies", () => {
  it("limits signups hard enough to matter for multi-accounting", async () => {
    const ip = subject("signupip");

    for (let i = 0; i < POLICIES.signup.burst; i++) {
      assert.equal((await consume("signup", ip, prisma)).allowed, true);
    }

    const denied = await consume("signup", ip, prisma);
    assert.equal(denied.allowed, false);
    // One per hour after the burst — a farm of throwaway accounts from one IP
    // should be waiting a long time.
    assert.ok(denied.retryAfter > 600, `expected a long wait, got ${denied.retryAfter}s`);
  });

  it("is looser on sign-ins than on signups", async () => {
    assert.ok(POLICIES.signin.burst > POLICIES.signup.burst);
    assert.ok(POLICIES.signin.refillPerSecond > POLICIES.signup.refillPerSecond);
  });
});

describe("reset and prune", () => {
  it("reset clears a bucket", async () => {
    const who = subject("resettable");
    for (let i = 0; i < POLICIES.trade.burst; i++) await consume("trade", who, prisma);
    assert.equal((await consume("trade", who, prisma)).allowed, false);

    await reset("trade", who, prisma);
    assert.equal((await consume("trade", who, prisma)).allowed, true);
  });

  it("prune removes only buckets older than the cutoff", async () => {
    const stale = subject("stale");
    const active = subject("active");
    await consume("trade", stale, prisma);
    await consume("trade", active, prisma);

    await prisma.$executeRaw`
      UPDATE "RateLimit" SET "updatedAt" = now() - interval '72 hours'
      WHERE "key" = ${`trade:${stale}`}
    `;

    await pruneStaleBuckets(48, prisma);

    const rows = await prisma.rateLimit.findMany({ where: { key: { contains: RUN } } });
    const keys = rows.map((r) => r.key);
    assert.ok(!keys.includes(`trade:${stale}`), "stale bucket should be gone");
    assert.ok(keys.includes(`trade:${active}`), "active bucket should survive");
  });
});

describe("trade service integration", () => {
  it("blocks a trader who exceeds the trade limit, and says how long to wait", async () => {
    const creator = await prisma.user.create({
      data: { email: `${RUN}-creator@example.test` },
      select: { id: true },
    });
    const market = await prisma.market.create({
      data: {
        slug: `${RUN}-rl`,
        question: "Does the limiter hold?",
        rules: "Resolves YES if it does.",
        closesAt: new Date(Date.now() + 86_400_000),
        creatorId: creator.id,
      },
      select: { id: true },
    });
    const trader = await prisma.user.create({
      data: { email: `${RUN}-trader@example.test`, balance: 100000 },
      select: { id: true },
    });
    extraBucketKeys.push(`trade:${trader.id}`);

    for (let i = 0; i < POLICIES.trade.burst; i++) {
      await buyShares({ userId: trader.id, marketId: market.id, outcome: "YES", shares: 1 }, prisma);
    }

    await assert.rejects(
      () =>
        buyShares({ userId: trader.id, marketId: market.id, outcome: "YES", shares: 1 }, prisma),
      (err: unknown) => err instanceof RateLimitError && err.retryAfter >= 1,
    );

    // The rejected trade must leave no trace — it never reached the transaction.
    const marketAfter = await prisma.market.findUniqueOrThrow({ where: { id: market.id } });
    assert.equal(marketAfter.tradeCount, POLICIES.trade.burst);
    assert.equal(marketAfter.qYes.toNumber(), POLICIES.trade.burst);

    // And the escape hatch still works, for seeds and admin tooling.
    const seeded = await buyShares(
      { userId: trader.id, marketId: market.id, outcome: "YES", shares: 1, skipRateLimit: true },
      prisma,
    );
    assert.ok(seeded.tradeId, "skipRateLimit must bypass the limit");

    // Sanity: the limiter is not swallowing ordinary trade errors.
    await reset("trade", trader.id, prisma);
    await assert.rejects(
      () =>
        buyShares(
          { userId: trader.id, marketId: market.id, outcome: "YES", shares: 0.0001 },
          prisma,
        ),
      (err: unknown) => err instanceof TradeError && err.code === "INVALID_SIZE",
    );
  });
});
