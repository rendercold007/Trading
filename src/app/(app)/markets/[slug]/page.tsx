import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { currentUser } from "@/lib/auth";
import { getMarketBySlug, getPositions, isTradeable, recentTrades } from "@/lib/markets";
import type { Outcome } from "@/lib/lmsr";
import {
  formatCompact,
  formatDate,
  formatPoints,
  formatPrice,
  formatProbability,
  formatRelativeTime,
  formatShares,
  formatTimeLeft,
} from "@/lib/format";
import { DeltaChip } from "@/components/DeltaChip";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { ProbabilityChart } from "@/components/ProbabilityChart";
import { StatusPill } from "@/components/StatusPill";
import { TradeForm } from "@/components/TradeForm";

// The price changes on every trade, so this can never be statically cached.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const market = await getMarketBySlug(slug);
  if (!market) return { title: "Market not found" };

  return {
    title: market.question,
    description: `${formatProbability(market.priceYes)} chance. ${market.rules.slice(0, 140)}`,
  };
}

export default async function MarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ side?: string }>;
}) {
  const [{ slug }, { side }] = await Promise.all([params, searchParams]);

  const market = await getMarketBySlug(slug);
  if (!market) notFound();

  const user = await currentUser();
  const positions = user ? await getPositions(user.id, market.id) : [];
  const trades = await recentTrades(market.id, 12);

  const tradeable = isTradeable(market);

  // `?side=` arrives from the Yes/No buttons on a market card. Anything else in
  // the query string is ignored rather than trusted — it only picks a tab.
  const initialOutcome: Outcome = side === "NO" ? "NO" : "YES";

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/markets"
        className="text-[13px] text-muted transition-colors hover:text-fg"
      >
        ← All markets
      </Link>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        {/* Left: the market itself */}
        <div className="flex flex-col gap-5">
          <header className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                {market.category && (
                  <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
                    {market.category}
                  </span>
                )}
                <h1 className="text-xl font-semibold leading-snug tracking-tight sm:text-[26px]">
                  {market.question}
                </h1>
              </div>
              {!tradeable && (
                <StatusPill status={market.status} outcome={market.resolvedOutcome} />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2.5">
                <span className="tabular text-[40px] font-semibold leading-none tracking-tight">
                  {formatProbability(market.priceYes)}
                </span>
                <span className="text-sm text-muted">chance of yes</span>
                {tradeable && market.delta24h !== null && (
                  <DeltaChip delta={market.delta24h} size="md" />
                )}
              </div>

              <ProbabilityBar priceYes={market.priceYes} />

              <div className="flex justify-between text-xs">
                <span className="tabular font-semibold text-yes">
                  Yes {formatPrice(market.priceYes)}
                </span>
                <span className="tabular font-semibold text-no">
                  No {formatPrice(1 - market.priceYes)}
                </span>
              </div>
            </div>

            <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-xs text-muted">
              <Meta label="Volume" value={`${formatCompact(market.volume)} pts`} />
              <Meta label="Trades" value={String(market.tradeCount)} />
              <Meta
                label={market.status === "OPEN" ? "Closes" : "Closed"}
                value={
                  market.status === "OPEN"
                    ? formatTimeLeft(market.closesAt)
                    : formatDate(market.closesAt)
                }
              />
            </dl>
          </header>

          {market.resolution && (
            <section
              className={`flex flex-col gap-2 rounded-xl border p-4 ${
                market.resolution.outcome === "YES"
                  ? "border-yes/30 bg-yes-soft"
                  : "border-no/30 bg-no-soft"
              }`}
            >
              <h2 className="text-sm font-semibold">
                Resolved {market.resolution.outcome} ·{" "}
                {formatDate(market.resolution.resolvedAt)}
              </h2>
              <p className="text-sm leading-relaxed">{market.resolution.reason}</p>
              <p className="text-xs opacity-80">
                {formatPoints(market.resolution.totalPaidOut)} pts paid out
                {market.resolution.resolvedBy && ` · by ${market.resolution.resolvedBy}`}
              </p>
            </section>
          )}

          {/* The chart owns its own heading, because the range control belongs
              on the same line as it. */}
          <section className="rounded-xl border border-border bg-surface p-4">
            <ProbabilityChart history={market.history} />
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold">Resolution rules</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
              {market.rules}
            </p>
          </section>

          {trades.length > 0 && (
            <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">Recent activity</h2>
              <ul className="flex flex-col divide-y divide-border">
                {trades.map((trade) => (
                  <li
                    key={trade.id}
                    className="flex items-center justify-between gap-3 py-2 text-xs"
                  >
                    <span className="truncate text-muted">
                      <span className="font-medium text-fg">{trade.handle}</span>{" "}
                      {trade.side === "BUY" ? "bought" : "sold"}{" "}
                      <span
                        className={`font-medium ${
                          trade.outcome === "YES" ? "text-yes" : "text-no"
                        }`}
                      >
                        {formatShares(trade.shares)} {trade.outcome === "YES" ? "Yes" : "No"}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-faint">
                      {formatPoints(trade.cost)} pts · {formatRelativeTime(trade.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Right: acting on it */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-[4.5rem] lg:self-start">
          {user ? (
            <TradeForm
              marketId={market.id}
              priceYes={market.priceYes}
              positions={positions}
              balance={user.balance}
              canTrade={tradeable}
              initialOutcome={initialOutcome}
            />
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <p className="text-sm text-muted">
                Sign in to trade on this market. New accounts start with 10,000 points.
              </p>
              <Link
                href={`/signin?callbackUrl=/markets/${market.slug}`}
                className="rounded-lg bg-accent px-4 py-2.5 text-center text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
              >
                Sign in with Google
              </Link>
            </div>
          )}

          {positions.length > 0 && (
            <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">Your position</h2>
              {positions.map((position) => (
                <div key={position.outcome} className="flex flex-col gap-1 text-xs">
                  <div className="flex items-baseline justify-between">
                    <span
                      className={`font-semibold ${
                        position.outcome === "YES" ? "text-yes" : "text-no"
                      }`}
                    >
                      {formatShares(position.shares)}{" "}
                      {position.outcome === "YES" ? "Yes" : "No"}
                    </span>
                    <span className="tabular text-fg">
                      {formatPoints(position.markValue)} pts
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-muted">
                    <span>Cost {formatPoints(position.costBasis)} pts</span>
                    <span
                      className={`tabular font-medium ${
                        position.unrealised >= 0 ? "text-gain" : "text-loss"
                      }`}
                    >
                      {position.unrealised >= 0 ? "+" : ""}
                      {formatPoints(position.unrealised)}
                    </span>
                  </div>
                </div>
              ))}
              <p className="text-[11px] leading-relaxed text-faint">
                Value shown is what you would receive selling now, after price impact —
                not shares × price.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}</dt>
      <dd className="tabular font-medium text-fg">{value}</dd>
    </div>
  );
}
