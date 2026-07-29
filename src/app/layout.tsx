import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { currentUser } from "@/lib/auth";
import { formatPoints } from "@/lib/format";
import { SignOutButton } from "./signout-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prediction Market",
  description:
    "A play-money prediction market. Trade on what you think will happen — points only, no cash value.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-border bg-page/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-5">
              <Link href="/" className="font-semibold tracking-tight">
                Prediction Market
              </Link>
              <nav className="flex items-center gap-4 text-sm text-muted">
                <Link href="/leaderboard" className="transition-colors hover:text-fg">
                  Leaderboard
                </Link>
                {user && (
                  <Link href="/portfolio" className="transition-colors hover:text-fg">
                    Portfolio
                  </Link>
                )}
              </nav>
            </div>

            <nav className="flex items-center gap-3 text-sm">
              {user ? (
                <>
                  {/* Balance first: it is the number people check most often. */}
                  <span className="tabular font-semibold" title="Your spendable points">
                    {formatPoints(user.balance)}
                    <span className="ml-1 font-normal text-muted">pts</span>
                  </span>
                  <span className="hidden text-muted sm:inline">
                    {user.handle ?? user.name}
                  </span>
                  {user.isAdmin && (
                    <Link
                      href="/admin"
                      className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted transition-colors hover:border-faint hover:text-fg"
                    >
                      admin
                    </Link>
                  )}
                  <SignOutButton />
                </>
              ) : (
                <Link
                  href="/signin"
                  className="rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90"
                >
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>

        <footer className="mx-auto max-w-5xl border-t border-border px-4 py-6 text-xs text-muted">
          Play money only. Points have no cash value, cannot be withdrawn, and are not
          exchangeable for anything.
        </footer>
      </body>
    </html>
  );
}
