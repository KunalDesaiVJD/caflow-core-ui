/**
 * auditEngagementSync
 *
 * Keeps `audit_engagements.audit_type` consistent with a client's audit-setup
 * applicability flags after the user edits Audit Setup.
 *
 * Background: an engagement's `audit_type` was set once at creation and never
 * reconciled. So if a client had a `tax_audit` engagement and the user later
 * unticks Tax Audit, the engagement still showed `tax_audit`. Calling
 * reconcileEngagementAuditType() right after saving audit setup fixes that.
 *
 * Safety rules (deliberate — this runs on every Audit Setup save and the
 * underlying flag data can be incomplete):
 *  - If NEITHER statutory nor tax applies, do nothing (never nuke all the
 *    client's engagements off a possibly-incomplete save).
 *  - Never create engagements here.
 *  - A "both" engagement is converted down to the single remaining type.
 *  - A dedicated single-type engagement whose type no longer applies is:
 *      • archived if a correct engagement for the remaining type already
 *        exists (avoids leaving a stale duplicate — the SWADESHI case), or
 *      • converted to the remaining type if it's the only one (so the client
 *        isn't left without an engagement).
 *  - PY-shell comparative engagements are never touched.
 */
import { supabase } from "@/integrations/supabase/client";

export type MainAuditType = "both" | "statutory" | "tax_audit";

/** Derive the main engagement audit_type from the statutory/tax flags. */
export function deriveMainAuditType(
  statutory: boolean | null | undefined,
  tax: boolean | null | undefined,
): MainAuditType | null {
  if (statutory && tax) return "both";
  if (statutory) return "statutory";
  if (tax) return "tax_audit";
  return null;
}

export async function reconcileEngagementAuditType(
  clientId: string,
  financialYear: string | null | undefined,
  statutory: boolean | null | undefined,
  tax: boolean | null | undefined,
): Promise<void> {
  if (!clientId || !financialYear) return;
  const statApplies = !!statutory;
  const taxApplies = !!tax;
  // Safety: don't touch engagements when neither main audit type applies.
  if (!statApplies && !taxApplies) return;

  try {
    const { data: engs } = await (supabase as any)
      .from("audit_engagements")
      .select("id, audit_type")
      .eq("client_id", clientId)
      .eq("financial_year", financialYear)
      .neq("status", "archived")
      .in("audit_type", ["statutory", "tax_audit", "both"])
      .or("is_py_shell.is.null,is_py_shell.eq.false");

    const list: { id: string; type: string }[] = (engs || []).map((e: any) => ({ id: e.id, type: e.audit_type }));
    if (list.length === 0) return;

    const covers = (t: "statutory" | "tax_audit") => list.some(e => e.type === t || e.type === "both");

    const setType = (id: string, type: MainAuditType) =>
      (supabase as any).from("audit_engagements").update({ audit_type: type }).eq("id", id);
    const archive = (id: string) =>
      (supabase as any).from("audit_engagements").update({ status: "archived" }).eq("id", id);

    for (const e of list) {
      if (e.type === "both") {
        if (statApplies && taxApplies) continue;            // still both
        const remaining = deriveMainAuditType(statApplies, taxApplies);
        if (remaining && remaining !== "both") await setType(e.id, remaining);
      } else if (e.type === "tax_audit" && !taxApplies) {
        // tax dropped; statutory must apply (we returned early otherwise)
        if (covers("statutory")) await archive(e.id);       // a statutory eng already exists → archive the stale one
        else await setType(e.id, "statutory");              // only engagement → convert
      } else if (e.type === "statutory" && !statApplies) {
        if (covers("tax_audit")) await archive(e.id);
        else await setType(e.id, "tax_audit");
      }
    }
  } catch (err) {
    // Non-fatal: setup is already saved; engagement sync is best-effort.
    console.error("[auditEngagementSync] reconcile failed:", err);
  }
}
