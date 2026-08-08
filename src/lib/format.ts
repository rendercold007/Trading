/**
 * Display formatting.
 *
 * Centralised so a probability reads the same everywhere. The rounding here is
 * presentational only — never feed these strings back into a calculation.
 */

/** 0.6823 → "68%". Probabilities are shown whole; false precision implies false confidence. */
export function formatProbability(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** 0.6823 → "68¢". Each share pays 1 point, so the price *is* the probability. */
export function formatPrice(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

/** Points, thousands-separated. Fractions are shown only when they exist. */
export function formatPoints(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * 12,400 → "12.4k". For dense card footers, where the exact volume is noise
 * and the reader only wants an order of magnitude. Never use this where the
 * number is the point — a balance, a cost, a payout — only where it is context.
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1000) return formatPoints(value);

  const [scaled, suffix] = abs < 1_000_000 ? [value / 1000, "k"] : [value / 1_000_000, "m"];
  // One decimal, but "12.0k" is worse than "12k" — trailing zeros read as
  // precision that isn't there.
  return `${Number(scaled.toFixed(1))}${suffix}`;
}

/** Share counts. Same idea as points but tolerant of small fractions. */
export function formatShares(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/**
 * "3d left", "4h left", "closed".
 *
 * Deliberately coarse. A live countdown would need a client component and a
 * timer on every card, and nobody trades differently because a market closes in
 * 71 rather than 72 minutes.
 */
export function formatTimeLeft(closesAt: number, now: number = Date.now()): string {
  const ms = closesAt - now;
  if (ms <= 0) return "closed";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m left`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h left`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d left`;

  return `${Math.floor(days / 30)}mo left`;
}

/** "2 hours ago". For trade feeds. */
export function formatRelativeTime(at: number, now: number = Date.now()): string {
  const seconds = Math.floor((now - at) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

/** Absolute date for rules and resolution notes, where precision matters. */
export function formatDate(at: number): string {
  return new Date(at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
