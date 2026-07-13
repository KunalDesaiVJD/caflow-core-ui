import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  ShieldCheck, CheckCircle2, Upload, Play, FileSpreadsheet, Loader2, Info, AlertTriangle,
} from "lucide-react";
import * as XLSX from "xlsx";
import { getDefaultTdsQuarter, clientHasTdsForm } from "@/lib/tdsQuarter";
import {
  comparePanVerification, isPanException, normalizePan,
  PAN_OVERRIDE_REASONS, type OfficeParty, type TracesPanRow, type PanValidationResult,
} from "@/lib/tdsPanVerification";

interface ClientOption { id: string; name: string | null; tds_forms_applicable?: string[] }

interface Props {
  clients: ClientOption[];
  resolveFirmId: () => Promise<string | null>;
}

const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];

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

export function TdsPanVerification({ clients, resolveFirmId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const smartDefault = useMemo(() => getDefaultTdsQuarter(), []);
  const [selClient, setSelClient] = useState("");
  const [selFy, setSelFy] = useState(smartDefault.fy);
  const [selQuarter, setSelQuarter] = useState(smartDefault.quarter);
  const [selForm, setSelForm] = useState("26Q");

  const [resolving, setResolving] = useState(false);
  const [filing, setFiling] = useState<any>(null);
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

  // Resolve the filing for the selected combination + hydrate batch/results.
  const loadAll = useCallback(async () => {
    if (!selClient || !selFy || !selQuarter || !selForm) {
      setFiling(null); setBatch(null); setResults(null); setOfficeCount(0);
      return;
    }
    setResolving(true);
    const { data: fData } = await supabase.from("tds_filings").select("*")
      .eq("client_id", selClient).eq("financial_year", selFy).eq("quarter", selQuarter).limit(10);
    const match = (fData || []).find((f: any) => (f.tds_forms || []).includes(selForm)) || null;
    setFiling(match);
    if (!match) { setBatch(null); setResults(null); setOfficeCount(0); setResolving(false); return; }

    const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", match.id);
    const chIds = (ch || []).map((c: any) => c.id);
    let dedCount = 0;
    if (chIds.length) {
      const { count } = await supabase.from("tds_deductees").select("id", { count: "exact", head: true }).in("challan_id", chIds);
      dedCount = count || 0;
    }
    setOfficeCount(dedCount);

    const { data: b } = await supabase.from("tds_pan_verification_batches").select("*")
      .eq("filing_id", match.id).order("imported_at", { ascending: false }).limit(1).maybeSingle();
    setBatch(b || null);

    const { data: res } = await supabase.from("tds_pan_verification_results").select("*").eq("filing_id", match.id);
    setResults(res && res.length ? (res as PanResult[]) : null);

    // Users for "Overridden By" display
    const { data: us } = await supabase.from("users").select("id, name").limit(5000);
    setUserMap(Object.fromEntries((us || []).map((u: any) => [u.id, u.name])));
    setResolving(false);
  }, [selClient, selFy, selQuarter, selForm]);

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
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
    setImporting(false);
  };

  const handleValidate = async () => {
    if (!filing || !batch) return;
    setValidating(true);
    try {
      const firmId = await resolveFirmId();
      // Office parties (this quarter) via the filing's challans.
      const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", filing.id);
      const chIds = (ch || []).map((c: any) => c.id);
      let office: OfficeParty[] = [];
      if (chIds.length) {
        const { data: ded } = await supabase.from("tds_deductees")
          .select("id, deductee_pan, deductee_name").in("challan_id", chIds);
        office = (ded || []).map((d: any) => ({ deductee_id: d.id, pan: d.deductee_pan, name: d.deductee_name }));
      }
      // TRACES rows for the latest batch.
      const { data: tr } = await supabase.from("tds_pan_verification_rows").select("id, pan, name, verified_name, pan_status").eq("batch_id", batch.id);
      const traces: TracesPanRow[] = (tr || []).map((t: any) => ({ row_id: t.id, pan: t.pan, name: t.name, verified_name: t.verified_name, pan_status: t.pan_status }));

      const compared = comparePanVerification(office, traces);

      // Preserve prior overrides across re-runs (keyed by office deductee + PAN).
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

      // Insert new first, then delete old — an insert failure never loses overrides.
      const { error: insErr } = await supabase.from("tds_pan_verification_results").insert(newRows);
      if (insErr) throw new Error(insErr.message);
      if (priorIds.length) await supabase.from("tds_pan_verification_results").delete().in("id", priorIds);

      const { data: res } = await supabase.from("tds_pan_verification_results").select("*").eq("filing_id", filing.id);
      setResults((res as PanResult[]) || []);
      const verified = compared.filter(r => r.validation_result === "PAN Verified").length;
      toast({ title: "PAN validation complete", description: `${verified} verified · ${compared.length - verified} exception(s)` });
    } catch (e: any) {
      toast({ title: "Validation failed", description: e.message, variant: "destructive" });
    }
    setValidating(false);
  };

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
    r.overridden ? "Overridden" : !isPanException(r.validation_result) ? "Verified" : "Pending Review";

  const sortedResults = results
    ? [...results].sort((a, b) => {
        const rank = (r: PanResult) => (!isPanException(r.validation_result) ? 2 : r.overridden ? 1 : 0);
        return rank(a) - rank(b);
      })
    : null;

  const clientOptions = clients.filter(c => clientHasTdsForm(c.tds_forms_applicable, selForm));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-foreground">Stage 2 · PAN Verification</h3>
        <p className="text-sm text-muted-foreground">Verify each party's PAN status against the TRACES Bulk PAN Verification file (quarter-wise)</p>
      </div>

      {/* Selectors */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={selClient} onValueChange={setSelClient}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>{clientOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
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

      {resolving && <Skeleton className="h-40 w-full" />}
      {!resolving && !selClient && (
        <div className="flex items-center gap-2 p-4 rounded-lg border bg-muted/30 text-sm text-muted-foreground"><Info size={16} /> Select a client to run PAN verification.</div>
      )}
      {!resolving && selClient && !filing && (
        <div className="flex items-center gap-2 p-4 rounded-lg border bg-muted/30 text-sm text-muted-foreground"><Info size={16} /> No filing found for {selForm} {selQuarter} {selFy}. Complete Data Entry first.</div>
      )}

      {!resolving && filing && (<>
      {/* Two datasets */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card><CardContent className="p-4">
          <p className="font-semibold text-sm mb-2">Office Parties <span className="text-muted-foreground font-normal">(this quarter)</span></p>
          <div><span className="text-2xl font-bold">{officeCount}</span> <span className="text-muted-foreground text-sm">deductee entries</span></div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-sm flex items-center gap-2"><FileSpreadsheet size={15} /> TRACES PAN File</p>
            <input ref={fileInputRef} type="file" accept=".xls,.xlsx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.currentTarget.value = ""; }} />
            <Button size="sm" variant={batch ? "outline" : "default"} className="gap-1" disabled={importing}
              onClick={() => fileInputRef.current?.click()}>
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {batch ? "Re-import" : "Import"}
            </Button>
          </div>
          {batch ? (
            <div className="text-sm"><span className="text-2xl font-bold">{batch.row_count}</span> <span className="text-muted-foreground">PANs</span>
              <p className="text-xs text-muted-foreground mt-1 truncate">{batch.file_name}</p></div>
          ) : <p className="text-xs text-muted-foreground">Import the TRACES Bulk PAN Verification Excel (.xls / .xlsx).</p>}
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-3">
        <Button size="lg" className="gap-2 font-semibold" onClick={handleValidate} disabled={validating || !batch}>
          {validating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {validating ? "Validating…" : "Run PAN Validation"}
        </Button>
        {!batch && <span className="text-xs text-muted-foreground">Import the TRACES file to enable validation.</span>}
      </div>

      {results && (
        <>
          {/* Override counters */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Total", value: summary.total, cls: "" },
              { label: "Verified", value: summary.verified, cls: "text-emerald-600" },
              { label: "Exceptions", value: summary.exceptions, cls: "text-destructive" },
              { label: "Overridden", value: summary.overridden, cls: "text-blue-600" },
              { label: "Pending Review", value: summary.pending, cls: summary.pending > 0 ? "text-amber-600" : "text-emerald-600" },
            ].map(s => (
              <Card key={s.label}><CardContent className="p-3 text-center">
                <p className={cn("text-2xl font-bold", s.cls)}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent></Card>
            ))}
          </div>

          {/* Exception-type breakdown */}
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
                        {fs === "Pending Review" && <span className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> Pending Review</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {isExc && (r.overridden
                          ? <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => undoOverride(r)}>Undo</Button>
                          : <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openOverride(r)}><ShieldCheck size={12} /> Override</Button>)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>

          {/* Completion */}
          <Card className={cn(summary.pending === 0 ? "border-emerald-200 dark:border-emerald-800" : "border-amber-200 dark:border-amber-800")}>
            <CardContent className="p-4 flex items-center gap-3">
              {summary.pending === 0
                ? <><CheckCircle2 size={20} className="text-emerald-600" /><p className="text-sm font-semibold">PAN verification complete — all parties verified or overridden.</p></>
                : <><AlertTriangle size={20} className="text-amber-600" /><p className="text-sm">{summary.pending} exception(s) pending — verify or override each to complete Stage 2.</p></>}
            </CardContent>
          </Card>
        </>
      )}
      </>)}

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
