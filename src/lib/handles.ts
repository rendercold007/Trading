/**
 * Assigning a unique leaderboard handle to a freshly created user.
 *
 * Extracted from `auth.ts` so both account-creation paths — the Google
 * `createUser` event and the email/password `registerCredentials` flow — share
 * one implementation. `User.handle` is unique, so a raw candidate can collide;
 * this retries with a numeric suffix and falls back to a random one rather than
 * leaving an account handle-less.
 */

import { prisma } from "./db";
import { handleCandidate, suffixedHandle } from "./authPolicy";

/** How many `handle-2`, `handle-3`, … attempts before falling back to a random one. */
const MAX_HANDLE_ATTEMPTS = 5;

export async function assignHandle(
  userId: string,
  name: string | null,
  email: string,
): Promise<void> {
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
