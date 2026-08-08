"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import { createMarket, editMarket, deleteMarket, CreateMarketError } from "@/lib/adminMarkets";
import { closeMarket, resolveMarket, voidMarket, ResolveError } from "@/lib/resolve";

/**
 * Admin server actions.
 *
 * Every one of these re-checks `requireAdmin()` on the server. A server action
 * is a real HTTP endpoint — hiding the button from non-admins in the UI is
 * presentation, not authorisation, and anyone can invoke the action directly.
 */

export interface ActionState {
  error?: string;
  /** Which form field the error belongs to, when it maps to one. */
  field?: string;
  ok?: string;
}

/**
 * Turn a thrown domain error into something a form can render, and let anything
 * unexpected propagate to the error boundary rather than being flattened into a
 * misleading message.
 */
function toState(err: unknown): ActionState {
  if (err instanceof CreateMarketError) return { error: err.message, field: err.field };
  if (err instanceof ResolveError) return { error: err.message };
  throw err;
}

export async function createMarketAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  let slug: string;
  try {
    const closesAtRaw = String(formData.get("closesAt") ?? "");
    const closesAt = new Date(closesAtRaw);
    if (Number.isNaN(closesAt.getTime())) {
      return { error: "Pick a valid close date and time.", field: "closesAt" };
    }

    const liquidityRaw = String(formData.get("b") ?? "500");
    const b = Number(liquidityRaw);

    const market = await createMarket(
      {
        question: String(formData.get("question") ?? ""),
        rules: String(formData.get("rules") ?? ""),
        category: String(formData.get("category") ?? "") || null,
        closesAt,
        b,
        creatorId: admin.id,
      },
    );
    slug = market.slug;
  } catch (err) {
    return toState(err);
  }

  // Outside the try: `redirect` works by throwing, so catching around it would
  // swallow the navigation and report it as an error.
  revalidatePath("/");
  revalidatePath("/admin");
  redirect(`/markets/${slug}`);
}

export async function editMarketAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  let slug: string;
  try {
    const closesAtRaw = String(formData.get("closesAt") ?? "");
    const closesAt = new Date(closesAtRaw);
    if (Number.isNaN(closesAt.getTime())) {
      return { error: "Pick a valid close date and time.", field: "closesAt" };
    }

    const b = Number(String(formData.get("b") ?? "500"));

    const market = await editMarket({
      marketId: String(formData.get("marketId") ?? ""),
      question: String(formData.get("question") ?? ""),
      rules: String(formData.get("rules") ?? ""),
      category: String(formData.get("category") ?? "") || null,
      closesAt,
      b,
    });
    slug = market.slug;
  } catch (err) {
    return toState(err);
  }

  // Outside the try: `redirect` throws to navigate, so catching it here would
  // swallow the navigation and report it as an error.
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(`/markets/${slug}`);
  redirect(`/markets/${slug}`);
}

export async function deleteMarketAction(formData: FormData): Promise<void> {
  await requireAdmin();
  await deleteMarket(String(formData.get("marketId") ?? ""));
  revalidatePath("/");
  revalidatePath("/admin");
}

export async function resolveMarketAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const marketId = String(formData.get("marketId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const reason = String(formData.get("reason") ?? "");

  try {
    if (outcome === "VOID") {
      const result = await voidMarket({ marketId, reason, resolvedById: admin.id });
      revalidatePath("/");
      revalidatePath("/admin");
      return { ok: `Voided. ${result.totalPaidOut} points refunded to ${result.paidUsers} traders.` };
    }

    if (outcome !== "YES" && outcome !== "NO") {
      return { error: "Choose YES, NO, or void." };
    }

    const result = await resolveMarket({ marketId, outcome, reason, resolvedById: admin.id });
    revalidatePath("/");
    revalidatePath("/admin");
    return {
      ok: `Resolved ${outcome}. ${result.totalPaidOut} points paid to ${result.paidUsers} traders.`,
    };
  } catch (err) {
    return toState(err);
  }
}

export async function closeMarketAction(formData: FormData): Promise<void> {
  await requireAdmin();
  await closeMarket(String(formData.get("marketId") ?? ""));
  revalidatePath("/");
  revalidatePath("/admin");
}
