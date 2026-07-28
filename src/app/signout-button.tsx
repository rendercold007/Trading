"use client";

import { signOutAction } from "./actions";

/**
 * Sign-out has to be a POST so a prefetch or a stray GET can't log people out.
 * A form calling a server action is the smallest way to get that.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button type="submit" className="link-button">
        Sign out
      </button>
    </form>
  );
}
