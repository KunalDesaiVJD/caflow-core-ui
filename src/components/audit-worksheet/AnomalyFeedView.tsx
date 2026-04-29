/**
 * AnomalyFeedView — Phase 2B
 *
 * Renders the anomaly feed inside the Ledger Explorer tab.
 * Fetches Tally vouchers + TB, runs the 8-rule anomaly engine,
 * and displays results with filter chips, severity counts, and
 * per-flag action buttons (View Details / Raise Query).
 */
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge  } from "@/components/ui/badge";
import {
  Loader2, Zap, AlertTriangle, RefreshCw,
  MessageSquareWarning, ChevronDown, ChevronRight,
  Info, BookOpen, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  runAnomalyDetection,
  ANOMALY_META,
  SEV_META,
  AnomalyType,
  AnomalySeverity,
  AnomalyFlag,
  VoucherRow,
  TBRow,
} from "@/lib/anomalyEngine";
import { LedgerSidePanel }    from "./LedgerSidePanel";
import { getDraftSuggestion } from "./QueryDraftEngine";
import { cleanTallyName }     from "@/lib/tallyText";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  tallyEngId:      string | null | undefined;
  financialYear:   string | null | undefined;
  /** Phase 2C: needed to open LedgerSidePanel from anomaly card */
  clientId?:       string | null | undefined;
  onRaiseQuery:    (group: string, ledger: string, note?: string) => void;
  /** Phase 5: raise a formal finding from an anomaly */
  onRaiseFinding?: (group: string, ledger: string, note?: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmt(n: number): string {
  return Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityDot({ sev }: { sev: AnomalySeverity }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full flex-shrink-0",
        SEV_META[sev].dot,
      )}
      title={SEV_META[sev].label}
    />
  );
}

function RuleBadge({ type }: { type: AnomalyType }) {
  const m = ANOMALY_META[type];
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap",
        m.color, m.textColor,
      )}
    >
      {m.label}
    </span>
  );
}

