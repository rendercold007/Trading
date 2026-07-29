import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { listMarkets } from "@/lib/markets";
import { MarketCard } from "@/components/MarketCard";
import { STARTING_BALANCE_LABEL } from "@/lib/marketConstants";

/**
 * Landing page — the pitch, for people who have never been here.
 *
 * Sits outside the `(app)` route group so it gets none of the signed-in
 * chrome, and wraps everything in `.landing`, which re-declares the colour
 * tokens as warm paper and ink (see `globals.css`). Anyone already signed in
 * is sent straight to the market list: they have read the pitch.
 *
 * Real markets are rendered here rather than mock-ups. A landing page for a
 * market that shows invented prices is lying about the one thing the product
 * is, and `MarketCard` already renders live data correctly.
 */

// Shows live prices, and branches on session state. Never cache it.
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const user = await currentUser();
  if (user) redirect("/markets");

  const markets = await listMarkets();
  const featured = markets.filter((m) => m.status === "OPEN").slice(0, 3);

  return (
    <div className="landing min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6">
        <span className="font-display text-lg font-semibold tracking-tight text-fg">
          Prediction Market
        </span>

        <nav className="flex items-center gap-2 text-sm">
          <Link
            href="/signin"
            className="rounded-lg px-3.5 py-2 font-medium text-muted transition-colors hover:text-fg"
          >
            Sign in
          </Link>
          <Link
            href="/signin?intent=signup"
            className="rounded-lg bg-accent px-3.5 py-2 font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            Sign up
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-12 sm:pt-20">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent">
            Open to anyone · Play money only
          </p>

          <h1 className="mt-6 max-w-3xl font-display text-5xl leading-[1.05] tracking-tight text-fg sm:text-6xl">
            How sure are you, really?
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Trade YES or NO on questions about the future. The price{" "}
            <em className="font-display text-fg">is</em> the probability — and it moves
            when you disagree with it loudly enough. Play money, real calibration.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/signin?intent=signup"
              className="rounded-lg bg-accent px-5 py-3 text-center text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              Start with {STARTING_BALANCE_LABEL} points
            </Link>
            <Link
              href="/markets"
              className="rounded-lg border border-border px-5 py-3 text-center text-sm font-medium text-fg transition-colors hover:border-faint hover:bg-surface-hover"
            >
              Browse markets
            </Link>
          </div>
        </section>

        {/* Live markets. Skipped entirely rather than showing an empty shelf. */}
        {featured.length > 0 && (
          <section className="border-t border-border">
            <div className="mx-auto max-w-6xl px-6 py-16">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
                  Trading now
                </h2>
                <Link
                  href="/markets"
                  className="text-sm font-medium text-accent hover:underline"
                >
                  All markets
                </Link>
              </div>

              <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((market) => (
                  <MarketCard key={market.id} market={market} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* How it works */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
              How it works
            </h2>

            <ol className="mt-10 grid grid-cols-1 gap-10 sm:grid-cols-3">
              <Step
                n="01"
                title="Pick a question"
                body="Every market is a plain yes-or-no question with written rules and a close date. No ambiguity about what settles it."
              />
              <Step
                n="02"
                title="Take a side"
                body="Buy YES or NO at the quoted price. Each share pays 1 point if your side is right and nothing if it isn't. Sell back any time before close."
              />
              <Step
                n="03"
                title="Get scored"
                body="The leaderboard ranks by calibration, not by luck or volume. Being confidently wrong is what costs you."
              />
            </ol>
          </div>
        </section>

        {/* The legal position, stated plainly rather than buried in a footer. */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="max-w-2xl">
              <h2 className="font-display text-2xl tracking-tight text-fg">
                Points, and only points.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                There is no deposit, no withdrawal, no cash-out and no prize. Points
                cannot be bought or exchanged for anything, and the site never touches
                money. The leaderboard is the whole reward — which is rather the point,
                because being right is the thing worth measuring.
              </p>
              <Link
                href="/signin?intent=signup"
                className="mt-8 inline-block rounded-lg bg-accent px-5 py-3 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
              >
                Create an account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            Play money only. Points have no cash value and cannot be withdrawn.
          </span>
          <span className="flex gap-4">
            <Link href="/markets" className="transition-colors hover:text-fg">
              Markets
            </Link>
            <Link href="/leaderboard" className="transition-colors hover:text-fg">
              Leaderboard
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="flex flex-col gap-3">
      <span className="font-display text-3xl text-accent">{n}</span>
      <h3 className="font-display text-xl tracking-tight text-fg">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
    </li>
  );
}
