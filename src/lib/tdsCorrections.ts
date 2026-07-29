/**
 * TDS Correction module — shared types + data access.
 *
 * Deliberately ONE implementation used by both the staff module
 * (src/components/tds/TdsCorrectionsModule.tsx) and the client portal
 * (src/pages/PortalCorrections.tsx). Forking this logic per surface is exactly
 * how the TDS stages ended up with three subtly different copies of the same
 * comparison rules; do not copy these functions, import them.
 *
 * Invariant: nothing here EVER writes to tds_challans / tds_deductees. A
 * correction is a separate version of the return — the originally filed Data
 * Entry and Validate & Finalise records must survive untouched for audit.
 */
import { supabase } from "@/integrations/supabase/client";

// ─── Status ─────────────────────────────────────────────────────────────────

export type CorrectionStatus = "draft" | "pending" | "filed" | "rejected";

export const CORRECTION_STATUS_META: Record<CorrectionStatus, {
  label: string; tone: string; description: string;
}> = {
  draft: {
    label: "Draft",
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    description: "Being prepared. Not yet submitted.",
  },
  pending: {
    label: "Pending",
    tone: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    description: "Submitted and awaiting a firm signature.",
  },
  filed: {
    label: "Correction Filed",
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    description: "Signed and filed. Read-only.",
  },
  rejected: {
    label: "Rejected",
    tone: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    description: "Sent back by the firm. See the reason.",
  },
};

/** The single source of truth for "can this still be edited?". */
export const isCorrectionLocked = (status: string | null | undefined) =>
  status === "filed";

// ─── Row shapes ─────────────────────────────────────────────────────────────

export type CorrectionAction = "unchanged" | "add" | "modify" | "delete";

export interface Correction {
  id: string;
  firm_id: string;
  client_id: string;
  financial_year: string;
  quarter: string;
  form_type: string;
  original_filing_id: string | null;
  status: CorrectionStatus;
  reason: string | null;
  raised_by: string | null;
  raised_by_name: string | null;
  raised_by_role: string | null;
  raised_at: string | null;
  submitted_at: string | null;
  signed_by: string | null;
  signed_by_name: string | null;
  signed_by_role: string | null;
  signed_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
}

export interface CorrectionChallan {
  id: string;
  correction_id: string;
  original_challan_id: string | null;
  action: CorrectionAction;
  form_type: string | null;
  bsr_code: string | null;
  challan_serial_no: string | null;
  deposit_date: string | null;
  total_tax_deposited: number | null;
  surcharge_deposited: number | null;
  education_cess_deposited: number | null;
  interest_deposited: number | null;
  others_deposited: number | null;
  late_fees_234e: number | null;
  total_challan_amount: number | null;
  minor_head_of_challan: string | null;
  is_book_entry: boolean | null;
  transfer_voucher_no: string | null;
  cheque_dd_no: string | null;
  bank_name: string | null;
  section_code: string | null;
  challan_remarks: string | null;
}

export interface CorrectionDeductee {
  id: string;
  correction_id: string;
  correction_challan_id: string | null;
  original_deductee_id: string | null;
  action: CorrectionAction;
  form_type: string | null;
  deductee_name: string | null;
  deductee_pan: string | null;
  pan_not_available: boolean | null;
  deductee_ref_no: string | null;
  deductee_type: string | null;
  section_code: string | null;
  nature_of_payment: string | null;
  amount_paid_credited: number | null;
  date_of_payment: string | null;
  date_of_deduction: string | null;
  rate_of_tds: number | null;
  tds_amount: number | null;
  surcharge_amount: number | null;
  cess_amount: number | null;
  total_tax_deducted: number | null;
  interest_amount: number | null;
  late_fees_amount: number | null;
  lower_deduction_certificate_no: string | null;
  lower_deduction_rate: number | null;
  reason_for_lower_or_nil_deduction: string | null;
  country_of_residence: string | null;
  gross_salary: number | null;
  standard_deduction_allowed: number | null;
  net_taxable_salary: number | null;
  designation: string | null;
  remarks: string | null;
}

export interface Actor {
  id: string | null;
  name: string | null;
  role: string | null;
}

// ─── Audit trail ────────────────────────────────────────────────────────────

