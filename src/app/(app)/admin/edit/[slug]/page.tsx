import Link from "next/link";
import { notFound } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { getMarketBySlug } from "@/lib/markets";
import { Forbidden } from "@/components/Forbidden";
import { EditMarketForm } from "./EditMarketForm";

export const dynamic = "force-dynamic";

/** `datetime-local` wants local time with no timezone suffix. */
function toDateTimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EditMarketPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Presentation only — `editMarketAction` re-checks admin server-side.
  const user = await currentUser();
  if (!user?.isAdmin) return <Forbidden signedIn={Boolean(user)} />;

  const { slug } = await params;
  const market = await getMarketBySlug(slug);
  if (!market) notFound();

  // Only an open, never-traded market is editable. The server action enforces
  // this too; bouncing here avoids rendering a form that would only be rejected.
  const editable = market.status === "OPEN" && market.tradeCount === 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link href="/admin" className="text-sm text-muted transition-colors hover:text-fg">
        ← Admin
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Edit market</h1>
        <p className="text-sm leading-relaxed text-muted">
          A market can only be edited before anyone has traded it. Once it has trades its
          terms are frozen — editing then would change a bet people already took.
        </p>
      </header>

      {editable ? (
        <EditMarketForm
          marketId={market.id}
          defaults={{
            question: market.question,
            rules: market.rules,
            category: market.category,
            closesAt: toDateTimeLocal(market.closesAt),
            b: market.b,
          }}
        />
      ) : (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          This market can no longer be edited — it{" "}
          {market.tradeCount > 0 ? "already has trades" : "has already closed or settled"}.
        </p>
      )}
    </div>
  );
}
