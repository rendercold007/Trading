import Link from "next/link";

import { currentUser } from "@/lib/auth";
import { listMarkets } from "@/lib/markets";
import { formatDate, formatPoints, formatProbability, formatTimeLeft } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { StatusPill } from "@/components/StatusPill";
import { ResolveForm } from "./ResolveForm";
import { closeMarketAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Admin dashboard.
 *
 * Markets awaiting settlement come first — a resolved market is done, but one
 * that closed yesterday and still has not been settled is holding people's
 * points hostage, and that is the thing an admin needs prompting about.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user?.isAdmin) return <Forbidden signedIn={Boolean(user)} />;

  const markets = await listMarkets({ limit: 200 });

  const awaitingSettlement = markets.filter(
    (m) => m.status === "CLOSED" || (m.status === "OPEN" && m.closesAt <= Date.now()),
  );
  const open = markets.filter((m) => m.status === "OPEN" && m.closesAt > Date.now());
  const settled = markets.filter((m) => m.status === "RESOLVED" || m.status === "VOIDED");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted">Create markets and settle the ones that are done.</p>
        </div>
        <Link
          href="/admin/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          New market
        </Link>
      </header>

      <Section
        title="Awaiting settlement"
        empty="Nothing waiting. Markets appear here once trading has stopped."
        count={awaitingSettlement.length}
      >
        {awaitingSettlement.map((market) => (
          <div
            key={market.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
          >
            <MarketHeading market={market} />
            <ResolveForm marketId={market.id} question={market.question} />
          </div>
        ))}
      </Section>

      <Section title="Open" empty="No open markets." count={open.length}>
        {open.map((market) => (
          <div
            key={market.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
          >
            <MarketHeading market={market} />
            <form action={closeMarketAction}>
              <input type="hidden" name="marketId" value={market.id} />
              <button
                type="submit"
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-faint hover:text-fg"
              >
                Close early
              </button>
            </form>
          </div>
        ))}
      </Section>

      <Section title="Settled" empty="Nothing settled yet." count={settled.length}>
        {settled.map((market) => (
          <div
            key={market.id}
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4"
          >
            <MarketHeading market={market} />
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {title} {count > 0 && <span className="tabular text-faint">({count})</span>}
      </h2>
      {count === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          {empty}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
      )}
    </section>
  );
}

function MarketHeading({
  market,
}: {
  market: Awaited<ReturnType<typeof listMarkets>>[number];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/markets/${market.slug}`}
          className="text-sm font-medium leading-snug hover:text-accent"
        >
          {market.question}
        </Link>
        {market.status !== "OPEN" && (
          <StatusPill status={market.status} outcome={market.resolvedOutcome} />
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        <span className="tabular">{formatProbability(market.priceYes)} yes</span>
        <span className="tabular">{formatPoints(market.volume)} pts</span>
        <span className="tabular">{market.tradeCount} trades</span>
        <span>
          {market.status === "OPEN" && market.closesAt > Date.now()
            ? formatTimeLeft(market.closesAt)
            : `closed ${formatDate(market.closesAt)}`}
        </span>
      </div>
    </div>
  );
}
