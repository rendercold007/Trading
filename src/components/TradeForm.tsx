"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { HeldPosition } from "@/lib/markets";
import type { Outcome } from "@/lib/lmsr";
import { formatPoints, formatPrice, formatProbability, formatShares } from "@/lib/format";

/**
 * The trade ticket.
 *
 * Buying is sized in **points** and selling in **shares**, because that is how
 * people actually think about each: "put 500 points on yes", but "sell the 200
 * shares I hold". The API supports both sizings for a buy; this picks the one
 * that needs no mental arithmetic.
 *
 * Everything here is advisory until the server says otherwise. The quote can go
 * stale between keystroke and submit if someone else trades, so the form never
 * sends a price — only an intent — and reports back whatever actually filled.
 */

interface Props {
  marketId: string;
  priceYes: number;
  positions: HeldPosition[];
  balance: number;
  /** False when the market is closed or the viewer is signed out. */
  canTrade: boolean;
  /**
   * Which side to open on. Comes from the `?side=` the market cards link to,
   * so a reader who picked Yes in the grid doesn't have to pick it again here.
   * It only sets the initial state — the toggle stays live either way.
   */
  initialOutcome?: Outcome;
}

interface Quote {
  shares: number;
  cost: number;
  avgPrice: number;
  priceYesAfter: number;
}

type Side = "BUY" | "SELL";

const QUICK_AMOUNTS = [50, 100, 500, 1000];

