import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";

/**
 * "Forgot password?" — an honest placeholder, not a working reset.
 *
 * Real password reset means delivering a one-time link by email, and this app
 * has no mail infrastructure at all (see CLAUDE.md — there is no SMTP/Resend
 * wiring anywhere). Rather than fake a flow that silently goes nowhere, this
 * page says so plainly and points at the two routes that do work: signing in
 * with Google, or asking an admin. When an email sender exists, this becomes a
 * token-based reset form; until then, a truthful dead-end beats a broken one.
 */
export default async function ResetPage() {
  const user = await currentUser();
  if (user) redirect("/markets");

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

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[420px]">
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-7 shadow-xl shadow-black/5">
            <h1 className="text-[22px] font-bold leading-tight tracking-tight text-fg">
              Password reset isn&rsquo;t available yet
            </h1>
            <p className="text-sm leading-relaxed text-muted">
              We don&rsquo;t send email yet, so there&rsquo;s no way to deliver a reset link.
              If you can&rsquo;t get in:
            </p>
            <ul className="flex flex-col gap-2 text-sm leading-relaxed text-muted">
              <li className="flex gap-2">
                <span aria-hidden className="text-accent">
                  &bull;
                </span>
                <span>
                  Use <span className="font-medium text-fg">Continue with Google</span> if you ever
                  signed in that way with the same email.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="text-accent">
                  &bull;
                </span>
                <span>Otherwise, contact an admin to have your password reset.</span>
              </li>
            </ul>

            <div className="border-t border-border pt-5">
              <Link href="/signin" className="text-[13px] font-medium text-accent hover:underline">
                &larr; Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
