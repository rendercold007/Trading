# Outcome

**Outcome** is an open, publicly registerable prediction market — Polymarket/Kalshi mechanics at
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
| Auth | **Google sign-in** *and* **email/password**, via NextAuth, **open registration** — anyone with the link can create an account | Two ways in, one account per email. Email/password is guarded by hCaptcha + IP rate limiting to replace the multi-accounting friction that Google-only used to provide on its own. |
| Resolution | **Admin resolves**, with a public audit log and a mandatory sourced reason | Simple and fast. With strangers trading, the audit trail stops being a nicety — the sourced reason is what makes a resolution defensible. |
| Stack | Next.js + TypeScript + Postgres (Prisma) | Transactional integrity matters for a market engine; Postgres gives it. |
| Scope | Working MVP first, polish after | Trading, pricing, resolution, leaderboard end to end. |

## Open registration changes the risk profile

**Points must stay points.** A publicly registerable site where strangers' points
convert to money — even informally, even if the app never touches a rupee — is what
India's Promotion and Regulation of Online Gaming Act 2025 targets; it criminalises
*offering, facilitating, advertising, and payment-processing* for real-money gaming,
and "facilitating" is broad enough to reach a platform that runs the odds and lets
users settle outside it. So: **no cash-out path, no advertised exchange rate, no
official settle-up mechanism, no prize pool.** The leaderboard is the prize. If real
money ever enters the picture, that is a lawyer conversation, not a code change.

**Anonymous users behave differently from friends.** Design for it:

- **Multi-accounting.** Fresh accounts start with 10,000 points, so the leaderboard
  is farmable by registering repeatedly and keeping the lucky accounts. Mitigations:
  hCaptcha and per-IP signup rate limiting on the email/password path (Google's own
  friction covers the Google path), rank by Brier score rather than raw points, and
  require a minimum number of resolved markets before a user is ranked. Email/password
  lowers the bar to a new account versus Google-only, which is exactly why the captcha
  and the harsh `signup` bucket (3 per IP, then 1/hour) sit in front of it.
- **Market manipulation.** LMSR makes pushing the price self-punishing (they eat the
  slippage) — a real argument for the AMM over an order book here.
- **Spam and abuse.** Hence admin-only market creation and rate limiting.
- **Sybil-resistant seeding.** Never hand out points beyond the initial balance; no
  referral bonuses.

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
| `src/lib/authPolicy.ts` | Pure auth policy: admin list parsing, handle slugs, email canonicalisation, email/password validation. |
| `src/lib/password.ts` | scrypt password hashing (Node `crypto`, no deps). Pure, `hashPassword`/`verifyPassword`. |
| `src/lib/captcha.ts` | Server-side hCaptcha `siteverify`. Skips when no secret set; injectable `fetch`. |
| `src/lib/session.ts` | Mints a database `Session` row + the Auth.js cookie, for the email/password flow. |
| `src/lib/handles.ts` | `assignHandle` — unique leaderboard handle assignment, shared by both signup paths. |
| `src/lib/credentials.ts` | Email/password register/sign-in service: `registerCredentials`, `signInCredentials`. Reuses ban/rate-limit/admin gates. |
| `src/lib/bans.ts` | Deny list: `isBanned`, `banEmail`, `unbanEmail`. No NextAuth dependency. |
| `src/lib/rateLimit.ts` | Token-bucket limiter over Postgres, plus the tuned policies. |
| `src/lib/clientIp.ts` | Spoof-resistant client IP for IP-keyed limits. |
| `src/lib/auth.ts` | NextAuth wiring + `currentUser` / `requireUser` / `requireAdmin`. |
| `src/lib/db.ts` | Prisma client singleton (hot-reload safe). |
| `src/lib/loadEnv.ts` | Reads `.env` for scripts run outside Next. No-op under Next. |
| `src/lib/resolve.ts` | Settlement: `resolveMarket`, `voidMarket`, `closeMarket`. Pays out. |
| `src/lib/adminMarkets.ts` | `createMarket`, `editMarket`, `deleteMarket` + `slugify`. Admin-only by policy. Edit/delete only while `tradeCount === 0`. |
| `src/lib/markets.ts` | **Read-only** market queries for the UI. Decimal→number here. |
| `src/lib/leaderboard.ts` | Leaderboard ranking and portfolio aggregates. |
| `src/lib/format.ts` | Display formatting. Presentational rounding only. |
| `src/lib/marketConstants.ts` | Values shared with client components. **No imports** — see below. |
| `src/lib/apiSchema.ts` | Parses untrusted request bodies/queries into typed values. |
| `src/lib/apiError.ts` | Maps thrown errors to HTTP status codes; origin check. |
| `src/app/layout.tsx` | Document shell only — `<html>`/`<body>`. No header, deliberately. |
| `src/app/page.tsx` | Landing page. Outside `(app)`, so it gets none of the app chrome. |
| `src/app/signin/` | Sign in / sign up. Outside `(app)`, so it gets the minimal header. |
| `src/app/actions.ts` | `signInAction` (Google) / `signOutAction` / `credentialsAction` (email+password). Shared across both groups. |
| `src/components/SignInForm.tsx` | Client component: email/password fields, hCaptcha widget, inline errors via `useActionState`. |
| `src/app/signin/reset/` | "Forgot password?" — honest placeholder; no email infra exists to send a reset link. |
| `src/app/(app)/layout.tsx` | The signed-in chrome: header, balance, nav, footer. |
| `src/app/` | Next app router — see routes below. |
| `src/components/` | Shared UI: `MarketCard`, `DeltaChip`, `ProbabilityBar`, `ProbabilityChart`, `Sparkline`, `StatusPill`, `TradeForm`. |
| `prisma/seed.ts` | Demo markets with simulated trading history. |
| `prisma/schema.prisma` | Data model. |

