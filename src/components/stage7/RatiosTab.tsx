/**
 * RatiosTab — Stage 7 / Note 22 Ratios
 *
 * Corporate entities only. Positioned after the Cash Flow tab and before the
 * Notes tab in PipelineFinancialStatements.tsx.
 *
 * Hosts 3 sub-tabs:
 *   "Ratio"          → RatioSummary  (11-ratio comparison table)
 *   "Current Year"   → RatioCurrentYear (detailed CY input grid)
 *   "Previous Year"  → RatioPreviousYear (detailed PY input grid)
 *
 * State management:
 *   - Loads stage7_ratios JSONB from DB on mount.
 *   - Re-sync button calls autoPopulateRatios() and saves result.
 *   - Individual field changes debounce-save after 2 s.
 *   - manual_overrides[] prevents auto-sync from clobbering user edits.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, FileSpreadsheet, Loader2, Calculator } from "lucide-react";
import { Button }   from "@/components/ui/button";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import { getNoteNo }   from "@/lib/noteNumberRegistry";
import {
  type Stage7Ratios,
  type RatioInputs,
  type CustomRatio,
  DEFAULT_STAGE7_RATIOS,
  loadStage7Ratios,
  saveStage7Ratios,
  autoPopulateRatios,
  markOverride,
  clearOverride,
} from "@/lib/ratioAutoPopulate";

import { RatioSummary }      from "./ratios/RatioSummary";
import { RatioCurrentYear }  from "./ratios/RatioCurrentYear";
import { RatioPreviousYear } from "./ratios/RatioPreviousYear";

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
  engagement:   any;
}

// ── Component ────────────────────────────────────────────────────────────────

export function RatiosTab({ engagementId, engagement }: Props) {
  const fy: string = engagement?.financial_year ?? "";

  // Note number from registry (22 for "revenue_from_ops")
  // Note 31 — "ratios" entry appended to NOTE_REGISTRY in Phase 6.
  // Falls back to 31 if somehow called before the registry is loaded.
  const noteNo = getNoteNo("ratios") ?? 31;

  // ── State ─────────────────────────────────────────────────────────────────
  const [ratios,      setRatios]      = useState<Stage7Ratios>(DEFAULT_STAGE7_RATIOS);
  const [loading,     setLoading]     = useState(true);
  const [syncing,     setSyncing]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [lastSynced,  setLastSynced]  = useState<string | null>(null);
  const [activeTab,   setActiveTab]   = useState("summary");
  const [exporting,   setExporting]   = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    setLoading(true);
    loadStage7Ratios(engagementId)
      .then((data) => {
        setRatios(data);
        // Derive lastSynced from any existing data being non-empty
        if (data.cy.revenue_ops != null || data.cy.current_assets != null) {
          setLastSynced("Loaded from saved data");
        }
      })
      .catch(() => toast.error("Failed to load ratio data"))
      .finally(() => setLoading(false));
  }, [engagementId]);

  // ── Debounced save ────────────────────────────────────────────────────────
  const triggerSave = useCallback((updated: Stage7Ratios) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveStage7Ratios(engagementId, updated);
      } catch {
        toast.error("Failed to save ratio data");
      } finally {
        setSaving(false);
      }
    }, 2000);
  }, [engagementId]);

  // ── Re-sync from BS/P&L ───────────────────────────────────────────────────
  const handleResync = async () => {
    setSyncing(true);
    try {
      const updated = await autoPopulateRatios(engagementId, { existing: ratios });
      setRatios(updated);
      await saveStage7Ratios(engagementId, updated);
      setLastSynced(new Date().toLocaleTimeString("en-IN"));
      toast.success("Ratios synced from BS / P&L");
    } catch {
      toast.error("Sync failed — check BS/P&L data");
    } finally {
      setSyncing(false);
    }
  };

  // ── CY field change ───────────────────────────────────────────────────────
  const handleCYChange = useCallback((field: keyof RatioInputs, value: number | null) => {
    setRatios((prev) => {
      const updated: Stage7Ratios = {
        ...prev,
        cy: { ...prev.cy, [field]: value },
        manual_overrides: markOverride(prev, `cy.${field}`),
      };
      triggerSave(updated);
      return updated;
    });
  }, [triggerSave]);

  // ── CY override reset (restore auto value) ────────────────────────────────
  const handleCYReset = useCallback(async (field: keyof RatioInputs) => {
    // Remove from manual_overrides then re-sync so auto value is restored
    const withoutOverride: Stage7Ratios = {
      ...ratios,
      manual_overrides: clearOverride(ratios, `cy.${field}`),
    };
    setSyncing(true);
    try {
      const resynced = await autoPopulateRatios(engagementId, { existing: withoutOverride });
      setRatios(resynced);
      await saveStage7Ratios(engagementId, resynced);
      toast.success(`${field} reset to auto-populated value`);
    } catch {
      toast.error("Reset failed");
    } finally {
      setSyncing(false);
    }
  }, [engagementId, ratios]);

  // ── PY field change ───────────────────────────────────────────────────────
  const handlePYChange = useCallback((field: keyof RatioInputs, value: number | null) => {
    setRatios((prev) => {
      const updated: Stage7Ratios = {
        ...prev,
        py: { ...prev.py, [field]: value },
        // PY fields are always manual — no auto-link so no override tracking needed
      };
      triggerSave(updated);
      return updated;
    });
  }, [triggerSave]);

  // ── Commentary change ─────────────────────────────────────────────────────
  const handleCommentaryChange = useCallback((ratioId: number, text: string) => {
    setRatios((prev) => {
      const updated: Stage7Ratios = {
        ...prev,
        commentary: prev.commentary.map((c) =>
          c.ratioId === ratioId ? { ...c, text } : c,
        ),
      };
      triggerSave(updated);
      return updated;
    });
  }, [triggerSave]);

  // ── Custom ratio handlers ─────────────────────────────────────────────────
  const handleAddCustomRatio = useCallback(() => {
    const newRatio: CustomRatio = {
      id: Date.now().toString(),
      name: "New Ratio",
      unit: "times",
      numeratorLabel: "Numerator",
      denominatorLabel: "Denominator",
      cy: { numerator: null, denominator: null },
      py: { numerator: null, denominator: null },
      commentary: "",
    };
    setRatios((prev) => {
      const updated: Stage7Ratios = {
        ...prev,
        custom_ratios: [...(prev.custom_ratios ?? []), newRatio],
      };
      triggerSave(updated);
      return updated;
    });
  }, [triggerSave]);

  const handleCustomRatioChange = useCallback((id: string, changes: Partial<CustomRatio>) => {
    setRatios((prev) => {
      const updated: Stage7Ratios = {
        ...prev,
        custom_ratios: (prev.custom_ratios ?? []).map((r) =>
          r.id === id ? { ...r, ...changes } : r,
        ),
      };
      triggerSave(updated);
      return updated;
    });
  }, [triggerSave]);

  const handleDeleteCustomRatio = useCallback((id: string) => {
    setRatios((prev) => {
      const updated: Stage7Ratios = {
        ...prev,
        custom_ratios: (prev.custom_ratios ?? []).filter((r) => r.id !== id),
      };
      triggerSave(updated);
      return updated;
    });
  }, [triggerSave]);

  // ── Excel export (3 sheets matching Ratio.xlsx template) ─────────────────
  const handleExportExcel = useCallback(async () => {
    setExporting(true);
    try {
      const ExcelJS   = (await import("exceljs")).default;
      const wb        = new ExcelJS.Workbook();
      wb.creator      = "CAFlow";
      wb.created      = new Date();
      const cyYear    = engagement?.fy_end
        ? new Date(engagement.fy_end).getFullYear()
        : new Date().getFullYear();
      const pyYear    = cyYear - 1;
      const companyName = engagement?.clients?.name || engagement?.client_name || "";
      const { writeRatiosSheets } = await import("@/lib/fsRatiosWriter");
      writeRatiosSheets(wb, { cyYear, pyYear, companyName }, ratios);
      const buffer = await wb.xlsx.writeBuffer();
      const blob   = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href     = url;
      a.download = `Ratios_${companyName || "Ratios"}_${fy || "FY"}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Ratio Excel exported");
    } catch {
      toast.error("Excel export failed");
    } finally {
      setExporting(false);
    }
  }, [ratios, engagement, fy]);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading ratio data…
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold text-foreground">
            Note {noteNo} — Ratios
          </h2>
          {saving && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </span>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          {lastSynced && (
            <span className="text-[11px] text-slate-500">
              Last synced: {lastSynced}
            </span>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleResync}
            disabled={syncing}
            className="gap-1.5 text-xs"
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Re-sync from BS/P&L
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            disabled={exporting}
            className="gap-1.5 text-xs"
          >
            {exporting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <FileSpreadsheet className="h-3.5 w-3.5" />
            }
            Export Excel
          </Button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="summary">Ratio</TabsTrigger>
            <TabsTrigger value="cy">Current Year</TabsTrigger>
            <TabsTrigger value="py">Previous Year</TabsTrigger>
          </TabsList>

          {/* Sub-tab 1: Summary */}
          <TabsContent value="summary">
            <RatioSummary
              ratios={ratios}
              fy={fy}
              onCommentaryChange={handleCommentaryChange}
              onCustomRatioChange={handleCustomRatioChange}
              onCustomRatioCommentaryChange={(id, text) =>
                handleCustomRatioChange(id, { commentary: text })
              }
              onAddCustomRatio={handleAddCustomRatio}
              onDeleteCustomRatio={handleDeleteCustomRatio}
            />
          </TabsContent>

          {/* Sub-tab 2: Current Year inputs */}
          <TabsContent value="cy">
            <RatioCurrentYear
              ratios={ratios}
              fy={fy}
              onFieldChange={handleCYChange}
              onOverrideReset={handleCYReset}
              onCustomRatioChange={handleCustomRatioChange}
              onAddCustomRatio={handleAddCustomRatio}
              onDeleteCustomRatio={handleDeleteCustomRatio}
            />
          </TabsContent>

          {/* Sub-tab 3: Previous Year inputs */}
          <TabsContent value="py">
            <RatioPreviousYear
              ratios={ratios}
              fy={fy}
              onFieldChange={handlePYChange}
              onCustomRatioChange={handleCustomRatioChange}
              onAddCustomRatio={handleAddCustomRatio}
              onDeleteCustomRatio={handleDeleteCustomRatio}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
