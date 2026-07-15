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
import { cn } from "@/lib/utils";
import {
  ShieldCheck, CheckCircle2, Upload, FileSpreadsheet, Loader2, RotateCcw, X, Play,
} from "lucide-react";
import { readSheetGrids, readDelimitedGrid } from "@/lib/tdsWorkbook";
import { logReconAudit } from "@/lib/tdsReconAudit";
import {
  comparePanVerification, extractTracesRows, panDiagnostics, isPanException, normalizePan,
  panReason, panRecommendedAction,
  PAN_OVERRIDE_REASONS, type OfficeParty, type TracesPanRow, type PanValidationResult,
} from "@/lib/tdsPanVerification";

/**
 * Stage 2 · PAN Verification — EMBEDDED inside Validate & Finalise, mirroring the
 * Stage 1 experience but with its OWN "Run Validation" action: PAN verification
 * runs (and its summary appears) only when the user clicks Stage 2's button, so it
 * is independent of Stage 1. Live animated dashboard cards double as clickable
 * filters, and the results show ONLY exceptions (verified parties are summarised,
 * not listed) with a clear reason + recommended action, an override with a
 * mandatory reason, and a success panel when everything is verified.
 *
 * SCOPE: this file + src/lib/tdsPanVerification.ts only — it does not touch Stage
 * 1 or any edge function.
 */
interface Props {
  filing: any;
  selClient: string;
  selFy: string;
  selQuarter: string;
  selForm: string;
  runSignal: number; // legacy: still passed by the parent; Stage 2 no longer auto-runs on it
  resolveFirmId: () => Promise<string | null>;
  disabled?: boolean;
}

interface PanResult {
  id: string;
  quarter: string | null;
  party_name: string | null;
  pan: string | null;
  pan_status: string | null;
  validation_result: PanValidationResult;
  overridden: boolean;
  override_reason: string | null;
  overridden_by: string | null;
  overridden_at: string | null;
  office_deductee_id: string | null;
}

type PanFilter = null | "total" | "matched" | "mismatch" | "pending" | "overridden";

const RESULT_BADGE: Record<string, string> = {
  "PAN Verified": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Name Mismatch": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Party Missing in PAN Verification File": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Party Missing in Office Data": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "PAN Status Error": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "PAN Status Blank": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "PAN Inactive": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "PAN Invalid": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

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
    const safety = setTimeout(finish, 700); // land even if rAF is throttled (background tab)
    return () => { cancelAnimationFrame(raf); clearTimeout(safety); };
  }, [value]);
  return <>{display}</>;
}

/** Parse a TRACES Bulk-PAN file (Excel OR delimited .csv/.txt) into PAN rows.
 *  Excel is read via the shared Stage-1 reader (readSheetGrids → TRUE used range,
 *  so a bloated-!ref file can never freeze the tab); delimited text via
 *  readDelimitedGrid. Both feed the same pure, tested extractTracesRows()
 *  (value-based PAN + status detection). */
async function parseTracesFile(file: File): Promise<Omit<TracesPanRow, "row_id">[]> {
  const name = file.name.toLowerCase();
  const grids = (name.endsWith(".csv") || name.endsWith(".txt"))
    ? readDelimitedGrid(await file.text())
    : readSheetGrids(await file.arrayBuffer());
  return extractTracesRows(grids);
}

