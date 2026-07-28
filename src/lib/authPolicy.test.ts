/**
 * Auth policy tests. Pure — no database, no NextAuth, no network.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalEmail,
  handleCandidate,
  isAdminEmail,
  normalizeEmail,
  parseAdminEmails,
  suffixedHandle,
  MAX_HANDLE_LENGTH,
} from "./authPolicy";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeEmail("  Alex@Example.COM "), "alex@example.com");
  });
});

describe("canonicalEmail", () => {
  it("collapses gmail dots and plus tags to one address", () => {
    assert.equal(canonicalEmail("first.last@gmail.com"), "firstlast@gmail.com");
    assert.equal(canonicalEmail("firstlast+bets@gmail.com"), "firstlast@gmail.com");
    assert.equal(canonicalEmail("f.i.r.s.t.last+a+b@gmail.com"), "firstlast@gmail.com");
  });

  it("treats googlemail as gmail", () => {
    assert.equal(canonicalEmail("first.last@googlemail.com"), "firstlast@gmail.com");
  });

  it("leaves other domains alone — dots there are not aliases", () => {
    assert.equal(canonicalEmail("first.last@example.com"), "first.last@example.com");
    assert.equal(canonicalEmail("first+tag@example.com"), "first+tag@example.com");
  });

  it("does not choke on malformed input", () => {
    assert.equal(canonicalEmail("not-an-email"), "not-an-email");
    assert.equal(canonicalEmail(""), "");
  });
});

describe("parseAdminEmails", () => {
  it("splits, trims and lowercases", () => {
    assert.deepEqual(parseAdminEmails("A@x.com, b@y.com"), ["a@x.com", "b@y.com"]);
  });

  it("ignores blanks and junk entries", () => {
    assert.deepEqual(parseAdminEmails("a@x.com,,  ,notanemail,b@y.com"), [
      "a@x.com",
      "b@y.com",
    ]);
  });

  it("returns nothing for unset or empty config", () => {
    assert.deepEqual(parseAdminEmails(undefined), []);
    assert.deepEqual(parseAdminEmails(""), []);
    assert.deepEqual(parseAdminEmails("   "), []);
  });
});

describe("isAdminEmail", () => {
  it("matches case-insensitively", () => {
    assert.equal(isAdminEmail("Boss@Example.com", "boss@example.com"), true);
  });

  it("denies anyone not listed", () => {
    assert.equal(isAdminEmail("someone@example.com", "boss@example.com"), false);
  });

  it("grants nobody admin when the list is unset — an empty list is not a wildcard", () => {
    assert.equal(isAdminEmail("anyone@example.com", undefined), false);
    assert.equal(isAdminEmail("anyone@example.com", ""), false);
  });

  it("does not apply gmail canonicalisation — admin grants must be exact", () => {
    assert.equal(isAdminEmail("first.last@gmail.com", "firstlast@gmail.com"), false);
  });
});

describe("handleCandidate", () => {
  it("slugifies a display name", () => {
    assert.equal(handleCandidate("Alex Kumar", "a@x.com"), "alex-kumar");
  });

  it("strips accents rather than dropping the characters", () => {
    assert.equal(handleCandidate("Zoë Bäcker", "z@x.com"), "zoe-backer");
  });

  it("falls back to the email local part when there is no name", () => {
    assert.equal(handleCandidate(null, "trader.joe@example.com"), "trader-joe");
    assert.equal(handleCandidate("   ", "trader.joe@example.com"), "trader-joe");
  });

  it("falls back to 'trader' when nothing usable survives", () => {
    assert.equal(handleCandidate("🎲🎲", "x@y.com"), "trader");
    assert.equal(handleCandidate("!!", "a@b.com"), "trader");
  });

  it("respects the length limit and never ends in a dash", () => {
    const handle = handleCandidate("Bartholomew Fitzgerald Montgomery", "b@x.com");
    assert.ok(handle.length <= MAX_HANDLE_LENGTH);
    assert.ok(!handle.endsWith("-"), `got ${handle}`);
  });

  it("produces only url-safe characters", () => {
    for (const name of ["Alex Kumar", "Zoë Bäcker", "user@name", "a  b", "🎲"]) {
      assert.match(handleCandidate(name, "x@y.com"), /^[a-z0-9-]+$/);
    }
  });
});

describe("suffixedHandle", () => {
  it("numbers collisions from 2 upward", () => {
    assert.equal(suffixedHandle("alex-kumar", 1), "alex-kumar-2");
    assert.equal(suffixedHandle("alex-kumar", 2), "alex-kumar-3");
  });

  it("keeps the result within the length limit by trimming the base", () => {
    const long = "a".repeat(MAX_HANDLE_LENGTH);
    const handle = suffixedHandle(long, 1);
    assert.ok(handle.length <= MAX_HANDLE_LENGTH, `got ${handle.length}`);
    assert.ok(handle.endsWith("-2"));
  });
});
