/**
 * Multi-quarter Overview Report — standalone data layer.
 *
 * TdsValidateFinalise.tsx's Overview Report only exists because Stage 1-4's
 * React state is already sitting in memory for the ONE filing loaded in the
 * Validate & Finalise workspace. This module reproduces the exact same
 * Stage 1/2/3/4 shaping FROM SCRATCH, straight off the database, for any
 * filing — so the Reports screen can build the same report for one, several,
 * or every quarter of a client's return, without that filing ever having been
 * opened in the workspace this session.
 *
 * Every field label, section title, summary formula and override/mapped/
 * reason string below is a DELIBERATE mirror of:
 *   - TdsValidateFinalise.tsx  stage1Report() / stage4Report() / overviewReport()
 *   - TdsPanVerification.tsx  stage2Report()
 *   - TdsTallyRecon.tsx       stage3Report()
 * A drift between this file and those four is a bug — if one of them changes
 * its label/formula, mirror the change here too.
 *
 * Two exports:
 *   fetchFilingReport()    — ONE filing → { meta, stageReports, quarterStage }
 *   mergeQuarterlyReports() — N filings' results → one combined document
 */

import { supabase } from "@/integrations/supabase/client";
import {
  FIELD_LABELS, reasonFor, errorTypeFor,
  type ReportMeta, type StageReport, type OverviewReport, type OverviewStage, type AuditRow,
} from "./tdsReport";
import {
  isPanException, panReason, panRecommendedAction, panDiagnostics,
  type OfficeParty, type TracesPanRow, type PanValidationResult, type PanCheckDetail,
} from "@/lib/tdsPanVerification";
import { canonicalSection } from "@/lib/tds/match";
import { oneSidedLabel, type TallyResult } from "@/lib/tds/tallyRecon";

// ── Row shapes read back from each stage's results table ─────────────────────
// Structurally identical to the (module-local) interfaces in
// TdsValidateFinalise.tsx / TdsPanVerification.tsx / TdsTallyRecon.tsx — kept
// as separate copies here (rather than imported) because none of those three
// are exported from their component files, and a report-only reader has no
// business importing a whole component module just for its row type.

interface FieldDiff {
  field: string;
  office: unknown;
  imported: unknown;
  matched: boolean;
  difference?: string;
}
interface ReconResult {
  id: string;
  record_label: string | null;
  match_status: "matched" | "mismatched" | "office_only" | "imported_only";
  mismatch_fields: string[] | null;
  field_diffs: FieldDiff[] | null;
  overridden: boolean;
  override_note?: string | null;
}

interface PanResult {
  id: string;
  party_name: string | null;
  verified_name: string | null;
  pan: string | null;
  pan_status: string | null;
  validation_result: PanValidationResult;
  detail: PanCheckDetail | null;
  overridden: boolean;
  override_reason: string | null;
}

// IMPORTED, never re-declared. The local copy of this union went stale the
// moment Stage 3 gained a new result (it is only ever populated via a cast, so
// a missing member never failed to compile) and the report then labelled rows
// differently from the tab they came from.
interface TallyResultRow {
  id: string;
  office_name: string | null;
  office_date: string | null;
  office_amount: number | null;
  office_tds: number | null;
  office_section: string | null;
  tally_party: string | null;
  tally_date: string | null;
  tally_credit: number | null;
  salary_tally_party: string | null;
  salary_tally_date: string | null;
  salary_tally_credit: number | null;
  result: TallyResult;
  reason: string | null;
  mapped: boolean;
  overridden: boolean;
  override_reason: string | null;
}

/** Mirrors TdsTallyRecon.tsx's own (module-local, unexported) `isTallyIssue`. */
const isTallyIssue = (r: string) => r !== "Matched";

// oneSidedLabel is imported from tallyRecon.ts — see its doc there for why this
// must never be re-implemented locally.

// ── Public input/output shapes ────────────────────────────────────────────────

