import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadTdsImportFile } from "@/lib/tds/uploadImportFile";
import { downloadStorageFile, removePublicDocumentByUrl } from "@/lib/openStorageFile";
import { isQuarterInTdsRange, clientHasTdsForm } from "@/lib/tdsQuarter";
import { markUnderProcessIfNotStarted } from "@/lib/tds/filingActivity";
import { computeChallanOverApplied } from "@/lib/tds/rateEngine";
import { READY_TO_FILE_STATUS, isProcessedWorkStatus } from "@/components/tds/TdsFilingsManager";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TdsExportMenu } from "./TdsExportMenu";
import { ErrorTypeBreakdown, filterByErrorType } from "./ErrorTypeBreakdown";
import { reportFileName, FIELD_LABELS, reasonFor, errorTypeFor, type StageReport, type ReportMeta, type OverviewReport, type AuditRow } from "@/lib/tds/tdsReport";
import { buildOverviewWorkbook, downloadWorkbook } from "@/lib/tds/tdsReportExcel";
import { exportOverviewPdf } from "@/lib/tds/tdsReportPdf";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, AlertTriangle, CheckCircle2, Upload, Play, FileSpreadsheet,
  RotateCcw, Loader2, Users, FileWarning, Info, X, BadgeCheck, Trash2, Eye, BookOpen, ClipboardCheck,
  ChevronDown, ChevronRight, Lock,
} from "lucide-react";
import { parseWorkbookRows, parseCsvRows } from "@/lib/tdsWorkbook";
import { logReconAudit } from "@/lib/tdsReconAudit";
import { TdsPanVerification, type PanStageStatus } from "./TdsPanVerification";
import { TdsChallanDownloadValidation, type ChallanDownloadStageStatus } from "./TdsChallanDownloadValidation";
import { TdsTallyRecon, type TallyStageStatus } from "./TdsTallyRecon";

interface ClientOption {
  id: string; name: string | null; pan: string | null; tan_number?: string | null;
  tds_start_fy?: string; tds_start_quarter?: string; tds_end_fy?: string; tds_end_quarter?: string;
  tds_forms_applicable?: string[];
}

interface Props {
  clients: ClientOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
  onNavigateDataEntry?: (filingId: string) => void;
  // Shared Workspace filing context (owned by the parent TdsFilings page). Data
  // Entry is the SINGLE SOURCE OF TRUTH for the selection — here it is READ-ONLY
  // (no duplicate selectors), so these are values only, not setters.
  selClient: string;
  selFy: string;
  selQuarter: string;
  selForm: string;
  // Bumped by the parent whenever the Dashboard's Validate & Finalise "Ready"
  // link navigates here for a specific filing — forces the Stage tab back to
  // "1" regardless of whichever stage this component was last left on.
  forceStage1Signal?: number;
}

interface FieldDiff {
  field: string;
  office: unknown;
  imported: unknown;
  matched: boolean;
  difference?: string;
}
interface ReconResult {
  id: string;
  office_deductee_id: string | null;
  imported_row_id: string | null;
  record_label: string | null;
  match_status: "matched" | "mismatched" | "office_only" | "imported_only";
  mismatch_fields: string[] | null;
  field_diffs: FieldDiff[] | null;
  overridden: boolean;
  overridden_by?: string | null;
  override_note?: string | null;
}

const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
};

/** All 7 compared fields, in fixed order. */
const DIFF_FIELDS = ["name", "pan", "date", "amount", "tds", "interest", "section"] as const;

/** Downloads a same-origin static template asset via a synthesized <a> click
 * rather than a plain JSX anchor, so this works the same way from inside a
 * DropdownMenuItem's onClick as it would from a standalone button — avoids
 * DropdownMenuItem asChild (a Radix pattern that has crashed this module at
 * render time before, invisibly to tsc/build/vitest — see TdsFilingsManager's
 * viewAckFile/downloadAckFile for the same anchor-click convention). */
function downloadTemplateFile(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Bump this string every time public/templates/TDS_Data_Entry_Simple_Template.xlsx
 * is regenerated. Without a query param the browser (and any intermediate cache)
 * has no signal that the file at this exact URL ever changed, and can keep
 * serving a stale copy indefinitely even after a fresh deploy — this is why
 * template fixes kept appearing to "not work" despite the source being correct. */
const TDS_TEMPLATE_VERSION = "2026-09-24-2";

/** Invoke an edge function and surface the function's own JSON error message.
 * When the platform kills the worker (wall-clock timeout / OOM), there is NO
 * JSON body and supabase-js throws a bare "Edge Function returned a non-2xx
 * status code" — map those body-less cases to an actionable message instead. */
async function invokeFn(name: string, body: unknown, opts?: { signal?: AbortSignal }): Promise<any> {
  // `signal` is passed opportunistically (some supabase-js versions honour it);
  // handleImport also races the call against the same abort, so the UI is
  // bounded even when the SDK ignores it. Cast to keep TS happy across versions.
  const invokeOpts: any = { body, ...(opts?.signal ? { signal: opts.signal } : {}) };
  const { data, error } = await supabase.functions.invoke(name, invokeOpts);
  if (error) {
    let msg = error.message;
    let status = 0;
    try {
      const ctx = (error as any).context;
      status = ctx?.status ?? 0;
      const j = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      // Accept any of the shapes a function or the platform may return.
      const fromBody = j?.error ?? j?.msg ?? j?.message ?? (typeof j?.code === "string" ? j.code : "");
      if (fromBody) msg = String(fromBody);
      else if (status === 504 || status === 546 || status === 502 || status === 500) {
        msg = "The server took too long or ran out of memory while importing. Try importing fewer rows, or split the file into smaller sheets.";
      }
    } catch {
      // No parseable body (a platform kill) — infer from the status.
      if (status === 504 || status === 546 || status === 502 || status === 500) {
        msg = "The server took too long or ran out of memory while importing. Try importing fewer rows, or split the file into smaller sheets.";
      }
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Human-readable one-line summary of the importer's column-mapping decisions,
// e.g. "Mapped Name←‘Party's Name’, PAN←‘PAN’, Amount←‘Bill Amt.’, TDS←‘TDS Amt’".
// Shown after every import so the user can verify the mapping before comparing.
const MAP_FIELD_LABELS: Record<string, string> = {
  deductee_name: "Name", pan: "PAN", section_code: "Section",
  amount_paid: "Amount", tds_amount: "TDS", interest: "Interest",
  rate: "Rate", date_of_payment: "Date",
};
function formatMappingSummary(fields: Record<string, { column: string; by: string }>): string {
  const order = ["deductee_name", "pan", "section_code", "amount_paid", "tds_amount", "date_of_payment", "interest", "rate"];
  const parts = order
    .filter((f) => fields[f]?.column)
    .map((f) => `${MAP_FIELD_LABELS[f] || f}←‘${fields[f].column.replace(/\s+/g, " ").trim()}’`);
  return parts.length ? `Mapped ${parts.join(", ")}.` : "";
}

// ── Off-main-thread file parsing ────────────────────────────────────────────
// A single reused module worker parses Excel/CSV so a large workbook never
// blocks the UI thread ("Page Unresponsive"). Falls back to a main-thread parse
// (same shared code) only if the worker can't be constructed in this environment.
let importWorker: Worker | null = null;
let importWorkerBroken = false;
function getImportWorker(): Worker | null {
  if (importWorkerBroken) return null;
  if (importWorker) return importWorker;
  try {
    importWorker = new Worker(new URL("../../workers/tdsImportParser.worker.ts", import.meta.url), { type: "module" });
    return importWorker;
  } catch { importWorkerBroken = true; return null; }
}
let workerReqId = 0;
type WorkerProgress = { stage: string; sheet?: number; totalSheets?: number; rows?: number; elapsedMs?: number };
// If the worker reports NO progress for this long, treat the parse as stuck,
// terminate it (a hung worker can't be reused) and surface an actionable error —
// this is the hard guarantee that the import can never hang indefinitely on
// "Reading file…".
const PARSE_STALL_MS = 60_000;
function parseInWorker(
  payload: { fileType: "xlsx"; buffer: ArrayBuffer } | { fileType: "csv"; text: string },
  onProgress?: (p: WorkerProgress) => void,
): Promise<Record<string, unknown>[]> {
  const worker = getImportWorker();
  if (!worker) return Promise.reject(new Error("worker-unavailable"));
  const id = ++workerReqId;
  return new Promise((resolve, reject) => {
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const arm = () => { if (watchdog) clearTimeout(watchdog); watchdog = setTimeout(onStall, PARSE_STALL_MS); };
    const cleanup = () => { if (watchdog) clearTimeout(watchdog); worker.removeEventListener("message", onMsg); worker.removeEventListener("error", onErr); };
    const onStall = () => {
      cleanup();
      try { worker.terminate(); } catch { /* ignore */ }
      importWorker = null; importWorkerBroken = false; // drop the hung worker; a fresh one is made next time
      reject(new Error("parse-stalled"));
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.id !== id) return;
      if (d.type === "progress") { arm(); onProgress?.(d as WorkerProgress); return; } // progress keeps the watchdog alive
      cleanup();
      if (d.ok) resolve(d.rows); else reject(new Error(d.error || "Could not parse the file"));
    };
    // A worker runtime error → drop this worker so a FRESH one is built next
    // import (don't permanently disable — that would force every later import
    // onto the main thread for the whole session over a one-off error).
    const onErr = (ev: ErrorEvent) => { cleanup(); importWorker = null; reject(new Error(ev.message || "worker-error")); };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    arm();
    // MUST include `id` so the worker can echo it and onMsg's `d.id === id`
    // guard accepts the reply — without it every worker message is ignored and
    // the promise hangs until the watchdog fires. Structured-clone (no transfer)
    // keeps the buffer valid for a main-thread fallback if the worker errors.
    worker.postMessage({ ...payload, id });
  });
}

/** A number that smoothly counts up/down to its target (dashboard-style). */
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
      setDisplay(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)))); // easeOutCubic
      if (t < 1) raf = requestAnimationFrame(step); else finish();
    };
    raf = requestAnimationFrame(step);
    // Safety: guarantee the final value lands even where rAF is throttled/paused
    // (an inactive/background tab), so a counter is never stuck mid-animation.
    const safety = setTimeout(finish, 700);
    return () => { cancelAnimationFrame(raf); clearTimeout(safety); };
  }, [value]);
  return <>{display}</>;
}

type FilterKey = null | "total" | "matched" | "mismatched" | "overridden";

// A Stage-2 status that BLOCKS filing — the gate starts here and returns here on
// every selection change, so it can never enable off a previous filing's report.
const PAN_STATUS_BLOCKED: PanStageStatus = { filingId: null, loaded: false, applicable: false, ran: false, total: 0, verified: 0, issues: 0, overridden: 0 };

