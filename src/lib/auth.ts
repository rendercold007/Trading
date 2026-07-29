/**
 * NextAuth (Auth.js v5) configuration — Google sign-in, open registration.
 *
 * Registration is deliberately open: anyone with the link can create an account
 * (see CLAUDE.md). The only gate is the `BannedEmail` deny list. Google is the
 * sole provider because it raises the cost of mass multi-accounting compared
 * with email/password, and because there are no password resets to support.
 *
 * Sessions are database-backed via the Prisma adapter rather than JWTs. That
 * costs a query per request but buys two things this app needs: a ban can log
 * someone out immediately by deleting their session rows, and `isAdmin` and
 * `balance` are always read fresh rather than from a token minted minutes ago.
 */

import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { prisma } from "./db";
import { handleCandidate, isAdminEmail, normalizeEmail, suffixedHandle } from "./authPolicy";
import { isBanned } from "./bans";
import { clientIp } from "./clientIp";
import { consume } from "./rateLimit";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      handle: string | null;
      isAdmin: boolean;
      /** Spendable points. Read fresh on every request, so it is never stale. */
      balance: number;
    } & DefaultSession["user"];
  }
}

/** How many `handle-2`, `handle-3`, … attempts before falling back to a random one. */
const MAX_HANDLE_ATTEMPTS = 5;

/**
 * Assign a unique handle to a freshly created user.
 *
 * `User.handle` is unique, and two people called "Alex Kumar" will collide, so
 * retry with a numeric suffix and fall back to a random one rather than leaving
 * the account handle-less.
 */
async function assignHandle(userId: string, name: string | null, email: string): Promise<void> {
  const base = handleCandidate(name, email);

  for (let attempt = 0; attempt < MAX_HANDLE_ATTEMPTS; attempt++) {
    const handle = attempt === 0 ? base : suffixedHandle(base, attempt);
    try {
      await prisma.user.update({ where: { id: userId }, data: { handle } });
      return;
    } catch {
      // Unique violation — try the next suffix.
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { handle: suffixedHandle(base, Math.floor(Math.random() * 100_000)) },
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  session: { strategy: "database" },
  pages: { signIn: "/signin", error: "/signin" },

  callbacks: {
    /**
     * The registration gate. Runs before the adapter creates anything, so a
     * banned address never gets a row.
     */
    async signIn({ user }) {
      if (!user.email) return false;
      if (await isBanned(user.email)) return "/signin?error=banned";

      // Rate limit by IP, with a different budget for creating an account than
      // for signing back into one. Account creation is the expensive action —
      // it is how someone farms the leaderboard with throwaway accounts.
      const ip = await clientIp();
      if (ip) {
        const existing = await prisma.user.findUnique({
          where: { email: normalizeEmail(user.email) },
          select: { id: true },
        });
        const { allowed } = await consume(existing ? "signin" : "signup", ip);
        if (!allowed) return "/signin?error=rate_limited";
      } else {
        // Fail open. Bucketing every unidentifiable request under one key would
        // let a single abuser lock out every user behind an unknown proxy, which
        // is a worse failure than not limiting. Logged so it is visible if the
        // deployment is misconfigured and this becomes the normal path.
        console.warn("[auth] client IP unavailable; sign-in rate limit not applied");
      }

      // Re-derive admin rights from the environment on every sign-in, so
      // removing an address from ADMIN_EMAILS demotes that account. This is a
      // no-op on first sign-in (no row exists yet); `createUser` covers that.
      await prisma.user.updateMany({
        where: { email: normalizeEmail(user.email) },
        data: { isAdmin: isAdminEmail(user.email, process.env.ADMIN_EMAILS) },
      });

      return true;
    },

    /**
     * Shape the session object the app sees. With the database strategy `user`
     * is the live row, so these values are current as of this request.
     */
    async session({ session, user }) {
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { handle: true, isAdmin: true, balance: true },
      });

      session.user.id = user.id;
      session.user.handle = row?.handle ?? null;
      session.user.isAdmin = row?.isAdmin ?? false;
      session.user.balance = row?.balance.toNumber() ?? 0;
      return session;
    },
  },

  events: {
    /**
     * First sign-in only. The adapter has just written the row with default
     * balance and `isAdmin: false`; fill in the things it doesn't know about.
     *
     * Note there is no signup bonus here and there must never be one — points
     * handed out per account are exactly what makes multi-accounting pay.
     */
    async createUser({ user }) {
      if (!user.id || !user.email) return;

      if (isAdminEmail(user.email, process.env.ADMIN_EMAILS)) {
        await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
      }

      await assignHandle(user.id, user.name ?? null, user.email);
    },
  },
});

// ---------------------------------------------------------------------------
// Route and page guards
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN";

  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  handle: string | null;
  isAdmin: boolean;
  balance: number;
}

/** The signed-in user, or null. Use in pages that render differently when logged out. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    handle: session.user.handle,
    isAdmin: session.user.isAdmin,
    balance: session.user.balance,
  };
}

/**
 * The signed-in user, or throw. API routes should catch `AuthError` and map
 * `UNAUTHENTICATED` to 401, `FORBIDDEN` to 403.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthError("UNAUTHENTICATED", "you must be signed in");
  return user;
}

/** As `requireUser`, but also demands admin rights. Market creation and resolution. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new AuthError("FORBIDDEN", "this action is restricted to admins");
  return user;
}

export { banEmail, isBanned, unbanEmail } from "./bans";
