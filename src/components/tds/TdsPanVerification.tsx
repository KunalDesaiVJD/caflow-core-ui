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
  ShieldCheck, CheckCircle2, XCircle, Upload, FileSpreadsheet, Loader2, RotateCcw, X, Play, Users,
} from "lucide-react";
import { readSheetGrids, readDelimitedGrid } from "@/lib/tdsWorkbook";
import { logReconAudit } from "@/lib/tdsReconAudit";
import {
  comparePanVerification, extractTracesRows, panDiagnostics, isPanException, normalizePan,
  panReason, panRecommendedAction, PAN_OVERRIDE_REASONS,
  type OfficeParty, type TracesPanRow, type PanValidationResult, type PanCheckDetail,
} from "@/lib/tdsPanVerification";

/**
 * Stage 2 · PAN Verification — a complete, office-driven PAN audit that mirrors
 * the Stage-1 workflow/UX (Office Data + Imported file → Run Validation → summary
 * cards → detailed record-wise results) but is a fully independent module.
 *
 * Office Data is the MASTER: the audit runs over the quarter's office parties and,
 * for each, finds its PAN in the imported TRACES bulk-PAN file and produces a
 * complete result using PAN Status + Verified Name + Mismatch-in-Name. A TRACES
 * PAN with no office party is IGNORED. Name comparison inherits Stage-1's
 * intelligence (order-independent, prefix/initial-tolerant) — reimplemented in
 * src/lib/tdsPanVerification.ts so Stage-1 is never touched.
 *
 * SCOPE: this file + src/lib/tdsPanVerification.ts only.
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

type PanFilter = null | "total" | "verified" | "matched" | "issues" | "pending" | "overridden";

const RESULT_BADGE: Record<string, string> = {
  "PAN Verified": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "PAN Not Found in TRACES": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Invalid PAN Format": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "PAN Missing in Office Data": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "Invalid PAN": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "PAN Inoperative": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  "PAN Status Blank": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "PAN Status Error": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Name Mismatch": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Different Party Name": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
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
    const safety = setTimeout(finish, 700);
    return () => { cancelAnimationFrame(raf); clearTimeout(safety); };
  }, [value]);
  return <>{display}</>;
}

/** Parse a TRACES Bulk-PAN file (Excel OR delimited .csv/.txt) into PAN rows via
 *  the shared Stage-1 reader (readSheetGrids → TRUE used range, so a bloated-!ref
 *  file can never freeze the tab), then the pure, tested extractTracesRows(). */
async function parseTracesFile(file: File): Promise<Omit<TracesPanRow, "row_id">[]> {
  const name = file.name.toLowerCase();
  const grids = (name.endsWith(".csv") || name.endsWith(".txt"))
    ? readDelimitedGrid(await file.text())
    : readSheetGrids(await file.arrayBuffer());
  return extractTracesRows(grids);
}

/** Whether an audit row's name check passed (defensive for pre-migration rows). */
const nameMatchedOf = (r: PanResult): boolean =>
  r.detail?.name_matched ?? (r.validation_result === "PAN Verified");

