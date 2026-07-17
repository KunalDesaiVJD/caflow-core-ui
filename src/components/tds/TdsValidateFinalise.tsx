import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isQuarterInTdsRange, clientHasTdsForm } from "@/lib/tdsQuarter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { cn } from "@/lib/utils";
import {
  ShieldCheck, AlertTriangle, CheckCircle2, Upload, Play, FileSpreadsheet,
  RotateCcw, Loader2, Users, FileWarning, Info, X, BadgeCheck, Trash2, Eye, BookOpen,
} from "lucide-react";
import { parseWorkbookRows, parseCsvRows } from "@/lib/tdsWorkbook";
import { logReconAudit } from "@/lib/tdsReconAudit";
import { TdsPanVerification, type PanStageStatus } from "./TdsPanVerification";
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

const FIELD_LABELS: Record<string, string> = {
  name: "Name", pan: "PAN", date: "Date", amount: "Amount",
  tds: "TDS", interest: "Interest", section: "Section",
};

const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
};

/** All 7 compared fields, in fixed order. */
const DIFF_FIELDS = ["name", "pan", "date", "amount", "tds", "interest", "section"] as const;

/** One-line reason a record is not a clean match, naming the exact field(s). */
function reasonFor(r: ReconResult): string {
  if (r.match_status === "matched") return "All 7 fields match.";
  if (r.match_status === "office_only") return "In Office Data only — no matching row in the imported client file.";
  if (r.match_status === "imported_only") return "In the imported client file only — no matching Office Data record.";
  const diffs = (r.field_diffs || []).filter(f => f.matched === false);
  const labels = diffs.map(f => FIELD_LABELS[f.field] || f.field).join(", ") || "some fields";
  return `Mismatch — ${labels} ${diffs.length > 1 ? "differ" : "difference"}.`;
}

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
  selClient, selFy, selQuarter, selForm,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [resolving, setResolving] = useState(false);
  const [filing, setFiling] = useState<any>(null);
  const [officeCount, setOfficeCount] = useState({ deductees: 0, challans: 0 });
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

  const [importing, setImporting] = useState(false);
  const [importStage, setImportStage] = useState<string>("");
  const [importPct, setImportPct] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runSignal, setRunSignal] = useState(0);
  // Which stage tab is showing. The stages are a SEQUENCE (data -> PAN -> ledger),
  // so they get their own tabs instead of one long scroll, and the Finalise
  // summary lives only on the last one.
  const [stage, setStage] = useState<"1" | "2" | "3">("1");
  const [activeFilter, setActiveFilter] = useState<FilterKey>(null); // clicked summary card
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

    const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", match.id);
    if (stale()) return;
    const chIds = (ch || []).map((c: any) => c.id);
    let dedCount = 0;
    if (chIds.length) {
      const { count } = await supabase.from("tds_deductees").select("id", { count: "exact", head: true }).in("challan_id", chIds);
      if (stale()) return;
      dedCount = count || 0;
    }
    setOfficeCount({ deductees: dedCount, challans: chIds.length });

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
    setResolving(false);
  }, [selClient, selFy, selQuarter, selForm, complianceError]);

  useEffect(() => { loadAll(); }, [loadAll]);

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
      const parsed = await readFile(file, (p) => { const { label, pct } = progressLabel(p); setImportStage(label); setImportPct(pct); });
      setImportStage("Normalising & saving…"); setImportPct(88);
      const data = await Promise.race([
        // Pass the Office Data count so the importer can flag a big record-count
        // gap (e.g. read 33 but Office has 100) instead of silently under-reading.
        invokeFn("tds-recon-import", { filing_id: filing.id, form_type: selForm, file_name: file.name, expected_count: officeCount.deductees || undefined, ...parsed }, { signal: ctrl.signal }),
        new Promise((_, rej) => ctrl.signal.addEventListener("abort", () => rej(new Error("aborted-timeout")))),
      ]) as any;
      setImportPct(100);
      // "Replace this file" with a DIFFERENTLY-named file: drop the old batch so
      // the new one takes its place. (A same-named file is already replaced by the
      // importer's own file-name de-dupe, so this becomes a harmless no-op then.)
      if (replaceBatchId && replaceBatchId !== data.batch_id) {
        await supabase.from("tds_imported_rows").delete().eq("batch_id", replaceBatchId);
        const { error: delErr } = await supabase.from("tds_import_batches").delete().eq("id", replaceBatchId);
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
      await loadAll();
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
    setComparing(true);
    try {
      validationToast(await runCompare(filing.id));
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
      // Remove the rows, then the batch (tds_recon_results referencing it cascade),
      // then wipe any surviving comparison for the filing — it counted these rows.
      await supabase.from("tds_imported_rows").delete().in("batch_id", ids);
      await supabase.from("tds_import_batches").delete().in("id", ids);
      await supabase.from("tds_recon_results").delete().eq("filing_id", filing.id);
      setResults(null);
      setSelBatchIds(new Set());
      toast({ title: ids.length === 1 ? "File removed" : `${ids.length} files removed`, description: "Imported dataset updated." });
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

  const handleFinalise = async () => {
    if (!filing) return;
    // Re-assert the whole gate at WRITE time — canFile only guards the button and
    // the dialog can outlive a late Stage-2 status flip, so never file an unready
    // return even if the confirm dialog was already open.
    if (!canFile) { toast({ title: "Not ready to file", description: fileBlockReason || "Complete all validations first.", variant: "destructive" }); setConfirmOpen(false); return; }
    setFinalising(true);
    const actingName = userMap[user?.id ?? ""];
    // Set checker_id ("Filed By") on entering Filed — same invariant the Filings
    // Manager enforces, so a return filed from here still records who filed it.
    const { error } = await supabase.from("tds_filings").update({
      work_status: "Filed", checker_id: user?.id, last_updated_by: user?.id, last_updated_at: new Date().toISOString(),
    }).eq("id", filing.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      await logReconAudit({ filingId: filing.id, firmId: filing.firm_id, userId: user?.id, userName: actingName, actionType: "STATUS_CHANGE", oldValue: filing.work_status || null, newValue: "Filed", remark: "Marked Ready to File from Validate & Finalise" });
      if (user?.id) await logReconAudit({ filingId: filing.id, firmId: filing.firm_id, userId: user.id, userName: actingName, actionType: "FILED_BY_SET", newValue: actingName || "—", remark: "Auto-set: status moved to Filed" });
      toast({ title: "Return marked as Filed" }); setFiling({ ...filing, work_status: "Filed", checker_id: user?.id });
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
  const [tallyStatus, setTallyStatus] = useState<TallyStageStatus>({ filingId: null, loaded: false, applicable: false, ran: false, total: 0, matched: 0, issues: 0, overridden: 0 });
  const stage1Ran = (results?.length ?? 0) > 0;
  const stage1Ready = stage1Ran && summary.mismatched === 0;
  // Each embedded stage's report must describe the CURRENTLY-selected filing AND
  // have settled (loaded) — during a fast filing switch or the initial load window
  // the child's report can still describe the previous return or hold pre-load
  // defaults, so the gate defaults CLOSED until the current filing has reported.
  const stage2Reported = panStatus.loaded && panStatus.filingId != null && panStatus.filingId === (filing?.id ?? null);
  const stage2Ready = stage2Reported && (!panStatus.applicable || (panStatus.ran && panStatus.issues === 0));
  const stage3Reported = tallyStatus.loaded && tallyStatus.filingId != null && tallyStatus.filingId === (filing?.id ?? null);
  const stage3Ready = stage3Reported && (!tallyStatus.applicable || (tallyStatus.ran && tallyStatus.issues === 0));
  const canFile = stage1Ready && stage2Ready && stage3Ready;
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
    : (tallyStatus.applicable && !tallyStatus.ran)
    ? "A Tally ledger is imported — run Stage-3 reconciliation to complete it."
    : (tallyStatus.applicable && tallyStatus.issues > 0)
    ? `${tallyStatus.issues} Stage-3 Tally item${tallyStatus.issues === 1 ? "" : "s"} still unresolved — map, override or resolve each one to continue.`
    : "";
  const isFiled = filing?.work_status === "Filed";
  const cErr = selClient ? complianceError() : null;
  const selectedClient = clients.find(c => c.id === selClient);

  // Non-matched records (mismatched / office_only / imported_only) — each gets its
  // own inline comparison table; pending first, then overridden.
  const attention = useMemo(() => {
    const rs = (results || []).filter(r => r.match_status !== "matched");
    return rs.sort((a, b) => (a.overridden ? 1 : 0) - (b.overridden ? 1 : 0));
  }, [results]);

  // Reset the active card filter AND the Stage-2 gate status when the selection
  // changes, so the filing gate defaults closed until the new filing's Stage-2
  // reports (prevents filing off a previous return's status during a fast switch).
  useEffect(() => { setActiveFilter(null); setPanStatus(PAN_STATUS_BLOCKED); setTallyStatus({ filingId: null, loaded: false, applicable: false, ran: false, total: 0, matched: 0, issues: 0, overridden: 0 }); }, [selClient, selFy, selQuarter, selForm]);

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
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openOverride(r)} disabled={isFiled}>
        <ShieldCheck size={12} /> Override
      </Button>
    )
  );

  // One mismatch/exception record → a card showing only the differing fields.
  const renderMismatchCard = (r: ReconResult) => {
    const diffs = r.field_diffs || [];
    return (
      <Card key={r.id} className={cn(r.overridden ? "border-blue-200 dark:border-blue-900 opacity-80" : "border-destructive/30")}>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-muted/30">
            <div className="flex items-center gap-2 min-w-0">
              <p className="font-semibold text-sm truncate">{r.record_label || "—"}</p>
              {r.overridden && <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300 shrink-0">Overridden{r.overridden_by && userMap[r.overridden_by] ? ` · ${userMap[r.overridden_by]}` : ""}</Badge>}
            </div>
            {!isFiled && overrideBtn(r)}
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

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-foreground">Validate &amp; Finalise</h2>
        <p className="text-xs text-muted-foreground">Three stages — each has its own <b>Run Validation</b>. Finish all three to mark the return ready to file.</p>
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
          <Tabs value={stage} onValueChange={(v) => setStage(v as "1" | "2" | "3")} className="w-full">
            <TabsList className="h-8 p-0.5">
              <TabsTrigger value="1" className="text-xs h-7 gap-1.5 px-3"><FileSpreadsheet size={13} /> Stage 1 · Data{stage1Ran && <span className={cn("ml-0.5 rounded px-1 text-[10px] font-semibold", summary.mismatched === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>{summary.mismatched === 0 ? "OK" : summary.mismatched}</span>}</TabsTrigger>
              <TabsTrigger value="2" className="text-xs h-7 gap-1.5 px-3"><BadgeCheck size={13} /> Stage 2 · PAN{panStatus.ran && <span className={cn("ml-0.5 rounded px-1 text-[10px] font-semibold", panStatus.issues === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>{panStatus.issues === 0 ? "OK" : panStatus.issues}</span>}</TabsTrigger>
              <TabsTrigger value="3" className="text-xs h-7 gap-1.5 px-3"><BookOpen size={13} /> Stage 3 · Tally{tallyStatus.ran && <span className={cn("ml-0.5 rounded px-1 text-[10px] font-semibold", tallyStatus.issues === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>{tallyStatus.issues === 0 ? "OK" : tallyStatus.issues}</span>}</TabsTrigger>
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
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.json,.xml,.txt,.html,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; const tgt = replaceTargetId; setReplaceTargetId(null); if (f) handleImport(f, tgt || undefined); e.currentTarget.value = ""; }} />
                  <Button size="sm" variant={batch ? "outline" : "default"} className="gap-1 h-6 px-2 text-[11px] shrink-0"
                    disabled={importing || isFiled} onClick={() => { setReplaceTargetId(null); fileInputRef.current?.click(); }}>
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
                          <Button size="sm" variant="destructive" className="h-7 gap-1 text-xs px-2" disabled={deleting || isFiled}
                            onClick={() => setDeleteConfirm({ ids: [...selBatchIds], label: `${selBatchIds.size} selected file(s)` })}>
                            <Trash2 size={12} /> Delete ({selBatchIds.size})
                          </Button>
                        )}
                        {batches.length > 1 && selBatchIds.size === 0 && (
                          <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-muted-foreground hover:text-destructive" disabled={deleting || isFiled}
                            onClick={() => setDeleteConfirm({ ids: batches.map((b) => b.id), label: "all imported files" })}>
                            Delete all
                          </Button>
                        )}
                      </div>
                    )}

                    <div className="mt-1.5 rounded-md border divide-y overflow-hidden">
                      {batches.length > 1 && (
                        <label className="flex items-center gap-2 px-2 py-1 bg-muted/40 text-[11px] text-muted-foreground cursor-pointer">
                          <Checkbox checked={allSelected} onCheckedChange={toggleSelAll} aria-label="Select all files" className="h-3.5 w-3.5" disabled={isFiled} />
                          Select all
                        </label>
                      )}
                      {batches.map((b: any) => (
                        /* ONE line per file — name and meta share the row, so N files
                           cost N lines rather than 2N. Meta hides on narrow widths. */
                        <div key={b.id} className="flex items-center gap-1.5 px-2 py-1" title={b.file_name || ""}>
                          <Checkbox checked={selBatchIds.has(b.id)} onCheckedChange={() => toggleSel(b.id)} aria-label={`Select ${b.file_name || "file"}`} className="h-3 w-3 shrink-0" disabled={isFiled} />
                          <p className="font-medium text-[11px] truncate min-w-0 flex-1">{b.file_name || "(unnamed file)"}</p>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 hidden sm:inline">
                            {b.row_count} rows{b.imported_at ? ` · ${fmtDateTime(b.imported_at)}` : ""}
                          </span>
                          <div className="flex items-center shrink-0">
                            <Button size="icon" variant="ghost" className="h-5 w-5" title="View details" onClick={() => openDetails(b)}><Eye size={12} /></Button>
                            <Button size="icon" variant="ghost" className="h-5 w-5" title="Replace this file" disabled={importing || deleting || isFiled} onClick={() => handleReplaceClick(b.id)}><RotateCcw size={12} /></Button>
                            <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-destructive" title="Delete this file" disabled={deleting || isFiled}
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
              disabled={comparing || !batch || isFiled}>
              {comparing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {comparing ? "Validating…" : "Run Validation"}
            </Button>
            {!batch && <span className="text-xs text-muted-foreground">Import a client file to enable validation.</span>}
          </div>

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
                    onClick={() => setActiveFilter(activeFilter === s.key ? null : s.key)}
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
                      {cardFiltered.filter(r => r.match_status !== "matched").map(renderMismatchCard)}
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
                <div className="space-y-3">{attention.map(renderMismatchCard)}</div>
              )}
            </div>
          )}

            </TabsContent>

            <TabsContent value="2" forceMount className="data-[state=inactive]:hidden mt-3 space-y-3">
          {/* ── STAGE 2 · PAN VERIFICATION — the TAB names the stage. */}
          <div className="space-y-2">
            <TdsPanVerification
              filing={filing}
              selClient={selClient}
              selFy={selFy}
              selQuarter={selQuarter}
              selForm={selForm}
              runSignal={runSignal}
              resolveFirmId={resolveFirmId}
              disabled={isFiled}
              onStatusChange={setPanStatus}
            />
          </div>

            </TabsContent>

            <TabsContent value="3" forceMount className="data-[state=inactive]:hidden mt-3 space-y-3">
          {/* ── STAGE 3 · TALLY LEDGER RECONCILIATION — the TAB names the stage. */}
          <div className="space-y-2">
            <TdsTallyRecon
              filing={filing}
              selClient={selClient}
              selFy={selFy}
              selQuarter={selQuarter}
              selForm={selForm}
              resolveFirmId={resolveFirmId}
              disabled={isFiled}
              onStatusChange={setTallyStatus}
            />
          </div>


          {/* Finalise (gated on Stage 1 pending = 0) */}
          {results && (
            <Card className={cn(canFile ? "border-emerald-200 dark:border-emerald-800" : "border-amber-200 dark:border-amber-800")}>
              <CardContent className="p-4">
                {isFiled ? (
                  <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      ✓ Return marked as Filed. Generate Genius XLS Export from the Reports section.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3 mb-4">
                      {canFile ? <CheckCircle2 size={24} className="text-emerald-600 mt-0.5 shrink-0" /> : <AlertTriangle size={24} className="text-amber-600 mt-0.5 shrink-0" />}
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">
                          {canFile ? "All validations complete — ready to file" : "Return not ready to file"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {canFile
                            ? "All applicable stages are reconciled with no unresolved items. Optional stages without an imported file are skipped."
                            : fileBlockReason}
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
                            {!panStatus.applicable ? <Info size={13} className="text-muted-foreground shrink-0" /> : stage2Ready ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" /> : <X size={13} className="text-destructive shrink-0" />}
                            <span className={!panStatus.applicable ? "text-muted-foreground" : stage2Ready ? "text-foreground" : "text-muted-foreground"}>
                              Stage 2 · PAN verification{
                                !panStatus.applicable ? " — optional (no TRACES file imported)"
                                : !panStatus.ran ? " — not run"
                                : panStatus.issues > 0 ? ` — ${panStatus.issues} unresolved`
                                : " — complete"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {!tallyStatus.applicable ? <Info size={13} className="text-muted-foreground shrink-0" /> : stage3Ready ? <CheckCircle2 size={13} className="text-emerald-600 shrink-0" /> : <X size={13} className="text-destructive shrink-0" />}
                            <span className={!tallyStatus.applicable ? "text-muted-foreground" : stage3Ready ? "text-foreground" : "text-muted-foreground"}>
                              Stage 3 · Tally reconciliation{
                                !tallyStatus.applicable ? " — optional (no Tally ledger imported)"
                                : !tallyStatus.ran ? " — not run"
                                : tallyStatus.issues > 0 ? ` — ${tallyStatus.issues} unresolved`
                                : " — complete"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <Button size="lg" className="gap-2" disabled={!canFile} onClick={() => setConfirmOpen(true)}>
                      <ShieldCheck size={16} /> Mark Return as Ready to File
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
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
              This will mark the return as <strong>Filed</strong> and enable the Genius XLS Export in Reports. Proceed?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleFinalise} disabled={finalising}>
              {finalising ? "Finalising…" : "Confirm & Mark Filed"}
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
