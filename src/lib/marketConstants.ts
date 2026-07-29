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
