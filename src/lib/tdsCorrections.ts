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

/**
 * Approval and filing are SEPARATE events. Two signatures authorise the
 * correction; filing happens later, when a person confirms the return was
 * actually accepted by the Income Tax Department. Nothing auto-files —
 * ready_to_file is where the workflow rests until someone acts.
 *
 *   draft -> awaiting_employee -> awaiting_senior -> ready_to_file -> filed
 *                                       └-> rejected
 */
export type CorrectionStatus =
  | "draft" | "awaiting_employee" | "awaiting_senior"
  | "ready_to_file" | "filed" | "rejected";

export const CORRECTION_STATUS_META: Record<CorrectionStatus, {
  label: string; short: string; tone: string; description: string;
}> = {
  draft: {
    label: "Draft", short: "Draft",
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    description: "Being prepared. Not yet submitted for signature.",
  },
  awaiting_employee: {
    label: "Awaiting Employee Signature", short: "Awaiting Employee",
    tone: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    description: "The preparer must review and sign before it goes for approval.",
  },
  awaiting_senior: {
    label: "Awaiting Senior Approval", short: "Awaiting Senior",
    tone: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    description: "Signed by the preparer. A senior reviewer must approve it.",
  },
  ready_to_file: {
    label: "Ready for Filing", short: "Ready to File",
    tone: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    description: "Both signatures complete. Authorised, but NOT yet filed.",
  },
  filed: {
    label: "Filed", short: "Filed",
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    description: "Confirmed filed with the department. Read-only.",
  },
  rejected: {
    label: "Rejected", short: "Rejected",
    tone: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    description: "Sent back to the preparer. See the reason.",
  },
};

/** Roles allowed to give the SECOND (senior) signature. */
export const SENIOR_ROLES = ["manager", "partner_ca", "firm_admin", "superadmin"];

export const isSeniorReviewer = (role: string | null | undefined) =>
  !!role && SENIOR_ROLES.includes(role);

/** Permanently read-only — the audit guarantee. */
export const isCorrectionLocked = (status: string | null | undefined) =>
  status === "filed";

/**
 * Entries may only be changed BEFORE the first signature. Editing after
 * signing would invalidate what was signed, so the DB freezes the line items
 * from awaiting_senior onward; this mirrors that rule in the UI.
 */
export const isCorrectionEditable = (status: string | null | undefined) =>
  status === "draft" || status === "awaiting_employee";

// ─── Row shapes ─────────────────────────────────────────────────────────────

export type CorrectionAction = "unchanged" | "add" | "modify" | "delete";

/** How the correction return was submitted, and therefore what proof is kept. */
export type SubmissionMode = "offline" | "online";

export const SUBMISSION_MODE_META: Record<SubmissionMode, {
  label: string; proofLabel: string; hint: string; accept: string;
}> = {
  offline: {
    label: "Offline submission",
    proofLabel: "Acknowledgement (ACK)",
    hint: "Filed at a TIN-FC / through an agency. Upload the acknowledgement receipt.",
    accept: ".pdf,.jpg,.jpeg,.png,.txt",
  },
  online: {
    label: "Online submission",
    proofLabel: "Submission screenshot",
    hint: "Filed on the e-filing portal. Upload a screenshot of the confirmation.",
    accept: ".png,.jpg,.jpeg,.pdf",
  },
};

/** Filing is only possible once both signatures AND the proof are in place. */
export const canMarkFiled = (c: Pick<Correction, "prepared_at" | "approved_at" | "submission_mode" | "proof_file_url"> | null) =>
  !!c?.prepared_at && !!c?.approved_at && !!c?.submission_mode && !!c?.proof_file_url;

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

  // Signature 1 — the employee who prepared the correction.
  prepared_by: string | null;
  prepared_by_name: string | null;
  prepared_by_role: string | null;
  prepared_at: string | null;

  // Signature 2 — the senior reviewer. Enforced by the DB to be a different
  // person from the preparer.
  approved_by: string | null;
  approved_by_name: string | null;
  approved_by_role: string | null;
  approved_at: string | null;

  // Manual filing, only after both signatures.
  filed_by: string | null;
  filed_by_name: string | null;
  filed_at: string | null;
  filing_reference: string | null;

  // Proof that the correction actually reached the department. The DB refuses
  // to move a correction to 'filed' without both of these.
  submission_mode: SubmissionMode | null;
  proof_file_name: string | null;
  proof_file_url: string | null;
  proof_uploaded_at: string | null;
  proof_uploaded_by: string | null;

  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;

  /** Legacy single-signature columns, retained for pre-existing rows. */
  signed_by: string | null;
  signed_by_name: string | null;
  signed_by_role: string | null;
  signed_at: string | null;
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

