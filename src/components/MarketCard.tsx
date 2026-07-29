import Link from "next/link";

import { isTradeable, type MarketSummary } from "@/lib/markets";
import { formatPoints, formatPrice, formatProbability, formatTimeLeft } from "@/lib/format";
import { ProbabilityBar } from "./ProbabilityBar";
import { Sparkline } from "./Sparkline";
import { StatusPill } from "./StatusPill";

/**
 * One market in the list grid.
 *
 * The whole card is a single link — a card with several competing click targets
 * is awkward on a phone, and this app is shared by URL, so most first visits are
 * mobile. The YES/NO prices are shown for information, not as buy buttons;
 * committing points is a decision that belongs on the detail page next to the
 * rules, not one tap from a scrolling list.
 *
 * The sparkline and the 24h chip are what make the grid feel alive: they show
 * that prices *move*. Neither is ever the only encoding — the chip pairs an
 * arrow with a signed number, and the probability is always written out.
 */
export function MarketCard({ market }: { market: MarketSummary }) {
  const settled = market.status === "RESOLVED" || market.status === "VOIDED";
  const live = isTradeable(market);
  const isNew = market.status === "OPEN" && market.tradeCount === 0;

  return (
    <Link
      href={`/markets/${market.slug}`}
      className="card-lift group flex flex-col gap-4 rounded-xl border border-border bg-surface p-5
                 hover:bg-surface-hover
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {(market.category || settled || isNew) && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
            {market.category ?? ""}
          </span>
          {settled ? (
            <StatusPill status={market.status} outcome={market.resolvedOutcome} />
          ) : isNew ? (
            <span className="shrink-0 rounded-full border border-accent/40 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
              new
            </span>
          ) : null}
        </div>
      )}

      <h2 className="text-[15px] font-semibold leading-snug text-fg group-hover:text-accent">
        {market.question}
      </h2>

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-baseline gap-2">
              <span className="tabular text-2xl font-semibold text-fg">
                {formatProbability(market.priceYes)}
              </span>
              {live && market.delta24h !== null && <DeltaChip delta={market.delta24h} />}
            </span>
            <span className="text-xs text-muted">chance of yes</span>
          </div>
          <Sparkline points={market.spark} className={settled ? "text-faint" : "text-yes"} />
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
        {market.status === "OPEN" ? (
          <span className="flex items-center gap-1.5">
            {live && <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-yes" />}
            {formatTimeLeft(market.closesAt)}
          </span>
        ) : (
          <span>closed</span>
        )}
      </div>
    </Link>
  );
}

/**
 * 24-hour move, in whole percentage points. Direction is carried three ways —
 * arrow, colour, and the screen-reader text — because the green/rose pair
 * alone is not enough for deutan viewers. A move that rounds to zero renders
 * nothing: a "±0" chip is noise pretending to be signal.
 */
function DeltaChip({ delta }: { delta: number }) {
  const pp = Math.round(Math.abs(delta) * 100);
  if (pp === 0) return null;
  const up = delta > 0;

  return (
    <span
      className={`tabular inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold
                  ${up ? "bg-yes-soft text-yes" : "bg-no-soft text-no"}`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {pp}
      <span className="sr-only">
        {up ? "up" : "down"} {pp} percentage points in the last day
      </span>
    </span>
  );
}
