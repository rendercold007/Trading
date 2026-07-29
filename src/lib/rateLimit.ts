/**
 * Token-bucket rate limiting, backed by Postgres.
 *
 * A bucket holds up to `burst` tokens and refills at `refillPerSecond`. Each
 * action spends one. That shape suits this app better than a fixed window: a
 * trader can fire off a few trades back to back when a market moves, but cannot
 * sustain that rate, and there is no window boundary to game by waiting for the
 * clock to tick over.
 *
 * State lives in Postgres, not in memory, because the deploy target is Vercel
 * where the app runs as many short-lived instances — an in-memory counter would
 * reset on every cold start and limit nothing. The whole refill-check-consume
 * cycle happens inside one `INSERT ... ON CONFLICT DO UPDATE`, so it is atomic
 * against concurrent requests without needing a transaction or an explicit lock.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./db";

type Db = PrismaClient | Prisma.TransactionClient;

export interface RateLimitPolicy {
  /** Bucket capacity — the most actions allowed back to back from idle. */
  burst: number;
  /** Sustained rate once the burst is spent. */
  refillPerSecond: number;
  /** Used in error messages, e.g. "15 trades per minute". */
  description: string;
}

/**
 * The configured limits. All tunable — these are starting points chosen to be
 * invisible to a person using the site normally and obstructive to a script.
 */
export const POLICIES = {
  /**
   * Trading. A burst of 10 covers rapidly closing several positions when news
   * breaks; 15/min sustained is far above human clicking and far below what a
   * bot would want for price manipulation.
   */
  trade: {
    burst: 10,
    refillPerSecond: 0.25,
    description: "15 trades per minute",
  },

  /**
   * Account creation, keyed by IP. This is the multi-accounting control from
   * CLAUDE.md: 3 accounts back to back, then one per hour. Deliberately harsh —
   * legitimate users sign up once, and a shared NAT does not need a fourth
   * account in the same hour.
   */
  signup: {
    burst: 3,
    refillPerSecond: 1 / 3600,
    description: "3 new accounts per IP, then 1 per hour",
  },

  /**
   * Sign-in attempts, keyed by IP. Looser than signup — people do legitimately
   * sign in and out, and Google is doing the actual credential checking.
   */
  signin: {
    burst: 20,
    refillPerSecond: 1 / 60,
    description: "20 sign-in attempts per IP, then 1 per minute",
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type PolicyName = keyof typeof POLICIES;

export class RateLimitError extends Error {
  readonly code = "RATE_LIMITED" as const;
  /** Seconds until the next token is available. Suits a `Retry-After` header. */
  readonly retryAfter: number;
  readonly policy: PolicyName;

  constructor(policy: PolicyName, retryAfter: number, message: string) {
    super(message);
    this.name = "RateLimitError";
    this.policy = policy;
    this.retryAfter = retryAfter;
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Tokens left after this call. */
  remaining: number;
  /** Seconds until another token frees up. 0 when the call was allowed. */
  retryAfter: number;
}

function bucketKey(policy: PolicyName, subject: string): string {
  return `${policy}:${subject}`;
}

/**
 * Try to spend one token.
 *
 * Returns a result rather than throwing so callers can decide — the signup
 * limiter wants to redirect, an API route wants a 429. Use `enforce` for the
 * throwing version.
 *
 * The refill is computed in SQL from `now() - updatedAt` rather than in JS, so
 * the clock that matters is the database's. Multiple app instances with skewed
 * clocks cannot disagree about how full a bucket is.
 */
export async function consume(
  policyName: PolicyName,
  subject: string,
  db: Db = defaultPrisma,
): Promise<RateLimitResult> {
  const policy: RateLimitPolicy = POLICIES[policyName];
  const key = bucketKey(policyName, subject);
  const { burst, refillPerSecond } = policy;

  // `WHERE` on the conflict branch is what makes this a check: if the refilled
  // balance is under 1 token, no row is updated and nothing is returned. The
  // insert branch only runs for a bucket that does not exist yet, which by
  // definition is full.
  const rows = await db.$queryRaw<Array<{ tokens: string }>>`
    INSERT INTO "RateLimit" ("key", "tokens", "updatedAt")
    VALUES (${key}, ${burst - 1}::numeric, now())
    ON CONFLICT ("key") DO UPDATE SET
      "tokens" = LEAST(
        ${burst}::numeric,
        "RateLimit"."tokens"
          + EXTRACT(EPOCH FROM (now() - "RateLimit"."updatedAt")) * ${refillPerSecond}::numeric
      ) - 1,
      "updatedAt" = now()
    WHERE LEAST(
        ${burst}::numeric,
        "RateLimit"."tokens"
          + EXTRACT(EPOCH FROM (now() - "RateLimit"."updatedAt")) * ${refillPerSecond}::numeric
      ) >= 1
    RETURNING "tokens"::text AS tokens
  `;

  if (rows.length > 0) {
    return { allowed: true, remaining: Number(rows[0].tokens), retryAfter: 0 };
  }

  // Denied. Read the bucket back to say how long the caller should wait.
  const current = await db.$queryRaw<Array<{ available: string }>>`
    SELECT LEAST(
      ${burst}::numeric,
      "tokens" + EXTRACT(EPOCH FROM (now() - "updatedAt")) * ${refillPerSecond}::numeric
    )::text AS available
    FROM "RateLimit" WHERE "key" = ${key}
  `;

  const available = current.length > 0 ? Number(current[0].available) : 0;
  const retryAfter = Math.max(1, Math.ceil((1 - available) / refillPerSecond));

  return { allowed: false, remaining: Math.max(0, available), retryAfter };
}

/** As `consume`, but throws `RateLimitError` when the limit is hit. */
export async function enforce(
  policyName: PolicyName,
  subject: string,
  db: Db = defaultPrisma,
): Promise<void> {
  const result = await consume(policyName, subject, db);
  if (result.allowed) return;

  throw new RateLimitError(
    policyName,
    result.retryAfter,
    `Rate limit reached (${POLICIES[policyName].description}). Try again in ${result.retryAfter}s.`,
  );
}

/** Inspect a bucket without spending a token. For tests and debugging. */
export async function peek(
  policyName: PolicyName,
  subject: string,
  db: Db = defaultPrisma,
): Promise<number> {
  const policy: RateLimitPolicy = POLICIES[policyName];
  const rows = await db.$queryRaw<Array<{ available: string }>>`
    SELECT LEAST(
      ${policy.burst}::numeric,
      "tokens" + EXTRACT(EPOCH FROM (now() - "updatedAt")) * ${policy.refillPerSecond}::numeric
    )::text AS available
    FROM "RateLimit" WHERE "key" = ${bucketKey(policyName, subject)}
  `;
  return rows.length > 0 ? Number(rows[0].available) : policy.burst;
}

/** Clear a bucket. For admin intervention and test setup. */
export async function reset(
  policyName: PolicyName,
  subject: string,
  db: Db = defaultPrisma,
): Promise<void> {
  await db.$executeRaw`DELETE FROM "RateLimit" WHERE "key" = ${bucketKey(policyName, subject)}`;
}

/**
 * Delete buckets that have sat untouched long enough to have refilled
 * completely — they carry no information, so keeping them just grows the table.
 * Worth calling from a cron job once there is one.
 */
export async function pruneStaleBuckets(
  olderThanHours = 48,
  db: Db = defaultPrisma,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const result = await db.rateLimit.deleteMany({ where: { updatedAt: { lt: cutoff } } });
  return result.count;
}