export async function logCorrectionAction(args: {
  correctionId: string; firmId: string | null; clientId: string;
  actionType: string; detail?: string; oldValue?: string; newValue?: string;
  actor: Actor;
}) {
  // Swallowed on failure, same convention as src/lib/tdsReconAudit.ts: an
  // audit write must never block the user's actual action.
  try {
    await supabase.from("tds_correction_audit_log" as any).insert({
      correction_id: args.correctionId,
      firm_id: args.firmId,
      client_id: args.clientId,
      action_type: args.actionType,
      detail: args.detail ?? null,
      old_value: args.oldValue ?? null,
      new_value: args.newValue ?? null,
      actor_id: args.actor.id,
      actor_name: args.actor.name,
      actor_role: args.actor.role,
    });
  } catch (e) {
    console.warn("[tdsCorrections] audit log write failed", e);
  }
}

// ─── Create + seed ──────────────────────────────────────────────────────────

/** Columns copied verbatim from the filed challan into the correction copy. */
const CHALLAN_COPY_COLS = [
  "form_type", "financial_year", "quarter", "bsr_code", "challan_serial_no",
  "deposit_date", "total_tax_deposited", "surcharge_deposited",
  "education_cess_deposited", "interest_deposited", "others_deposited",
  "total_challan_amount", "late_fees_234e", "minor_head_of_challan",
  "is_book_entry", "transfer_voucher_no", "cheque_dd_no", "bank_name",
  "section_code", "challan_remarks",
] as const;

const DEDUCTEE_COPY_COLS = [
  "form_type", "financial_year", "quarter", "deductee_name", "deductee_pan",
  "pan_not_available", "deductee_ref_no", "deductee_type", "section_code",
  "nature_of_payment", "amount_paid_credited", "date_of_payment",
  "date_of_deduction", "rate_of_tds", "tds_amount", "surcharge_amount",
  "cess_amount", "total_tax_deducted", "interest_amount", "late_fees_amount",
  "lower_deduction_certificate_no", "lower_deduction_rate",
  "reason_for_lower_or_nil_deduction", "country_of_residence", "gross_salary",
  "standard_deduction_allowed", "net_taxable_salary", "designation", "remarks",
] as const;

const pick = (row: any, cols: readonly string[]) => {
  const out: Record<string, any> = {};
  for (const c of cols) if (row[c] !== undefined) out[c] = row[c];
  return out;
};

/**
 * Create a correction for a filed period and SNAPSHOT the filed data into it.
 *
 * Every filed challan and deductee is copied in with action='unchanged', so the
 * correction opens as a faithful picture of what was filed and the user edits
 * from there. The source rows are only ever READ.
 */
export async function createCorrection(args: {
  firmId: string; clientId: string;
  financialYear: string; quarter: string; formType: string;
  filingId: string | null;
  reason: string;
  actor: Actor;
}): Promise<{ correction: Correction | null; error: string | null }> {
  const { data: header, error: headErr } = await supabase
    .from("tds_corrections" as any)
    .insert({
      firm_id: args.firmId,
      client_id: args.clientId,
      financial_year: args.financialYear,
      quarter: args.quarter,
      form_type: args.formType,
      original_filing_id: args.filingId,
      status: "draft",
      reason: args.reason || null,
      raised_by: args.actor.id,
      raised_by_name: args.actor.name,
      raised_by_role: args.actor.role,
    })
    .select("*")
    .single();

  if (headErr || !header) {
    return { correction: null, error: headErr?.message || "Could not create the correction." };
  }
  const correction = header as unknown as Correction;

  // ── Snapshot the filed data ───────────────────────────────────────────────
  if (args.filingId) {
    const [{ data: challans }, { data: deductees }] = await Promise.all([
      supabase.from("tds_challans").select("*")
        .eq("filing_id", args.filingId).eq("client_id", args.clientId),
      supabase.from("tds_deductees").select("*")
        .eq("filing_id", args.filingId).eq("client_id", args.clientId),
    ]);

    const filedChallans = (challans || []) as any[];
    const filedDeductees = (deductees || []) as any[];

    // Map original challan id -> new correction challan id, so the deductee
    // copies stay attached to the right challan (workflow step 5).
    const challanIdMap = new Map<string, string>();

    if (filedChallans.length) {
      const rows = filedChallans.map(c => ({
        correction_id: correction.id,
        firm_id: args.firmId,
        client_id: args.clientId,
        original_challan_id: c.id,
        action: "unchanged",
        ...pick(c, CHALLAN_COPY_COLS),
      }));
      const { data: inserted } = await supabase
        .from("tds_correction_challans" as any).insert(rows).select("id, original_challan_id");
      for (const r of (inserted || []) as any[]) {
        if (r.original_challan_id) challanIdMap.set(r.original_challan_id, r.id);
      }
    }

    if (filedDeductees.length) {
      const rows = filedDeductees.map(d => ({
        correction_id: correction.id,
        correction_challan_id: d.challan_id ? challanIdMap.get(d.challan_id) ?? null : null,
        firm_id: args.firmId,
        client_id: args.clientId,
        original_deductee_id: d.id,
        action: "unchanged",
        ...pick(d, DEDUCTEE_COPY_COLS),
      }));
      await supabase.from("tds_correction_deductees" as any).insert(rows);
    }
  }

  await logCorrectionAction({
    correctionId: correction.id, firmId: args.firmId, clientId: args.clientId,
    actionType: "CORRECTION_CREATED",
    detail: `${args.formType} · ${args.quarter} ${args.financialYear}`,
    actor: args.actor,
  });

  return { correction, error: null };
}

