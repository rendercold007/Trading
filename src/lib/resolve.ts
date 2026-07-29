/**
 * Market settlement — the only code that resolves or voids a market.
 *
 * Settlement mints points: every winning share becomes 1 point in somebody's
 * balance. Paying out twice would create points from nothing and silently
 * inflate the whole leaderboard, so the guard against double payment is the
 * single most important thing in this file. It works by re-reading and checking
 * `Market.status` **inside** the transaction, under a row lock, rather than
 * checking before opening one — two admins clicking Resolve at the same moment
 * must not both see an OPEN market and both pay out.
 *
 * Resolution is also a public record: every settlement writes a `Resolution` row
 * carrying who decided, when, and a sourced reason. With strangers trading, that
 * audit trail is what makes a decision defensible.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./db";
import { roundPoints, type Outcome } from "./lmsr";

export type ResolveErrorCode =
  | "MARKET_NOT_FOUND"
  | "ALREADY_SETTLED"
  | "REASON_REQUIRED"
  | "NOT_ADMIN";

export class ResolveError extends Error {
  readonly code: ResolveErrorCode;

  constructor(code: ResolveErrorCode, message: string) {
    super(message);
    this.name = "ResolveError";
    this.code = code;
  }
}

/** A resolution has to say why. An empty reason defeats the point of the log. */
const MIN_REASON_LENGTH = 10;

export interface SettlementResult {
  marketId: string;
  outcome: Outcome | null;
  /** Points paid to holders. */
  totalPaidOut: number;
  /** How many users were paid. */
  paidUsers: number;
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(4));
}

/**
 * Lock the market and confirm it is still settleable.
 *
 * Returns the row. Throws `ALREADY_SETTLED` if another transaction got there
 * first — which is exactly the double-payout case this exists to prevent.
 */
async function lockSettleableMarket(
  tx: Prisma.TransactionClient,
  marketId: string,
): Promise<{ id: string }> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Market" WHERE id = ${marketId} FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new ResolveError("MARKET_NOT_FOUND", `no market with id ${marketId}`);
  }

  const market = await tx.market.findUniqueOrThrow({
    where: { id: marketId },
    select: { id: true, status: true },
  });

  if (market.status === "RESOLVED" || market.status === "VOIDED") {
    throw new ResolveError(
      "ALREADY_SETTLED",
      `market is already ${market.status.toLowerCase()}; settling again would mint points`,
    );
  }

  return { id: market.id };
}

/**
 * Resolve a market and pay out the winning side.
 *
 * Each winning share is worth exactly 1 point; losing shares are worth nothing
 * and are simply left in place, so a trader's history stays readable after
 * settlement. Positions are not deleted.
 */
export async function resolveMarket(
  args: {
    marketId: string;
    outcome: Outcome;
    /** Why, with a source. Recorded publicly. */
    reason: string;
    resolvedById: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<SettlementResult> {
  const reason = args.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new ResolveError(
      "REASON_REQUIRED",
      `a resolution needs a reason of at least ${MIN_REASON_LENGTH} characters, ideally with a source link`,
    );
  }

  return db.$transaction(async (tx) => {
    const market = await lockSettleableMarket(tx, args.marketId);

    // Only the winning side is paid. Everything else expires worthless.
    const winners = await tx.position.findMany({
      where: { marketId: market.id, outcome: args.outcome, shares: { gt: 0 } },
      select: { userId: true, shares: true },
    });

    let totalPaidOut = 0;
    for (const winner of winners) {
      const payout = roundPoints(winner.shares.toNumber());
      if (payout <= 0) continue;

      await tx.user.update({
        where: { id: winner.userId },
        data: { balance: { increment: toDecimal(payout) } },
      });
      totalPaidOut += payout;
    }
    totalPaidOut = roundPoints(totalPaidOut);

    await tx.market.update({
      where: { id: market.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });

    await tx.resolution.create({
      data: {
        marketId: market.id,
        outcome: args.outcome,
        reason,
        resolvedById: args.resolvedById,
        totalPaidOut: toDecimal(totalPaidOut),
      },
    });

    return {
      marketId: market.id,
      outcome: args.outcome,
      totalPaidOut,
      paidUsers: winners.length,
    };
  });
}

/**
 * Void a market and refund what people put in.
 *
 * For questions that turn out to be unresolvable or ambiguous. Refunds each
 * position's net cost basis rather than paying either side, which returns every
 * trader to roughly where they started. "Roughly", because a trader who already
 * sold at a profit keeps it — their remaining basis is what gets refunded, and
 * a negative basis (they took out more than they put in) refunds nothing rather
 * than clawing points back.
 */
export async function voidMarket(
  args: { marketId: string; reason: string; resolvedById: string },
  db: PrismaClient = defaultPrisma,
): Promise<SettlementResult> {
  const reason = args.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new ResolveError(
      "REASON_REQUIRED",
      `voiding a market needs a reason of at least ${MIN_REASON_LENGTH} characters`,
    );
  }

  return db.$transaction(async (tx) => {
    const market = await lockSettleableMarket(tx, args.marketId);

    const positions = await tx.position.findMany({
      where: { marketId: market.id, shares: { gt: 0 } },
      select: { userId: true, costBasis: true },
    });

    // One user can hold both sides; refund per user, not per position.
    const refunds = new Map<string, number>();
    for (const position of positions) {
      const basis = position.costBasis.toNumber();
      if (basis <= 0) continue;
      refunds.set(position.userId, (refunds.get(position.userId) ?? 0) + basis);
    }

    let totalPaidOut = 0;
    for (const [userId, amount] of refunds) {
      const refund = roundPoints(amount);
      if (refund <= 0) continue;

      await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: toDecimal(refund) } },
      });
      totalPaidOut += refund;
    }
    totalPaidOut = roundPoints(totalPaidOut);

    await tx.market.update({
      where: { id: market.id },
      data: { status: "VOIDED", resolvedAt: new Date() },
    });

    // `Resolution.outcome` is not nullable, so a void records NO by convention.
    // The status is what says it was voided; consumers must read `Market.status`
    // rather than inferring the settlement from this column alone.
    await tx.resolution.create({
      data: {
        marketId: market.id,
        outcome: "NO",
        reason: `VOIDED: ${reason}`,
        resolvedById: args.resolvedById,
        totalPaidOut: toDecimal(totalPaidOut),
      },
    });

    return {
      marketId: market.id,
      outcome: null,
      totalPaidOut,
      paidUsers: refunds.size,
    };
  });
}

/**
 * Halt trading early without settling.
 *
 * Trading already stops automatically at `closesAt`; this is for pulling a
 * market before then — a question that has become unanswerable, or one whose
 * outcome leaked. A closed market can still be resolved or voided afterwards.
 */
export async function closeMarket(
  marketId: string,
  db: PrismaClient = defaultPrisma,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const market = await lockSettleableMarket(tx, marketId);
    await tx.market.update({ where: { id: market.id }, data: { status: "CLOSED" } });
  });
}
