"use client";

import { signOutAction } from "./actions";

/**
 * Sign-out has to be a POST so a prefetch or a stray GET can't log people out.
 * A form calling a server action is the smallest way to get that.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="text-muted underline-offset-2 transition-colors hover:text-fg hover:underline"
      >
        Sign out
      </button>
    </form>
  );
}
