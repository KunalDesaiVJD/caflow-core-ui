/**
 * NCEDetailedNotes — editor for all NCE "Notes to Financial Statements".
 *
 * Features (Phase 2):
 *  • Auto-populates from COA-mapped Tally TB on first visit (no data yet).
 *  • "Re-sync from COA" button refreshes auto rows while preserving manual edits.
 *  • "Add Row" button in every note lets the auditor insert custom description rows.
 *  • Custom auto rows show a blue "Auto" badge; manual rows show an amber "Manual" badge.
 *  • All rows (including custom) feed into the note's grand total via computeDisplayData.
 *  • "Save All Notes" persists to nce_financial_notes via Supabase upsert.
 *    Auto-save fires after every cell change (debounced 1 s).
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase }    from "@/integrations/supabase/client";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import { Badge }       from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast }       from "sonner";
import { Loader2, Save, RefreshCw, Plus, Trash2 } from "lucide-react";
import { cn }          from "@/lib/utils";
import {
  NoteConfig, NOTES_CONFIG, computeDisplayData,
} from "@/config/nceNotesConfig";
import {
  NCECustomRow, NCENoteData,
  nceAutoPopulate, deserialiseNoteData, serialiseNoteData,
} from "@/lib/nceAutoPopulate";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props { engagementId: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INDENT_CLS = ["pl-3", "pl-7", "pl-11", "pl-14"] as const;
function indentCls(level = 0) {
  return INDENT_CLS[Math.min(level, INDENT_CLS.length - 1)];
}

function parseFY(fy: string): { cy: number; py: number } {
  if (!fy) { const y = new Date().getFullYear(); return { cy: y, py: y - 1 }; }
  const parts = fy.split("-");
  if (parts.length === 2) {
    const end = parseInt(parts[1]);
    const fullEnd = end < 100 ? 2000 + end : end;
    return { cy: fullEnd, py: fullEnd - 1 };
  }
  const y = parseInt(fy) || new Date().getFullYear();
  return { cy: y, py: y - 1 };
}

function fmtNum(v: number): string {
  return v !== 0 ? v.toLocaleString("en-IN") : "—";
}

/** Generate a unique custom-row ID */
function newCustomId(): string {
  return "custom_" + Math.random().toString(36).slice(2, 10);
}

// ─── NumInput ─────────────────────────────────────────────────────────────────

function NumInput({
  value, onChange, disabled,
}: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const [local, setLocal] = useState(value === 0 ? "" : String(value));
  useEffect(() => { setLocal(value === 0 ? "" : String(value)); }, [value]);
  return (
    <Input
      type="text" inputMode="decimal"
      className={cn(
        "h-7 text-xs text-right px-2 py-0 w-full min-w-[80px]",
        disabled && "bg-muted/60 text-muted-foreground cursor-not-allowed",
      )}
      disabled={disabled}
      value={local}
      placeholder="—"
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const parsed = parseFloat(local.replace(/,/g, "")) || 0;
        setLocal(parsed === 0 ? "" : String(parsed));
        onChange(parsed);
      }}
    />
  );
}

// ─── Custom row badge ─────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: "auto" | "manual" }) {
  return source === "auto"
    ? <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 text-blue-600 border-blue-300">Auto</Badge>
    : <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 text-amber-600 border-amber-300">Manual</Badge>;
}

// ─── Pattern B Table ──────────────────────────────────────────────────────────

