/**
 * hCaptcha verification tests. Pure — the network call is stubbed via the
 * injectable `fetchImpl`, so nothing here touches hCaptcha.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifyCaptcha } from "./captcha";

/** Build a fake `fetch` that returns a given siteverify JSON body. */
function fakeFetch(body: unknown): typeof fetch {
  return (async () => ({ json: async () => body })) as unknown as typeof fetch;
}

/** A `fetch` that always rejects, standing in for hCaptcha being unreachable. */
const throwingFetch = (async () => {
  throw new Error("network down");
}) as unknown as typeof fetch;

describe("verifyCaptcha", () => {
  it("skips (passes) when no secret is configured", async () => {
    const result = await verifyCaptcha("any-token", { secret: undefined, fetchImpl: throwingFetch });
    assert.equal(result.ok, true);
  });

  it("fails a missing token when a secret is set", async () => {
    const result = await verifyCaptcha("", { secret: "s", fetchImpl: fakeFetch({ success: true }) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing-captcha");
  });

  it("passes when siteverify reports success", async () => {
    const result = await verifyCaptcha("tok", { secret: "s", fetchImpl: fakeFetch({ success: true }) });
    assert.equal(result.ok, true);
  });

  it("fails when siteverify reports failure, surfacing the error codes", async () => {
    const result = await verifyCaptcha("tok", {
      secret: "s",
      fetchImpl: fakeFetch({ success: false, "error-codes": ["invalid-input-response"] }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid-input-response");
  });

  it("fails closed when hCaptcha is unreachable", async () => {
    const result = await verifyCaptcha("tok", { secret: "s", fetchImpl: throwingFetch });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "captcha-unreachable");
  });
});
