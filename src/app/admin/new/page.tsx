import Link from "next/link";

import { currentUser } from "@/lib/auth";
import { Forbidden } from "@/components/Forbidden";
import { NewMarketForm } from "./NewMarketForm";

export const dynamic = "force-dynamic";

export default async function NewMarketPage() {
  // Presentation only — `createMarketAction` re-checks admin server-side.
  const user = await currentUser();
  if (!user?.isAdmin) return <Forbidden signedIn={Boolean(user)} />;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link href="/admin" className="text-sm text-muted transition-colors hover:text-fg">
        ← Admin
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">New market</h1>
        <p className="text-sm leading-relaxed text-muted">
          Once people have traded, the rules cannot be rewritten without making the
          resolution unfair. Write them as if you will have to defend the outcome to
          somebody who lost points on it.
        </p>
      </header>

      <NewMarketForm />
    </div>
  );
}
