/**
 * TdsAiMemoryPanel
 *
 * Observability surface for the TDS Analytics learning engine
 * (supabase/migrations/20260807010000_tds_analytics_learning_engine.sql).
 * Lets the auditor verify — on demand, every time — that a manual action
 * they just took actually landed in AI memory, without having to trust it
 * blindly or query the database themselves.
 *
 *   • Recent Activity — every tds_learning_events row for this client,
 *     newest first. The direct answer to "was my last change saved?".
 *   • Learned Patterns — the aggregated tds_client_learned_patterns rows:
 *     what the engine currently recommends per vendor/ledger, how
 *     confident it is, and how many times that recommendation was
 *     confirmed vs. overridden. Disable toggle = safe rollback without
 *     losing history (row stays, just stops being suggested).
 *
 * Client-scoped only (learning is deliberately never pooled across
 * clients — see the migration header). Not financial_year-scoped: a
 * learned pattern is meant to generalize across years for the same
 * client, so this shows the full cross-year history.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Brain, RefreshCw, Loader2, History, Sparkles, Power, PowerOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LearningEvent {
  id: string;
  event_type: string;
  entity_type: string;
  pattern_type: string;
  pattern_key: string;
  before_value: any;
  after_value: any;
  ai_confidence: number | null;
  ai_method: string | null;
  source: string;
  financial_year: string;
  created_at: string;
}

interface LearnedPattern {
  id: string;
  pattern_type: string;
  pattern_key: string;
  current_value: any;
  confidence_score: number;
  times_seen: number;
  times_confirmed: number;
  times_overridden: number;
  alternatives: Array<{ value: any; count: number; last_seen_at: string }>;
  last_seen_at: string;
  is_active: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtValue(v: any): string {
  if (v == null) return "—";
  if (typeof v === "object") {
    // ledger_selection pattern (Phase 4 — cross-year carry-forward)
    if ("deductee_name" in v) {
      return `${v.deductee_name}${v.section_code ? ` (${v.section_code})` : ""}`;
    }
    if ("section" in v) return v.section ? String(v.section) : "(none)";
    return JSON.stringify(v);
  }
  return String(v);
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

// Strip the "vendor:" / "ledger:" prefix and trailing ":section" /
// ":vch:<type>" qualifier so the table reads as a plain vendor/ledger name.
function fmtPatternSubject(patternKey: string): string {
  return patternKey.replace(/^(vendor|ledger):/, "").split(":")[0];
}

const EVENT_LABELS: Record<string, string> = {
  party_mapping_change: "Party mapping changed",
  ledger_mapping_change: "Ledger mapping changed",
  section_override: "Section overridden",
  voucher_classification: "Voucher section set",
  reconciliation_correction: "Reconciliation corrected",
  calculation_adjustment: "Calculation adjusted",
  vendor_treatment_change: "Vendor treatment changed",
  entry_booking_correction: "Entry booking corrected",
  ai_suggestion_accepted: "AI suggestion accepted",
  ai_suggestion_rejected: "AI suggestion rejected",
  ai_suggestion_modified: "AI suggestion modified",
  manual_override: "Manually linked",
};

const SOURCE_META: Record<string, { label: string; className: string }> = {
  manual: { label: "Manual", className: "bg-slate-100 text-slate-700 border-slate-200" },
  ai_accepted: { label: "AI accepted", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  ai_overridden: { label: "AI overridden", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

function ConfidenceBar({ value }: { value: number | null }) {
  const v = value ?? 0;
  const color = v >= 80 ? "bg-green-500" : v >= 60 ? "bg-amber-500" : v >= 40 ? "bg-orange-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5 w-24">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">{v.toFixed(0)}%</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
}

type SubTab = "activity" | "patterns";

export function TdsAiMemoryPanel({ clientId, financialYear }: Props) {
  const [subTab,   setSubTab]   = useState<SubTab>("activity");
  const [events,   setEvents]   = useState<LearningEvent[]>([]);
  const [patterns, setPatterns] = useState<LearnedPattern[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) { setEvents([]); setPatterns([]); return; }
    setLoading(true); setError(null);
    try {
      const [evRes, patRes] = await Promise.all([
        (supabase as any)
          .from("tds_learning_events")
          .select("id,event_type,entity_type,pattern_type,pattern_key,before_value,after_value,ai_confidence,ai_method,source,financial_year,created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(200),
        (supabase as any)
          .from("tds_client_learned_patterns")
          .select("id,pattern_type,pattern_key,current_value,confidence_score,times_seen,times_confirmed,times_overridden,alternatives,last_seen_at,is_active")
          .eq("client_id", clientId)
          .order("confidence_score", { ascending: false }),
      ]);
      if (evRes.error) throw evRes.error;
      if (patRes.error) throw patRes.error;
      setEvents((evRes.data ?? []) as LearningEvent[]);
      setPatterns((patRes.data ?? []) as LearnedPattern[]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load AI memory");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const togglePattern = async (p: LearnedPattern) => {
    setTogglingId(p.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const nextActive = !p.is_active;
      const { error: err } = await (supabase as any)
        .from("tds_client_learned_patterns")
        .update(nextActive
          ? { is_active: true, disabled_reason: null, disabled_by: null, disabled_at: null }
          : { is_active: false, disabled_by: user?.id ?? null, disabled_at: new Date().toISOString() },
        )
        .eq("id", p.id);
      if (err) throw err;
      setPatterns(prev => prev.map(x => x.id === p.id ? { ...x, is_active: nextActive } : x));
      toast.success(nextActive ? "Pattern re-enabled" : "Pattern disabled — no longer suggested, history kept");
    } catch (e: any) {
      toast.error(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setTogglingId(null);
    }
  };

  const activePatterns = patterns.filter(p => p.is_active).length;
  const avgConfidence = patterns.length
    ? patterns.reduce((s, p) => s + Number(p.confidence_score ?? 0), 0) / patterns.length
    : 0;
  const eventsToday = events.filter(e => {
    const d = new Date(e.created_at);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;

  return (
    <TooltipProvider>
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Brain size={13} className="text-purple-600" /> AI Memory
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Every manual action captured for this client, and what the learning engine currently recommends from it.
            Never shared across clients.
          </p>
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => load()} disabled={loading}>
          <RefreshCw size={11} className={cn(loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-2 p-3 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 rounded-lg">
        <div className="text-center">
          <div className="text-lg font-bold text-slate-700 leading-tight">{events.length}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Actions captured</div>
        </div>
        <div className="text-center border-l border-purple-100">
          <div className="text-lg font-bold text-slate-700 leading-tight">{eventsToday}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Captured today</div>
        </div>
        <div className="text-center border-l border-purple-100">
          <div className="text-lg font-bold text-slate-700 leading-tight">
            {patterns.length} <span className="text-[11px] font-normal text-muted-foreground">({activePatterns} active)</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Learned patterns</div>
        </div>
        <div className="text-center border-l border-purple-100">
          <div className="text-lg font-bold text-slate-700 leading-tight">{avgConfidence.toFixed(0)}%</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Avg. confidence</div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-0 border-b">
        <button
          type="button"
          onClick={() => setSubTab("activity")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
            subTab === "activity" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <History size={12} /> Recent Activity
        </button>
        <button
          type="button"
          onClick={() => setSubTab("patterns")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
            subTab === "patterns" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Sparkles size={12} /> Learned Patterns
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
      )}

      {loading && events.length === 0 && patterns.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading AI memory…
        </div>
      ) : subTab === "activity" ? (
        events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-center text-muted-foreground border rounded-lg border-dashed">
            <History size={24} className="text-muted-foreground/30" />
            <p className="text-xs">No actions captured yet for this client. Confirm a mapping, override a section, or link a ledger — it'll show up here.</p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[110px_1fr_120px_120px_90px_90px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30 border-b">
              <span>When</span>
              <span>Vendor / Ledger</span>
              <span>Action</span>
              <span>Change</span>
              <span>Source</span>
              <span>FY</span>
            </div>
            <div className="divide-y max-h-[480px] overflow-y-auto">
              {events.map(e => {
                const meta = SOURCE_META[e.source] ?? SOURCE_META.manual;
                return (
                  <div key={e.id} className="grid grid-cols-[110px_1fr_120px_120px_90px_90px] gap-2 px-3 py-2 items-center text-xs hover:bg-muted/10">
                    <span className="text-[10px] text-muted-foreground tabular-nums">{fmtWhen(e.created_at)}</span>
                    <span className="font-medium truncate" title={e.pattern_key}>{fmtPatternSubject(e.pattern_key)}</span>
                    <span className="text-[10px] text-muted-foreground">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                    <span className="text-[10px] tabular-nums">
                      {e.before_value ? <span className="text-muted-foreground line-through mr-1">{fmtValue(e.before_value)}</span> : null}
                      <span className="font-medium">{fmtValue(e.after_value)}</span>
                    </span>
                    <span className={cn("inline-flex w-fit items-center px-1.5 py-0.5 rounded text-[9px] border font-medium", meta.className)}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">{e.financial_year}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : (
        patterns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-center text-muted-foreground border rounded-lg border-dashed">
            <Sparkles size={24} className="text-muted-foreground/30" />
            <p className="text-xs">No patterns learned yet — they build up automatically as actions are captured.</p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[1fr_100px_130px_100px_90px_70px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30 border-b">
              <span>Vendor / Ledger</span>
              <span>Recommends</span>
              <span>Confidence</span>
              <span>Confirmed / Overridden</span>
              <span>Last seen</span>
              <span>Active</span>
            </div>
            <div className="divide-y max-h-[480px] overflow-y-auto">
              {patterns.map(p => (
                <div key={p.id} className={cn(
                  "grid grid-cols-[1fr_100px_130px_100px_90px_70px] gap-2 px-3 py-2 items-center text-xs hover:bg-muted/10",
                  !p.is_active && "opacity-50",
                )}>
                  <div className="min-w-0">
                    <p className="font-medium truncate" title={p.pattern_key}>{fmtPatternSubject(p.pattern_key)}</p>
                    <p className="text-[9px] text-muted-foreground">{p.pattern_type.replace(/_/g, " ")}</p>
                  </div>
                  <span className="text-[11px] font-mono">{fmtValue(p.current_value)}</span>
                  <ConfidenceBar value={p.confidence_score} />
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    <span className="text-emerald-600">{p.times_confirmed}</span>
                    {" / "}
                    <span className="text-amber-600">{p.times_overridden}</span>
                    {p.alternatives?.length > 1 && (
                      <span className="ml-1 text-muted-foreground/70">({p.alternatives.length} options seen)</span>
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{fmtWhen(p.last_seen_at)}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "p-1 rounded self-start",
                          p.is_active ? "text-green-600 hover:bg-green-50" : "text-slate-400 hover:bg-slate-100",
                        )}
                        onClick={() => togglePattern(p)}
                        disabled={togglingId === p.id}
                      >
                        {togglingId === p.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : p.is_active ? <Power size={12} /> : <PowerOff size={12} />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      {p.is_active ? "Disable — stop suggesting, keep history" : "Re-enable this pattern"}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
    </TooltipProvider>
  );
}
