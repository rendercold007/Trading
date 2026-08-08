import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { STARTING_BALANCE_LABEL } from "@/lib/marketConstants";
import SignInForm from "@/components/SignInForm";
import { signInAction } from "../actions";

/**
 * Sign in / sign up.
 *
 * Sits outside the `(app)` route group so it carries the landing's minimal
 * header rather than the app chrome — a nav bar offering Leaderboard and a
 * second "Sign in" button is noise on the page whose only job is to get you in.
 * The palette is the same one everywhere else uses; this page is the far side
 * of the landing page's two buttons, and a colour swap mid-flow reads as a
 * broken link.
 *
 * Two ways in, one card: "Continue with Google" (a full-page OAuth redirect)
 * and email + password below an "or" divider. Both create an account on first
 * use — Google via Auth.js, email/password via the credentials service — and
 * both land on the same `User` row keyed by email. The hCaptcha widget and the
 * email/password fields live in `SignInForm`, a client component, because they
 * need browser state; the Google button does not.
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
   * There is one account per email regardless of how it was made, so `intent`
   * only changes wording and which credentials path the form runs (register vs
   * sign in). It exists because a landing page needs a "Sign up" button that
   * doesn't then say "Sign in" on arrival, which reads like the click went wrong.
   */
  const signingUp = intent === "signup";

  // Land on the market list, not `/` — the landing page would only bounce a
  // freshly signed-in user straight here anyway. Kept same-origin.
  const destination = callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
    ? callbackUrl
    : "/markets";

  // The footer link flips between the two framings, carrying `callbackUrl`
  // through so crossing it does not drop wherever the reader was headed.
  const flipParams = new URLSearchParams();
  if (!signingUp) flipParams.set("intent", "signup");
  if (callbackUrl) flipParams.set("callbackUrl", callbackUrl);
  const flipQuery = flipParams.toString();
  const flipHref = flipQuery ? `/signin?${flipQuery}` : "/signin";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-2.5">
          <Link
            href="/"
            className="text-[15px] font-bold tracking-tight text-fg transition-opacity hover:opacity-70"
          >
            Outcome
          </Link>
        </div>
      </header>

      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-12">
        {/* Ambient wash behind the card. Purely decorative, so it is hidden from
            assistive tech and sits under everything via a negative z-index. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-[420px] w-[420px]
                     -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[100px]"
        />

        <div className="w-full max-w-[420px]">
          <div className="flex flex-col gap-6 rounded-2xl border border-border bg-surface p-7 shadow-xl shadow-black/5">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-[26px] font-bold leading-tight tracking-tight text-fg">
                {signingUp ? "Create your account" : "Welcome back"}
              </h1>
              <p className="text-sm leading-relaxed text-muted">
                {signingUp
                  ? `Start with ${STARTING_BALANCE_LABEL} points and climb the leaderboard.`
                  : "Sign in to trade your positions and climb the leaderboard."}
              </p>
            </div>

            {message && (
              <p
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
              >
                {message}
              </p>
            )}

            <form action={signInAction}>
              <input type="hidden" name="callbackUrl" value={destination} />
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-border
                           bg-page px-4 py-3.5 text-[15px] font-semibold text-fg
                           transition-colors hover:border-faint hover:bg-surface-hover"
              >
                <GoogleMark />
                Continue with Google
              </button>
            </form>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-faint">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <SignInForm
              signingUp={signingUp}
              callbackUrl={destination}
              captchaSiteKey={process.env.HCAPTCHA_SITEKEY}
            />

            <div className="flex items-center justify-between gap-3 border-t border-border pt-5 text-[13px]">
              <Link href="/signin/reset" className="text-muted transition-colors hover:text-fg">
                Forgot password?
              </Link>
              <Link href={flipHref} className="font-medium text-accent hover:underline">
                {signingUp ? "I already have an account" : "Create account"}
              </Link>
            </div>
          </div>

          <p className="mt-5 px-1 text-center text-[11px] leading-relaxed text-faint">
            Points are play money. They have no cash value, cannot be withdrawn, and are
            not exchangeable for anything.
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * Google's four-colour mark, inline rather than an image file: it is four
 * paths, and an `<img>` here would be a network round trip on the one page
 * where a missing icon makes the button look broken. Fixed brand colours on
 * purpose — this is the one place in the app that must not follow our tokens,
 * because a recoloured Google logo is a trust signal that has been tampered
 * with.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.97-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
