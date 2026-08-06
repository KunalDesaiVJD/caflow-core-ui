/**
 * TdsReconModule
 *
 * Three-tab shell for the TDS Analytics & Reconciliation sub-module.
 *
 *   Tab 1 — Party Mappings   (TDS-2) AI matching TB ledgers ↔ TDS deductees
 *   Tab 2 — Reconciliation   (TDS-3) Goal 1 existence + Goal 2 rate analysis
 *   Tab 3 — Missing TDS      (TDS-4) Goal 3 unmapped-ledger obligation scanner
 *
 * Header: live exposure KPI bar + Export TDS Report button.
 */
import { useState, useEffect, useCallback } from "react";
import { Link2, GitCompareArrows, AlertOctagon, Landmark, FileDown, Loader2, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { TdsPartyMappingPanel } from "./TdsPartyMappingPanel";
import { TdsReconFlagsPanel }  from "./TdsReconFlagsPanel";
import { TdsMissingPanel }     from "./TdsMissingPanel";
import { TdsDemandPanel }      from "./TdsDemandPanel";
import { TdsAiMemoryPanel }    from "./TdsAiMemoryPanel";
import { generateTdsReport }   from "./TdsReportGenerator";

type TdsTab = "mappings" | "recon" | "missing" | "demand" | "memory";

interface Props {
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
}

interface ExposureSummary {
  totalFlags:        number;
  pendingFlags:      number;
  goal1Flags:        number;
  goal2Flags:        number;
  goal3Flags:        number;
  estimatedExposure: number;
  shortVariance:     number;
  confirmedMappings: number;
  grandTotalDemand:  number;
}

const EMPTY_SUMMARY: ExposureSummary = {
  totalFlags: 0, pendingFlags: 0, goal1Flags: 0, goal2Flags: 0,
  goal3Flags: 0, estimatedExposure: 0, shortVariance: 0, confirmedMappings: 0,
  grandTotalDemand: 0,
};

const TABS: Array<{ id: TdsTab; label: string; icon: React.ReactNode; phase: string }> = [
  { id: "mappings", label: "Party Mappings",  icon: <Link2 size={13} />,           phase: "TDS-2" },
  { id: "recon",    label: "Reconciliation",  icon: <GitCompareArrows size={13} />, phase: "TDS-3" },
  { id: "missing",  label: "Missing TDS",     icon: <AlertOctagon size={13} />,     phase: "TDS-4" },
  { id: "demand",   label: "Demand Analysis", icon: <Landmark size={13} />,         phase: "TDS-6" },
  { id: "memory",   label: "AI Memory",       icon: <Brain size={13} />,            phase: "AI" },
];

function fmtINR(n: number): string {
  if (n === 0) return "₹0";
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)} Cr`;
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)} L`;
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)} K`;
  return `₹${n.toFixed(0)}`;
}

export function TdsReconModule({ clientId, financialYear }: Props) {
  const [activeTab,  setActiveTab]  = useState<TdsTab>("mappings");
  const [summary,    setSummary]    = useState<ExposureSummary>(EMPTY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [exporting,  setExporting]  = useState(false);

  // ── Load aggregate summary for KPI bar ──
  const loadSummary = useCallback(async () => {
    if (!clientId || !financialYear) return;
    setSummaryLoading(true);
    const [flagsRes, mapsRes, demandRes] = await Promise.all([
      (supabase as any)
        .from("tds_recon_flags")
        .select("goal_number,flag_type,flag_status,expected_tds,variance_amount")
        .eq("client_id", clientId)
        .eq("financial_year", financialYear),
      (supabase as any)
        .from("tds_tb_party_mappings")
        .select("mapping_status")
        .eq("client_id", clientId)
        .eq("financial_year", financialYear),
      (supabase as any)
        .from("tds_demand_items")
        .select("total_demand,item_status")
        .eq("client_id", clientId)
        .eq("financial_year", financialYear),
    ]);

    const flags:    any[] = flagsRes.data    ?? [];
    const mappings: any[] = mapsRes.data     ?? [];
    const demandItems: any[] = demandRes.data ?? [];

    const goal3 = flags.filter(f => f.goal_number === 3 || f.flag_type === "missing_tds_obligation");

    setSummary({
      totalFlags:        flags.length,
      pendingFlags:      flags.filter(f => f.flag_status === "pending").length,
      goal1Flags:        flags.filter(f => f.goal_number === 1).length,
      goal2Flags:        flags.filter(f => f.goal_number === 2).length,
      goal3Flags:        goal3.length,
      estimatedExposure: goal3
        .filter(f => f.flag_status !== "disregarded")
        .reduce((s: number, f: any) => s + (f.expected_tds ?? 0), 0),
      shortVariance: flags
        .filter(f => f.flag_type === "short_deduction" && f.flag_status !== "disregarded")
        .reduce((s: number, f: any) => s + Math.abs(f.variance_amount ?? 0), 0),
      confirmedMappings: mappings.filter(m => m.mapping_status === "confirmed").length,
      grandTotalDemand:  demandItems
        .filter(d => d.item_status !== "settled")
        .reduce((s: number, d: any) => s + (d.total_demand ?? 0), 0),
    });
    setSummaryLoading(false);
  }, [clientId, financialYear]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Refresh summary whenever the user switches back to any tab (after a run)
  const handleTabChange = (tab: TdsTab) => {
    setActiveTab(tab);
    loadSummary();
  };

  // ── Export PDF ──
  const handleExport = async () => {
    if (!clientId || !financialYear) return;
    setExporting(true);
    try {
      await generateTdsReport({ clientId, financialYear });
    } catch (e) {
      console.error("TDS report export failed:", e);
    } finally {
      setExporting(false);
    }
  };

  const hasData = summary.totalFlags > 0 || summary.confirmedMappings > 0 || summary.grandTotalDemand > 0;

  return (
    <div className="space-y-3">

      {/* ── Module header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">TDS Analytics &amp; Reconciliation</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            AI-powered reconciliation of Trial Balance ledgers against TDS Management records.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {financialYear && (
            <span className="text-[10px] bg-muted border rounded px-2 py-0.5 text-muted-foreground">
              FY {financialYear}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            disabled={exporting || !clientId || !financialYear}
            className="h-7 text-[11px] gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800"
          >
            {exporting
              ? <Loader2 size={11} className="animate-spin" />
              : <FileDown size={11} />
            }
            Export TDS Report
          </Button>
        </div>
      </div>

      {/* ── Exposure KPI bar ── */}
      {hasData && (
        <div className={cn(
          "grid grid-cols-5 gap-2 p-3 bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-100 rounded-lg",
          summaryLoading && "opacity-60",
        )}>
          {/* Total Flags */}
          <div className="text-center">
            <div className="text-lg font-bold text-slate-700 leading-tight">
              {summary.totalFlags}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Total Flags</div>
            <div className="flex justify-center gap-1 mt-1">
              <span className="text-[9px] bg-amber-100 text-amber-700 rounded px-1">
                {summary.pendingFlags} pending
              </span>
            </div>
          </div>

          {/* Goal breakdown */}
          <div className="text-center border-l border-teal-100">
            <div className="text-lg font-bold text-slate-700 leading-tight">
              G1:{summary.goal1Flags} · G2:{summary.goal2Flags} · G3:{summary.goal3Flags}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Flags by Goal</div>
            <div className="flex justify-center gap-1 mt-1">
              <span className="text-[9px] bg-blue-100 text-blue-700 rounded px-1">
                {summary.confirmedMappings} confirmed maps
              </span>
            </div>
          </div>

          {/* Short deduction variance */}
          <div className="text-center border-l border-teal-100">
            <div className={cn(
              "text-lg font-bold leading-tight",
              summary.shortVariance > 0 ? "text-amber-600" : "text-slate-400",
            )}>
              {fmtINR(summary.shortVariance)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Short Deduction Variance</div>
            <div className="flex justify-center mt-1">
              <span className="text-[9px] bg-amber-50 text-amber-600 rounded px-1">Goal 2</span>
            </div>
          </div>

          {/* Missing TDS exposure */}
          <div className="text-center border-l border-teal-100">
            <div className={cn(
              "text-lg font-bold leading-tight",
              summary.estimatedExposure > 0 ? "text-red-600" : "text-slate-400",
            )}>
              {fmtINR(summary.estimatedExposure)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Est. Missing TDS Exposure</div>
            <div className="flex justify-center mt-1">
              <span className="text-[9px] bg-red-50 text-red-600 rounded px-1">Goal 3</span>
            </div>
          </div>

          {/* Grand total demand (TDS-6) */}
          <div className="text-center border-l border-teal-100">
            <div className={cn(
              "text-lg font-bold leading-tight",
              summary.grandTotalDemand > 0 ? "text-slate-800" : "text-slate-400",
            )}>
              {summary.grandTotalDemand > 0 ? fmtINR(summary.grandTotalDemand) : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Total Demand (incl. Interest)</div>
            <div className="flex justify-center mt-1">
              <span className="text-[9px] bg-slate-100 text-slate-600 rounded px-1">TDS-6</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab strip ── */}
      <div className="flex gap-0 border-b">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30",
            )}
          >
            {tab.icon}
            {tab.label}
            <span className={cn(
              "text-[9px] px-1 py-0.5 rounded font-mono",
              activeTab === tab.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
            )}>
              {tab.phase}
            </span>
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {activeTab === "mappings" && (
        <TdsPartyMappingPanel clientId={clientId} financialYear={financialYear} />
      )}
      {activeTab === "recon"    && (
        <TdsReconFlagsPanel   clientId={clientId} financialYear={financialYear} />
      )}
      {activeTab === "missing"  && (
        <TdsMissingPanel      clientId={clientId} financialYear={financialYear} />
      )}
      {activeTab === "demand"   && (
        <TdsDemandPanel       clientId={clientId} financialYear={financialYear} />
      )}
      {activeTab === "memory"   && (
        <TdsAiMemoryPanel     clientId={clientId} financialYear={financialYear} />
      )}
    </div>
  );
}
