/**
 * Translating internal errors into HTTP responses.
 *
 * Route handlers should never build error responses by hand — every failure
 * goes through `errorResponse` so a given condition always produces the same
 * status and body shape, and so an unexpected exception can never leak a stack
 * trace or a database message to the client.
 */

import { AuthError } from "./auth";
import { RateLimitError } from "./rateLimit";
import { TradeError, type TradeErrorCode } from "./trade";

/** Thrown by request parsers. Always a client mistake, always 400. */
export class ValidationError extends Error {
  readonly code = "INVALID_REQUEST" as const;
  /** Which field was wrong, when it is a single one. */
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

/** The JSON body every failure returns. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    field?: string;
    /** Seconds to wait, on 429 only. */
    retryAfter?: number;
  };
}

/**
 * Status for each trade failure.
 *
 * The distinction that matters to a UI: 400 means "you sent something
 * nonsensical, fix the form", 409 means "your request was well-formed but the
 * world says no" — show the user why and let them adjust. Lumping both into 400
 * would make it impossible to tell a bug from a normal rejection.
 */
const TRADE_STATUS: Record<TradeErrorCode, number> = {
  INVALID_SIZE: 400,
  MARKET_NOT_FOUND: 404,
  // The session points at a user row that no longer exists, so the caller's
  // credentials are the problem, not the market.
  USER_NOT_FOUND: 401,
  MARKET_CLOSED: 409,
  INSUFFICIENT_BALANCE: 409,
  INSUFFICIENT_SHARES: 409,
};

function json(body: ApiErrorBody, status: number, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

/**
 * Map any thrown value to a response.
 *
 * Anything unrecognised becomes a generic 500: the real error goes to the
 * server log, and the client is told nothing beyond that it failed. An
 * unexpected exception is exactly the case where the message is most likely to
 * contain a connection string or a row of somebody else's data.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof ValidationError) {
    return json({ error: { code: err.code, message: err.message, field: err.field } }, 400);
  }

  if (err instanceof RateLimitError) {
    return json(
      { error: { code: err.code, message: err.message, retryAfter: err.retryAfter } },
      429,
      // Standard header — clients and proxies already know what to do with it.
      { "Retry-After": String(err.retryAfter) },
    );
  }

  if (err instanceof AuthError) {
    return json(
      { error: { code: err.code, message: err.message } },
      err.code === "UNAUTHENTICATED" ? 401 : 403,
    );
  }

  if (err instanceof TradeError) {
    return json({ error: { code: err.code, message: err.message } }, TRADE_STATUS[err.code] ?? 400);
  }

  console.error("[api] unhandled error:", err);
  return json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } },
    500,
  );
}

/**
 * Reject cross-site writes.
 *
 * The session cookie is `SameSite=Lax`, which already stops a cross-site form
 * POST from carrying it, and a cross-origin `fetch` with a JSON content type is
 * blocked by CORS preflight. This is a third layer, cheap enough to be worth
 * having: if either of those assumptions changes, a hostile page still cannot
 * spend someone's points by having their browser POST here.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  // Same-origin `fetch` omits Origin on some browsers for same-origin requests;
  // absence is not evidence of an attack, presence of a foreign one is.
  if (!origin) return;

  const host = request.headers.get("host");
  if (!host) throw new ValidationError("missing Host header");

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ValidationError("malformed Origin header");
  }

  if (originHost !== host) {
    throw new AuthError("FORBIDDEN", "cross-origin requests are not accepted");
  }
}

/** Parse a JSON body, turning malformed input into a 400 rather than a 500. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("request body must be valid JSON");
  }
}
