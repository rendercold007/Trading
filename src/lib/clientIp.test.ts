/**
 * Client IP resolution tests. Pure — `clientIp()` itself needs a request scope,
 * but the parsing it delegates to is where the security property lives.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeIp, parseForwardedFor } from "./clientIp";

describe("parseForwardedFor", () => {
  it("returns the only address when there is one hop", () => {
    assert.equal(parseForwardedFor("203.0.113.7", 1), "203.0.113.7");
  });

  it("takes the address our own proxy appended, not the one the client sent", () => {
    // The client claimed to be 1.1.1.1; our edge saw 203.0.113.7 and appended it.
    assert.equal(parseForwardedFor("1.1.1.1, 203.0.113.7", 1), "203.0.113.7");
  });

  it("ignores a spoofed chain — this is the whole point", () => {
    const spoofed = "9.9.9.9, 8.8.8.8, 7.7.7.7, 203.0.113.7";
    assert.equal(
      parseForwardedFor(spoofed, 1),
      "203.0.113.7",
      "an attacker padding x-forwarded-for must not change the bucket key",
    );
  });

  it("counts back further when more proxies are trusted", () => {
    assert.equal(parseForwardedFor("1.1.1.1, 203.0.113.7, 10.0.0.1", 2), "203.0.113.7");
  });

  it("does not run off the start of a short chain", () => {
    assert.equal(parseForwardedFor("203.0.113.7", 3), "203.0.113.7");
  });

  it("tolerates whitespace and empty entries", () => {
    assert.equal(parseForwardedFor("  1.1.1.1 ,  , 203.0.113.7  ", 1), "203.0.113.7");
  });

  it("returns null for missing or empty headers", () => {
    assert.equal(parseForwardedFor(null, 1), null);
    assert.equal(parseForwardedFor("", 1), null);
    assert.equal(parseForwardedFor("  , ,  ", 1), null);
  });
});

describe("normalizeIp", () => {
  it("leaves a plain IPv4 address alone", () => {
    assert.equal(normalizeIp("203.0.113.7"), "203.0.113.7");
  });

  it("strips a port from IPv4", () => {
    assert.equal(normalizeIp("203.0.113.7:54321"), "203.0.113.7");
  });

  it("keeps IPv6 intact rather than mistaking colons for a port", () => {
    assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1");
  });

  it("unwraps bracketed IPv6 with a port", () => {
    assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
  });

  it("folds IPv4-mapped IPv6 to the v4 form so both spellings share a bucket", () => {
    assert.equal(normalizeIp("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(normalizeIp("::FFFF:203.0.113.7"), "203.0.113.7");
  });

  it("is case-insensitive and trims", () => {
    assert.equal(normalizeIp("  2001:DB8::1  "), "2001:db8::1");
  });
});
