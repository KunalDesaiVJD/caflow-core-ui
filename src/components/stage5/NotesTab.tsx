/**
 * NotesTab — Stage 5 Notes parent (UI-6).
 *
 * Renders four sub-tabs (BS-Liab → BS-Asset → FA → PL) and a top toolbar
 * with [Re-sync from COA] / [Last synced ...] / [Print Notes].
 *
 * On mount: if stage5_notes.auto_synced_at is null, runs autoPopulateNotes
 * automatically so the auditor lands on populated cells. Subsequent edits
 * mark each path in manual_edits[] so re-sync never clobbers them.
 *
 * Persistence: writes back to audit_engagements.stage5_notes (JSONB) on
 * every commit. Optimistic local state — failures show a toast.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Printer, FileText, Wallet, Building2, Coins, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { toast } from "sonner";
import {
  loadStage5Notes, saveStage5Notes, autoPopulateNotes,
  setAtPath, getAtPath, markManualEdit, clearManualEdit,
  type Stage5Notes, type FARow,
} from "@/lib/notesAutoPopulate";
import NoteBSLiab from "./notes/NoteBSLiab";
import NoteBSAsset from "./notes/NoteBSAsset";
import NotePL from "./notes/NotePL";
import FAGrid from "./notes/FAGrid";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  engagementId:    string;
  cyYear:          number;
  pyYear:          number;
  /** When set, switch to the given sub-tab and scroll to note-{noteNo}. */
  navigateToNote?: { noteNo: number; subTab: "bs_liab" | "bs_asset" | "pl" | "fa" } | null;
}

