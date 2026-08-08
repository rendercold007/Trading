import Link from "next/link";

import { currentUser } from "@/lib/auth";
import { listCategories, listMarkets, marketStats, type MarketStats } from "@/lib/markets";
import { formatCompact } from "@/lib/format";
import { MarketCard } from "@/components/MarketCard";

/**
 * The market list — home for anyone with an account.
 *
 * Readable signed out. Open registration means most first visits arrive from a
 * shared link with no account, and a wall demanding sign-in before showing what
 * the site even is would lose them. Trading needs an account; looking does not.
 * The pitch for people who have never been here lives on the landing page at
 * `/`; this page assumes you already know what the site is.
 */

// Prices move on every trade, so this page must never be served from a cache.
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;

  const [categories, user] = await Promise.all([listCategories(), currentUser()]);

  /**
   * A `?category=` that matches nothing renders an empty grid, which looks
   * like a broken site rather than a bad URL. Validating against the real
   * list means a stale or hand-edited link falls back to showing everything.
   */
  const active = category && categories.includes(category) ? category : null;

  const [markets, stats] = await Promise.all([
    listMarkets(active ? { category: active } : {}),
    marketStats(),
  ]);

  const open = markets.filter((m) => m.status === "OPEN");
  const settled = markets.filter((m) => m.status !== "OPEN");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-[26px] font-semibold tracking-tight">Markets</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Buy Yes or No on questions about the future. Each share pays 1 point if it is
          right and nothing if it is wrong, so the price is the crowd&rsquo;s estimate of
          the odds.{" "}
          {!user && (
            <>
              <Link href="/signin" className="font-medium text-accent hover:underline">
                Sign in
              </Link>{" "}
              to start with 10,000 points.
            </>
          )}
        </p>
      </header>

      <StatsStrip stats={stats} />

      {categories.length > 0 && <CategoryTabs categories={categories} active={active} />}

      {markets.length === 0 ? (
        <EmptyState isAdmin={user?.isAdmin ?? false} category={active} />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </section>

          {settled.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                Settled
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {settled.map((market) => (
                  <MarketCard key={market.id} market={market} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Category filter.
 *
 * Plain links, not a client-side control: the filter is a URL, so it is
 * shareable, back-button-able, and works before any JavaScript loads. The
 * strip scrolls rather than wraps (see `.no-scrollbar`) — wrapping would push
 * the grid down a full row on a phone. It bleeds to the viewport edge on small
 * screens so the last tab doesn't look clipped against a hard margin.
 */
function CategoryTabs({ categories, active }: { categories: string[]; active: string | null }) {
  return (
    <nav
      aria-label="Filter markets by category"
      className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0"
    >
      <Tab href="/markets" label="All" active={active === null} />
      {categories.map((c) => (
        <Tab
          key={c}
          href={`/markets?category=${encodeURIComponent(c)}`}
          label={c}
          active={active === c}
        />
      ))}
    </nav>
  );
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors
        ${
          active
            ? "border-fg bg-fg text-page"
            : "border-border bg-surface text-muted hover:border-faint hover:text-fg"
        }`}
    >
      {label}
    </Link>
  );
}

/**
 * Site-wide activity, as bare numbers between rules rather than boxed tiles —
 * boxes here would compete with the market cards below, which are the actual
 * content. Reads as a pulse line for the whole site: things are happening.
 */
function StatsStrip({ stats }: { stats: MarketStats }) {
  const items: Array<[string, string]> = [
    [formatCompact(stats.openMarkets), "open markets"],
    [formatCompact(stats.pointsTraded), "points traded"],
    [formatCompact(stats.tradesPlaced), "trades"],
    [formatCompact(stats.traders), stats.traders === 1 ? "trader" : "traders"],
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-3 sm:grid-cols-4">
      {items.map(([value, label]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dd className="tabular text-lg font-semibold leading-tight text-fg">{value}</dd>
          <dt className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

function EmptyState({ isAdmin, category }: { isAdmin: boolean; category: string | null }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <p className="text-sm text-muted">
        {category ? (
          <>
            Nothing open in {category} right now.{" "}
            <Link href="/markets" className="font-medium text-accent hover:underline">
              See all markets
            </Link>
          </>
        ) : isAdmin ? (
          "No markets yet. Create one to get started."
        ) : (
          "No markets yet. Check back once an admin has opened one."
        )}
      </p>
    </div>
  );
}
