/**
 * Market creation. Admin-only by policy (see CLAUDE.md) — open creation would
 * invite spam and unresolvable questions from anonymous accounts.
 *
 * Kept out of `markets.ts`, which is strictly read-only, and out of `trade.ts`,
 * which owns the money path.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./db";
import { DEFAULT_LIQUIDITY, MAX_LIQUIDITY, MIN_LIQUIDITY } from "./marketConstants";

export type CreateMarketErrorCode =
  | "QUESTION_REQUIRED"
  | "RULES_REQUIRED"
  | "CLOSES_IN_PAST"
  | "INVALID_LIQUIDITY"
  | "SLUG_TAKEN"
  // Edit / delete guards. A market's terms are the terms of a bet: once anyone
  // has traded, they are frozen. These fire when that invariant would be broken.
  | "MARKET_NOT_FOUND"
  | "MARKET_NOT_EDITABLE"
  | "MARKET_HAS_TRADES";

export class CreateMarketError extends Error {
  readonly code: CreateMarketErrorCode;
  readonly field?: string;

  constructor(code: CreateMarketErrorCode, message: string, field?: string) {
    super(message);
    this.name = "CreateMarketError";
    this.code = code;
    this.field = field;
  }
}

/** Rules are the single biggest source of resolution disputes; demand real ones. */
const MIN_RULES_LENGTH = 20;
const MIN_QUESTION_LENGTH = 10;
const MAX_SLUG_LENGTH = 70;

/**
 * URL-friendly slug from the question text.
 *
 * Not unique on its own — two similar questions collide — so `createMarket`
 * adds a numeric suffix when the database rejects the first attempt.
 */
export function slugify(question: string): string {
  const slug = question
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return slug.length >= 3 ? slug : "market";
}

/** Fields common to creating and editing a market. */
interface MarketFields {
  question: string;
  rules: string;
  category?: string | null;
  /** When trading stops. */
  closesAt: Date;
  /** LMSR liquidity. Defaults to 500. */
  b?: number;
}

/**
 * Validate and normalise the editable market fields, shared by create and edit.
 *
 * Deliberately strict about rules and close time: a market with vague rules or a
 * close date in the past is worse than no market, because people will have
 * traded on it before anyone notices.
 */
function validateMarketFields(input: MarketFields): {
  question: string;
  rules: string;
  category: string | null;
  b: number;
} {
  const question = input.question.trim();
  const rules = input.rules.trim();
  const category = input.category?.trim() || null;
  const b = input.b ?? DEFAULT_LIQUIDITY;

  if (question.length < MIN_QUESTION_LENGTH) {
    throw new CreateMarketError(
      "QUESTION_REQUIRED",
      "The question needs to be a full, answerable sentence.",
      "question",
    );
  }
  if (rules.length < MIN_RULES_LENGTH) {
    throw new CreateMarketError(
      "RULES_REQUIRED",
      "Spell out exactly what makes this resolve YES, and name the source you will check.",
      "rules",
    );
  }
  if (input.closesAt.getTime() <= Date.now()) {
    throw new CreateMarketError(
      "CLOSES_IN_PAST",
      "The close time has to be in the future, or nobody can trade.",
      "closesAt",
    );
  }
  if (!Number.isFinite(b) || b < MIN_LIQUIDITY || b > MAX_LIQUIDITY) {
    throw new CreateMarketError(
      "INVALID_LIQUIDITY",
      `Liquidity must be between ${MIN_LIQUIDITY} and ${MAX_LIQUIDITY}.`,
      "b",
    );
  }

  return { question, rules, category, b };
}

export interface CreateMarketInput extends MarketFields {
  creatorId: string;
}

/**
 * Create a market.
 */
export async function createMarket(
  input: CreateMarketInput,
  db: PrismaClient = defaultPrisma,
): Promise<{ id: string; slug: string }> {
  const { question, rules, category, b } = validateMarketFields(input);

  const base = slugify(question);

  // Retry on slug collision rather than pre-checking: a pre-check races, the
  // unique constraint does not.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, MAX_SLUG_LENGTH - 3)}-${attempt + 1}`;
    try {
      const market = await db.market.create({
        data: {
          slug,
          question,
          rules,
          category,
          closesAt: input.closesAt,
          b: new Prisma.Decimal(b.toFixed(4)),
          creatorId: input.creatorId,
        },
        select: { id: true, slug: true },
      });
      return market;
    } catch (err) {
      const isUniqueViolation =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isUniqueViolation) throw err;
    }
  }

  throw new CreateMarketError(
    "SLUG_TAKEN",
    "Could not find a free URL for this question. Try rewording it.",
    "question",
  );
}

export interface EditMarketInput extends MarketFields {
  marketId: string;
}

/**
 * Edit a market that has not traded yet — fixing a typo or a wrong close date
 * before anyone has taken a position on it.
 *
 * Guarded on `tradeCount === 0` *inside* a `FOR UPDATE` transaction, exactly
 * like settlement: the check and the write must see the same locked row, or a
 * trade landing between them could silently rewrite the terms of a live bet.
 * `tradeCount === 0` also means `qYes`/`qNo` are still 0, so changing `b` is
 * safe. The slug is intentionally left untouched — it is the market's permanent
 * URL, and regenerating it would break any link already shared.
 */
export async function editMarket(
  input: EditMarketInput,
  db: PrismaClient = defaultPrisma,
): Promise<{ id: string; slug: string }> {
  const { question, rules, category, b } = validateMarketFields(input);

  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Market" WHERE id = ${input.marketId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new CreateMarketError("MARKET_NOT_FOUND", "That market no longer exists.");
    }

    const market = await tx.market.findUniqueOrThrow({
      where: { id: input.marketId },
      select: { status: true, tradeCount: true },
    });

    if (market.status !== "OPEN") {
      throw new CreateMarketError(
        "MARKET_NOT_EDITABLE",
        "Only an open market can be edited; this one is already closed or settled.",
      );
    }
    if (market.tradeCount > 0) {
      throw new CreateMarketError(
        "MARKET_HAS_TRADES",
        "This market has trades, so its terms are locked — editing now would change a bet people already took.",
      );
    }

    return tx.market.update({
      where: { id: input.marketId },
      data: {
        question,
        rules,
        category,
        closesAt: input.closesAt,
        b: new Prisma.Decimal(b.toFixed(4)),
      },
      select: { id: true, slug: true },
    });
  });
}

/**
 * Delete a market that has not traded yet — removing a setup mistake outright
 * rather than leaving it closed-but-visible.
 *
 * The same zero-trade guard under the same lock. `Trade` is an immutable ledger,
 * so a market anyone has traded can never be deleted (close or resolve it
 * instead); with no trades there is nothing to preserve, and the schema's
 * cascade clears any Position/PricePoint/Resolution rows along with it.
 */
export async function deleteMarket(
  marketId: string,
  db: PrismaClient = defaultPrisma,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Market" WHERE id = ${marketId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new CreateMarketError("MARKET_NOT_FOUND", "That market no longer exists.");
    }

    const market = await tx.market.findUniqueOrThrow({
      where: { id: marketId },
      select: { tradeCount: true },
    });

    if (market.tradeCount > 0) {
      throw new CreateMarketError(
        "MARKET_HAS_TRADES",
        "This market has trades and cannot be deleted — the ledger is permanent. Close or resolve it instead.",
      );
    }

    await tx.market.delete({ where: { id: marketId } });
  });
}
