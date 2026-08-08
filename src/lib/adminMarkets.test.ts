/**
 * Market creation tests — slug generation is pure, validation needs the
 * database only for the unique-slug retry.
 *
 * Requires the local database (see CLAUDE.md): docker start market-db
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { CreateMarketError, createMarket, deleteMarket, editMarket, slugify } from "./adminMarkets";
import { loadEnv } from "./loadEnv";

loadEnv();

const prisma = new PrismaClient();
const RUN = `amtest-${randomUUID().slice(0, 8)}`;

const future = () => new Date(Date.now() + 7 * 86_400_000);

async function makeAdmin(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${RUN}-${randomUUID()}@example.test`, isAdmin: true },
    select: { id: true },
  });
  return user.id;
}

after(async () => {
  await prisma.market.deleteMany({ where: { question: { contains: RUN } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.$disconnect();
});

describe("slugify", () => {
  it("makes a URL-safe slug from a question", () => {
    assert.equal(
      slugify("Will India win the toss on 1 August 2026?"),
      "will-india-win-the-toss-on-1-august-2026",
    );
  });

  it("strips accents and punctuation", () => {
    assert.equal(slugify("Will Tomás win — really?!"), "will-tomas-win-really");
  });

  it("never ends in a dash and stays bounded", () => {
    const slug = slugify("A ".repeat(200));
    assert.ok(!slug.endsWith("-"), slug);
    assert.ok(slug.length <= 70);
  });

  it("falls back rather than producing an empty slug", () => {
    assert.equal(slugify("???"), "market");
    assert.equal(slugify("🎲🎲🎲"), "market");
  });

  it("produces only url-safe characters", () => {
    for (const q of ["Will X?", "50% chance!", "a/b\\c", "Tomás & Zoë"]) {
      assert.match(slugify(q), /^[a-z0-9-]+$/);
    }
  });
});

describe("createMarket", () => {
  const valid = (overrides: Record<string, unknown> = {}) => ({
    question: `Will the ${RUN} test market be created correctly?`,
    rules: "Resolves YES if the market row exists in the database afterwards. Verified by test.",
    closesAt: future(),
    creatorId: "",
    ...overrides,
  });

  it("creates a market with a derived slug", async () => {
    const creatorId = await makeAdmin();
    const market = await createMarket({ ...valid(), creatorId }, prisma);

    assert.ok(market.id);
    assert.match(market.slug, /^[a-z0-9-]+$/);

    const row = await prisma.market.findUniqueOrThrow({ where: { id: market.id } });
    assert.equal(row.status, "OPEN");
    assert.equal(row.qYes.toNumber(), 0);
    assert.equal(row.b.toNumber(), 500, "default liquidity");
  });

  it("suffixes the slug rather than failing when one collides", async () => {
    const creatorId = await makeAdmin();
    // A distinct question, so the suffix reflects this test's collisions only
    // and not markets other tests in this file already created.
    const question = `Will the ${RUN} collision case get a unique slug?`;

    const first = await createMarket({ ...valid({ question }), creatorId }, prisma);
    const second = await createMarket({ ...valid({ question }), creatorId }, prisma);
    const third = await createMarket({ ...valid({ question }), creatorId }, prisma);

    assert.equal(new Set([first.slug, second.slug, third.slug]).size, 3, "slugs must be unique");
    assert.match(second.slug, /-2$/);
    assert.match(third.slug, /-3$/);
  });

  it("rejects a question too short to be answerable", async () => {
    const creatorId = await makeAdmin();
    await assert.rejects(
      () => createMarket({ ...valid({ question: "Will it?" }), creatorId }, prisma),
      (err: unknown) => err instanceof CreateMarketError && err.code === "QUESTION_REQUIRED",
    );
  });

  it("rejects vague rules — the top cause of resolution disputes", async () => {
    const creatorId = await makeAdmin();
    await assert.rejects(
      () => createMarket({ ...valid({ rules: "obvious" }), creatorId }, prisma),
      (err: unknown) => err instanceof CreateMarketError && err.code === "RULES_REQUIRED",
    );
  });

  it("rejects a close time in the past — nobody could ever trade it", async () => {
    const creatorId = await makeAdmin();
    await assert.rejects(
      () =>
        createMarket(
          { ...valid({ closesAt: new Date(Date.now() - 1000) }), creatorId },
          prisma,
        ),
      (err: unknown) => err instanceof CreateMarketError && err.code === "CLOSES_IN_PAST",
    );
  });

  it("rejects liquidity outside the supported band", async () => {
    const creatorId = await makeAdmin();
    for (const b of [0, -100, 5, 1e6, NaN]) {
      await assert.rejects(
        () => createMarket({ ...valid({ b }), creatorId }, prisma),
        (err: unknown) => err instanceof CreateMarketError && err.code === "INVALID_LIQUIDITY",
      );
    }
  });
});

describe("editMarket", () => {
  const validEdit = (overrides: Record<string, unknown> = {}) => ({
    question: `Will the ${RUN} edited market read back correctly?`,
    rules: "Resolves YES if the edited fields are what the database returns. Verified by test.",
    closesAt: future(),
    ...overrides,
  });

  async function makeMarket(): Promise<string> {
    const creatorId = await makeAdmin();
    const market = await createMarket(
      {
        question: `Will the ${RUN} market start out editable?`,
        rules: "Resolves YES if it can be edited before any trade lands. Verified by test.",
        closesAt: future(),
        creatorId,
      },
      prisma,
    );
    return market.id;
  }

  it("rewrites the fields of a market with no trades, keeping the slug", async () => {
    const marketId = await makeMarket();
    const before = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });

    const newClose = new Date(Date.now() + 14 * 86_400_000);
    const result = await editMarket(
      { marketId, ...validEdit({ closesAt: newClose, category: "Cricket", b: 800 }) },
      prisma,
    );

    assert.equal(result.slug, before.slug, "slug is the permanent URL, unchanged by an edit");

    const after = await prisma.market.findUniqueOrThrow({ where: { id: marketId } });
    assert.match(after.question, /edited market read back correctly/);
    assert.equal(after.category, "Cricket");
    assert.equal(after.b.toNumber(), 800);
    assert.equal(after.closesAt.getTime(), newClose.getTime());
  });

  it("refuses to edit a market that has already traded", async () => {
    const marketId = await makeMarket();
    // Simulate a trade having landed without invoking the full trade service.
    await prisma.market.update({ where: { id: marketId }, data: { tradeCount: 1 } });

    await assert.rejects(
      () => editMarket({ marketId, ...validEdit() }, prisma),
      (err: unknown) => err instanceof CreateMarketError && err.code === "MARKET_HAS_TRADES",
    );
  });

  it("refuses to edit a market that is no longer open", async () => {
    const marketId = await makeMarket();
    await prisma.market.update({ where: { id: marketId }, data: { status: "CLOSED" } });

    await assert.rejects(
      () => editMarket({ marketId, ...validEdit() }, prisma),
      (err: unknown) => err instanceof CreateMarketError && err.code === "MARKET_NOT_EDITABLE",
    );
  });

  it("still enforces field validation on edit", async () => {
    const marketId = await makeMarket();
    await assert.rejects(
      () => editMarket({ marketId, ...validEdit({ rules: "too short" }) }, prisma),
      (err: unknown) => err instanceof CreateMarketError && err.code === "RULES_REQUIRED",
    );
  });

  it("reports a missing market rather than throwing something opaque", async () => {
    await assert.rejects(
      () => editMarket({ marketId: "does-not-exist", ...validEdit() }, prisma),
      (err: unknown) => err instanceof CreateMarketError && err.code === "MARKET_NOT_FOUND",
    );
  });
});

describe("deleteMarket", () => {
  async function makeMarket(): Promise<string> {
    const creatorId = await makeAdmin();
    const market = await createMarket(
      {
        question: `Will the ${RUN} market be deletable while untraded?`,
        rules: "Resolves YES if a zero-trade market can be removed outright. Verified by test.",
        closesAt: future(),
        creatorId,
      },
      prisma,
    );
    return market.id;
  }

  it("removes a market with no trades", async () => {
    const marketId = await makeMarket();
    await deleteMarket(marketId, prisma);

    const row = await prisma.market.findUnique({ where: { id: marketId } });
    assert.equal(row, null, "the market row is gone");
  });

  it("refuses to delete a market that has traded, leaving it intact", async () => {
    const marketId = await makeMarket();
    await prisma.market.update({ where: { id: marketId }, data: { tradeCount: 1 } });

    await assert.rejects(
      () => deleteMarket(marketId, prisma),
      (err: unknown) => err instanceof CreateMarketError && err.code === "MARKET_HAS_TRADES",
    );

    const row = await prisma.market.findUnique({ where: { id: marketId } });
    assert.ok(row, "the market must survive a refused delete");
  });

  it("reports a missing market rather than throwing something opaque", async () => {
    await assert.rejects(
      () => deleteMarket("does-not-exist", prisma),
      (err: unknown) => err instanceof CreateMarketError && err.code === "MARKET_NOT_FOUND",
    );
  });
});
