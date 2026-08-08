import Link from "next/link";

import { isTradeable, type MarketSummary } from "@/lib/markets";
import { formatCompact, formatPrice, formatProbability, formatTimeLeft } from "@/lib/format";
import { DeltaChip } from "./DeltaChip";
import { ProbabilityBar } from "./ProbabilityBar";
import { Sparkline } from "./Sparkline";
import { StatusPill } from "./StatusPill";

/**
 * One market in the list grid.
 *
 * The card carries two Yes/No price buttons, which are **links into the detail
 * page with that side preselected** — not one-tap trades. Committing points
 * still happens next to the rules, on the page that shows them; what the
 * buttons buy you is that the reader states their side once instead of
 * arriving at the ticket and picking again. This is why the card is an
 * `<article>` with a stretched link over the question rather than a single
 * `<a>` wrapping everything: an anchor cannot contain other anchors, and the
 * pseudo-element keeps the whole surface clickable anyway.
 *
 * The sparkline and the 24h chip are what make the grid feel alive: they show
 * that prices *move*. Neither is ever the only encoding — the chip pairs an
 * arrow with a signed number, the buttons are labelled in words, and the
 * probability is always written out.
 */
export function MarketCard({ market }: { market: MarketSummary }) {
  const settled = market.status === "RESOLVED" || market.status === "VOIDED";
  const live = isTradeable(market);
  const isNew = market.status === "OPEN" && market.tradeCount === 0;

  return (
    <article
      className="card-lift group relative flex flex-col gap-3 rounded-xl border border-border
                 bg-surface p-4 hover:bg-surface-hover
                 focus-within:border-accent"
    >
      {/* Rendered even when empty, so cards in a row keep a common baseline. */}
      <div className="flex h-4 items-center justify-between gap-3">
        <span className="truncate text-[11px] font-medium uppercase tracking-wider text-faint">
          {market.category ?? ""}
        </span>
        {settled ? (
          <StatusPill status={market.status} outcome={market.resolvedOutcome} />
        ) : isNew ? (
          <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
            new
          </span>
        ) : null}
      </div>

      <h2 className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-fg">
        <Link
          href={`/markets/${market.slug}`}
          className="line-clamp-2 rounded-sm transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-accent"
        >
          {market.question}
        </Link>
      </h2>

      <div className="mt-auto flex flex-col gap-2.5">
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-baseline gap-1.5">
              <span className="tabular text-[28px] font-semibold leading-none tracking-tight text-fg">
                {formatProbability(market.priceYes)}
              </span>
              {live && market.delta24h !== null && <DeltaChip delta={market.delta24h} />}
            </span>
            <span className="text-[11px] text-muted">chance of yes</span>
          </div>
          <Sparkline points={market.spark} className={settled ? "text-faint" : "text-chart"} />
        </div>

        <ProbabilityBar priceYes={market.priceYes} size="sm" />

        {live ? (
          <div className="grid grid-cols-2 gap-2">
            <SideLink slug={market.slug} outcome="YES" price={market.priceYes} />
            <SideLink slug={market.slug} outcome="NO" price={1 - market.priceYes} />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="tabular font-semibold text-yes">
              Yes {formatPrice(market.priceYes)}
            </span>
            <span className="tabular font-semibold text-no">
              No {formatPrice(1 - market.priceYes)}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5 text-[11px] text-muted">
        <span className="tabular">{formatCompact(market.volume)} pts vol</span>
        {market.status === "OPEN" ? (
          <span className="flex items-center gap-1.5">
            {live && <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-yes" />}
            {formatTimeLeft(market.closesAt)}
          </span>
        ) : (
          <span>closed</span>
        )}
      </div>
    </article>
  );
}

/**
 * A side button on a card. `relative` is load-bearing: it lifts the link above
 * the stretched pseudo-element covering the card, so a tap here goes to the
 * preselected ticket rather than the plain detail page underneath.
 *
 * Hover fills the button with its own colour and flips the label to
 * `accent-fg`, which is the "text on a saturated fill" token and reads
 * correctly in both themes — white on the light palette's deep blue, near-black
 * on the dark palette's pale blue.
 */
function SideLink({
  slug,
  outcome,
  price,
}: {
  slug: string;
  outcome: "YES" | "NO";
  price: number;
}) {
  const yes = outcome === "YES";

  return (
    <Link
      href={`/markets/${slug}?side=${outcome}`}
      className={`relative flex items-center justify-center gap-1.5 rounded-lg px-3 py-2
                  text-[13px] font-semibold transition-colors hover:text-accent-fg
                  ${yes ? "bg-yes-soft text-yes hover:bg-yes" : "bg-no-soft text-no hover:bg-no"}`}
    >
      <span>{yes ? "Yes" : "No"}</span>
      <span className="tabular">{formatPrice(price)}</span>
      <span className="sr-only">— buy {outcome} on this market</span>
    </Link>
  );
}