export function TdsValidateFinalise({
  clients, isSuperadmin, resolveFirmId, onNavigateDataEntry,
  selClient, selFy, selQuarter, selForm, forceStage1Signal,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [resolving, setResolving] = useState(false);
  const [filing, setFiling] = useState<any>(null);
  const [officeCount, setOfficeCount] = useState({ deductees: 0, challans: 0 });
  // Challans (of THIS filing) that are over-applied — a hard pre-flight gate
  // on Run Validation. Each challan's deductees are pulled UNFILTERED by
  // filing_id (challan_id only) — same reason officeCount's own deductee
  // count is scoped by filing_id and NOT this, per the comment on that fetch:
  // a challan is often a combined payment shared across a client's 24Q and
  // 26Q filings, so checking only this filing's own rows would miss a
  // shortfall caused by the OTHER form's usage of the same challan.
  const [overAppliedChallans, setOverAppliedChallans] = useState<{ id: string; challanNo: string | null; shortfall: number }[]>([]);
  const [batch, setBatch] = useState<any>(null);       // combined summary (row_count, file_count, representative id)
  const [batches, setBatches] = useState<any[]>([]);   // raw per-file batch rows (for file management)
  const [selBatchIds, setSelBatchIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [detailsBatch, setDetailsBatch] = useState<any>(null);
  const [detailsRows, setDetailsRows] = useState<any[] | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [results, setResults] = useState<ReconResult[] | null>(null);
  const [userMap, setUserMap] = useState<Record<string, string>>({});

  // Any Validate & Finalise activity (Stage 1 import/compare here, or Stage
  // 2/3 below via the onActivity prop) auto-advances a fresh filing out of
  // "Not Started" — mirrors the same helper Data Entry uses, so the Status
  // dropdown never needs a manual nudge just because work has begun.
  const bumpUnderProcess = useCallback(async () => {
    if (!filing) return;
    const flipped = await markUnderProcessIfNotStarted(filing.id, filing.work_status, user?.id);
    if (flipped) setFiling((prev: any) => (prev ? { ...prev, work_status: "Under Process" } : prev));
  }, [filing, user?.id]);

  const [importing, setImporting] = useState(false);
  const [importStage, setImportStage] = useState<string>("");
  const [importPct, setImportPct] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Stage-4 Checker Review — one card section per stage (not a flat table) so
  // each stage's exceptions keep their own vocabulary; "all" = no filter.
  const [auditStatusFilter, setAuditStatusFilter] = useState<string>("all");
  const [auditErrorTypeFilter, setAuditErrorTypeFilter] = useState<string>("all");
  // Sections start expanded — the checker must see every exception before
  // signing, so nothing is hidden by default; collapsing is a manual choice.
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set());
  // Digital signature — persisted as a tds_filing_audit_log entry (no schema
  // change needed), so it survives a refresh and carries its own audit trail.
  const [signature, setSignature] = useState<{ signedByName: string; signedAt: string } | null>(null);
  const [attestChecked, setAttestChecked] = useState(false);
  const [signing, setSigning] = useState(false);
  // Edit-access request/approval — the ONLY way to change a "Ready to File"
  // return, other than a Firm Admin/Super Admin using Revoke Signature
  // themselves. Only the LATEST request per filing is tracked; a resolved
  // (approved/rejected) one is replaced the next time someone requests again.
  const [editRequest, setEditRequest] = useState<any>(null);
  const [editRequestReason, setEditRequestReason] = useState("");
  const [requestingEdit, setRequestingEdit] = useState(false);
  const [reviewingRequest, setReviewingRequest] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [runSignal, setRunSignal] = useState(0);
  // Which stage tab is showing. The stages are a SEQUENCE (data -> PAN -> ledger),
  // so they get their own tabs instead of one long scroll, and the Finalise
  // summary lives only on the last one.
  const [stage, setStage] = useState<"1" | "2" | "3" | "4">("1");
  // The Dashboard's "Ready" link is only ever useful if it actually lands on
  // Stage 1 — without this, arriving here after a previous session left the
  // tab on Stage 3 (say) would silently show the wrong stage.
  useEffect(() => { setStage("1"); }, [forceStage1Signal]);
  const [activeFilter, setActiveFilter] = useState<FilterKey>(null); // clicked summary card
  // Secondary breakdown WITHIN the mismatch list, by the specific match_status
  // (e.g. "Office Data Only" vs "Imported Data Only") — see ErrorTypeBreakdown.
  const [errorTypeFilter, setErrorTypeFilter] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadSeq = useRef(0); // guards against out-of-order loadAll responses

  // Override dialog (mandatory reason + audit trail)
  const [ovOpen, setOvOpen] = useState(false);
  const [ovTarget, setOvTarget] = useState<ReconResult | null>(null);
  const [ovReason, setOvReason] = useState("");
  const [savingOv, setSavingOv] = useState(false);

  // TDS Compliance is the single source of truth for module membership. Returns
  // a human message when the selected combination is outside the client's config.
  const complianceError = useCallback((): string | null => {
    const c = clients.find(x => x.id === selClient);
    if (!c) return null;
    if (!c.tds_start_fy) {
      return "This client has no TDS Compliance / Start Quarter set in Edit Client → Service Specific.";
    }
    if (!isQuarterInTdsRange(selFy, selQuarter, c.tds_start_fy, c.tds_start_quarter || "Q1", c.tds_end_fy, c.tds_end_quarter)) {
      const label = `${c.tds_start_quarter} ${c.tds_start_fy}` +
        (c.tds_end_fy ? ` to ${c.tds_end_quarter} ${c.tds_end_fy}` : " onward");
      return `Outside this client's TDS compliance period (${label}).`;
    }
    if (!clientHasTdsForm(c.tds_forms_applicable, selForm)) {
      return `This client is not configured for ${selForm} under TDS Compliance.`;
    }
    return null;
  }, [clients, selClient, selFy, selQuarter, selForm]);

  // Resolve the filing for the selected combination + hydrate any existing
  // import batch / comparison results (durable — survives refresh).
  const loadAll = useCallback(async () => {
    // Guard against out-of-order responses: a rapid client/quarter switch fires
    // overlapping loadAll runs, and the LAST to resolve must not overwrite the
    // current selection's data. Only the newest run may call setState.
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;

    if (!selClient || complianceError()) {
      setFiling(null); setBatch(null); setBatches([]); setResults(null);
      setOfficeCount({ deductees: 0, challans: 0 });
      return;
    }
    setResolving(true);
    const { data: fData } = await supabase.from("tds_filings").select("*")
      .eq("client_id", selClient).eq("financial_year", selFy).eq("quarter", selQuarter).limit(10);
    if (stale()) return;
    const match = (fData || []).find((f: any) => (f.tds_forms || []).includes(selForm)) || null;
    setFiling(match);
    if (!match) {
      setBatch(null); setBatches([]); setResults(null); setOfficeCount({ deductees: 0, challans: 0 });
      setResolving(false); return;
    }

    // Deliberately NOT correction-aware — the Validation stage checks the
    // return exactly as filed against the imported file, independent of
    // whether a correction has since been raised. A correction is a later,
    // separate event; running Stage 1-3 against getEffectiveClientLedger()
    // here (as tried once, then reverted per explicit user instruction) would
    // make Validation's verdict shift depending on unrelated correction
    // activity instead of staying a fixed record of what was checked at
    // filing time. TDS Reports (which describe "current state") and
    // TdsDataEntry's carry-forward math (cross-quarter balance) are the
    // correct, intentional users of the correction-aware ledger — this
    // screen must not become a third.
    const { data: ch } = await supabase.from("tds_challans")
      .select("id, challan_serial_no, total_challan_amount, late_fees_234e, kasar_vatav_amount, deposit_date")
      .eq("filing_id", match.id);
    if (stale()) return;
    const chIds = (ch || []).map((c: any) => c.id);
    // Deductee count is scoped by the deductee's OWN filing_id, not by "attached
    // to one of this filing's challans" — a challan is often reused across a
    // client's 24Q and 26Q filings for the same combined bank deposit, so
    // scoping by challan_id alone double-counted the OTHER filing's deductees
    // into this card too. See the matching fix in supabase/functions/
    // tds-recon-compare/index.ts for the full explanation.
    const { count } = await supabase.from("tds_deductees").select("id", { count: "exact", head: true }).eq("filing_id", match.id);
    if (stale()) return;
    setOfficeCount({ deductees: count || 0, challans: chIds.length });

    // Over-applied pre-flight check — see computeChallanOverApplied's own doc
    // for why this is the ONE definition, matching the "Over-applied" badge
    // TdsDataEntry.tsx's challan card already shows. Deductees fetched by
    // challan_id ONLY (not filing_id) for the combined-payment reason above.
    if (chIds.length) {
      const { data: chDeds } = await supabase.from("tds_deductees")
        .select("challan_id, total_tax_deducted, tds_amount, interest_amount, surcharge_amount, date_of_payment")
        .in("challan_id", chIds);
      if (stale()) return;
      const byChallan = new Map<string, typeof chDeds>();
      for (const d of chDeds || []) {
        const g = byChallan.get(d.challan_id as string); if (g) g.push(d); else byChallan.set(d.challan_id as string, [d]);
      }
      const overApplied = (ch || [])
        .map((c: any) => {
          const { overApplied, effectiveApplied, allocatable } = computeChallanOverApplied(c, byChallan.get(c.id) || []);
          return overApplied ? { id: c.id, challanNo: c.challan_serial_no as string | null, shortfall: effectiveApplied - allocatable } : null;
        })
        .filter((x): x is { id: string; challanNo: string | null; shortfall: number } => x != null);
      setOverAppliedChallans(overApplied);
    } else {
      setOverAppliedChallans([]);
    }

    // Load ALL import batches for the filing (a client may keep sections/months
    // in separate files) and present a COMBINED view — total records across every
    // file + the file list — since validation runs against the merged dataset.
    const { data: batches } = await supabase.from("tds_import_batches").select("*")
      .eq("filing_id", match.id).order("imported_at", { ascending: false });
    if (stale()) return;
    const bs = batches || [];
    setBatches(bs);
    // Drop any selection for files that no longer exist (e.g. after a delete).
    setSelBatchIds((prev) => {
      const valid = new Set(bs.map((x: any) => x.id));
      return new Set([...prev].filter((id) => valid.has(id)));
    });
    setBatch(bs.length ? {
      ...bs[0],
      row_count: bs.reduce((sum: number, x: any) => sum + (x.row_count || 0), 0),
      files: bs.map((x: any) => ({ name: x.file_name, type: x.file_type, count: x.row_count })),
      file_count: bs.length,
    } : null);

    const { data: res } = await supabase.from("tds_recon_results").select("*").eq("filing_id", match.id);
    if (stale()) return;
    setResults(res && res.length ? (res as ReconResult[]) : null);

    const { data: us } = await supabase.from("users").select("id, name").limit(5000);
    if (stale()) return;
    setUserMap(Object.fromEntries((us || []).map((u: any) => [u.id, u.name])));

    // The checker's digital signature — the LATEST of the two action types for
    // this filing decides current state (a later revoke undoes an earlier sign).
    const { data: sigRows } = await supabase.from("tds_filing_audit_log")
      .select("action_type, new_value, changed_at")
      .eq("filing_id", match.id)
      .in("action_type", ["CHECKER_SIGNATURE", "CHECKER_SIGNATURE_REVOKED"])
      .order("changed_at", { ascending: false })
      .limit(1);
    if (stale()) return;
    const latestSig = (sigRows || [])[0];
    setSignature(latestSig && latestSig.action_type === "CHECKER_SIGNATURE" && latestSig.changed_at
      ? { signedByName: latestSig.new_value || "—", signedAt: latestSig.changed_at }
      : null);

    // The latest edit-access request for this filing — a resolved one still
    // shows (its outcome), but a new request replaces it as "the latest" the
    // next time someone submits one.
    const { data: reqRows } = await supabase.from("tds_edit_requests" as any)
      .select("*").eq("filing_id", match.id).order("created_at", { ascending: false }).limit(1);
    if (stale()) return;
    setEditRequest((reqRows || [])[0] ?? null);
    setResolving(false);
  }, [selClient, selFy, selQuarter, selForm, complianceError]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Live sync with Data Entry ──────────────────────────────────────────────
  // Data Entry and Validate & Finalise are SIBLING tabs that stay mounted (see
  // TdsFilings.tsx's `hidden` class toggle — switching tabs never unmounts
  // either), so an edit made in Data Entry does not, by itself, cause this
  // screen's office counts / over-applied pre-flight check to refetch. Without
  // this, fixing an over-applied challan in Data Entry left this screen
  // showing the stale pre-fix "over-applied" verdict until the user changed
  // the client/FY/quarter/form selection — read as "Validate & Finalise and
  // Data Entry disagree" when the underlying data was already consistent.
  // tds_challans/tds_deductees are already on the realtime publication (see
  // 20260729161000_tds_data_entry_realtime.sql, added for the client Portal).
  const loadAllRef = useRef(loadAll);
  loadAllRef.current = loadAll;
  useEffect(() => {
    const channel = supabase
      .channel("tds-vf-office-data-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_challans" }, () => loadAllRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "tds_deductees" }, () => loadAllRef.current())
      .subscribe((status) => {
        // On (re)connect, pull once so any Data Entry edit made while the
        // socket was down is picked up immediately.
        if (status === "SUBSCRIBED") loadAllRef.current();
      });
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Any source format → a normalised payload the importer understands ────────
  // rows (tabular) · pdf_base64 · image_base64 (scanned/photo) · raw_text (text).
  const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", heic: "image/heic", heif: "image/heif" };
  // Base64 without loading the whole file into a data-URL string on the main
  // thread twice — read as ArrayBuffer and encode in chunks.
  const fileToBase64 = async (file: File): Promise<string> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return btoa(binary);
  };
  // Excel/CSV parse: off the main thread (Web Worker), with a main-thread
  // fallback using the SAME shared code so a large workbook never freezes the tab.
  // A "parse-stalled" from the worker is NOT retried on the main thread (that
  // would just freeze the tab redoing the stuck work) — it surfaces as an error.
  const parseTabular = async (
    payload: { fileType: "xlsx"; buffer: ArrayBuffer } | { fileType: "csv"; text: string },
    fallback: () => Record<string, unknown>[],
    onProgress?: (p: WorkerProgress) => void,
  ): Promise<Record<string, unknown>[]> => {
    try { return await parseInWorker(payload, onProgress); }
    catch (e: any) {
      if (e?.message === "parse-stalled") throw new Error("Reading the file stalled — it may be too large or corrupt. Try a smaller file or split it into sheets.");
      // Worker unavailable / errored → parse on the main thread, but ONLY for a
      // modest file: a large workbook parsed synchronously here would re-freeze
      // the tab. For a big file with no worker, fail clearly instead.
      const size = payload.fileType === "xlsx" ? payload.buffer.byteLength : payload.text.length;
      if (size > 12_000_000) throw new Error("The background file reader isn't available in this browser and the file is too large to read in the foreground. Please try a smaller file or update your browser.");
      onProgress?.({ stage: "reading" });
      return fallback();
    }
  };
  const readFile = async (file: File, onProgress?: (p: WorkerProgress) => void): Promise<{ file_type: string; rows?: any[]; pdf_base64?: string; image_base64?: string; image_media_type?: string; raw_text?: string }> => {
    const name = file.name.toLowerCase();
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

    if (ext === "pdf") return { file_type: "pdf", pdf_base64: await fileToBase64(file) };
    if (IMAGE_MIME[ext] || file.type.startsWith("image/")) return { file_type: "image", image_base64: await fileToBase64(file), image_media_type: file.type || IMAGE_MIME[ext] || "image/png" };
    if (ext === "csv") {
      const text = await file.text();
      return { file_type: "csv", rows: await parseTabular({ fileType: "csv", text }, () => parseCsvRows(text), onProgress) };
    }
    if (ext === "xlsx" || ext === "xls" || (!ext && file.type.includes("sheet"))) {
      const buffer = await file.arrayBuffer();
      return { file_type: "xlsx", rows: await parseTabular({ fileType: "xlsx", buffer }, () => parseWorkbookRows(buffer), onProgress) };
    }
    if (ext === "json") {
      const text = await file.text();
      try {
        const j = JSON.parse(text);
        const arr = Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : Array.isArray(j?.data) ? j.data : null;
        if (arr && arr.length && arr.every((x: any) => x && typeof x === "object")) return { file_type: "json", rows: arr };
      } catch { /* not a clean array-of-objects → hand the raw text to the model */ }
      return { file_type: "json", raw_text: text };
    }
    // txt, xml, html, or anything else textual → the model reads the meaning.
    return { file_type: ext || "txt", raw_text: await file.text() };
  };

  // Map a worker progress event to a friendly label + a percentage.
  const progressLabel = (p: WorkerProgress): { label: string; pct: number } => {
    switch (p.stage) {
      case "reading": return { label: "Reading workbook…", pct: 12 };
      case "sheets": return { label: `Detecting sheets${p.totalSheets ? ` (${p.totalSheets})` : ""}…`, pct: 20 };
      case "extracting": {
        const t = p.totalSheets || 1, s = (p.sheet ?? 0) + 1;
        return { label: `Extracting data — sheet ${s}/${t}…`, pct: 20 + Math.round(55 * (s / t)) };
      }
      case "extracted": return { label: `Read ${p.rows ?? 0} row(s)…`, pct: 78 };
      default: return { label: "Reading file…", pct: 6 };
    }
  };

  /** Import several picked files in ONE go, sequentially so each still gets its own
   *  batch, its own same-name replace and its own toast — the user picks 4 files
   *  once instead of opening the dialog 4 times. Sequential (not parallel) because
   *  each import mutates this filing's batches and clears its results; running them
   *  together would race on the same rows. A failure is reported per file and does
   *  NOT abandon the rest. */
  const handleImportMany = async (files: File[]) => {
    if (files.length === 1) { await handleImport(files[0]); return; }
    let ok = 0;
    for (const f of files) {
      try { await handleImport(f); ok++; } catch { /* handleImport toasts its own failure */ }
    }
    if (ok > 1) toast({ title: `Imported ${ok} of ${files.length} file(s)`, description: "All files are validated together." });
  };

  const handleImport = async (file: File, replaceBatchId?: string) => {
    if (!filing) return;
    const hadResults = !!results; // was a validation already run? → auto-refresh it after
    setImporting(true);
    setImportStage("Uploading file…"); setImportPct(4);
    // Bound the whole import so a stalled connection can never leave the UI
    // stuck spinning — on timeout the invoke aborts and the user can retry.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 180_000);
    try {
      // Kicked off in parallel with parsing/import below, not awaited here — a
      // storage hiccup must never block or fail the import itself (the parsed
      // rows are the primary value; downloading the original file back is a
      // secondary convenience). Resolved once we have the batch id it belongs to.
      const uploadPromise = uploadTdsImportFile(file, filing.id, "recon");
      const parsed = await readFile(file, (p) => { const { label, pct } = progressLabel(p); setImportStage(label); setImportPct(pct); });
      setImportStage("Normalising & saving…"); setImportPct(88);
      const data = await Promise.race([
        // Pass the Office Data count so the importer can flag a big record-count
        // gap (e.g. read 33 but Office has 100) instead of silently under-reading.
        invokeFn("tds-recon-import", { filing_id: filing.id, form_type: selForm, file_name: file.name, expected_count: officeCount.deductees || undefined, ...parsed }, { signal: ctrl.signal }),
        new Promise((_, rej) => ctrl.signal.addEventListener("abort", () => rej(new Error("aborted-timeout")))),
      ]) as any;
      setImportPct(100);
      // Best-effort: attach the uploaded file's URL to its batch row once both
      // are known. Never surfaced as an error — see uploadTdsImportFile's doc.
      uploadPromise.then((url) => {
        if (url) supabase.from("tds_import_batches").update({ file_url: url }).eq("id", data.batch_id).then(() => loadAll());
      });
      // "Replace this file" with a DIFFERENTLY-named file: drop the old batch so
      // the new one takes its place. (A same-named file is already replaced by the
      // importer's own file-name de-dupe, so this becomes a harmless no-op then.)
      if (replaceBatchId && replaceBatchId !== data.batch_id) {
        const { data: oldBatch } = await supabase.from("tds_import_batches").select("file_url").eq("id", replaceBatchId).maybeSingle();
        await supabase.from("tds_imported_rows").delete().eq("batch_id", replaceBatchId);
        const { error: delErr } = await supabase.from("tds_import_batches").delete().eq("id", replaceBatchId);
        if (!delErr) removePublicDocumentByUrl(supabase, oldBatch?.file_url);
        // Non-atomic: the new file is already in. If dropping the old one fails,
        // both would remain and double-count, so surface it (the file list shows
        // the leftover and the user can delete it manually).
        if (delErr) toast({ title: "Old file not removed", description: "The new file imported, but the previous file couldn't be removed automatically — please delete it from the list below.", variant: "destructive" });
      }
      // A fresh import invalidates any prior comparison for this filing.
      await supabase.from("tds_recon_results").delete().eq("filing_id", filing.id);
      setResults(null);
      const replacedNote = (data.replaced || (replaceBatchId && replaceBatchId !== data.batch_id)) ? "Replaced the earlier file. " : "";
      // Surface the column-mapping decisions so the user can SEE (and trust) how
      // each field was detected before the comparison runs. Validation issues make
      // the toast a warning; auto-corrections (e.g. amount/TDS swap) are noted.
      const m = data.mapping as { fields?: Record<string, { column: string; by: string }>; issues?: string[]; notes?: string[] } | null;
      const mapLine = m?.fields ? formatMappingSummary(m.fields) : "";
      const mapIssues = m?.issues?.length ? ` ⚠ Check mapping: ${m.issues.join("; ")}.` : "";
      const mapNotes = m?.notes?.length ? ` (${m.notes.join("; ")}.)` : "";
      // Record-count reconciliation: surface a de-dupe note and, crucially, any
      // shortfall WARNING (read far fewer records than Office Data) so an
      // under-read is never silent.
      const rec = data.reconciliation as { duplicates_removed?: number; distinct_pans?: number; warning?: string; note?: string } | null;
      const dupNote = rec?.duplicates_removed ? ` (${rec.duplicates_removed} duplicate row(s) removed)` : "";
      const reconWarn = rec?.warning ? ` ⚠ ${rec.warning}` : (rec?.note ? ` · ${rec.note}` : "");
      const hasMapWarning = !!(m?.issues?.length || data.warning || rec?.warning);
      toast({
        title: `Imported ${data.row_count} client record(s)${rec?.distinct_pans ? ` · ${rec.distinct_pans} PANs` : ""}`,
        description: `${replacedNote}${data.warning ? data.warning + " " : ""}${mapLine}${dupNote}${mapNotes}${mapIssues}${reconWarn}`.trim() || file.name,
        ...(hasMapWarning ? { variant: "default" as const } : {}),
      });
      const actingName = userMap[user?.id ?? ""];
      // An explicit per-row "Replace this file" click gets its own action type
      // so the audit trail distinguishes "swapped out an existing file" from a
      // same-name re-import or an ordinary new-file add.
      await logReconAudit({
        filingId: filing.id, firmId: filing.firm_id, userId: user?.id, userName: actingName,
        actionType: replaceBatchId ? "RECON_FILE_REPLACED" : "RECON_FILE_IMPORTED",
        newValue: `"${file.name}" — ${data.row_count} row(s)`,
        remark: replaceBatchId ? `Replaced imported file with "${file.name}".` : `Imported "${file.name}"${replacedNote ? " — replaced the earlier same-named file." : "."}`,
      });
      await loadAll();
      await bumpUnderProcess();
      // Auto-refresh the validation if one had already been run — the user should
      // never have to manually re-validate after adding or replacing a file.
      if (hadResults) {
        setComparing(true);
        try { validationToast(await runCompare(filing.id)); }
        catch (e: any) { toast({ title: "Re-validation failed", description: e.message, variant: "destructive" }); }
        setComparing(false);
        setRunSignal(s => s + 1);
      }
    } catch (e: any) {
      const msg = ctrl.signal.aborted
        ? "The import took too long and was cancelled. Try a smaller file or split it, then retry — no need to reload."
        : e?.message || "Import failed";
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      clearTimeout(timer);
      setImportStage("");
      setImportPct(0);
      setImporting(false);
    }
  };

  // Compare the whole filing (the UNION of every imported file) against Office
  // Data and reload results. `batch_id` is omitted — the edge function defaults
  // to the latest batch and reads rows for the whole filing_id, so this is
  // independent of React state (safe to call right after a file mutation).
  // Guarded by loadSeq (same as loadAll): the compare is a multi-second edge call
  // and the selectors stay enabled, so if the user switches client/quarter while
  // it runs, a late response must NOT write the old filing's results into the new
  // filing's view (that would let the wrong return be reviewed/overridden/filed).
  const runCompare = async (filingId: string) => {
    const seq = loadSeq.current;
    const data = await invokeFn("tds-recon-compare", { filing_id: filingId });
    if (seq !== loadSeq.current) return data; // selection changed — abandon
    const { data: res } = await supabase.from("tds_recon_results").select("*").eq("filing_id", filingId);
    if (seq !== loadSeq.current) return data;
    setResults((res as ReconResult[]) || []);
    return data;
  };

  const validationToast = (data: any) => {
    const s = data.summary || {};
    const notes: string[] = [];
    if ((s.excluded_other_quarter ?? 0) > 0) notes.push(`${s.excluded_other_quarter} from other quarters`);
    if ((s.excluded_other_form ?? 0) > 0) notes.push(`${s.excluded_other_form} for other forms (e.g. 192B salary → 24Q)`);
    if ((s.aggregated ?? 0) > 0) notes.push(`${s.aggregated} reconciled in aggregate`);
    const note = notes.length ? ` · auto-handled: ${notes.join(", ")}` : "";
    toast({ title: `Stage 1 · Data validation complete${s.filing_quarter ? ` (${s.filing_quarter}${s.filing_form ? " " + s.filing_form : ""})` : ""}`, description: `${s.matched ?? 0} matched · ${s.mismatched ?? 0} mismatched${note}` });
  };

  // Single "Run Validation" — runs Stage 1 (data reconciliation) here, then bumps
  // runSignal so the embedded Stage 2 (PAN verification) runs too if a TRACES
  // file was imported. The two result sets are shown separately, never merged.
  const handleRunValidation = async () => {
    if (!filing || !batch) return;
    // Hard pre-flight gate — never start Stage 1 while any of this filing's
    // challans is over-applied (its deductees, plus interest/surcharge/
    // Kasar-Vatav, exceed what the challan actually paid). Re-checked here
    // (not just via the disabled button) in case overAppliedChallans is
    // momentarily stale relative to a very recent edit.
    if (overAppliedChallans.length > 0) {
      toast({
        title: "Challan has been over-applied.",
        description: `${overAppliedChallans.length} challan${overAppliedChallans.length === 1 ? "" : "s"} (${overAppliedChallans.map(c => c.challanNo || "—").join(", ")}) ${overAppliedChallans.length === 1 ? "has" : "have"} more applied than the amount paid. Fix this in Data Entry before running validation.`,
        variant: "destructive",
      });
      return;
    }
    setComparing(true);
    try {
      const data = await runCompare(filing.id);
      validationToast(data);
      const s = data?.summary || {};
      await logReconAudit({
        filingId: filing.id, firmId: filing.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
        actionType: "RECON_RUN",
        newValue: `${s.matched ?? 0} matched / ${(s.matched ?? 0) + (s.mismatched ?? 0)}`,
        remark: `Stage 1 data validation run — ${s.matched ?? 0} matched, ${s.mismatched ?? 0} mismatched.`,
      });
      await bumpUnderProcess();
    } catch (e: any) {
      toast({ title: "Validation failed", description: e.message, variant: "destructive" });
    }
    setComparing(false);
    setRunSignal(s => s + 1); // trigger Stage 2 (PAN verification) if a TRACES file is present
  };

  // ── File management: delete / replace / view details ─────────────────────────
  // The imported dataset must always reflect exactly the files the user chose.
  const doDeleteBatches = async (ids: string[]) => {
    if (!filing || !ids.length) return;
    setDeleting(true);
    try {
      const hadResults = !!results;
      const { data: doomed } = await supabase.from("tds_import_batches").select("file_name, file_url").in("id", ids);
      // Remove the rows, then the batch (tds_recon_results referencing it cascade),
      // then wipe any surviving comparison for the filing — it counted these rows.
      await supabase.from("tds_imported_rows").delete().in("batch_id", ids);
      await supabase.from("tds_import_batches").delete().in("id", ids);
      await supabase.from("tds_recon_results").delete().eq("filing_id", filing.id);
      for (const b of doomed || []) removePublicDocumentByUrl(supabase, b.file_url);
      setResults(null);
      setSelBatchIds(new Set());
      toast({ title: ids.length === 1 ? "File removed" : `${ids.length} files removed`, description: "Imported dataset updated." });
      await logReconAudit({
        filingId: filing.id, firmId: filing.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
        actionType: "RECON_FILE_DELETED",
        oldValue: (doomed || []).map((b: any) => b.file_name).filter(Boolean).join(", ") || null,
        remark: ids.length === 1 ? `Removed "${doomed?.[0]?.file_name || "file"}".` : `Removed ${ids.length} files.`,
      });
      await loadAll();
      // Auto-rebuild validation if files remain and a run had already been done —
      // the user should never have to manually re-validate after managing files.
      const { data: remain } = await supabase.from("tds_import_batches").select("id").eq("filing_id", filing.id).limit(1);
      if (hadResults && remain && remain.length) {
        setComparing(true);
        try { validationToast(await runCompare(filing.id)); }
        catch (e: any) { toast({ title: "Re-validation failed", description: e.message, variant: "destructive" }); }
        setComparing(false);
        setRunSignal(s => s + 1);
      }
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || "Could not remove file(s)", variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const handleReplaceClick = (batchId: string) => { setReplaceTargetId(batchId); fileInputRef.current?.click(); };

  const handleDownloadFile = (b: any) => {
    downloadStorageFile(b.file_url, b.file_name || "file");
    logReconAudit({
      filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
      actionType: "RECON_FILE_DOWNLOADED", newValue: b.file_name || null, remark: `Downloaded "${b.file_name || "file"}".`,
    });
  };

  const openDetails = async (b: any) => {
    setDetailsBatch(b); setDetailsRows(null); setDetailsLoading(true);
    const { data } = await supabase.from("tds_imported_rows").select("*")
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

  const openOverride = (r: ReconResult) => { setOvTarget(r); setOvReason(""); setOvOpen(true); };

  const saveOverride = async () => {
    if (!ovTarget) return;
    const reason = ovReason.trim();
    if (!reason) { toast({ title: "Override reason is required", variant: "destructive" }); return; }
    setSavingOv(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from("tds_recon_results").update({
      overridden: true, overridden_by: user?.id, overridden_at: now, override_note: reason,
    }).eq("id", ovTarget.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSavingOv(false); return; }
    await logReconAudit({
      filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
      actionType: "RECON_OVERRIDE",
      oldValue: `${ovTarget.record_label || "—"} — ${reasonFor(ovTarget)}`,
      newValue: "Overridden", remark: reason,
    });
    setResults(prev => prev ? prev.map(x => x.id === ovTarget.id ? { ...x, overridden: true, override_note: reason, overridden_by: user?.id ?? null } : x) : prev);
    toast({ title: "Override recorded" });
    setOvOpen(false);
    setSavingOv(false);
  };

  const undoOverride = async (r: ReconResult) => {
    const { error } = await supabase.from("tds_recon_results").update({
      overridden: false, overridden_by: null, overridden_at: null, override_note: null,
    }).eq("id", r.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await logReconAudit({
      filingId: filing?.id, firmId: filing?.firm_id, userId: user?.id, userName: userMap[user?.id ?? ""],
      actionType: "RECON_OVERRIDE_UNDO",
      oldValue: "Overridden", newValue: r.match_status, remark: `Override removed for ${r.record_label || "—"}`,
    });
    setResults(prev => prev ? prev.map(x => x.id === r.id ? { ...x, overridden: false, override_note: null } : x) : prev);
  };

  /** Digital signature — one-click, same pattern as Correction Signature's
   *  signAsPreparer/approveAsSenior (tdsCorrections.ts): the signed-by name is
   *  pulled straight from the authenticated account (userMap[user.id], the
   *  same source this file already uses for "who acted" everywhere else — see
   *  actingName below) rather than typed and checked against an allow-list.
   *  There is nothing left to validate the text of, so only the review
   *  checkbox gates the click. Persisted as a tds_filing_audit_log entry
   *  rather than a new column, so it needs no migration. Only a Firm
   *  Admin/Super Admin role (canSign) may call this. Signing is only offered
   *  once canFile is true — there is nothing to attest to while Stage 1-3
   *  still have open issues. */
  const handleSign = async () => {
    if (!filing || !user?.id) return;
    if (!canSign) { toast({ title: "Not authorized", description: "Only the Firm Admin or Super Admin is authorized to digitally sign and approve this return for filing.", variant: "destructive" }); return; }
    if (!attestChecked) { toast({ title: "Confirmation required", description: "Confirm you have reviewed every exception before signing.", variant: "destructive" }); return; }
    if (!canFile) { toast({ title: "Not ready to sign", description: "Resolve every Stage 1-3 issue above before signing.", variant: "destructive" }); return; }
    setSigning(true);
    const signedByName = userMap[user.id] || user.email || "Unknown";
    await logReconAudit({
      filingId: filing.id, firmId: filing.firm_id, userId: user.id, userName: signedByName,
      actionType: "CHECKER_SIGNATURE", newValue: signedByName,
      remark: "Digitally signed — confirms review of every Stage 1-3 exception, override and mapping.",
    });
    // Also touch the tds_filings row itself (not just the audit log) — the
    // Dashboard's "Ready" badge (TdsFilingsManager's fetchVfStatuses) only
    // recomputes on a Realtime event from client_services/tds_filings, or a
    // 45s poll/tab-focus. A signature alone never fired that event, so a
    // freshly-signed return kept showing red "✗ Ready" until one of those
    // happened to fire — this makes the Dashboard update immediately.
    await supabase.from("tds_filings").update({ last_updated_by: user.id, last_updated_at: new Date().toISOString() }).eq("id", filing.id);
    setSignature({ signedByName, signedAt: new Date().toISOString() });
    setSigning(false);
    toast({ title: "Digitally signed", description: "You can now mark this return as ready to file." });
  };

  /** Returns whether the return was actually reverted out of Ready to File —
   *  approveEditRequest below needs this to know whether it's safe to mark a
   *  request "approved": the closure's own `filing`/`signature` snapshot
   *  doesn't update just because setFiling ran inside this call, so a bare
   *  await here can't be trusted to mean "it worked" on its own. */
  const handleRevokeSignature = async (): Promise<boolean> => {
    if (!filing || !user?.id || !signature || !canSign) return false;
    setSigning(true);
    await logReconAudit({
      filingId: filing.id, firmId: filing.firm_id, userId: user.id, userName: userMap[user.id],
      actionType: "CHECKER_SIGNATURE_REVOKED", oldValue: signature.signedByName,
      remark: "Signature revoked before filing.",
    });
    // Revoking the signature un-does the thing "Ready to File" asserts, so a
    // return sitting in that status must not stay there claiming a sign-off
    // that no longer exists — send it back to Reviewed. This is also the
    // in-page escape hatch out of the isLocked editing freeze. Any other
    // status (Filed, Under Process, …) is left exactly as it was.
    //
    // The revert is a DB-level compare-and-swap (.eq on work_status), NOT a
    // blind write off local state — the same guard filingActivity.ts uses.
    // `filing` here can be arbitrarily stale: this component has no Realtime
    // subscription and loadAll only re-runs when the client/FY/quarter/form
    // selection changes, so while this tab sits open a colleague can file the
    // return from the Filings Manager. An unfiltered write would then silently
    // un-file a filed return, moving "Filed" back to "Reviewed" while its ACK
    // stays attached. The CAS makes that case a harmless no-op instead.
    //
    // Covers every LOCKED status, not just Ready to File — a signed return
    // can be revoked (or, via an approved edit request below, unlocked by a
    // reviewer) from Filed and from Processed with/without Default too, per
    // the firm's own definition of "locked": Ready to File onward (2026-08-05).
    const fromStatus = filing.work_status;
    const wantsRevert = fromStatus === READY_TO_FILE_STATUS || fromStatus === "Filed" || isProcessedWorkStatus(fromStatus);
    // Same Realtime nudge as handleSign, so a revoke also reaches the
    // Dashboard immediately instead of waiting on the next poll.
    const nudge: Record<string, any> = { last_updated_by: user.id, last_updated_at: new Date().toISOString() };
    // A filing date only means anything while the return IS filed — reverting
    // past Filed without clearing it would leave a return sitting in Under
    // Review claiming a filing date it no longer has, the same stale-date bug
    // TdsFilingsManager.tsx's own manual status-dropdown path already guards
    // against (its wasFiledGroup/isFiledGroup check) for this exact case.
    if (fromStatus === "Filed" || isProcessedWorkStatus(fromStatus)) nudge.date_of_filing = null;
    let reverted = false;
    if (wantsRevert) {
      const { data, error } = await supabase.from("tds_filings")
        .update({ work_status: "Reviewed", ...nudge })
        .eq("id", filing.id).eq("work_status", fromStatus).select("id");
      // Only claim the revert — in local state, in the audit trail and to the
      // user — once the DB confirms a row actually changed. A failed or
      // no-op write must not unlock the workspace against a row whose status
      // has since moved on from what this component last saw.
      reverted = !error && !!data && data.length > 0;
      if (error) {
        toast({ title: "Couldn't update status", description: `Signature revoked, but the status could not be moved back: ${error.message}`, variant: "destructive" });
      }
    } else {
      await supabase.from("tds_filings").update(nudge).eq("id", filing.id);
    }
    if (reverted) {
      await logReconAudit({
        filingId: filing.id, firmId: filing.firm_id, userId: user.id, userName: userMap[user.id],
        actionType: "STATUS_CHANGE", oldValue: fromStatus, newValue: "Reviewed",
        remark: `Auto-reverted: checker signature revoked, so the return is no longer ${fromStatus}.`,
      });
      setFiling({ ...filing, work_status: "Reviewed" });
      toast({ title: "Signature revoked", description: `Status moved back to Under Review — this return is no longer marked ${fromStatus}.` });
    }
    setSignature(null); setAttestChecked(false);
    setSigning(false);
    return reverted;
  };

  /** Staff request to edit a return that's locked at "Ready to File" — the
   *  only path open to anyone who is NOT a Firm Admin/Super Admin (who could
   *  just click Revoke Signature themselves). Purely a request/response
   *  record; nothing unlocks until a reviewer approves it. */
  const submitEditRequest = async () => {
    if (!filing || !user?.id) return;
    const reason = editRequestReason.trim();
    if (!reason) { toast({ title: "Reason is required", description: "Describe what needs to change and why.", variant: "destructive" }); return; }
    setRequestingEdit(true);
    const requesterName = userMap[user.id] || user.email || "Unknown";
    const { data, error } = await supabase.from("tds_edit_requests" as any).insert({
      filing_id: filing.id, firm_id: filing.firm_id, requested_by: user.id, requested_by_name: requesterName,
      reason, status: "pending",
    }).select("*").single();
    if (error) { toast({ title: "Could not submit request", description: error.message, variant: "destructive" }); setRequestingEdit(false); return; }
    await logReconAudit({
      filingId: filing.id, firmId: filing.firm_id, userId: user.id, userName: requesterName,
      actionType: "EDIT_ACCESS_REQUESTED", newValue: reason,
      remark: "Requested permission to edit a Ready-to-File return.",
    });
    setEditRequest(data);
    setEditRequestReason("");
    setRequestingEdit(false);
    toast({ title: "Request submitted", description: "A Firm Admin or Super Admin can approve it from this same tab." });
  };

  /** Approve = the SAME effect as Revoke Signature (status reverts to
   *  Reviewed, signature cleared) — this table only wraps that existing,
   *  already-CAS-guarded action with a request/response record around it, so
   *  the actual unlock logic is never duplicated. */
  const approveEditRequest = async () => {
    if (!filing || !user?.id || !editRequest || editRequest.status !== "pending" || !canSign) return;
    setReviewingRequest(true);
    const reviewerName = userMap[user.id] || user.email || "Unknown";
    const reverted = await handleRevokeSignature();
    // Only mark the request "approved" once the revert actually happened — a
    // request must never be shown as resolved (or the DB row's status left
    // "pending" forever) while the return is still, in fact, locked.
    if (!reverted) {
      toast({ title: "Could not approve", description: "The signature revoke didn't go through, so the return is still locked — the request stays pending. Try again.", variant: "destructive" });
      setReviewingRequest(false);
      return;
    }
    const { data, error } = await supabase.from("tds_edit_requests" as any)
      .update({ status: "approved", reviewed_by: user.id, reviewed_by_name: reviewerName, reviewed_at: new Date().toISOString() })
      .eq("id", editRequest.id).eq("status", "pending").select("*").single();
    if (!error && data) {
      setEditRequest(data);
      await logReconAudit({
        filingId: filing.id, firmId: filing.firm_id, userId: user.id, userName: reviewerName,
        actionType: "EDIT_ACCESS_APPROVED", oldValue: editRequest.reason,
        remark: `Approved ${editRequest.requested_by_name || "the requester"}'s edit request — return reverted to Under Review.`,
      });
      toast({ title: "Request approved", description: "The return is back in Under Review and unlocked for editing." });
    } else if (error) {
      // The revert DID happen (return is genuinely unlocked) — only the
      // request row's own bookkeeping failed. Surface it rather than
      // swallowing it, since a future reviewer would otherwise see a
      // pending request for a return that's already back in Under Review.
      toast({ title: "Return unlocked, but the request record couldn't be updated", description: error.message, variant: "destructive" });
    }
    setReviewingRequest(false);
  };

  const rejectEditRequest = async () => {
    if (!filing || !user?.id || !editRequest || editRequest.status !== "pending" || !canSign) return;
    setReviewingRequest(true);
    const reviewerName = userMap[user.id] || user.email || "Unknown";
    const { data, error } = await supabase.from("tds_edit_requests" as any)
      .update({ status: "rejected", reviewed_by: user.id, reviewed_by_name: reviewerName, reviewed_at: new Date().toISOString(), review_note: rejectNote.trim() || null })
      .eq("id", editRequest.id).eq("status", "pending").select("*").single();
    if (error) { toast({ title: "Could not reject request", description: error.message, variant: "destructive" }); setReviewingRequest(false); return; }
    await logReconAudit({
      filingId: filing.id, firmId: filing.firm_id, userId: user.id, userName: reviewerName,
      actionType: "EDIT_ACCESS_REJECTED", oldValue: editRequest.reason, newValue: rejectNote.trim() || null,
      remark: `Rejected ${editRequest.requested_by_name || "the requester"}'s edit request.`,
    });
    setEditRequest(data);
    setRejectNote("");
    setRejectDialogOpen(false);
    setReviewingRequest(false);
    toast({ title: "Request rejected" });
  };

  const handleFinalise = async () => {
    if (!filing) return;
    // Re-assert the whole gate at WRITE time — canFile only guards the button and
    // the dialog can outlive a late Stage-2 status flip, so never file an unready
    // return even if the confirm dialog was already open.
    if (!canFile) { toast({ title: "Not ready to file", description: fileBlockReason || "Complete all validations first.", variant: "destructive" }); setConfirmOpen(false); return; }
    if (!signature) { toast({ title: "Digital signature required", description: "The checker must digitally sign this return before it can be marked ready to file.", variant: "destructive" }); setConfirmOpen(false); return; }
    setFinalising(true);
    const actingName = userMap[user?.id ?? ""];
    // This button means "signed off, cleared to go to the portal" — NOT "the
    // return has been filed". It used to write work_status "Filed", which was
    // wrong twice over: it claimed a filing that hadn't happened, and because
    // it wrote Filed directly it also bypassed the Filings Manager's mandatory
    // ACK-upload gate on Filed/Processed (no acknowledgement can exist yet at
    // this point). It now parks the return in READY_TO_FILE_STATUS, where it
    // stays until someone actually files it and attaches the ACK.
    //
    // checker_id ("Filed By") is deliberately NOT set here for the same
    // reason: nobody has filed anything yet. The Filings Manager sets it when
    // the status genuinely becomes Filed.
    const { error } = await supabase.from("tds_filings").update({
      work_status: READY_TO_FILE_STATUS, last_updated_by: user?.id, last_updated_at: new Date().toISOString(),
    }).eq("id", filing.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      await logReconAudit({ filingId: filing.id, firmId: filing.firm_id, userId: user?.id, userName: actingName, actionType: "STATUS_CHANGE", oldValue: filing.work_status || null, newValue: READY_TO_FILE_STATUS, remark: "Marked Ready to File from Validate & Finalise" });
      toast({ title: "Return marked as Ready to File", description: "File it on the portal, then attach the ACK to move it to Filed." });
      setFiling({ ...filing, work_status: READY_TO_FILE_STATUS });
    }
    setFinalising(false);
    setConfirmOpen(false);
  };

  // Clean partition: Total = Matched + Mismatched(UNRESOLVED) + Overridden.
  // "Mismatched" counts only records that are NOT yet overridden — once a record
  // is overridden it moves to Overridden, so there is no separate "Pending" count
  // to duplicate it (the redundant Pending card is removed).
  const summary = useMemo(() => {
    const rs = results || [];
    return {
      total: rs.length,
      matched: rs.filter(r => r.match_status === "matched").length,
      mismatched: rs.filter(r => r.match_status !== "matched" && !r.overridden).length,   // UNRESOLVED
      overridden: rs.filter(r => r.overridden).length,
    };
  }, [results]);

  // ── Cross-stage filing gate ─────────────────────────────────────────────────
  // "Mark Return as Ready to File" may enable ONLY when the WHOLE validation
  // workflow is complete: Stage-1 has run with no unresolved mismatch, AND — when
  // a TRACES file has been imported (Stage-2 applicable) — Stage-2 has been run
  // with no unresolved PAN issue. Until then the button stays disabled and the UI
  // states the exact reason.
  const [panStatus, setPanStatus] = useState<PanStageStatus>(PAN_STATUS_BLOCKED);
  const [challanDownloadStatus, setChallanDownloadStatus] = useState<ChallanDownloadStageStatus>({ filingId: null, loaded: false, applicable: false, ran: false, issues: 0 });
  const [tallyStatus, setTallyStatus] = useState<TallyStageStatus>({ filingId: null, loaded: false, applicable: false, ran: false, total: 0, matched: 0, issues: 0, overridden: 0 });
  const stage1Ran = (results?.length ?? 0) > 0;
  const stage1Ready = stage1Ran && summary.mismatched === 0;
  // Each embedded stage's report must describe the CURRENTLY-selected filing AND
  // have settled (loaded) — during a fast filing switch or the initial load window
  // the child's report can still describe the previous return or hold pre-load
  // defaults, so the gate defaults CLOSED until the current filing has reported.
  // Stage 2 is "PAN & Challan" — both halves must independently be either not
  // applicable (nothing imported yet) or run-clean before the stage counts as done.
  const stage2PanReported = panStatus.loaded && panStatus.filingId != null && panStatus.filingId === (filing?.id ?? null);
  const stage2PanReady = stage2PanReported && (!panStatus.applicable || (panStatus.ran && panStatus.issues === 0));
  const stage2ChallanReported = challanDownloadStatus.loaded && challanDownloadStatus.filingId != null && challanDownloadStatus.filingId === (filing?.id ?? null);
  const stage2ChallanReady = stage2ChallanReported && (!challanDownloadStatus.applicable || (challanDownloadStatus.ran && challanDownloadStatus.issues === 0));
  const stage2Reported = stage2PanReported && stage2ChallanReported;
  const stage2Ready = stage2PanReady && stage2ChallanReady;
  const stage3Reported = tallyStatus.loaded && tallyStatus.filingId != null && tallyStatus.filingId === (filing?.id ?? null);
  const stage3Ready = stage3Reported && (!tallyStatus.applicable || (tallyStatus.ran && tallyStatus.issues === 0));
  const canFile = stage1Ready && stage2Ready && stage3Ready;
  // Only the Firm Admin / Super Admin role may digitally sign (or revoke a
  // signature) — final filing approval is restricted to authorized personnel.
  // Every other role may still VIEW the sign-off section (already-signed state,
  // reason text) but never act on it.
  const canSign = user?.role === "firm_admin" || user?.role === "superadmin";
  const fileBlockReason = !stage1Ran
    ? "Run Stage-1 validation first."
    : !stage1Ready
    ? `${summary.mismatched} Stage-1 mismatch${summary.mismatched === 1 ? "" : "es"} still unresolved — override each one to continue.`
    : !stage2Reported || !stage3Reported
    ? "Finishing validation status checks…"
    : (panStatus.applicable && !panStatus.ran)
    ? "A TRACES file is imported — run Stage-2 PAN Verification to complete the audit."
    : (panStatus.applicable && panStatus.issues > 0)
    ? `${panStatus.issues} Stage-2 PAN issue${panStatus.issues === 1 ? "" : "s"} still unresolved — override or resolve each one to continue.`
    : (challanDownloadStatus.applicable && !challanDownloadStatus.ran)
    ? "A challan report is imported — validate it to complete Stage-2 Challan Validation."
    : (challanDownloadStatus.applicable && challanDownloadStatus.issues > 0)
    ? `Stage-2 Challan Validation: ${challanDownloadStatus.issues} challan${challanDownloadStatus.issues === 1 ? "" : "s"} not matched against the portal report — resolve before continuing.`
    : (tallyStatus.applicable && !tallyStatus.ran)
    ? "A Tally ledger is imported — run Stage-3 reconciliation to complete it."
    : (tallyStatus.applicable && tallyStatus.issues > 0)
    ? `${tallyStatus.issues} Stage-3 Tally item${tallyStatus.issues === 1 ? "" : "s"} still unresolved — map, override or resolve each one to continue.`
    : "";
  const isFiled = filing?.work_status === "Filed";
  // Signed off and cleared for the portal, but NOT yet filed. Rendered as its
  // own end-state so the big "Mark Return as Ready to File" button doesn't
  // invite a second, pointless click on a return that's already there.
  const isMarkedReadyToFile = filing?.work_status === READY_TO_FILE_STATUS;
  // Editing freeze for the Stage 1-3 workspace (imports, overrides, file
  // deletes). Ready to File freezes it exactly as Filed does: the checker
  // digitally signed THIS data, so it must not change underneath that
  // signature. Before "Ready to File" existed this button wrote "Filed"
  // directly, so finalising had always frozen the workspace — keeping that
  // behaviour here is what stops the fix from silently unfreezing it.
  // Escape hatch: Revoke Signature (below) sends the return back to Reviewed,
  // or — once past Filed, where Revoke Signature no longer applies — an
  // approved edit request does the same (see the Request Changes block
  // below, now shown for every locked state, not just Ready to File).
  const isLocked = isFiled || isMarkedReadyToFile || isProcessedWorkStatus(filing?.work_status);
  const cErr = selClient ? complianceError() : null;
  const selectedClient = clients.find(c => c.id === selClient);

  // ── Stage 4 · Checker Review — a consolidated view across all 3 stages, so the
  // checker reviews ONE tab instead of clicking through Stages 1-3. Reuses each
  // stage's OWN already-computed data rather than re-deriving anything — a fix
  // to a stage's counts or categorisation lands here automatically.
  /** errorTypeFor bound to THIS filing's form, so the gross figure is named the
   *  way the return names it — "Taxable Income" on 24Q, "Amount" on 26Q. Used
   *  everywhere a Stage-1 category is derived (the breakdown chips, the chip
   *  filter and the Stage-4 audit rows) so all three always agree. */
  const errType = useCallback((r: ReconResult) => errorTypeFor(r, selForm), [selForm]);

  const stage4Data = useMemo(() => {
    // One audit row per exception, across all 3 stages — grouped into a
    // per-stage section in the JSX below (not a flat table). Stage 1's rows are
    // built directly (its data already lives in THIS component); Stage 2/3 hand
    // theirs up via the same lazy getAuditRows() pattern getReport() already
    // uses, so this can never drift from what each stage's own tab shows.
    const s1Audit: AuditRow[] = (results || [])
      .filter((r) => r.match_status !== "matched" || r.overridden)
      .map((r): AuditRow => ({
        stage: "Stage 1",
        record: r.record_label || "—",
        errorType: errType(r),
        status: r.overridden ? "Overridden" : "Unresolved",
        reason: r.overridden ? (r.override_note || "accepted") : reasonFor(r),
      }));
    const s2Audit = panStatus.applicable && panStatus.getAuditRows ? panStatus.getAuditRows() : [];
    const s3Audit = tallyStatus.applicable && tallyStatus.getAuditRows ? tallyStatus.getAuditRows() : [];
    // Stage 4 reviews EXCEPTIONS — a record auto-reconciled via a saved mapping
    // ("Resolved", surfaced as errorType "Matched") needs no checker attention,
    // so it never enters the review list, not even under "All".
    const auditRows = [...s1Audit, ...s2Audit, ...s3Audit]
      .filter((r) => r.status !== "Resolved" && r.errorType !== "Matched");

    return {
      totalRecords: summary.total,
      totalMatched: summary.matched,
      // Combined across the 3 independent reconciliations — NOT a de-duplicated
      // per-office-record count (the same record can carry a Stage-1 AND a
      // Stage-3 issue at once).
      totalMismatches: summary.mismatched + (panStatus.applicable ? panStatus.issues : 0) + (tallyStatus.applicable ? tallyStatus.issues : 0),
      totalOverridden: summary.overridden + (panStatus.applicable ? panStatus.overridden : 0) + (tallyStatus.applicable ? tallyStatus.overridden : 0),
      auditRows,
    };
    // errType carries selForm — without it here a form switch would leave the
    // Stage-4 audit rows labelled for the previous form.
  }, [results, summary, panStatus, tallyStatus, errType]);

  // Distinct error types actually present, so the filter never lists a type that
  // matches nothing (and picks up a brand-new one automatically).
  const auditErrorTypes = useMemo(
    () => [...new Set(stage4Data.auditRows.map((r) => r.errorType))].sort(),
    [stage4Data.auditRows],
  );
  const filteredAuditRows = useMemo(
    () => stage4Data.auditRows.filter((r) =>
      (auditStatusFilter === "all" || r.status === auditStatusFilter)
      && (auditErrorTypeFilter === "all" || r.errorType === auditErrorTypeFilter)),
    [stage4Data.auditRows, auditStatusFilter, auditErrorTypeFilter],
  );
  const toggleStageCollapsed = (stage: string) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage); else next.add(stage);
      return next;
    });
  };

  // Non-matched records (mismatched / office_only / imported_only) — each gets its
  // own inline comparison table; pending first, then overridden.
  const attention = useMemo(() => {
    const rs = (results || []).filter(r => r.match_status !== "matched");
    return rs.sort((a, b) => (a.overridden ? 1 : 0) - (b.overridden ? 1 : 0));
  }, [results]);

  // Reset the active card filter AND the Stage-2 gate status when the selection
  // changes, so the filing gate defaults closed until the new filing's Stage-2
  // reports (prevents filing off a previous return's status during a fast switch).
  useEffect(() => {
    setActiveFilter(null); setErrorTypeFilter(null);
    setAuditStatusFilter("all"); setAuditErrorTypeFilter("all"); setCollapsedStages(new Set());
    setAttestChecked(false); setSignature(null);
    setPanStatus(PAN_STATUS_BLOCKED);
    setChallanDownloadStatus({ filingId: null, loaded: false, applicable: false, ran: false, issues: 0 });
    setTallyStatus({ filingId: null, loaded: false, applicable: false, ran: false, total: 0, matched: 0, issues: 0, overridden: 0 });
  }, [selClient, selFy, selQuarter, selForm]);

  // Records to show when a summary card is clicked (null = default exceptions view).
  const cardFiltered = useMemo((): ReconResult[] | null => {
    const rs = results || [];
    switch (activeFilter) {
      case "total": return rs;
      case "matched": return rs.filter(r => r.match_status === "matched");
      case "mismatched": return rs.filter(r => r.match_status !== "matched" && !r.overridden); // unresolved
      case "overridden": return rs.filter(r => r.overridden);
      default: return null;
    }
  }, [results, activeFilter]);

  const overrideBtn = (r: ReconResult) => (
    r.overridden ? (
      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => undoOverride(r)}>
        <RotateCcw size={12} /> Undo override
      </Button>
    ) : (
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openOverride(r)} disabled={isLocked}>
        <ShieldCheck size={12} /> Override
      </Button>
    )
  );

  // One mismatch/exception record → a card showing only the differing fields.
  const renderMismatchCard = (r: ReconResult) => {
    const diffs = r.field_diffs || [];
    // Section, shown as a badge right on the header — not just a row buried in
    // the diff table below — so the checker can identify and jump to the right
    // record by section (194A/194C/194J/…) without opening every card. Office
    // Data is the master source; the imported side is only a fallback for an
    // office_only/imported_only record where one side has no value at all.
    const sectionDiff = diffs.find((d) => d.field === "section");
    const section = sectionDiff ? (sectionDiff.office ?? sectionDiff.imported) : null;
    return (
      <Card key={r.id} className={cn(r.overridden ? "border-blue-200 dark:border-blue-900 opacity-80" : "border-destructive/30")}>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-muted/30">
            <div className="flex items-center gap-2 min-w-0">
              <p className="font-semibold text-sm truncate">{r.record_label || "—"}</p>
              {section != null && section !== "" && <Badge variant="outline" className="text-[10px] shrink-0">{String(section)}</Badge>}
              {r.overridden && <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300 shrink-0">Overridden{r.overridden_by && userMap[r.overridden_by] ? ` · ${userMap[r.overridden_by]}` : ""}</Badge>}
            </div>
            {!isLocked && overrideBtn(r)}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Field</TableHead>
                  <TableHead>Office Data</TableHead>
                  <TableHead>Imported Excel</TableHead>
                  <TableHead className="w-[110px] text-right">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DIFF_FIELDS.filter(f => { const d = diffs.find(x => x.field === f); return d ? d.matched === false : false; }).map(f => {
                  const d = diffs.find(x => x.field === f);
                  return (
                    <TableRow key={f} className="bg-destructive/5">
                      <TableCell className="font-medium text-xs">{FIELD_LABELS[f]}</TableCell>
                      <TableCell className="text-xs">{fmtVal(d?.office)}</TableCell>
                      <TableCell className="text-xs text-destructive font-medium">{fmtVal(d?.imported)}</TableCell>
                      <TableCell className="text-right"><span className="inline-flex items-center gap-1 text-destructive text-xs"><X size={12} /> Mismatch</span></TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/40">
                  <TableCell className="font-semibold text-xs">Result</TableCell>
                  <TableCell colSpan={3} className={cn("text-xs font-medium", r.overridden ? "text-blue-600" : "text-destructive")}>
                    {r.overridden ? `Overridden — ${r.override_note || "accepted"}` : reasonFor(r)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  // Matched records (shown only when the user filters to Matched/Total) → compact table.
  const renderMatchedTable = (rows: ReconResult[]) => (
    <Card><CardContent className="p-0 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Record</TableHead>
            {DIFF_FIELDS.map(f => <TableHead key={f} className="text-xs">{FIELD_LABELS[f]}</TableHead>)}
            <TableHead className="text-right text-xs">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => {
            const diffs = r.field_diffs || [];
            const val = (f: string) => { const d = diffs.find(x => x.field === f); return fmtVal(d?.office ?? d?.imported); };
            return (
              <TableRow key={r.id}>
                <TableCell className="text-xs font-medium">{r.record_label || "—"}</TableCell>
                {DIFF_FIELDS.map(f => <TableCell key={f} className="text-xs">{val(f)}</TableCell>)}
                <TableCell className="text-right"><span className="inline-flex items-center gap-1 text-emerald-600 text-xs"><CheckCircle2 size={11} /> Matched</span></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </CardContent></Card>
  );

  // ── Reports ────────────────────────────────────────────────────────────────
  // Built lazily, from exactly what is on screen, so an un-run stage costs nothing.
  const reportMeta: ReportMeta = {
    client: selectedClient?.name || "—",
    tan: selectedClient?.tan_number || null,
    form: selForm, quarter: selQuarter, fy: selFy,
    status: filing?.work_status || null,
  };

  const stage1Report = (): StageReport => {
    const rs = results || [];
    const row = (r: ReconResult) => ({
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
    return {
      title: "Stage 1 - Data Validation",
      subtitle: "Office Data vs Imported Client Data — field by field",
      summary: [
        { label: "Total", value: summary.total },
        { label: "Matched", value: summary.matched },
        { label: "Mismatched", value: summary.mismatched },
        { label: "Overridden", value: summary.overridden },
      ],
      sections: [
        { title: "Mismatched", rows: rs.filter((r) => r.match_status !== "matched" && !r.overridden).map(row), emptyNote: "No mismatched records — every office record reconciled." },
        { title: "Missing in Imported", rows: rs.filter((r) => r.match_status === "office_only").map(row), emptyNote: "No office record is missing from the imported file." },
        { title: "Extra in Imported", rows: rs.filter((r) => r.match_status === "imported_only").map(row), emptyNote: "No extra rows in the imported file." },
        { title: "Overridden", rows: rs.filter((r) => r.overridden).map(row), emptyNote: "No overrides." },
        { title: "Matched", rows: rs.filter((r) => r.match_status === "matched" && !r.overridden).map(row), emptyNote: "No matched records." },
      ],
    };
  };

  /** Stage 4's own detail sheet — the consolidated exceptions list (same rows
   * the on-screen tab shows), plus the sign-off/filing gate as plain notes,
   * since those don't fit the Record/Result/Reason row shape. */
  const stage4Report = (): StageReport => {
    const row = (r: AuditRow) => ({ Stage: r.stage, Record: r.record, "Error Type": r.errorType, Status: r.status, Reason: r.reason });
    const rows = stage4Data.auditRows;
    return {
      title: "Stage 4 - Checker Review",
      subtitle: "Consolidated exceptions across Stage 1-3, plus the sign-off gate",
      summary: [
        { label: "Total", value: stage4Data.totalRecords },
        { label: "Matched", value: stage4Data.totalMatched },
        { label: "Mismatched", value: stage4Data.totalMismatches },
        { label: "Overridden", value: stage4Data.totalOverridden },
      ],
      sections: [
        { title: "Unresolved", rows: rows.filter((r) => r.status === "Unresolved").map(row), emptyNote: "No unresolved exceptions across Stage 1-3." },
        { title: "Overridden", rows: rows.filter((r) => r.status === "Overridden").map(row), emptyNote: "No overrides." },
      ],
      notes: [
        `Ready to file: ${canFile ? "Yes" : "No"}${!canFile && fileBlockReason ? ` — ${fileBlockReason}` : ""}`,
        `Digital signature: ${signature ? `Signed by ${signature.signedByName} on ${new Date(signature.signedAt).toLocaleString("en-IN")}` : "Not signed"}`,
        `Filing status: ${isFiled ? "Filed" : isMarkedReadyToFile ? "Ready to File — signed off, not yet filed" : "Not filed"}`,
      ],
    };
  };

  /** Stage 1 + 2 + 3 + 4 in one document, from each stage's reported status. */
  const overviewReport = (): OverviewReport => ({
    stages: [
      {
        title: "Stage 1 · Data Validation", applicable: true, ran: stage1Ran,
        summary: [
          { label: "Total", value: summary.total }, { label: "Matched", value: summary.matched },
          { label: "Mismatched", value: summary.mismatched }, { label: "Overridden", value: summary.overridden },
        ],
        status: !stage1Ran ? "Not run" : summary.mismatched === 0 ? "Complete" : `${summary.mismatched} unresolved`,
      },
      {
        title: "Stage 2 · PAN Verification", applicable: panStatus.applicable, ran: panStatus.ran,
        summary: [
          { label: "Total", value: panStatus.total }, { label: "Verified", value: panStatus.verified },
          { label: "Issues", value: panStatus.issues }, { label: "Overridden", value: panStatus.overridden },
        ],
        status: !panStatus.applicable ? "Not applicable" : !panStatus.ran ? "Not run" : panStatus.issues === 0 ? "Complete" : `${panStatus.issues} unresolved`,
      },
      {
        title: "Stage 3 · Tally Ledger Reconciliation", applicable: tallyStatus.applicable, ran: tallyStatus.ran,
        summary: [
          { label: "Total", value: tallyStatus.total }, { label: "Matched", value: tallyStatus.matched },
          { label: "Issues", value: tallyStatus.issues }, { label: "Overridden", value: tallyStatus.overridden },
        ],
        status: tallyStatus.bypassed ? "Bypassed (client's Tally data not maintained)" : !tallyStatus.applicable ? "Not applicable" : !tallyStatus.ran ? "Not run" : tallyStatus.issues === 0 ? "Complete" : `${tallyStatus.issues} unresolved`,
      },
      {
        title: "Stage 4 · Checker Review", applicable: true, ran: stage1Ran,
        summary: [
          { label: "Total", value: stage4Data.totalRecords }, { label: "Matched", value: stage4Data.totalMatched },
          { label: "Mismatched", value: stage4Data.totalMismatches }, { label: "Overridden", value: stage4Data.totalOverridden },
        ],
        // "OK"/Complete must mean the SAME thing here as the on-screen tab badge:
        // canFile alone (Stage 1-3 clean) is NOT enough — the checker's Digital
        // Signature is required too, so a clean Stage 1-3 with no signature yet
        // is reported as its own distinct state, not folded into "0 unresolved"
        // (which would misleadingly read as fully done).
        // NOTE: buildOverviewWorkbook() colours this cell green only when the
        // text contains the word "complete" (see tdsReportExcel.ts), so the
        // Ready-to-File wording below must keep it.
        status: !stage1Ran ? "Not run"
          : isFiled ? "Filed"
          : isMarkedReadyToFile ? "Complete — Ready to File"
          : !canFile ? `${stage4Data.totalMismatches} unresolved`
          : !signature ? "Awaiting digital signature"
          : "Complete",
      },
    ],
    overall: [
      { label: "Office Records", value: officeCount.deductees },
      { label: "Stage 1 Mismatched", value: summary.mismatched },
      { label: "Stage 2 Issues", value: panStatus.applicable ? panStatus.issues : "n/a" },
      { label: "Stage 3 Issues", value: tallyStatus.applicable ? tallyStatus.issues : "n/a" },
      { label: "Digital Signature", value: signature ? `Signed — ${signature.signedByName}` : "Not signed" },
    ],
    // Derive the status from the STAGES, not from fileBlockReason. That string is
    // the on-screen hint and can read "Finishing validation status checks…" while
    // a stage is still settling — a transient UI message that has no business in a
    // report going to a client or an auditor.
    finalStatus: isFiled ? "Filed (validation complete)"
      : isMarkedReadyToFile ? "Ready to File — validation complete and signed, not yet filed"
      : canFile ? "All validations complete — ready to mark as Ready to File"
      : (() => {
          const open: string[] = [];
          if (!stage1Ran) open.push("Stage 1 not run");
          else if (summary.mismatched > 0) open.push(`Stage 1: ${summary.mismatched} unresolved`);
          if (panStatus.applicable && !panStatus.ran) open.push("Stage 2 not run");
          else if (panStatus.applicable && panStatus.issues > 0) open.push(`Stage 2: ${panStatus.issues} unresolved`);
          if (tallyStatus.applicable && !tallyStatus.ran) open.push("Stage 3 not run");
          else if (tallyStatus.applicable && tallyStatus.issues > 0) open.push(`Stage 3: ${tallyStatus.issues} unresolved`);
          return open.length ? `Not ready to file — ${open.join("; ")}` : "Validation incomplete";
        })(),
    ready: isFiled || isMarkedReadyToFile || canFile,
  });

  const [exportingOverview, setExportingOverview] = useState(false);
  const runOverview = async (fmt: "xlsx" | "pdf") => {
    setExportingOverview(true);
    try {
      const o = overviewReport();
      // The Overview carries each stage's REAL rows, not just its counts — a
      // summary with no records and no reasons cannot be acted on. Stage 2/3 hand
      // their report up via onStatusChange; a stage that has not run has none.
      const stageReports: StageReport[] = [
        ...(stage1Ran ? [stage1Report()] : []),
        ...(panStatus.applicable && panStatus.getReport ? [panStatus.getReport()] : []),
        ...(tallyStatus.applicable && tallyStatus.getReport ? [tallyStatus.getReport()] : []),
        ...(stage1Ran ? [stage4Report()] : []),
      ];
      if (fmt === "xlsx") await downloadWorkbook(buildOverviewWorkbook(o, reportMeta, stageReports), reportFileName(reportMeta, "Validation Overview", "xlsx"));
      else await exportOverviewPdf(o, reportMeta, stageReports);
    } catch (e: any) { toast({ title: "Export failed", description: e?.message || String(e), variant: "destructive" }); }
    setExportingOverview(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
        <h2 className="text-lg font-bold text-foreground">Validate &amp; Finalise</h2>
        <p className="text-xs text-muted-foreground">Three stages — each has its own <b>Run Validation</b>. Finish all three to mark the return ready to file.</p>
        </div>
        {filing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 shrink-0" disabled={exportingOverview}>
                {exportingOverview ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Overview Report
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => runOverview("xlsx")} className="text-xs gap-2"><FileSpreadsheet size={13} /> Export to Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => runOverview("pdf")} className="text-xs gap-2"><FileWarning size={13} /> Export to PDF (.pdf)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Active return — READ-ONLY. The Client/FY/Quarter/Form come from the shared
          Workspace session (selected once in the Data Entry tab, the single source
          of truth), so they are never re-selected here. */}
      {!selClient ? (
        <div className="flex items-center gap-2 p-4 rounded-lg border bg-muted/30 text-sm text-muted-foreground">
          <Info size={16} className="shrink-0" />
          <span>Select the client and return in the{" "}
            <button type="button" className="underline font-medium text-foreground hover:text-primary" onClick={() => onNavigateDataEntry?.("")}>Data&nbsp;Entry</button>{" "}
            tab — it is loaded here automatically.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 rounded-lg border bg-muted/40 text-sm">
          <span className="font-semibold text-foreground truncate max-w-[260px]">{selectedClient?.name || "—"}</span>
          {selectedClient?.tan_number && <span className="text-muted-foreground">TAN&nbsp;<b className="font-medium text-foreground">{selectedClient.tan_number}</b></span>}
          <span className="text-muted-foreground">{selForm}&nbsp;·&nbsp;{selQuarter}&nbsp;·&nbsp;FY&nbsp;{selFy}</span>
          {filing?.work_status && <Badge variant="outline" className="text-[10px]">{filing.work_status}</Badge>}
          <div className="flex-1" />
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline shrink-0" onClick={() => onNavigateDataEntry?.(filing?.id || "")}>Change in Data Entry</button>
        </div>
      )}

      {cErr && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 text-sm text-amber-700 dark:text-amber-300">
          <FileWarning size={16} /> {cErr}
        </div>
      )}

      {resolving && <Skeleton className="h-24 w-full" />}

      {!resolving && selClient && !cErr && !filing && (
        <div className="flex items-center gap-2 p-4 rounded-lg border bg-muted/30 text-sm text-muted-foreground">
          <Info size={16} /> No filing found for {selForm} {selQuarter} {selFy}. Complete Data Entry for this return first.
        </div>
      )}

      {!resolving && filing && (
        <>
          {/* The stages are a sequence, so they are TABS rather than one very long
              page. Stage 2 and 3 stay MOUNTED while hidden (forceMount): each
              reports its completion up to the Ready-to-File gate, and a stage the
              user has not opened yet must not read as "not applicable". */}
          <Tabs value={stage} onValueChange={(v) => setStage(v as "1" | "2" | "3" | "4")} className="w-full">
            <TabsList className="h-8 p-0.5">
              <TabsTrigger value="1" className="text-xs h-7 gap-1.5 px-3"><FileSpreadsheet size={13} /> Stage 1 · Data{stage1Ran && <span className={cn("ml-0.5 rounded px-1 text-[10px] font-semibold", summary.mismatched === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>{summary.mismatched === 0 ? "OK" : summary.mismatched}</span>}</TabsTrigger>
              <TabsTrigger value="2" className="text-xs h-7 gap-1.5 px-3">
                <BadgeCheck size={13} /> Stage 2 · PAN &amp; Challan
                {(panStatus.ran || challanDownloadStatus.ran) && (() => {
                  const combinedIssues = (panStatus.ran ? panStatus.issues : 0) + (challanDownloadStatus.ran ? challanDownloadStatus.issues : 0);
                  return (
                    <span className={cn("ml-0.5 rounded px-1 text-[10px] font-semibold", combinedIssues === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>
                      {combinedIssues === 0 ? "OK" : combinedIssues}
                    </span>
                  );
                })()}
              </TabsTrigger>
              <TabsTrigger value="3" className="text-xs h-7 gap-1.5 px-3"><BookOpen size={13} /> Stage 3 · Tally{tallyStatus.ran && <span className={cn("ml-0.5 rounded px-1 text-[10px] font-semibold", tallyStatus.issues === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>{tallyStatus.issues === 0 ? "OK" : tallyStatus.issues}</span>}</TabsTrigger>
              {/* "OK" here must mean the SAME thing as "ready to file" below — canFile
                  alone (Stage 1-3 clean) is not that: the checker's Digital Signature is
                  an equally mandatory gate, so a return still missing it is not "OK". */}
              <TabsTrigger value="4" className="text-xs h-7 gap-1.5 px-3"><ClipboardCheck size={13} /> Stage 4 · Checker Review{stage1Ran && <span className={cn("ml-0.5 rounded px-1 text-[10px] font-semibold", canFile && signature ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>{canFile && signature ? "OK" : stage4Data.totalMismatches}</span>}</TabsTrigger>
            </TabsList>

            <TabsContent value="1" forceMount className="data-[state=inactive]:hidden mt-3 space-y-3">
          {/* ── STAGE 1 · DATA VALIDATION — the TAB names the stage, so no heading here. */}

          {/* Inputs — items-start so each card is only as tall as its OWN content.
              Without it the grid stretched Office Data (two numbers) to match the
              file list beside it, which was most of the wasted height. */}
          <div className="grid gap-2 md:grid-cols-2 items-start">
            <Card>
              <CardContent className="p-2.5">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-muted-foreground shrink-0" />
                  <p className="font-semibold text-xs whitespace-nowrap">Office Data</p>
                  <div className="flex-1" />
                  <span className="text-xs whitespace-nowrap"><b className="text-sm font-bold">{officeCount.deductees}</b> <span className="text-muted-foreground">deductees</span></span>
                  <span className="text-xs whitespace-nowrap"><b className="text-sm font-bold">{officeCount.challans}</b> <span className="text-muted-foreground">challans</span></span>
                </div>
                {officeCount.deductees === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1.5">No office deductees yet — enter data in the Data Entry tab first.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-2.5">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={14} className="text-muted-foreground shrink-0" />
                  <p className="font-semibold text-xs whitespace-nowrap">Imported Client Data</p>
                  {batches.length > 0 && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      <b className="text-xs font-bold text-foreground">{batch?.row_count ?? 0}</b> records · {batches.length} file{batches.length > 1 ? "s" : ""}
                    </span>
                  )}
                  <div className="flex-1" />
                  <Button size="sm" variant="outline" className="gap-1 h-6 px-2 text-[11px] shrink-0"
                    onClick={() => downloadTemplateFile(`/templates/TDS_Data_Entry_Simple_Template.xlsx?v=${TDS_TEMPLATE_VERSION}`, "TDS_Data_Entry_Simple_Template.xlsx")}>
                    <Download size={12} /> Download Template
                  </Button>
                  <input ref={fileInputRef} type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.json,.xml,.txt,.html,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,image/*" className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []);
                      const tgt = replaceTargetId; setReplaceTargetId(null);
                      // "Replace this file" targets ONE batch, so it takes the first
                      // pick; a plain Add imports everything selected in one go.
                      if (picked.length) { if (tgt) handleImport(picked[0], tgt); else handleImportMany(picked); }
                      e.currentTarget.value = "";
                    }} />
                  <Button size="sm" variant={batch ? "outline" : "default"} className="gap-1 h-6 px-2 text-[11px] shrink-0"
                    disabled={importing || isLocked} onClick={() => { setReplaceTargetId(null); fileInputRef.current?.click(); }}>
                    {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    {importing ? "Importing…" : batch ? "Add / re-import" : "Import"}
                  </Button>
                </div>
                {importing && (
                  <div className="mt-2" aria-live="polite">
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary transition-all duration-300" style={{ width: `${Math.max(4, importPct)}%` }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 truncate">{importStage || "Working…"}{importPct ? ` · ${importPct}%` : ""}</p>
                  </div>
                )}
                {batches.length > 0 ? (
                  <div className="text-sm">
                    {(selBatchIds.size > 0 || batches.length > 1) && (
                      <div className="flex items-center justify-end gap-1.5 mt-1">
                        {selBatchIds.size > 0 && (
                          <Button size="sm" variant="destructive" className="h-7 gap-1 text-xs px-2" disabled={deleting || isLocked}
                            onClick={() => setDeleteConfirm({ ids: [...selBatchIds], label: `${selBatchIds.size} selected file(s)` })}>
                            <Trash2 size={12} /> Delete ({selBatchIds.size})
                          </Button>
                        )}
                        {batches.length > 1 && selBatchIds.size === 0 && (
                          <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-muted-foreground hover:text-destructive" disabled={deleting || isLocked}
                            onClick={() => setDeleteConfirm({ ids: batches.map((b) => b.id), label: "all imported files" })}>
                            Delete all
                          </Button>
                        )}
                      </div>
                    )}

                    <div className="mt-1.5 rounded-md border divide-y overflow-hidden">
                      {batches.length > 1 && (
                        <label className="flex items-center gap-2 px-2 py-1 bg-muted/40 text-[11px] text-muted-foreground cursor-pointer">
                          <Checkbox checked={allSelected} onCheckedChange={toggleSelAll} aria-label="Select all files" className="h-3.5 w-3.5" disabled={isLocked} />
                          Select all
                        </label>
                      )}
                      {batches.map((b: any) => (
                        /* ONE line per file — name and meta share the row, so N files
                           cost N lines rather than 2N. Meta hides on narrow widths. */
                        <div key={b.id} className="flex items-center gap-1.5 px-2 py-1" title={b.file_name || ""}>
                          <Checkbox checked={selBatchIds.has(b.id)} onCheckedChange={() => toggleSel(b.id)} aria-label={`Select ${b.file_name || "file"}`} className="h-3 w-3 shrink-0" disabled={isLocked} />
                          <p className="font-medium text-[11px] truncate min-w-0 flex-1">{b.file_name || "(unnamed file)"}</p>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 hidden sm:inline">
                            {b.row_count} rows{b.imported_at ? ` · ${fmtDateTime(b.imported_at)}` : ""}
                          </span>
                          <div className="flex items-center shrink-0">
                            <Button size="icon" variant="ghost" className="h-5 w-5" title="View details" onClick={() => openDetails(b)}><Eye size={12} /></Button>
                            {/* Only files imported after the file_url column was added
                                (this feature) have the original bytes to download — an
                                older batch simply omits this button rather than showing
                                one that 404s. */}
                            {b.file_url && (
                              <Button size="icon" variant="ghost" className="h-5 w-5" title={`Download: ${b.file_name || "file"}`}
                                onClick={() => handleDownloadFile(b)}><Download size={12} /></Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-5 w-5" title="Replace this file" disabled={importing || deleting || isLocked} onClick={() => handleReplaceClick(b.id)}><RotateCcw size={12} /></Button>
                            <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-destructive" title="Delete this file" disabled={deleting || isLocked}
                              onClick={() => setDeleteConfirm({ ids: [b.id], label: b.file_name || "this file" })}><Trash2 size={12} /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 truncate" title="Keep a section in a separate workbook (e.g. 194Q)? Add it — all files are validated together. Re-importing the same file name replaces it; adding, replacing or deleting a file re-runs validation automatically.">All files validate together · same file name replaces · changes re-run validation</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Import the client's data in any format — Excel, CSV, PDF, image/scan, JSON, XML or text. You can add multiple files (e.g. a separate 194Q workbook) and they'll be validated together.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Single Run Validation */}
          <div className="flex items-center gap-3">
            <Button className="gap-2 font-semibold h-9" onClick={handleRunValidation}
              disabled={comparing || !batch || isLocked || overAppliedChallans.length > 0}>
              {comparing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {comparing ? "Validating…" : "Run Validation"}
            </Button>
            {!batch && <span className="text-xs text-muted-foreground">Import a client file to enable validation.</span>}
            <div className="flex-1" />
            {results && <TdsExportMenu build={stage1Report} meta={reportMeta} label="Export Stage 1" />}
          </div>
          {/* Persistent, not just a toast — stays visible until the challan is
              fixed in Data Entry, matching how the challan card's own
              "Over-applied" badge is always-on there too. */}
          {overAppliedChallans.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                <b>Challan has been over-applied.</b> {overAppliedChallans.length} challan{overAppliedChallans.length === 1 ? "" : "s"} ({overAppliedChallans.map(c => c.challanNo || "—").join(", ")}) {overAppliedChallans.length === 1 ? "has" : "have"} more applied against{overAppliedChallans.length === 1 ? " it" : " them"} than the amount actually paid. Validation is blocked until this is fixed in Data Entry.
              </span>
            </div>
          )}

          {/* Stage-1 results (summary + comparison) — the heading is above the inputs. */}
          {results && (
            <div className="space-y-3">
              {/* Live, clickable dashboard cards — animated counters; click a card
                  to filter the results to that category, click again to clear. */}
              <div className={cn("grid grid-cols-2 sm:grid-cols-4 gap-2", comparing && "animate-pulse")}>
                {([
                  { key: "total" as const, label: "Total", value: summary.total, cls: "" },
                  { key: "matched" as const, label: "Matched", value: summary.matched, cls: "text-emerald-600" },
                  { key: "mismatched" as const, label: "Mismatched", value: summary.mismatched, cls: summary.mismatched > 0 ? "text-destructive" : "text-emerald-600" },
                  { key: "overridden" as const, label: "Overridden", value: summary.overridden, cls: "text-blue-600" },
                ]).map(s => (
                  <button key={s.label} type="button"
                    onClick={() => { setActiveFilter(activeFilter === s.key ? null : s.key); setErrorTypeFilter(null); }}
                    aria-pressed={activeFilter === s.key}
                    className={cn(
                      "rounded-md border bg-card p-2 text-center transition-all hover:border-primary/50 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      activeFilter === s.key ? "ring-2 ring-primary border-primary" : "border-border",
                    )}>
                    <p className={cn("text-xl font-bold tabular-nums", s.cls)}><AnimatedNumber value={s.value} /></p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </button>
                ))}
              </div>

              {cardFiltered !== null ? (
                /* A summary card is active → show only that category. */
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs px-1">
                    <span className="text-muted-foreground">Showing <b className="text-foreground">{cardFiltered.length}</b> {activeFilter} record{cardFiltered.length === 1 ? "" : "s"}</span>
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setActiveFilter(null)}><X size={11} /> Clear filter</Button>
                  </div>
                  {cardFiltered.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed">No {activeFilter} records found.</div>
                  ) : (
                    <div className="space-y-3">
                      {activeFilter === "mismatched" && (
                        <ErrorTypeBreakdown rows={cardFiltered} getType={errType} activeType={errorTypeFilter} onSelectType={setErrorTypeFilter} />
                      )}
                      {(activeFilter === "mismatched"
                        ? filterByErrorType(cardFiltered.filter(r => r.match_status !== "matched"), errType, errorTypeFilter)
                        : cardFiltered.filter(r => r.match_status !== "matched")
                      ).map(renderMismatchCard)}
                      {cardFiltered.some(r => r.match_status === "matched") && renderMatchedTable(cardFiltered.filter(r => r.match_status === "matched"))}
                    </div>
                  )}
                </div>
              ) : attention.length === 0 ? (
                /* Default view, nothing to action → professional success panel. */
                <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={22} className="text-emerald-600" />
                      <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">Validation Completed Successfully</p>
                    </div>
                    <div className="text-sm text-foreground grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 max-w-xl">
                      <span className="text-muted-foreground">Total Records Processed</span><span className="font-semibold">{summary.total}</span>
                      <span className="text-muted-foreground">Matched Records</span><span className="font-semibold text-emerald-600">{summary.matched}</span>
                      <span className="text-muted-foreground">Mismatched Records</span><span className="font-semibold">{summary.mismatched}</span>
                      <span className="text-muted-foreground">Overridden</span><span className="font-semibold">{summary.overridden}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      All data entries have been validated successfully. No discrepancies were found between the Office Data and the Imported Excel data.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                /* Default view → exceptions only. */
                <div className="space-y-3">
                  <ErrorTypeBreakdown rows={attention} getType={errType} activeType={errorTypeFilter} onSelectType={setErrorTypeFilter} />
                  {filterByErrorType(attention, errType, errorTypeFilter).map(renderMismatchCard)}
                </div>
              )}
            </div>
          )}

            </TabsContent>

            <TabsContent value="2" forceMount className="data-[state=inactive]:hidden mt-3 space-y-3">
          {/* ── STAGE 2 · PAN & CHALLAN — the TAB names the stage; two
              independent sub-sections, each with its own applicable/ran/
              issues gate, both required before Stage 2 counts as done. */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground">PAN Validation</h4>
            <TdsPanVerification
              filing={filing}
              clientName={selectedClient?.name || ""}
              selClient={selClient}
              selFy={selFy}
              selQuarter={selQuarter}
              selForm={selForm}
              runSignal={runSignal}
              resolveFirmId={resolveFirmId}
              disabled={isLocked}
              onStatusChange={setPanStatus}
              onActivity={bumpUnderProcess}
            />
          </div>

          <div className="space-y-2 pt-2 border-t">
            <h4 className="text-xs font-semibold text-muted-foreground pt-2">Challan Validation</h4>
            <TdsChallanDownloadValidation
              filing={filing}
              selClient={selClient}
              selForm={selForm}
              clientTan={selectedClient?.tan_number}
              resolveFirmId={resolveFirmId}
              disabled={isLocked}
              onStatusChange={setChallanDownloadStatus}
              onActivity={bumpUnderProcess}
            />
          </div>

            </TabsContent>

            <TabsContent value="3" forceMount className="data-[state=inactive]:hidden mt-3 space-y-3">
          {/* ── STAGE 3 · TALLY LEDGER RECONCILIATION — the TAB names the stage. */}
          <div className="space-y-2">
            <TdsTallyRecon
              filing={filing}
              clientName={selectedClient?.name || ""}
              selClient={selClient}
              selFy={selFy}
              selQuarter={selQuarter}
              selForm={selForm}
              resolveFirmId={resolveFirmId}
              disabled={isLocked}
              onStatusChange={setTallyStatus}
              onActivity={bumpUnderProcess}
            />
          </div>
            </TabsContent>

            <TabsContent value="4" forceMount className="data-[state=inactive]:hidden mt-3 space-y-3">
          {/* ── STAGE 4 · CHECKER REVIEW — one consolidated summary of Stages 1-3,
              so the checker approves from here without re-visiting each tab. */}
          {results && (
            <>
              <div>
                <p className="font-semibold text-sm">Final Validation Summary</p>
                <p className="text-xs text-muted-foreground">Consolidated results from Stage 1 (Data), Stage 2 (PAN) and Stage 3 (Tally) — reviewed here, not re-checked stage by stage.</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([
                  { label: "Total Records", value: stage4Data.totalRecords, cls: "" },
                  { label: "Total Matched", value: stage4Data.totalMatched, cls: "text-emerald-600" },
                  { label: "Total Mismatches", value: stage4Data.totalMismatches, cls: stage4Data.totalMismatches > 0 ? "text-destructive" : "text-emerald-600" },
                  { label: "Total Overridden", value: stage4Data.totalOverridden, cls: "text-blue-600" },
                ]).map((s) => (
                  <div key={s.label} className="rounded-md border bg-card p-2 text-center">
                    <p className={cn("text-xl font-bold tabular-nums", s.cls)}>{s.value}</p>
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Exception & override review — one section per stage (not a flat
                  table), so each keeps its own vocabulary. Every matching record
                  renders — nothing paginated — since the checker must see every
                  mismatch and override before signing. Overridden records show
                  their reason inline, right where the record is. */}
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-xs font-semibold">Exception &amp; Override Review</p>
                  {(auditStatusFilter !== "all" || auditErrorTypeFilter !== "all") && (
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => { setAuditStatusFilter("all"); setAuditErrorTypeFilter("all"); }}>
                      <X size={11} /> Clear filters
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="inline-flex rounded-md border overflow-hidden">
                    {([["all", "All"], ["Unresolved", "Unresolved"], ["Overridden", "Overridden"]] as const).map(([v, label], i) => (
                      <button key={v} type="button" onClick={() => setAuditStatusFilter(v)}
                        className={cn("px-2.5 h-7 text-xs font-medium", i > 0 && "border-l", auditStatusFilter === v ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <Select value={auditErrorTypeFilter} onValueChange={setAuditErrorTypeFilter}>
                    <SelectTrigger className="h-7 w-[180px] text-xs"><SelectValue placeholder="Error Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Error Types</SelectItem>
                      {auditErrorTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {stage4Data.auditRows.length === 0 ? (
                  <div className="p-6 text-center text-sm text-emerald-600 rounded-lg border border-dashed">No mismatches or overrides across any stage — clean return.</div>
                ) : (
                  ([
                    ["Stage 1", "Data Validation", true, stage1Ran],
                    ["Stage 2", "PAN Verification", panStatus.applicable, panStatus.ran],
                    ["Stage 3", "Tally Reconciliation", tallyStatus.applicable, tallyStatus.ran],
                  ] as const).map(([stageKey, label, applicable, ran]) => {
                    const stageRows = stage4Data.auditRows.filter((r) => r.stage === stageKey);
                    const visibleRows = filteredAuditRows.filter((r) => r.stage === stageKey);
                    const unresolvedCount = stageRows.filter((r) => r.status === "Unresolved").length;
                    const overriddenCount = stageRows.filter((r) => r.status === "Overridden").length;
                    const collapsed = collapsedStages.has(stageKey);
                    return (
                      <div key={stageKey} className="rounded-lg border overflow-hidden">
                        <button type="button" onClick={() => toggleStageCollapsed(stageKey)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-muted/40 hover:bg-muted/60 text-left">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {collapsed ? <ChevronRight size={16} className="text-muted-foreground shrink-0" /> : <ChevronDown size={16} className="text-muted-foreground shrink-0" />}
                            {stageKey} · {label}
                          </span>
                          {!applicable ? (
                            <span className="text-[10px] rounded px-1.5 py-0.5 font-semibold bg-muted text-muted-foreground shrink-0">Not applicable</span>
                          ) : !ran ? (
                            <span className="text-[10px] rounded px-1.5 py-0.5 font-semibold bg-muted text-muted-foreground shrink-0">Not run</span>
                          ) : unresolvedCount === 0 && overriddenCount === 0 ? (
                            <span className="text-[10px] rounded px-1.5 py-0.5 font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 inline-flex items-center gap-1 shrink-0"><CheckCircle2 size={11} /> Complete</span>
                          ) : (
                            <span className="flex items-center gap-1.5 shrink-0">
                              {unresolvedCount > 0 && <span className="text-[10px] rounded px-1.5 py-0.5 font-semibold bg-destructive/10 text-destructive">{unresolvedCount} unresolved</span>}
                              {overriddenCount > 0 && <span className="text-[10px] rounded px-1.5 py-0.5 font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{overriddenCount} overridden</span>}
                            </span>
                          )}
                        </button>
                        {!collapsed && (
                          <div className="p-2.5 space-y-2">
                            {stageRows.length === 0 ? (
                              <p className="text-xs text-muted-foreground px-1 py-1">No exceptions or overrides in this stage.</p>
                            ) : visibleRows.length === 0 ? (
                              <p className="text-xs text-muted-foreground px-1 py-1">No records match the current filters.</p>
                            ) : visibleRows.map((r, i) => (
                              <div key={`${stageKey}-${i}`} className="rounded-md border p-2.5 space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-medium truncate">{r.record}</span>
                                  <Badge variant="outline" className={cn("text-[10px] shrink-0",
                                    r.status === "Overridden" ? "border-blue-300 text-blue-600" : r.status === "Resolved" ? "border-emerald-300 text-emerald-600" : "border-destructive/40 text-destructive")}>
                                    {r.status}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">{r.errorType}</p>
                                {r.status === "Overridden" ? (
                                  <p className="text-xs rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 px-2 py-1.5 text-blue-700 dark:text-blue-300">
                                    <span className="font-medium">Override reason: </span>{r.reason || "accepted"}
                                  </p>
                                ) : (
                                  <p className="text-xs text-foreground">{r.reason || "—"}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Digital signature — a mandatory gate BEFORE the return can be
                  marked ready to file, on top of (not instead of) canFile. */}
              <Card className={cn(signature ? "border-emerald-200 dark:border-emerald-800" : "border-amber-200 dark:border-amber-800")}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className={signature ? "text-emerald-600" : "text-muted-foreground"} />
                    <p className="text-sm font-semibold">Digital Signature — Checker Sign-Off</p>
                  </div>
                  {isFiled && !signature ? (
                    <p className="text-xs text-muted-foreground">Return already filed.</p>
                  ) : signature ? (
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        ✓ Digitally signed by <b>{signature.signedByName}</b> on {new Date(signature.signedAt).toLocaleString("en-IN")}
                      </p>
                      {canSign && (
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={signing} onClick={handleRevokeSignature}>
                          <RotateCcw size={12} /> Revoke Signature
                        </Button>
                      )}
                    </div>
                  ) : !canSign ? (
                    <p className="text-xs text-muted-foreground">
                      Only the Firm Admin or Super Admin is authorized to digitally sign and approve this return for filing.
                    </p>
                  ) : !canFile ? (
                    <p className="text-xs text-muted-foreground">Resolve every Stage 1, 2 and 3 issue above before signing.</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Signing as <b>{userMap[user?.id ?? ""] || user?.email || "—"}</b>. Confirm below to digitally sign this return, attesting you have reviewed every mismatch, override and mapping listed above.
                      </p>
                      <div className="flex items-start gap-2">
                        <Checkbox id="checker-attest" checked={attestChecked} onCheckedChange={(v) => setAttestChecked(!!v)} className="mt-0.5" />
                        <Label htmlFor="checker-attest" className="text-xs font-normal leading-snug">
                          I have reviewed all exceptions, overrides and mappings across Stage 1, 2 and 3, and I confirm this return is ready for filing.
                        </Label>
                      </div>
                      <Button size="sm" className="h-8 gap-1 text-xs" disabled={signing || !attestChecked} onClick={handleSign}>
                        {signing ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Sign &amp; Confirm
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Final verdict + filing action — moved here from Stage 3: the
                  checker signs off from this ONE tab. */}
              <Card className={cn(canFile ? "border-emerald-200 dark:border-emerald-800" : "border-amber-200 dark:border-amber-800")}>
                <CardContent className="p-4">
                  {isLocked ? (
                    <div className="space-y-3">
                      {isFiled ? (
                        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                            ✓ Return marked as Filed. Generate Genius XLS Export from the Reports section.
                          </p>
                        </div>
                      ) : isMarkedReadyToFile ? (
                        <div className="p-4 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800">
                          <p className="text-sm font-semibold text-sky-700 dark:text-sky-300">
                            ✓ Return marked as Ready to File.
                          </p>
                          <p className="text-xs text-sky-700/80 dark:text-sky-300/80 mt-1">
                            All validations are complete and the checker has signed. This return is
                            <b> not filed yet</b> — file it on the income-tax portal, then attach the
                            acknowledgement (ACK) in the Client Filing Summary to move it to Filed.
                          </p>
                        </div>
                      ) : (
                        // Processed with/without Default — same locked treatment as
                        // Filed, one status further down the same forward-only chain.
                        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                            ✓ Return marked as {filing?.work_status}.
                          </p>
                        </div>
                      )}

                      {/* Data Entry, Validate & Finalise and attached documents are all
                          frozen at this status (isLocked) — Ready to File, Filed, and
                          Processed with/without Default alike. The ONLY way back to an
                          editable state is Revoke Signature above (Firm Admin/Super
                          Admin only) or — for everyone else — a request approved here. */}
                      <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                        <div className="flex items-center gap-2">
                          <Lock size={13} className="text-muted-foreground shrink-0" />
                          <p className="text-xs font-semibold">Data Entry, validation and attached documents are locked</p>
                        </div>
                        {editRequest?.status === "pending" ? (
                          canSign ? (
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground">
                                <b>{editRequest.requested_by_name || "A staff member"}</b> requested edit access
                                {editRequest.created_at ? ` on ${new Date(editRequest.created_at).toLocaleString("en-IN")}` : ""}:
                              </p>
                              <p className="text-xs italic border-l-2 pl-2">{editRequest.reason}</p>
                              <div className="flex items-center gap-2">
                                <Button size="sm" className="h-7 gap-1 text-xs" disabled={reviewingRequest} onClick={approveEditRequest}>
                                  {reviewingRequest ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Approve
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-destructive" disabled={reviewingRequest} onClick={() => setRejectDialogOpen(true)}>
                                  <X size={12} /> Reject
                                </Button>
                              </div>
                              <p className="text-[11px] text-muted-foreground">Approving has the same effect as Revoke Signature above — the return moves back to Under Review, unlocked, and must be re-signed before it can be Ready to File again.</p>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Your request is pending review by a Firm Admin or Super Admin: <span className="italic">"{editRequest.reason}"</span>
                            </p>
                          )
                        ) : canSign ? (
                          <p className="text-xs text-muted-foreground">
                            You can unlock this return yourself via <b>Revoke Signature</b> above, or wait for a staff member to request access here.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {editRequest?.status === "rejected" && (
                              <p className="text-xs text-destructive">
                                Your last request was rejected by {editRequest.reviewed_by_name || "a reviewer"}{editRequest.review_note ? `: "${editRequest.review_note}"` : "."}
                              </p>
                            )}
                            {editRequest?.status === "approved" && (
                              <p className="text-xs text-emerald-600">Your last request was approved — this is a fresh request.</p>
                            )}
                            <p className="text-xs text-muted-foreground">If a change is needed now, request permission from a Firm Admin or Super Admin.</p>
                            <Textarea value={editRequestReason} onChange={(e) => setEditRequestReason(e.target.value)} rows={2}
                              placeholder="What needs to change, and why?" className="text-xs" disabled={requestingEdit} />
                            <Button size="sm" className="h-7 gap-1 text-xs" disabled={requestingEdit || !editRequestReason.trim()} onClick={submitEditRequest}>
                              {requestingEdit ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Request permission to edit
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-3 mb-4">
                        {canFile && signature ? <CheckCircle2 size={24} className="text-emerald-600 mt-0.5 shrink-0" /> : <AlertTriangle size={24} className="text-amber-600 mt-0.5 shrink-0" />}
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">
                            {canFile && signature ? "All validations complete — ready to file" : "Return not ready to file"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {canFile && signature
                              ? "All applicable stages are reconciled with no unresolved items and the checker has signed. Optional stages without an imported file are skipped."
                              : !canFile ? fileBlockReason : "The checker must digitally sign this return (above) before it can be marked ready to file."}
                          </p>
                          {/* Per-stage completion checklist — the user sees exactly what remains. */}
                          <div className="mt-3 space-y-1 text-xs">
                            <div className="flex items-center gap-1.5">
                              {stage1Ready ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" /> : <X size={13} className="text-destructive shrink-0" />}
                              <span className={stage1Ready ? "text-foreground" : "text-muted-foreground"}>
                                Stage 1 · Data reconciliation{stage1Ready ? " — complete" : stage1Ran ? ` — ${summary.mismatched} unresolved` : " — not run"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {!panStatus.applicable ? <Info size={13} className="text-muted-foreground shrink-0" /> : stage2PanReady ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" /> : <X size={13} className="text-destructive shrink-0" />}
                              <span className={!panStatus.applicable ? "text-muted-foreground" : stage2PanReady ? "text-foreground" : "text-muted-foreground"}>
                                Stage 2 · PAN validation{
                                  !panStatus.applicable ? " — optional (no TRACES file imported)"
                                  : !panStatus.ran ? " — not run"
                                  : panStatus.issues > 0 ? ` — ${panStatus.issues} unresolved`
                                  : " — complete"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {!challanDownloadStatus.applicable ? <Info size={13} className="text-muted-foreground shrink-0" /> : stage2ChallanReady ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" /> : <X size={13} className="text-destructive shrink-0" />}
                              <span className={!challanDownloadStatus.applicable ? "text-muted-foreground" : stage2ChallanReady ? "text-foreground" : "text-muted-foreground"}>
                                Stage 2 · Challan validation{
                                  !challanDownloadStatus.applicable ? " — optional (no challan report imported)"
                                  : !challanDownloadStatus.ran ? " — not run"
                                  : challanDownloadStatus.issues > 0 ? ` — ${challanDownloadStatus.issues} unresolved`
                                  : " — complete"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {!tallyStatus.applicable ? <Info size={13} className="text-muted-foreground shrink-0" /> : stage3Ready ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" /> : <X size={13} className="text-destructive shrink-0" />}
                              <span className={!tallyStatus.applicable ? "text-muted-foreground" : stage3Ready ? "text-foreground" : "text-muted-foreground"}>
                                Stage 3 · Tally reconciliation{
                                  tallyStatus.bypassed ? " — bypassed (client's Tally data not maintained)"
                                  : !tallyStatus.applicable ? " — optional (no Tally ledger imported)"
                                  : !tallyStatus.ran ? " — not run"
                                  : tallyStatus.issues > 0 ? ` — ${tallyStatus.issues} unresolved`
                                  : " — complete"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {signature ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" /> : <X size={13} className="text-destructive shrink-0" />}
                              <span className={signature ? "text-foreground" : "text-muted-foreground"}>
                                Digital signature{signature ? ` — signed by ${signature.signedByName}` : " — not signed"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <Button size="lg" className="gap-2" disabled={!canFile || !signature} onClick={() => setConfirmOpen(true)}>
                        <ShieldCheck size={16} /> Mark Return as Ready to File
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Override — mandatory reason (writes the audit trail) */}
      <Dialog open={ovOpen} onOpenChange={(o) => { if (!o) setOvOpen(false); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck size={16} /> Override mismatch</DialogTitle></DialogHeader>
          {ovTarget && (
            <div className="space-y-3 py-1">
              <div className="text-sm">
                <p className="font-semibold">{ovTarget.record_label || "—"}</p>
                <p className="text-destructive text-xs mt-0.5">{reasonFor(ovTarget)}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reason for accepting this mismatch <span className="text-destructive">*</span></Label>
                <Textarea value={ovReason} onChange={e => setOvReason(e.target.value)} rows={3}
                  placeholder="e.g. Office section 194J is correct; client file used a descriptive label. Verified with client." />
                <p className="text-[11px] text-muted-foreground">Recorded in the filing audit trail with your name, the time, and the difference.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOvOpen(false)}>Cancel</Button>
            <Button onClick={saveOverride} disabled={savingOv || !ovReason.trim()}>
              {savingOv ? "Saving…" : "Confirm Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm finalise */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Finalisation</DialogTitle></DialogHeader>
          <div className="space-y-3 py-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted">
                <p className="text-xl font-bold text-foreground">{summary.matched}</p>
                <p className="text-xs text-muted-foreground">Matched</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted">
                <p className="text-xl font-bold text-foreground">{summary.overridden}</p>
                <p className="text-xs text-muted-foreground">Overridden</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted">
                <p className="text-xl font-bold text-foreground">{summary.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              This will mark the return as <strong>Ready to File</strong> and enable the Genius XLS
              Export in Reports. It does <strong>not</strong> file the return — after filing on the
              portal, attach the ACK in the Client Filing Summary to move it to Filed. Proceed?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleFinalise} disabled={finalising}>
              {finalising ? "Finalising…" : "Confirm & Mark Ready to File"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject edit-access request */}
      <Dialog open={rejectDialogOpen} onOpenChange={(o) => { if (!o) { setRejectDialogOpen(false); setRejectNote(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject edit request?</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {editRequest && (
              <p className="text-sm text-muted-foreground">
                <b>{editRequest.requested_by_name || "The requester"}</b> asked: <span className="italic">"{editRequest.reason}"</span>
              </p>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Note to the requester (optional)</Label>
              <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={2} placeholder="e.g. Not needed — the figure is correct as filed." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialogOpen(false); setRejectNote(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={rejectEditRequest} disabled={reviewingRequest}>
              {reviewingRequest ? "Rejecting…" : "Reject Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm file deletion */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Trash2 size={16} className="text-destructive" /> Remove {deleteConfirm?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {deleteConfirm && deleteConfirm.ids.length > 1 ? `these ${deleteConfirm.ids.length} files` : "this file"} and every record imported from {deleteConfirm && deleteConfirm.ids.length > 1 ? "them" : "it"} from the consolidated dataset. Validation is re-run automatically on the remaining files. This can't be undone — you'd need to re-import.
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

      {/* Imported-file details */}
      <Dialog open={!!detailsBatch} onOpenChange={(o) => { if (!o) { setDetailsBatch(null); setDetailsRows(null); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileSpreadsheet size={15} /> {detailsBatch?.file_name || "Imported file"}
              <span className="text-xs font-normal text-muted-foreground">
                {detailsBatch ? `· ${(detailsBatch.file_type || "").toUpperCase()} · ${detailsBatch.row_count} rows · ${fmtDateTime(detailsBatch.imported_at)}` : ""}
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
                    <TableHead className="text-[11px]">Name</TableHead>
                    <TableHead className="text-[11px]">PAN</TableHead>
                    <TableHead className="text-[11px]">Section</TableHead>
                    <TableHead className="text-[11px] text-right">Amount</TableHead>
                    <TableHead className="text-[11px] text-right">TDS</TableHead>
                    <TableHead className="text-[11px]">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailsRows.map((r: any, i: number) => (
                    <TableRow key={r.id || i}>
                      <TableCell className="text-[11px] text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-[11px] max-w-[220px] truncate">{r.deductee_name || "—"}</TableCell>
                      <TableCell className="text-[11px] font-mono">{r.pan || "—"}</TableCell>
                      <TableCell className="text-[11px]">{r.section_code || "—"}</TableCell>
                      <TableCell className="text-[11px] text-right">{r.amount_paid ?? "—"}</TableCell>
                      <TableCell className="text-[11px] text-right">{r.tds_amount ?? "—"}</TableCell>
                      <TableCell className="text-[11px]">{r.date_of_payment || r.date_of_deduction || "—"}</TableCell>
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