function PatternBTable({
  config, cy: rawCy, py: rawPy, cyYear, pyYear,
  customRows, onChangeCy, onChangePy,
  onAddRow, onDeleteRow, onChangeRowLabel,
}: {
  config:          NoteConfig;
  cy:              Record<string, number>;
  py:              Record<string, number>;
  cyYear:          number;
  pyYear:          number;
  customRows:      NCECustomRow[];
  onChangeCy:      (key: string, v: number) => void;
  onChangePy:      (key: string, v: number) => void;
  onAddRow:        () => void;
  onDeleteRow:     (id: string) => void;
  onChangeRowLabel:(id: string, label: string) => void;
}) {
  const customIds = useMemo(() => customRows.map(r => r.id), [customRows]);
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customIds),
    [config, rawCy, rawPy, customIds],
  );

  // Find index of grand-total row to insert custom rows before it
  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40">
          <TableHead className="text-xs w-[50%]">Particulars</TableHead>
          <TableHead className="text-xs text-right w-[22%]">31 March {cyYear} (₹)</TableHead>
          <TableHead className="text-xs text-right w-[22%]">31 March {pyYear} (₹)</TableHead>
          <TableHead className="w-[6%]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {config.rows.map((row, idx) => {
          // Insert custom rows + "Add row" button just before the grand-total row
          const insertBefore = idx === grandTotalIdx && customRows.length > 0;
          return (
            <>
              {insertBefore && customRows.map(cr => (
                <TableRow key={cr.id} className="hover:bg-muted/10 bg-blue-50/30">
                  <TableCell className="p-1 pl-3">
                    <div className="flex items-center gap-1">
                      <Input
                        value={cr.label}
                        onChange={e => onChangeRowLabel(cr.id, e.target.value)}
                        onBlur={e => cr.source === "auto" && e.target.value !== cr.label
                          ? onChangeRowLabel(cr.id, e.target.value) : undefined}
                        className="h-6 text-xs px-1.5"
                        placeholder="Row description"
                      />
                      <SourceBadge source={cr.source} />
                    </div>
                  </TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawCy[cr.id] ?? 0} onChange={v => onChangeCy(cr.id, v)} />
                  </TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawPy[cr.id] ?? 0} onChange={v => onChangePy(cr.id, v)} />
                  </TableCell>
                  <TableCell className="p-1 text-center">
                    <button
                      type="button"
                      onClick={() => onDeleteRow(cr.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}

              {row.isSectionHeader ? (
                <TableRow key={row.id} className="bg-muted/20">
                  <TableCell colSpan={4} className={cn("text-xs font-semibold py-1.5", indentCls(row.indent))}>
                    {row.label}
                  </TableCell>
                </TableRow>
              ) : row.isTotal ? (
                <TableRow key={row.id} className="bg-muted/10 border-t border-border/60">
                  <TableCell className={cn("text-xs font-semibold py-1.5", indentCls(row.indent))}>
                    {row.label}
                  </TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(cy[row.id] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(py[row.id] ?? 0)}</TableCell>
                  <TableCell />
                </TableRow>
              ) : (
                <TableRow key={row.id} className="hover:bg-muted/10">
                  <TableCell className={cn("text-xs py-1", indentCls(row.indent))}>{row.label}</TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawCy[row.id] ?? 0} onChange={v => onChangeCy(row.id, v)} disabled={row.naAll} />
                  </TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawPy[row.id] ?? 0} onChange={v => onChangePy(row.id, v)} disabled={row.naAll} />
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
            </>
          );
        })}

        {/* Add row button */}
        <TableRow>
          <TableCell colSpan={4} className="py-1.5 px-3">
            <Button
              type="button" size="sm" variant="ghost"
              className="h-6 text-xs text-muted-foreground gap-1 hover:text-foreground"
              onClick={onAddRow}
            >
              <Plus className="h-3 w-3" /> Add row
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

// ─── Pattern A Table ──────────────────────────────────────────────────────────

