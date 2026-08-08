import type { ReactNode } from "react";
import Link from "next/link";

import { currentUser } from "@/lib/auth";
import { formatPoints } from "@/lib/format";
import { SignOutButton } from "./signout-button";

/**
 * App chrome — everything except the landing and sign-in pages.
 *
 * This is the signed-in surface: persistent header with balance, nav and the
 * account controls. The wordmark points at `/markets` rather than `/`, because
 * once you have an account the market list is home; `/` is the pitch you have
 * already read.
 *
 * The header is sticky and translucent so prices stay reachable while scrolling
 * a long grid, and the balance sits first in the right-hand group because it is
 * the number people check most often.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-page/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex items-center gap-6">
            <Link
              href="/markets"
              className="text-[15px] font-bold tracking-tight transition-opacity hover:opacity-70"
            >
              Outcome
            </Link>
            <nav className="flex items-center gap-1 text-[13px]">
              <NavLink href="/markets">Markets</NavLink>
              <NavLink href="/leaderboard">Leaderboard</NavLink>
              {user && <NavLink href="/portfolio">Portfolio</NavLink>}
            </nav>
          </div>

          <nav className="flex items-center gap-2.5 text-[13px]">
            {user ? (
              <>
                <span
                  className="tabular rounded-lg bg-surface px-2.5 py-1.5 font-semibold"
                  title="Your spendable points"
                >
                  {formatPoints(user.balance)}
                  <span className="ml-1 font-normal text-muted">pts</span>
                </span>
                <span className="hidden text-muted sm:inline">
                  {user.handle ?? user.name}
                </span>
                {user.isAdmin && (
                  <Link
                    href="/admin"
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted transition-colors hover:border-faint hover:text-fg"
                  >
                    admin
                  </Link>
                )}
                <SignOutButton />
              </>
            ) : (
              <Link
                href="/signin"
                className="rounded-lg bg-accent px-3.5 py-1.5 font-semibold text-accent-fg transition-opacity hover:opacity-90"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-6xl border-t border-border px-4 py-6 text-xs text-muted">
        Play money only. Points have no cash value, cannot be withdrawn, and are not
        exchangeable for anything.
      </footer>
    </>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2 py-1 font-medium text-muted transition-colors hover:bg-surface hover:text-fg"
    >
      {children}
    </Link>
  );
}
