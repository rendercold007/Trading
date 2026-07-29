import { currentUser } from "@/lib/auth";
import { listMarkets, marketStats, type MarketStats } from "@/lib/markets";
import { formatPoints } from "@/lib/format";
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

export default async function HomePage() {
  const [markets, stats, user] = await Promise.all([
    listMarkets(),
    marketStats(),
    currentUser(),
  ]);

  const open = markets.filter((m) => m.status === "OPEN");
  const settled = markets.filter((m) => m.status !== "OPEN");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
        <p className="max-w-2xl text-sm text-muted">
          Buy YES or NO on questions about the future. Each share pays 1 point if it is
          right and nothing if it is wrong, so the price is the crowd&rsquo;s estimate of
          the odds.{" "}
          {!user && (
            <>
              <a href="/signin" className="font-medium text-accent hover:underline">
                Sign in
              </a>{" "}
              to start with 10,000 points.
            </>
          )}
        </p>
      </header>

      <StatsStrip stats={stats} />

      {markets.length === 0 ? (
        <EmptyState isAdmin={user?.isAdmin ?? false} />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </section>

          {settled.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Closed
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
 * Site-wide activity, as bare numbers between rules rather than boxed tiles —
 * boxes here would compete with the market cards below, which are the actual
 * content. Reads as a pulse line for the whole site: things are happening.
 */
function StatsStrip({ stats }: { stats: MarketStats }) {
  const items: Array<[string, string]> = [
    [formatPoints(stats.openMarkets), "open markets"],
    [formatPoints(stats.pointsTraded), "points traded"],
    [formatPoints(stats.tradesPlaced), "trades"],
    [formatPoints(stats.traders), stats.traders === 1 ? "trader" : "traders"],
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-4">
      {items.map(([value, label]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dd className="tabular text-xl font-semibold text-fg">{value}</dd>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <p className="text-sm text-muted">
        No markets yet.{" "}
        {isAdmin
          ? "Create one to get started."
          : "Check back once an admin has opened one."}
      </p>
    </div>
  );
}
