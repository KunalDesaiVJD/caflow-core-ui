/**
 * TdsReconFlagsPanel  (Phase TDS-3)
 *
 * Review UI for reconciliation flags raised by tds-recon-engine.
 * Features:
 *   • "Run Reconciliation" button — invokes tds-recon-engine (Goal 1 + 2)
 *   • Summary KPI strip with 4 flag-type counts + pending/actioned status
 *   • Goal filter tabs: All | Goal 1: Existence | Goal 2: Rate Analysis
 *   • Status filter: Pending | Query Raised | Accepted | Disregarded
 *   • Expandable table rows with full AI reasoning + narration evidence
 *   • Per-row actions: Raise Query (dialog) | Accept | Disregard
 */
import { useState, useCallback } from "react";
import { Button }   from "@/components/ui/button";
import { runReconEngine } from "./tdsEngine";
import { Badge }    from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  GitCompareArrows, Calculator, AlertTriangle, TrendingDown,
  TrendingUp, Loader2, RefreshCw, Info, ChevronDown, ChevronRight,
  MessageSquareWarning, CheckCircle, XCircle, BookText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useTdsReconFlags, FlagStatus, FlagType, TdsReconFlag,
} from "./hooks/useTdsReconFlags";

// ─── Flag type meta ───────────────────────────────────────────────────────────

const FLAG_META: Record<FlagType, {
  label: string; shortLabel: string;
  icon: React.ReactNode; color: string; goalNum: number;
}> = {
  entry_in_books_not_in_tds: {
    label: "In Books, Not in TDS",
    shortLabel: "Books > TDS",
    icon: <AlertTriangle size={12} />,
    color: "text-orange-700 bg-orange-50 border-orange-200",
    goalNum: 1,
  },
  entry_in_tds_not_in_books: {
    label: "In TDS, Not in Books",
    shortLabel: "TDS > Books",
    icon: <BookText size={12} />,
    color: "text-purple-700 bg-purple-50 border-purple-200",
    goalNum: 1,
  },
  short_deduction: {
    label: "Short Deduction",
    shortLabel: "Short TDS",
    icon: <TrendingDown size={12} />,
    color: "text-red-700 bg-red-50 border-red-200",
    goalNum: 2,
  },
  over_deduction: {
    label: "Over Deduction",
    shortLabel: "Over TDS",
    icon: <TrendingUp size={12} />,
    color: "text-amber-700 bg-amber-50 border-amber-200",
    goalNum: 2,
  },
  missing_tds_obligation: {
    label: "Missing TDS Obligation",
    shortLabel: "Missing TDS",
    icon: <AlertTriangle size={12} />,
    color: "text-rose-700 bg-rose-50 border-rose-200",
    goalNum: 3,
  },
};

const STATUS_META: Record<FlagStatus, { label: string; className: string }> = {
  pending:      { label: "Pending",      className: "bg-slate-100 text-slate-700 border-slate-200" },
  query_raised: { label: "Query Raised", className: "bg-blue-100  text-blue-700  border-blue-200"  },
  accepted:     { label: "Accepted",     className: "bg-green-100 text-green-700 border-green-200" },
  disregarded:  { label: "Disregarded",  className: "bg-muted     text-muted-foreground border"    },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number | null | undefined, signed = false): string {
  if (n == null) return "—";
  const abs = Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  if (signed) return n < 0 ? `-₹${abs}` : `+₹${abs}`;
  return `₹${abs}`;
}

function FlagTypePill({ type }: { type: FlagType }) {
  const m = FLAG_META[type];
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium",
      m?.color,
    )}>
      {m?.icon}
      {m?.shortLabel ?? type}
    </span>
  );
}

function StatusPill({ status }: { status: FlagStatus }) {
  const m = STATUS_META[status] ?? STATUS_META["pending"];
  return (
    <span className={cn("inline-flex px-1.5 py-0.5 rounded border text-[10px] font-medium", m.className)}>
      {m.label}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number | null }) {
  const v = value ?? 0;
  const color = v >= 80 ? "bg-red-500" : v >= 65 ? "bg-orange-400" : "bg-amber-400";
  return (
    <div className="flex items-center gap-1.5 w-20">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-6">{v}%</span>
    </div>
  );
}

