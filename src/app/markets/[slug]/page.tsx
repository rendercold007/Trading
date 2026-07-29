import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { currentUser } from "@/lib/auth";
import { getMarketBySlug, getPositions, isTradeable, recentTrades } from "@/lib/markets";
import {
  formatDate,
  formatPoints,
  formatPrice,
  formatProbability,
  formatRelativeTime,
  formatShares,
  formatTimeLeft,
} from "@/lib/format";
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

export default async function MarketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const market = await getMarketBySlug(slug);
  if (!market) notFound();

  const user = await currentUser();
  const positions = user ? await getPositions(user.id, market.id) : [];
  const trades = await recentTrades(market.id, 12);

  const tradeable = isTradeable(market);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="text-sm text-muted transition-colors hover:text-fg">
        ← All markets
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left: the market itself */}
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
                {market.question}
              </h1>
              {!tradeable && (
                <StatusPill status={market.status} outcome={market.resolvedOutcome} />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-3">
                <span className="tabular text-4xl font-semibold">
                  {formatProbability(market.priceYes)}
                </span>
                <span className="text-sm text-muted">chance of yes</span>
              </div>
              <ProbabilityBar priceYes={market.priceYes} />
              <div className="flex justify-between text-xs">
                <span className="tabular font-medium text-yes">
                  YES {formatPrice(market.priceYes)}
                </span>
                <span className="tabular font-medium text-no">
                  NO {formatPrice(1 - market.priceYes)}
                </span>
              </div>
            </div>

            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
              <Meta label="Volume" value={`${formatPoints(market.volume)} pts`} />
              <Meta label="Trades" value={String(market.tradeCount)} />
              <Meta
                label={market.status === "OPEN" ? "Closes" : "Closed"}
                value={
                  market.status === "OPEN"
                    ? formatTimeLeft(market.closesAt)
                    : formatDate(market.closesAt)
                }
              />
              {market.category && <Meta label="Category" value={market.category} />}
            </dl>
          </header>

          {market.resolution && (
            <section
              className={`flex flex-col gap-2 rounded-xl border p-4 ${
                market.resolution.outcome === "YES"
                  ? "border-yes/40 bg-yes-soft"
                  : "border-no/40 bg-no-soft"
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

          <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-muted">Probability over time</h2>
            <ProbabilityChart history={market.history} />
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold">Resolution rules</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
              {market.rules}
            </p>
          </section>

          {trades.length > 0 && (
            <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">Recent activity</h2>
              <ul className="flex flex-col divide-y divide-border">
                {trades.map((trade) => (
                  <li
                    key={trade.id}
                    className="flex items-center justify-between gap-3 py-2 text-xs"
                  >
                    <span className="truncate text-muted">
                      <span className="text-fg">{trade.handle}</span>{" "}
                      {trade.side === "BUY" ? "bought" : "sold"}{" "}
                      <span
                        className={trade.outcome === "YES" ? "text-yes" : "text-no"}
                      >
                        {formatShares(trade.shares)} {trade.outcome}
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
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          {user ? (
            <TradeForm
              marketId={market.id}
              priceYes={market.priceYes}
              positions={positions}
              balance={user.balance}
              canTrade={tradeable}
            />
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
              <p className="text-sm text-muted">
                Sign in to trade on this market. New accounts start with 10,000 points.
              </p>
              <Link
                href={`/signin?callbackUrl=/markets/${market.slug}`}
                className="rounded-lg bg-accent px-4 py-2 text-center text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
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
                      {formatShares(position.shares)} {position.outcome}
                    </span>
                    <span className="tabular text-fg">
                      {formatPoints(position.markValue)} pts
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-muted">
                    <span>Cost {formatPoints(position.costBasis)} pts</span>
                    <span
                      className={`tabular ${
                        position.unrealised >= 0 ? "text-yes" : "text-no"
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
