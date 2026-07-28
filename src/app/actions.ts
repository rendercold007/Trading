"use server";

import { signIn, signOut } from "@/lib/auth";

/** Kick off the Google OAuth flow. */
export async function signInAction(formData: FormData) {
  const callbackUrl = (formData.get("callbackUrl") as string) || "/";
  await signIn("google", { redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
