/**
 * Error-to-HTTP mapping tests.
 *
 * The status code is the API's contract with the UI: 400 means "the form is
 * wrong", 409 means "the form is fine but the answer is no", 429 means "slow
 * down". Getting these confused makes it impossible to write sensible UI, so
 * they are pinned here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ValidationError, assertSameOrigin, errorResponse, readJsonBody } from "./apiError";
import { AuthError } from "./auth";
import { RateLimitError } from "./rateLimit";
import { TradeError } from "./trade";

async function bodyOf(response: Response): Promise<{ error: Record<string, unknown> }> {
  return (await response.json()) as { error: Record<string, unknown> };
}

describe("errorResponse", () => {
  it("maps a validation failure to 400 with the offending field", async () => {
    const response = errorResponse(new ValidationError("shares must be a number", "shares"));
    assert.equal(response.status, 400);

    const body = await bodyOf(response);
    assert.equal(body.error.code, "INVALID_REQUEST");
    assert.equal(body.error.field, "shares");
  });

  it("maps rate limiting to 429 and sets Retry-After", async () => {
    const response = errorResponse(new RateLimitError("trade", 42, "slow down"));
    assert.equal(response.status, 429);
    assert.equal(
      response.headers.get("Retry-After"),
      "42",
      "clients and proxies rely on this header",
    );

    const body = await bodyOf(response);
    assert.equal(body.error.retryAfter, 42);
  });

  it("separates unauthenticated (401) from forbidden (403)", () => {
    assert.equal(errorResponse(new AuthError("UNAUTHENTICATED", "sign in")).status, 401);
    assert.equal(errorResponse(new AuthError("FORBIDDEN", "admins only")).status, 403);
  });

  describe("trade failures", () => {
    const cases = [
      ["INVALID_SIZE", 400],
      ["MARKET_NOT_FOUND", 404],
      ["USER_NOT_FOUND", 401],
      ["MARKET_CLOSED", 409],
      ["INSUFFICIENT_BALANCE", 409],
      ["INSUFFICIENT_SHARES", 409],
    ] as const;

    for (const [code, status] of cases) {
      it(`${code} → ${status}`, () => {
        assert.equal(errorResponse(new TradeError(code, "nope")).status, status);
      });
    }

    it("keeps the message, since these are shown to the trader", async () => {
      const response = errorResponse(
        new TradeError("INSUFFICIENT_BALANCE", "this trade costs 900 points"),
      );
      const body = await bodyOf(response);
      assert.match(String(body.error.message), /900 points/);
    });
  });

  it("turns anything unrecognised into a 500 that leaks nothing", async () => {
    const response = errorResponse(new Error("connection to postgres://user:pw@host failed"));
    assert.equal(response.status, 500);

    const body = await bodyOf(response);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(
      String(body.error.message),
      /postgres|pw@host/,
      "internal detail must never reach the client",
    );
  });

  it("handles non-Error throws without falling over", () => {
    assert.equal(errorResponse("just a string").status, 500);
    assert.equal(errorResponse(undefined).status, 500);
  });
});

describe("assertSameOrigin", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost:3000/api/trade", { method: "POST", headers });

  it("allows a matching origin", () => {
    assertSameOrigin(request({ origin: "http://localhost:3000", host: "localhost:3000" }));
  });

  it("allows a request with no Origin header", () => {
    // Same-origin requests may omit it; absence is not evidence of an attack.
    assertSameOrigin(request({ host: "localhost:3000" }));
  });

  it("rejects a foreign origin with 403, not 400", () => {
    assert.throws(
      () => assertSameOrigin(request({ origin: "https://evil.example", host: "localhost:3000" })),
      (err: unknown) => err instanceof AuthError && err.code === "FORBIDDEN",
    );
  });

  it("rejects a malformed Origin header", () => {
    assert.throws(
      () => assertSameOrigin(request({ origin: "not a url", host: "localhost:3000" })),
      (err: unknown) => err instanceof ValidationError,
    );
  });
});

describe("readJsonBody", () => {
  it("parses a JSON body", async () => {
    const request = new Request("http://localhost:3000/api/trade", {
      method: "POST",
      body: JSON.stringify({ shares: 10 }),
    });
    assert.deepEqual(await readJsonBody(request), { shares: 10 });
  });

  it("turns malformed JSON into a 400, not a 500", async () => {
    const request = new Request("http://localhost:3000/api/trade", {
      method: "POST",
      body: "{ not json",
    });
    await assert.rejects(
      () => readJsonBody(request),
      (err: unknown) => err instanceof ValidationError,
    );
  });
});