/** The bare filing reference the caller (TdsReports.tsx) already has after
 *  resolving `tds_filings` for a client+FY+quarter+form — same fields
 *  `loadAll()` reads off `filing` in TdsValidateFinalise.tsx. */
export interface FilingRef {
  id: string;
  client_id: string;
  financial_year: string;
  quarter: string;
  tds_forms: string[] | null;
  work_status: string | null;
  tan?: string | null;
}

export interface FilingReportContext {
  clientName: string;
  clientTan?: string | null;
  /** The form this report is for, e.g. "26Q" — becomes ReportMeta.form. */
  formLabel: string;
}

export interface QuarterFilingReport {
  meta: ReportMeta;
  stageReports: StageReport[];
  /**
   * This quarter's own row for the multi-quarter Overview (see
   * mergeQuarterlyReports). Beyond the `{ meta, stageReports }` pair, this
   * carries the READY-TO-FILE verdict for the quarter — computed with the
   * exact same inputs (stage1Ran/Ready, Stage-2/3 applicable/ran/issues,
   * digital signature, work_status) `overviewReport()`'s `finalStatus` uses.
   * It is carried as DATA rather than re-derived by parsing this function's
   * own rendered StageReport text (that would be fragile string-scraping of
   * our own output for something we already know precisely while building it).
   */
  quarterStage: OverviewStage;
}

// ── Office / TRACES fetch — needed only for Stage 2's diagnostics ────────────
// (comparePanVerification itself is NOT re-run — the persisted
// tds_pan_verification_results already hold the audit; only panDiagnostics()
// needs the raw office+TRACES inputs, to reproduce Stage 2's own "Things to
// check" notes.)

async function fetchOfficeParties(filingId: string): Promise<OfficeParty[]> {
  const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", filingId);
  const chIds = (ch || []).map((c: any) => c.id);
  if (!chIds.length) return [];
  const { data: ded } = await supabase.from("tds_deductees")
    .select("id, deductee_pan, deductee_name").in("challan_id", chIds);
  return (ded || []).map((d: any) => ({ deductee_id: d.id, pan: d.deductee_pan, name: d.deductee_name }));
}

async function fetchTracesRows(filingId: string): Promise<TracesPanRow[]> {
  const { data: tr } = await (supabase.from("tds_pan_verification_rows") as any)
    .select("id, pan, name, verified_name, pan_status, mismatch_in_name")
    .eq("filing_id", filingId);
  return (tr || []).map((t: any) => ({
    row_id: t.id, pan: t.pan, name: t.name, verified_name: t.verified_name,
    pan_status: t.pan_status, mismatch_in_name: t.mismatch_in_name,
  }));
}

/** Office Data's own section codes for this filing — needed only to reproduce
 *  TdsTallyRecon.tsx's `missingSections` note. Mirrors that file's `loadOffice`
 *  section formula: `section_code || nature_of_payment`. */
async function fetchOfficeSections(filingId: string): Promise<string[]> {
  const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", filingId);
  const chIds = (ch || []).map((c: any) => c.id);
  if (!chIds.length) return [];
  const { data: ded } = await supabase.from("tds_deductees")
    .select("section_code, nature_of_payment").in("challan_id", chIds);
  return (ded || []).map((d: any) => d.section_code || d.nature_of_payment).filter(Boolean);
}

/**
 * Fetch + shape ONE filing's Stage 1-4 report, independent of any component
 * state. Returns null when the filing genuinely has nothing to report —
 * Stage 1 has never been run AND no Stage 2 (TRACES) AND no Stage 3 (Tally
 * ledger) batch was ever imported for it either, i.e. nothing has happened
 * for this quarter's return at all.
 */
