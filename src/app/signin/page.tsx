import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { signInAction } from "../actions";

/** Errors Auth.js can bounce back here, phrased for a human. */
const ERROR_MESSAGES: Record<string, string> = {
  banned: "This account has been suspended. Contact an admin if you think that's a mistake.",
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
    <div className="signin">
      <h1>Sign in</h1>
      <p>
        Anyone can join — no invite needed. New accounts start with 10,000 points.
      </p>

      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}

      <form action={signInAction}>
        <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
        <button type="submit" className="button primary">
          Continue with Google
        </button>
      </form>

      <p className="fine-print">
        Points are play money. They have no cash value, cannot be withdrawn, and are
        not exchangeable for anything.
      </p>
    </div>
  );
}
