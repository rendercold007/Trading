/**
 * Auth.js catch-all route: sign-in, callback, sign-out and session endpoints.
 * All the configuration lives in `src/lib/auth.ts`.
 */

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
