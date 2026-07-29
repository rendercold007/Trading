# Prediction Market

An open, publicly registerable prediction market — Polymarket/Kalshi mechanics at
small scale. Play-money only. Anyone with the link can open it and sign up; there
is no invite gate and no allowlist.

## Locked decisions

| Area | Decision | Rationale |
|---|---|---|
| Currency | Play-money **points** only | The app never holds, moves, or touches funds. See "Open registration changes the risk profile" below — with public sign-up, points must stay points. |
| Pricing | **LMSR** automated market maker | An order book needs continuous two-sided interest to function; at launch volume it would sit empty. The AMM always quotes a price so trades fill instantly however few people are online. |
| Market types | **Binary YES/NO** only (MVP) | Covers most of what people bet on. Multi-outcome is a later extension. |
| Market creation | **Admins only** for now | Open creation invites spam and unresolvable questions from anonymous accounts. Revisit once moderation exists. |
| Platform | **Next.js web app** (mobile-friendly), one shared URL | No app-store friction, works on every device. |
| Auth | **Google sign-in** via NextAuth, **open registration** — anyone with the link can create an account | One tap, no password resets to support. Google as the only provider raises the cost of mass multi-accounting versus email/password. |
| Resolution | **Admin resolves**, with a public audit log and a mandatory sourced reason | Simple and fast. With strangers trading, the audit trail stops being a nicety — the sourced reason is what makes a resolution defensible. |
| Stack | Next.js + TypeScript + Postgres (Prisma) | Transactional integrity matters for a market engine; Postgres gives it. |
| Scope | Working MVP first, polish after | Trading, pricing, resolution, leaderboard end to end. |

## Open registration changes the risk profile

This started as an invite-only friend group where points were a scoreboard and any
real settle-up happened privately between people who knew each other. Public sign-up
changes two things materially, and both are decisions to make deliberately rather
than drift into.

**1. Points must stay points.** A private arrangement among friends is a private
arrangement. A publicly registerable site where strangers' points convert to money —
even informally, even if the app never touches a rupee — is a different thing, and it
is the thing India's Promotion and Regulation of Online Gaming Act 2025 targets. The
Act bans online real-money gaming nationwide and criminalises *offering, facilitating,
advertising, and payment-processing* for it. Facilitation is broad enough to reach a
platform that knowingly runs the odds and lets users settle outside it.

So for the open version: **no cash-out path, no advertised exchange rate, no
official settle-up mechanism, no prize pool.** The leaderboard is the prize. If real
money ever enters the picture, that is a lawyer conversation, not a code change.

**2. Anonymous users behave differently from friends.** Design for it:

- **Multi-accounting.** Fresh accounts start with 10,000 points, so anyone can farm
  the leaderboard by registering repeatedly and keeping only the lucky accounts.
  Mitigations: Google-only sign-in, rank by long-run calibration and Brier score
  rather than raw point total, require a minimum number of resolved markets before
  a user appears on the leaderboard.
- **Market manipulation.** Someone can push a price with a big trade purely to move
  the displayed probability. LMSR makes this self-punishing (they eat the slippage),
  which is a real argument for the AMM over an order book here.
- **Spam and abuse.** Hence admin-only market creation, plus rate limiting on trades
  and a moderation path for handles.
- **Sybil-resistant seeding.** Never hand out points for signing up beyond the
  initial balance; no referral bonuses.

## Economic parameters (all tunable)

- Starting balance: **10,000 points** per user
- Each share pays **1 point** if its side resolves true, 0 otherwise
- Default liquidity parameter **b = 500** per market
- Max subsidy the market maker can lose per market: `b * ln(2)` ≈ 347 points
- No shorting — to bet against something, buy the opposite side
- Users may sell shares they hold back to the AMM at any time before close

## LMSR reference

Cost function over outstanding shares `q_yes`, `q_no`:

```
C(q) = b * ln( e^(q_yes/b) + e^(q_no/b) )
price_yes = e^(q_yes/b) / ( e^(q_yes/b) + e^(q_no/b) )
```

Cost to buy `d` YES shares = `C(q_yes + d, q_no) - C(q_yes, q_no)`.
Selling is the same with negative `d`. Prices always sum to 1.
Implementation must use the log-sum-exp trick (subtract the max exponent)
or it overflows once `q/b` gets large.

## Code map

