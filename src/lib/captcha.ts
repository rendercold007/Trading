/**
 * hCaptcha verification for the sign-in / sign-up forms.
 *
 * The widget on the page produces a single-use token; this confirms it with
 * hCaptcha's `siteverify` endpoint server-side. Doing it on the server is the
 * whole point — the client cannot be trusted to have actually solved anything,
 * so the token is worthless until hCaptcha vouches for it against our secret.
 *
 * When `HCAPTCHA_SECRET` is unset the check is skipped and logged. That keeps
 * local development runnable without signing up for hCaptcha, and mirrors how
 * `clientIp` fails open — a missing config is an operator problem, not a reason
 * to lock every visitor out. In production the secret is set, so it runs.
 */

const SITEVERIFY_URL = "https://api.hcaptcha.com/siteverify";

/** hCaptcha's documented test secret — always verifies, used when none is set. */
export const HCAPTCHA_TEST_SECRET = "0x0000000000000000000000000000000000000000";

/** The `siteverify` response, trimmed to what we read. */
interface SiteVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

export interface CaptchaResult {
  ok: boolean;
  /** Present when the check ran and failed; absent when it passed or was skipped. */
  reason?: string;
}

/** So tests can supply a fake without hitting the network. */
type FetchFn = typeof fetch;

/**
 * Verify an hCaptcha token.
 *
 * `remoteIp` is optional and advisory — hCaptcha uses it as an extra signal but
 * does not require it, and our `clientIp` can legitimately be null behind an
 * unknown proxy, so we simply omit it then.
 */
export async function verifyCaptcha(
  token: string | null | undefined,
  opts: { remoteIp?: string | null; secret?: string; fetchImpl?: FetchFn } = {},
): Promise<CaptchaResult> {
  const secret = opts.secret ?? process.env.HCAPTCHA_SECRET;

  if (!secret) {
    // No secret configured: skip, but say so once per call so a production
    // deployment that forgot to set it is visible in the logs.
    console.warn("[captcha] HCAPTCHA_SECRET unset; skipping captcha verification");
    return { ok: true };
  }

  if (typeof token !== "string" || token.trim().length === 0) {
    return { ok: false, reason: "missing-captcha" };
  }

  const body = new URLSearchParams({ secret, response: token.trim() });
  if (opts.remoteIp) body.set("remoteip", opts.remoteIp);

  const doFetch = opts.fetchImpl ?? fetch;

  let data: SiteVerifyResponse;
  try {
    const res = await doFetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    data = (await res.json()) as SiteVerifyResponse;
  } catch {
    // hCaptcha unreachable. Fail *closed* here, unlike a missing secret: the
    // check was configured and asked for, and letting a network blip wave every
    // signup through would defeat the control on the one path it guards.
    return { ok: false, reason: "captcha-unreachable" };
  }

  if (data.success) return { ok: true };
  return { ok: false, reason: (data["error-codes"] ?? ["captcha-failed"]).join(",") };
}
