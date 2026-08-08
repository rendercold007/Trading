"use client";

/**
 * The email/password half of the sign-in page.
 *
 * A client component because it owns three things that have to run in the
 * browser: the hCaptcha widget and its single-use token, the pending state on
 * submit, and the inline field errors returned by the server action. Google
 * sign-in sits in its own plain `<form>` above this — it is a full-page OAuth
 * redirect with nothing to manage client-side.
 *
 * The action is a server action (`credentialsAction`); this form never sees a
 * password hash or touches the database. Errors come back as a typed state via
 * `useActionState` and attach to the field named in `state.field`.
 */

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Script from "next/script";

import { credentialsAction, type CredentialsFormState } from "@/app/actions";

interface SignInFormProps {
  /** When true the button reads "Create account" and the sign-up path runs. */
  signingUp: boolean;
  /** Same-origin path to land on after success. */
  callbackUrl: string;
  /** Public hCaptcha site key. Absent in local dev, where the widget is skipped. */
  captchaSiteKey?: string;
}

// hCaptcha's global, present once its script has loaded. Typed loosely — we
// only touch render/reset and do not want to vendor its full type surface.
interface HCaptchaApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
}
declare global {
  interface Window {
    hcaptcha?: HCaptchaApi;
  }
}

export default function SignInForm({ signingUp, callbackUrl, captchaSiteKey }: SignInFormProps) {
  const [state, formAction] = useActionState<CredentialsFormState, FormData>(credentialsAction, {});

  const widgetHost = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");

  // Render the widget explicitly once the script is available. Rendering into a
  // ref (not a `.h-captcha` element) keeps hCaptcha's auto-scan from also
  // grabbing it, so there is exactly one widget and we own its token.
  useEffect(() => {
    if (!captchaSiteKey) return;
    let cancelled = false;

    const mount = () => {
      if (cancelled) return;
      const hc = window.hcaptcha;
      if (!hc) {
        window.setTimeout(mount, 150);
        return;
      }
      if (widgetHost.current && widgetId.current === null) {
        widgetId.current = hc.render(widgetHost.current, {
          sitekey: captchaSiteKey,
          callback: (token: string) => setCaptchaToken(token),
          "expired-callback": () => setCaptchaToken(""),
          "error-callback": () => setCaptchaToken(""),
        });
      }
    };

    mount();
    return () => {
      cancelled = true;
    };
  }, [captchaSiteKey]);

  // An hCaptcha token is single-use and the server already spent it on this
  // submit, so after any failed attempt reset the widget and clear the token —
  // otherwise the next submit sends a stale token that always fails.
  useEffect(() => {
    if (!captchaSiteKey || !state.error) return;
    setCaptchaToken("");
    if (widgetId.current !== null && window.hcaptcha) {
      window.hcaptcha.reset(widgetId.current);
    }
  }, [state, captchaSiteKey]);

  const emailError = state.field === "email" ? state.error ?? null : null;
  const passwordError = state.field === "password" ? state.error ?? null : null;
  const captchaError = state.field === "captcha" ? state.error ?? null : null;
  const formError = state.field === "form" ? state.error ?? null : null;

  return (
    <>
      {captchaSiteKey && (
        <Script src="https://js.hcaptcha.com/1/api.js?render=explicit" strategy="afterInteractive" />
      )}

      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="mode" value={signingUp ? "signup" : "signin"} />
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        {/* Mirrors the field name hCaptcha's own widget would inject, so the
            server action reads the token the same way regardless. */}
        <input type="hidden" name="h-captcha-response" value={captchaToken} />

        {formError && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
          >
            {formError}
          </p>
        )}

        <Field
          label="Email"
          error={emailError}
          icon={<MailIcon />}
          input={
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="Email"
              defaultValue={state.email ?? ""}
              required
              aria-invalid={emailError ? true : undefined}
              className="w-full bg-transparent py-3 pl-10 pr-3 text-[15px] text-fg outline-none
                         placeholder:text-faint"
            />
          }
        />

        <Field
          label="Password"
          error={passwordError}
          icon={<LockIcon />}
          input={
            <input
              type="password"
              name="password"
              autoComplete={signingUp ? "new-password" : "current-password"}
              placeholder="Password"
              required
              aria-invalid={passwordError ? true : undefined}
              className="w-full bg-transparent py-3 pl-10 pr-3 text-[15px] text-fg outline-none
                         placeholder:text-faint"
            />
          }
        />

        {captchaSiteKey && (
          <div className="flex flex-col gap-1.5">
            <div ref={widgetHost} className="min-h-[78px]" />
            {captchaError && <p className="text-xs text-danger">{captchaError}</p>}
          </div>
        )}

        <SubmitButton signingUp={signingUp} />
      </form>
    </>
  );
}

/** The purple primary action, disabled and relabelled while the action runs. */
function SubmitButton({ signingUp }: { signingUp: boolean }) {
  const { pending } = useFormStatus();
  const label = signingUp ? "Create account" : "Sign in";

  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 w-full rounded-xl bg-accent px-4 py-3 text-[15px] font-semibold text-accent-fg
                 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? `${label}…` : label}
    </button>
  );
}

/** An input framed with a leading icon and an optional error line beneath. */
function Field({
  label,
  icon,
  input,
  error,
}: {
  label: string;
  icon: React.ReactNode;
  input: React.ReactNode;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="sr-only">{label}</label>
      <div
        className={`relative flex items-center rounded-xl border bg-page transition-colors
                    focus-within:border-accent ${error ? "border-danger/60" : "border-border"}`}
      >
        <span className="pointer-events-none absolute left-3 text-faint">{icon}</span>
        {input}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
