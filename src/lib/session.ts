/**
 * Minting a database session for the email/password flow.
 *
 * Why this exists: NextAuth's Credentials provider only works with the JWT
 * session strategy, and CLAUDE.md forbids JWTs here — a JWT cannot be revoked,
 * which would break instant ban-out, and `isAdmin`/`balance` would go stale.
 * So the password flow bypasses the Credentials provider entirely and writes a
 * real `Session` row the same shape the Prisma adapter writes for Google, then
 * sets the exact cookie Auth.js reads. `auth()` then treats a password session
 * and a Google session identically — same revocation, same freshness.
 *
 * The cookie name and attributes must match what `@auth/core` expects, or
 * `auth()` will not find the session. Verified against the installed version:
 * the name is `authjs.session-token`, prefixed `__Secure-` only over https.
 * If NextAuth is upgraded, re-check `@auth/core/lib/utils/cookie` before trusting
 * this. (There is a matching note in CLAUDE.md.)
 */

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import { prisma } from "./db";

/** Auth.js default database-session lifetime: 30 days. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Secure cookies (and the `__Secure-` prefix) are used when the deployment URL
 * is https. Auth.js derives this the same way; matching it is what keeps the
 * cookie name in agreement between the two code paths.
 */
function useSecureCookies(): boolean {
  const url = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  return url.startsWith("https://");
}

/** The session-token cookie name Auth.js reads, for the current environment. */
export function sessionCookieName(): string {
  return useSecureCookies() ? "__Secure-authjs.session-token" : "authjs.session-token";
}

/**
 * Create a session row for `userId` and set its cookie, signing the user in.
 * The token is a random UUID, exactly what the adapter uses for Google.
 */
export async function createUserSession(userId: string): Promise<void> {
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await prisma.session.create({ data: { sessionToken, userId, expires } });

  const store = await cookies();
  store.set(sessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: useSecureCookies(),
    expires,
  });
}
