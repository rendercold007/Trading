"use client";

import { useActionState } from "react";

import { createMarketAction, type ActionState } from "../actions";
import { DEFAULT_LIQUIDITY, MAX_LIQUIDITY, MIN_LIQUIDITY } from "@/lib/marketConstants";

/** Default close time: a week out, which suits most questions people ask. */
function defaultCloseValue(): string {
  const d = new Date(Date.now() + 7 * 86_400_000);
  // `datetime-local` wants local time with no timezone suffix.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewMarketForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createMarketAction, {});

  return (
    <form action={action} className="flex flex-col gap-5">
      <Field
        label="Question"
        hint="Ask something with a clear yes or no answer and a definite deadline."
        error={state.field === "question" ? state.error : undefined}
      >
        <input
          name="question"
          required
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
          placeholder="Resolves YES if … according to … Resolves NO otherwise. If … the market is voided."
          className="w-full rounded-lg border border-border bg-page px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent"
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Category" hint="Optional. Groups markets on the list page.">
          <input
            name="category"
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
            defaultValue={defaultCloseValue()}
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
          defaultValue={DEFAULT_LIQUIDITY}
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

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create market"}
      </button>
    </form>
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