// ─── KPI strip chip ───────────────────────────────────────────────────────────
function TypeChip({
  label, count, icon, colorClass, active, onClick,
}: {
  label: string; count: number; icon: React.ReactNode;
  colorClass: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all",
        colorClass,
        active && "ring-2 ring-offset-1 ring-current",
      )}
    >
      {icon}
      <span className="font-bold">{count}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ─── Raise Query dialog ───────────────────────────────────────────────────────
function RaiseQueryDialog({
  flag, open, onClose, onConfirm, saving,
}: {
  flag: TdsReconFlag | null;
  open: boolean; onClose: () => void;
  onConfirm: (note: string) => void;
  saving: boolean;
}) {
  const [note, setNote] = useState("");

  if (!flag) return null;

  // Pre-fill with AI reasoning as the query draft
  const defaultNote = flag.ai_reasoning ?? "";
  const effectiveNote = note || defaultNote;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <MessageSquareWarning size={16} className="text-orange-500" />
            Raise Query for TDS Flag
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2 p-2 bg-muted/40 rounded">
            <div>
              <span className="text-muted-foreground">TB Ledger</span>
              <p className="font-medium truncate">{flag.tb_ledger_name ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">TDS Deductee</span>
              <p className="font-medium truncate">{flag.tds_deductee_name ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Flag Type</span>
              <FlagTypePill type={flag.flag_type} />
            </div>
            <div>
              <span className="text-muted-foreground">Variance</span>
              <p className={cn(
                "font-semibold",
                (flag.variance_amount ?? 0) > 0 ? "text-red-600" : "text-amber-600",
              )}>
                {fmtINR(flag.variance_amount, true)}
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">
              Query text (pre-filled from AI reasoning — edit as needed)
            </label>
            <Textarea
              value={note || defaultNote}
              onChange={e => setNote(e.target.value)}
              className="min-h-[100px] text-xs"
              placeholder="Describe the query for the client…"
            />
          </div>

          {flag.sample_narrations && flag.sample_narrations.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground font-medium">Sample Voucher Evidence</p>
              {flag.sample_narrations.map((n, i) => (
                <p key={i} className="text-[10px] text-muted-foreground italic border-l-2 border-muted pl-2">
                  {n}
                </p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            size="sm"
            className="bg-orange-600 hover:bg-orange-700 text-white gap-1"
            onClick={() => onConfirm(effectiveNote)}
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

// ─── Flag detail row ──────────────────────────────────────────────────────────
function FlagRow({
  flag,
  onRaiseQuery,
  onAccept,
  onDisregard,
  saving,
}: {
  flag: TdsReconFlag;
  onRaiseQuery: (f: TdsReconFlag) => void;
  onAccept: (id: string) => void;
  onDisregard: (id: string) => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPending = flag.flag_status === "pending";

  return (
    <div className="hover:bg-muted/10 transition-colors">
      {/* Main row */}
      <div className="grid grid-cols-[1fr_1fr_72px_80px_90px_80px_160px] gap-2 items-center px-4 py-2.5">

        {/* TB Ledger */}
        <div>
          <p className="text-xs font-medium truncate" title={flag.tb_ledger_name ?? ""}>
            {flag.tb_ledger_name ?? "—"}
          </p>
        </div>

        {/* TDS Deductee */}
        <div>
          <p className="text-xs truncate" title={flag.tds_deductee_name ?? ""}>
            {flag.tds_deductee_name ?? "—"}
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

        {/* Flag type */}
        <FlagTypePill type={flag.flag_type} />

        {/* Key number */}
        <div className="text-right">
          {flag.goal_number === 1 ? (
            <div>
              <p className={cn(
                "text-xs font-semibold tabular-nums",
                (flag.variance_amount ?? 0) > 0 ? "text-orange-600" : "text-purple-600",
              )}>
                {fmtINR(flag.variance_amount, true)}
              </p>
              <p className="text-[10px] text-muted-foreground">gap</p>
            </div>
          ) : (
            <div>
              <p className={cn(
                "text-xs font-semibold tabular-nums",
                (flag.variance_amount ?? 0) > 0 ? "text-red-600" : "text-amber-600",
              )}>
                {fmtINR(flag.variance_amount, true)}
              </p>
              <p className="text-[10px] text-muted-foreground">TDS gap</p>
            </div>
          )}
        </div>

        {/* Confidence */}
        <ConfidenceBar value={flag.ai_confidence} />

        {/* Status + Actions */}
        <div className="flex flex-col gap-1 items-start">
          <StatusPill status={flag.flag_status} />
          <div className="flex items-center gap-1">
            {isPending && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="p-0.5 rounded text-orange-500 hover:bg-orange-50 disabled:opacity-40"
                      onClick={() => onRaiseQuery(flag)}
                      disabled={saving}
                    >
                      <MessageSquareWarning size={13} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Raise query to client</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="p-0.5 rounded text-green-600 hover:bg-green-50 disabled:opacity-40"
                      onClick={() => onAccept(flag.id)}
                      disabled={saving}
                    >
                      <CheckCircle size={13} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Accept flag (valid finding)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="p-0.5 rounded text-muted-foreground hover:bg-muted/50 disabled:opacity-40"
                      onClick={() => onDisregard(flag.id)}
                      disabled={saving}
                    >
                      <XCircle size={13} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Disregard (not applicable)</TooltipContent>
                </Tooltip>
              </>
            )}
            {flag.ai_reasoning && (
              <button
                type="button"
                className="p-0.5 rounded text-muted-foreground hover:bg-muted/50"
                onClick={() => setExpanded(e => !e)}
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            )}
          </div>
          {flag.action_note && !expanded && (
            <p className="text-[9px] text-muted-foreground italic truncate max-w-[140px]" title={flag.action_note}>
              {flag.action_note}
            </p>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">

          {/* Amount breakdown */}
          {flag.goal_number === 1 ? (
            <div className="grid grid-cols-3 gap-2 p-2.5 bg-muted/30 rounded text-xs">
              <div>
                <p className="text-muted-foreground text-[10px]">Book Amount (TB)</p>
                <p className="font-semibold">{fmtINR(flag.book_amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[10px]">TDS Module Amount</p>
                <p className="font-semibold">{fmtINR(flag.tds_amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[10px]">Variance</p>
                <p className={cn(
                  "font-bold",
                  (flag.variance_amount ?? 0) > 0 ? "text-orange-600" : "text-purple-600",
                )}>
                  {fmtINR(flag.variance_amount, true)}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 p-2.5 bg-muted/30 rounded text-xs">
              <div>
                <p className="text-muted-foreground text-[10px]">Amount Paid</p>
                <p className="font-semibold">{fmtINR(flag.book_amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[10px]">Expected TDS ({flag.expected_rate?.toFixed(1)}%)</p>
                <p className="font-semibold">{fmtINR(flag.expected_tds)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[10px]">Actual TDS ({flag.actual_rate?.toFixed(2)}%)</p>
                <p className="font-semibold">{fmtINR(flag.actual_tds)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[10px]">Short / Over</p>
                <p className={cn(
                  "font-bold",
                  (flag.variance_amount ?? 0) > 0 ? "text-red-600" : "text-amber-600",
                )}>
                  {fmtINR(flag.variance_amount, true)}
                </p>
              </div>
            </div>
          )}

          {/* AI Reasoning */}
          {flag.ai_reasoning && (
            <div className="flex gap-2 items-start p-2.5 bg-blue-50/50 rounded border border-blue-100 text-xs text-blue-800">
              <Info size={12} className="flex-shrink-0 mt-0.5" />
              <p>{flag.ai_reasoning}</p>
            </div>
          )}

          {/* Sample narrations */}
          {flag.sample_narrations && flag.sample_narrations.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground">Voucher Evidence</p>
              {flag.sample_narrations.map((n, i) => (
                <p key={i} className="text-[10px] text-muted-foreground italic border-l-2 border-blue-200 pl-2">{n}</p>
              ))}
            </div>
          )}

          {/* Action note */}
          {flag.action_note && (
            <p className="text-[11px] text-muted-foreground italic">Note: {flag.action_note}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type GoalFilter    = "all" | 1 | 2;
type StatusFilter  = FlagStatus | "all";

interface Props {
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
}

export function TdsReconFlagsPanel({ clientId, financialYear }: Props) {
  const {
    flags, loading, error, counts, firmId,
    refresh, updateFlagStatus,
  } = useTdsReconFlags(clientId, financialYear);

  const [running,      setRunning]      = useState(false);
  const [goalFilter,   setGoalFilter]   = useState<GoalFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter,   setTypeFilter]   = useState<FlagType | "all">("all");
  const [savingId,     setSavingId]     = useState<string | null>(null);
  const [queryFlag,    setQueryFlag]    = useState<TdsReconFlag | null>(null);
  const [queryNote,    setQueryNote]    = useState("");

  // ── Run reconciliation engine ────────────────────────────────────────────────
  const runRecon = useCallback(async (goals: number[] = [1, 2]) => {
    if (!clientId || !financialYear || !firmId) {
      toast.error("Cannot run — missing client, FY, or firm context");
      return;
    }
    setRunning(true);
    try {
      const r = await runReconEngine({ client_id: clientId, financial_year: financialYear, firm_id: firmId, goals, rerun: true });
      if (r.message && r.flags_created === 0) {
        toast.info(r.message);
      } else {
        toast.success(
          `Reconciliation complete: ${r.flags_created} new flags ` +
          `(${r.goal1_flags} existence, ${r.goal2_flags} rate) ` +
          `across ${r.mappings_analysed ?? "?"} confirmed mappings.` +
          (r.flags_preserved ? ` ${r.flags_preserved} actioned flags preserved.` : ""),
        );
      }
      refresh();
    } catch (err: unknown) {
      toast.error(`Recon failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }, [clientId, financialYear, firmId, refresh]);

  // ── Filter flags ─────────────────────────────────────────────────────────────
  const visible = flags.filter(f => {
    if (goalFilter   !== "all" && f.goal_number !== goalFilter)   return false;
    if (statusFilter !== "all" && f.flag_status !== statusFilter) return false;
    if (typeFilter   !== "all" && f.flag_type   !== typeFilter)   return false;
    return true;
  });

  // ── Row actions ──────────────────────────────────────────────────────────────
  const handleAccept = async (id: string) => {
    setSavingId(id);
    try { await updateFlagStatus(id, "accepted");    toast.success("Flag accepted"); }
    catch (e: unknown) { toast.error(String(e)); }
    finally { setSavingId(null); }
  };

  const handleDisregard = async (id: string) => {
    setSavingId(id);
    try { await updateFlagStatus(id, "disregarded"); toast.success("Flag disregarded"); }
    catch (e: unknown) { toast.error(String(e)); }
    finally { setSavingId(null); }
  };

  const handleRaiseQuery = async (note: string) => {
    if (!queryFlag) return;
    setSavingId(queryFlag.id);
    try {
      await updateFlagStatus(queryFlag.id, "query_raised", { note });
      setQueryFlag(null);
      setQueryNote("");
      toast.success("Query raised — flag status updated");
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setSavingId(null);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">

        {/* Flag type KPI strip */}
        <div className="flex flex-wrap items-center gap-2">
          <TypeChip
            label="All Flags"   count={counts.total}
            icon={<GitCompareArrows size={11} />}
            colorClass="bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
            active={typeFilter === "all"} onClick={() => setTypeFilter("all")}
          />
          <TypeChip
            label="Books > TDS" count={counts.in_books_not_tds}
            icon={<AlertTriangle size={11} />}
            colorClass="bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"
            active={typeFilter === "entry_in_books_not_in_tds"}
            onClick={() => setTypeFilter(typeFilter === "entry_in_books_not_in_tds" ? "all" : "entry_in_books_not_in_tds")}
          />
          <TypeChip
            label="TDS > Books"  count={counts.in_tds_not_books}
            icon={<BookText size={11} />}
            colorClass="bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
            active={typeFilter === "entry_in_tds_not_in_books"}
            onClick={() => setTypeFilter(typeFilter === "entry_in_tds_not_in_books" ? "all" : "entry_in_tds_not_in_books")}
          />
          <TypeChip
            label="Short TDS"   count={counts.short_deduction}
            icon={<TrendingDown size={11} />}
            colorClass="bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
            active={typeFilter === "short_deduction"}
            onClick={() => setTypeFilter(typeFilter === "short_deduction" ? "all" : "short_deduction")}
          />
          <TypeChip
            label="Over TDS"    count={counts.over_deduction}
            icon={<TrendingUp size={11} />}
            colorClass="bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
            active={typeFilter === "over_deduction"}
            onClick={() => setTypeFilter(typeFilter === "over_deduction" ? "all" : "over_deduction")}
          />
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="ghost" className="h-7 text-xs gap-1"
            onClick={refresh} disabled={loading}
          >
            <RefreshCw size={11} className={cn(loading && "animate-spin")} />
          </Button>
          <Button
            size="sm" variant="outline"
            className="h-7 text-xs gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
            onClick={() => runRecon([1])} disabled={running || !firmId}
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <GitCompareArrows size={11} />}
            Goal 1 Only
          </Button>
          <Button
            size="sm" variant="outline"
            className="h-7 text-xs gap-1.5 border-red-200 text-red-700 hover:bg-red-50"
            onClick={() => runRecon([2])} disabled={running || !firmId}
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <Calculator size={11} />}
            Goal 2 Only
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5 bg-blue-700 hover:bg-blue-800 text-white"
            onClick={() => runRecon([1, 2])} disabled={running || !firmId}
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <GitCompareArrows size={11} />}
            {running ? "Running…" : "Run Reconciliation"}
          </Button>
        </div>
      </div>

      {/* ── Goal + Status filter tabs ── */}
      <div className="flex flex-wrap items-center gap-4 border-b pb-2">
        {/* Goal tabs */}
        <div className="flex gap-0 text-xs">
          {([["all", "All Goals"], [1, "Goal 1: Existence"], [2, "Goal 2: Rate"]] as const).map(([g, lbl]) => (
            <button
              key={String(g)}
              type="button"
              onClick={() => setGoalFilter(g as GoalFilter)}
              className={cn(
                "px-3 py-1 border-b-2 -mb-[2px] transition-colors",
                goalFilter === g
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {lbl}
              {g !== "all" && (
                <span className="ml-1 text-[10px] tabular-nums">
                  ({g === 1 ? counts.goal1 : counts.goal2})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1 ml-auto">
          {(["all", "pending", "query_raised", "accepted", "disregarded"] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] border transition-colors",
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground border-muted hover:border-foreground/30",
              )}
            >
              {s === "all" ? "All" : s === "query_raised" ? "Query Raised" : s.charAt(0).toUpperCase() + s.slice(1)}
              {s !== "all" && (
                <span className="ml-1">
                  ({s === "pending" ? counts.pending :
                    s === "query_raised" ? counts.query_raised :
                    s === "accepted"     ? counts.accepted :
                    counts.disregarded})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading flags…
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && flags.length === 0 && (
        <div className="flex flex-col items-center justify-center h-52 gap-3 text-center border rounded-lg border-dashed">
          <GitCompareArrows size={32} className="text-muted-foreground/25" />
          <div>
            <p className="text-sm font-medium text-foreground">No reconciliation flags yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              First confirm party mappings in the <strong>Party Mappings</strong> tab, then click{" "}
              <strong>Run Reconciliation</strong> to analyse existence gaps and rate discrepancies.
            </p>
          </div>
        </div>
      )}

      {/* ── Flags table ── */}
      {!loading && flags.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_1fr_72px_80px_90px_80px_160px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30 border-b">
            <span>TB Ledger</span>
            <span>TDS Deductee</span>
            <span>Section</span>
            <span>Flag Type</span>
            <span className="text-right">Variance</span>
            <span>Confidence</span>
            <span>Status / Actions</span>
          </div>

          <div className="divide-y">
            {visible.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No flags match the current filter.
              </div>
            ) : (
              visible.map(f => (
                <FlagRow
                  key={f.id}
                  flag={f}
                  onRaiseQuery={flag => { setQueryFlag(flag); setQueryNote(""); }}
                  onAccept={handleAccept}
                  onDisregard={handleDisregard}
                  saving={savingId === f.id}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      {!loading && flags.length > 0 && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {counts.pending} pending · {counts.actioned} actioned
          </span>
          <span>Showing {visible.length} of {flags.length} flags</span>
        </div>
      )}

      {/* ── Raise Query dialog ── */}
      <RaiseQueryDialog
        flag={queryFlag}
        open={!!queryFlag}
        onClose={() => { setQueryFlag(null); setQueryNote(""); }}
        onConfirm={handleRaiseQuery}
        saving={!!savingId}
      />
    </div>
    </TooltipProvider>
  );
}
