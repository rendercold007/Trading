import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { STARTING_BALANCE_LABEL } from "@/lib/marketConstants";
import { signInAction } from "../actions";

/**
 * Sign in / sign up.
 *
 * Sits outside the `(app)` route group and wears the landing theme, because
 * this is the far side of the landing page's two buttons and a palette swap
 * mid-flow reads as a broken link. It carries the landing's minimal header
 * rather than the app chrome — a nav bar offering Leaderboard and a second
 * "Sign in" button is noise on the page whose only job is one button.
 */

/** Errors Auth.js can bounce back here, phrased for a human. */
const ERROR_MESSAGES: Record<string, string> = {
  banned: "This account has been suspended. Contact an admin if you think that's a mistake.",
  rate_limited: "Too many sign-in attempts from your network. Wait a little and try again.",
  OAuthAccountNotLinked: "That email is already registered with a different sign-in method.",
  AccessDenied: "Sign-in was declined.",
  Configuration: "Sign-in is misconfigured. This is a problem on our end, not yours.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string; intent?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect("/markets");

  const { error, callbackUrl, intent } = await searchParams;
  const message = error ? (ERROR_MESSAGES[error] ?? "Something went wrong signing in.") : null;

  /**
   * There is one Google flow, and it both creates the account and signs into
   * it — Auth.js registers an unknown Google account on first use. So `intent`
   * only changes the wording, never the behaviour. It exists because a landing
   * page needs a "Sign up" button that doesn't then say "Sign in" on arrival,
   * which reads like the click went wrong.
   */
  const signingUp = intent === "signup";

  return (
    <div className="landing flex min-h-dvh flex-col">
      <header className="mx-auto w-full max-w-6xl px-6 py-6">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-tight text-fg transition-opacity hover:opacity-70"
        >
          Outcome
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-sm flex-col gap-7">
          <div className="flex flex-col gap-3">
            <h1 className="font-display text-3xl tracking-tight text-fg">
              {signingUp ? "Create your account" : "Welcome back"}
            </h1>
            <p className="text-sm leading-relaxed text-muted">
              {signingUp
                ? `Anyone can join — no invite needed. You'll start with ${STARTING_BALANCE_LABEL} points.`
                : `Sign in with Google. New here? The same button creates your account and credits ${STARTING_BALANCE_LABEL} points.`}
            </p>
          </div>

          {message && (
            <p
              role="alert"
              className="rounded-lg border border-danger/40 bg-no-soft px-3 py-2 text-sm text-danger"
            >
              {message}
            </p>
          )}

          <form action={signInAction}>
            {/* Land on the market list, not `/` — the landing page would only
                bounce a freshly signed-in user straight here anyway. */}
            <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/markets"} />
            <button
              type="submit"
              className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              Continue with Google
            </button>
          </form>

          <p className="border-t border-border pt-6 text-xs leading-relaxed text-muted">
            Points are play money. They have no cash value, cannot be withdrawn, and are
            not exchangeable for anything. Google sign-in is the only option, which keeps
            throwaway accounts costly.
          </p>
        </div>
      </main>
    </div>
  );
}
