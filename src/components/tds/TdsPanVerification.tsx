import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, CheckCircle2, XCircle, Upload, FileSpreadsheet, Loader2, RotateCcw, X, Play, Users, Trash2, Eye, MinusCircle, AlertTriangle,
} from "lucide-react";
import { readSheetGrids, readDelimitedGrid } from "@/lib/tdsWorkbook";
import { logReconAudit } from "@/lib/tdsReconAudit";
import {
  comparePanVerification, extractTracesRows, panDiagnostics, isPanException, normalizePan, looksLikePan,
  panReason, panRecommendedAction, PAN_OVERRIDE_REASONS, normalizeName as normName,
  type OfficeParty, type TracesPanRow, type TracesMapping, type PanValidationResult, type PanCheckDetail,
} from "@/lib/tdsPanVerification";

/**
 * Stage 2 · PAN Verification — a complete, office-driven PAN audit that mirrors
 * the Stage-1 workflow/UX (Office Data + Imported file → Run Validation → summary
 * cards → detailed record-wise results) but is a fully independent module.
 *
 * Office Data is the MASTER: the audit runs over the quarter's office parties and,
 * for each, finds its PAN in the imported TRACES bulk-PAN file and checks the PAN
 * STATUS it reports. A TRACES PAN with no office party is IGNORED. The office name
 * is NOT compared against the TRACES verified name (that check only ever produced
 * false "Name Mismatch" noise on legitimate short forms) — the verified name is
 * shown as context only. See src/lib/tdsPanVerification.ts.
 *
 * SCOPE: this file + src/lib/tdsPanVerification.ts only.
 */
/** Stage-2 status the parent needs to gate "Mark Return as Ready to File". */
export interface PanStageStatus {
  filingId: string | null;  // the filing this status describes — the parent must match it
  loaded: boolean;       // loadAll has SETTLED for this filing — until then the report is not trustworthy
  applicable: boolean;   // a TRACES file has been imported → PAN verification applies
  ran: boolean;          // the audit has been run (results exist)
  total: number;
  verified: number;
  issues: number;        // unresolved exceptions (not overridden)
  overridden: number;
}

interface Props {
  filing: any;
  selClient: string;
  selFy: string;
  selQuarter: string;
  selForm: string;
  runSignal: number; // legacy: still passed by the parent; Stage 2 no longer auto-runs on it
  resolveFirmId: () => Promise<string | null>;
  disabled?: boolean;
  // Report Stage-2 completion state up to the parent so the filing gate can
  // require Stage-2 to be finished (when applicable) before enabling "Ready to File".
  onStatusChange?: (s: PanStageStatus) => void;
}

interface PanResult {
  id: string;
  quarter: string | null;
  party_name: string | null;      // office (master) party name
  verified_name: string | null;   // TRACES verified name
  pan: string | null;
  pan_status: string | null;
  validation_result: PanValidationResult;
  detail: PanCheckDetail | null;
  overridden: boolean;
  override_reason: string | null;
  overridden_by: string | null;
  overridden_at: string | null;
  office_deductee_id: string | null;
}

type PanFilter = null | "total" | "verified" | "issues" | "overridden";

const RESULT_BADGE: Record<string, string> = {
  "PAN Verified": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "PAN Not Found in TRACES": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Invalid PAN Format": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "PAN Missing in Office Data": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "Invalid PAN": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "PAN Inoperative": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "PAN Status Blank": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "PAN Status Error": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Duplicate PAN Across Parties": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

/** ₹ formatter for the §206AA short-deduction figures. */
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Dashboard-style counter that smoothly animates to its target. */
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current, to = value;
    if (from === to) { setDisplay(to); return; }
    let raf = 0; let start = 0;
    const finish = () => { setDisplay(to); prev.current = to; };
    const step = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / 500);
      setDisplay(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step); else finish();
    };
    raf = requestAnimationFrame(step);
    const safety = setTimeout(finish, 700);
    return () => { cancelAnimationFrame(raf); clearTimeout(safety); };
  }, [value]);
  return <>{display}</>;
}

/** Parse a TRACES Bulk-PAN file (Excel OR delimited .csv/.txt) into PAN rows via
 *  the shared Stage-1 reader (readSheetGrids → TRUE used range, so a bloated-!ref
 *  file can never freeze the tab), then the pure, tested extractTracesRows().
 *  Returns the rows plus a column-mapping report for user transparency. */
async function parseTracesFile(file: File): Promise<{ rows: Omit<TracesPanRow, "row_id">[]; mapping: TracesMapping }> {
  const name = file.name.toLowerCase();
  const grids = (name.endsWith(".csv") || name.endsWith(".txt"))
    ? readDelimitedGrid(await file.text())
    : readSheetGrids(await file.arrayBuffer());
  return extractTracesRows(grids);
}

/** One-line summary of the TRACES column mapping for the import toast, e.g.
 *  "Mapped PAN←'PAN', Status←'PAN Status', Verified Name←'Name as per ITD'." */
function formatTracesMapping(m: TracesMapping): string {
  const parts: string[] = [];
  if (m.pan) parts.push(`PAN←'${m.pan}'`);
  if (m.pan_status) parts.push(`Status←'${m.pan_status}'`);
  if (m.name) parts.push(`Name←'${m.name}'`);
  if (m.verified_name) parts.push(`Verified Name←'${m.verified_name}'`);
  if (m.mismatch_in_name) parts.push(`Mismatch Flag←'${m.mismatch_in_name}'`);
  return parts.length ? `Mapped ${parts.join(", ")}.` : "";
}

