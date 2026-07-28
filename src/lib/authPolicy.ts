/**
 * Pure authentication policy — who is an admin, what a handle looks like, and
 * how email addresses are compared.
 *
 * Kept free of database and NextAuth imports so it can be unit tested directly
 * and so `src/lib/auth.ts` stays a thin wiring layer over decisions made here.
 */

/** Handles are what the leaderboard shows, so keep them short and URL-safe. */
export const MAX_HANDLE_LENGTH = 20;
const MIN_HANDLE_LENGTH = 3;

/**
 * Lowercase and trim. Google always hands back a normalised address, but env
 * vars and ban entries are typed by hand.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Collapse the addresses Google treats as one mailbox down to a single form:
 * on Gmail, `first.last+tag@gmail.com` and `firstlast@gmail.com` deliver to the
 * same person. Only used for ban checks — a ban is worthless if adding a dot
 * evades it. Non-Gmail domains are returned unchanged, since dots and plus
 * addressing are not universally aliases.
 */
export function canonicalEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at === -1) return normalized;

  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (domain !== "gmail.com" && domain !== "googlemail.com") return normalized;

  const withoutTag = local.split("+", 1)[0];
  return `${withoutTag.replaceAll(".", "")}@gmail.com`;
}

/**
 * Parse `ADMIN_EMAILS`. Comma-separated, blanks and stray whitespace ignored.
 *
 * Admin status is derived from the environment on every sign-in rather than
 * being a one-time grant, so removing an address from the list demotes that
 * account the next time they log in.
 */
export function parseAdminEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(normalizeEmail)
    .filter((email) => email.length > 0 && email.includes("@"));
}

/** Whether `email` should hold admin rights, given the configured list. */
export function isAdminEmail(email: string, raw: string | undefined): boolean {
  const admins = parseAdminEmails(raw);
  if (admins.length === 0) return false;
  return admins.includes(normalizeEmail(email));
}

/**
 * Turn a Google display name (or, failing that, an email local part) into a
 * candidate handle. Uniqueness is not this function's job — the caller adds a
 * numeric suffix if the database rejects the first attempt.
 */
export function handleCandidate(name: string | null | undefined, email: string): string {
  const source = (name ?? "").trim() || normalizeEmail(email).split("@")[0];

  const slug = source
    .toLowerCase()
    .normalize("NFKD")
    // Drop combining marks so accented names transliterate rather than vanish.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_HANDLE_LENGTH)
    .replace(/-+$/g, "");

  // An all-emoji display name can slug to nothing, and single characters are
  // not worth showing on a leaderboard.
  return slug.length >= MIN_HANDLE_LENGTH ? slug : "trader";
}

/**
 * Append a disambiguating suffix, keeping the result inside the length limit.
 * `attempt` is 1-based: the first retry becomes `name-2`.
 */
export function suffixedHandle(base: string, attempt: number): string {
  const suffix = `-${attempt + 1}`;
  return base.slice(0, MAX_HANDLE_LENGTH - suffix.length) + suffix;
}
