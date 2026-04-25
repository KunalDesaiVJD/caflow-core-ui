/**
 * NCEDetailedNotes — editor for all NCE "Notes to Financial Statements".
 *
 * Layout (Phase 3):
 *  • All notes are always open — no accordion. Same flat NoteCard style
 *    as the corporate Stage-5 Notes tab.
 *  • "Re-sync from COA" toolbar refreshes auto rows while preserving manual
 *    edits and user-entered static row values.
 *  • "Add Row" button in every note inserts a blank editable row.
 *  • Auto rows (blue badge) come from Tally TB + COA mapping or — as a
 *    fallback — from fa_financial_statements totals.
 *  • Manual rows (amber badge) are editable description + CY + PY amounts.
 *  • Delete button on every custom row.
 *  • Auto-saves 1.2 s after any cell change; explicit "Save All Notes" also present.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase }    from "@/integrations/supabase/client";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import { Badge }       from "@/components/ui/badge";
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

function newCustomId(): string {
  return "custom_" + Math.random().toString(36).slice(2, 10);
}

// ─── Note card (always open) ──────────────────────────────────────────────────

function NoteCard({
  noteNumber, title, autoCount, manualCount, children,
}: {
  noteNumber: string;
  title:      string;
  autoCount:  number;
  manualCount: number;
  children:   React.ReactNode;
}) {
  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {/* Header strip — matches corporate NoteCard style */}
      <div className="bg-muted/40 px-4 py-2 border-b flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Note {noteNumber}
        </span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {autoCount > 0 && (
          <Badge variant="outline" className="text-[9px] px-1.5 ml-1 text-blue-600 border-blue-300">
            {autoCount} auto
          </Badge>
        )}
        {manualCount > 0 && (
          <Badge variant="outline" className="text-[9px] px-1.5 ml-1 text-amber-600 border-amber-300">
            {manualCount} manual
          </Badge>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── NumInput ─────────────────────────────────────────────────────────────────

function NumInput({
  value, onChange, disabled, placeholder,
}: { value: number; onChange: (v: number) => void; disabled?: boolean; placeholder?: string }) {
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
      placeholder={placeholder ?? "—"}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const parsed = parseFloat(local.replace(/,/g, "")) || 0;
        setLocal(parsed === 0 ? "" : String(parsed));
        onChange(parsed);
      }}
    />
  );
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: "auto" | "manual" }) {
  return source === "auto"
    ? <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 text-blue-600 border-blue-300">Auto</Badge>
    : <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 text-amber-600 border-amber-300">Manual</Badge>;
}

// ─── Custom-row inline editor ─────────────────────────────────────────────────

function CustomRowEditor({
  row, cyVal, pyVal, isPatternA,
  cyLtVal, cyStVal, pyLtVal, pyStVal,
  onChangeCy, onChangePy, onChangeCyLt, onChangeCySt, onChangePyLt, onChangePySt,
  onChangeLabel, onDelete,
}: {
  row: NCECustomRow;
  cyVal: number; pyVal: number;
  isPatternA: boolean;
  cyLtVal: number; cyStVal: number; pyLtVal: number; pyStVal: number;
  onChangeCy: (v: number) => void; onChangePy: (v: number) => void;
  onChangeCyLt: (v: number) => void; onChangeCySt: (v: number) => void;
  onChangePyLt: (v: number) => void; onChangePySt: (v: number) => void;
  onChangeLabel: (s: string) => void; onDelete: () => void;
}) {
  return (
    <TableRow className="bg-blue-50/30 hover:bg-blue-50/50">
      <TableCell className={cn("p-1", isPatternA && "border-r")}>
        <div className="flex items-center gap-1 min-w-0">
          <Input
            value={row.label}
            onChange={e => onChangeLabel(e.target.value)}
            className="h-6 text-xs px-1.5 min-w-[120px]"
            placeholder="Row description"
          />
          <SourceBadge source={row.source} />
        </div>
      </TableCell>
      {isPatternA ? (
        <>
          <TableCell className="p-1"><NumInput value={cyLtVal} onChange={onChangeCyLt} /></TableCell>
          <TableCell className="p-1 border-r"><NumInput value={pyLtVal} onChange={onChangePyLt} /></TableCell>
          <TableCell className="p-1"><NumInput value={cyStVal} onChange={onChangeCySt} /></TableCell>
          <TableCell className="p-1"><NumInput value={pyStVal} onChange={onChangePySt} /></TableCell>
        </>
      ) : (
        <>
          <TableCell className="p-1"><NumInput value={cyVal} onChange={onChangeCy} /></TableCell>
          <TableCell className="p-1"><NumInput value={pyVal} onChange={onChangePy} /></TableCell>
        </>
      )}
      <TableCell className="p-1 text-center w-8">
        <button type="button" onClick={onDelete}
          className="text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </TableCell>
    </TableRow>
  );
}

