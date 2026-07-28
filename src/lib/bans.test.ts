/**
 * Ban list tests. Hits real Postgres — the session revocation is the part worth
 * testing and it only exists in the database.
 *
 * Requires the local database (see CLAUDE.md): docker start market-db
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { banEmail, isBanned, unbanEmail } from "./bans";
import { loadEnv } from "./loadEnv";

loadEnv();

const prisma = new PrismaClient();

/** Tag for exact cleanup, matching the convention in trade.test.ts. */
const RUN = `bantest-${randomUUID().slice(0, 8)}`;

function email(local: string, domain = "example.test"): string {
  return `${RUN}-${local}@${domain}`;
}

async function makeUserWithSession(address: string): Promise<{ userId: string }> {
  const user = await prisma.user.create({
    data: { email: address, name: "Banned Soon" },
    select: { id: true },
  });
  await prisma.session.create({
    data: {
      userId: user.id,
      sessionToken: `${RUN}-${randomUUID()}`,
      expires: new Date(Date.now() + 86_400_000),
    },
  });
  return { userId: user.id };
}

after(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.bannedEmail.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

describe("isBanned", () => {
  it("is false for an address nobody has banned", async () => {
    assert.equal(await isBanned(email("clean")), false);
  });

  it("is true once the address is banned", async () => {
    const address = email("cheater");
    await banEmail(address, { reason: "wash trading" });
    assert.equal(await isBanned(address), true);
  });

  it("ignores case and surrounding whitespace", async () => {
    const address = email("shouty");
    await banEmail(address);
    assert.equal(await isBanned(`  ${address.toUpperCase()} `), true);
  });
});

describe("gmail alias evasion", () => {
  it("catches a dotted variant of a banned gmail address", async () => {
    const address = email("aliasone", "gmail.com");
    await banEmail(address);

    const [local, domain] = address.split("@");
    const dotted = `${local.split("").join(".")}@${domain}`;
    assert.equal(await isBanned(dotted), true, "adding dots must not evade the ban");
  });

  it("catches a +tagged variant", async () => {
    const address = email("aliastwo", "gmail.com");
    await banEmail(address);

    const [local, domain] = address.split("@");
    assert.equal(await isBanned(`${local}+alt@${domain}`), true);
  });

  it("does not over-reach onto other domains", async () => {
    const address = email("aliasthree", "example.test");
    await banEmail(address);

    const [local, domain] = address.split("@");
    assert.equal(
      await isBanned(`${local}+alt@${domain}`),
      false,
      "plus addressing is not an alias everywhere, so do not assume it is",
    );
  });
});

describe("banEmail", () => {
  it("revokes active sessions so the ban takes effect immediately", async () => {
    const address = email("active");
    const { userId } = await makeUserWithSession(address);
    assert.equal(await prisma.session.count({ where: { userId } }), 1);

    await banEmail(address, { reason: "abuse", bannedBy: "admin@example.test" });

    assert.equal(
      await prisma.session.count({ where: { userId } }),
      0,
      "a banned user must not keep trading on an existing cookie",
    );
  });

  it("keeps the user row and their trade history", async () => {
    const address = email("history");
    const { userId } = await makeUserWithSession(address);

    await banEmail(address);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    assert.ok(user, "banning is not deletion — the ledger has to stay intact");
  });

  it("records the reason and who banned them", async () => {
    const address = email("audited");
    await banEmail(address, { reason: "spam", bannedBy: "admin@example.test" });

    const row = await prisma.bannedEmail.findFirst({ where: { email: { contains: RUN } , reason: "spam" } });
    assert.equal(row?.reason, "spam");
    assert.equal(row?.bannedBy, "admin@example.test");
  });

  it("is idempotent and updates the reason on a re-ban", async () => {
    const address = email("twice");
    await banEmail(address, { reason: "first" });
    await banEmail(address, { reason: "second" });

    const rows = await prisma.bannedEmail.findMany({
      where: { email: { in: [address.toLowerCase()] } },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, "second");
    assert.equal(await isBanned(address), true);
  });
});

describe("unbanEmail", () => {
  it("lifts the ban", async () => {
    const address = email("forgiven");
    await banEmail(address);
    assert.equal(await isBanned(address), true);

    await unbanEmail(address);
    assert.equal(await isBanned(address), false);
  });

  it("lifts a ban given any alias of the address", async () => {
    const address = email("forgiventoo", "gmail.com");
    await banEmail(address);

    const [local, domain] = address.split("@");
    await unbanEmail(`${local}+tag@${domain}`);
    assert.equal(await isBanned(address), false);
  });
});
