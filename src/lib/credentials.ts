/**
 * The email/password account flow.
 *
 * This is the credentials counterpart to the Google wiring in `auth.ts`, and it
 * deliberately reuses the same gates so the two providers cannot drift apart: a
 * ban blocks both, the same IP rate-limit buckets (`signup` / `signin`) cover
 * both, and admin rights are re-derived from `ADMIN_EMAILS` on every sign-in for
 * both. What differs is only the credential check — a hashed password here, an
 * OAuth handshake there — and that a session is minted directly (see
 * `session.ts` for why the Credentials provider is bypassed).
 *
 * Everything a route/action needs to translate to UI lives on `CredentialsError.code`.
 */

import { prisma } from "./db";
import {
  isAdminEmail,
  isValidEmail,
  normalizeEmail,
  validatePassword,
} from "./authPolicy";
import { isBanned } from "./bans";
import { clientIp } from "./clientIp";
import { verifyCaptcha } from "./captcha";
import { hashPassword, verifyPassword } from "./password";
import { assignHandle } from "./handles";
import { consume } from "./rateLimit";
import { createUserSession } from "./session";

export type CredentialsErrorCode =
  | "INVALID_EMAIL"
  | "WEAK_PASSWORD"
  | "EMAIL_TAKEN"
  | "INVALID_CREDENTIALS"
  | "USE_GOOGLE"
  | "BANNED"
  | "CAPTCHA_FAILED"
  | "RATE_LIMITED";

export class CredentialsError extends Error {
  readonly code: CredentialsErrorCode;

  constructor(code: CredentialsErrorCode, message: string) {
    super(message);
    this.name = "CredentialsError";
    this.code = code;
  }
}

export interface CredentialsInput {
  email: string;
  password: string;
  captchaToken?: string | null;
}

/**
 * A fixed scrypt hash of a throwaway value, verified against when no account
 * exists. Running a real comparison on the miss path keeps sign-in time roughly
 * constant whether or not the email is registered, so response timing does not
 * become an account-enumeration oracle. (Signup already reveals existence via
 * EMAIL_TAKEN, but sign-in should not add a second, quieter channel.)
 */
const DUMMY_HASH =
  "scrypt$32768$8$1$0000000000000000000000000000000000000000000000000000000000000000$" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Shared front matter for both entry points: confirm the captcha, then spend a
 * rate-limit token, then confirm the address is not banned. Order matters —
 * captcha first so a script cannot burn another user's IP budget without
 * solving one, ban check last so a banned user still consumes their own token.
 */
async function guard(email: string, captchaToken: string | null | undefined, policy: "signup" | "signin"): Promise<void> {
  const captcha = await verifyCaptcha(captchaToken, { remoteIp: await clientIp() });
  if (!captcha.ok) {
    throw new CredentialsError("CAPTCHA_FAILED", "Please complete the “I am human” check.");
  }

  const ip = await clientIp();
  if (ip) {
    const { allowed } = await consume(policy, ip);
    if (!allowed) {
      throw new CredentialsError(
        "RATE_LIMITED",
        "Too many attempts from your network. Wait a little and try again.",
      );
    }
  } else {
    // Fail open, exactly as the Google path does — bucketing every
    // unidentifiable request under one key would let one abuser lock out an
    // entire shared proxy.
    console.warn("[credentials] client IP unavailable; rate limit not applied");
  }

  if (await isBanned(email)) {
    throw new CredentialsError("BANNED", "This account has been suspended.");
  }
}

/**
 * Register a new email/password account and sign it in.
 *
 * Mirrors the Google `createUser` event: default balance from the schema, no
 * signup bonus (handing out points per account is what makes multi-accounting
 * pay), a unique handle, and admin rights only if the address is configured.
 */
export async function registerCredentials(input: CredentialsInput): Promise<{ userId: string }> {
  const email = normalizeEmail(input.email);

  if (!isValidEmail(email)) {
    throw new CredentialsError("INVALID_EMAIL", "Enter a valid email address.");
  }
  const weak = validatePassword(input.password);
  if (weak) {
    throw new CredentialsError("WEAK_PASSWORD", weak);
  }

  await guard(email, input.captchaToken, "signup");

  // Check-then-create is racy on its own, so the unique constraint on
  // `User.email` is the real guard: a second concurrent signup throws P2002,
  // which we translate to the same EMAIL_TAKEN the pre-check would have.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new CredentialsError("EMAIL_TAKEN", "An account with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);
  const isAdmin = isAdminEmail(email, process.env.ADMIN_EMAILS);

  let user: { id: string };
  try {
    user = await prisma.user.create({
      data: { email, passwordHash, isAdmin },
      select: { id: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CredentialsError("EMAIL_TAKEN", "An account with this email already exists.");
    }
    throw err;
  }

  await assignHandle(user.id, null, email);
  await createUserSession(user.id);
  return { userId: user.id };
}

/**
 * Verify an email/password pair and sign in.
 *
 * A missing account, a Google-only account (no `passwordHash`), and a wrong
 * password are handled so their timing is similar; the messages differ only
 * where it helps the user without leaking anything signup does not already.
 */
export async function signInCredentials(input: CredentialsInput): Promise<{ userId: string }> {
  const email = normalizeEmail(input.email);

  // Cheap shape check before doing any work; a malformed address cannot match
  // any row anyway, and this keeps an obviously-bad form submission fast.
  if (!isValidEmail(email) || typeof input.password !== "string" || input.password.length === 0) {
    throw new CredentialsError("INVALID_CREDENTIALS", "Incorrect email or password.");
  }

  await guard(email, input.captchaToken, "signin");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  // No account, or an account created via Google that has no password: run a
  // dummy verify so the timing matches the success path, then reject.
  if (!user?.passwordHash) {
    await verifyPassword(input.password, DUMMY_HASH);
    if (user && !user.passwordHash) {
      throw new CredentialsError(
        "USE_GOOGLE",
        "This email is registered with Google — use “Continue with Google”.",
      );
    }
    throw new CredentialsError("INVALID_CREDENTIALS", "Incorrect email or password.");
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    throw new CredentialsError("INVALID_CREDENTIALS", "Incorrect email or password.");
  }

  // Re-derive admin rights on every sign-in, same as the Google callback, so a
  // change to ADMIN_EMAILS takes effect at next login rather than being frozen
  // at account creation.
  await prisma.user.update({
    where: { id: user.id },
    data: { isAdmin: isAdminEmail(email, process.env.ADMIN_EMAILS) },
  });

  await createUserSession(user.id);
  return { userId: user.id };
}

/** Prisma's unique-constraint error code, without importing the client runtime. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
