/**
 * Minimal `.env` loader for scripts run outside Next.js — tests and `db:seed`.
 *
 * Next loads `.env` itself, so nothing in `src/app` should import this. Node 18
 * predates `--env-file` and we would rather not add a dependency for twenty
 * lines, hence this. Existing environment variables always win, so CI can point
 * the tests at a different database without editing the file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(file = ".env"): void {
  // Under Next the variables are already in the environment, so this is a
  // no-op there and never touches the filesystem.
  if (process.env.DATABASE_URL) return;

  let contents: string;
  try {
    contents = readFileSync(resolve(process.cwd(), file), "utf8");
  } catch {
    return; // No .env is fine; the real environment may already be set.
  }

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
