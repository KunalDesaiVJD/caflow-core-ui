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
  ShieldCheck, CheckCircle2, Upload, FileSpreadsheet, Loader2, AlertTriangle,
} from "lucide-react";
import * as XLSX from "xlsx";
import { logReconAudit } from "@/lib/tdsReconAudit";
import {
  comparePanVerification, isPanException, normalizePan,
  PAN_OVERRIDE_REASONS, type OfficeParty, type TracesPanRow, type PanValidationResult,
} from "@/lib/tdsPanVerification";

/**
 * Stage 2 · PAN Verification — EMBEDDED inside Validate & Finalise.
 *
 * The parent (TdsValidateFinalise) owns the client/FY/quarter/form selection and
 * the single "Run Validation" button; this component receives the resolved
 * `filing` + selection as props and runs its own comparison whenever `runSignal`
 * is bumped (if a TRACES file has been imported). Results are shown as a distinct
 * section, kept entirely separate from the Stage-1 data reconciliation.
 */
interface Props {
  filing: any;                              // resolved tds_filings row (or null)
  selClient: string;
  selFy: string;
  selQuarter: string;
  selForm: string;
  runSignal: number;                        // bump to trigger Stage-2 validation
  resolveFirmId: () => Promise<string | null>;
  disabled?: boolean;                       // parent's compliance gate
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

const RESULT_BADGE: Record<string, string> = {
  "PAN Verified": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Party Missing in PAN Verification File": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Party Missing in Office Data": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "PAN Status Error": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "PAN Status Blank": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "PAN Inactive": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "PAN Invalid": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

/** Parse a TRACES Bulk-PAN Excel: find the sheet whose header row has PAN + a
 *  status/name column, map the columns, and extract the PAN rows. */
function parseTracesWorkbook(data: ArrayBuffer): Omit<TracesPanRow, "row_id">[] {
  const wb = XLSX.read(data, { type: "array" });
  let grid: unknown[][] | null = null;
  let hdrIdx = -1;
  for (const sn of wb.SheetNames) {
    const g = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: false }) as unknown[][];
    const idx = g.findIndex(r => {
      const cells = (r || []).map(c => String(c ?? "").toLowerCase().trim());
      const hasPan = cells.some(c => c === "pan" || c.replace(/[^a-z]/g, "") === "pan" || c.includes("pan no") || c.includes("pan number"));
      const hasStatusOrName = cells.some(c => c.includes("status")) || cells.some(c => c === "name" || c.includes("party") || c.includes("deductee"));
      return hasPan && hasStatusOrName;
    });
    if (idx >= 0) { grid = g; hdrIdx = idx; break; }
  }
  if (!grid || hdrIdx < 0) return [];

  const header = (grid[hdrIdx] || []).map(c => String(c ?? "").toLowerCase().trim());
  const find = (fn: (h: string) => boolean) => header.findIndex(fn);
  const panCol = find(h => h === "pan" || h.replace(/[^a-z]/g, "") === "pan" || h.includes("pan no") || h.includes("pan number") || h.includes("deductee pan"));
  const statusCol = find(h => h.includes("status"));
  const nameCol = find(h => h === "name" || h === "party name" || h === "deductee name" || h === "party" || h === "deductee");
  const verifiedCol = find(h => h.includes("verified"));

  const cell = (row: unknown[], i: number) => (i >= 0 ? (String(row[i] ?? "").trim() || null) : null);
  const out: Omit<TracesPanRow, "row_id">[] = [];
  for (let r = hdrIdx + 1; r < grid.length; r++) {
    const dr = grid[r] || [];
    const pan = cell(dr, panCol);
    if (!pan) continue; // skip title/footer/blank rows — a real TRACES row always has a PAN
    out.push({
      pan,
      name: cell(dr, nameCol),
      verified_name: cell(dr, verifiedCol),
      pan_status: cell(dr, statusCol),
    });
  }
  return out;
}