export default function NotesTab({ engagementId, cyYear, pyYear, navigateToNote }: Props) {
  const [notes,         setNotes]         = useState<Stage5Notes | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [syncing,       setSyncing]       = useState(false);
  const [activeTab,     setActiveTab]     = useState<"bs_liab" | "bs_asset" | "pl" | "fa">("bs_liab");
  // undefined = uncontrolled, true = all collapsed, false = all expanded
  const [collapseAll,   setCollapseAll]   = useState<boolean | undefined>(undefined);
  const [pyFaRows, setPyFaRows] = useState<FARow[] | null>(null);

  // ── Navigate to a specific note from BS / P&L click ──────────────────
  useEffect(() => {
    if (!navigateToNote) return;
    setActiveTab(navigateToNote.subTab);
    const timer = setTimeout(() => {
      document
        .getElementById(`note-${navigateToNote.noteNo}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
    return () => clearTimeout(timer);
  }, [navigateToNote]);

  // ── Initial load + auto-populate-if-needed ────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const existing = await loadStage5Notes(engagementId);
        // Auto-populate on first visit (auto_synced_at === null)
        if (!existing.auto_synced_at) {
          const fresh = await autoPopulateNotes(engagementId, { existing });
          await saveStage5Notes(engagementId, fresh);
          if (!cancelled) setNotes(fresh);
        } else {
          if (!cancelled) setNotes(existing);
        }
      } catch (e: any) {
        toast.error(`Failed to load Notes: ${e?.message || e}`);
        if (!cancelled) setNotes(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // ── Fetch PY engagement's FA rows for the "Total — Previous year" row ─
  useEffect(() => {
    if (!engagementId) return;
    (async () => {
      const { data: eng } = await supabase
        .from("audit_engagements")
        .select("client_id, financial_year")
        .eq("id", engagementId)
        .maybeSingle();
      const clientId = (eng as any)?.client_id;
      const fy       = (eng as any)?.financial_year;
      if (!clientId || !fy) return;
      const parts = String(fy).split("-");
      if (parts.length !== 2) return;
      const prevFy = `${parseInt(parts[0],10) - 1}-${String(parseInt(parts[0],10)).slice(-2)}`;
      const { data: prev } = await supabase
        .from("audit_engagements")
        .select("stage5_notes")
        .eq("client_id", clientId)
        .eq("financial_year", prevFy)
        .maybeSingle();
      const fa = (prev as any)?.stage5_notes?.fa?.rows;
      if (Array.isArray(fa)) setPyFaRows(fa as FARow[]);
    })();
  }, [engagementId]);

  // ── Helpers passed to each sub-tab ────────────────────────────────────
  // Update a path AND mark it as a manual edit (so re-sync respects it).
  // Exception: `.breakup` paths are NOT marked manual at path level — the
  // ListTable encodes per-row `source: "linked" | "manual"` and re-sync
  // preserves manual rows row-by-row via buildBreakup().
  const updatePath = useCallback((path: string, value: any) => {
    setNotes(prev => {
      if (!prev) return prev;
      const next: Stage5Notes = JSON.parse(JSON.stringify(prev));
      setAtPath(next, path, value);
      if (!path.endsWith(".breakup")) {
        next.manual_edits = markManualEdit(next, path);
      }
      // Fire-and-forget save; toast on error.
      saveStage5Notes(engagementId, next).catch((e: any) =>
        toast.error(`Save failed: ${e?.message || e}`),
      );
      return next;
    });
  }, [engagementId]);

  // Reset a path to its auto-derived value (re-runs autoPopulate).
  const resetPath = useCallback(async (path: string) => {
    try {
      const fresh = await autoPopulateNotes(engagementId);
      const autoVal = getAtPath(fresh, path);
      setNotes(prev => {
        if (!prev) return prev;
        const next: Stage5Notes = JSON.parse(JSON.stringify(prev));
        setAtPath(next, path, autoVal);
        next.manual_edits = clearManualEdit(next, path);
        saveStage5Notes(engagementId, next).catch((e: any) =>
          toast.error(`Save failed: ${e?.message || e}`),
        );
        return next;
      });
      toast.success("Reset to auto-value");
    } catch (e: any) {
      toast.error(`Reset failed: ${e?.message || e}`);
    }
  }, [engagementId]);

  const isOverridden = useCallback((path: string) =>
    !!notes?.manual_edits?.includes(path),
  [notes?.manual_edits]);

  // FA rows are a special case — array, not key/value. Edits to the array
  // mark the whole `fa.rows` path as manual.
  const updateFaRows = useCallback((rows: FARow[]) => {
    updatePath("fa.rows", rows);
  }, [updatePath]);

  // ── Re-sync from COA button ───────────────────────────────────────────
  // If the user has any manual_edits[] in flight, show a confirm dialog
  // explaining that those overrides will be preserved. Hitting Cancel
  // aborts the re-sync entirely.
  const handleResync = useCallback(async () => {
    const existing = notes ?? await loadStage5Notes(engagementId);
    const overrides = existing.manual_edits?.length ?? 0;
    if (overrides > 0) {
      const ok = window.confirm(
        `Re-sync from COA mapping?\n\n` +
        `You have ${overrides} manual override(s). Re-sync refreshes ` +
        `auto-filled cells but PRESERVES your manual edits. ` +
        `Click OK to continue or Cancel to abort.`,
      );
      if (!ok) return;
    }
    setSyncing(true);
    try {
      const fresh = await autoPopulateNotes(engagementId, { existing });
      await saveStage5Notes(engagementId, fresh);
      setNotes(fresh);
      toast.success(
        overrides > 0
          ? `Re-synced — ${overrides} manual override(s) preserved.`
          : "Re-synced from COA mapping.",
      );
    } catch (e: any) {
      toast.error(`Re-sync failed: ${e?.message || e}`);
    } finally {
      setSyncing(false);
    }
  }, [engagementId, notes]);

  // Browser print — print CSS hides toolbar etc. Uses the tab content as-is.
  const handlePrint = useCallback(() => window.print(), []);

  const lastSync = useMemo(() => {
    if (!notes?.auto_synced_at) return "—";
    try {
      return new Date(notes.auto_synced_at).toLocaleString("en-IN", {
        dateStyle: "medium", timeStyle: "short",
      });
    } catch { return notes.auto_synced_at; }
  }, [notes?.auto_synced_at]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!notes) {
    return (
      <div className="text-sm text-destructive py-6 text-center">
        Notes data could not be loaded. Try reloading the page or contact support.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Button
          type="button" size="sm" variant="outline"
          onClick={handleResync}
          disabled={syncing}
          className="h-7 text-xs gap-1"
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Re-sync from COA
        </Button>
        <span className="text-[10px] text-muted-foreground">
          Last synced: <strong>{lastSync}</strong>
          {notes.manual_edits.length > 0 && (
            <span className="ml-2 text-amber-600">
              · {notes.manual_edits.length} manual override(s)
            </span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button" size="sm" variant="ghost"
            onClick={() => setCollapseAll(false)}
            className="h-7 text-xs gap-1"
            title="Expand all notes"
          >
            <ChevronsUpDown className="w-3 h-3" /> Expand All
          </Button>
          <Button
            type="button" size="sm" variant="ghost"
            onClick={() => setCollapseAll(true)}
            className="h-7 text-xs gap-1"
            title="Collapse all notes"
          >
            <ChevronsDownUp className="w-3 h-3" /> Collapse All
          </Button>
          <Button
            type="button" size="sm" variant="outline"
            onClick={handlePrint}
            className="h-7 text-xs gap-1"
          >
            <Printer className="w-3 h-3" /> Print Notes
          </Button>
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="bs_liab"  className="gap-1 text-xs">
            <Wallet size={13} /> Note BS-Liab
          </TabsTrigger>
          <TabsTrigger value="bs_asset" className="gap-1 text-xs">
            <Building2 size={13} /> Note BS-Asset
          </TabsTrigger>
          <TabsTrigger value="pl"       className="gap-1 text-xs">
            <FileText size={13} /> Note PL
          </TabsTrigger>
          <TabsTrigger value="fa"       className="gap-1 text-xs">
            <Coins size={13} /> FA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bs_liab" className="mt-3">
          <NoteBSLiab
            engagementId={engagementId}
            notes={notes} cyYear={cyYear} pyYear={pyYear}
            updatePath={updatePath} resetPath={resetPath} isOverridden={isOverridden}
            collapseControl={collapseAll}
          />
        </TabsContent>
        <TabsContent value="bs_asset" className="mt-3">
          <NoteBSAsset
            engagementId={engagementId}
            notes={notes} cyYear={cyYear} pyYear={pyYear}
            updatePath={updatePath} resetPath={resetPath} isOverridden={isOverridden}
            collapseControl={collapseAll}
          />
        </TabsContent>
        <TabsContent value="pl" className="mt-3">
          <NotePL
            engagementId={engagementId}
            notes={notes} cyYear={cyYear} pyYear={pyYear}
            updatePath={updatePath} resetPath={resetPath} isOverridden={isOverridden}
            collapseControl={collapseAll}
          />
        </TabsContent>
        <TabsContent value="fa" className="mt-3">
          <FAGrid engagementId={engagementId} rows={notes.fa.rows} pyRows={pyFaRows} onChange={updateFaRows} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