| Path | What it is |
|---|---|
| `src/lib/lmsr.ts` | Pure LMSR engine. Plain numbers, no I/O, no database. |
| `src/lib/trade.ts` | Transactional trade service. The **only** supported way to move points or shares. |
| `src/lib/authPolicy.ts` | Pure auth policy: admin list parsing, handle slugs, email canonicalisation. |
| `src/lib/bans.ts` | Deny list: `isBanned`, `banEmail`, `unbanEmail`. No NextAuth dependency. |
| `src/lib/rateLimit.ts` | Token-bucket limiter over Postgres, plus the tuned policies. |
| `src/lib/clientIp.ts` | Spoof-resistant client IP for IP-keyed limits. |
| `src/lib/auth.ts` | NextAuth wiring + `currentUser` / `requireUser` / `requireAdmin`. |
| `src/lib/db.ts` | Prisma client singleton (hot-reload safe). |
| `src/lib/loadEnv.ts` | Reads `.env` for scripts run outside Next. No-op under Next. |
| `src/lib/resolve.ts` | Settlement: `resolveMarket`, `voidMarket`, `closeMarket`. Pays out. |
| `src/lib/adminMarkets.ts` | `createMarket` + `slugify`. Admin-only by policy. |
| `src/lib/markets.ts` | **Read-only** market queries for the UI. Decimal→number here. |
| `src/lib/leaderboard.ts` | Leaderboard ranking and portfolio aggregates. |
| `src/lib/format.ts` | Display formatting. Presentational rounding only. |
| `src/lib/marketConstants.ts` | Values shared with client components. **No imports** — see below. |
| `src/lib/apiSchema.ts` | Parses untrusted request bodies/queries into typed values. |
| `src/lib/apiError.ts` | Maps thrown errors to HTTP status codes; origin check. |
| `src/app/layout.tsx` | Document shell only — `<html>`/`<body>`. No header, deliberately. |
| `src/app/page.tsx` | Landing page. Outside `(app)`, so it gets none of the app chrome. |
| `src/app/signin/` | Sign in / sign up. Outside `(app)`; wears the landing theme. |
| `src/app/actions.ts` | `signInAction` / `signOutAction`. Shared across both groups. |
| `src/app/(app)/layout.tsx` | The signed-in chrome: header, balance, nav, footer. |
| `src/app/` | Next app router — see routes below. |
| `src/components/` | Shared UI: `MarketCard`, `ProbabilityBar`, `ProbabilityChart`, `Sparkline`, `TradeForm`. |
| `prisma/seed.ts` | Demo markets with simulated trading history. |
| `prisma/schema.prisma` | Data model. |

### Routes

| Path | What |
|---|---|
| `/` | **Landing page.** The pitch, own warm theme. Redirects to `/markets` if signed in. |
| `/markets` | Market list (card grid). Readable signed out. Home once you have an account. |
| `/markets/[slug]` | Detail: chart, rules, trade form, your position, activity. |
| `/leaderboard` | Ranked traders. Public. |
| `/portfolio` | Your holdings, marked to market. Requires sign-in. |
| `/admin`, `/admin/new` | Create markets, settle them. Admin only. |
| `/signin` | Google sign-in. Landing theme. `?intent=signup` only changes the wording. |

`/` and `/signin` sit outside the `(app)` route group and share the warm landing
theme. Everything else lives inside `(app)`, which carries the signed-in chrome.
See "Two layouts" below — this split is the reason the landing page can look
nothing like the app.

### Trade service API

```ts
buyShares({ userId, marketId, outcome, shares })   // exact share count
buyShares({ userId, marketId, outcome, budget })   // spend N points; rounds down
sellShares({ userId, marketId, outcome, shares })
quoteTrade({ marketId, outcome, side, shares|budget })  // read-only preview
marketPrices(marketId)                                  // { yes, no }
positionValue({ userId, marketId })                     // shares, costBasis, markValue
```

Failures throw `TradeError` with a `code`, which is what API routes should map to
status codes: `MARKET_NOT_FOUND`, `MARKET_CLOSED`, `USER_NOT_FOUND`,
`INVALID_SIZE`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_SHARES`.

Minimum trade size is `0.01` shares / `0.01` points, which keeps trades clear of
the float-noisy region noted below. Each function takes an optional final Prisma
client argument so tests can pass their own.

### HTTP API

```
POST /api/trade   { marketId, outcome: "YES"|"NO", side: "BUY"|"SELL", shares | budget }
                  → 200 { trade: { tradeId, shares, cost, avgPrice,
                                   balanceAfter, sharesAfter,
                                   priceYesBefore, priceYesAfter } }

