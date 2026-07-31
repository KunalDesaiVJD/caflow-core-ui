/**
 * classificationUtils
 * ────────────────────────────────────────────────────────────────────────────
 * Single source of truth for "what was this client's classification in FY X?"
 *
 * Resolution order (first hit wins):
 *   1. `client_classification_history` — the most recent transition whose
 *      `effective_from_fy <= targetFY`. This is what makes past FYs immutable
 *      and future FYs inherit the latest change.
 *   2. `client_fy_classifications` — the per-FY snapshot row (used when no
 *      history change covers this FY but a per-FY value was set directly,
 *      e.g. during initial client creation).
 *   3. `clients.classification` — the live "current" value, as a last resort.
 *   4. Hard fallback: `'Non-Audit'`.
 *
 * IMPORTANT: do not bypass this function when deciding eligibility for a
 * specific FY (audit pipeline, engagement creation, IT-returns scoping, etc.).
 * Reading `client.classification` directly is FY-blind and will misclassify
 * past engagements after the user changes a client's classification.
 *
 * Notes:
 *  - `client_classification_history` isn't in the generated Supabase types
 *    yet, hence the `(supabase as any)` casts.
 *  - FY values are Indian-format strings (`"2025-26"`). String `<=` comparison
 *    on this format is correct because the prefix is a 4-digit year.
 */
import { supabase } from "@/integrations/supabase/client";

export type Classification =
  | "Audit"
  | "Non-Audit"
  | "Non-Audit (BP)"
  | "Partner in Audited Firm"
  | "Not Applicable"
  | string; // tolerate legacy / freeform values

/**
 * Resolve the classification that was in effect for `clientId` during `targetFY`.
 *
 * @param clientId  UUID of the client
 * @param targetFY  Indian FY string, e.g. "2025-26"
 * @returns  the resolved classification, never null (defaults to "Non-Audit")
 */
export async function getClassificationForFY(
  clientId: string,
  targetFY: string,
): Promise<Classification> {
  if (!clientId || !targetFY) return "Non-Audit";

  // ── RESOLUTION ORDER REVISED (2026-06-05) ────────────────────────────
  //
  // Previous order was: history → fy_snapshot → client.classification.
  // This caused AMBICA PLASTIC INDUSTRIES to be blocked from creating a
  // new engagement: the history table had a stale "Non-Audit" row for FY
  // 2025-26 (from a previous temporary switch), but the user had already
  // corrected it in the Audit Setup UI which writes to
  // client_fy_classifications. The history row was never updated, so it
  // won over the corrected value and returned "Non-Audit".
  //
  // New order: fy_snapshot FIRST (it's the user-editable per-FY value
  // from the Audit Setup UI), then history as fallback for FYs where no
  // explicit snapshot exists, then client.classification as last resort.
  // This ensures the UI-set value always wins, and stale history can't
  // block engagement creation after the user has corrected it.
  //
  // 1. Per-FY snapshot row (from Audit Setup UI — user-editable, authoritative)
  const { data: fyClass } = await (supabase as any)
    .from("client_fy_classifications")
    .select("classification")
    .eq("client_id", clientId)
    .eq("financial_year", targetFY)
    .maybeSingle();

  if (fyClass?.classification) return fyClass.classification as Classification;

  // 2. Most recent history transition active on/before targetFY (fallback
  //    for FYs where no explicit snapshot was set)
  try {
    const { data: history } = await (supabase as any)
      .from("client_classification_history")
      .select("new_classification, effective_from_fy")
      .eq("client_id", clientId)
      .lte("effective_from_fy", targetFY)
      .order("effective_from_fy", { ascending: false })
      .limit(1);

    if (Array.isArray(history) && history.length > 0 && history[0]?.new_classification) {
      return history[0].new_classification as Classification;
    }
  } catch (err) {
    // History table may not exist yet — fall through silently.
    console.warn("[classificationUtils] history lookup failed:", (err as any)?.message ?? err);
  }

  // 3. Live "current" value on the client row
  const { data: client } = await (supabase as any)
    .from("clients")
    .select("classification")
    .eq("id", clientId)
    .maybeSingle();

  return (client?.classification as Classification) || "Non-Audit";
}

/**
 * Batch variant: resolve classifications for many clients in one round-trip
 * per table (3 queries total instead of N×3). Useful for list views like the
 * audit pipeline where we'd otherwise N+1 the DB.
 *
 * Returns a Map keyed by clientId. Clients with no resolvable classification
 * fall back to "Non-Audit".
 */
export async function getClassificationsForFY(
  clientIds: string[],
  targetFY: string,
): Promise<Map<string, Classification>> {
  const result = new Map<string, Classification>();
  if (clientIds.length === 0 || !targetFY) return result;

  const remaining = new Set(clientIds);

  // 1. History — pick the most recent transition per client where effective_from_fy <= targetFY
  try {
    const { data: history } = await (supabase as any)
      .from("client_classification_history")
      .select("client_id, new_classification, effective_from_fy")
      .in("client_id", clientIds)
      .lte("effective_from_fy", targetFY)
      .order("effective_from_fy", { ascending: false });

    if (Array.isArray(history)) {
      for (const row of history) {
        if (!result.has(row.client_id)) {
          result.set(row.client_id, row.new_classification as Classification);
          remaining.delete(row.client_id);
        }
      }
    }
  } catch (err) {
    console.warn("[classificationUtils] batch history lookup failed:", (err as any)?.message ?? err);
  }

  // 2. Per-FY snapshot for clients still unresolved
  if (remaining.size > 0) {
    const { data: fyRows } = await (supabase as any)
      .from("client_fy_classifications")
      .select("client_id, classification")
      .in("client_id", Array.from(remaining))
      .eq("financial_year", targetFY);

    if (Array.isArray(fyRows)) {
      for (const row of fyRows) {
        if (row.classification) {
          result.set(row.client_id, row.classification as Classification);
          remaining.delete(row.client_id);
        }
      }
    }
  }

  // 3. Live current value for whoever's still missing
  if (remaining.size > 0) {
    const { data: clients } = await (supabase as any)
      .from("clients")
      .select("id, classification")
      .in("id", Array.from(remaining));

    if (Array.isArray(clients)) {
      for (const c of clients) {
        result.set(c.id, (c.classification as Classification) || "Non-Audit");
        remaining.delete(c.id);
      }
    }
  }

  // 4. Hard fallback
  for (const id of remaining) result.set(id, "Non-Audit");

  return result;
}

/**
 * Convert an Indian Assessment Year string (e.g. "2026-27") to its
 * corresponding Financial Year (e.g. "2025-26"). Useful for IT Returns
 * lookups where the UI exposes AY but classification is keyed by FY.
 */
export function ayToFy(ay: string): string {
  const m = ay.match(/^(\d{4})-(\d{2})$/);
  if (!m) return ay;
  const start = parseInt(m[1]) - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}
