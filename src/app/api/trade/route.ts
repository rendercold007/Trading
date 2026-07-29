/**
 * POST /api/trade — execute a buy or sell.
 *
 * The handler is deliberately thin. Everything that could corrupt the market —
 * the transaction, the row lock, the balance check, the rate limit — lives in
 * `src/lib/trade.ts` and is enforced there whether or not the caller came
 * through this route. What this file owns is the HTTP contract: authenticate,
 * validate the untrusted body, and turn outcomes into status codes.
 *
 * Request:
 *   { marketId, outcome: "YES"|"NO", side: "BUY"|"SELL", shares? , budget? }
 *
 * Success (200):
 *   { trade: { tradeId, shares, cost, avgPrice, balanceAfter, sharesAfter,
 *              priceYesBefore, priceYesAfter } }
 *
 * Failures: 400 malformed, 401 signed out, 403 cross-origin, 404 no such
 * market, 409 refused (closed / insufficient funds or shares), 429 rate
 * limited (with `Retry-After`), 500 otherwise.
 */

import { requireUser } from "@/lib/auth";
import { assertSameOrigin, errorResponse, readJsonBody } from "@/lib/apiError";
import { parseTradeBody } from "@/lib/apiSchema";
import { buyShares, sellShares } from "@/lib/trade";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);

    // Identity comes from the session cookie, never from the body. A userId
    // field in the request would let anyone trade as anyone.
    const user = await requireUser();

    const body = parseTradeBody(await readJsonBody(request));

    const result =
      body.side === "BUY"
        ? await buyShares({
            userId: user.id,
            marketId: body.marketId,
            outcome: body.outcome,
            shares: body.shares,
            budget: body.budget,
          })
        : await sellShares({
            userId: user.id,
            marketId: body.marketId,
            outcome: body.outcome,
            // `parseSizing` guarantees shares is set for a SELL.
            shares: body.shares!,
          });

    return Response.json({ trade: result }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
