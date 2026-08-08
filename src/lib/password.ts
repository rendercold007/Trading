/**
 * Password hashing for email/password accounts.
 *
 * scrypt from Node's built-in `crypto`, not bcrypt/argon2 — those are native
 * addons that would need a compile step on this machine (see the Tailwind
 * native-binding note in CLAUDE.md for how that goes), and scrypt is a
 * memory-hard KDF that OWASP lists as an acceptable choice. Keeping it
 * dependency-free matches the rest of the codebase, which reaches for `node:`
 * built-ins before an npm package.
 *
 * The stored form is self-describing: `scrypt$N$r$p$salt$hash`, all fields in
 * one string, so the parameters travel with the hash and can be raised later
 * without a schema change — an old hash still carries the N it was made with.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Promisified scrypt. Hand-wrapped rather than `util.promisify`d because the
 * latter picks the callback overload *without* an options object, and the cost
 * parameters are the whole point of using scrypt deliberately.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * scrypt cost parameters. N is the work factor (must be a power of two); r and
 * p tune memory and parallelism. 2^15 is a common interactive-login setting —
 * heavy enough to be worth an attacker's while, fast enough for a sign-in.
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * scrypt needs roughly `128 * N * r` bytes, which at these parameters is ~32 MB
 * — right at Node's default `maxmem` ceiling, so it errors without this. Give it
 * headroom rather than sitting on the boundary, and keep the same value on the
 * verify path so a hash made here can always be checked here.
 */
const MAXMEM = 128 * N * R * 2;

/**
 * Reject absurd inputs before hashing. scrypt reads the whole password into a
 * buffer, so an unbounded length is a cheap way to make the server do work; the
 * minimum is the actual strength rule and lives in `authPolicy.validatePassword`,
 * this is only a floor/ceiling guard for the KDF itself.
 */
const MAX_PASSWORD_BYTES = 1024;

/** Hash a plaintext password into the self-describing stored form. */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("password must be a non-empty string");
  }
  if (Buffer.byteLength(plain, "utf8") > MAX_PASSWORD_BYTES) {
    throw new Error("password is too long to hash");
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });

  return ["scrypt", N, R, P, salt.toString("hex"), derived.toString("hex")].join("$");
}

/**
 * Verify a plaintext password against a stored hash.
 *
 * Returns `false` rather than throwing on a malformed or foreign hash, so a
 * caller can treat "no usable password on this account" and "wrong password"
 * the same way — both are just a failed sign-in. The comparison is
 * constant-time so a caller cannot learn how much of the hash matched.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (typeof plain !== "string" || typeof stored !== "string") return false;
  if (Buffer.byteLength(plain, "utf8") > MAX_PASSWORD_BYTES) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "hex");
    expected = Buffer.from(parts[5], "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    // maxmem derived from the hash's own parameters, with headroom, so a hash
    // made under different (e.g. later, heavier) settings still verifies.
    derived = await scrypt(plain, salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
  } catch {
    return false;
  }

  // Both buffers are `expected.length`, so timingSafeEqual won't throw on a
  // length mismatch — and the comparison itself does not leak via timing.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