// ─── Load ───────────────────────────────────────────────────────────────────

export async function loadCorrectionDetail(correctionId: string) {
  const [{ data: challans }, { data: deductees }] = await Promise.all([
    supabase.from("tds_correction_challans" as any).select("*")
      .eq("correction_id", correctionId),
    supabase.from("tds_correction_deductees" as any).select("*")
      .eq("correction_id", correctionId),
  ]);
  return {
    challans: ((challans || []) as unknown as CorrectionChallan[])
      .slice().sort((a, b) => (a.challan_serial_no || "").localeCompare(b.challan_serial_no || "")),
    deductees: ((deductees || []) as unknown as CorrectionDeductee[])
      .slice().sort((a, b) => (a.deductee_name || "").localeCompare(b.deductee_name || "")),
  };
}

// ─── Lifecycle transitions ──────────────────────────────────────────────────

export async function submitCorrection(c: Correction, actor: Actor) {
  const { error } = await supabase.from("tds_corrections" as any)
    .update({ status: "pending", submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", c.id);
  if (!error) {
    await logCorrectionAction({
      correctionId: c.id, firmId: c.firm_id, clientId: c.client_id,
      actionType: "CORRECTION_SUBMITTED", oldValue: c.status, newValue: "pending", actor,
    });
  }
  return error?.message ?? null;
}

/**
 * Sign & file. The signature IS the filing: recording who signed and when is
 * what flips the correction to filed, after which the DB trigger
 * tds_correction_block_when_filed() makes it immutable.
 */
export async function signAndFileCorrection(c: Correction, actor: Actor) {
  if (!actor.id) return "You must be signed in to sign a correction.";
  const now = new Date().toISOString();
  const { error } = await supabase.from("tds_corrections" as any)
    .update({
      status: "filed",
      signed_by: actor.id, signed_by_name: actor.name, signed_by_role: actor.role,
      signed_at: now, updated_at: now,
    })
    .eq("id", c.id);
  if (!error) {
    await logCorrectionAction({
      correctionId: c.id, firmId: c.firm_id, clientId: c.client_id,
      actionType: "CORRECTION_SIGNED_AND_FILED",
      detail: `Signed by ${actor.name || "—"}`,
      oldValue: c.status, newValue: "filed", actor,
    });
  }
  return error?.message ?? null;
}

export async function rejectCorrection(c: Correction, reason: string, actor: Actor) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("tds_corrections" as any)
    .update({
      status: "rejected", rejected_by: actor.id, rejected_at: now,
      rejection_reason: reason || null, updated_at: now,
    })
    .eq("id", c.id);
  if (!error) {
    await logCorrectionAction({
      correctionId: c.id, firmId: c.firm_id, clientId: c.client_id,
      actionType: "CORRECTION_REJECTED", detail: reason,
      oldValue: c.status, newValue: "rejected", actor,
    });
  }
  return error?.message ?? null;
}

// ─── Summary of what changed ────────────────────────────────────────────────

export interface CorrectionDelta {
  added: number; modified: number; deleted: number; unchanged: number;
  challansTouched: number;
}

export function summariseCorrection(
  challans: CorrectionChallan[], deductees: CorrectionDeductee[],
): CorrectionDelta {
  const count = (a: CorrectionAction) =>
    deductees.filter(d => d.action === a).length;
  return {
    added: count("add"),
    modified: count("modify"),
    deleted: count("delete"),
    unchanged: count("unchanged"),
    challansTouched: challans.filter(c => c.action !== "unchanged").length,
  };
}