export async function fetchFilingReport(filing: FilingRef, ctx: FilingReportContext): Promise<QuarterFilingReport | null> {
  const filingId = filing.id;

  // ── Stage 1 · Data Validation — mirrors TdsValidateFinalise.tsx loadAll()'s
  // tds_recon_results fetch + summary useMemo + stage1Report(). ────────────────
  const { data: reconData } = await (supabase.from("tds_recon_results") as any).select("*").eq("filing_id", filingId);
  const results1: ReconResult[] = (reconData as ReconResult[]) || [];
  const stage1Ran = results1.length > 0;
  const summary1 = {
    total: results1.length,
    matched: results1.filter((r) => r.match_status === "matched").length,
    mismatched: results1.filter((r) => r.match_status !== "matched" && !r.overridden).length,
    overridden: results1.filter((r) => r.overridden).length,
  };

  // ── Stage 2 · PAN Verification — mirrors TdsPanVerification.tsx loadAll()'s
  // batch-existence + tds_pan_verification_results fetch + stage2Report(). ────
  const { data: panBatchRows } = await (supabase.from("tds_pan_verification_batches") as any)
    .select("id").eq("filing_id", filingId).limit(1);
  const panApplicable = !!(panBatchRows && panBatchRows.length);
  const { data: panData } = await (supabase.from("tds_pan_verification_results") as any).select("*").eq("filing_id", filingId);
  const results2: PanResult[] = (panData as PanResult[]) || [];
  const panRan = results2.length > 0;
  const summary2 = {
    total: results2.length,
    verified: results2.filter((r) => r.validation_result === "PAN Verified").length,
    issues: results2.filter((r) => isPanException(r.validation_result) && !r.overridden).length,
    overridden: results2.filter((r) => r.overridden).length,
  };

  // ── Stage 3 · Tally Ledger Reconciliation — mirrors TdsTallyRecon.tsx
  // loadAll()'s batches + tds_tally_results fetch + stage3Report(). ───────────
  const { data: tallyBatchRows } = await (supabase.from("tds_tally_batches") as any)
    .select("id, section").eq("filing_id", filingId).order("imported_at", { ascending: false });
  const tallyBatches = tallyBatchRows || [];
  const tallyApplicable = tallyBatches.length > 0;
  const ledgerSections = [...new Set(tallyBatches.map((b: any) => b.section).filter(Boolean) as string[])].sort();
  const { data: tallyData } = await (supabase.from("tds_tally_results") as any).select("*").eq("filing_id", filingId);
  const results3: TallyResultRow[] = (tallyData as TallyResultRow[]) || [];
  const tallyRan = results3.length > 0;
  const summary3 = {
    total: results3.length,
    matched: results3.filter((r) => r.result === "Matched").length,
    issues: results3.filter((r) => isTallyIssue(r.result) && !r.overridden).length,
    mapped: results3.filter((r) => r.mapped).length,
    overridden: results3.filter((r) => r.overridden).length,
  };

  if (!stage1Ran && !panApplicable && !tallyApplicable) return null; // nothing to report

  const meta: ReportMeta = {
    client: ctx.clientName || "—",
    tan: ctx.clientTan ?? filing.tan ?? null,
    form: ctx.formLabel,
    quarter: filing.quarter,
    fy: filing.financial_year,
    status: filing.work_status || null,
  };

  // ── Stage 1 report — byte-identical to TdsValidateFinalise.tsx stage1Report() ──
  const stage1Row = (r: ReconResult) => ({
    Record: r.record_label || "—",
    Result: r.match_status === "matched" ? "Matched"
      : r.match_status === "office_only" ? "Missing in Imported File"
      : r.match_status === "imported_only" ? "Extra in Imported File" : "Mismatched",
    "Mismatched Fields": (r.mismatch_fields || []).map((f) => FIELD_LABELS[f] || f).join(", "),
    Remarks: r.overridden ? `Overridden — ${r.override_note || "accepted"}` : reasonFor(r),
    Overridden: r.overridden ? "Yes" : "No",
    ...Object.fromEntries((r.field_diffs || []).flatMap((d) => [
      [`Office ${FIELD_LABELS[d.field] || d.field}`, d.office ?? ""],
      [`Imported ${FIELD_LABELS[d.field] || d.field}`, d.imported ?? ""],
    ])),
  });
  const stage1Report: StageReport = {
    title: "Stage 1 - Data Validation",
    subtitle: "Office Data vs Imported Client Data — field by field",
    summary: [
      { label: "Total", value: summary1.total },
      { label: "Matched", value: summary1.matched },
      { label: "Mismatched", value: summary1.mismatched },
      { label: "Overridden", value: summary1.overridden },
    ],
    sections: [
      { title: "Mismatched", rows: results1.filter((r) => r.match_status !== "matched" && !r.overridden).map(stage1Row), emptyNote: "No mismatched records — every office record reconciled." },
      { title: "Missing in Imported", rows: results1.filter((r) => r.match_status === "office_only").map(stage1Row), emptyNote: "No office record is missing from the imported file." },
      { title: "Extra in Imported", rows: results1.filter((r) => r.match_status === "imported_only").map(stage1Row), emptyNote: "No extra rows in the imported file." },
      { title: "Overridden", rows: results1.filter((r) => r.overridden).map(stage1Row), emptyNote: "No overrides." },
      { title: "Matched", rows: results1.filter((r) => r.match_status === "matched" && !r.overridden).map(stage1Row), emptyNote: "No matched records." },
    ],
  };

  // ── Stage 2 report — byte-identical to TdsPanVerification.tsx stage2Report() ──
  let stage2Report: StageReport | null = null;
  if (panApplicable) {
    const [office, traces] = await Promise.all([fetchOfficeParties(filingId), fetchTracesRows(filingId)]);
    const diagnostics = panDiagnostics(office, traces);
    const stage2Row = (r: PanResult) => ({
      Party: r.party_name || "—",
      PAN: r.pan || "—",
      "PAN Status": r.pan_status || "—",
      "Name on PAN Records": r.verified_name || "—",
      Result: r.validation_result,
      Remarks: r.overridden ? `Overridden — ${r.override_reason || "accepted"}` : panReason(r.validation_result),
      "Recommended Action": r.overridden ? "" : panRecommendedAction(r.validation_result),
      "Short Deduction (Rs)": r.detail?.short_deduction ? Math.round(r.detail.short_deduction.shortfall) : "",
      Overridden: r.overridden ? "Yes" : "No",
    });
    const issues = results2.filter((r) => isPanException(r.validation_result) && !r.overridden);
    stage2Report = {
      title: "Stage 2 - PAN Verification",
      subtitle: "Office parties vs the TRACES bulk-PAN file — PAN existence and PAN status",
      summary: [
        { label: "Total", value: summary2.total },
        { label: "Verified", value: summary2.verified },
        { label: "Issues", value: summary2.issues },
        { label: "Overridden", value: summary2.overridden },
      ],
      sections: [
        { title: "Issues", rows: issues.map(stage2Row), emptyNote: "No PAN issues — every party's PAN is present and active." },
        { title: "Overridden", rows: results2.filter((r) => r.overridden).map(stage2Row), emptyNote: "No overrides." },
        { title: "Verified", rows: results2.filter((r) => !isPanException(r.validation_result)).map(stage2Row), emptyNote: "No verified PANs." },
      ],
      notes: diagnostics,
    };
  }

  // ── Stage 3 report — byte-identical to TdsTallyRecon.tsx stage3Report(), ───
  // including the `missingSections` note (Office Data sections with no
  // imported ledger). Mirrors TdsTallyRecon.tsx's own `missingSections` useMemo:
  // skip the office-sections fetch entirely when the ledger's own sections
  // don't canonicalise to anything (`have.size === 0`), same short-circuit.
  let stage3Report: StageReport | null = null;
  if (tallyApplicable) {
    const have = new Set(ledgerSections.map((s) => canonicalSection(s)).filter(Boolean) as string[]);
    let missingSections: string[] = [];
    if (have.size) {
      const officeSections = await fetchOfficeSections(filingId);
      const need = new Set(officeSections.map((s) => canonicalSection(s)).filter(Boolean) as string[]);
      missingSections = [...need].filter((s) => !have.has(s)).sort();
    }
    // Column set kept IDENTICAL to TdsTallyRecon.tsx's stage3Report() row —
    // including the dual-ledger figures, without which an exported
    // "…Amount Mismatch" line shows every visible number in agreement.
    const stage3Row = (r: TallyResultRow) => ({
      "Office Party": r.office_name || "—",
      "Office Date": r.office_date || "—",
      "Office Amount": r.office_amount ?? "",
      "Office TDS": r.office_tds ?? "",
      Section: r.office_section || "—",
      "Expense Ledger Party": r.salary_tally_party || "",
      "Expense Ledger Date": r.salary_tally_date || "",
      "Expense Ledger Credit": r.salary_tally_credit ?? "",
      "Ledger Party": r.tally_party || "—",
      "Ledger Date": r.tally_date || "—",
      "Ledger Credit": r.tally_credit ?? "",
      Result: r.overridden ? oneSidedLabel(r) : r.result,
      Mapped: r.mapped ? "Yes" : "No",
      Remarks: r.overridden ? `Overridden — ${r.override_reason || "accepted"}` : (r.reason || ""),
      Overridden: r.overridden ? "Yes" : "No",
    });
    const unresolved = results3.filter((r) => isTallyIssue(r.result) && !r.overridden);
    stage3Report = {
      title: "Stage 3 - Tally Ledger Reconciliation",
      subtitle: `Office Data vs the imported Tally ledger PDFs — date, party and TDS (credit)${ledgerSections.length ? ` · sections ${ledgerSections.join(", ")}` : ""}`,
      summary: [
        { label: "Total", value: summary3.total },
        { label: "Matched", value: summary3.matched },
        { label: "Mismatched", value: summary3.issues },
        { label: "Mapped", value: summary3.mapped },
        { label: "Overridden", value: summary3.overridden },
      ],
      sections: [
        { title: "Mismatched", rows: unresolved.map(stage3Row), emptyNote: "No mismatches — every office record reconciled to the ledger." },
        { title: "Mapped", rows: results3.filter((r) => r.mapped).map(stage3Row), emptyNote: "No records have a manual party mapping." },
        { title: "Overridden", rows: results3.filter((r) => r.overridden).map(stage3Row), emptyNote: "No overrides." },
        { title: "Matched", rows: results3.filter((r) => r.result === "Matched").map(stage3Row), emptyNote: "No matched records." },
      ],
      notes: missingSections.length
        ? [`Office Data has section(s) ${missingSections.join(", ")} with no imported ledger — those records cannot be reconciled until that ledger PDF is imported.`]
        : [],
    };
  }

  // ── Stage 4 · Checker Review — mirrors TdsValidateFinalise.tsx stage4Data +
  // stage4Report(), combining the 3 stages' own already-fetched results. ─────
  const s1Audit: AuditRow[] = results1
    .filter((r) => r.match_status !== "matched" || r.overridden)
    .map((r): AuditRow => ({
      stage: "Stage 1",
      record: r.record_label || "—",
      errorType: errorTypeFor(r),
      status: r.overridden ? "Overridden" : "Unresolved",
      reason: r.overridden ? (r.override_note || "accepted") : reasonFor(r),
    }));
  const s2Audit: AuditRow[] = panApplicable
    ? results2.filter((r) => isPanException(r.validation_result)).map((r): AuditRow => ({
        stage: "Stage 2",
        record: r.party_name || "—",
        errorType: r.validation_result,
        status: r.overridden ? "Overridden" : "Unresolved",
        reason: r.overridden ? (r.override_reason || "accepted") : panReason(r.validation_result),
      }))
    : [];
  const s3Audit: AuditRow[] = tallyApplicable
    ? results3.filter((r) => r.overridden || isTallyIssue(r.result) || (r.mapped && r.result === "Matched")).map((r): AuditRow => ({
        stage: "Stage 3",
        record: r.office_name || r.tally_party || "—",
        errorType: r.overridden ? oneSidedLabel(r) : r.result,
        status: r.overridden ? "Overridden" : isTallyIssue(r.result) ? "Unresolved" : "Resolved",
        reason: r.overridden ? (r.override_reason || "accepted") : (r.reason || (r.mapped ? "Reconciled via saved party mapping" : "")),
      }))
    : [];
  const stage4AuditRows = [...s1Audit, ...s2Audit, ...s3Audit].filter((r) => r.status !== "Resolved" && r.errorType !== "Matched");
  const stage4Totals = {
    totalRecords: summary1.total,
    totalMatched: summary1.matched,
    totalMismatches: summary1.mismatched + (panApplicable ? summary2.issues : 0) + (tallyApplicable ? summary3.issues : 0),
    totalOverridden: summary1.overridden + (panApplicable ? summary2.overridden : 0) + (tallyApplicable ? summary3.overridden : 0),
  };

  // Digital signature — mirrors TdsValidateFinalise.tsx loadAll()'s
  // tds_filing_audit_log lookup (latest of the two action types decides state).
  const { data: sigRows } = await supabase.from("tds_filing_audit_log")
    .select("action_type, new_value, changed_at")
    .eq("filing_id", filingId)
    .in("action_type", ["CHECKER_SIGNATURE", "CHECKER_SIGNATURE_REVOKED"])
    .order("changed_at", { ascending: false })
    .limit(1);
  const latestSig = (sigRows || [])[0];
  const signature = latestSig && latestSig.action_type === "CHECKER_SIGNATURE" && latestSig.changed_at
    ? { signedByName: latestSig.new_value || "—", signedAt: latestSig.changed_at }
    : null;

  const stage1Ready = stage1Ran && summary1.mismatched === 0;
  const stage2Ready = !panApplicable || (panRan && summary2.issues === 0);
  const stage3Ready = !tallyApplicable || (tallyRan && summary3.issues === 0);
  const canFile = stage1Ready && stage2Ready && stage3Ready;
  const isFiled = filing.work_status === "Filed";
  // Mirrors TdsValidateFinalise.tsx's fileBlockReason, minus the transient
  // "Finishing validation status checks…" branch — that exists only for a
  // live component mid-async-load, which does not apply to a one-shot fetch.
  const fileBlockReason = !stage1Ran
    ? "Run Stage-1 validation first."
    : !stage1Ready
    ? `${summary1.mismatched} Stage-1 mismatch${summary1.mismatched === 1 ? "" : "es"} still unresolved — override each one to continue.`
    : (panApplicable && !panRan)
    ? "A TRACES file is imported — run Stage-2 PAN Verification to complete the audit."
    : (panApplicable && summary2.issues > 0)
    ? `${summary2.issues} Stage-2 PAN issue${summary2.issues === 1 ? "" : "s"} still unresolved — override or resolve each one to continue.`
    : (tallyApplicable && !tallyRan)
    ? "A Tally ledger is imported — run Stage-3 reconciliation to complete it."
    : (tallyApplicable && summary3.issues > 0)
    ? `${summary3.issues} Stage-3 Tally item${summary3.issues === 1 ? "" : "s"} still unresolved — map, override or resolve each one to continue.`
    : "";

  let stage4Report: StageReport | null = null;
  if (stage1Ran) {
    const stage4Row = (r: AuditRow) => ({ Stage: r.stage, Record: r.record, "Error Type": r.errorType, Status: r.status, Reason: r.reason });
    stage4Report = {
      title: "Stage 4 - Checker Review",
      subtitle: "Consolidated exceptions across Stage 1-3, plus the sign-off gate",
      summary: [
        { label: "Total", value: stage4Totals.totalRecords },
        { label: "Matched", value: stage4Totals.totalMatched },
        { label: "Mismatched", value: stage4Totals.totalMismatches },
        { label: "Overridden", value: stage4Totals.totalOverridden },
      ],
      sections: [
        { title: "Unresolved", rows: stage4AuditRows.filter((r) => r.status === "Unresolved").map(stage4Row), emptyNote: "No unresolved exceptions across Stage 1-3." },
        { title: "Overridden", rows: stage4AuditRows.filter((r) => r.status === "Overridden").map(stage4Row), emptyNote: "No overrides." },
      ],
      notes: [
        `Ready to file: ${canFile ? "Yes" : "No"}${!canFile && fileBlockReason ? ` — ${fileBlockReason}` : ""}`,
        `Digital signature: ${signature ? `Signed by ${signature.signedByName} on ${new Date(signature.signedAt).toLocaleString("en-IN")}` : "Not signed"}`,
        `Filing status: ${isFiled ? "Filed" : "Not filed"}`,
      ],
    };
  }

  const stageReports: StageReport[] = [
    ...(stage1Ran ? [stage1Report] : []),
    ...(stage2Report ? [stage2Report] : []),
    ...(stage3Report ? [stage3Report] : []),
    ...(stage4Report ? [stage4Report] : []),
  ];

  // ── This quarter's Overview row — same finalStatus logic overviewReport()
  // computes per FILING, resolved once per QUARTER here instead. Text is
  // tweaked (vs. the source's literal wording) to always contain the word
  // "complete" on a good outcome — buildOverviewWorkbook()'s own status
  // colouring keys off that word (see its `metricColour`/status-cell logic,
  // which this module must not modify), so a Filed/ready quarter renders
  // green there exactly like a genuinely "Complete" single stage does.
  const finalStatus = isFiled
    ? "Filed (validation complete)"
    : canFile
    ? "All validations complete — ready to mark as Ready to File"
    : (() => {
        const open: string[] = [];
        if (!stage1Ran) open.push("Stage 1 not run");
        else if (summary1.mismatched > 0) open.push(`Stage 1: ${summary1.mismatched} unresolved`);
        if (panApplicable && !panRan) open.push("Stage 2 not run");
        else if (panApplicable && summary2.issues > 0) open.push(`Stage 2: ${summary2.issues} unresolved`);
        if (tallyApplicable && !tallyRan) open.push("Stage 3 not run");
        else if (tallyApplicable && summary3.issues > 0) open.push(`Stage 3: ${summary3.issues} unresolved`);
        return open.length ? `Not ready to file — ${open.join("; ")}` : "Validation incomplete";
      })();

  const quarterStage: OverviewStage = {
    title: filing.quarter,
    applicable: true,
    ran: stage1Ran,
    summary: [
      { label: "Total", value: stage4Totals.totalRecords },
      { label: "Matched", value: stage4Totals.totalMatched },
      { label: "Mismatched", value: stage4Totals.totalMismatches },
      { label: "Overridden", value: stage4Totals.totalOverridden },
    ],
    status: finalStatus,
  };

  return { meta, stageReports, quarterStage };
}

