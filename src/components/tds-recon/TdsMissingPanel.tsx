/**
 * TdsMissingPanel  (Phase TDS-4 — Goal 3: Missing TDS Obligations)
 *
 * Shows AI-detected TB ledgers that likely have TDS obligations but are
 * entirely absent from TDS filings. Features:
 *   • "Run Scanner" button with configurable confidence threshold
 *   • Summary KPIs: scanned / flagged / estimated total TDS exposure
 *   • Table: Ledger | Group | Inferred Section | Nature | Activity | Est. TDS | Confidence | Actions
 *   • Expandable row: full AI reasoning + matched keywords
 *   • Per-row: Raise Query | Accept | Disregard | Create Mapping
 *   • Create Mapping dialog: pre-fill section, let auditor enter deductee name
 */
import { useState, useCallback } from "react";
import { supabase }   from "@/integrations/supabase/client";
import { Button }     from "@/components/ui/button";
import { Badge }      from "@/components/ui/badge";
import { Input }      from "@/components/ui/input";
import { Textarea }   from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertOctagon, ScanSearch, Loader2, RefreshCw, Info,
  ChevronDown, ChevronRight, MessageSquareWarning, CheckCircle,
  XCircle, Link2, TrendingDown,
} from "lucide-react";
import { cn }        from "@/lib/utils";
import { toast }     from "sonner";
import { useTdsReconFlags, FlagStatus, TdsReconFlag } from "./hooks/useTdsReconFlags";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number | null | undefined): string {
  if (n == null) return "—";
  return `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function ConfBar({ value }: { value: number | null }) {
  const v = value ?? 0;
  const color = v >= 75 ? "bg-red-500" : v >= 55 ? "bg-orange-400" : "bg-amber-400";
  return (
    <div className="flex items-center gap-1.5 w-20">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-6">{v}%</span>
    </div>
  );
}

function StatusPill({ status }: { status: FlagStatus }) {
  const map: Record<FlagStatus, string> = {
    pending:      "bg-slate-100 text-slate-700 border-slate-200",
    query_raised: "bg-blue-100  text-blue-700  border-blue-200",
    accepted:     "bg-green-100 text-green-700 border-green-200",
    disregarded:  "bg-muted     text-muted-foreground border",
  };
  const label: Record<FlagStatus, string> = {
    pending: "Pending", query_raised: "Query Raised",
    accepted: "Accepted", disregarded: "Disregarded",
  };
  return (
    <span className={cn("inline-flex px-1.5 py-0.5 rounded border text-[10px] font-medium", map[status])}>
      {label[status]}
    </span>
  );
}

// ─── Create Mapping Dialog ────────────────────────────────────────────────────
const TDS_SECTIONS = [
  "192","192A","193","194","194A","194B","194BB","194C","194D","194DA",
  "194G","194H","194I","194IB","194IC","194J","194K","194LA","194M",
  "194N","194O","194Q","194R","194S","195",
];

function CreateMappingDialog({
  flag, open, onClose, onConfirm, saving,
}: {
  flag: TdsReconFlag | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (deducteeName: string, sectionCode: string, note: string) => void;
  saving: boolean;
}) {
  const [deducteeName, setDeducteeName] = useState("");
  const [section,      setSection]      = useState(flag?.section_code ?? "");
  const [note,         setNote]         = useState("");

  if (!flag) return null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Link2 size={15} className="text-blue-500" />
            Create TDS Party Mapping
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <div className="p-2.5 bg-muted/40 rounded space-y-1">
            <p className="text-muted-foreground">TB Ledger (unmapped)</p>
            <p className="font-semibold text-sm">{flag.tb_ledger_name}</p>
            {flag.tb_ledger_name && (
              <p className="text-muted-foreground">{/* parent group shown below */}</p>
            )}
          </div>

          <p className="text-muted-foreground">
            Enter the TDS deductee name as it appears in TDS filings for this ledger.
            This will create a confirmed mapping so the reconciliation engine can analyse it.
          </p>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground font-medium">
              TDS Deductee Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={deducteeName}
              onChange={e => setDeducteeName(e.target.value)}
              placeholder="Exact name from TDS filing…"
              className="h-7 text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground font-medium">
              TDS Section
            </label>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Select section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— None —</SelectItem>
                {TDS_SECTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Note (optional)</label>
            <Textarea
              value={note} onChange={e => setNote(e.target.value)}
              className="min-h-[48px] text-xs"
              placeholder="Reason for this mapping…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white gap-1"
            onClick={() => onConfirm(deducteeName.trim(), section, note)}
            disabled={!deducteeName.trim() || saving}
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
            Create Mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Raise Query Dialog ───────────────────────────────────────────────────────
function RaiseQueryDialog({
  flag, open, onClose, onConfirm, saving,
}: {
  flag: TdsReconFlag | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
  saving: boolean;
}) {
  const [note, setNote] = useState("");
  if (!flag) return null;

  const defaultNote =
    `Please confirm whether TDS under Section ${flag.section_code ?? "—"} ` +
    `(${flag.nature_of_payment ?? "—"}) is applicable for ledger "${flag.tb_ledger_name}". ` +
    `Our records show annual activity of ${fmtINR(flag.book_amount)} against this party. ` +
    `Estimated TDS liability: ${fmtINR(flag.expected_tds)} @ ${flag.expected_rate ?? 0}%.`;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <MessageSquareWarning size={16} className="text-orange-500" />
            Raise Query — Missing TDS Obligation
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2 p-2.5 bg-muted/40 rounded">
            <div>
              <p className="text-muted-foreground">TB Ledger</p>
              <p className="font-medium">{flag.tb_ledger_name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Inferred Section</p>
              <Badge variant="secondary" className="text-[10px]">
                {flag.section_code ?? "Unknown"}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground">Nature of Payment</p>
              <p className="font-medium">{flag.nature_of_payment ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Estimated TDS</p>
              <p className="font-bold text-red-600">{fmtINR(flag.expected_tds)}</p>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Query text (edit as needed)</label>
            <Textarea
              value={note || defaultNote}
              onChange={e => setNote(e.target.value)}
              className="min-h-[90px] text-xs"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            size="sm"
            className="bg-orange-600 hover:bg-orange-700 text-white gap-1"
            onClick={() => onConfirm(note || defaultNote)}
            disabled={saving}
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <MessageSquareWarning size={11} />}
            Raise Query
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Single flag row ──────────────────────────────────────────────────────────
function FlagRow({
  flag, onQuery, onAccept, onDisregard, onMap, saving,
}: {
  flag: TdsReconFlag;
  onQuery:     (f: TdsReconFlag) => void;
  onAccept:    (id: string) => void;
  onDisregard: (id: string) => void;
  onMap:       (f: TdsReconFlag) => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPending = flag.flag_status === "pending";

  return (
    <div className="hover:bg-muted/10 transition-colors">
      <div className="grid grid-cols-[1fr_80px_80px_100px_85px_80px_155px] gap-2 items-center px-4 py-2.5">

        {/* Ledger + group */}
        <div>
          <p className="text-xs font-medium truncate" title={flag.tb_ledger_name ?? ""}>
            {flag.tb_ledger_name ?? "—"}
          </p>
          {flag.nature_of_payment && (
            <p className="text-[10px] text-muted-foreground truncate">{flag.nature_of_payment}</p>
          )}
        </div>

        {/* Section */}
        <div>
          {flag.section_code
            ? <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{flag.section_code}</Badge>
            : <span className="text-[10px] text-muted-foreground">—</span>}
        </div>

        {/* Activity */}
        <div className="text-right">
          <p className="text-xs tabular-nums font-medium">{fmtINR(flag.book_amount)}</p>
          <p className="text-[10px] text-muted-foreground">activity</p>
        </div>

        {/* Estimated TDS */}
        <div className="text-right">
          {flag.expected_tds && flag.expected_tds > 0 ? (
            <>
              <p className="text-xs tabular-nums font-semibold text-red-600">
                {fmtINR(flag.expected_tds)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                @ {flag.expected_rate ?? 0}%
              </p>
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">Slab rate</p>
          )}
        </div>

        {/* Confidence */}
        <ConfBar value={flag.ai_confidence} />

        {/* Status */}
        <StatusPill status={flag.flag_status} />

        {/* Actions */}
        <div className="flex flex-col gap-1 items-start">
          <div className="flex items-center gap-1 flex-wrap">
            {isPending && (<>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button"
                    className="p-0.5 rounded text-orange-500 hover:bg-orange-50 disabled:opacity-40"
                    onClick={() => onQuery(flag)} disabled={saving}
                  ><MessageSquareWarning size={13} /></button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Raise query</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button"
                    className="p-0.5 rounded text-blue-500 hover:bg-blue-50 disabled:opacity-40"
                    onClick={() => onMap(flag)} disabled={saving}
                  ><Link2 size={13} /></button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Create party mapping</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button"
                    className="p-0.5 rounded text-green-600 hover:bg-green-50 disabled:opacity-40"
                    onClick={() => onAccept(flag.id)} disabled={saving}
                  ><CheckCircle size={13} /></button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Accept (valid obligation)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button"
                    className="p-0.5 rounded text-muted-foreground hover:bg-muted/50 disabled:opacity-40"
                    onClick={() => onDisregard(flag.id)} disabled={saving}
                  ><XCircle size={13} /></button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Disregard</TooltipContent>
              </Tooltip>
            </>)}
            {flag.ai_reasoning && (
              <button type="button"
                className="p-0.5 rounded text-muted-foreground hover:bg-muted/50"
                onClick={() => setExpanded(e => !e)}
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded reasoning */}
      {expanded && flag.ai_reasoning && (
        <div className="px-4 pb-3 space-y-2">
          <div className="flex gap-2 items-start p-2.5 bg-amber-50/60 rounded border border-amber-100 text-xs text-amber-900">
            <Info size={12} className="flex-shrink-0 mt-0.5" />
            <p>{flag.ai_reasoning}</p>
          </div>
          {flag.action_note && (
            <p className="text-[11px] text-muted-foreground italic">Note: {flag.action_note}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
}

type StatusFilter = FlagStatus | "all";

export function TdsMissingPanel({ clientId, financialYear }: Props) {
  const {
    flags: allFlags, loading, error, firmId,
    refresh, updateFlagStatus,
  } = useTdsReconFlags(clientId, financialYear);

  // Only Goal 3 flags in this panel
  const flags = allFlags.filter(f => f.goal_number === 3);

  const [running,        setRunning]        = useState(false);
  const [threshold,      setThreshold]      = useState(40);
  const [statusFilter,   setStatusFilter]   = useState<StatusFilter>("all");
  const [sectionFilter,  setSectionFilter]  = useState<string>("all");
  const [savingId,       setSavingId]       = useState<string | null>(null);
  const [queryFlag,      setQueryFlag]      = useState<TdsReconFlag | null>(null);
  const [mapFlag,        setMapFlag]        = useState<TdsReconFlag | null>(null);

  // Stats
  const pending    = flags.filter(f => f.flag_status === "pending").length;
  const actioned   = flags.filter(f => f.flag_status !== "pending").length;
  const totalEstTds = flags
    .filter(f => f.flag_status !== "disregarded")
    .reduce((s, f) => s + (f.expected_tds ?? 0), 0);

  const sections = [...new Set(flags.map(f => f.section_code).filter(Boolean))] as string[];

  // ── Run Scanner ────────────────────────────────────────────────────────────
  const runScanner = useCallback(async () => {
    if (!clientId || !financialYear || !firmId) {
      toast.error("Cannot run — missing client, FY, or firm context");
      return;
    }
    setRunning(true);
    try {
      const res = await supabase.functions.invoke("tds-missing-scanner", {
        body: {
          client_id: clientId, financial_year: financialYear,
          firm_id: firmId, confidence_threshold: threshold,
        },
      });
      if (res.error) throw new Error(res.error.message);

      const r = res.data as {
        scanned: number; excluded_mapped: number; flagged: number;
        estimated_total_tds: number; message?: string;
      };

      if (r.message && r.flagged === 0) {
        toast.info(r.message);
      } else {
        toast.success(
          `Scanner complete: ${r.scanned} unmapped ledgers scanned, ` +
          `${r.flagged} potential obligations detected` +
          (r.excluded_mapped ? ` (${r.excluded_mapped} already mapped, skipped)` : "") +
          (r.estimated_total_tds > 0
            ? `. Total estimated TDS exposure: ₹${r.estimated_total_tds.toLocaleString("en-IN")}`
            : ""),
        );
      }
      refresh();
    } catch (err: unknown) {
      toast.error(`Scanner failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }, [clientId, financialYear, firmId, threshold, refresh]);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const visible = flags.filter(f => {
    if (statusFilter  !== "all" && f.flag_status   !== statusFilter)  return false;
    if (sectionFilter !== "all" && f.section_code  !== sectionFilter) return false;
    return true;
  });

  // ── Row actions ────────────────────────────────────────────────────────────
  const handleAction = async (id: string, status: FlagStatus, note?: string) => {
    setSavingId(id);
    try {
      await updateFlagStatus(id, status, note ? { note } : {});
      toast.success(status === "query_raised" ? "Query raised"
        : status === "accepted" ? "Obligation accepted"
        : "Flag disregarded");
      if (status === "query_raised") setQueryFlag(null);
    } catch (e: unknown) {
      toast.error(String(e));
    } finally { setSavingId(null); }
  };

  // ── Create Mapping ─────────────────────────────────────────────────────────
  const handleCreateMapping = useCallback(async (
    deducteeName: string, sectionCode: string, note: string,
  ) => {
    if (!mapFlag || !clientId || !financialYear || !firmId) return;
    setSavingId(mapFlag.id);
    try {
      // Insert mapping row as confirmed (auditor-provided)
      const { error: mapErr } = await (supabase as any)
        .from("tds_tb_party_mappings")
        .upsert({
          client_id: clientId, firm_id: firmId, financial_year: financialYear,
          tb_ledger_name:    mapFlag.tb_ledger_name,
          tds_deductee_name: deducteeName,
          tds_section_code:  sectionCode || mapFlag.section_code,
          match_confidence:  mapFlag.ai_confidence,
          match_method:      "manual_from_missing_scanner",
          ai_reasoning:      `Manually mapped from Goal 3 scanner. ${note}`.trim(),
          mapping_status:    "confirmed",
          mapped_by:         "auditor",
          notes:             note || null,
        }, { onConflict: "client_id,financial_year,tb_ledger_name,tds_deductee_name" });

      if (mapErr) throw new Error(mapErr.message);

      // Mark this flag as accepted
      await updateFlagStatus(mapFlag.id, "accepted", { note: `Mapped to: ${deducteeName}` });
      setMapFlag(null);
      toast.success(
        `Mapping created: "${mapFlag.tb_ledger_name}" → "${deducteeName}". ` +
        "Run Reconciliation to analyse this pair.",
      );
    } catch (e: unknown) {
      toast.error(`Mapping failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSavingId(null); }
  }, [mapFlag, clientId, financialYear, firmId, updateFlagStatus]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider>
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">

        {/* Summary chips */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-rose-50 border-rose-200 text-xs text-rose-700">
            <AlertOctagon size={11} />
            <span className="font-bold">{flags.length}</span>
            <span>Obligations</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-slate-50 border-slate-200 text-xs text-slate-700">
            <span className="font-bold">{pending}</span>
            <span>Pending</span>
          </div>
          {totalEstTds > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-red-50 border-red-200 text-xs text-red-700">
              <TrendingDown size={11} />
              <span>Est. exposure</span>
              <span className="font-bold">
                ₹{totalEstTds.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-muted-foreground whitespace-nowrap">
              Min confidence
            </label>
            <Input
              type="number" min={20} max={90} step={5}
              value={threshold}
              onChange={e => setThreshold(Math.max(20, Math.min(90, Number(e.target.value))))}
              className="h-7 w-16 text-xs text-center"
            />
            <span className="text-[10px] text-muted-foreground">%</span>
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
            onClick={refresh} disabled={loading}
          >
            <RefreshCw size={11} className={cn(loading && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
            onClick={runScanner} disabled={running || !firmId}
          >
            {running
              ? <Loader2 size={11} className="animate-spin" />
              : <ScanSearch size={11} />}
            {running ? "Scanning…" : "Run Missing TDS Scanner"}
          </Button>
        </div>
      </div>

      {/* ── Filters ── */}
      {flags.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Status:</span>
            {(["all","pending","query_raised","accepted","disregarded"] as const).map(s => (
              <button key={s} type="button"
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "px-2 py-0.5 rounded border transition-colors",
                  statusFilter === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground border-muted hover:border-foreground/30",
                )}
              >
                {s === "all" ? "All"
                  : s === "query_raised" ? "Query Raised"
                  : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          {sections.length > 1 && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Section:</span>
              <Select value={sectionFilter} onValueChange={setSectionFilter}>
                <SelectTrigger className="h-6 text-xs w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sections</SelectItem>
                  {sections.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && flags.length === 0 && (
        <div className="flex flex-col items-center justify-center h-52 gap-3 text-center border rounded-lg border-dashed">
          <ScanSearch size={32} className="text-muted-foreground/25" />
          <div>
            <p className="text-sm font-medium text-foreground">No missing obligations detected yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Click <strong>Run Missing TDS Scanner</strong> to AI-scan all unmapped Trial Balance
              ledgers for potential TDS liabilities using keyword + section heuristics.
            </p>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      {!loading && flags.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-[1fr_80px_80px_100px_85px_80px_155px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30 border-b">
            <span>Unmapped Ledger</span>
            <span>Section</span>
            <span className="text-right">Activity</span>
            <span className="text-right">Est. TDS</span>
            <span>Confidence</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          <div className="divide-y">
            {visible.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No flags match the current filter.</div>
            ) : (
              visible.map(f => (
                <FlagRow
                  key={f.id} flag={f}
                  onQuery={setQueryFlag}
                  onAccept={id => handleAction(id, "accepted")}
                  onDisregard={id => handleAction(id, "disregarded")}
                  onMap={setMapFlag}
                  saving={savingId === f.id}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      {!loading && flags.length > 0 && (
        <p className="text-[10px] text-muted-foreground text-right">
          {pending} pending · {actioned} actioned · showing {visible.length} of {flags.length}
        </p>
      )}

      {/* ── Dialogs ── */}
      <RaiseQueryDialog
        flag={queryFlag} open={!!queryFlag}
        onClose={() => setQueryFlag(null)}
        onConfirm={note => queryFlag && handleAction(queryFlag.id, "query_raised", note)}
        saving={!!savingId}
      />

      <CreateMappingDialog
        flag={mapFlag} open={!!mapFlag}
        onClose={() => setMapFlag(null)}
        onConfirm={handleCreateMapping}
        saving={!!savingId}
      />
    </div>
    </TooltipProvider>
  );
}
