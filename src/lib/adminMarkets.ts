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
  | "SLUG_TAKEN";

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

export interface CreateMarketInput {
  question: string;
  rules: string;
  category?: string | null;
  /** When trading stops. */
  closesAt: Date;
  /** LMSR liquidity. Defaults to 500. */
  b?: number;
  creatorId: string;
}

/**
 * Create a market.
 *
 * Validation is deliberately strict about rules and close time: a market with
 * vague rules or a close date in the past is worse than no market, because
 * people will have traded on it before anyone notices.
 */
export async function createMarket(
  input: CreateMarketInput,
  db: PrismaClient = defaultPrisma,
): Promise<{ id: string; slug: string }> {
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
