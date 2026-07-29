import { currentUser } from "@/lib/auth";
import { getLeaderboard, MIN_SETTLED_FOR_RANK } from "@/lib/leaderboard";
import { formatPoints } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Leaderboard" };

export default async function LeaderboardPage() {
  const [entries, user] = await Promise.all([getLeaderboard(), currentUser()]);

  const ranked = entries.filter((e) => e.rank !== null);
  const unranked = entries.filter((e) => e.rank === null);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Ranked by net worth — points in hand plus what open positions would fetch if
          sold now. You need {MIN_SETTLED_FOR_RANK} settled markets to be ranked, so a
          single lucky bet doesn&rsquo;t put anyone on top.
        </p>
      </header>

      {ranked.length === 0 && unranked.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          Nobody has traded yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <Th className="w-12">#</Th>
                <Th>Trader</Th>
                <Th align="right">Net worth</Th>
                <Th align="right">Profit</Th>
                <Th align="right" title="Mean squared error of their stated probabilities. Lower is better.">
                  Brier
                </Th>
                <Th align="right">Settled</Th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((entry) => (
                <Row key={entry.userId} entry={entry} isYou={entry.userId === user?.id} />
              ))}

              {unranked.length > 0 && (
                <tr className="border-t border-border bg-page/60">
                  <td colSpan={6} className="px-3 py-2 text-xs text-muted">
                    Not yet ranked — fewer than {MIN_SETTLED_FOR_RANK} settled markets
                  </td>
                </tr>
              )}

              {unranked.map((entry) => (
                <Row key={entry.userId} entry={entry} isYou={entry.userId === user?.id} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted">
        <strong className="font-medium text-fg">Brier score</strong> measures whether
        someone was actually right, not whether they got paid. It is the average squared
        gap between the probability their trades implied and what really happened, so 0 is
        perfect and 0.25 is what you get by always guessing 50%. Being confidently wrong
        is punished harder than being unsure.
      </p>
    </div>
  );
}

function Row({
  entry,
  isYou,
}: {
  entry: Awaited<ReturnType<typeof getLeaderboard>>[number];
  isYou: boolean;
}) {
  return (
    <tr
      className={`border-b border-border last:border-0 ${isYou ? "bg-accent/5" : ""}`}
    >
      <Td className="tabular text-muted">{entry.rank ?? "—"}</Td>
      <Td>
        <span className="font-medium">{entry.handle}</span>
        {isYou && <span className="ml-2 text-xs text-accent">you</span>}
      </Td>
      <Td align="right" className="tabular font-medium">
        {formatPoints(entry.netWorth)}
      </Td>
      <Td
        align="right"
        className={`tabular ${entry.profit > 0 ? "text-yes" : entry.profit < 0 ? "text-no" : "text-muted"}`}
      >
        {entry.profit > 0 ? "+" : ""}
        {formatPoints(entry.profit)}
      </Td>
      <Td align="right" className="tabular text-muted">
        {entry.brier === null ? "—" : entry.brier.toFixed(3)}
      </Td>
      <Td align="right" className="tabular text-muted">
        {entry.settledMarkets}
      </Td>
    </tr>
  );
}

function Th({
  children,
  align = "left",
  className = "",
  title,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  title?: string;
}) {
  return (
    <th
      scope="col"
      title={title}
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : ""} ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>
      {children}
    </td>
  );
}
