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
| `src/lib/db.ts` | Prisma client singleton (hot-reload safe). |
| `src/lib/loadEnv.ts` | Reads `.env` for scripts run outside Next. No-op under Next. |
| `prisma/schema.prisma` | Data model. |

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

## Commands

```bash
npm run dev         # dev server
npm test            # engine (21) + trade service (23) = 44 tests; needs the DB up
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
- [ ] **NEXT:** Auth (Google, open registration, admin from `ADMIN_EMAILS`, ban list enforced)
- [ ] Rate limiting on trades and sign-ups
- [ ] Trade API route
- [ ] Market list + market detail pages with probability chart
- [ ] Admin: create market, resolve market (writes `Resolution`, pays out)
- [ ] Leaderboard + portfolio page
- [ ] Seed script (`prisma/seed.ts`)
- [ ] Deploy notes (Vercel + Neon/Supabase)

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
- No `src/app` yet — the Next.js app directory does not exist. The first UI or
  API work has to scaffold it.
- The project is not a git repository yet.

## Status

Started 2026-07-28. The engine, data model and trade service are done and
verified against a real database — the whole write path from a share count to a
committed transaction works and is tested, including under concurrent load.
Nothing is wired to HTTP yet; the next piece is auth, then the trade API route
that exposes `buyShares`/`sellShares` to the browser.
