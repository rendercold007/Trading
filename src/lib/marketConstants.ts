/**
 * Constants shared between server code and client components.
 *
 * Deliberately free of any import — a client component that pulls a value out
 * of `adminMarkets.ts` would drag Prisma and `node:fs` into the browser bundle
 * and fail the build. Anything both sides need lives here.
 */

/** LMSR liquidity bounds. `b` sets market depth and the house's max subsidy. */
export const MIN_LIQUIDITY = 50;
export const MAX_LIQUIDITY = 10_000;
export const DEFAULT_LIQUIDITY = 500;

/** A resolution must explain itself; this is the minimum that counts as trying. */
export const MIN_REASON_LENGTH = 10;

/**
 * Points every new account starts with.
 *
 * Mirrors the `User.balance` default in `schema.prisma`. Prisma cannot read a
 * TypeScript constant, so those two have to be changed together — and changing
 * this one alone silently affects only the profit calculation, not what new
 * users actually receive.
 */
export const STARTING_BALANCE = 10_000;

/** The same number written for prose. Locale pinned so it never renders as `10.000`. */
export const STARTING_BALANCE_LABEL = STARTING_BALANCE.toLocaleString("en-US");
