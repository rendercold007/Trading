"use client";

import { deleteMarketAction } from "./actions";

/**
 * Delete control for a zero-trade market. Client-side so it can `confirm()`
 * before firing — deletion is irreversible, and the button sits one row away
 * from "Close early". The server action re-checks admin and the zero-trade
 * guard regardless; this is a courtesy, not the enforcement.
 */
export function DeleteMarketButton({ marketId, question }: { marketId: string; question: string }) {
  return (
    <form
      action={deleteMarketAction}
      onSubmit={(e) => {
        if (!confirm(`Delete “${question}”? This cannot be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="marketId" value={marketId} />
      <button
        type="submit"
        className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-danger/50 hover:text-danger"
      >
        Delete
      </button>
    </form>
  );
}