// ─── Pattern B table ──────────────────────────────────────────────────────────

function PatternBTable({
  config, cy: rawCy, py: rawPy, cyYear, pyYear,
  customRows, onChangeCy, onChangePy, onAddRow, onDeleteRow, onChangeLabel,
}: {
  config:       NoteConfig;
  cy:           Record<string, number>;
  py:           Record<string, number>;
  cyYear:       number; pyYear: number;
  customRows:   NCECustomRow[];
  onChangeCy:   (key: string, v: number) => void;
  onChangePy:   (key: string, v: number) => void;
  onAddRow:     () => void;
  onDeleteRow:  (id: string) => void;
  onChangeLabel:(id: string, label: string) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/30">
          <TableHead className="text-xs w-[52%]">Particulars</TableHead>
          <TableHead className="text-xs text-right w-[21%]">31 Mar {cyYear} (₹)</TableHead>
          <TableHead className="text-xs text-right w-[21%]">31 Mar {pyYear} (₹)</TableHead>
          <TableHead className="w-[6%]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {config.rows.map((row, idx) => {
          const insertCustomBefore = idx === grandTotalIdx;
          return (
            <>
              {/* Custom rows inserted just before grand total */}
              {insertCustomBefore && customRows.map(cr => (
                <CustomRowEditor
                  key={cr.id}
                  row={cr}
                  cyVal={rawCy[cr.id] ?? 0}
                  pyVal={rawPy[cr.id] ?? 0}
                  isPatternA={false}
                  cyLtVal={0} cyStVal={0} pyLtVal={0} pyStVal={0}
                  onChangeCy={v => onChangeCy(cr.id, v)}
                  onChangePy={v => onChangePy(cr.id, v)}
                  onChangeCyLt={() => {}} onChangeCySt={() => {}}
                  onChangePyLt={() => {}} onChangePySt={() => {}}
                  onChangeLabel={label => onChangeLabel(cr.id, label)}
                  onDelete={() => onDeleteRow(cr.id)}
                />
              ))}

              {row.isSectionHeader ? (
                <TableRow key={row.id} className="bg-muted/20">
                  <TableCell colSpan={4} className={cn("text-xs font-semibold py-1.5 text-muted-foreground", indentCls(row.indent))}>
                    {row.label}
                  </TableCell>
                </TableRow>
              ) : row.isTotal ? (
                <TableRow key={row.id} className="bg-muted/10 border-t-2 border-border/40">
                  <TableCell className={cn("text-xs font-bold py-1.5", indentCls(row.indent))}>{row.label}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold">{fmtNum(cy[row.id] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold">{fmtNum(py[row.id] ?? 0)}</TableCell>
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
        {/* Add row */}
        <TableRow>
          <TableCell colSpan={4} className="py-1.5 px-3">
            <Button type="button" size="sm" variant="ghost"
              className="h-6 text-xs text-muted-foreground gap-1 hover:text-foreground"
              onClick={onAddRow}>
              <Plus className="h-3 w-3" /> Add row
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

// ─── Pattern A table ──────────────────────────────────────────────────────────

function PatternATable({
  config, cy: rawCy, py: rawPy, cyYear, pyYear,
  customRows, onChangeCy, onChangePy, onAddRow, onDeleteRow, onChangeLabel,
}: {
  config:       NoteConfig;
  cy:           Record<string, number>;
  py:           Record<string, number>;
  cyYear:       number; pyYear: number;
  customRows:   NCECustomRow[];
  onChangeCy:   (key: string, v: number) => void;
  onChangePy:   (key: string, v: number) => void;
  onAddRow:     () => void;
  onDeleteRow:  (id: string) => void;
  onChangeLabel:(id: string, label: string) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);

  // Group custom rows by section (for section-aware insertion in Pattern A)
  const customBySection = useMemo(() => {
    const groups: Record<string, NCECustomRow[]> = { _global: [] };
    for (const cr of customRows) {
      const key = cr.section ?? "_global";
      if (!groups[key]) groups[key] = [];
      groups[key].push(cr);
    }
    return groups;
  }, [customRows]);

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/30">
          <TableHead rowSpan={2} className="text-xs w-[26%] align-bottom border-r">Particulars</TableHead>
          <TableHead colSpan={2} className="text-xs text-center border-r border-b-0">Long Term (₹)</TableHead>
          <TableHead colSpan={2} className="text-xs text-center border-b-0">Short Term (₹)</TableHead>
          <TableHead rowSpan={2} className="w-[5%]" />
        </TableRow>
        <TableRow className="bg-muted/30">
          <TableHead className="text-xs text-right">31 Mar {cyYear}</TableHead>
          <TableHead className="text-xs text-right border-r">31 Mar {pyYear}</TableHead>
          <TableHead className="text-xs text-right">31 Mar {cyYear}</TableHead>
          <TableHead className="text-xs text-right">31 Mar {pyYear}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {config.rows.map((row, idx) => {
          // Determine which custom rows to render before this row:
          //  • If this is a section-total (has sectionTag) → rows with that section
          //  • If this is the grand-total (last isTotal) → global (untagged) rows
          const sectionRows: NCECustomRow[] = row.sectionTag
            ? (customBySection[row.sectionTag] ?? [])
            : idx === grandTotalIdx
              ? (customBySection["_global"] ?? [])
              : [];
          return (
            <>
              {sectionRows.map(cr => (
                <CustomRowEditor
                  key={cr.id}
                  row={cr}
                  cyVal={0} pyVal={0}
                  isPatternA={true}
                  cyLtVal={rawCy[cr.id + "_lt"] ?? 0}
                  cyStVal={rawCy[cr.id + "_st"] ?? 0}
                  pyLtVal={rawPy[cr.id + "_lt"] ?? 0}
                  pyStVal={rawPy[cr.id + "_st"] ?? 0}
                  onChangeCy={() => {}} onChangePy={() => {}}
                  onChangeCyLt={v => onChangeCy(cr.id + "_lt", v)}
                  onChangeCySt={v => onChangeCy(cr.id + "_st", v)}
                  onChangePyLt={v => onChangePy(cr.id + "_lt", v)}
                  onChangePySt={v => onChangePy(cr.id + "_st", v)}
                  onChangeLabel={label => onChangeLabel(cr.id, label)}
                  onDelete={() => onDeleteRow(cr.id)}
                />
              ))}

              {row.isSectionHeader ? (
                <TableRow key={row.id} className="bg-muted/20">
                  <TableCell colSpan={6} className={cn("text-xs font-semibold py-1.5 text-muted-foreground", indentCls(row.indent))}>
                    {row.label}
                  </TableCell>
                </TableRow>
              ) : row.isTotal ? (
                <TableRow key={row.id} className="bg-muted/10 border-t-2 border-border/40">
                  <TableCell className={cn("text-xs font-bold py-1.5 border-r", indentCls(row.indent))}>{row.label}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold">{fmtNum(cy[row.id + "_lt"] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold border-r">{fmtNum(py[row.id + "_lt"] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold">{fmtNum(cy[row.id + "_st"] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold">{fmtNum(py[row.id + "_st"] ?? 0)}</TableCell>
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
        {/* Add row */}
        <TableRow>
          <TableCell colSpan={6} className="py-1.5 px-3">
            <Button type="button" size="sm" variant="ghost"
              className="h-6 text-xs text-muted-foreground gap-1 hover:text-foreground"
              onClick={onAddRow}>
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

  // ── Persist helper ──────────────────────────────────────────────────────
  const persistNotes = useCallback(async (
    data: Record<string, NCENoteData>,
    fy:   string,
  ) => {
    const rows = NOTES_CONFIG.map(nc => {
      const d = data[nc.noteType] ?? { cy: {}, py: {}, customRows: [] };
      const { cy_data, py_data } = serialiseNoteData(d);
      return {
        engagement_id:  engagementId,
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
  }, [engagementId]);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: engRow } = await supabase
          .from("audit_engagements")
          .select("financial_year, clients(name)")
          .eq("id", engagementId)
          .single();
        if (cancelled) return;
        if (engRow) setEng(engRow);

        const fy = (engRow as any)?.financial_year ?? "";

        const { data, error } = await supabase
          .from("nce_financial_notes")
          .select("note_type, cy_data, py_data")
          .eq("engagement_id", engagementId);
        if (cancelled) return;
        if (error) throw error;

        if (data && data.length > 0) {
          // Check if any note has real data (non-empty cy_data)
          const hasData = data.some(r => {
            const raw = r.cy_data as Record<string, any> ?? {};
            return Object.keys(raw).filter(k => k !== "_custom_rows").length > 0 ||
                   (Array.isArray(raw._custom_rows) && raw._custom_rows.length > 0);
          });

          const built: Record<string, NCENoteData> = {};
          for (const row of data) {
            built[row.note_type] = deserialiseNoteData(
              (row.cy_data as Record<string, any>) || {},
              (row.py_data as Record<string, any>) || {},
            );
          }

          if (!hasData) {
            // Rows exist but are all empty — re-run auto-populate
            const populated = await nceAutoPopulate(engagementId, built);
            if (!cancelled) setNoteData(populated);
            await persistNotes(populated, fy);
            toast.success("Notes populated from COA mapping");
          } else {
            if (!cancelled) setNoteData(built);
          }
        } else {
          // First visit — auto-populate
          const populated = await nceAutoPopulate(engagementId, {});
          if (!cancelled) setNoteData(populated);
          await persistNotes(populated, fy);
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

  // ── Auto-save ───────────────────────────────────────────────────────────
  const scheduleSave = useCallback((data: Record<string, NCENoteData>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await persistNotes(data, financialYear); }
      catch (e: any) { toast.error(`Auto-save failed: ${e?.message || e}`); }
    }, 1200);
  }, [persistNotes, financialYear]);

  // ── Cell change ─────────────────────────────────────────────────────────
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

  // ── Custom row ops ──────────────────────────────────────────────────────
  const handleAddRow = useCallback((noteType: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const id  = newCustomId();
      const next = { ...prev, [noteType]: { ...cur, customRows: [...cur.customRows, { id, label: "", source: "manual" as const }] } };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const handleDeleteRow = useCallback((noteType: string, id: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const newCy = { ...cur.cy };
      const newPy = { ...cur.py };
      for (const s of ["", "_lt", "_st"]) { delete newCy[id + s]; delete newPy[id + s]; }
      const next = { ...prev, [noteType]: { cy: newCy, py: newPy, customRows: cur.customRows.filter(r => r.id !== id) } };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const handleChangeLabel = useCallback((noteType: string, id: string, label: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const next = { ...prev, [noteType]: { ...cur, customRows: cur.customRows.map(r => r.id === id ? { ...r, label, source: "manual" as const } : r) } };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  // ── Re-sync ─────────────────────────────────────────────────────────────
  const handleResync = useCallback(async () => {
    const ok = window.confirm(
      "Re-sync from COA mapping?\n\nAuto rows will be refreshed from Tally TB. " +
      "Manual rows and static-row values you entered are preserved. Click OK to continue.",
    );
    if (!ok) return;
    setSyncing(true);
    try {
      const populated = await nceAutoPopulate(engagementId, noteData);
      setNoteData(populated);
      await persistNotes(populated, financialYear);
      toast.success("Re-synced from COA mapping");
    } catch (e: any) {
      toast.error(`Re-sync failed: ${e?.message || e}`);
    } finally {
      setSyncing(false);
    }
  }, [engagementId, financialYear, noteData, persistNotes]);

  // ── Explicit save ───────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await persistNotes(noteData, financialYear);
      toast.success("Notes saved");
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading & syncing from COA…</span>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
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
          className="h-7 text-xs gap-1.5"
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Re-sync from COA
        </Button>
        <span className="text-[10px] text-muted-foreground">
          <span className="text-blue-600 font-medium">Blue = Auto</span> (re-synced from TB) ·{" "}
          <span className="text-amber-600 font-medium">Amber = Manual</span> (preserved)
        </span>
        <Button size="sm" onClick={handleSave} disabled={saving}
          className="ml-auto h-7 text-xs gap-1.5">
          {saving ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          Save All Notes
        </Button>
      </div>

      {/* All notes — always open */}
      <div className="space-y-4">
        {NOTES_CONFIG.map(nc => {
          const d          = noteData[nc.noteType] ?? { cy: {}, py: {}, customRows: [] };
          const autoCount  = d.customRows.filter(r => r.source === "auto").length;
          const manuCount  = d.customRows.filter(r => r.source === "manual").length;
          // Extract note number from title like "Note 3: Borrowings"
          const noteNum    = nc.title.match(/Note\s+([\d\s&]+):/i)?.[1]?.trim() ?? "";
          const noteTitle  = nc.title.replace(/^Note\s+[\d\s&]+:\s*/i, "");

          return (
            <NoteCard
              key={nc.noteType}
              noteNumber={noteNum}
              title={noteTitle}
              autoCount={autoCount}
              manualCount={manuCount}
            >
              <div className="overflow-x-auto">
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
                    onChangeLabel={(id, lbl) => handleChangeLabel(nc.noteType, id, lbl)}
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
                    onChangeLabel={(id, lbl) => handleChangeLabel(nc.noteType, id, lbl)}
                  />
                )}
              </div>
            </NoteCard>
          );
        })}
      </div>

      {/* Bottom save */}
      <div className="flex justify-end pt-2">
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          Save All Notes
        </Button>
      </div>
    </div>
  );
}
