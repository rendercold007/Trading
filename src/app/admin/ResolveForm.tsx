"use client";

import { useActionState, useState } from "react";

import { resolveMarketAction, type ActionState } from "./actions";

/**
 * Resolve or void one market.
 *
 * Settlement moves points permanently and cannot be undone, so this form makes
 * the admin pick an outcome deliberately and type a reason before the button
 * becomes usable. The reason is public — it is the whole audit trail.
 */
export function ResolveForm({ marketId, question }: { marketId: string; question: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    resolveMarketAction,
    {},
  );
  const [outcome, setOutcome] = useState<"YES" | "NO" | "VOID" | "">("");
  const [reason, setReason] = useState("");

  if (state.ok) {
    return (
      <p className="rounded-lg border border-yes/40 bg-yes-soft px-3 py-2 text-xs text-yes">
        {state.ok}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="marketId" value={marketId} />
      <input type="hidden" name="outcome" value={outcome} />

      <fieldset className="flex gap-2">
        <legend className="sr-only">Outcome for {question}</legend>
        {(["YES", "NO", "VOID"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setOutcome(value)}
            aria-pressed={outcome === value}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              outcome === value
                ? value === "YES"
                  ? "border-yes bg-yes-soft text-yes"
                  : value === "NO"
                    ? "border-no bg-no-soft text-no"
                    : "border-faint bg-page text-fg"
                : "border-border text-muted hover:border-faint"
            }`}
          >
            {value}
          </button>
        ))}
      </fieldset>

      <textarea
        name="reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="What happened, and where can it be verified? Include a link."
        className="w-full rounded-lg border border-border bg-page px-3 py-2 text-xs leading-relaxed outline-none focus:border-accent"
      />

      {state.error && (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !outcome || reason.trim().length < 10}
        className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-fg
                   transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending
          ? "Settling…"
          : outcome === "VOID"
            ? "Void and refund"
            : outcome
              ? `Resolve ${outcome} and pay out`
              : "Pick an outcome"}
      </button>

      <p className="text-[11px] leading-relaxed text-faint">
        Settlement is permanent and pays out immediately. The reason is shown publicly on
        the market.
      </p>
    </form>
  );
}
