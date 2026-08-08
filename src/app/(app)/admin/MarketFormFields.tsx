"use client";

import { DEFAULT_LIQUIDITY, MAX_LIQUIDITY, MIN_LIQUIDITY } from "@/lib/marketConstants";
import type { ActionState } from "./actions";

/**
 * The market question/rules/category/close/liquidity fields, shared by the
 * create and edit forms so the two never drift apart. Each form supplies its own
 * `<form>`, action wiring, hidden inputs and submit button; this owns only the
 * fields and the general (non-field) error line.
 */
export interface MarketFormDefaults {
  question?: string;
  rules?: string;
  category?: string | null;
  /** `datetime-local` value, i.e. "YYYY-MM-DDTHH:mm". */
  closesAt: string;
  b?: number;
}

export function MarketFormFields({
  state,
  defaults,
}: {
  state: ActionState;
  defaults: MarketFormDefaults;
}) {
  return (
    <>
      <Field
        label="Question"
        hint="Ask something with a clear yes or no answer and a definite deadline."
        error={state.field === "question" ? state.error : undefined}
      >
        <input
          name="question"
          required
          defaultValue={defaults.question}
          placeholder="Will X happen before Y?"
          className="w-full rounded-lg border border-border bg-page px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </Field>

      <Field
        label="Resolution rules"
        hint="The single biggest cause of disputes. Say exactly what makes this YES, and name the source you will check."
        error={state.field === "rules" ? state.error : undefined}
      >
        <textarea
          name="rules"
          required
          rows={5}
          defaultValue={defaults.rules}
          placeholder="Resolves YES if … according to … Resolves NO otherwise. If … the market is voided."
          className="w-full rounded-lg border border-border bg-page px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent"
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Category" hint="Optional. Groups markets on the list page.">
          <input
            name="category"
            defaultValue={defaults.category ?? ""}
            placeholder="Cricket"
            className="w-full rounded-lg border border-border bg-page px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </Field>

        <Field
          label="Closes at"
          hint="Trading stops automatically at this time."
          error={state.field === "closesAt" ? state.error : undefined}
        >
          <input
            type="datetime-local"
            name="closesAt"
            required
            defaultValue={defaults.closesAt}
            className="w-full rounded-lg border border-border bg-page px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </Field>
      </div>

      <Field
        label="Liquidity (b)"
        hint={`Higher means prices move less per trade, and the house subsidises more (up to b × 0.69 points). 500 is a sensible default.`}
        error={state.field === "b" ? state.error : undefined}
      >
        <input
          type="number"
          name="b"
          defaultValue={defaults.b ?? DEFAULT_LIQUIDITY}
          min={MIN_LIQUIDITY}
          max={MAX_LIQUIDITY}
          step={50}
          className="tabular w-full rounded-lg border border-border bg-page px-3 py-2 text-sm outline-none focus:border-accent sm:w-40"
        />
      </Field>

      {state.error && !state.field && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
    </>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="text-xs leading-relaxed text-muted">{hint}</span>}
      {children}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </label>
  );
}
