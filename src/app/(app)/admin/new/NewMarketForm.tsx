"use client";

import { useActionState } from "react";

import { createMarketAction, type ActionState } from "../actions";
import { MarketFormFields } from "../MarketFormFields";

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
      <MarketFormFields state={state} defaults={{ closesAt: defaultCloseValue() }} />

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
