/**
 * GET /api/quote — price a hypothetical trade without executing it.
 *
 * Drives the "500 points buys you ~998 shares at 0.501" line in the trade form,
 * so it is called on every keystroke. A GET with no side effects, which keeps it
 * cheap and safe to retry.
 *
 * Quotes are **advisory**. Another trade can land between the quote and the
 * fill, moving the price. The executing route re-prices under the market lock
 * and never trusts a cost sent by the client — this endpoint exists to show a
 * number, not to agree one.
 *
 * Query: ?marketId=&outcome=YES|NO&side=BUY|SELL&shares=  (or &budget= for BUY)
 *
 * Signed-in users only. It reveals nothing secret, but it is a database read
 * per keystroke, so it sits behind the same session check as trading rather
 * than being an open endpoint for anyone to hammer.
 */

import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/apiError";
import { parseQuoteQuery } from "@/lib/apiSchema";
import { quoteTrade } from "@/lib/trade";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireUser();

    const query = parseQuoteQuery(new URL(request.url).searchParams);
    const quote = await quoteTrade(query);

    return Response.json(
      { quote },
      {
        status: 200,
        // A quote is stale the moment anyone else trades. Never cache it.
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
