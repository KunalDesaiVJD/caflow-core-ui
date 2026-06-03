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
 *  - **NEVER archive** — auto-archive was the root cause of 42 engagements
 *    silently disappearing from the AuditIntelligence dropdown for months.
 *    Many clients legitimately have BOTH a statutory eng AND a tax-audit eng
 *    for the same FY, even when the setup row only ticks one box (user adds
 *    the second engagement manually from AuditIntelligence). Auto-archiving
 *    the "extra" one based on the setup checkboxes destroyed real audit work
 *    over and over again. Archive is now an EXPLICIT user action only
 *    (firm_admin or superadmin delete from AuditIntelligence).
 *  - A "both" engagement is converted down to the single remaining type.
 *  - A dedicated single-type engagement is converted to the remaining type
 *    ONLY when it is the sole engagement for that client+FY (so the client
 *    isn't left without an engagement). If another engagement already covers
 *    the remaining type, we leave the stale one alone — it's the user's call
 *    whether to delete it via AuditIntelligence.
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

/**
 * Ensure a client_fy_audit_setup row exists for the engagement's client+FY,
 * derived from the engagement's audit_type. Called right after an engagement
 * is created so a new engagement never leaves an FY-scoped applicability gap
 * (which is what made the Audit Status grid fall back to engagement_type).
 *
 * Never overwrites an existing setup row — only fills a missing one.
 */
export async function ensureAuditSetupForEngagement(
  clientId: string,
  financialYear: string | null | undefined,
  auditType: string | null | undefined,
): Promise<void> {
  if (!clientId || !financialYear) return;
  try {
    const { data: existing } = await (supabase as any)
      .from("client_fy_audit_setup")
      .select("client_id")
      .eq("client_id", clientId)
      .eq("financial_year", financialYear)
      .limit(1);
    if (existing && existing.length > 0) return; // already has a setup row — don't clobber
    const t = (auditType || "").toLowerCase();
    await (supabase as any).from("client_fy_audit_setup").insert({
      client_id: clientId,
      financial_year: financialYear,
      statutory_audit_applicable: t === "statutory" || t === "both",
      tax_audit_applicable:       t === "tax_audit" || t === "both",
      caro_applicable:            false,
      internal_audit_applicable:  t === "internal",
      stock_audit_applicable:     t === "stock",
    });
  } catch (err) {
    console.error("[auditEngagementSync] ensure setup failed:", err);
  }
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

    for (const e of list) {
      if (e.type === "both") {
        if (statApplies && taxApplies) continue;            // still both
        const remaining = deriveMainAuditType(statApplies, taxApplies);
        if (remaining && remaining !== "both") await setType(e.id, remaining);
      } else if (e.type === "tax_audit" && !taxApplies) {
        // Tax flag turned off but a tax engagement exists. Only convert if
        // it is the SOLE engagement (so the client isn't left without one);
        // otherwise leave it alone. We NEVER auto-archive — that's a user-
        // initiated action via AuditIntelligence delete. See file header.
        if (!covers("statutory")) await setType(e.id, "statutory");
      } else if (e.type === "statutory" && !statApplies) {
        if (!covers("tax_audit")) await setType(e.id, "tax_audit");
      }
    }
  } catch (err) {
    // Non-fatal: setup is already saved; engagement sync is best-effort.
    console.error("[auditEngagementSync] reconcile failed:", err);
  }
}
