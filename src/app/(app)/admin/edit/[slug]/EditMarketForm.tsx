"use client";

import { useActionState } from "react";

import { editMarketAction, type ActionState } from "../../actions";
import { MarketFormFields, type MarketFormDefaults } from "../../MarketFormFields";

export function EditMarketForm({
  marketId,
  defaults,
}: {
  marketId: string;
  defaults: MarketFormDefaults;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(editMarketAction, {});

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="marketId" value={marketId} />
      <MarketFormFields state={state} defaults={defaults} />

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
