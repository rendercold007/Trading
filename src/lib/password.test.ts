/**
 * Password hashing tests. Pure — no database, no network.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("Correct horse battery staple", hash), false);
    assert.equal(await verifyPassword("", hash), false);
  });

  it("produces the self-describing scrypt format", async () => {
    const hash = await hashPassword("hunter2hunter2");
    const parts = hash.split("$");
    assert.equal(parts[0], "scrypt");
    assert.equal(parts.length, 6);
    assert.match(parts[4], /^[0-9a-f]+$/); // salt hex
    assert.match(parts[5], /^[0-9a-f]+$/); // hash hex
  });

  it("salts, so the same password hashes differently each time", async () => {
    const a = await hashPassword("same-password-123");
    const b = await hashPassword("same-password-123");
    assert.notEqual(a, b);
    // …but both still verify.
    assert.equal(await verifyPassword("same-password-123", a), true);
    assert.equal(await verifyPassword("same-password-123", b), true);
  });

  it("returns false rather than throwing on a malformed or foreign hash", async () => {
    for (const bad of ["", "not-a-hash", "scrypt$only$three", "bcrypt$1$2$3$4$5", "scrypt$x$y$z$q$w"]) {
      assert.equal(await verifyPassword("whatever", bad), false, bad);
    }
  });

  it("rejects an over-long password instead of hashing it", async () => {
    await assert.rejects(() => hashPassword("a".repeat(2000)));
    // Verify simply returns false for over-long input.
    const hash = await hashPassword("a-real-password");
    assert.equal(await verifyPassword("a".repeat(2000), hash), false);
  });
});
