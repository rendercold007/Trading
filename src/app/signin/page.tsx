import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { signInAction } from "../actions";

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
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect("/");

  const { error, callbackUrl } = await searchParams;
  const message = error ? (ERROR_MESSAGES[error] ?? "Something went wrong signing in.") : null;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted">
          Anyone can join — no invite needed. New accounts start with 10,000 points.
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
        <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          Continue with Google
        </button>
      </form>

      <p className="text-xs leading-relaxed text-muted">
        Points are play money. They have no cash value, cannot be withdrawn, and are not
        exchangeable for anything. Google sign-in is the only option, which keeps
        throwaway accounts costly.
      </p>
    </div>
  );
}