### Routes

| Path | What |
|---|---|
| `/` | **Landing page.** The pitch. Redirects to `/markets` if signed in. |
| `/markets` | Market list (card grid), `?category=` filter. Readable signed out. Home once you have an account. |
| `/markets/[slug]` | Detail: chart, rules, trade ticket, your position, activity. `?side=YES\|NO` preselects the ticket. |
| `/leaderboard` | Ranked traders. Public. |
| `/portfolio` | Your holdings, marked to market. Requires sign-in. |
| `/admin`, `/admin/new`, `/admin/edit/[slug]` | Create, edit (zero-trade only), settle markets. Admin only. |
| `/signin` | Google **and** email/password sign-in / sign-up. `?intent=signup` changes the wording and which credentials path runs. |
| `/signin/reset` | "Forgot password?" placeholder — reset by email is not wired (no mail sender exists). |

`/` and `/signin` sit outside the `(app)` route group, so they render without the
app chrome; everything else lives inside `(app)`. They share the one palette —
what differs between the two groups is the header, not the colours. See "Two
layouts" below.

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
editMarket({ marketId, question, rules, category, closesAt, b })  // zero-trade only
deleteMarket(marketId)                                      // zero-trade only; cascades
```

Failures throw `ResolveError` / `CreateMarketError` with a `code`.
`editMarket`/`deleteMarket` are the escape hatch for a setup mistake: both take
the same `FOR UPDATE` lock as settlement and refuse once `tradeCount > 0`
(`MARKET_HAS_TRADES`), because a market's question, rules and close date are the
terms of a bet — frozen the moment anyone trades. Edit additionally requires
status `OPEN` (`MARKET_NOT_EDITABLE`) and keeps the slug (the permanent URL).
The UI surfaces Edit/Delete on the admin dashboard only for zero-trade markets. Settlement
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
- **One palette, everywhere.** The landing page used to re-declare the tokens
  under a `.landing` class as warm paper, serif and burnt orange. That override
  is gone: the pitch and the app now share the same near-black surfaces, YES
  green, NO red and blue accent, because crossing from `/` into `/markets` used
  to read as landing on a different site. Don't reintroduce a per-surface
  theme; style everything with the same utilities and never reach for
  hard-coded hex.
- **Three colour axes, three sets of tokens, kept separate on purpose.**
  `--yes`/`--no` are the *outcome* (green/red). `--gain`/`--loss` are *profit
  and loss* — a different thing, since a gain on a NO position is still a gain.
  `--chart` is the blue every price path is drawn in: the chart line, its
  gradient, and the card sparklines. The chart is deliberately **not** YES
  green — a green line reads as "the YES side is winning" whichever way it
  points, and the probability it plots belongs to neither side. `--accent` is
  the same blue, for primary actions. Changing one axis must not silently
  change another.
- **Market cards are `<article>`, not one big `<a>`.** The Yes/No buttons are
  links into `/markets/[slug]?side=…`, which preselects the ticket; an anchor
  cannot contain anchors, so the question carries a stretched
  `after:absolute after:inset-0` link and the buttons sit above it with
  `relative`. The buttons deliberately do **not** trade — committing points
  still happens on the page that shows the rules, never one tap from a
  scrolling list.
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

// Email/password (src/lib/credentials.ts) — the credentials counterpart to the
// Google wiring. Both throw CredentialsError with a .code the sign-in form maps
// to an inline field message. Each mints the session itself (see session.ts).
registerCredentials({ email, password, captchaToken })   // create + sign in
signInCredentials({ email, password, captchaToken })      // verify + sign in
// codes: INVALID_EMAIL, WEAK_PASSWORD, EMAIL_TAKEN, INVALID_CREDENTIALS,
//        USE_GOOGLE, BANNED, CAPTCHA_FAILED, RATE_LIMITED
```