GET  /api/quote   ?marketId=&outcome=&side=&shares=  (or &budget=)
                  → 200 { quote: { shares, cost, avgPrice,
                                   priceYesBefore, priceYesAfter } }
```

| Status | Meaning |
|---|---|
| 400 | Malformed request — fix the form. Body names the bad `field`. |
| 401 | Not signed in (or the session's user row is gone) |
| 403 | Cross-origin, or admin-only |
| 404 | No such market |
| 409 | Well-formed but refused: closed market, insufficient balance or shares |
| 429 | Rate limited. Carries `Retry-After` |
| 500 | Unexpected. Message is always generic — details go to the log only |

The 400/409 split is the contract the UI depends on: 400 means the request was
nonsense, 409 means it was reasonable and the answer is still no. Don't collapse
them.

Routes stay thin — they authenticate, validate, call the service, and translate
errors. No trading logic belongs in `src/app/api`. Identity always comes from
the session; a `userId` in a request body is ignored (there is a test for it).

### Settlement API

```ts
resolveMarket({ marketId, outcome, reason, resolvedById })  // pays 1 pt per winning share
voidMarket({ marketId, reason, resolvedById })              // refunds net cost basis
closeMarket(marketId)                                       // halt trading, don't settle
createMarket({ question, rules, category, closesAt, b, creatorId })
```

Failures throw `ResolveError` / `CreateMarketError` with a `code`. Settlement
**mints points**, so `ALREADY_SETTLED` is the most important guard in the
codebase — it is a `FOR UPDATE` lock plus a status re-read *inside* the
transaction, and there is a test firing two resolutions concurrently to prove
only one pays out.

### UI conventions

- Tailwind v4, configured CSS-first in `src/app/globals.css`. Colours are
  semantic tokens (`bg-surface`, `text-yes`, `border-border`) declared once and
  flipped under `prefers-color-scheme`. **Don't add `dark:` variants for
  colour** — if a colour needs a dark value, it wants a token.
- `.tabular` on any number that changes in place, so digits don't jitter.
- **Two layouts.** `src/app/layout.tsx` is the document shell and nothing else.
  The header, nav, balance and footer live in `src/app/(app)/layout.tsx`, so `/`
  and `/signin` — which sit outside that group — render without them. Putting
  the app header back into the root layout would force a Portfolio link and a
  second sign-in button onto the marketing page, and onto the sign-in page
  itself. Any new *signed-in* route belongs inside `(app)`; the two signed-out
  surfaces stay out of it.
- **The landing theme is a token override, not a second stylesheet.** `.landing`
  re-declares `--page`, `--fg`, `--accent` and the rest as warm paper and ink.
  Because the token *names* are unchanged, `bg-surface` / `text-muted` keep
  working inside it and shared components like `MarketCard` inherit the warm
  palette for free. Style the landing with the same utilities as everywhere
  else; do not reach for hard-coded hex.
- The landing is deliberately unlike the app: serif display face, cream stock,
  burnt-orange accent. Every other prediction market on the web is a dark
  terminal with a blue accent, and looking like a clone of one is worse than
  looking like nothing else. The app itself stays cool and dense, which is the
  right call for reading prices — the contrast is intentional, not drift.
- `.card-lift` gives a card a 3px rise and a shadow on hover. It is a class
  rather than utilities on each card so the `prefers-reduced-motion` opt-out
  and the `hover: hover` guard live in one place — without the latter, touch
  browsers leave the card stuck in its lifted state after a tap. Hover only,
  never focus: lifting on focus makes tabbing through a grid jump around.
- Server components read through `markets.ts` / `leaderboard.ts`; they never
  touch Prisma directly and never hand a `Decimal` or `Date` to a client
  component (both throw at the serialisation boundary — hence the `number`
  timestamps).
- Admin pages render `<Forbidden/>` rather than throwing, but every admin
  **server action** re-checks `requireAdmin()`. Hiding a button is not
  authorisation; a server action is a real HTTP endpoint.

### Auth API

```ts
currentUser()   // SessionUser | null — for pages that render both ways
requireUser()   // throws AuthError("UNAUTHENTICATED") → 401
requireAdmin()  // throws AuthError("FORBIDDEN") → 403
banEmail(email, { reason, bannedBy })   // also revokes live sessions
unbanEmail(email)
isBanned(email)
```

### Rate limiting

```ts
enforce("trade", userId)      // throws RateLimitError (has .retryAfter) → 429
consume("signup", ip)         // { allowed, remaining, retryAfter } — no throw
peek(policy, subject)         // tokens available, spends nothing
reset(policy, subject)        // admin intervention / test setup
pruneStaleBuckets(48)         // housekeeping; wants a cron eventually
```

| Policy | Budget | Keyed by |
|---|---|---|
| `trade` | burst 10, then 15/min | user id |
| `signup` | burst 3, then 1/hour | client IP |
| `signin` | burst 20, then 1/min | client IP |

Token bucket, not a fixed window: bursts are fine, sustained rates are not, and
there is no window boundary to game. State is in Postgres because Vercel runs
many short-lived instances — an in-memory counter would reset on every cold
start. The refill-check-consume cycle is a single `INSERT ... ON CONFLICT`, so
it is atomic without a transaction; refill is computed from `now() - updatedAt`
**in SQL**, so skewed instance clocks cannot disagree about a bucket.

`SessionUser` carries `{ id, email, name, handle, isAdmin, balance }`. Sessions
are **database-backed, not JWT**: it costs a query per request, but a ban can
revoke a live session and `isAdmin`/`balance` are never stale. Don't switch to
the JWT strategy without solving both of those.

## Commands

```bash
npm run dev         # dev server
npm test            # 175 tests: lmsr 21, trade 23, apiSchema 22, authPolicy 20,
                    #   apiError 17, rateLimit 16, bans 12, clientIp 12,
                    #   resolve 11, adminMarkets 11, markets 10; needs the DB up