export function TdsPanVerification({ filing, selClient, selFy, selQuarter, selForm, runSignal, resolveFirmId, disabled }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [officeCount, setOfficeCount] = useState(0);
  const [batch, setBatch] = useState<any>(null);
  const [results, setResults] = useState<PanResult[] | null>(null);
  const [userMap, setUserMap] = useState<Record<string, string>>({});

  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [ovOpen, setOvOpen] = useState(false);
  const [ovTarget, setOvTarget] = useState<PanResult | null>(null);
  const [ovReason, setOvReason] = useState<string>("");
  const [ovOther, setOvOther] = useState("");
  const [savingOv, setSavingOv] = useState(false);

  const filingId = filing?.id ?? null;

  // Load office count + latest TRACES batch + existing results for the parent's filing.
  const loadAll = useCallback(async () => {
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

  const handleImport = async (file: File) => {
    if (!filing) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const rows = parseTracesWorkbook(buf);
      if (rows.length === 0) throw new Error("No PAN rows found. Expected a TRACES Bulk PAN file with a PAN / PAN Status sheet.");
      const firmId = await resolveFirmId();

      const { data: batchRow, error: bErr } = await supabase.from("tds_pan_verification_batches").insert({
        filing_id: filing.id, client_id: selClient, firm_id: firmId,
        financial_year: selFy, quarter: selQuarter, form_type: selForm,
        file_name: file.name, row_count: rows.length, status: "imported", imported_by: user?.id,
      }).select("id").single();
      if (bErr || !batchRow) throw new Error(bErr?.message || "Batch insert failed");

      const rowRecords = rows.map((r, i) => ({
        batch_id: batchRow.id, filing_id: filing.id, firm_id: firmId, row_index: i,
        pan: r.pan, name: r.name, verified_name: r.verified_name, pan_status: r.pan_status,
        raw: r,
      }));
      const { error: rErr } = await supabase.from("tds_pan_verification_rows").insert(rowRecords);
      if (rErr) throw new Error(rErr.message);

      // A fresh import invalidates any prior validation for this filing.
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

      const { data: prior } = await supabase.from("tds_pan_verification_results")
        .select("id, office_deductee_id, pan, overridden, override_reason, overridden_by, overridden_at").eq("filing_id", filing.id);
      const priorMap = new Map<string, any>();
      for (const p of prior || []) priorMap.set(`${p.office_deductee_id ?? ""}|${normalizePan(p.pan)}`, p);
      const priorIds = (prior || []).map((p: any) => p.id);

      const newRows = compared.map(r => {
        const carry = priorMap.get(`${r.office_deductee_id ?? ""}|${normalizePan(r.pan)}`);
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

  // Parent's single "Run Validation" bumps runSignal — run Stage 2 if a TRACES
  // file has been imported (otherwise stay quiet; Stage 2 is optional).
  const runRef = useRef(runValidation);
  runRef.current = runValidation;
  useEffect(() => {
    if (runSignal > 0 && batch) runRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSignal]);

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
      actionType: "PAN_OVERRIDE_UNDO",
      oldValue: "Overridden", newValue: r.validation_result, remark: `Override removed for ${r.party_name || r.pan}`,
    });
    setResults(prev => prev ? prev.map(x => x.id === r.id ? { ...x, overridden: false, override_reason: null, overridden_by: null, overridden_at: null } : x) : prev);
  };

  const summary = useMemo(() => {
    const rs = results || [];
    const count = (v: PanValidationResult) => rs.filter(r => r.validation_result === v).length;
    const exceptions = rs.filter(r => isPanException(r.validation_result));
    return {
      total: rs.length,
      verified: count("PAN Verified"),
      exceptions: exceptions.length,
      overridden: rs.filter(r => r.overridden).length,
      pending: exceptions.filter(r => !r.overridden).length,
      missingOffice: count("Party Missing in Office Data"),
      missingPan: count("Party Missing in PAN Verification File"),
      statusError: count("PAN Status Error"),
      invalid: count("PAN Invalid"),
      inactive: count("PAN Inactive"),
      blank: count("PAN Status Blank"),
    };
  }, [results]);

  const finalStatus = (r: PanResult) =>
    r.overridden ? "Overridden" : !isPanException(r.validation_result) ? "Verified" : "Pending";

  const sortedResults = results
    ? [...results].sort((a, b) => {
        const rank = (r: PanResult) => (!isPanException(r.validation_result) ? 2 : r.overridden ? 1 : 0);
        return rank(a) - rank(b);
      })
    : null;

  if (!filing) return null;

  return (
    <div className="space-y-4">
      {/* TRACES file */}
      <Card><CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="font-semibold text-sm flex items-center gap-2"><FileSpreadsheet size={15} /> TRACES Bulk PAN File <span className="text-muted-foreground font-normal">· {officeCount} office parties this quarter</span></p>
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.currentTarget.value = ""; }} />
          <Button size="sm" variant={batch ? "outline" : "default"} className="gap-1" disabled={importing || disabled}
            onClick={() => fileInputRef.current?.click()}>
            {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {batch ? "Re-import" : "Import TRACES file"}
          </Button>
        </div>
        {batch ? (
          <p className="text-sm"><span className="font-bold">{batch.row_count}</span> <span className="text-muted-foreground">PANs</span> <span className="text-xs text-muted-foreground">· {batch.file_name}</span>{validating && <span className="text-xs text-amber-600 ml-2"><Loader2 size={11} className="animate-spin inline" /> verifying…</span>}</p>
        ) : <p className="text-xs text-muted-foreground">Import the TRACES Bulk PAN Verification Excel (.xls / .xlsx), then click <b>Run Validation</b> above. Stage 2 is optional.</p>}
      </CardContent></Card>

      {results && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Total", value: summary.total, cls: "" },
              { label: "Verified", value: summary.verified, cls: "text-emerald-600" },
              { label: "Exceptions", value: summary.exceptions, cls: "text-destructive" },
              { label: "Overridden", value: summary.overridden, cls: "text-blue-600" },
              { label: "Pending", value: summary.pending, cls: summary.pending > 0 ? "text-amber-600" : "text-emerald-600" },
            ].map(s => (
              <Card key={s.label}><CardContent className="p-3 text-center">
                <p className={cn("text-2xl font-bold", s.cls)}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent></Card>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {[
              { label: "Missing in Office Data", value: summary.missingOffice },
              { label: "Missing in PAN File", value: summary.missingPan },
              { label: "PAN Status Error", value: summary.statusError },
              { label: "PAN Invalid", value: summary.invalid },
              { label: "PAN Inactive", value: summary.inactive },
              { label: "PAN Status Blank", value: summary.blank },
            ].filter(x => x.value > 0).map(x => (
              <span key={x.label} className="px-2 py-1 rounded-md bg-muted text-muted-foreground">{x.label}: <b className="text-foreground">{x.value}</b></span>
            ))}
          </div>

          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Quarter</TableHead>
                  <TableHead>Party Name</TableHead>
                  <TableHead className="w-[120px]">PAN</TableHead>
                  <TableHead className="w-[150px]">PAN Status</TableHead>
                  <TableHead className="w-[210px]">Validation Result</TableHead>
                  <TableHead className="w-[130px]">Final Status</TableHead>
                  <TableHead className="w-[110px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedResults!.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No records</TableCell></TableRow>
                ) : sortedResults!.map(r => {
                  const fs = finalStatus(r);
                  const isExc = isPanException(r.validation_result);
                  return (
                    <TableRow key={r.id} className={cn(r.overridden && "opacity-70")}>
                      <TableCell className="text-xs">{r.quarter || selQuarter}</TableCell>
                      <TableCell className="text-sm font-medium">{r.party_name || "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{r.pan || "—"}</TableCell>
                      <TableCell className="text-xs">{r.pan_status || "—"}</TableCell>
                      <TableCell>
                        <Badge className={cn("text-[10px]", RESULT_BADGE[r.validation_result] || "bg-muted")}>{r.validation_result}</Badge>
                      </TableCell>
                      <TableCell>
                        {fs === "Verified" && <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} /> Verified</span>}
                        {fs === "Overridden" && <span className="text-xs text-blue-600" title={r.override_reason || ""}>Overridden{r.overridden_by && userMap[r.overridden_by] ? ` · ${userMap[r.overridden_by]}` : ""}</span>}
                        {fs === "Pending" && <span className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> Pending</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {isExc && (r.overridden
                          ? <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => undoOverride(r)}>Undo</Button>
                          : <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openOverride(r)} disabled={disabled}><ShieldCheck size={12} /> Override</Button>)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
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