/** draft -> awaiting_employee. The preparer now has to sign what they wrote. */
export async function submitCorrection(c: Correction, actor: Actor) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("tds_corrections" as any)
    .update({ status: "awaiting_employee", submitted_at: now, updated_at: now })
    .eq("id", c.id);
  if (!error) {
    await logCorrectionAction({
      correctionId: c.id, firmId: c.firm_id, clientId: c.client_id,
      actionType: "CORRECTION_SUBMITTED",
      detail: "Submitted for employee signature",
      oldValue: c.status, newValue: "awaiting_employee", actor,
    });
  }
  return error?.message ?? null;
}

/**
 * SIGNATURE 1 — the employee who prepared the correction.
 * awaiting_employee -> awaiting_senior. From here the DB freezes the entries,
 * so what the senior reviews is exactly what was signed.
 */
export async function signAsPreparer(c: Correction, actor: Actor) {
  if (!actor.id) return "You must be signed in to sign a correction.";
  const now = new Date().toISOString();
  const { error } = await supabase.from("tds_corrections" as any)
    .update({
      status: "awaiting_senior",
      prepared_by: actor.id, prepared_by_name: actor.name,
      prepared_by_role: actor.role, prepared_at: now, updated_at: now,
    })
    .eq("id", c.id);
  if (!error) {
    await logCorrectionAction({
      correctionId: c.id, firmId: c.firm_id, clientId: c.client_id,
      actionType: "CORRECTION_SIGNED_PREPARER",
      detail: `Employee signature by ${actor.name || "—"}${actor.role ? ` (${actor.role})` : ""}`,
      oldValue: c.status, newValue: "awaiting_senior", actor,
    });
  }
  return error?.message ?? null;
}

/**
 * SIGNATURE 2 — the senior reviewer.
 * awaiting_senior -> ready_to_file. This AUTHORISES the correction; it does
 * NOT file it. The database rejects a senior approval given by the preparer.
 */
export async function approveAsSenior(c: Correction, actor: Actor) {
  if (!actor.id) return "You must be signed in to approve a correction.";
  if (c.prepared_by && c.prepared_by === actor.id) {
    return "The senior approval must be given by someone other than the preparer.";
  }
  if (!isSeniorReviewer(actor.role)) {
    return "Only a senior reviewer (manager, partner, firm admin) can give the second signature.";
  }
  const now = new Date().toISOString();
  const { error } = await supabase.from("tds_corrections" as any)
    .update({
      status: "ready_to_file",
      approved_by: actor.id, approved_by_name: actor.name,
      approved_by_role: actor.role, approved_at: now, updated_at: now,
    })
    .eq("id", c.id);
  if (!error) {
    await logCorrectionAction({
      correctionId: c.id, firmId: c.firm_id, clientId: c.client_id,
      actionType: "CORRECTION_APPROVED_SENIOR",
      detail: `Senior approval by ${actor.name || "—"}${actor.role ? ` (${actor.role})` : ""}`,
      oldValue: c.status, newValue: "ready_to_file", actor,
    });
  }
  return error?.message ?? null;
}

/**
 * ready_to_file -> filed. A deliberate, manual confirmation that the return
 * was actually filed with the department — never automatic. Locks the
 * correction permanently (tds_correction_block_when_filed).
 */
