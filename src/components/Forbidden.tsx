import Link from "next/link";

/**
 * Shown instead of admin pages to anyone who is not an admin.
 *
 * A server component throwing `AuthError` would surface as a generic 500, which
 * reads as a broken site rather than a closed door. Note this is presentation
 * only — the server actions behind these pages re-check `requireAdmin()`
 * themselves, because hiding a button is not authorisation.
 */
export function Forbidden({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Admins only</h1>
      <p className="text-sm leading-relaxed text-muted">
        {signedIn
          ? "This page is restricted to administrators. If you think you should have access, ask whoever runs this site to add your email."
          : "You need to be signed in as an administrator to see this page."}
      </p>
      <Link
        href={signedIn ? "/" : "/signin?callbackUrl=/admin"}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
      >
        {signedIn ? "Back to markets" : "Sign in"}
      </Link>
    </div>
  );
}
