"use server";

import { redirect } from "next/navigation";

import { signIn, signOut } from "@/lib/auth";
import {
  CredentialsError,
  type CredentialsErrorCode,
  registerCredentials,
  signInCredentials,
} from "@/lib/credentials";

/** Kick off the Google OAuth flow. */
export async function signInAction(formData: FormData) {
  const callbackUrl = (formData.get("callbackUrl") as string) || "/";
  await signIn("google", { redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

// ---------------------------------------------------------------------------
// Email / password
//
// One action drives both the sign-in and the sign-up form via `useActionState`,
// so the client component stays a thin controlled form. The mode arrives as a
// hidden field rather than a bound argument to keep the action a plain
// `(state, formData)` reference. On success the credentials service has already
// minted the session cookie, so all that is left is to redirect; on failure we
// return a state the form renders inline, preserving the typed email.
// ---------------------------------------------------------------------------

/** Which input an error should attach to, so the form can highlight it. */
type CredentialsField = "email" | "password" | "captcha" | "form";

export interface CredentialsFormState {
  error?: string;
  field?: CredentialsField;
  /** Echoed back so a failed submit does not blank the email the user typed. */
  email?: string;
}

const FIELD_BY_CODE: Record<CredentialsErrorCode, CredentialsField> = {
  INVALID_EMAIL: "email",
  EMAIL_TAKEN: "email",
  WEAK_PASSWORD: "password",
  INVALID_CREDENTIALS: "form",
  USE_GOOGLE: "form",
  BANNED: "form",
  CAPTCHA_FAILED: "captcha",
  RATE_LIMITED: "form",
};

/**
 * A same-origin destination to land on after signing in. Anything absolute or
 * protocol-relative is dropped in favour of `/markets`, so a crafted
 * `callbackUrl` cannot bounce a freshly signed-in user off to another site.
 */
function safeCallback(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "/markets";
}

export async function credentialsAction(
  _prev: CredentialsFormState,
  formData: FormData,
): Promise<CredentialsFormState> {
  const email = (formData.get("email") as string) ?? "";
  const password = (formData.get("password") as string) ?? "";
  const captchaToken = (formData.get("h-captcha-response") as string) ?? "";
  const signingUp = formData.get("mode") === "signup";
  const callbackUrl = safeCallback(formData.get("callbackUrl"));

  try {
    const input = { email, password, captchaToken };
    if (signingUp) {
      await registerCredentials(input);
    } else {
      await signInCredentials(input);
    }
  } catch (err) {
    if (err instanceof CredentialsError) {
      return { error: err.message, field: FIELD_BY_CODE[err.code], email };
    }
    // Never surface an unexpected error's message to the form — it may carry a
    // database detail. Log it and show something generic.
    console.error("[credentials] unexpected error:", err);
    return { error: "Something went wrong. Please try again.", field: "form", email };
  }

  // Session cookie is set; leave the auth surface for the app.
  redirect(callbackUrl);
}
