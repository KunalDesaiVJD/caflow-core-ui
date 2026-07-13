import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getDefaultTdsQuarter, isQuarterInTdsRange, clientHasTdsForm } from "@/lib/tdsQuarter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  RotateCcw, Loader2, Users, FileWarning, Info, Check, X,
} from "lucide-react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { gridToRows } from "@/lib/tdsImportParsing";

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

/** All 7 compared fields, in the fixed column order used by the flat results table. */
const DIFF_FIELDS = ["name", "pan", "date", "amount", "tds", "interest", "section"] as const;

/**
 * One compact cell for a single field's Office-vs-Imported comparison — no
 * expand/collapse; every row shows every field's values directly, so the
 * whole table is scannable at a glance for 100+ entries without clicking
 * into each one. A ✓/✗ marks each field individually (not just the row's
 * overall status) so it's clear at a glance WHICH field(s) actually caused a
 * row to be flagged, e.g. "PAN/Date/Amount all matched, only Section
 * differs" instead of a single opaque "Mismatched" badge. Hover a mismatched
 * field for the AI's short note on why (when it provided one).
 */
function DiffCell({ diffs, field }: { diffs: FieldDiff[]; field: string }) {
  const d = diffs.find(x => x.field === field);
  if (!d) return <span className="text-muted-foreground text-xs">—</span>;
  if (d.matched !== false) {
    return (
      <span className="text-xs inline-flex items-center gap-1">
        <Check size={11} className="text-emerald-600 shrink-0" />
        {fmtVal(d.office ?? d.imported)}
      </span>
    );
  }
  return (
    <div className="text-xs leading-tight inline-flex items-start gap-1" title={d.difference || undefined}>
      <X size={11} className="text-destructive shrink-0 mt-0.5" />
      <div>
        <div className="text-foreground">{fmtVal(d.office)}</div>
        <div className="text-destructive">{fmtVal(d.imported)}</div>
      </div>
    </div>
  );
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

  const [importing, setImporting] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    if (!selClient || complianceError()) {
      setFiling(null); setBatch(null); setResults(null);
      setOfficeCount({ deductees: 0, challans: 0 });
      return;
    }
    setResolving(true);
    const { data: fData } = await supabase.from("tds_filings").select("*")
      .eq("client_id", selClient).eq("financial_year", selFy).eq("quarter", selQuarter).limit(10);
    const match = (fData || []).find((f: any) => (f.tds_forms || []).includes(selForm)) || null;
    setFiling(match);
    if (!match) {
      setBatch(null); setResults(null); setOfficeCount({ deductees: 0, challans: 0 });
      setResolving(false); return;
    }

    // Office Data counts
    const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", match.id);
    const chIds = (ch || []).map((c: any) => c.id);
    let dedCount = 0;
    if (chIds.length) {
      const { count } = await supabase.from("tds_deductees").select("id", { count: "exact", head: true }).in("challan_id", chIds);
      dedCount = count || 0;
    }
    setOfficeCount({ deductees: dedCount, challans: chIds.length });

    // Latest import batch
    const { data: b } = await supabase.from("tds_import_batches").select("*")
      .eq("filing_id", match.id).order("imported_at", { ascending: false }).limit(1).maybeSingle();
    setBatch(b || null);

    // Existing comparison results
    const { data: res } = await supabase.from("tds_recon_results").select("*").eq("filing_id", match.id);
    setResults(res && res.length ? (res as ReconResult[]) : null);
    setResolving(false);
  }, [selClient, selFy, selQuarter, selForm, complianceError]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── File → { file_type, rows | pdf_base64 } ──────────────────────────────────
  const readFile = (file: File): Promise<{ file_type: string; rows?: any[]; pdf_base64?: string }> =>
    new Promise((resolve, reject) => {
      const name = file.name.toLowerCase();
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the file"));
      if (name.endsWith(".pdf")) {
        reader.onload = () => resolve({ file_type: "pdf", pdf_base64: String(reader.result).split(",")[1] || "" });
        reader.readAsDataURL(file);
      } else if (name.endsWith(".csv")) {
        reader.onload = () => {
          // header:false → raw grid, so gridToRows can find the REAL header
          // row itself rather than assuming row 1 (see detectHeaderRow above).
          const parsed = Papa.parse(String(reader.result), { header: false, skipEmptyLines: true });
          resolve({ file_type: "csv", rows: gridToRows((parsed.data as unknown[][]) || []) });
        };
        reader.readAsText(file);
      } else {
        reader.onload = () => {
          // cellDates + raw:false emit date cells as their printed text (e.g.
          // "01/04/2025") rather than Excel serial numbers (45748) — otherwise
          // every dated row would falsely mismatch during comparison.
          // header:1 → raw grid (not row-1-is-header), so gridToRows can find
          // the real header row (client files often prepend a title/TAN-PAN
          // block before the actual columns).
          const wb = XLSX.read(reader.result, { type: "array", cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false }) as unknown[][];
          resolve({ file_type: "xlsx", rows: gridToRows(grid) });
        };
        reader.readAsArrayBuffer(file);
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

  const handleCompare = async () => {
    if (!filing || !batch) return;
    setComparing(true);
    try {
      const data = await invokeFn("tds-recon-compare", { filing_id: filing.id, batch_id: batch.id });
      const { data: res } = await supabase.from("tds_recon_results").select("*").eq("filing_id", filing.id);
      setResults((res as ReconResult[]) || []);
      const s = data.summary || {};
      toast({ title: "Comparison complete", description: `${s.matched ?? 0} matched · ${s.pending ?? 0} pending` });
    } catch (e: any) {
      toast({ title: "Comparison failed", description: e.message, variant: "destructive" });
    }
    setComparing(false);
  };

  const handleOverride = async (r: ReconResult, on: boolean) => {
    const { error } = await supabase.from("tds_recon_results").update({
      overridden: on,
      overridden_by: on ? user?.id : null,
      overridden_at: on ? new Date().toISOString() : null,
    }).eq("id", r.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setResults(prev => prev ? prev.map(x => x.id === r.id ? { ...x, overridden: on } : x) : prev);
  };

  const handleFinalise = async () => {
    if (!filing) return;
    setFinalising(true);
    const { error } = await supabase.from("tds_filings").update({
      work_status: "Filed", last_updated_by: user?.id, last_updated_at: new Date().toISOString(),
    }).eq("id", filing.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Return marked as Filed" }); setFiling({ ...filing, work_status: "Filed" }); }
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

  const statusBadge = (r: ReconResult) => {
    if (r.match_status === "matched") return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 gap-1"><CheckCircle2 size={11} /> Matched</Badge>;
    if (r.match_status === "office_only") return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Only in Office</Badge>;
    if (r.match_status === "imported_only") return <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">Only in Imported</Badge>;
    return <Badge className="bg-destructive/10 text-destructive gap-1"><AlertTriangle size={11} /> Mismatched</Badge>;
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">Validate &amp; Finalise</h2>
        <p className="text-sm text-muted-foreground">Compare Office Data against the client's imported file, then finalise for filing</p>
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
          {/* Two datasets */}
          <div className="grid gap-3 md:grid-cols-2">
            {/* Dataset 1 — Office */}
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

            {/* Dataset 2 — Imported */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet size={16} className="text-foreground" />
                    <p className="font-semibold text-sm">Imported Client Data</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.pdf"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.currentTarget.value = ""; }}
                  />
                  <Button size="sm" variant={batch ? "outline" : "default"} className="gap-1"
                    disabled={importing || isFiled}
                    onClick={() => fileInputRef.current?.click()}>
                    {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {batch ? "Re-import" : "Import"}
                  </Button>
                </div>
                {batch ? (
                  <div className="text-sm">
                    <span className="text-2xl font-bold">{batch.row_count}</span> <span className="text-muted-foreground">records</span>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {batch.file_name} · {(batch.file_type || "").toUpperCase()}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Import the client's Excel, CSV or PDF file to compare against Office Data.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Run comparison */}
          <div className="flex items-center gap-3">
            <Button size="lg" className="gap-2 font-semibold" onClick={handleCompare}
              disabled={comparing || !batch || isFiled}>
              {comparing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {comparing ? "Comparing…" : "Run Validation"}
            </Button>
            {!batch && <span className="text-xs text-muted-foreground">Import a client file to enable comparison.</span>}
          </div>

          {/* Results */}
          {results && (
            <>
              {/* Override summary */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: "Total", value: summary.total, cls: "" },
                  { label: "Matched", value: summary.matched, cls: "text-emerald-600" },
                  { label: "Mismatched", value: summary.mismatched, cls: "text-destructive" },
                  { label: "Overridden", value: summary.overridden, cls: "text-blue-600" },
                  { label: "Pending", value: summary.pending, cls: summary.pending > 0 ? "text-amber-600" : "text-emerald-600" },
                ].map(s => (
                  <Card key={s.label}><CardContent className="p-3 text-center">
                    <p className={cn("text-2xl font-bold", s.cls)}>{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </CardContent></Card>
                ))}
              </div>

              {/* Flat, entry-wise table — every one of the (up to 100+) compared
                  records is its own row with every field visible directly, no
                  expand/collapse. Each field carries its own ✓/✗ so it's
                  clear exactly which field(s) caused a row to be flagged —
                  not just an opaque row-level "Mismatched". Where Office and
                  Imported disagree, both values are shown stacked (black =
                  Office, red = Imported) right in the cell. */}
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1 flex-wrap">
                <Check size={11} className="text-emerald-600" /> Field matched (Office &amp; Imported agree)
                <X size={11} className="text-destructive ml-3" /> Field differs — <span className="text-foreground">Office</span> / <span className="text-destructive">Imported</span> shown stacked, hover for why
              </div>
              <Card><CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[160px] sticky left-0 bg-background z-10">Record</TableHead>
                      {DIFF_FIELDS.map(f => <TableHead key={f} className="min-w-[110px]">{FIELD_LABELS[f]}</TableHead>)}
                      <TableHead className="w-[140px]">Status</TableHead>
                      <TableHead className="w-[120px] text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.length === 0 ? (
                      <TableRow><TableCell colSpan={DIFF_FIELDS.length + 3} className="text-center text-muted-foreground py-8">No records compared</TableCell></TableRow>
                    ) : [...results].sort((a, b) => {
                      // Pending mismatches first, then overridden, then matched.
                      const rank = (r: ReconResult) => r.match_status === "matched" ? 2 : r.overridden ? 1 : 0;
                      return rank(a) - rank(b);
                    }).map(r => {
                      const diffs = r.field_diffs || [];
                      const isMismatch = r.match_status !== "matched";
                      return (
                        <TableRow key={r.id} className={cn(r.overridden && "opacity-70")}>
                          <TableCell className="font-medium text-sm sticky left-0 bg-background">
                            {r.record_label || "—"}
                            {r.overridden && <Badge variant="outline" className="ml-2 text-[10px] text-blue-600 border-blue-300">Overridden</Badge>}
                          </TableCell>
                          {DIFF_FIELDS.map(f => (
                            <TableCell key={f}><DiffCell diffs={diffs} field={f} /></TableCell>
                          ))}
                          <TableCell>{statusBadge(r)}</TableCell>
                          <TableCell className="text-right">
                            {isMismatch && !isFiled && (
                              r.overridden ? (
                                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => handleOverride(r, false)}>
                                  <RotateCcw size={12} /> Undo
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => handleOverride(r, true)}>
                                  <ShieldCheck size={12} /> Override
                                </Button>
                              )
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent></Card>

              {/* Finalise */}
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
                        {canFile
                          ? <CheckCircle2 size={24} className="text-emerald-600" />
                          : <AlertTriangle size={24} className="text-amber-600" />}
                        <div>
                          <p className="font-semibold text-foreground">
                            {canFile ? "All records reconciled — ready to file" : `${summary.pending} record(s) still pending`}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {canFile
                              ? "Every record is matched or overridden."
                              : "Match or override every mismatch (Pending must reach 0) to enable filing."}
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
            </>
          )}
        </>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Finalisation</DialogTitle>
          </DialogHeader>
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