export function TdsPanVerification({ filing, selClient, selFy, selQuarter, selForm, resolveFirmId, disabled, onStatusChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [officeParties, setOfficeParties] = useState<OfficeParty[]>([]);
  const [batch, setBatch] = useState<any>(null);        // combined summary (row_count, file_count, representative id)
  const [batches, setBatches] = useState<any[]>([]);    // raw per-file batch rows (file management)
  const [selBatchIds, setSelBatchIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [detailsBatch, setDetailsBatch] = useState<any>(null);
  const [detailsRows, setDetailsRows] = useState<any[] | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [results, setResults] = useState<PanResult[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});

  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [activeFilter, setActiveFilter] = useState<PanFilter>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadSeq = useRef(0); // guards against out-of-order loadAll responses on rapid filing switches
  // The filing id for which loadAll has SETTLED. Read at report time so the parent
  // gate can't trust a status stamped with the new filing but still holding the
  // previous filing's data during the async load window.
  const settledFiling = useRef<string | null>(null);

  const [ovOpen, setOvOpen] = useState(false);
  const [ovTarget, setOvTarget] = useState<PanResult | null>(null);
  const [ovReason, setOvReason] = useState<string>("");
  const [ovOther, setOvOther] = useState("");
  const [savingOv, setSavingOv] = useState(false);

  const filingId = filing?.id ?? null;

  // Office party count + how many carry a PAN (shown on the Office Data card).
  const officeCount = officeParties.length;
  const officePanCount = useMemo(() => officeParties.filter((o) => normalizePan(o.pan)).length, [officeParties]);

  const loadAll = useCallback(async () => {
    // Guard against out-of-order responses: a rapid filing switch fires overlapping
    // loadAll runs; only the newest may write state (mirrors Stage-1's loadSeq).
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;

    setDiagnostics([]); // recomputed on the next Run Validation for the current data
    if (!filingId) { settledFiling.current = null; setBatch(null); setBatches([]); setResults(null); setOfficeParties([]); return; }

    // Office Data (master) — party name + PAN for this quarter's filing.
    const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", filingId);
    if (stale()) return;
    const chIds = (ch || []).map((c: any) => c.id);
    let parties: OfficeParty[] = [];
    if (chIds.length) {
      const { data: ded } = await supabase.from("tds_deductees")
        .select("id, deductee_pan, deductee_name").in("challan_id", chIds);
      if (stale()) return;
      parties = (ded || []).map((d: any) => ({ deductee_id: d.id, pan: d.deductee_pan, name: d.deductee_name }));
    }
    setOfficeParties(parties);

    // ALL TRACES batches for the filing — a firm may split the bulk-PAN output
    // across files, so the audit runs against the UNION (mirrors Stage-1).
    const { data: bs } = await supabase.from("tds_pan_verification_batches").select("*")
      .eq("filing_id", filingId).order("imported_at", { ascending: false });
    if (stale()) return;
    const list = bs || [];
    setBatches(list);
    setSelBatchIds((prev) => { const valid = new Set(list.map((x: any) => x.id)); return new Set([...prev].filter((id) => valid.has(id))); });
    setBatch(list.length ? {
      ...list[0],
      row_count: list.reduce((sum: number, x: any) => sum + (x.row_count || 0), 0),
      file_count: list.length,
    } : null);

    const { data: res } = await supabase.from("tds_pan_verification_results").select("*").eq("filing_id", filingId);
    if (stale()) return;
    // Mark this filing as settled BEFORE the setState that re-fires the status
    // report, so the report carries loaded=true for the now-current data. Placed
    // after the stale-check so a superseded run never marks the wrong filing.
    settledFiling.current = filingId;
    setResults(res && res.length ? (res as PanResult[]) : null);

    const { data: us } = await supabase.from("users").select("id, name").limit(5000);
    if (stale()) return;
    setUserMap(Object.fromEntries((us || []).map((u: any) => [u.id, u.name])));
  }, [filingId]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { setActiveFilter(null); }, [filingId]);

  // ── Core audit: office (master) ↔ the UNION of EVERY TRACES batch ───────────
  // loadSeq-guarded so a filing switch mid-run cannot write the wrong filing's
  // results. Writes results to the DB (for `fId`, always correct) and updates the
  // UI only while the selection is unchanged. Returns the audited rows.
  const runAudit = useCallback(async (fId: string) => {
    const seq = loadSeq.current;
    const firmId = await resolveFirmId();
    const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", fId);
    const chIds = (ch || []).map((c: any) => c.id);
    let office: OfficeParty[] = [];
    if (chIds.length) {
      // Pull the TDS figures too, for the §206AA higher-rate cross-check.
      const { data: ded } = await supabase.from("tds_deductees")
        .select("id, deductee_pan, deductee_name, amount_paid_credited, total_tax_deducted, rate_of_tds, section_code, nature_of_payment, deductee_type, pan_not_available")
        .in("challan_id", chIds);
      office = (ded || []).map((d: any) => ({
        deductee_id: d.id, pan: d.deductee_pan, name: d.deductee_name,
        amount: d.amount_paid_credited, tds: d.total_tax_deducted, rate: d.rate_of_tds,
        section: d.section_code || d.nature_of_payment, deductee_type: d.deductee_type,
        pan_not_available: d.pan_not_available,
      }));
    }
    // UNION of all TRACES rows for the filing, newest import first (created_at
    // desc) so the richer-row dedupe in comparePanVerification prefers the latest.
    const { data: tr } = await supabase.from("tds_pan_verification_rows")
      .select("id, pan, name, verified_name, pan_status, mismatch_in_name")
      .eq("filing_id", fId).order("created_at", { ascending: false });
    const traces: TracesPanRow[] = (tr || []).map((t: any) => ({
      row_id: t.id, pan: t.pan, name: t.name, verified_name: t.verified_name,
      pan_status: t.pan_status, mismatch_in_name: t.mismatch_in_name,
    }));

    const audited = comparePanVerification(office, traces);
    const diag = panDiagnostics(office, traces);

    // Representative (latest) batch for provenance; batch_id is nullable now.
    const { data: latest } = await supabase.from("tds_pan_verification_batches")
      .select("id").eq("filing_id", fId).order("imported_at", { ascending: false }).limit(1).maybeSingle();
    const repBatchId = latest?.id ?? null;

    // Preserve overrides across re-runs, keyed by PAN (stable one-per-PAN). Carry an
    // override ONLY when the exact defect it accepted still stands — if the result
    // changed (e.g. a re-import flips "PAN Verified"→"PAN Inoperative", or a party
    // becomes "PAN Verified"), the old approval no longer applies and the party
    // re-surfaces as a fresh unresolved exception. This also keeps the summary a
    // true partition (a verified row can never also be counted as overridden).
    const { data: prior } = await supabase.from("tds_pan_verification_results")
      .select("id, office_deductee_id, pan, validation_result, overridden, override_reason, overridden_by, overridden_at").eq("filing_id", fId);
    // Key MUST match how comparePanVerification identifies a party: a party with a
    // GENUINE PAN is one audit row per PAN; a party with a missing/invalid/placeholder
    // PAN ("PANNOTAVBL", "NA", …) is audited individually, so it must key by its
    // deductee id — otherwise several placeholder-PAN parties collapse onto one key
    // and overrides get lost or wrongly spread across them.
    const keyOf = (deducteeId: string | null, pan: string | null) => {
      const k = normalizePan(pan);
      return k && looksLikePan(k) ? k : `d:${deducteeId ?? ""}`;
    };
    const priorMap = new Map<string, any>();
    for (const p of prior || []) priorMap.set(keyOf(p.office_deductee_id, p.pan), p);
    const priorIds = (prior || []).map((p: any) => p.id);

    const newRows = audited.map((r) => {
      const carry = priorMap.get(keyOf(r.office_deductee_id, r.pan));
      const keep = !!carry?.overridden && carry.validation_result === r.validation_result;
      return {
        filing_id: fId, batch_id: repBatchId, firm_id: firmId, quarter: selQuarter,
        office_deductee_id: r.office_deductee_id, pan_row_id: r.pan_row_id,
        party_name: r.office_name, verified_name: r.verified_name, pan: r.pan, pan_status: r.pan_status,
        validation_result: r.validation_result, detail: r.detail,
        overridden: keep,
        override_reason: keep ? carry.override_reason : null,
        overridden_by: keep ? carry.overridden_by : null,
        overridden_at: keep ? carry.overridden_at : null,
      };
    });

    const { error: insErr } = await supabase.from("tds_pan_verification_results").insert(newRows);
    if (insErr) throw new Error(insErr.message);
    if (priorIds.length) {
      // Delete the stale prior rows by id. If this fails, the new + old sets coexist
      // (the next run self-heals by treating both as prior), so surface it clearly
      // rather than silently persisting doubled counts.
      const { error: delErr } = await supabase.from("tds_pan_verification_results").delete().in("id", priorIds);
      if (delErr) throw new Error(`Audit saved but the previous rows couldn't be cleared (${delErr.message}). Run Validation again.`);
    }

    // Audit trail: record the verification RUN itself (the compliance act of
    // verifying PANs against TRACES for the quarter), not just later overrides.
    const verified = audited.filter((r) => r.validation_result === "PAN Verified").length;
    const issues = audited.filter((r) => isPanException(r.validation_result)).length;
    await logReconAudit({
      filingId: fId, firmId, userId: user?.id, userName: userMap[user?.id ?? ""],
      actionType: "PAN_VERIFICATION_RUN",
      newValue: `${verified} verified · ${issues} issue(s) / ${audited.length} parties`,
      remark: `PAN verification run against ${traces.length} TRACES row(s)${repBatchId ? "" : " (no batch)"}`,
    });

    if (seq !== loadSeq.current) return audited; // selection changed — don't write UI
    const { data: res } = await supabase.from("tds_pan_verification_results").select("*").eq("filing_id", fId);
    if (seq !== loadSeq.current) return audited;
    setResults((res as PanResult[]) || []);
    setDiagnostics(diag);
    return audited;
  }, [resolveFirmId, selQuarter, user?.id, userMap]);

  const handleImport = async (file: File, replaceBatchId?: string) => {
    if (!filing) return;
    const hadResults = !!results; // a prior audit exists → auto re-run after import
    setImporting(true);
    try {
      const { rows, mapping } = await parseTracesFile(file);
      if (rows.length === 0) throw new Error("No PAN rows found. Expected a TRACES Bulk PAN file (Excel/CSV) with a PAN column.");
      const firmId = await resolveFirmId();

      // Same-name replace: drop any prior batch (+its rows) with this file name so
      // re-importing the SAME file REPLACES it; a DIFFERENT name ACCUMULATES (the
      // audit unions every file). Mirrors Stage-1's importer de-dupe.
      const { data: dup } = await supabase.from("tds_pan_verification_batches").select("id").eq("filing_id", filing.id).eq("file_name", file.name);
      const dupIds = (dup || []).map((b: any) => b.id);
      if (dupIds.length) {
        await supabase.from("tds_pan_verification_rows").delete().in("batch_id", dupIds);
        await supabase.from("tds_pan_verification_batches").delete().in("id", dupIds);
      }

      const { data: batchRow, error: bErr } = await supabase.from("tds_pan_verification_batches").insert({
        filing_id: filing.id, client_id: selClient, firm_id: firmId,
        financial_year: selFy, quarter: selQuarter, form_type: selForm,
        file_name: file.name, row_count: rows.length, status: "imported", imported_by: user?.id,
      }).select("id").single();
      if (bErr || !batchRow) throw new Error(bErr?.message || "Batch insert failed");

      const rowRecords = rows.map((r, i) => ({
        batch_id: batchRow.id, filing_id: filing.id, firm_id: firmId, row_index: i,
        pan: r.pan, name: r.name, verified_name: r.verified_name, pan_status: r.pan_status,
        mismatch_in_name: r.mismatch_in_name, raw: r,
      }));
      // Chunked insert so a large TRACES file (10k–50k PANs) can't fail atomically.
      for (let i = 0; i < rowRecords.length; i += 1000) {
        const { error: rErr } = await supabase.from("tds_pan_verification_rows").insert(rowRecords.slice(i, i + 1000));
        if (rErr) throw new Error(rErr.message);
      }

      // "Replace this file" with a DIFFERENTLY-named file → drop the old batch.
      if (replaceBatchId && replaceBatchId !== batchRow.id && !dupIds.includes(replaceBatchId)) {
        await supabase.from("tds_pan_verification_rows").delete().eq("batch_id", replaceBatchId);
        await supabase.from("tds_pan_verification_batches").delete().eq("id", replaceBatchId);
      }

      // Clear the shown results (the audit is stale until re-run) but DO NOT delete
      // the results table here — runAudit reads it to CARRY FORWARD overrides, and
      // it replaces the rows atomically (insert-new then delete-stale-by-id). A
      // pre-delete would wipe every partner-approved override. If no audit had run,
      // there is nothing to clear and the user runs validation manually.
      setResults(null);
      setDiagnostics([]);
      const mapLine = formatTracesMapping(mapping);
      // Warn when a column the audit relies on could not be detected — so a limited
      // status/name check is visible up front, not silently passed as verified.
      const warns: string[] = [];
      if (!mapping.pan_status) warns.push("no PAN-Status column detected — PAN status can't be checked");
      const warnLine = warns.length ? ` ⚠ ${warns.join("; ")}.` : "";
      toast({
        title: `Imported ${rows.length} PAN record(s)`,
        description: `${file.name}${mapLine ? " · " + mapLine : ""}${warnLine} — ${hadResults ? "re-running audit…" : "click Run Validation to audit."}`,
      });
      await loadAll();
      // Auto re-run the audit if one had already been done (parity with Stage-1).
      if (hadResults) {
        setValidating(true);
        try {
          const audited = await runAudit(filing.id);
          const verified = audited.filter((r) => r.validation_result === "PAN Verified").length;
          toast({ title: "Stage 2 · PAN verification updated", description: `${verified} verified · ${audited.length - verified} issue(s)` });
        } catch (e: any) { toast({ title: "Re-validation failed", description: e.message, variant: "destructive" }); }
        setValidating(false);
      }
    } catch (e: any) {
      toast({ title: "PAN file import failed", description: e.message, variant: "destructive" });
    }
    setImporting(false);
  };

  const handleRunValidation = useCallback(async () => {
    if (!filing || !batch || validating) return;   // guard against overlapping runs (would duplicate result rows)
    setValidating(true);
    try {
      const audited = await runAudit(filing.id);
      const verified = audited.filter((r) => r.validation_result === "PAN Verified").length;
      toast({ title: "Stage 2 · PAN verification complete", description: `${verified} verified · ${audited.length - verified} issue(s) across ${audited.length} office part${audited.length === 1 ? "y" : "ies"}` });
    } catch (e: any) {
      toast({ title: "PAN verification failed", description: e.message, variant: "destructive" });
    }
    setValidating(false);
  }, [filing, batch, validating, runAudit, toast]);

  // ── File management: delete / replace / view details (parity with Stage-1) ───
  const doDeleteBatches = async (ids: string[]) => {
    if (!filing || !ids.length) return;
    setDeleting(true);
    try {
      const hadResults = !!results;
      await supabase.from("tds_pan_verification_rows").delete().in("batch_id", ids);
      await supabase.from("tds_pan_verification_batches").delete().in("id", ids);
      setResults(null);
      setSelBatchIds(new Set());
      toast({ title: ids.length === 1 ? "TRACES file removed" : `${ids.length} files removed`, description: "PAN dataset updated." });
      await loadAll();
      const { data: remain } = await supabase.from("tds_pan_verification_batches").select("id").eq("filing_id", filing.id).limit(1);
      if (remain && remain.length && hadResults) {
        // Files remain and an audit existed → re-run so overrides carry forward
        // (runAudit is the single writer; it never pre-deletes, so approved
        // overrides survive the insert-new-then-delete-stale swap).
        setValidating(true);
        try { await runAudit(filing.id); } catch (e: any) { toast({ title: "Re-validation failed", description: e.message, variant: "destructive" }); }
        setValidating(false);
      } else {
        // No files left, or no prior audit to carry → clear any stale audit rows.
        await supabase.from("tds_pan_verification_results").delete().eq("filing_id", filing.id);
      }
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || "Could not remove file(s)", variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const handleReplaceClick = (batchId: string) => { setReplaceTargetId(batchId); fileInputRef.current?.click(); };

  const openDetails = async (b: any) => {
    setDetailsBatch(b); setDetailsRows(null); setDetailsLoading(true);
    const { data } = await supabase.from("tds_pan_verification_rows").select("*")
      .eq("batch_id", b.id).order("row_index", { ascending: true }).limit(5000);
    setDetailsRows(data || []); setDetailsLoading(false);
  };

  const fmtDateTime = (s?: string) => {
    if (!s) return "";
    try { return new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }); }
    catch { return ""; }
  };
  const toggleSel = (id: string) => setSelBatchIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = batches.length > 0 && selBatchIds.size === batches.length;
  const toggleSelAll = () => setSelBatchIds(allSelected ? new Set() : new Set(batches.map((b) => b.id)));

  const openOverride = (r: PanResult) => { setOvTarget(r); setOvReason(""); setOvOther(""); setOvOpen(true); };

  const saveOverride = async () => {
    if (!ovTarget) return;
    const reason = ovReason === "Other" ? ovOther.trim() : ovReason;
    if (!reason) { toast({ title: "Override reason is required", variant: "destructive" }); return; }
    setSavingOv(true);
    const { error } = await supabase.from("tds_pan_verification_results").update({
      overridden: true, override_reason: reason, overridden_by: user?.id, overridden_at: new Date().toISOString(),
    }).eq("id", ovTarget.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      await logReconAudit({
        filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
        actionType: "PAN_OVERRIDE",
        oldValue: `${ovTarget.party_name || ovTarget.pan} — ${ovTarget.validation_result}`,
        newValue: "Overridden", remark: reason,
      });
      setResults((prev) => prev ? prev.map((x) => x.id === ovTarget.id ? { ...x, overridden: true, override_reason: reason, overridden_by: user?.id ?? null, overridden_at: new Date().toISOString() } : x) : prev);
      toast({ title: "Override recorded" });
      setOvOpen(false);
    }
    setSavingOv(false);
  };

  const undoOverride = async (r: PanResult) => {
    const { error } = await supabase.from("tds_pan_verification_results").update({
      overridden: false, override_reason: null, overridden_by: null, overridden_at: null,
    }).eq("id", r.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await logReconAudit({
      filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
      actionType: "PAN_OVERRIDE_UNDO", oldValue: "Overridden", newValue: r.validation_result, remark: `Override removed for ${r.party_name || r.pan}`,
    });
    setResults((prev) => prev ? prev.map((x) => x.id === r.id ? { ...x, overridden: false, override_reason: null, overridden_by: null, overridden_at: null } : x) : prev);
  };

  // Clean partition mirroring Stage-1: Total = Verified + Issues(unresolved) +
  // Overridden. "Issues" counts UNRESOLVED exceptions only — once a party is
  // overridden it moves to Overridden (so there is no redundant "Pending" card,
  // exactly as in Stage-1). `issuesAll` is the raw exception count kept for the
  // success-state test.
  const summary = useMemo(() => {
    const rs = results || [];
    const exceptions = rs.filter((r) => isPanException(r.validation_result));
    return {
      total: rs.length,
      verified: rs.filter((r) => r.validation_result === "PAN Verified").length,
      issues: exceptions.filter((r) => !r.overridden).length,     // UNRESOLVED
      overridden: rs.filter((r) => r.overridden).length,
    };
  }, [results]);

  // Report Stage-2 state to the parent so it can gate "Mark Return as Ready to
  // File" on Stage-2 completion (when a TRACES file is present). onStatusChange
  // must be a STABLE callback (the parent passes its setState) to avoid a loop.
  useEffect(() => {
    onStatusChange?.({
      filingId: filingId,
      loaded: settledFiling.current === filingId,   // only trustworthy once loadAll settled for THIS filing
      applicable: !!batch,
      ran: results !== null,
      total: summary.total,
      verified: summary.verified,
      issues: summary.issues,
      overridden: summary.overridden,
    });
  }, [filingId, batch, results, summary, onStatusChange]);

  // Issues only (default view), pending first then overridden.
  const issueRows = useMemo(() => {
    const rs = (results || []).filter((r) => isPanException(r.validation_result));
    return rs.sort((a, b) => (a.overridden ? 1 : 0) - (b.overridden ? 1 : 0));
  }, [results]);

  const cardFiltered = useMemo((): PanResult[] | null => {
    const rs = results || [];
    switch (activeFilter) {
      case "total": return rs;
      case "verified": return rs.filter((r) => r.validation_result === "PAN Verified");
      case "issues": return rs.filter((r) => isPanException(r.validation_result) && !r.overridden); // unresolved
      case "overridden": return rs.filter((r) => r.overridden);
      default: return null;
    }
  }, [results, activeFilter]);

  const overrideBtn = (r: PanResult) => (
    r.overridden ? (
      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => undoOverride(r)}><RotateCcw size={12} /> Undo override</Button>
    ) : (
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openOverride(r)} disabled={disabled}><ShieldCheck size={12} /> Override</Button>
    )
  );

  // A ✅/❌ audit line.
  const checkLine = (okState: boolean, text: string) => (
    <p className={cn("text-xs flex items-start gap-1.5", okState ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
      {okState ? <CheckCircle2 size={13} className="mt-px shrink-0" /> : <XCircle size={13} className="mt-px shrink-0" />}
      <span>{text}</span>
    </p>
  );
  // A neutral (not pass / not fail) line — e.g. a check that couldn't be performed.
  const neutralLine = (text: string) => (
    <p className="text-xs flex items-start gap-1.5 text-muted-foreground">
      <MinusCircle size={13} className="mt-px shrink-0" /><span>{text}</span>
    </p>
  );

  // The three-check audit breakdown for a party (PAN found / status / name) plus
  // the §206AA short-deduction and duplicate-PAN detail where relevant.
  const renderChecks = (r: PanResult) => {
    const d = r.detail;
    const found = d ? d.pan_found : r.validation_result !== "PAN Not Found in TRACES" && r.validation_result !== "Invalid PAN Format" && r.validation_result !== "PAN Missing in Office Data";
    const statusOk = (d?.status_class ?? "") === "PAN Verified";
    const sd = d?.short_deduction;
    const dupes = d?.duplicate_names;
    return (
      <div className="space-y-0.5 pt-1">
        {r.validation_result === "PAN Missing in Office Data"
          ? checkLine(false, "No PAN in Office Data — enter the PAN to verify this party.")
          : r.validation_result === "Invalid PAN Format"
          ? checkLine(false, `Office PAN "${r.pan || "—"}" is not a valid PAN format.`)
          : (
          <>
            {checkLine(found, found ? "PAN found in the TRACES file" : "PAN not found in the imported TRACES file")}
            {found && checkLine(statusOk, statusOk ? `PAN status: ${r.pan_status || "Active"}` : `PAN status: ${r.pan_status || r.validation_result}`)}
            {/* The TRACES name is shown as context only — Stage-2 does not compare
                it to the office name, so it never raises an exception. */}
            {found && r.verified_name && normName(r.verified_name) !== normName(r.party_name) && (
              <p className="text-[11px] text-muted-foreground pl-5">Name on PAN records: <b className="text-foreground">{r.verified_name}</b></p>
            )}
          </>
        )}
        {dupes && dupes.length > 1 && (
          <p className="text-[11px] text-destructive pl-5">Same PAN entered for: {dupes.map((n) => `"${n}"`).join(", ")}</p>
        )}
        {sd && (
          <p className="text-[11px] text-destructive pl-5 flex items-start gap-1">
            <AlertTriangle size={11} className="mt-px shrink-0" />
            <span>{sd.basis}: deducted {sd.applied_rate}% but {sd.required_rate}% is required → <b>short deduction {inr(sd.shortfall)}</b> on {inr(sd.amount)}.</span>
          </p>
        )}
      </div>
    );
  };

  // One issue → a full audit card (result, 3-check breakdown, recommendation).
  const renderIssueCard = (r: PanResult) => (
    <Card key={r.id} className={cn(r.overridden ? "border-blue-200 dark:border-blue-900 opacity-80" : "border-destructive/30")}>
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{r.party_name || "—"}</p>
            <p className="text-xs font-mono text-muted-foreground">{r.pan || "—"}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={cn("text-[10px]", RESULT_BADGE[r.validation_result] || "bg-muted")}>{r.validation_result}</Badge>
            {overrideBtn(r)}
          </div>
        </div>
        {renderChecks(r)}
        <p className={cn("text-xs pt-0.5", r.overridden ? "text-blue-600" : "text-destructive")}>
          {r.overridden ? `Overridden — ${r.override_reason || "accepted"}${r.overridden_by && userMap[r.overridden_by] ? ` · ${userMap[r.overridden_by]}` : ""}` : panReason(r.validation_result)}
        </p>
        {!r.overridden && panRecommendedAction(r.validation_result) && (
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Recommended: </span>{panRecommendedAction(r.validation_result)}</p>
        )}
      </CardContent>
    </Card>
  );

  // Verified / matched parties (shown when a card filter is active) → compact table.
  const renderPartyTable = (rows: PanResult[]) => (
    <Card><CardContent className="p-0 overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Office Party</TableHead>
          <TableHead className="w-[130px]">PAN</TableHead>
          <TableHead>TRACES Verified Name</TableHead>
          <TableHead className="w-[130px]">PAN Status</TableHead>
          <TableHead className="w-[130px] text-right">Result</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => {
            const good = r.validation_result === "PAN Verified";
            return (
              <TableRow key={r.id}>
                <TableCell className="text-xs font-medium">{r.party_name || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{r.pan || "—"}</TableCell>
                <TableCell className="text-xs">{r.verified_name || "—"}</TableCell>
                <TableCell className="text-xs">{r.pan_status || "—"}</TableCell>
                <TableCell className="text-right">
                  <span className={cn("inline-flex items-center gap-1 text-xs", good ? "text-emerald-600" : "text-amber-600")}>
                    {good ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {good ? "Verified" : r.validation_result}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </CardContent></Card>
  );

  if (!filing) return null;

  return (
    <div className="space-y-3">
      {/* Inputs: Office Data (master) + Imported TRACES file — mirrors Stage 1. */}
      <div className="grid gap-2 md:grid-cols-2">
        <Card><CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Users size={16} className="text-foreground" />
            <p className="font-semibold text-sm">Office Data <span className="text-muted-foreground font-normal">(master · this quarter)</span></p>
          </div>
          <div className="flex gap-6 text-sm">
            <div><span className="text-lg font-bold">{officeCount}</span> <span className="text-muted-foreground">parties</span></div>
            <div><span className="text-lg font-bold">{officePanCount}</span> <span className="text-muted-foreground">with PAN</span></div>
          </div>
          {officeCount === 0 && <p className="text-xs text-amber-600 mt-2">No office parties yet — enter data in the Data Entry tab first.</p>}
          {officeCount > 0 && officePanCount < officeCount && <p className="text-xs text-amber-600 mt-2">{officeCount - officePanCount} part{officeCount - officePanCount === 1 ? "y has" : "ies have"} no PAN and can't be verified.</p>}
        </CardContent></Card>

        <Card><CardContent className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-sm flex items-center gap-2">
              <FileSpreadsheet size={15} className="text-foreground" /> Imported TRACES File{batches.length > 1 ? "s" : ""}
              {validating && <span className="text-xs text-amber-600 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> verifying…</span>}
            </p>
            <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.csv,.txt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; const tgt = replaceTargetId; setReplaceTargetId(null); if (f) handleImport(f, tgt || undefined); e.currentTarget.value = ""; }} />
            <Button size="sm" variant={batch ? "outline" : "default"} className="gap-1" disabled={importing || disabled}
              onClick={() => { setReplaceTargetId(null); fileInputRef.current?.click(); }}>
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {importing ? "Importing…" : batch ? "Add / re-import file" : "Import TRACES file"}
            </Button>
          </div>
          {batches.length > 0 ? (
            <div className="text-sm">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <span className="text-lg font-bold">{batch?.row_count ?? 0}</span>{" "}
                  <span className="text-muted-foreground text-xs">PANs · {batches.length} file{batches.length > 1 ? "s" : ""}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {selBatchIds.size > 0 && (
                    <Button size="sm" variant="destructive" className="h-7 gap-1 text-xs px-2" disabled={deleting || disabled}
                      onClick={() => setDeleteConfirm({ ids: [...selBatchIds], label: `${selBatchIds.size} selected file(s)` })}>
                      <Trash2 size={12} /> Delete ({selBatchIds.size})
                    </Button>
                  )}
                  {batches.length > 1 && selBatchIds.size === 0 && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive" disabled={deleting || disabled}
                      onClick={() => setDeleteConfirm({ ids: batches.map((b) => b.id), label: "all imported TRACES files" })}>
                      Delete all
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-2 rounded-md border divide-y overflow-hidden">
                {batches.length > 1 && (
                  <label className="flex items-center gap-2 px-2 py-1 bg-muted/40 text-[11px] text-muted-foreground cursor-pointer">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelAll} aria-label="Select all files" className="h-3.5 w-3.5" disabled={disabled} />
                    Select all
                  </label>
                )}
                {batches.map((b: any) => (
                  <div key={b.id} className="flex items-center gap-2 px-2 py-1.5">
                    <Checkbox checked={selBatchIds.has(b.id)} onCheckedChange={() => toggleSel(b.id)} aria-label={`Select ${b.file_name || "file"}`} className="h-3.5 w-3.5" disabled={disabled} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-xs truncate">{b.file_name || "(unnamed file)"}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{b.row_count} PANs{b.imported_at ? ` · ${fmtDateTime(b.imported_at)}` : ""}</p>
                    </div>
                    <div className="flex items-center shrink-0">
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="View details" onClick={() => openDetails(b)}><Eye size={13} /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="Replace this file" disabled={importing || deleting || disabled} onClick={() => handleReplaceClick(b.id)}><RotateCcw size={13} /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" title="Delete this file" disabled={deleting || disabled}
                        onClick={() => setDeleteConfirm({ ids: [b.id], label: b.file_name || "this file" })}><Trash2 size={13} /></Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">Split the bulk-PAN output across files? Add them — all are audited together. Re-importing the same file name replaces it; adding, replacing or deleting a file re-runs the audit automatically.</p>
            </div>
          ) : <p className="text-xs text-muted-foreground">Import the TRACES Bulk PAN Verification file (.xls / .xlsx / .csv), then click <b>Run Validation</b>. You can add multiple files and they're audited together. Stage 2 is optional.</p>}
        </CardContent></Card>
      </div>

      {/* Stage-2's own Run Validation — the audit (and its summary) run only on click. */}
      <div className="flex items-center gap-3">
        <Button className="gap-2 font-semibold h-9" onClick={handleRunValidation}
          disabled={validating || !batch || officeCount === 0 || disabled}>
          {validating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {validating ? "Validating…" : "Run Validation"}
        </Button>
        {!batch
          ? <span className="text-xs text-muted-foreground">Import the TRACES file to enable PAN verification.</span>
          : officeCount === 0
          ? <span className="text-xs text-muted-foreground">No office parties to verify — add data in the Data Entry tab first.</span>
          : null}
      </div>

      {results && (
        <>
          {/* Diagnostics — plain-language reasons for a low verified count. */}
          {diagnostics.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
              <CardContent className="p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Things to check</p>
                <ul className="text-xs text-amber-800 dark:text-amber-200 list-disc pl-4 space-y-0.5">
                  {diagnostics.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Summary cards — Total / Verified / Issues / Overridden (clean partition,
              mirrors Stage-1; "Issues" = unresolved, so no redundant "Pending" card). */}
          <div className={cn("grid grid-cols-2 sm:grid-cols-4 gap-2", validating && "animate-pulse")}>
            {([
              { key: "total" as const, label: "Total Parties", value: summary.total, cls: "" },
              { key: "verified" as const, label: "Verified", value: summary.verified, cls: "text-emerald-600" },
              { key: "issues" as const, label: "Issues", value: summary.issues, cls: summary.issues > 0 ? "text-destructive" : "text-emerald-600" },
              { key: "overridden" as const, label: "Overridden", value: summary.overridden, cls: "text-blue-600" },
            ]).map((s) => (
              <button key={s.label} type="button"
                onClick={() => setActiveFilter(activeFilter === s.key ? null : s.key)}
                aria-pressed={activeFilter === s.key}
                className={cn(
                  "rounded-md border bg-card p-2 text-center transition-all hover:border-primary/50 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  activeFilter === s.key ? "ring-2 ring-primary border-primary" : "border-border",
                )}>
                <p className={cn("text-xl font-bold tabular-nums", s.cls)}><AnimatedNumber value={s.value} /></p>
                <p className="text-[11px] text-muted-foreground leading-tight">{s.label}</p>
              </button>
            ))}
          </div>

          {cardFiltered !== null ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-muted-foreground">Showing <b className="text-foreground">{cardFiltered.length}</b> record{cardFiltered.length === 1 ? "" : "s"}</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setActiveFilter(null)}><X size={11} /> Clear filter</Button>
              </div>
              {cardFiltered.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed">No {activeFilter} records found.</div>
              ) : (
                <div className="space-y-3">
                  {cardFiltered.filter((r) => isPanException(r.validation_result)).map(renderIssueCard)}
                  {cardFiltered.some((r) => !isPanException(r.validation_result)) && renderPartyTable(cardFiltered.filter((r) => !isPanException(r.validation_result)))}
                </div>
              )}
            </div>
          ) : summary.total === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed">No office parties to verify for this filing — add data in the Data Entry tab.</div>
          ) : issueRows.length === 0 ? (
            <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={22} className="text-emerald-600" />
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">PAN Verification Completed Successfully</p>
                </div>
                <div className="text-sm text-foreground grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 max-w-xl">
                  <span className="text-muted-foreground">Total Parties</span><span className="font-semibold">{summary.total}</span>
                  <span className="text-muted-foreground">Verified</span><span className="font-semibold text-emerald-600">{summary.verified}</span>
                  <span className="text-muted-foreground">Overridden</span><span className="font-semibold">{summary.overridden}</span>
                </div>
                <p className="text-sm text-muted-foreground">Every office PAN was found in TRACES, active/valid, and the names matched. No issues were found.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">{issueRows.map(renderIssueCard)}</div>
          )}
        </>
      )}

      {/* Override dialog — mandatory reason */}
      <Dialog open={ovOpen} onOpenChange={setOvOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Override — {ovTarget?.validation_result}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{ovTarget?.party_name} · {ovTarget?.pan}</p>
            {ovTarget?.verified_name && ovTarget.verified_name !== ovTarget.party_name && (
              <p className="text-xs text-muted-foreground">TRACES verified name: <b className="text-foreground">{ovTarget.verified_name}</b></p>
            )}
            {ovTarget?.detail?.short_deduction && (
              <div className="flex items-start gap-2 p-2 rounded-md border border-destructive/30 bg-destructive/5 text-xs text-destructive">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                <span>{ovTarget.detail.short_deduction.basis}: TDS was deducted at {ovTarget.detail.short_deduction.applied_rate}% but {ovTarget.detail.short_deduction.required_rate}% is required — a short deduction of <b>{inr(ovTarget.detail.short_deduction.shortfall)}</b> (plus §201(1A) interest). Overriding accepts this exposure.</span>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Override reason <span className="text-destructive">*</span></Label>
              <Select value={ovReason} onValueChange={setOvReason}>
                <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>{PAN_OVERRIDE_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {ovReason === "Other" && (
              <div className="space-y-1">
                <Label className="text-xs">Please specify <span className="text-destructive">*</span></Label>
                <Textarea value={ovOther} onChange={(e) => setOvOther(e.target.value)} rows={2} placeholder="Enter the override reason" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOvOpen(false)}>Cancel</Button>
            <Button onClick={saveOverride} disabled={savingOv || !ovReason || (ovReason === "Other" && !ovOther.trim())}>
              {savingOv ? "Saving…" : "Confirm Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm TRACES file deletion */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Trash2 size={16} className="text-destructive" /> Remove {deleteConfirm?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {deleteConfirm && deleteConfirm.ids.length > 1 ? `these ${deleteConfirm.ids.length} files` : "this file"} and every PAN row imported from {deleteConfirm && deleteConfirm.ids.length > 1 ? "them" : "it"}. The audit re-runs automatically on the remaining files. This can't be undone — you'd need to re-import.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); if (deleteConfirm) doDeleteBatches(deleteConfirm.ids); }} disabled={deleting}>
              {deleting ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Imported TRACES-file details */}
      <Dialog open={!!detailsBatch} onOpenChange={(o) => { if (!o) { setDetailsBatch(null); setDetailsRows(null); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileSpreadsheet size={15} /> {detailsBatch?.file_name || "Imported TRACES file"}
              <span className="text-xs font-normal text-muted-foreground">
                {detailsBatch ? `· ${detailsBatch.row_count} PANs · ${fmtDateTime(detailsBatch.imported_at)}` : ""}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            {detailsLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading rows…</div>
            ) : detailsRows && detailsRows.length ? (
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-8 text-[11px]">#</TableHead>
                    <TableHead className="text-[11px]">PAN</TableHead>
                    <TableHead className="text-[11px]">Name</TableHead>
                    <TableHead className="text-[11px]">Verified Name</TableHead>
                    <TableHead className="text-[11px]">PAN Status</TableHead>
                    <TableHead className="text-[11px]">Mismatch</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailsRows.map((r: any, i: number) => (
                    <TableRow key={r.id || i}>
                      <TableCell className="text-[11px] text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-[11px] font-mono">{r.pan || "—"}</TableCell>
                      <TableCell className="text-[11px] max-w-[180px] truncate">{r.name || "—"}</TableCell>
                      <TableCell className="text-[11px] max-w-[180px] truncate">{r.verified_name || "—"}</TableCell>
                      <TableCell className="text-[11px]">{r.pan_status || "—"}</TableCell>
                      <TableCell className="text-[11px]">{r.mismatch_in_name || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-6 text-center text-sm text-muted-foreground">No rows in this file.</div>
            )}
          </div>
          {detailsRows && detailsRows.length >= 5000 && (
            <p className="text-[11px] text-muted-foreground">Showing the first 5,000 rows.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDetailsBatch(null); setDetailsRows(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