function SummaryBar({
  total, high, medium, low, scannedAt, totalVouchers,
}: {
  total: number; high: number; medium: number; low: number;
  scannedAt: string; totalVouchers: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg border bg-muted/30 text-xs">
      <span className="font-semibold">{total} anomalies</span>
      <span className="text-muted-foreground">in {totalVouchers.toLocaleString()} vouchers</span>
      {high > 0 && (
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
          <span className="font-medium text-red-700">{high} High</span>
        </span>
      )}
      {medium > 0 && (
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
          <span className="font-medium text-amber-700">{medium} Medium</span>
        </span>
      )}
      {low > 0 && (
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
          <span className="font-medium text-blue-700">{low} Low</span>
        </span>
      )}
      <span className="ml-auto text-[10px] text-muted-foreground">
        Scanned {new Date(scannedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

// ─── Single anomaly card ──────────────────────────────────────────────────────

function AnomalyCard({
  flag,
  onRaiseQuery,
  onViewLedger,
  onRaiseFinding,
}: {
  flag: AnomalyFlag;
  onRaiseQuery:    (group: string, ledger: string, note?: string) => void;
  onViewLedger:    (ledger: string, group: string) => void;
  onRaiseFinding?: (group: string, ledger: string, note?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      "border rounded-lg overflow-hidden transition-shadow",
      flag.severity === "high"   && "border-red-200 bg-red-50/30",
      flag.severity === "medium" && "border-amber-200 bg-amber-50/20",
      flag.severity === "low"    && "border-blue-200 bg-blue-50/10",
    )}>
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Severity dot */}
        <SeverityDot sev={flag.severity} />

        {/* Rule badge */}
        <RuleBadge type={flag.flag_type} />

        {/* Ledger name */}
        <span className="text-xs font-medium flex-1 truncate min-w-0" title={flag.ledger_name}>
          {flag.ledger_name || flag.voucher_type}
        </span>

        {/* Amount */}
        <span className={cn(
          "text-xs font-semibold tabular-nums whitespace-nowrap",
          flag.dr_cr === "Dr" ? "text-blue-700" : "text-rose-600",
        )}>
          ₹{fmtAmt(flag.amount)}
          <span className="text-[10px] font-normal ml-0.5">{flag.dr_cr}</span>
        </span>

        {/* Date */}
        <span className="text-[10px] text-muted-foreground tabular-nums w-20 text-right">
          {fmtDate(flag.voucher_date)}
        </span>

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => setExpanded(p => !p)}
            className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground"
            title="Toggle details"
          >
            {expanded
              ? <ChevronDown size={12} />
              : <ChevronRight size={12} />}
          </button>
          {(flag.ledger_name || flag.voucher_type) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] gap-0.5 text-blue-600 hover:bg-blue-50 hover:text-blue-700 flex-shrink-0"
              title="View ledger entries"
              onClick={() => onViewLedger(
                flag.ledger_name || flag.voucher_type || "",
                flag.parent_group,
              )}
            >
              <BookOpen size={10} />
              <span>View</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px] gap-0.5 text-orange-600 hover:bg-orange-50 hover:text-orange-700 flex-shrink-0"
            onClick={() => onRaiseQuery(
              flag.parent_group,
              flag.ledger_name || flag.voucher_type || "",
              /* Phase 4D: pre-drafted professional query text */
              getDraftSuggestion(
                flag.parent_group,
                flag.ledger_name || flag.voucher_type || "",
                flag.flag_type,
                {
                  amount: Math.abs(flag.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                  date:   flag.voucher_date,
                },
              ),
            )}
          >
            <MessageSquareWarning size={10} />
            <span>Query</span>
          </Button>
          {/* Phase 5: Raise formal finding */}
          {onRaiseFinding && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] gap-0.5 text-purple-600 hover:bg-purple-50 hover:text-purple-700 flex-shrink-0"
              title="Raise a formal audit finding"
              onClick={() => onRaiseFinding(
                flag.parent_group,
                flag.ledger_name || flag.voucher_type || "",
                getDraftSuggestion(
                  flag.parent_group,
                  flag.ledger_name || flag.voucher_type || "",
                  flag.flag_type,
                  {
                    amount: Math.abs(flag.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    date:   flag.voucher_date,
                  },
                ),
              )}
            >
              <ShieldAlert size={10} />
              <span>Finding</span>
            </Button>
          )}
        </div>
      </div>

      {/* Expanded detail row */}
      {expanded && (
        <div className="px-3 pb-2.5 pt-1 border-t bg-muted/10 space-y-1">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
            {flag.voucher_number && (
              <span><span className="font-medium text-foreground">Voucher:</span> {flag.voucher_number}</span>
            )}
            {flag.voucher_type && (
              <span><span className="font-medium text-foreground">Type:</span> {flag.voucher_type}</span>
            )}
            {flag.parent_group && (
              <span><span className="font-medium text-foreground">Group:</span> {flag.parent_group}</span>
            )}
          </div>
          <p className="text-[11px] text-foreground leading-snug">
            <Info size={10} className="inline mr-1 text-muted-foreground" />
            {flag.flag_detail}
          </p>
          {flag.narration && (
            <p className="text-[11px] text-muted-foreground italic">
              Narration: {flag.narration}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AnomalyFeedView({ tallyEngId, financialYear, clientId, onRaiseQuery, onRaiseFinding }: Props) {
  const [vouchers,  setVouchers]  = useState<VoucherRow[]>([]);
  const [tb,        setTb]        = useState<TBRow[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [scanDone,  setScanDone]  = useState(false);

  // Phase 2C: LedgerSidePanel state
  const [panelLedger, setPanelLedger] = useState<{ name: string; group: string } | null>(null);

  // Filter state
  const [sevFilter,  setSevFilter]  = useState<AnomalySeverity | "all">("all");
  const [typeFilter, setTypeFilter] = useState<AnomalyType | "all">("all");

  // Fetch data & run engine
  const runScan = async () => {
    if (!tallyEngId || !financialYear) return;
    setLoading(true);
    setScanDone(false);
    try {
      const [vRes, tbRes] = await Promise.all([
        (supabase as any)
          .from("tally_vouchers")
          .select("id,voucher_date,voucher_type,voucher_number,party_ledger,amount,dr_cr,narration,line_items")
          .eq("engagement_id", tallyEngId)
          .limit(10000),
        (supabase as any)
          .from("tally_trial_balance")
          .select("ledger_name,parent_group,closing_balance,balance_type")
          .eq("engagement_id", tallyEngId),
      ]);

      const cleanedTb = ((tbRes.data as TBRow[]) ?? []).map(r => ({
        ...r,
        ledger_name:  cleanTallyName(r.ledger_name),
        parent_group: cleanTallyName(r.parent_group),
      }));
      const cleanedVouchers = ((vRes.data as VoucherRow[]) ?? []).map(v => ({
        ...v,
        party_ledger: cleanTallyName((v as any).party_ledger),
      }));
      setVouchers(cleanedVouchers);
      setTb(cleanedTb);
    } finally {
      setLoading(false);
      setScanDone(true);
    }
  };

  // Auto-run once tallyEngId is available
  useEffect(() => {
    if (tallyEngId && financialYear && !scanDone && !loading) {
      runScan();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tallyEngId, financialYear]);

  // Run engine only when data is ready
  const report = useMemo(() => {
    if (!scanDone || vouchers.length === 0) return null;
    return runAnomalyDetection(vouchers, tb, financialYear ?? "2025-26");
  }, [vouchers, tb, financialYear, scanDone]);

  // Severity counts
  const counts = useMemo(() => {
    if (!report) return { high: 0, medium: 0, low: 0 };
    return report.flags.reduce(
      (acc, f) => ({ ...acc, [f.severity]: acc[f.severity] + 1 }),
      { high: 0, medium: 0, low: 0 },
    );
  }, [report]);

  // Active rule types from results
  const activeTypes = useMemo((): AnomalyType[] => {
    if (!report) return [];
    const s = new Set<AnomalyType>(report.flags.map(f => f.flag_type));
    return Array.from(s);
  }, [report]);

  // Phase 2C: all flagged voucher IDs (for highlighting in LedgerSidePanel)
  const flaggedVoucherIds = useMemo(
    () => new Set<string>((report?.flags ?? []).map(f => f.voucher_id)),
    [report],
  );

  // Filtered flags
  const visible = useMemo(() => {
    if (!report) return [];
    return report.flags.filter(f => {
      if (sevFilter  !== "all" && f.severity  !== sevFilter)  return false;
      if (typeFilter !== "all" && f.flag_type !== typeFilter) return false;
      return true;
    });
  }, [report, sevFilter, typeFilter]);

  // ── Empty / loading states ───────────────────────────────────────────────────

  if (!tallyEngId) {
    return (
      <div className="flex flex-col items-center justify-center h-52 gap-3 text-center text-muted-foreground">
        <Zap size={36} className="text-muted-foreground/30" />
        <p className="text-sm">No Tally data synced yet — anomaly scan requires Tally voucher data.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        Scanning {vouchers.length > 0 ? `${vouchers.length.toLocaleString()} vouchers` : "Tally data"} for anomalies…
      </div>
    );
  }

  if (scanDone && vouchers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-52 gap-3 text-center text-muted-foreground">
        <AlertTriangle size={36} className="text-muted-foreground/30" />
        <p className="text-sm">No vouchers found in Tally data for this engagement.</p>
      </div>
    );
  }

  if (!scanDone || !report) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Preparing anomaly scan…
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* ── Top bar: summary + re-scan ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <SummaryBar
          total={report.flags.length}
          high={counts.high}
          medium={counts.medium}
          low={counts.low}
          scannedAt={report.scannedAt}
          totalVouchers={report.totalVouchers}
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1 ml-auto flex-shrink-0"
          onClick={runScan}
          disabled={loading}
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          Re-scan
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">

        {/* Severity filter */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide mr-0.5">Severity</span>
          {(["all", "high", "medium", "low"] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSevFilter(s)}
              className={cn(
                "h-6 px-2 rounded text-[10px] font-medium border transition-colors",
                sevFilter === s
                  ? "bg-foreground text-background border-foreground"
                  : "text-muted-foreground hover:bg-muted/60 border-transparent",
              )}
            >
              {s === "all" ? "All" : SEV_META[s].label}
              {s !== "all" && counts[s] > 0 && (
                <span className="ml-1 opacity-70">{counts[s]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Rule type filter */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide mr-0.5">Rule</span>
          <button
            type="button"
            onClick={() => setTypeFilter("all")}
            className={cn(
              "h-6 px-2 rounded text-[10px] font-medium border transition-colors",
              typeFilter === "all"
                ? "bg-foreground text-background border-foreground"
                : "text-muted-foreground hover:bg-muted/60 border-transparent",
            )}
          >
            All rules
          </button>
          {activeTypes.map(t => {
            const m = ANOMALY_META[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "h-6 px-2 rounded text-[10px] font-medium border transition-colors",
                  typeFilter === t
                    ? cn(m.color, m.textColor, "border-current")
                    : "text-muted-foreground hover:bg-muted/60 border-transparent",
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Result count ── */}
      {(sevFilter !== "all" || typeFilter !== "all") && (
        <p className="text-[11px] text-muted-foreground">
          Showing {visible.length} of {report.flags.length} anomalies
          {visible.length === 0 && " — try a different filter"}
        </p>
      )}

      {/* ── Anomaly cards ── */}
      {visible.length === 0 && sevFilter === "all" && typeFilter === "all" ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center text-muted-foreground rounded-lg border border-dashed">
          <Zap size={36} className="text-green-400" />
          <div>
            <p className="font-medium text-sm text-foreground">No anomalies detected</p>
            <p className="text-xs mt-1">
              Scanned {report.totalVouchers.toLocaleString()} vouchers against 8 rules — all clear.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map(flag => (
            <AnomalyCard
              key={flag.id}
              flag={flag}
              onRaiseQuery={onRaiseQuery}
              onViewLedger={(ledger, group) => setPanelLedger({ name: ledger, group })}
              onRaiseFinding={onRaiseFinding}
            />
          ))}
        </div>
      )}

      {/* ── Ledger side panel (Phase 2C) ── */}
      <LedgerSidePanel
        open={!!panelLedger}
        ledgerName={panelLedger?.name ?? ""}
        parentGroup={panelLedger?.group ?? ""}
        clientId={clientId}
        financialYear={financialYear}
        flaggedVoucherIds={flaggedVoucherIds}
        onClose={() => setPanelLedger(null)}
        onRaiseQuery={(group, ledger, note) => {
          setPanelLedger(null);
          onRaiseQuery(group, ledger, note);
        }}
      />

      {/* ── Rule legend (collapsed info) ── */}
      <details className="group">
        <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground list-none flex items-center gap-1">
          <ChevronRight size={10} className="group-open:rotate-90 transition-transform" />
          8 anomaly rules explained
        </summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px] text-muted-foreground">
          {(Object.entries(ANOMALY_META) as [AnomalyType, typeof ANOMALY_META[AnomalyType]][]).map(([type, meta]) => (
            <div key={type} className={cn("px-2 py-1.5 rounded", meta.color)}>
              <span className={cn("font-semibold", meta.textColor)}>{meta.label}</span>
              <span className="mx-1 opacity-60">—</span>
              {meta.description}
            </div>
          ))}
        </div>
      </details>

    </div>
  );
}
