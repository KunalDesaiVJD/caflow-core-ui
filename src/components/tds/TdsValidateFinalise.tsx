import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getDefaultTdsQuarter, isQuarterInTdsRange, clientHasTdsForm } from "@/lib/tdsQuarter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, AlertTriangle, CheckCircle2, Upload, Play, FileSpreadsheet,
  RotateCcw, Loader2, Users, FileWarning, Info, X, BadgeCheck,
} from "lucide-react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { gridToRows } from "@/lib/tdsImportParsing";
import { logReconAudit } from "@/lib/tdsReconAudit";
import { TdsPanVerification } from "./TdsPanVerification";

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

const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];

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

/** Invoke an edge function and surface the function's own JSON error message. */
async function invokeFn(name: string, body: unknown): Promise<any> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as any).context;
      const j = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      if (j?.error) msg = j.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** A number that smoothly counts up/down to its target (dashboard-style). */
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current, to = value;
    if (from === to) { setDisplay(to); return; }
    let raf = 0; let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / 500);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else { setDisplay(to); prev.current = to; }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display}</>;
}

type FilterKey = null | "total" | "matched" | "mismatched" | "overridden" | "pending";

export function TdsValidateFinalise({ clients, isSuperadmin, resolveFirmId, onNavigateDataEntry }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [selClient, setSelClient] = useState("");
  const smartDefault = useMemo(() => getDefaultTdsQuarter(), []);
  const [selFy, setSelFy] = useState(smartDefault.fy);
  const [selQuarter, setSelQuarter] = useState(smartDefault.quarter);
  const [selForm, setSelForm] = useState("26Q");

  const [resolving, setResolving] = useState(false);
  const [filing, setFiling] = useState<any>(null);
  const [officeCount, setOfficeCount] = useState({ deductees: 0, challans: 0 });
  const [batch, setBatch] = useState<any>(null);
  const [results, setResults] = useState<ReconResult[] | null>(null);
  const [userMap, setUserMap] = useState<Record<string, string>>({});

  const [importing, setImporting] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runSignal, setRunSignal] = useState(0);
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
      setFiling(null); setBatch(null); setResults(null);
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
      setBatch(null); setResults(null); setOfficeCount({ deductees: 0, challans: 0 });
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

    const { data: b } = await supabase.from("tds_import_batches").select("*")
      .eq("filing_id", match.id).order("imported_at", { ascending: false }).limit(1).maybeSingle();
    if (stale()) return;
    setBatch(b || null);

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
  const readFile = (file: File): Promise<{ file_type: string; rows?: any[]; pdf_base64?: string; image_base64?: string; image_media_type?: string; raw_text?: string }> =>
    new Promise((resolve, reject) => {
      const name = file.name.toLowerCase();
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the file"));
      const b64 = () => String(reader.result).split(",")[1] || "";

      if (ext === "pdf") {
        reader.onload = () => resolve({ file_type: "pdf", pdf_base64: b64() });
        reader.readAsDataURL(file);
      } else if (IMAGE_MIME[ext] || file.type.startsWith("image/")) {
        reader.onload = () => resolve({ file_type: "image", image_base64: b64(), image_media_type: file.type || IMAGE_MIME[ext] || "image/png" });
        reader.readAsDataURL(file);
      } else if (ext === "csv") {
        reader.onload = () => {
          const parsed = Papa.parse(String(reader.result), { header: false, skipEmptyLines: true });
          resolve({ file_type: "csv", rows: gridToRows((parsed.data as unknown[][]) || []) });
        };
        reader.readAsText(file);
      } else if (ext === "xlsx" || ext === "xls" || (!ext && file.type.includes("sheet"))) {
        reader.onload = () => {
          const wb = XLSX.read(reader.result, { type: "array", cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false }) as unknown[][];
          resolve({ file_type: "xlsx", rows: gridToRows(grid) });
        };
        reader.readAsArrayBuffer(file);
      } else if (ext === "json") {
        reader.onload = () => {
          const text = String(reader.result);
          try {
            const j = JSON.parse(text);
            const arr = Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : Array.isArray(j?.data) ? j.data : null;
            if (arr && arr.length && arr.every((x: any) => x && typeof x === "object")) { resolve({ file_type: "json", rows: arr }); return; }
          } catch { /* not a clean array-of-objects → hand the raw text to the model */ }
          resolve({ file_type: "json", raw_text: text });
        };
        reader.readAsText(file);
      } else {
        // txt, xml, html, or anything else textual → the model reads the meaning.
        reader.onload = () => resolve({ file_type: ext || "txt", raw_text: String(reader.result) });
        reader.readAsText(file);
      }
    });

  const handleImport = async (file: File) => {
    if (!filing) return;
    setImporting(true);
    try {
      const parsed = await readFile(file);
      const data = await invokeFn("tds-recon-import", {
        filing_id: filing.id, form_type: selForm, file_name: file.name, ...parsed,
      });
      // A fresh import invalidates any prior comparison for this filing.
      await supabase.from("tds_recon_results").delete().eq("filing_id", filing.id);
      setResults(null);
      toast({ title: `Imported ${data.row_count} client record(s)`, description: file.name });
      await loadAll();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
    setImporting(false);
  };

  // Single "Run Validation" — runs Stage 1 (data reconciliation) here, then bumps
  // runSignal so the embedded Stage 2 (PAN verification) runs too if a TRACES
  // file was imported. The two result sets are shown separately, never merged.
  const handleRunValidation = async () => {
    if (!filing || !batch) return;
    setComparing(true);
    try {
      const data = await invokeFn("tds-recon-compare", { filing_id: filing.id, batch_id: batch.id });
      const { data: res } = await supabase.from("tds_recon_results").select("*").eq("filing_id", filing.id);
      setResults((res as ReconResult[]) || []);
      const s = data.summary || {};
      toast({ title: "Stage 1 · Data validation complete", description: `${s.matched ?? 0} matched · ${s.mismatched ?? 0} mismatched` });
    } catch (e: any) {
      toast({ title: "Validation failed", description: e.message, variant: "destructive" });
    }
    setComparing(false);
    setRunSignal(s => s + 1); // trigger Stage 2 (PAN verification) if a TRACES file is present
  };

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

  const summary = useMemo(() => {
    const rs = results || [];
    return {
      total: rs.length,
      matched: rs.filter(r => r.match_status === "matched").length,
      mismatched: rs.filter(r => r.match_status !== "matched").length,
      overridden: rs.filter(r => r.overridden).length,
      pending: rs.filter(r => r.match_status !== "matched" && !r.overridden).length,
    };
  }, [results]);

  const canFile = (results?.length ?? 0) > 0 && summary.pending === 0;
  const isFiled = filing?.work_status === "Filed";
  const cErr = selClient ? complianceError() : null;

  // Non-matched records (mismatched / office_only / imported_only) — each gets its
  // own inline comparison table; pending first, then overridden.
  const attention = useMemo(() => {
    const rs = (results || []).filter(r => r.match_status !== "matched");
    return rs.sort((a, b) => (a.overridden ? 1 : 0) - (b.overridden ? 1 : 0));
  }, [results]);

  // Reset the active card filter when the selection changes.
  useEffect(() => { setActiveFilter(null); }, [selClient, selFy, selQuarter, selForm]);

  // Records to show when a summary card is clicked (null = default exceptions view).
  const cardFiltered = useMemo((): ReconResult[] | null => {
    const rs = results || [];
    switch (activeFilter) {
      case "total": return rs;
      case "matched": return rs.filter(r => r.match_status === "matched");
      case "mismatched": return rs.filter(r => r.match_status !== "matched");
      case "overridden": return rs.filter(r => r.overridden);
      case "pending": return rs.filter(r => r.match_status !== "matched" && !r.overridden);
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
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">Validate &amp; Finalise</h2>
        <p className="text-sm text-muted-foreground">One <b>Run Validation</b> runs Stage&nbsp;1 (data reconciliation) and Stage&nbsp;2 (PAN verification), shown separately below.</p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={selClient} onValueChange={setSelClient}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>
              {clients
                .filter(c => clientHasTdsForm(c.tds_forms_applicable, selForm))
                .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">FY</Label>
          <Select value={selFy} onValueChange={setSelFy}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>{FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Quarter</Label>
          <Select value={selQuarter} onValueChange={setSelQuarter}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>{QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Form</Label>
          <Select value={selForm} onValueChange={setSelForm}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>{TDS_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

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
          {/* Inputs */}
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users size={16} className="text-foreground" />
                  <p className="font-semibold text-sm">Office Data <span className="text-muted-foreground font-normal">(entered by staff)</span></p>
                </div>
                <div className="flex gap-6 text-sm">
                  <div><span className="text-2xl font-bold">{officeCount.deductees}</span> <span className="text-muted-foreground">deductees</span></div>
                  <div><span className="text-2xl font-bold">{officeCount.challans}</span> <span className="text-muted-foreground">challans</span></div>
                </div>
                {officeCount.deductees === 0 && (
                  <p className="text-xs text-amber-600 mt-2">No office deductees yet — enter data in the Data Entry tab first.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet size={16} className="text-foreground" />
                    <p className="font-semibold text-sm">Imported Client Data <span className="text-muted-foreground font-normal">(Stage 1)</span></p>
                  </div>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.json,.xml,.txt,.html,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.currentTarget.value = ""; }} />
                  <Button size="sm" variant={batch ? "outline" : "default"} className="gap-1"
                    disabled={importing || isFiled} onClick={() => fileInputRef.current?.click()}>
                    {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {batch ? "Re-import" : "Import"}
                  </Button>
                </div>
                {batch ? (
                  <div className="text-sm">
                    <span className="text-2xl font-bold">{batch.row_count}</span> <span className="text-muted-foreground">records</span>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{batch.file_name} · {(batch.file_type || "").toUpperCase()}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Import the client's data in any format — Excel, CSV, PDF, image/scan, JSON, XML or text. It's normalised automatically.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Single Run Validation */}
          <div className="flex items-center gap-3">
            <Button size="lg" className="gap-2 font-semibold" onClick={handleRunValidation}
              disabled={comparing || !batch || isFiled}>
              {comparing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {comparing ? "Validating…" : "Run Validation"}
            </Button>
            {!batch && <span className="text-xs text-muted-foreground">Import a client file to enable validation.</span>}
          </div>

          {/* ── STAGE 1 · DATA VALIDATION ─────────────────────────────────────── */}
          {results && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 pt-1">
                <FileSpreadsheet size={16} className="text-primary" />
                <h3 className="text-base font-bold text-foreground">Stage 1 · Data Validation</h3>
                <span className="text-xs text-muted-foreground">Office ↔ Imported, field by field</span>
              </div>

              {/* Live, clickable dashboard cards — animated counters; click a card
                  to filter the results to that category, click again to clear. */}
              <div className={cn("grid grid-cols-3 sm:grid-cols-5 gap-3", comparing && "animate-pulse")}>
                {([
                  { key: "total" as const, label: "Total", value: summary.total, cls: "" },
                  { key: "matched" as const, label: "Matched", value: summary.matched, cls: "text-emerald-600" },
                  { key: "mismatched" as const, label: "Mismatched", value: summary.mismatched, cls: summary.mismatched > 0 ? "text-destructive" : "" },
                  { key: "overridden" as const, label: "Overridden", value: summary.overridden, cls: "text-blue-600" },
                  { key: "pending" as const, label: "Pending", value: summary.pending, cls: summary.pending > 0 ? "text-amber-600" : "text-emerald-600" },
                ]).map(s => (
                  <button key={s.label} type="button"
                    onClick={() => setActiveFilter(activeFilter === s.key ? null : s.key)}
                    aria-pressed={activeFilter === s.key}
                    className={cn(
                      "rounded-lg border bg-card p-3 text-center transition-all hover:border-primary/50 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      activeFilter === s.key ? "ring-2 ring-primary border-primary" : "border-border",
                    )}>
                    <p className={cn("text-2xl font-bold tabular-nums", s.cls)}><AnimatedNumber value={s.value} /></p>
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
                  <CardContent className="p-6 space-y-3">
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

          {/* ── STAGE 2 · PAN VERIFICATION (separate result set) ───────────────── */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <BadgeCheck size={16} className="text-primary" />
              <h3 className="text-base font-bold text-foreground">Stage 2 · PAN Verification</h3>
              <span className="text-xs text-muted-foreground">Party &amp; PAN existence, PAN status, name &amp; quarter</span>
            </div>
            <TdsPanVerification
              filing={filing}
              selClient={selClient}
              selFy={selFy}
              selQuarter={selQuarter}
              selForm={selForm}
              runSignal={runSignal}
              resolveFirmId={resolveFirmId}
              disabled={isFiled}
            />
          </div>

          {/* Finalise (gated on Stage 1 pending = 0) */}
          {results && (
            <Card className={cn(canFile ? "border-emerald-200 dark:border-emerald-800" : "border-amber-200 dark:border-amber-800")}>
              <CardContent className="p-6">
                {isFiled ? (
                  <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      ✓ Return marked as Filed. Generate Genius XLS Export from the Reports section.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 mb-4">
                      {canFile ? <CheckCircle2 size={24} className="text-emerald-600" /> : <AlertTriangle size={24} className="text-amber-600" />}
                      <div>
                        <p className="font-semibold text-foreground">
                          {canFile ? "Stage 1 reconciled — ready to file" : `${summary.pending} record(s) still pending in Stage 1`}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {canFile ? "Every Stage 1 record is matched or overridden." : "Override every mismatch (Pending must reach 0) to enable filing."}
                        </p>
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
                <p className="text-2xl font-bold text-foreground">{summary.matched}</p>
                <p className="text-xs text-muted-foreground">Matched</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted">
                <p className="text-2xl font-bold text-foreground">{summary.overridden}</p>
                <p className="text-xs text-muted-foreground">Overridden</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted">
                <p className="text-2xl font-bold text-foreground">{summary.total}</p>
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
    </div>
  );
}