npm run build       # prisma generate + next build
npx tsc --noEmit    # typecheck
npx prisma generate # regenerate the client after editing schema.prisma
npm run db:push     # sync Prisma schema to Postgres
npm run db:seed     # seed demo users + markets
npm run db:studio   # browse the database
```

The trade tests hit real Postgres — a transactional service can't be meaningfully
tested against a fake. They tag every row they create with a per-run prefix and
delete it afterwards, so they're safe to run against the dev database.

### Local Postgres

This machine has Docker but **not** the `compose` plugin, so `docker compose up`
fails. Start the database directly:

```bash
docker run -d --name market-db \
  -e POSTGRES_USER=market -e POSTGRES_PASSWORD=market -e POSTGRES_DB=market \
  -p 5433:5432 -v market-db-data:/var/lib/postgresql/data postgres:16-alpine

docker start market-db   # on subsequent boots
```

Port 5433, not 5432, to avoid clashing with any host Postgres.
`docker-compose.yml` is kept for machines that do have the plugin.

### Node version

This machine runs Node 18.19, which predates `--env-file` (added in 20.6) and
top-level `await` under tsx's CJS output. Hence `src/lib/loadEnv.ts`, and hence
tests use plain static imports. If the machine moves to Node 20+, `loadEnv` can
be dropped in favour of `--env-file=.env` in the `test` and `db:seed` scripts.

## Conventions

- All point balances and share quantities stored as Postgres `Decimal`, never float —
  floats silently lose points on repeated trades. Convert with `.toNumber()` at the
  engine boundary and back through a fixed-precision string on the way in.
- Every trade writes both a `Trade` row and the resulting `Position`/`User.balance`
  update **inside one transaction**. A partial trade must never be possible. In
  practice one trade touches six things — `Market.qYes/qNo`, `Market.volume` and
  `tradeCount`, `Position`, `User.balance`, `Trade`, `PricePoint` — all in that
  one transaction.
- Price history is appended on every trade so each market can render a probability chart.
- Nothing outside `src/lib/trade.ts` writes points or shares. Routes and pages call
  the service; they do not open their own transactions against these tables.
- `Trade` is an immutable ledger: never updated, never deleted.

## Progress

- [x] Project scaffold (`package.json`), deps installed
- [x] `CLAUDE.md`
- [x] LMSR engine (`src/lib/lmsr.ts`) — pricing, cost, budget inversion, payout
- [x] LMSR test suite (`src/lib/lmsr.test.ts`) — 21 tests, all passing
- [x] Prisma schema (users, markets, positions, trades, price history, resolutions)
- [x] Local Postgres running; schema pushed and verified
- [x] `.env.example`, `.gitignore`, `docker-compose.yml`, `tsconfig.json`
- [x] Trade service (`src/lib/trade.ts`) — transactional buy/sell, quoting, marks
- [x] Trade service tests (`src/lib/trade.test.ts`) — 23 tests against real Postgres,
      covering slippage, budget sizing, every rejection path, and concurrency
- [x] Prisma client singleton (`src/lib/db.ts`), `.env` loader for scripts (`src/lib/loadEnv.ts`)
- [x] Auth (Google, open registration, admin from `ADMIN_EMAILS`, ban list enforced)
- [x] Auth tests — `authPolicy.test.ts` (20, pure), `bans.test.ts` (12, real Postgres)
- [x] Next.js app scaffold — layout, `/signin`, home placeholder, `globals.css`
- [x] Google OAuth credentials in `.env`; **sign-up verified end to end** on
      2026-07-29 — real Google account → `User` row with handle `aniket-singh`,
      10,000 points, `isAdmin: true`, plus linked `Account` and `Session` rows
- [x] Rate limiting (`src/lib/rateLimit.ts`, `src/lib/clientIp.ts`) — token bucket
      in Postgres; enforced inside the trade service and in the auth `signIn`
      callback. 28 tests, including that parallel calls cannot exceed the burst.
- [x] Trade API route (`POST /api/trade`) + quote route (`GET /api/quote`),
      with error mapping and request validation. 39 tests; verified live over
      HTTP against a real session on 2026-07-29.
- [x] Tailwind v4 set up; design tokens with automatic light/dark
- [x] Seed script (`prisma/seed.ts`) — 6 markets with simulated trading history
- [x] Market list (card grid) + market detail with probability chart
- [x] Trade form — live quotes, buy by points / sell by shares, error handling
- [x] Settlement engine (`src/lib/resolve.ts`) + 11 tests
- [x] Admin: create market, resolve / void / close early
- [x] Leaderboard (Brier score + minimum settled markets) + portfolio page
- [x] Landing page at `/` with its own warm theme and sign-in / sign-up in the
      header; app routes moved into the `(app)` group; market list now at
      `/markets`; cards lift on hover. Verified in both colour schemes.
- [x] Dashboard life: per-card sparkline (server-rendered SVG) + 24h delta
      chip + category eyebrow + live pulse dot; two-segment YES/NO bar; stats
      strip (`marketStats`) on `/markets`. 10 new pure tests for
      `downsample`/`trailingDelta`. Verified in both colour schemes.
- [ ] **NEXT:** Deploy notes (Vercel + Neon/Supabase)
- [ ] Publish the Google consent screen so open registration is actually open
- [ ] Categories filter on the list page (`listCategories` exists, unused)
- [ ] Prune stale rate-limit buckets on a schedule (`pruneStaleBuckets` exists)

## Notes for future sessions

- The engine is pure and fully tested — **do not** inline LMSR maths anywhere
  else; import from `src/lib/lmsr.ts`.
- `tradeCost` subtracts two large costs, so fill price for sub-0.001-share
  trades is float-noisy. Irrelevant at real trade sizes; don't "fix" it.
- Resolution must be idempotent: paying out twice would mint points from
  nothing. Guard on `Market.status` inside the transaction, not before it.
- Every trade takes a `SELECT ... FOR UPDATE` lock on its Market row before
  reading `qYes`/`qNo`. Postgres' default READ COMMITTED would otherwise let two
  simultaneous trades both read the same state and clobber each other. Resolution
  and any other writer of `q` must take the same lock.
- Balance and share checks are conditional writes (`updateMany` with `gte` in the
  WHERE clause), not read-then-write — the market lock doesn't serialise one user
  trading in two markets at once.
- **LMSR has no bid-ask spread.** Cost is path independent, so buying and
  immediately selling back is exactly break-even, not a small loss. Don't write
  tests or UI copy that assume a round-trip cost.
- `costBasis` is *net* points invested (sells decrement it), per the schema
  comment — not an average-cost basis. It can go negative, and that's correct.
- Trading is refused on two independent conditions: `status !== OPEN`, and
  `closesAt` in the past. There is no job flipping OPEN to CLOSED at the close
  time, so the timestamp check is what actually halts trading.
- Admin rights are re-derived from `ADMIN_EMAILS` on **every** sign-in, so
  removing an address demotes that account at its next login. `isAdmin` in the
  database is a cache of the env var, not the source of truth. An empty or unset
  `ADMIN_EMAILS` grants nobody admin — it is never treated as a wildcard.
- Ban checks canonicalise Gmail addresses (dots stripped, `+tag` dropped), so
  `first.last@gmail.com` and `firstlast@gmail.com` are one ban. Admin grants
  deliberately do **not** canonicalise — a privilege grant should be exact.
- Banning is not deletion. The user row and their trades stay; `Trade` is an
  immutable ledger and the leaderboard has to stay reconstructible.
- **Known sybil gap:** `User.email` is unique on the raw address, so someone can
  register `first.last@gmail.com` *and* `firstlast@gmail.com` as two accounts.
  Closing it needs a canonical-email column with its own unique constraint plus a
  backfill. Deferred, not solved.
- The trade limit is enforced **inside** `buyShares`/`sellShares`, not in the
  route, so a new route cannot forget it. Non-request callers (seed, admin tools)
  pass `skipRateLimit: true`; never set that from a request handler.
- The limiter call sits *outside* `$transaction` on purpose. Inside, it would
  hold the market row lock while doing unrelated work, and a rejected trade would
  roll back the limiter's own bookkeeping.
- `x-forwarded-for` is client-supplied. `clientIp` counts hops from the **right**,
  because only the entries our own edge appended are trustworthy. Raising
  `TRUSTED_PROXY_COUNT` above the real proxy count lets anyone spoof their IP and
  walk past the signup limit.
- Sign-in rate limiting **fails open** when the IP cannot be determined. Bucketing
  every unidentifiable request under one key would let one abuser lock out
  everyone behind an unknown proxy. It logs `[auth] client IP unavailable` —
  if that appears routinely in production, the proxy headers are misconfigured.
- Verified 2026-07-29 that `headers()` does resolve inside the Auth.js `signIn`
  callback (a live sign-in produced a `signin:::1` bucket), so IP-keyed limits
  work there. Don't assume that still holds after a NextAuth major upgrade.
- `RateLimit` rows are keyed by user id but have **no foreign key** to `User`, so
  they survive a user cascade delete. Tests must clear their own buckets.
- A trade that fails *after* passing validation still spends a rate-limit token,
  because the limiter runs before the service checks balances and market state.
  That is intended — otherwise probing for a tradeable market would be free.
- Quotes are advisory and the fill is priced again under the market lock. Never
  accept a cost or share count from the client and trade on it.
- `assertSameOrigin` allows a request with **no** `Origin` header — same-origin
  requests may omit it. The real CSRF defences are the `SameSite=Lax` session
  cookie and CORS preflight on a JSON content type; the origin check is a third
  layer, not the only one.
- There is no `/api/markets`. Pages are server components reading `markets.ts`
  directly; only the trade form needs HTTP, because it runs in the browser.
- **"Sign in" and "Sign up" are the same Google flow.** Auth.js registers an
  unknown Google account on first use, so there is nothing to separate. The
  landing page shows both buttons because visitors look for the one that matches
  their situation, and `?intent=signup` changes only the heading and blurb on
  `/signin`. Don't build a second endpoint for it.
- The landing page renders **real markets**, not mock-ups. A landing page for a
  market that shows invented prices is lying about the one thing the product is.
  It shows the first three OPEN markets and drops the whole section when there
  are none, rather than displaying an empty shelf.
- `STARTING_BALANCE` lives in `marketConstants.ts` and is mirrored by the
  `User.balance` default in `schema.prisma`. Prisma cannot read a TS constant,
  so those two have to be changed together — changing only the constant silently
  affects the profit calculation without changing what new users receive.
- `/signin` wears the **landing** theme, not the app theme, and lives outside
  `(app)` for that reason. It is the far side of the landing page's two buttons,
  and a palette swap mid-flow reads as a broken link. The cost is that reaching
  it from the app header crosses the other way; that was judged the lesser seam,
  since sign-up traffic is the volume case and the app header's Sign in button
  only ever shows to signed-out visitors anyway.
- `actions.ts` sits at `src/app/actions.ts`, not inside `(app)`, because
  `/signin` (outside the group) and `signout-button.tsx` (inside it) both import
  it. Moving it back into `(app)` breaks the sign-in page's import.
- **A client component must never import from a module that touches Prisma or
  `node:fs`** — it drags them into the browser bundle and the build fails with
  `UnhandledSchemeError: node:fs`. That is why `marketConstants.ts` exists and
  has no imports of its own.
- Tailwind's native binary (`@tailwindcss/oxide-linux-x64-gnu`) is missing from
  a plain `npm install` on this machine — a known npm optional-dependency bug.
  If the dev server dies with "Cannot find native binding", reinstall it at the
  version matching `@tailwindcss/oxide`.
- The probability chart uses `type="stepAfter"`, not `monotone`. Prices are flat
  between trades and jump when one lands; a smooth curve draws probabilities the
  market never quoted. The Y axis is pinned to 0–100% for the same reason —
  auto-scaling makes a 48→52% drift look like a collapse.
- The card **sparkline** (`Sparkline.tsx`) is stepAfter too, but its Y window is
  **floored, not pinned**: fitted to the data, never narrower than 30pp. A hard
  0–100 pin in a 32px box renders every real move as a ~5px wiggle (tried it —
  looks dead); naive auto-fit is the drama inflation the pin exists to prevent.
  The floor bounds exaggeration at ~3×. Its X axis spans first trade → last
  trade, *not* → now: padding to "now" was also tried, and it crushes the whole
  path into the left edge as soon as a market goes quiet for a few days.
- **The yes/no pair fails strict CVD checks** — deutan ΔE ≈ 6 (light) and ≈ 4.6
  (dark) between `--yes` and `--no`, per the dataviz palette validator. Usable
  only because hue is never the sole encoding, so keep it that way: the bar has
  fixed order (YES left, NO right) matching the labels under it, the 24h chip
  carries an arrow + signed number, probabilities are always written as text.
  Don't add any element where green-vs-rose alone is the answer.
- `listMarkets` fetches price history for **all** listed markets in one query
  and computes `spark`/`delta24h` per market in JS. Fine at this scale; if the
  PricePoint table gets heavy the fix is a windowed query or a cached spark
  column on Market — never an N+1 per card.
- The live pulse dot (`.pulse-dot`) breathes at 2.4s — slow enough that the eye
  doesn't track it involuntarily. Reduced-motion turns it off. It renders only
  on tradeable markets (`isTradeable`), not merely OPEN-status ones.
- Seeding a market whose `closesAt` is already past requires creating it with a
  future close time, trading, *then* moving the clock back. The trade service
  correctly refuses trades on an expired market.
- Leaderboard ranking needs `MIN_SETTLED_FOR_RANK` settled markets, so with
  fresh seed data everyone is legitimately unranked. That is the anti-farming
  rule working, not a bug.
- If `next dev` reports "Port 3000 is in use" and falls back to 3001, sign-in
  will break: the Google redirect URI and `NEXTAUTH_URL` are both pinned to
  3000. Free the port rather than working on 3001.

## Status

Started 2026-07-28. The engine, data model, trade service and auth are done and
tested — 76 tests, `tsc --noEmit` clean, `next build` succeeds. As of 2026-07-29
**a real Google account can sign up and land in Postgres with the right handle,
balance and admin flag** — verified in a browser, not just in tests.

Before deploying: the Google consent screen is still in **Testing** mode, so only
listed test users can sign in. "Open registration" is not actually open until it
is published. The OAuth app is also named "Trading" on the consent screen rather
than "Prediction Market". Production needs `NEXTAUTH_URL` updated and a second
authorised redirect URI for the deployed domain.

**The MVP is complete and working end to end.** 165 tests, `tsc --noEmit` clean,
`next build` succeeds. Verified in a browser on 2026-07-29: signed in with a real
Google account, created a market through the admin UI, bought and sold through
the trade form (balance, price, chart, position and leaderboard all updated),
and resolved a market with a sourced reason that paid out 481 points.

Everything in the original scope — trading, pricing, resolution, leaderboard — is
done. What remains before this can be shared publicly:

1. **Publish the Google consent screen.** It is still in Testing mode, so only
   listed test users can sign in. "Open registration" is not actually open yet.
2. **Deploy** (Vercel + Neon/Supabase), with `NEXTAUTH_URL` and a second
   authorised redirect URI for the real domain.
3. Rename the OAuth app from "Trading" to "Prediction Market" — it is what users
   see on the consent screen.