// ── Merge N quarters' reports into one combined document ──────────────────────

export interface QuarterReportInput extends QuarterFilingReport {
  quarter: string;
}

const ALL_FOUR_QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

/**
 * Combine several quarters' already-fetched reports into one document:
 *   - same-titled StageReports are merged (summary metrics summed, rows
 *     concatenated with a leading "Quarter" column, notes kept per quarter)
 *   - the Overview is ONE ROW PER QUARTER (see QuarterFilingReport.quarterStage) —
 *     a single merged ready/not-ready flag doesn't generalise across several
 *     separately-filed returns, so there is no such flag here.
 */
export function mergeQuarterlyReports(perQuarter: QuarterReportInput[]): { meta: ReportMeta; stageReports: StageReport[]; overview: OverviewReport } {
  if (!perQuarter.length) throw new Error("mergeQuarterlyReports: at least one quarter is required");

  const quarters = perQuarter.map((p) => p.quarter);
  const quarterLabel = quarters.length === 1
    ? quarters[0]
    : quarters.length === 4 && ALL_FOUR_QUARTERS.every((q) => quarters.includes(q))
    ? "Q1-Q4 (All)"
    : quarters.join(", ");

  // Client/TAN/Form/FY are identical across quarters (same client+FY+form
  // return, only the quarter varies) — the first quarter's values represent
  // the whole document. Quarter and status become multi-quarter summaries.
  const meta: ReportMeta = {
    client: perQuarter[0].meta.client,
    tan: perQuarter[0].meta.tan,
    form: perQuarter[0].meta.form,
    quarter: quarterLabel,
    fy: perQuarter[0].meta.fy,
    status: perQuarter.map((p) => `${p.quarter}: ${p.meta.status || "—"}`).join("; "),
  };

  const titleOrder: string[] = [];
  const merged = new Map<string, {
    subtitle?: string;
    summary: { label: string; value: number }[];
    sectionOrder: string[];
    sections: Map<string, { rows: Record<string, unknown>[]; emptyNotes: Set<string> }>;
    notes: string[];
  }>();

  for (const q of perQuarter) {
    for (const sr of q.stageReports) {
      if (!merged.has(sr.title)) {
        titleOrder.push(sr.title);
        merged.set(sr.title, { subtitle: sr.subtitle, summary: [], sectionOrder: [], sections: new Map(), notes: [] });
      }
      const acc = merged.get(sr.title)!;
      for (const s of sr.summary) {
        const n = typeof s.value === "number" ? s.value : Number(s.value) || 0;
        const existing = acc.summary.find((x) => x.label === s.label);
        if (existing) existing.value += n; else acc.summary.push({ label: s.label, value: n });
      }
      for (const sec of sr.sections) {
        if (!acc.sections.has(sec.title)) { acc.sectionOrder.push(sec.title); acc.sections.set(sec.title, { rows: [], emptyNotes: new Set() }); }
        const as = acc.sections.get(sec.title)!;
        // "Quarter" is added FIRST so it's the leftmost Excel/PDF column.
        as.rows.push(...sec.rows.map((r) => ({ Quarter: q.quarter, ...r })));
        if (sec.emptyNote) as.emptyNotes.add(sec.emptyNote);
      }
      // One pushed entry PER original note (not one run-on line per quarter) —
      // each renderer (notesBlock in tdsReportExcel.ts, notesHtml in
      // tdsReportPdf.ts) draws one bullet per array element, so squishing
      // Stage 4's 3 separate notes ("Ready to file…"/"Digital signature…"/
      // "Filing status…") into one joined string loses that bulleting even
      // for a single selected quarter.
      for (const n of sr.notes || []) acc.notes.push(`${q.quarter}: ${n}`);
    }
  }

  const stageReports: StageReport[] = titleOrder.map((title) => {
    const acc = merged.get(title)!;
    return {
      title,
      subtitle: acc.subtitle,
      summary: acc.summary,
      sections: acc.sectionOrder.map((secTitle) => {
        const s = acc.sections.get(secTitle)!;
        return { title: secTitle, rows: s.rows, emptyNote: s.rows.length ? undefined : ([...s.emptyNotes].join(" ") || undefined) };
      }),
      notes: acc.notes.length ? acc.notes : undefined,
    };
  });

  const stages: OverviewStage[] = perQuarter.map((p) => p.quarterStage);
  const filedCount = stages.filter((s) => s.status.startsWith("Filed")).length;
  const readyCount = stages.filter((s) => s.status.startsWith("All validations complete")).length;
  const notReadyCount = stages.length - filedCount - readyCount;
  const overall: { label: string; value: string | number }[] = [
    { label: "Quarters", value: quarters.join(", ") },
    { label: "Filed", value: filedCount },
    { label: "Ready to File", value: readyCount },
    { label: "Not Ready", value: notReadyCount },
  ];
  const allReady = stages.every((s) => s.status.startsWith("Filed") || s.status.startsWith("All validations complete"));
  const finalStatus = stages.length === 1
    ? stages[0].status
    : stages.map((s) => `${s.title} — ${s.status}`).join(" | ");

  const overview: OverviewReport = { stages, overall, finalStatus, ready: allReady };

  return { meta, stageReports, overview };
}