Both credential entry points share one front gate with the Google callback, in
this order: **captcha → rate limit → ban check**. Captcha first so a script
cannot burn another user's IP budget without solving one; ban check last so a
banned user still spends their own token. Admin rights are re-derived from
`ADMIN_EMAILS` on every sign-in for both providers, so the invariant that
"removing an address demotes at next login" holds for password accounts too.

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

This is why email/password does **not** use NextAuth's Credentials provider:
that provider only issues JWT sessions, which would break both guarantees. The
password flow instead verifies the hash itself and writes a real `Session` row —
the same shape the Prisma adapter writes for Google — then sets the exact
`authjs.session-token` cookie Auth.js reads (`src/lib/session.ts`). `auth()`
then treats a password session and a Google session identically. The cookie name
is a hard coupling to `@auth/core`; re-verify it against
`@auth/core/lib/utils/cookie` after any NextAuth major upgrade.

## Commands

```bash
npm run dev         # dev server
npm test            # 201 tests: lmsr 21, trade 23, apiSchema 22, authPolicy 27,
                    #   apiError 17, rateLimit 16, bans 12, clientIp 12,
                    #   resolve 11, adminMarkets 19, markets 10, password 6,
                    #   captcha 5; needs the DB up
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
- **"Sign in" and "Sign up" share one surface, per provider.** For Google there
  is genuinely one flow — Auth.js registers an unknown account on first use, so
  nothing separates them. For email/password `?intent=signup` picks which
  credentials path runs (`registerCredentials` vs `signInCredentials`) but it is
  still the same page and the same form component; the mode rides in a hidden
  `mode` field. The landing page shows both framings because visitors look for
  the one that matches their situation. Don't build separate pages for sign-in
  vs sign-up.
- **hCaptcha guards only the email/password form, not Google.** The widget's
  token is verified server-side in `captcha.ts`; the OAuth redirect is Google's
  own bot problem. With `HCAPTCHA_SECRET` unset the check is skipped and logged
  (local dev), mirroring how `clientIp` fails open — but a *network failure*
  reaching hCaptcha fails **closed**, because there the check was asked for and
  letting it through would defeat the control. `.env` ships hCaptcha's public
  test keys, which always solve; swap them for real ones before deploying.
- **Password reset is not built.** `/signin/reset` is an honest placeholder
  because there is no mail sender anywhere in the app to deliver a reset link
  (there is no SMTP/Resend wiring at all). When one is added, that page becomes a
  token-based reset form; until then it points users at Google or an admin rather
  than faking a flow that goes nowhere.
- **scrypt needs its `maxmem` raised.** At N=2¹⁵/r=8 scrypt wants ~32 MB, which
  is exactly Node's default `maxmem` ceiling, so it throws without the explicit
  `maxmem` in `password.ts`. The verify path computes `maxmem` from the hash's
  own stored parameters, so a hash made under heavier settings still verifies.
- The landing page renders **real markets**, not mock-ups. A landing page for a
  market that shows invented prices is lying about the one thing the product is.
  It shows the first three OPEN markets and drops the whole section when there
  are none, rather than displaying an empty shelf.
- `STARTING_BALANCE` lives in `marketConstants.ts` and is mirrored by the
  `User.balance` default in `schema.prisma`. Prisma cannot read a TS constant,
  so those two have to be changed together — changing only the constant silently
  affects the profit calculation without changing what new users receive.
- `/signin` lives outside `(app)` so it carries the landing's minimal header
  rather than the app chrome — a nav offering Leaderboard and a second "Sign in"
  button is noise on the page whose only job is one button. It is not a palette
  decision; there is only one palette.
- The `?category=` on `/markets` is **validated against `listCategories()`**
  before it is used. An unknown value falls back to showing everything, because
  a stale or hand-edited link that renders an empty grid looks like a broken
  site rather than a bad URL. The tabs are plain links, not a client control, so
  the filter is shareable and works before any JavaScript loads.
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
- The chart's **range control defaults to "All"** on two counts. Most markets
  here are younger than a month, and every other range has to read the clock —
  a `Date.now()` in the server render would disagree with the one at hydration
  and mismatch the SVG. "All" needs no clock, so first paint is deterministic
  and the others only run after a click. A range is offered only when the
  market has more history than it covers; on a young market the control hides
  entirely. "All" spans first trade → last trade, but a *fixed* range pins the
  X domain to `[cutoff, now]` and synthesises two points — one carrying the
  price already in effect when the window opened, one carrying the current
  price forward — because "the last 7 days" that visibly stops three days ago
  is lying about recency.
- The card **sparkline** (`Sparkline.tsx`) is stepAfter too, but its Y window is
  **floored, not pinned**: fitted to the data, never narrower than 30pp. A hard
  0–100 pin in a 32px box renders every real move as a ~5px wiggle (tried it —
  looks dead); naive auto-fit is the drama inflation the pin exists to prevent.
  The floor bounds exaggeration at ~3×. Its X axis spans first trade → last
  trade, *not* → now: padding to "now" was also tried, and it crushes the whole
  path into the left edge as soon as a market goes quiet for a few days.
- **The yes/no pair fails CVD checks** — green against red is the textbook pair
  a deutan or protan viewer cannot separate. It is a deliberate choice (it is
  what a prediction market is expected to look like) and it is only safe because
  hue is never the sole encoding, so keep it that way: the bar has fixed order
  (YES left, NO right) matching the labels beside it, every side button is
  captioned "Yes"/"No" in words, the 24h chip carries an arrow + signed number,
  probabilities are always written as text. Don't add any element where
  green-vs-red alone is the answer. This is also why the chart is blue rather
  than green — see the colour-axes note under UI conventions.
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

**The MVP is complete and working end to end** — trading, pricing, resolution and
leaderboard all verified in a browser, not just in tests. Google **and**
email/password sign-in both verified in a browser (sign-up, sign-out, sign-in
round-trip). 193 tests pass, `tsc --noEmit` is clean, `next build` succeeds.

Remaining, in order:

1. ~~**Publish the Google consent screen.**~~ **Done** — moved from Testing to
   In production (basic scopes only, so no verification review). Anyone with a
   Google account can now sign in via Google.
1b. ~~**Set real hCaptcha keys**~~ **Done** — real `HCAPTCHA_SITEKEY`/
   `HCAPTCHA_SECRET` in `.env`, verified end to end (real widget solves, server
   `siteverify` accepts, account created). **At deploy**, add the production
   domain to the sitekey's Hostnames allowlist in the hCaptcha dashboard, or
   solves fail closed there — `localhost` is already added for local dev.
2. ~~**Rename the OAuth app** from "Trading" to "Outcome".~~ **Done** — renamed
   in the Google consent screen; it is what users see there.
3. **Deploy** (Vercel + Neon/Supabase), with `NEXTAUTH_URL` updated and a second
   authorised redirect URI for the real domain. No deploy notes written yet.
4. Prune stale rate-limit buckets on a schedule (`pruneStaleBuckets` exists,
   called only from its own test).
