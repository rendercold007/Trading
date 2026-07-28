/**
 * The deny list.
 *
 * Registration is open (see CLAUDE.md), so there is no allowlist to check
 * against — banning is the only membership control the app has. Kept separate
 * from `src/lib/auth.ts` so it carries no NextAuth dependency and can be
 * exercised directly by tests and by admin tooling.
 */

import { prisma } from "./db";
import { canonicalEmail, normalizeEmail } from "./authPolicy";

/**
 * Whether this address is banned. Checks the address as given *and* its
 * canonical form, so a Gmail ban is not evaded by adding a dot or a +tag.
 */
export async function isBanned(email: string): Promise<boolean> {
  const candidates = [...new Set([normalizeEmail(email), canonicalEmail(email)])];
  const hit = await prisma.bannedEmail.findFirst({
    where: { email: { in: candidates } },
    select: { email: true },
  });
  return hit !== null;
}

/**
 * Ban an address and revoke any session it currently holds.
 *
 * Deleting the session rows is the whole point of doing this in one place: the
 * deny list only blocks *new* sign-ins, so without the revocation a banned user
 * keeps trading until their cookie happens to expire. This is also why sessions
 * are database-backed rather than JWTs — a JWT cannot be withdrawn.
 *
 * Stored in canonical form so the ban covers every alias of the mailbox.
 */
export async function banEmail(
  email: string,
  opts: { reason?: string; bannedBy?: string } = {},
): Promise<void> {
  const canonical = canonicalEmail(email);

  await prisma.$transaction(async (tx) => {
    await tx.bannedEmail.upsert({
      where: { email: canonical },
      create: { email: canonical, reason: opts.reason, bannedBy: opts.bannedBy },
      update: { reason: opts.reason, bannedBy: opts.bannedBy },
    });

    const banned = await tx.user.findMany({
      where: { email: { in: [normalizeEmail(email), canonical] } },
      select: { id: true },
    });
    if (banned.length > 0) {
      await tx.session.deleteMany({ where: { userId: { in: banned.map((u) => u.id) } } });
    }
  });
}

/** Lift a ban. Does not restore sessions — the user signs in again. */
export async function unbanEmail(email: string): Promise<void> {
  await prisma.bannedEmail.deleteMany({
    where: { email: { in: [...new Set([normalizeEmail(email), canonicalEmail(email)])] } },
  });
}
