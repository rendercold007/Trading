import type { MarketStatus } from "@/lib/markets";
import type { Outcome } from "@/lib/lmsr";

/**
 * Status badge for a market that is no longer trading.
 *
 * A resolved market shows which way it went, because that is the only thing
 * anyone wants to know about it — "RESOLVED" alone tells the reader nothing.
 */
export function StatusPill({
  status,
  outcome,
}: {
  status: MarketStatus;
  outcome?: Outcome | null;
}) {
  if (status === "RESOLVED" && outcome) {
    const yes = outcome === "YES";
    return (
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide
                    ${yes ? "bg-yes-soft text-yes" : "bg-no-soft text-no"}`}
      >
        {outcome}
      </span>
    );
  }

  const label = status === "VOIDED" ? "voided" : "closed";
  return (
    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
      {label}
    </span>
  );
}