export async function markCorrectionFiled(
  c: Correction, actor: Actor, opts?: { reference?: string; filedOn?: string },
) {
  if (!actor.id) return "You must be signed in to file a correction.";
  if (!c.prepared_at || !c.approved_at) {
    return "Both signatures must be complete before the correction can be filed.";
  }
  const now = new Date().toISOString();
  const { error } = await supabase.from("tds_corrections" as any)
    .update({
      status: "filed",
      filed_by: actor.id, filed_by_name: actor.name,
      filed_at: opts?.filedOn || now,
      filing_reference: opts?.reference || null,
      updated_at: now,
    })
    .eq("id", c.id);
  if (!error) {
    await logCorrectionAction({
      correctionId: c.id, firmId: c.firm_id, clientId: c.client_id,
      actionType: "CORRECTION_FILED",
      detail: `Marked filed by ${actor.name || "—"}${opts?.reference ? ` · ref ${opts.reference}` : ""}`,
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

// ─── Field-level diff: Original vs Corrected ────────────────────────────────

/** Human labels for the columns a correction can change. */
const FIELD_LABELS: Record<string, string> = {
  deductee_name: "Name", deductee_pan: "PAN", pan_not_available: "PAN not available",
  deductee_type: "Type", section_code: "Section", nature_of_payment: "Nature of payment",
  amount_paid_credited: "Amount paid", date_of_payment: "Date of payment",
  date_of_deduction: "Date of deduction", rate_of_tds: "Rate %",
  tds_amount: "TDS", total_tax_deducted: "Total tax deducted",
  surcharge_amount: "Surcharge", cess_amount: "Cess", interest_amount: "Interest",
  late_fees_amount: "Late fees", gross_salary: "Gross salary",
  standard_deduction_allowed: "Standard deduction", net_taxable_salary: "Taxable salary",
  lower_deduction_certificate_no: "LDC number", lower_deduction_rate: "LDC rate",
  reason_for_lower_or_nil_deduction: "Reason", designation: "Designation",
  remarks: "Remarks", country_of_residence: "Country",
  // Challan fields
  bsr_code: "BSR code", challan_serial_no: "Challan serial no.",
  deposit_date: "Deposit date", total_tax_deposited: "Tax deposited",
  interest_deposited: "Interest deposited", late_fees_234e: "Late fee (234E)",
  total_challan_amount: "Total challan amount", minor_head_of_challan: "Minor head",
  bank_name: "Bank", is_book_entry: "Book entry", challan_remarks: "Challan remarks",
};

/** Bookkeeping columns a user never edits — never show them as "changes". */
const DIFF_IGNORE = new Set([
  "id", "correction_id", "filing_id", "challan_id", "correction_challan_id",
  "original_challan_id", "original_deductee_id", "firm_id", "client_id",
  "action", "original_values", "created_at", "updated_at",
  "form_type", "financial_year", "quarter", "fully_utilized", "late_fees_used",
  "origin_quarter", "origin_fy",
]);

export interface FieldDiff {
  field: string; label: string;
  original: unknown; corrected: unknown;
}

/** Normalise so 100 vs "100" and null vs "" do not read as changes. */
const norm = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v;
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== "" ? n : String(v);
};

/**
 * What actually changed on a row, comparing it to the snapshot the database
 * took the moment before the first edit (20260729200000). Returns [] for
 * unchanged rows and for additions (an addition has no "original").
 */
export function diffCorrectionRow(row: any): FieldDiff[] {
  const original = row?.original_values;
  if (!original || typeof original !== "object") return [];

  const out: FieldDiff[] = [];
  for (const key of Object.keys(original)) {
    if (DIFF_IGNORE.has(key)) continue;
    const before = norm(original[key]);
    const after = norm(row[key]);
    if (before === after) continue;
    out.push({
      field: key,
      label: FIELD_LABELS[key] || key.replace(/_/g, " "),
      original: original[key],
      corrected: row[key],
    });
  }
  return out;
}

/**
 * The action a row should be TREATED as, which is not always the one stored.
 *
 * A row can carry a 'modify' marking while holding values identical to its
 * snapshot — the user edited it, thought better of it, and typed the original
 * values back by hand rather than using Undo. It is not a change, and every
 * surface has to agree on that: the row badge, the change summary, the Changes
 * panel and the challan badge. Reading `action` directly in four places is how
 * they would disagree, so they all come through here.
 *
 * The database self-corrects on the next write (migration 20260730140000);
 * this keeps rows already in that state consistent in the meantime.
 */
export function effectiveCorrectionAction(row: any): CorrectionAction {
  const action: CorrectionAction = row?.action ?? "unchanged";
  if (action !== "modify") return action;

  // No snapshot means we cannot show WHAT changed — it does not mean nothing
  // did. Downgrading here would silently erase a real modification (rows
  // marked before the snapshot column existed, for one). Trust the marking.
  if (!row?.original_values) return "modify";

  // With a snapshot, "no differing field" is proof the row is back to its
  // filed values, whether via Undo or by retyping them.
  return diffCorrectionRow(row).length > 0 ? "modify" : "unchanged";
}

// ─── Proof of submission ────────────────────────────────────────────────────

/**
 * Upload the acknowledgement (offline) or submission screenshot (online) and
 * attach it to the correction.
 *
 * Stored in the `documents` bucket, the same one TdsFilingsManager already
 * uses for filing acknowledgements, under a per-correction path so a
 * re-upload cannot collide with another correction's proof.
 */
export async function uploadCorrectionProof(
  c: Correction, mode: SubmissionMode, file: File, actor: Actor,
): Promise<{ error: string | null }> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `tds-corrections/${c.id}/${mode}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
  if (upErr) return { error: upErr.message };

  const { data: pub } = supabase.storage.from("documents").getPublicUrl(path);
  const url = pub?.publicUrl;
  if (!url) return { error: "Uploaded, but no URL was returned for the file." };

  const now = new Date().toISOString();
  const { error } = await supabase.from("tds_corrections" as any)
    .update({
      submission_mode: mode,
      proof_file_name: file.name,
      proof_file_url: url,
      proof_uploaded_at: now,
      proof_uploaded_by: actor.id,
      updated_at: now,
    })
    .eq("id", c.id);
  if (error) {
    // Do not leave an orphan object behind if the row could not be updated.
    await supabase.storage.from("documents").remove([path]).catch(() => {});
    return { error: error.message };
  }

  await logCorrectionAction({
    correctionId: c.id, firmId: c.firm_id, clientId: c.client_id,
    actionType: "FILING_PROOF_UPLOADED",
    detail: `${SUBMISSION_MODE_META[mode].proofLabel}: ${file.name}`,
    newValue: mode, actor,
  });
  return { error: null };
}

// ─── Undo ───────────────────────────────────────────────────────────────────

/**
 * Undo one change, returning the row to exactly how it was filed.
 *
 *   added    -> the row only ever existed in this correction, so it is removed
 *   modified -> every field is restored from the pre-edit snapshot
 *   deleted  -> the row comes back (and its values are restored, since a
 *               delete may have followed an edit)
 *
 * `original_values` is the snapshot the DB took the instant before the first
 * edit, so restoring from it reproduces the filed state exactly rather than
 * guessing. Clearing action + original_values afterwards makes the row
 * indistinguishable from one that was never touched — which is the point.
 */
export async function undoCorrectionRow(
  table: "tds_correction_challans" | "tds_correction_deductees",
  row: { id: string; action: CorrectionAction; original_values?: any },
): Promise<string | null> {
  if (row.action === "add") {
    // A row added inside this correction has no filed original. The soft-delete
    // trigger only preserves rows that came from the filing, so this really
    // removes it.
    const { error } = await supabase.from(table as any).delete().eq("id", row.id);
    return error?.message ?? null;
  }

  const snapshot = row.original_values;
  if (!snapshot || typeof snapshot !== "object") {
    // Nothing to restore from — at least clear the marking so the row stops
    // claiming to be changed.
    const { error } = await supabase.from(table as any)
      .update({ action: "unchanged", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return error?.message ?? null;
  }

  // Restore every snapshotted column, then clear the marking. `action` is set
  // last in the same statement so the mark-modified trigger — which only fires
  // on an 'unchanged' row — cannot re-flag this as a modification.
  const restore: Record<string, any> = {};
  for (const [k, v] of Object.entries(snapshot)) {
    if (k === "id" || k === "action" || k === "original_values") continue;
    restore[k] = v;
  }
  restore.action = "unchanged";
  restore.original_values = null;
  restore.updated_at = new Date().toISOString();

  const { error } = await supabase.from(table as any).update(restore).eq("id", row.id);
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
  // effectiveCorrectionAction, not `action` — a row reverted to its filed
  // values by hand still carries a 'modify' marking and must not be counted.
  const count = (a: CorrectionAction) =>
    deductees.filter(d => effectiveCorrectionAction(d) === a).length;
  return {
    added: count("add"),
    modified: count("modify"),
    deleted: count("delete"),
    unchanged: count("unchanged"),
    challansTouched: challans.filter(c => effectiveCorrectionAction(c) !== "unchanged").length,
  };
}