export function TradeForm({
  marketId,
  priceYes,
  positions,
  balance,
  canTrade,
  initialOutcome = "YES",
}: Props) {
  const router = useRouter();

  const [outcome, setOutcome] = useState<Outcome>(initialOutcome);
  const [side, setSide] = useState<Side>("BUY");
  const [amount, setAmount] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const held = positions.find((p) => p.outcome === outcome)?.shares ?? 0;
  const numericAmount = Number(amount);
  const amountIsValid = amount.trim() !== "" && Number.isFinite(numericAmount) && numericAmount > 0;

  // Selling more than you hold is refused server-side anyway; catching it here
  // avoids a pointless round trip and gives a clearer message.
  const overSelling = side === "SELL" && amountIsValid && numericAmount > held;
  const overSpending = side === "BUY" && amountIsValid && numericAmount > balance;

  /**
   * Fetch a quote, debounced. Every keystroke would otherwise be a database
   * read; 250ms is short enough to feel live and long enough to skip most of
   * the intermediate values while someone types "500".
   */
  useEffect(() => {
    if (!canTrade || !amountIsValid || overSelling || overSpending) {
      setQuote(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoting(true);
      try {
        const params = new URLSearchParams({ marketId, outcome, side });
        if (side === "BUY") params.set("budget", String(numericAmount));
        else params.set("shares", String(numericAmount));

        const response = await fetch(`/api/quote?${params}`, { signal: controller.signal });
        if (!response.ok) {
          setQuote(null);
          return;
        }
        const body = (await response.json()) as { quote: Quote };
        setQuote(body.quote);
      } catch {
        // An aborted request is the normal case here, not a failure.
      } finally {
        setQuoting(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [marketId, outcome, side, numericAmount, amountIsValid, canTrade, overSelling, overSpending]);

  // A stale quote from the previous outcome or side would be actively wrong.
  useEffect(() => {
    setQuote(null);
    setReceipt(null);
    setError(null);
  }, [outcome, side]);

  const submit = useCallback(() => {
    setError(null);
    setReceipt(null);

    startSubmit(async () => {
      try {
        const response = await fetch("/api/trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            marketId,
            outcome,
            side,
            ...(side === "BUY"
              ? { budget: numericAmount }
              : { shares: numericAmount }),
          }),
        });

        const body = await response.json();

        if (!response.ok) {
          setError(body?.error?.message ?? "That didn't go through. Try again.");
          return;
        }

        const trade = body.trade as {
          shares: number;
          cost: number;
          avgPrice: number;
        };

        setReceipt(
          side === "BUY"
            ? `Bought ${formatShares(trade.shares)} ${outcome} for ${formatPoints(trade.cost)} pts ` +
                `at ${formatPrice(trade.avgPrice)} each.`
            : `Sold ${formatShares(trade.shares)} ${outcome} for ${formatPoints(trade.cost)} pts ` +
                `at ${formatPrice(trade.avgPrice)} each.`,
        );
        setAmount("");
        setQuote(null);

        // Re-render the server components so the price, chart, balance and
        // position all reflect the trade that just happened.
        router.refresh();
      } catch {
        setError("Couldn't reach the server. Check your connection and try again.");
      }
    });
  }, [marketId, outcome, side, numericAmount, router]);

  if (!canTrade) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">
        Trading is closed on this market.
      </div>
    );
  }

  const disabled =
    submitting || !amountIsValid || overSelling || overSpending || (side === "SELL" && held === 0);

  return (
    <div className="flex flex-col gap-3.5 rounded-xl border border-border bg-surface p-4">
      {/* Buy / Sell */}
      <div className="flex gap-0.5 rounded-lg bg-page p-0.5" role="tablist">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              side === s ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            {s === "BUY" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {/* YES / NO */}
      <div className="grid grid-cols-2 gap-2">
        <OutcomeButton
          outcome="YES"
          price={priceYes}
          selected={outcome === "YES"}
          onSelect={() => setOutcome("YES")}
        />
        <OutcomeButton
          outcome="NO"
          price={1 - priceYes}
          selected={outcome === "NO"}
          onSelect={() => setOutcome("NO")}
        />
      </div>

      {/* Amount */}
      <div className="flex flex-col gap-2">
        <label htmlFor="trade-amount" className="flex items-baseline justify-between text-[11px]">
          <span className="font-medium uppercase tracking-wider text-faint">
            {side === "BUY" ? "Points to spend" : "Shares to sell"}
          </span>
          <span className="tabular text-muted">
            {side === "BUY"
              ? `${formatPoints(balance)} available`
              : `${formatShares(held)} held`}
          </span>
        </label>

        <input
          id="trade-amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="tabular w-full rounded-lg border border-border bg-page px-3 py-2.5 text-xl
                     font-semibold outline-none transition-colors focus:border-accent"
        />

        <div className="flex flex-wrap gap-1.5">
          {side === "BUY"
            ? QUICK_AMOUNTS.filter((v) => v <= balance).map((v) => (
                <QuickButton key={v} onClick={() => setAmount(String(v))}>
                  {v}
                </QuickButton>
              ))
            : held > 0 && (
                <>
                  <QuickButton onClick={() => setAmount(String(Math.floor(held / 2)))}>
                    Half
                  </QuickButton>
                  <QuickButton onClick={() => setAmount(String(held))}>All</QuickButton>
                </>
              )}
        </div>
      </div>

      {/* Quote */}
      {overSpending && <Note tone="warn">That&rsquo;s more points than you have.</Note>}
      {overSelling && (
        <Note tone="warn">You only hold {formatShares(held)} {outcome} shares.</Note>
      )}
      {side === "SELL" && held === 0 && (
        <Note tone="muted">You don&rsquo;t hold any {outcome} shares in this market.</Note>
      )}

      {quote && !overSelling && !overSpending && (
        <dl className="flex flex-col gap-1.5 rounded-lg border border-border bg-page p-3 text-xs">
          <Row
            label={side === "BUY" ? "You get" : "You receive"}
            value={
              side === "BUY"
                ? `${formatShares(quote.shares)} ${outcome} shares`
                : `${formatPoints(quote.cost)} pts`
            }
          />
          <Row label="Average price" value={formatPrice(quote.avgPrice)} />
          <Row
            label="Moves price to"
            value={`${formatProbability(quote.priceYesAfter)} yes`}
          />
          {side === "BUY" && (
            <Row
              label="If it resolves right"
              value={`${formatPoints(quote.shares)} pts`}
              emphasis
            />
          )}
        </dl>
      )}

      {quoting && !quote && <p className="text-xs text-faint">Pricing…</p>}

      {error && <Note tone="error">{error}</Note>}
      {receipt && <Note tone="ok">{receipt}</Note>}

      <button
        onClick={submit}
        disabled={disabled}
        className={`w-full rounded-lg px-4 py-3 text-sm font-semibold text-accent-fg
                    transition-opacity hover:opacity-90
                    disabled:cursor-not-allowed disabled:opacity-40
                    ${outcome === "YES" ? "bg-yes" : "bg-no"}`}
      >
        {submitting
          ? "Working…"
          : side === "BUY"
            ? `Buy ${outcome === "YES" ? "Yes" : "No"}`
            : `Sell ${outcome === "YES" ? "Yes" : "No"}`}
      </button>

      <p className="text-[11px] leading-relaxed text-faint">
        Prices move as people trade, so the amount you actually get may differ slightly
        from the quote above.
      </p>
    </div>
  );
}

function OutcomeButton({
  outcome,
  price,
  selected,
  onSelect,
}: {
  outcome: Outcome;
  price: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const yes = outcome === "YES";

  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5
        text-[13px] font-semibold transition-colors
        ${
          selected
            ? yes
              ? "border-yes bg-yes text-accent-fg"
              : "border-no bg-no text-accent-fg"
            : yes
              ? "border-transparent bg-yes-soft text-yes hover:border-yes"
              : "border-transparent bg-no-soft text-no hover:border-no"
        }`}
    >
      <span>{yes ? "Yes" : "No"}</span>
      <span className="tabular font-normal opacity-90">{formatPrice(price)}</span>
    </button>
  );
}

function QuickButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted
                 transition-colors hover:border-faint hover:text-fg"
    >
      {children}
    </button>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular ${emphasis ? "font-semibold text-gain" : "text-fg"}`}>{value}</dd>
    </div>
  );
}

function Note({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "error" | "muted";
  children: React.ReactNode;
}) {
  const styles = {
    ok: "border-gain/30 bg-gain/10 text-gain",
    warn: "border-border bg-page text-muted",
    error: "border-danger/30 bg-danger/10 text-danger",
    muted: "border-border bg-page text-muted",
  }[tone];

  return (
    <p role={tone === "error" ? "alert" : undefined} className={`rounded-lg border px-3 py-2 text-xs ${styles}`}>
      {children}
    </p>
  );
}