export function TdsPanVerification({ filing, selClient, selFy, selQuarter, selForm, resolveFirmId, disabled }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [officeParties, setOfficeParties] = useState<OfficeParty[]>([]);
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

  // Office party count + how many carry a PAN (shown on the Office Data card).
  const officeCount = officeParties.length;
  const officePanCount = useMemo(() => officeParties.filter((o) => normalizePan(o.pan)).length, [officeParties]);

  const loadAll = useCallback(async () => {
    setDiagnostics([]); // recomputed on the next Run Validation for the current data
    if (!filingId) { setBatch(null); setResults(null); setOfficeParties([]); return; }

    // Office Data (master) — party name + PAN for this quarter's filing.
    const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", filingId);
    const chIds = (ch || []).map((c: any) => c.id);
    let parties: OfficeParty[] = [];
    if (chIds.length) {
      const { data: ded } = await supabase.from("tds_deductees")
        .select("id, deductee_pan, deductee_name").in("challan_id", chIds);
      parties = (ded || []).map((d: any) => ({ deductee_id: d.id, pan: d.deductee_pan, name: d.deductee_name }));
    }
    setOfficeParties(parties);

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
        pan: r.pan, name: r.name, verified_name: r.verified_name, pan_status: r.pan_status,
        mismatch_in_name: r.mismatch_in_name, raw: r,
      }));
      const { error: rErr } = await supabase.from("tds_pan_verification_rows").insert(rowRecords);
      if (rErr) throw new Error(rErr.message);

      // A fresh import invalidates the prior audit — the summary only reappears
      // after the user clicks Run Validation.
      await supabase.from("tds_pan_verification_results").delete().eq("filing_id", filing.id);
      setResults(null);
      setDiagnostics([]);
      toast({ title: `Imported ${rows.length} PAN record(s)`, description: `${file.name} — click Run Validation to audit.` });
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
      // Office Data (master) — re-read fresh at validation time.
      const { data: ch } = await supabase.from("tds_challans").select("id").eq("filing_id", filing.id);
      const chIds = (ch || []).map((c: any) => c.id);
      let office: OfficeParty[] = [];
      if (chIds.length) {
        const { data: ded } = await supabase.from("tds_deductees")
          .select("id, deductee_pan, deductee_name").in("challan_id", chIds);
        office = (ded || []).map((d: any) => ({ deductee_id: d.id, pan: d.deductee_pan, name: d.deductee_name }));
      }
      const { data: tr } = await supabase.from("tds_pan_verification_rows")
        .select("id, pan, name, verified_name, pan_status, mismatch_in_name").eq("batch_id", batch.id);
      const traces: TracesPanRow[] = (tr || []).map((t: any) => ({
        row_id: t.id, pan: t.pan, name: t.name, verified_name: t.verified_name,
        pan_status: t.pan_status, mismatch_in_name: t.mismatch_in_name,
      }));

      const audited = comparePanVerification(office, traces);
      setDiagnostics(panDiagnostics(office, traces));

      // Preserve overrides across re-runs, keyed by PAN (stable one-per-PAN).
      const { data: prior } = await supabase.from("tds_pan_verification_results")
        .select("id, office_deductee_id, pan, overridden, override_reason, overridden_by, overridden_at").eq("filing_id", filing.id);
      const keyOf = (deducteeId: string | null, pan: string | null) => normalizePan(pan) || `d:${deducteeId ?? ""}`;
      const priorMap = new Map<string, any>();
      for (const p of prior || []) priorMap.set(keyOf(p.office_deductee_id, p.pan), p);
      const priorIds = (prior || []).map((p: any) => p.id);

      const newRows = audited.map((r) => {
        const carry = priorMap.get(keyOf(r.office_deductee_id, r.pan));
        const keep = !!carry?.overridden;
        return {
          filing_id: filing.id, batch_id: batch.id, firm_id: firmId, quarter: selQuarter,
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
      if (priorIds.length) await supabase.from("tds_pan_verification_results").delete().in("id", priorIds);

      const { data: res } = await supabase.from("tds_pan_verification_results").select("*").eq("filing_id", filing.id);
      setResults((res as PanResult[]) || []);
      const verified = audited.filter((r) => r.validation_result === "PAN Verified").length;
      toast({ title: "Stage 2 · PAN verification complete", description: `${verified} verified · ${audited.length - verified} issue(s) across ${audited.length} office part${audited.length === 1 ? "y" : "ies"}` });
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

  const summary = useMemo(() => {
    const rs = results || [];
    const issues = rs.filter((r) => isPanException(r.validation_result));
    return {
      total: rs.length,
      verified: rs.filter((r) => r.validation_result === "PAN Verified").length,
      matched: rs.filter((r) => r.detail?.pan_found && nameMatchedOf(r)).length, // name matched among PANs found
      issues: issues.length,
      overridden: rs.filter((r) => r.overridden).length,
      pending: issues.filter((r) => !r.overridden).length,
    };
  }, [results]);

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
      case "matched": return rs.filter((r) => r.detail?.pan_found && nameMatchedOf(r));
      case "issues": return rs.filter((r) => isPanException(r.validation_result));
      case "pending": return rs.filter((r) => isPanException(r.validation_result) && !r.overridden);
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

  // The three-check audit breakdown for a party (PAN found / status / name).
  const renderChecks = (r: PanResult) => {
    const d = r.detail;
    const found = d ? d.pan_found : r.validation_result !== "PAN Not Found in TRACES" && r.validation_result !== "Invalid PAN Format" && r.validation_result !== "PAN Missing in Office Data";
    const statusOk = (d?.status_class ?? "") === "PAN Verified";
    const nameOk = nameMatchedOf(r);
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
            {found && checkLine(nameOk, nameOk ? "Name matched" : `Name: ${r.validation_result === "Different Party Name" ? "different party name" : "mismatch"}`)}
            {found && !nameOk && (
              <p className="text-[11px] text-muted-foreground pl-5">Office: <b className="text-foreground">{r.party_name || "—"}</b> · TRACES: <b className="text-foreground">{r.verified_name || "—"}</b></p>
            )}
          </>
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
    <div className="space-y-4">
      {/* Inputs: Office Data (master) + Imported TRACES file — mirrors Stage 1. */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users size={16} className="text-foreground" />
            <p className="font-semibold text-sm">Office Data <span className="text-muted-foreground font-normal">(master · this quarter)</span></p>
          </div>
          <div className="flex gap-6 text-sm">
            <div><span className="text-2xl font-bold">{officeCount}</span> <span className="text-muted-foreground">parties</span></div>
            <div><span className="text-2xl font-bold">{officePanCount}</span> <span className="text-muted-foreground">with PAN</span></div>
          </div>
          {officeCount === 0 && <p className="text-xs text-amber-600 mt-2">No office parties yet — enter data in the Data Entry tab first.</p>}
          {officeCount > 0 && officePanCount < officeCount && <p className="text-xs text-amber-600 mt-2">{officeCount - officePanCount} part{officeCount - officePanCount === 1 ? "y has" : "ies have"} no PAN and can't be verified.</p>}
        </CardContent></Card>

        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-sm flex items-center gap-2">
              <FileSpreadsheet size={15} className="text-foreground" /> Imported TRACES File
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
            <div className="text-sm">
              <span className="text-2xl font-bold">{batch.row_count}</span> <span className="text-muted-foreground">PANs</span>
              <p className="text-xs text-muted-foreground mt-1 truncate">{batch.file_name}</p>
            </div>
          ) : <p className="text-xs text-muted-foreground">Import the TRACES Bulk PAN Verification file (.xls / .xlsx / .csv), then click <b>Run Validation</b>. Stage 2 is optional.</p>}
        </CardContent></Card>
      </div>

      {/* Stage-2's own Run Validation — the audit (and its summary) run only on click. */}
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

          {/* Summary cards — Total / Verified / Matched / Issues / Pending / Overridden. */}
          <div className={cn("grid grid-cols-3 sm:grid-cols-6 gap-3", validating && "animate-pulse")}>
            {([
              { key: "total" as const, label: "Total Parties", value: summary.total, cls: "" },
              { key: "verified" as const, label: "Verified", value: summary.verified, cls: "text-emerald-600" },
              { key: "matched" as const, label: "Name Matched", value: summary.matched, cls: "text-emerald-600" },
              { key: "issues" as const, label: "Issues Found", value: summary.issues, cls: summary.issues > 0 ? "text-destructive" : "" },
              { key: "pending" as const, label: "Pending", value: summary.pending, cls: summary.pending > 0 ? "text-amber-600" : "text-emerald-600" },
              { key: "overridden" as const, label: "Overridden", value: summary.overridden, cls: "text-blue-600" },
            ]).map((s) => (
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
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-muted-foreground">Showing <b className="text-foreground">{cardFiltered.length}</b> record{cardFiltered.length === 1 ? "" : "s"}</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setActiveFilter(null)}><X size={11} /> Clear filter</Button>
              </div>
              {cardFiltered.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed">No records found.</div>
              ) : (
                <div className="space-y-3">
                  {cardFiltered.filter((r) => isPanException(r.validation_result)).map(renderIssueCard)}
                  {cardFiltered.some((r) => !isPanException(r.validation_result)) && renderPartyTable(cardFiltered.filter((r) => !isPanException(r.validation_result)))}
                </div>
              )}
            </div>
          ) : issueRows.length === 0 ? (
            <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={22} className="text-emerald-600" />
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">PAN Verification Completed Successfully</p>
                </div>
                <div className="text-sm text-foreground grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 max-w-xl">
                  <span className="text-muted-foreground">Total Parties</span><span className="font-semibold">{summary.total}</span>
                  <span className="text-muted-foreground">Verified</span><span className="font-semibold text-emerald-600">{summary.verified}</span>
                  <span className="text-muted-foreground">Name Matched</span><span className="font-semibold text-emerald-600">{summary.matched}</span>
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
    </div>
  );
}
