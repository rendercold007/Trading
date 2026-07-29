import Link from "next/link";

import type { MarketSummary } from "@/lib/markets";
import { formatPoints, formatPrice, formatProbability, formatTimeLeft } from "@/lib/format";
import { ProbabilityBar } from "./ProbabilityBar";
import { StatusPill } from "./StatusPill";

/**
 * One market in the list grid.
 *
 * The whole card is a single link — a card with several competing click targets
 * is awkward on a phone, and this app is shared by URL, so most first visits are
 * mobile. The YES/NO prices are shown for information, not as buy buttons;
 * committing points is a decision that belongs on the detail page next to the
 * rules, not one tap from a scrolling list.
 */
export function MarketCard({ market }: { market: MarketSummary }) {
  const settled = market.status === "RESOLVED" || market.status === "VOIDED";

  return (
    <Link
      href={`/markets/${market.slug}`}
      className="group flex flex-col gap-4 rounded-xl border border-border bg-surface p-5
                 transition-colors hover:bg-surface-hover
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold leading-snug text-fg group-hover:text-accent">
          {market.question}
        </h2>
        {settled && <StatusPill status={market.status} outcome={market.resolvedOutcome} />}
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="tabular text-2xl font-semibold text-fg">
            {formatProbability(market.priceYes)}
          </span>
          <span className="text-xs text-muted">chance of yes</span>
        </div>

        <ProbabilityBar priceYes={market.priceYes} />

        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="tabular font-medium text-yes">
            YES {formatPrice(market.priceYes)}
          </span>
          <span className="tabular font-medium text-no">
            NO {formatPrice(1 - market.priceYes)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
        <span className="tabular">{formatPoints(market.volume)} pts volume</span>
        <span>{market.status === "OPEN" ? formatTimeLeft(market.closesAt) : "closed"}</span>
      </div>
    </Link>
  );
}
