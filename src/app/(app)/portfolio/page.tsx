import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { getPortfolio } from "@/lib/leaderboard";
import { formatPoints, formatProbability, formatShares } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/portfolio");

  const holdings = await getPortfolio(user.id);

  const openHoldings = holdings.filter((h) => h.status === "OPEN" || h.status === "CLOSED");
  const positionValue = openHoldings.reduce((sum, h) => sum + h.markValue, 0);
  const totalCost = openHoldings.reduce((sum, h) => sum + h.costBasis, 0);
  const netWorth = user.balance + positionValue;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        <p className="text-sm text-muted">Everything you hold, valued at what it would sell for now.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Net worth" value={formatPoints(netWorth)} emphasis />
        <Stat label="Cash" value={formatPoints(user.balance)} />
        <Stat label="In positions" value={formatPoints(positionValue)} />
        <Stat
          label="Unrealised"
          value={`${positionValue - totalCost >= 0 ? "+" : ""}${formatPoints(positionValue - totalCost)}`}
          tone={positionValue - totalCost >= 0 ? "gain" : "loss"}
        />
      </section>

      {holdings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted">You don&rsquo;t hold any positions yet.</p>
          <Link
            href="/markets"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            Browse markets
          </Link>
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          {holdings.map((holding) => (
            <Link
              key={`${holding.marketId}-${holding.outcome}`}
              href={`/markets/${holding.slug}`}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-hover"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium leading-snug">{holding.question}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    holding.outcome === "YES"
                      ? "bg-yes-soft text-yes"
                      : "bg-no-soft text-no"
                  }`}
                >
                  {holding.outcome}
                </span>
              </div>

              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-xs">
                <span className="tabular text-muted">
                  {formatShares(holding.shares)} shares · cost{" "}
                  {formatPoints(holding.costBasis)} pts
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="tabular text-muted">
                    market {formatProbability(holding.priceYes)}
                  </span>
                  <span className="tabular font-medium">
                    {formatPoints(holding.markValue)} pts
                  </span>
                  <span
                    className={`tabular font-medium ${
                      holding.unrealised >= 0 ? "text-gain" : "text-loss"
                    }`}
                  >
                    {holding.unrealised >= 0 ? "+" : ""}
                    {formatPoints(holding.unrealised)}
                  </span>
                </span>
              </div>
            </Link>
          ))}
        </section>
      )}

      <p className="text-xs leading-relaxed text-muted">
        Position values are what the market maker would actually pay to buy your shares
        back right now, including the price impact of selling them — not shares × price.
        Selling a large holding moves the price against you, so the honest number is lower
        than the naive one.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  /** Profit and loss, which is a different axis from YES/NO — hence its own tokens. */
  tone?: "gain" | "loss";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3">
      <span className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>
      <span
        className={`tabular font-semibold ${emphasis ? "text-xl" : "text-base"} ${
          tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