function PatternATable({
  config, cy: rawCy, py: rawPy, cyYear, pyYear,
  customRows, onChangeCy, onChangePy,
  onAddRow, onDeleteRow, onChangeRowLabel,
}: {
  config:          NoteConfig;
  cy:              Record<string, number>;
  py:              Record<string, number>;
  cyYear:          number;
  pyYear:          number;
  customRows:      NCECustomRow[];
  onChangeCy:      (key: string, v: number) => void;
  onChangePy:      (key: string, v: number) => void;
  onAddRow:        () => void;
  onDeleteRow:     (id: string) => void;
  onChangeRowLabel:(id: string, label: string) => void;
}) {
  const customIds = useMemo(() => customRows.map(r => r.id), [customRows]);
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customIds),
    [config, rawCy, rawPy, customIds],
  );

  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40">
          <TableHead rowSpan={2} className="text-xs w-[28%] align-bottom border-r">Particulars</TableHead>
          <TableHead colSpan={2} className="text-xs text-center border-r border-b-0">Long Term (₹)</TableHead>
          <TableHead colSpan={2} className="text-xs text-center border-b-0">Short Term (₹)</TableHead>
          <TableHead rowSpan={2} className="w-[5%]" />
        </TableRow>
        <TableRow className="bg-muted/40">
          <TableHead className="text-xs text-right">31 Mar {cyYear}</TableHead>
          <TableHead className="text-xs text-right border-r">31 Mar {pyYear}</TableHead>
          <TableHead className="text-xs text-right">31 Mar {cyYear}</TableHead>
          <TableHead className="text-xs text-right">31 Mar {pyYear}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {config.rows.map((row, idx) => {
          const insertBefore = idx === grandTotalIdx && customRows.length > 0;
          return (
            <>
              {insertBefore && customRows.map(cr => (
                <TableRow key={cr.id} className="hover:bg-muted/10 bg-blue-50/30">
                  <TableCell className="p-1 border-r">
                    <div className="flex items-center gap-1">
                      <Input
                        value={cr.label}
                        onChange={e => onChangeRowLabel(cr.id, e.target.value)}
                        className="h-6 text-xs px-1.5"
                        placeholder="Row description"
                      />
                      <SourceBadge source={cr.source} />
                    </div>
                  </TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawCy[cr.id + "_lt"] ?? 0} onChange={v => onChangeCy(cr.id + "_lt", v)} />
                  </TableCell>
                  <TableCell className="p-1 border-r">
                    <NumInput value={rawPy[cr.id + "_lt"] ?? 0} onChange={v => onChangePy(cr.id + "_lt", v)} />
                  </TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawCy[cr.id + "_st"] ?? 0} onChange={v => onChangeCy(cr.id + "_st", v)} />
                  </TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawPy[cr.id + "_st"] ?? 0} onChange={v => onChangePy(cr.id + "_st", v)} />
                  </TableCell>
                  <TableCell className="p-1 text-center">
                    <button type="button" onClick={() => onDeleteRow(cr.id)}
                      className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}

              {row.isSectionHeader ? (
                <TableRow key={row.id} className="bg-muted/20">
                  <TableCell colSpan={6} className={cn("text-xs font-semibold py-1.5", indentCls(row.indent))}>
                    {row.label}
                  </TableCell>
                </TableRow>
              ) : row.isTotal ? (
                <TableRow key={row.id} className="bg-muted/10 border-t border-border/60">
                  <TableCell className={cn("text-xs font-semibold py-1.5 border-r", indentCls(row.indent))}>
                    {row.label}
                  </TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(cy[row.id + "_lt"] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-semibold border-r">{fmtNum(py[row.id + "_lt"] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(cy[row.id + "_st"] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-semibold">{fmtNum(py[row.id + "_st"] ?? 0)}</TableCell>
                  <TableCell />
                </TableRow>
              ) : (
                <TableRow key={row.id} className="hover:bg-muted/10">
                  <TableCell className={cn("text-xs py-1 border-r", indentCls(row.indent))}>{row.label}</TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawCy[row.id + "_lt"] ?? 0} onChange={v => onChangeCy(row.id + "_lt", v)} disabled={row.naLT} />
                  </TableCell>
                  <TableCell className="p-1 border-r">
                    <NumInput value={rawPy[row.id + "_lt"] ?? 0} onChange={v => onChangePy(row.id + "_lt", v)} disabled={row.naLT} />
                  </TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawCy[row.id + "_st"] ?? 0} onChange={v => onChangeCy(row.id + "_st", v)} disabled={row.naST} />
                  </TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawPy[row.id + "_st"] ?? 0} onChange={v => onChangePy(row.id + "_st", v)} disabled={row.naST} />
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
            </>
          );
        })}

        {/* Add row button */}
        <TableRow>
          <TableCell colSpan={6} className="py-1.5 px-3">
            <Button
              type="button" size="sm" variant="ghost"
              className="h-6 text-xs text-muted-foreground gap-1 hover:text-foreground"
              onClick={onAddRow}
            >
              <Plus className="h-3 w-3" /> Add row
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NCEDetailedNotes({ engagementId }: Props) {
  const [noteData,  setNoteData]  = useState<Record<string, NCENoteData>>({});
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [syncing,   setSyncing]   = useState(false);
  const [eng,       setEng]       = useState<any>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const financialYear = (eng?.financial_year as string) || "";
  const clientName    = (eng?.clients?.name  as string) || "";
  const { cy: cyYear, py: pyYear } = useMemo(() => parseFY(financialYear), [financialYear]);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Fetch engagement metadata
        const { data: engRow } = await supabase
          .from("audit_engagements")
          .select("financial_year, clients(name), firms(*), partner:users!partner_id(name)")
          .eq("id", engagementId)
          .single();
        if (cancelled) return;
        if (engRow) setEng(engRow);

        // 2. Fetch saved notes
        const { data, error } = await supabase
          .from("nce_financial_notes")
          .select("note_type, cy_data, py_data")
          .eq("engagement_id", engagementId);
        if (cancelled) return;
        if (error) throw error;

        if (data && data.length > 0) {
          // Deserialise
          const built: Record<string, NCENoteData> = {};
          for (const row of data) {
            built[row.note_type] = deserialiseNoteData(
              (row.cy_data as Record<string, any>) || {},
              (row.py_data as Record<string, any>) || {},
            );
          }
          setNoteData(built);
        } else {
          // First visit — auto-populate from COA
          const populated = await nceAutoPopulate(engagementId, {});
          setNoteData(populated);
          // Persist immediately
          await persistNotes(engagementId, (engRow as any)?.financial_year ?? "", populated);
          toast.success("Notes auto-populated from COA mapping");
        }
      } catch (e: any) {
        toast.error(`Failed to load notes: ${e?.message || e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  // ── Persist helper ──────────────────────────────────────────────────────
  async function persistNotes(
    engId: string,
    fy:    string,
    data:  Record<string, NCENoteData>,
  ) {
    const rows = NOTES_CONFIG.map(nc => {
      const d = data[nc.noteType] ?? { cy: {}, py: {}, customRows: [] };
      const { cy_data, py_data } = serialiseNoteData(d);
      return {
        engagement_id:  engId,
        financial_year: fy,
        note_type:      nc.noteType,
        cy_data:        cy_data as any,
        py_data:        py_data as any,
        updated_at:     new Date().toISOString(),
      };
    });
    const { error } = await supabase
      .from("nce_financial_notes")
      .upsert(rows, { onConflict: "engagement_id,financial_year,note_type" });
    if (error) throw error;
  }

  // ── Auto-save (debounced) ───────────────────────────────────────────────
  const scheduleSave = useCallback((data: Record<string, NCENoteData>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await persistNotes(engagementId, financialYear, data);
      } catch (e: any) {
        toast.error(`Auto-save failed: ${e?.message || e}`);
      }
    }, 1200);
  }, [engagementId, financialYear]);

  // ── Cell change handler ─────────────────────────────────────────────────
  const handleChange = useCallback((
    noteType: string, key: string, isCY: boolean, value: number,
  ) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const next = isCY
        ? { ...prev, [noteType]: { ...cur, cy: { ...cur.cy, [key]: value } } }
        : { ...prev, [noteType]: { ...cur, py: { ...cur.py, [key]: value } } };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  // ── Custom row operations ───────────────────────────────────────────────
  const handleAddRow = useCallback((noteType: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const id  = newCustomId();
      const next: Record<string, NCENoteData> = {
        ...prev,
        [noteType]: {
          ...cur,
          customRows: [...cur.customRows, { id, label: "", source: "manual" }],
        },
      };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const handleDeleteRow = useCallback((noteType: string, id: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      // Remove amounts for this row
      const newCy = { ...cur.cy };
      const newPy = { ...cur.py };
      for (const suffix of ["", "_lt", "_st"]) {
        delete newCy[id + suffix];
        delete newPy[id + suffix];
      }
      const next: Record<string, NCENoteData> = {
        ...prev,
        [noteType]: {
          cy:         newCy,
          py:         newPy,
          customRows: cur.customRows.filter(r => r.id !== id),
        },
      };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const handleChangeLabel = useCallback((noteType: string, id: string, label: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const next: Record<string, NCENoteData> = {
        ...prev,
        [noteType]: {
          ...cur,
          customRows: cur.customRows.map(r =>
            r.id === id ? { ...r, label, source: "manual" as const } : r,
          ),
        },
      };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  // ── Re-sync from COA ────────────────────────────────────────────────────
  const handleResync = useCallback(async () => {
    const ok = window.confirm(
      "Re-sync from COA mapping?\n\n" +
      "Auto rows will be refreshed from Tally TB. " +
      "Manual rows and static-row values are preserved. Click OK to continue.",
    );
    if (!ok) return;
    setSyncing(true);
    try {
      const populated = await nceAutoPopulate(engagementId, noteData);
      setNoteData(populated);
      await persistNotes(engagementId, financialYear, populated);
      toast.success("Re-synced from COA mapping");
    } catch (e: any) {
      toast.error(`Re-sync failed: ${e?.message || e}`);
    } finally {
      setSyncing(false);
    }
  }, [engagementId, financialYear, noteData]);

  // ── Explicit save ───────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await persistNotes(engagementId, financialYear, noteData);
      toast.success("Notes saved successfully");
    } catch (e: any) {
      toast.error(e.message || "Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading state ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const SaveBtn = ({ className }: { className?: string }) => (
    <Button size="sm" onClick={handleSave} disabled={saving} className={className}>
      {saving
        ? <Loader2 className="animate-spin h-4 w-4 mr-1.5" />
        : <Save className="h-4 w-4 mr-1.5" />}
      Save All Notes
    </Button>
  );

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="text-center space-y-0.5 pb-3 border-b">
        {clientName && (
          <p className="text-sm font-semibold uppercase tracking-wide">{clientName}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Notes forming part of the Financial Statements for the year ended, 31st March, {cyYear}
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button" size="sm" variant="outline"
          onClick={handleResync} disabled={syncing}
          className="h-7 text-xs gap-1"
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Re-sync from COA
        </Button>
        <span className="text-[10px] text-muted-foreground">
          Auto rows (blue) are refreshed on re-sync · Manual rows (amber) are preserved
        </span>
        <SaveBtn className="ml-auto h-7 text-xs" />
      </div>

      {/* Notes accordion */}
      <Accordion type="multiple" className="space-y-1.5">
        {NOTES_CONFIG.map(nc => {
          const d = noteData[nc.noteType] ?? { cy: {}, py: {}, customRows: [] };
          const autoCount   = d.customRows.filter(r => r.source === "auto").length;
          const manualCount = d.customRows.filter(r => r.source === "manual").length;

          return (
            <AccordionItem
              key={nc.noteType}
              value={nc.noteType}
              className="border rounded-lg px-4 bg-background"
            >
              <AccordionTrigger className="text-sm font-medium py-3 hover:no-underline">
                <span className="flex items-center gap-2">
                  {nc.title}
                  {autoCount   > 0 && <Badge variant="outline" className="text-[9px] px-1.5 text-blue-600 border-blue-300">{autoCount} auto</Badge>}
                  {manualCount > 0 && <Badge variant="outline" className="text-[9px] px-1.5 text-amber-600 border-amber-300">{manualCount} manual</Badge>}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="overflow-x-auto rounded border">
                  {nc.pattern === "A" ? (
                    <PatternATable
                      config={nc}
                      cy={d.cy} py={d.py}
                      cyYear={cyYear} pyYear={pyYear}
                      customRows={d.customRows}
                      onChangeCy={(key, v) => handleChange(nc.noteType, key, true,  v)}
                      onChangePy={(key, v) => handleChange(nc.noteType, key, false, v)}
                      onAddRow={() => handleAddRow(nc.noteType)}
                      onDeleteRow={id => handleDeleteRow(nc.noteType, id)}
                      onChangeRowLabel={(id, label) => handleChangeLabel(nc.noteType, id, label)}
                    />
                  ) : (
                    <PatternBTable
                      config={nc}
                      cy={d.cy} py={d.py}
                      cyYear={cyYear} pyYear={pyYear}
                      customRows={d.customRows}
                      onChangeCy={(key, v) => handleChange(nc.noteType, key, true,  v)}
                      onChangePy={(key, v) => handleChange(nc.noteType, key, false, v)}
                      onAddRow={() => handleAddRow(nc.noteType)}
                      onDeleteRow={id => handleDeleteRow(nc.noteType, id)}
                      onChangeRowLabel={(id, label) => handleChangeLabel(nc.noteType, id, label)}
                    />
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Bottom save */}
      <div className="flex justify-end pt-2">
        <SaveBtn />
      </div>
    </div>
  );
}
