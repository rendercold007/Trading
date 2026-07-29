/**
 * Request parsing tests. Pure — this is the boundary where untrusted input
 * becomes typed values, so it is worth covering the hostile cases properly.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ValidationError } from "./apiError";
import { parseQuoteQuery, parseTradeBody } from "./apiSchema";

const rejects = (fn: () => unknown, field?: string) => {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof ValidationError, `expected ValidationError, got ${err}`);
    if (field) assert.equal(err.field, field);
    return true;
  });
};

describe("parseTradeBody", () => {
  it("accepts a well-formed share buy", () => {
    const parsed = parseTradeBody({
      marketId: "cm123",
      outcome: "YES",
      side: "BUY",
      shares: 100,
    });
    assert.deepEqual(parsed, { marketId: "cm123", outcome: "YES", side: "BUY", shares: 100 });
  });

  it("accepts a budget buy", () => {
    const parsed = parseTradeBody({
      marketId: "cm123",
      outcome: "NO",
      side: "BUY",
      budget: 500,
    });
    assert.deepEqual(parsed, { marketId: "cm123", outcome: "NO", side: "BUY", budget: 500 });
  });

  it("accepts a sell", () => {
    const parsed = parseTradeBody({
      marketId: "cm123",
      outcome: "YES",
      side: "SELL",
      shares: 25,
    });
    assert.equal(parsed.side, "SELL");
    assert.equal(parsed.shares, 25);
  });

  it("accepts numeric strings, because that is what form inputs send", () => {
    const parsed = parseTradeBody({
      marketId: "cm123",
      outcome: "yes",
      side: "buy",
      shares: "42.5",
    });
    assert.equal(parsed.shares, 42.5);
    assert.equal(parsed.outcome, "YES", "outcome and side are case-insensitive");
    assert.equal(parsed.side, "BUY");
  });

  it("trims a padded marketId", () => {
    assert.equal(
      parseTradeBody({ marketId: "  cm123 ", outcome: "YES", side: "BUY", shares: 1 }).marketId,
      "cm123",
    );
  });

  describe("rejects bad bodies", () => {
    it("non-objects", () => {
      rejects(() => parseTradeBody(null));
      rejects(() => parseTradeBody("a string"));
      rejects(() => parseTradeBody(42));
      rejects(() => parseTradeBody([{ marketId: "cm123" }]));
    });

    it("a missing or empty marketId", () => {
      rejects(() => parseTradeBody({ outcome: "YES", side: "BUY", shares: 1 }), "marketId");
      rejects(
        () => parseTradeBody({ marketId: "   ", outcome: "YES", side: "BUY", shares: 1 }),
        "marketId",
      );
    });

    it("an outcome that is not YES or NO", () => {
      rejects(
        () => parseTradeBody({ marketId: "cm1", outcome: "MAYBE", side: "BUY", shares: 1 }),
        "outcome",
      );
    });

    it("a side that is not BUY or SELL", () => {
      rejects(
        () => parseTradeBody({ marketId: "cm1", outcome: "YES", side: "HOLD", shares: 1 }),
        "side",
      );
    });

    it("both shares and budget, or neither", () => {
      rejects(() =>
        parseTradeBody({ marketId: "cm1", outcome: "YES", side: "BUY", shares: 1, budget: 1 }),
      );
      rejects(() => parseTradeBody({ marketId: "cm1", outcome: "YES", side: "BUY" }));
    });

    it("a budget on a sell — it has no meaning there", () => {
      rejects(
        () => parseTradeBody({ marketId: "cm1", outcome: "YES", side: "SELL", budget: 100 }),
        "budget",
      );
    });

    it("sizes that are not positive finite numbers", () => {
      const base = { marketId: "cm1", outcome: "YES", side: "BUY" };
      for (const shares of [0, -5, "abc", NaN, Infinity, -Infinity, true, {}, []]) {
        rejects(() => parseTradeBody({ ...base, shares }), "shares");
      }
    });

    it("an absurdly large size", () => {
      rejects(
        () => parseTradeBody({ marketId: "cm1", outcome: "YES", side: "BUY", shares: 1e12 }),
        "shares",
      );
    });

    it("a negative size dressed up as a string — a sell smuggled into a buy", () => {
      rejects(
        () => parseTradeBody({ marketId: "cm1", outcome: "YES", side: "BUY", shares: "-100" }),
        "shares",
      );
    });
  });

  it("ignores a userId in the body — identity comes from the session only", () => {
    const parsed = parseTradeBody({
      marketId: "cm1",
      outcome: "YES",
      side: "BUY",
      shares: 1,
      userId: "someone-else",
    });
    assert.ok(!("userId" in parsed), "a caller-supplied userId must never survive parsing");
  });
});

describe("parseQuoteQuery", () => {
  const query = (s: string) => new URLSearchParams(s);

  it("parses a share quote", () => {
    const parsed = parseQuoteQuery(query("marketId=cm1&outcome=YES&side=BUY&shares=10"));
    assert.deepEqual(parsed, { marketId: "cm1", outcome: "YES", side: "BUY", shares: 10 });
  });

  it("parses a budget quote", () => {
    const parsed = parseQuoteQuery(query("marketId=cm1&outcome=NO&side=BUY&budget=250"));
    assert.equal(parsed.budget, 250);
  });

  it("defaults side to BUY, the common case", () => {
    assert.equal(parseQuoteQuery(query("marketId=cm1&outcome=YES&shares=5")).side, "BUY");
  });

  it("quotes a sell", () => {
    assert.equal(
      parseQuoteQuery(query("marketId=cm1&outcome=YES&side=SELL&shares=5")).side,
      "SELL",
    );
  });

  it("treats an empty parameter as absent rather than as zero", () => {
    // ?shares=&budget=100 is what a form with a cleared shares field sends.
    const parsed = parseQuoteQuery(query("marketId=cm1&outcome=YES&shares=&budget=100"));
    assert.equal(parsed.budget, 100);
    assert.equal(parsed.shares, undefined);
  });

  it("rejects the same bad input as the body parser", () => {
    rejects(() => parseQuoteQuery(query("outcome=YES&shares=1")), "marketId");
    rejects(() => parseQuoteQuery(query("marketId=cm1&outcome=PERHAPS&shares=1")), "outcome");
    rejects(() => parseQuoteQuery(query("marketId=cm1&outcome=YES")));
    rejects(() => parseQuoteQuery(query("marketId=cm1&outcome=YES&shares=-1")), "shares");
  });
});
