/**
 * Resolving the client IP for IP-keyed rate limits.
 *
 * `x-forwarded-for` is client-controlled: anyone can send one, and if we simply
 * read the first entry then defeating the signup limit is a one-line curl flag.
 * What makes it trustworthy is that each proxy *appends* the address it saw, so
 * the **last** entry is written by our own edge and cannot be spoofed. Vercel
 * additionally sets `x-vercel-forwarded-for`, which it strips from inbound
 * requests, so that one is preferred where present.
 *
 * The number of proxies in front of the app is deployment-specific; set
 * `TRUSTED_PROXY_COUNT` if it is ever more than one.
 */

import { headers } from "next/headers";

/** How many hops we control at the right-hand end of `x-forwarded-for`. */
function trustedProxyCount(): number {
  const raw = Number(process.env.TRUSTED_PROXY_COUNT);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/**
 * Pick the client address out of an `x-forwarded-for` chain.
 *
 * Counting from the right by the number of proxies we trust lands on the
 * address our own infrastructure observed. Everything to the left of that was
 * supplied by the caller and is worthless for rate limiting.
 */
export function parseForwardedFor(value: string | null, proxies = 1): string | null {
  if (!value) return null;

  const hops = value
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
  if (hops.length === 0) return null;

  const index = Math.max(0, hops.length - proxies);
  return hops[index] ?? hops[hops.length - 1] ?? null;
}

/**
 * Strip a port and IPv6 brackets, and fold IPv4-mapped IPv6 down to the v4
 * form, so the same caller always produces the same bucket key.
 */
export function normalizeIp(ip: string): string {
  let value = ip.trim();

  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close !== -1) value = value.slice(1, close);
  } else {
    // Only strip a port for IPv4 — a bare IPv6 address is full of colons.
    const colons = value.split(":").length - 1;
    if (colons === 1) value = value.split(":")[0];
  }

  if (value.toLowerCase().startsWith("::ffff:")) value = value.slice(7);
  return value.toLowerCase();
}

/**
 * The calling client's IP, or null if it cannot be determined.
 *
 * Null matters: callers must decide explicitly what to do rather than silently
 * bucketing every anonymous request under one key, which would let one abuser
 * lock out the world.
 */
export async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();

    // Vercel strips this from inbound requests, so it cannot be forged.
    const vercel = h.get("x-vercel-forwarded-for");
    if (vercel) {
      const parsed = parseForwardedFor(vercel, 1);
      if (parsed) return normalizeIp(parsed);
    }

    const forwarded = parseForwardedFor(h.get("x-forwarded-for"), trustedProxyCount());
    if (forwarded) return normalizeIp(forwarded);

    const real = h.get("x-real-ip");
    if (real) return normalizeIp(real);

    return null;
  } catch {
    // `headers()` throws outside a request scope. Callers treat this as unknown.
    return null;
  }
}