export function TdsPanVerification({ filing, selClient, selFy, selQuarter, selForm, resolveFirmId, disabled }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [officeCount, setOfficeCount] = useState(0);
  const [batch, setBatch] = useState<any>(null);
  const [results, setResults] = useState<PanResult[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});

  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [activeFilter, setActiveFilter] = useState<PanFilter>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [ovOpen, setOvOpen] = useState(false);
  const [ovTarget, setOvTarget] = useState<PanResult | null>(null);
  const [ovReason, setOvReason] = useState<string>("");
  const [ovOther, setOvOther] = useState("");
  const [savingOv, setSavingOv] = useState(false);

  const filingId = filing?.id ?? null;

  const loadAll = useCallback(async () => {
    setDiagnostics([]); // recomputed on the next Run Validation for the current data
    if (!filingId) { setBatch(null); setResults(null); setOfficeCount(0); return; }
    const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", filingId);
    const chIds = (ch || []).map((c: any) => c.id);
    let dedCount = 0;
    if (chIds.length) {
      const { count } = await supabase.from("tds_deductees").select("id", { count: "exact", head: true }).in("challan_id", chIds);
      dedCount = count || 0;
    }
    setOfficeCount(dedCount);

    const { data: b } = await supabase.from("tds_pan_verification_batches").select("*")
      .eq("filing_id", filingId).order("imported_at", { ascending: false }).limit(1).maybeSingle();
    setBatch(b || null);

    const { data: res } = await supabase.from("tds_pan_verification_results").select("*").eq("filing_id", filingId);
    setResults(res && res.length ? (res as PanResult[]) : null);

    const { data: us } = await supabase.from("users").select("id, name").limit(5000);
    setUserMap(Object.fromEntries((us || []).map((u: any) => [u.id, u.name])));
  }, [filingId]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { setActiveFilter(null); }, [filingId]);

  const handleImport = async (file: File) => {
    if (!filing) return;
    setImporting(true);
    try {
      const rows = await parseTracesFile(file);
      if (rows.length === 0) throw new Error("No PAN rows found. Expected a TRACES Bulk PAN file (Excel/CSV) with a PAN column.");
      const firmId = await resolveFirmId();

      const { data: batchRow, error: bErr } = await supabase.from("tds_pan_verification_batches").insert({
        filing_id: filing.id, client_id: selClient, firm_id: firmId,
        financial_year: selFy, quarter: selQuarter, form_type: selForm,
        file_name: file.name, row_count: rows.length, status: "imported", imported_by: user?.id,
      }).select("id").single();
      if (bErr || !batchRow) throw new Error(bErr?.message || "Batch insert failed");

      const rowRecords = rows.map((r, i) => ({
        batch_id: batchRow.id, filing_id: filing.id, firm_id: firmId, row_index: i,
        pan: r.pan, name: r.name, verified_name: r.verified_name, pan_status: r.pan_status, raw: r,
      }));
      const { error: rErr } = await supabase.from("tds_pan_verification_rows").insert(rowRecords);
      if (rErr) throw new Error(rErr.message);

      await supabase.from("tds_pan_verification_results").delete().eq("filing_id", filing.id);
      setResults(null);
      toast({ title: `Imported ${rows.length} PAN record(s)`, description: file.name });
      await loadAll();
    } catch (e: any) {
      toast({ title: "PAN file import failed", description: e.message, variant: "destructive" });
    }
    setImporting(false);
  };

  const runValidation = useCallback(async () => {
    if (!filing || !batch) return;
    setValidating(true);
    try {
      const firmId = await resolveFirmId();
      const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", filing.id);
      const chIds = (ch || []).map((c: any) => c.id);
      let office: OfficeParty[] = [];
      if (chIds.length) {
        const { data: ded } = await supabase.from("tds_deductees")
          .select("id, deductee_pan, deductee_name").in("challan_id", chIds);
        office = (ded || []).map((d: any) => ({ deductee_id: d.id, pan: d.deductee_pan, name: d.deductee_name }));
      }
      const { data: tr } = await supabase.from("tds_pan_verification_rows").select("id, pan, name, verified_name, pan_status").eq("batch_id", batch.id);
      const traces: TracesPanRow[] = (tr || []).map((t: any) => ({ row_id: t.id, pan: t.pan, name: t.name, verified_name: t.verified_name, pan_status: t.pan_status }));

      const compared = comparePanVerification(office, traces);
      setDiagnostics(panDiagnostics(office, traces));

      // Preserve overrides across re-runs, keyed by PAN (stable one-per-PAN).
      const { data: prior } = await supabase.from("tds_pan_verification_results")
        .select("id, office_deductee_id, pan, overridden, override_reason, overridden_by, overridden_at").eq("filing_id", filing.id);
      const keyOf = (deducteeId: string | null, pan: string | null) => normalizePan(pan) || `d:${deducteeId ?? ""}`;
      const priorMap = new Map<string, any>();
      for (const p of prior || []) priorMap.set(keyOf(p.office_deductee_id, p.pan), p);
      const priorIds = (prior || []).map((p: any) => p.id);

      const newRows = compared.map(r => {
        const carry = priorMap.get(keyOf(r.office_deductee_id, r.pan));
        const keep = !!carry?.overridden;
        return {
          filing_id: filing.id, batch_id: batch.id, firm_id: firmId, quarter: selQuarter,
          office_deductee_id: r.office_deductee_id, pan_row_id: r.pan_row_id,
          party_name: r.party_name, pan: r.pan, pan_status: r.pan_status,
          validation_result: r.validation_result,
          overridden: keep,
          override_reason: keep ? carry.override_reason : null,
          overridden_by: keep ? carry.overridden_by : null,
          overridden_at: keep ? carry.overridden_at : null,
        };
      });

      const { error: insErr } = await supabase.from("tds_pan_verification_results").insert(newRows);
      if (insErr) throw new Error(insErr.message);
      if (priorIds.length) await supabase.from("tds_pan_verification_results").delete().in("id", priorIds);

      const { data: res } = await supabase.from("tds_pan_verification_results").select("*").eq("filing_id", filing.id);
      setResults((res as PanResult[]) || []);
      const verified = compared.filter(r => r.validation_result === "PAN Verified").length;
      toast({ title: "Stage 2 · PAN verification complete", description: `${verified} verified · ${compared.length - verified} exception(s)` });
    } catch (e: any) {
      toast({ title: "PAN verification failed", description: e.message, variant: "destructive" });
    }
    setValidating(false);
  }, [filing, batch, resolveFirmId, selQuarter, toast]);

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
      setResults(prev => prev ? prev.map(x => x.id === ovTarget.id ? { ...x, overridden: true, override_reason: reason, overridden_by: user?.id ?? null, overridden_at: new Date().toISOString() } : x) : prev);
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
    setResults(prev => prev ? prev.map(x => x.id === r.id ? { ...x, overridden: false, override_reason: null, overridden_by: null, overridden_at: null } : x) : prev);
  };

  const summary = useMemo(() => {
    const rs = results || [];
    const exceptions = rs.filter(r => isPanException(r.validation_result));
    return {
      total: rs.length,
      matched: rs.filter(r => !isPanException(r.validation_result)).length,
      mismatch: exceptions.length,
      overridden: rs.filter(r => r.overridden).length,
      pending: exceptions.filter(r => !r.overridden).length,
    };
  }, [results]);

  // Exceptions only (default view), pending first then overridden.
  const exceptions = useMemo(() => {
    const rs = (results || []).filter(r => isPanException(r.validation_result));
    return rs.sort((a, b) => (a.overridden ? 1 : 0) - (b.overridden ? 1 : 0));
  }, [results]);

  const cardFiltered = useMemo((): PanResult[] | null => {
    const rs = results || [];
    switch (activeFilter) {
      case "total": return rs;
      case "matched": return rs.filter(r => !isPanException(r.validation_result));
      case "mismatch": return rs.filter(r => isPanException(r.validation_result));
      case "pending": return rs.filter(r => isPanException(r.validation_result) && !r.overridden);
      case "overridden": return rs.filter(r => r.overridden);
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

  // One exception → a card with the result, reason and recommended action.
  const renderExceptionCard = (r: PanResult) => (
    <Card key={r.id} className={cn(r.overridden ? "border-blue-200 dark:border-blue-900 opacity-80" : "border-destructive/30")}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{r.party_name || "—"}</p>
            <p className="text-xs font-mono text-muted-foreground">{r.pan || "—"}{r.pan_status ? ` · ${r.pan_status}` : ""}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={cn("text-[10px]", RESULT_BADGE[r.validation_result] || "bg-muted")}>{r.validation_result}</Badge>
            {overrideBtn(r)}
          </div>
        </div>
        <p className={cn("text-xs", r.overridden ? "text-blue-600" : "text-destructive")}>
          {r.overridden ? `Overridden — ${r.override_reason || "accepted"}${r.overridden_by && userMap[r.overridden_by] ? ` · ${userMap[r.overridden_by]}` : ""}` : panReason(r.validation_result)}
        </p>
        {!r.overridden && panRecommendedAction(r.validation_result) && (
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Recommended: </span>{panRecommendedAction(r.validation_result)}</p>
        )}
      </CardContent>
    </Card>
  );

  // Verified parties (only when the user filters to Matched/Total) → compact table.
  const renderVerifiedTable = (rows: PanResult[]) => (
    <Card><CardContent className="p-0 overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Party Name</TableHead>
          <TableHead className="w-[130px]">PAN</TableHead>
          <TableHead className="w-[150px]">PAN Status</TableHead>
          <TableHead className="w-[110px] text-right">Result</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id}>
              <TableCell className="text-xs font-medium">{r.party_name || "—"}</TableCell>
              <TableCell className="text-xs font-mono">{r.pan || "—"}</TableCell>
              <TableCell className="text-xs">{r.pan_status || "—"}</TableCell>
              <TableCell className="text-right"><span className="inline-flex items-center gap-1 text-emerald-600 text-xs"><CheckCircle2 size={11} /> {isPanException(r.validation_result) ? r.validation_result : "Verified"}</span></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );

  if (!filing) return null;

  return (
    <div className="space-y-4">
      {/* TRACES file */}
      <Card><CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="font-semibold text-sm flex items-center gap-2">
            <FileSpreadsheet size={15} /> TRACES Bulk PAN File
            <span className="text-muted-foreground font-normal">· {officeCount} office parties this quarter</span>
            {validating && <span className="text-xs text-amber-600 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> verifying…</span>}
          </p>
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.csv,.txt" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.currentTarget.value = ""; }} />
          <Button size="sm" variant={batch ? "outline" : "default"} className="gap-1" disabled={importing || disabled}
            onClick={() => fileInputRef.current?.click()}>
            {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {batch ? "Re-import" : "Import TRACES file"}
          </Button>
        </div>
        {batch ? (
          <p className="text-sm"><span className="font-bold">{batch.row_count}</span> <span className="text-muted-foreground">PANs</span> <span className="text-xs text-muted-foreground">· {batch.file_name}</span></p>
        ) : <p className="text-xs text-muted-foreground">Import the TRACES Bulk PAN Verification file (.xls / .xlsx / .csv), then click <b>Run Validation</b> below. Stage 2 is optional.</p>}
      </CardContent></Card>

      {/* Stage 2 has its OWN Run Validation — PAN verification runs (and its summary
          appears) only when the user clicks this, independently of Stage 1. */}
      <div className="flex items-center gap-3">
        <Button size="lg" className="gap-2 font-semibold" onClick={() => runValidation()}
          disabled={validating || !batch || disabled}>
          {validating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {validating ? "Validating…" : "Run Validation"}
        </Button>
        {!batch && <span className="text-xs text-muted-foreground">Import the TRACES file to enable PAN verification.</span>}
      </div>

      {results && (
        <>
          {/* Diagnostics — plain-language reasons for a low/zero verified count. */}
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

          {/* Live, clickable dashboard cards */}
          <div className={cn("grid grid-cols-3 sm:grid-cols-5 gap-3", validating && "animate-pulse")}>
            {([
              { key: "total" as const, label: "Total PAN Records", value: summary.total, cls: "" },
              { key: "matched" as const, label: "Matched", value: summary.matched, cls: "text-emerald-600" },
              { key: "mismatch" as const, label: "PAN Mismatch", value: summary.mismatch, cls: summary.mismatch > 0 ? "text-destructive" : "" },
              { key: "pending" as const, label: "Pending", value: summary.pending, cls: summary.pending > 0 ? "text-amber-600" : "text-emerald-600" },
              { key: "overridden" as const, label: "Overridden", value: summary.overridden, cls: "text-blue-600" },
            ]).map(s => (
              <button key={s.label} type="button"
                onClick={() => setActiveFilter(activeFilter === s.key ? null : s.key)}
                aria-pressed={activeFilter === s.key}
                className={cn(
                  "rounded-lg border bg-card p-3 text-center transition-all hover:border-primary/50 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  activeFilter === s.key ? "ring-2 ring-primary border-primary" : "border-border",
                )}>
                <p className={cn("text-2xl font-bold tabular-nums", s.cls)}><AnimatedNumber value={s.value} /></p>
                <p className="text-[11px] text-muted-foreground leading-tight">{s.label}</p>
              </button>
            ))}
          </div>

          {cardFiltered !== null ? (
            /* A card is active → show only that category. */
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-muted-foreground">Showing <b className="text-foreground">{cardFiltered.length}</b> record{cardFiltered.length === 1 ? "" : "s"}</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setActiveFilter(null)}><X size={11} /> Clear filter</Button>
              </div>
              {cardFiltered.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed">No records found.</div>
              ) : (
                <div className="space-y-3">
                  {cardFiltered.filter(r => isPanException(r.validation_result)).map(renderExceptionCard)}
                  {cardFiltered.some(r => !isPanException(r.validation_result)) && renderVerifiedTable(cardFiltered.filter(r => !isPanException(r.validation_result)))}
                </div>
              )}
            </div>
          ) : exceptions.length === 0 ? (
            /* Default view, nothing to action → success panel. */
            <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={22} className="text-emerald-600" />
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">PAN Verification Completed Successfully</p>
                </div>
                <div className="text-sm text-foreground grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 max-w-xl">
                  <span className="text-muted-foreground">Total PAN Records</span><span className="font-semibold">{summary.total}</span>
                  <span className="text-muted-foreground">Matched</span><span className="font-semibold text-emerald-600">{summary.matched}</span>
                  <span className="text-muted-foreground">PAN Mismatch</span><span className="font-semibold">{summary.mismatch}</span>
                  <span className="text-muted-foreground">Overridden</span><span className="font-semibold">{summary.overridden}</span>
                </div>
                <p className="text-sm text-muted-foreground">All PAN records have been verified successfully. No discrepancies were found.</p>
              </CardContent>
            </Card>
          ) : (
            /* Default view → exceptions only. */
            <div className="space-y-3">{exceptions.map(renderExceptionCard)}</div>
          )}
        </>
      )}

      {/* Override dialog — mandatory reason */}
      <Dialog open={ovOpen} onOpenChange={setOvOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Override — {ovTarget?.validation_result}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{ovTarget?.party_name} · {ovTarget?.pan}</p>
            <div className="space-y-1">
              <Label className="text-xs">Override reason <span className="text-destructive">*</span></Label>
              <Select value={ovReason} onValueChange={setOvReason}>
                <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>{PAN_OVERRIDE_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {ovReason === "Other" && (
              <div className="space-y-1">
                <Label className="text-xs">Please specify <span className="text-destructive">*</span></Label>
                <Textarea value={ovOther} onChange={e => setOvOther(e.target.value)} rows={2} placeholder="Enter the override reason" />
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
    </div>
  );
}
