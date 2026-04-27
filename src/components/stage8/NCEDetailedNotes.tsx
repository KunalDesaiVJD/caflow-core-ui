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
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast }       from "sonner";
import { Loader2, Save, RefreshCw, Plus, Trash2, Info, Search, CornerUpRight } from "lucide-react";
import { cn }          from "@/lib/utils";
import {
  NoteConfig, NoteRowDef, NOTES_CONFIG, computeDisplayData,
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

// ─── Searchable "Move to..." combobox ────────────────────────────────────────

function MoveToCombobox({
  options, onSelect,
}: { options: { id: string; label: string }[]; onSelect: (id: string) => void }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() =>
    search
      ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
      : options,
    [options, search]
  );

  return (
    <Popover open={open} onOpenChange={v => { setOpen(v); if (!v) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-6 text-[10px] px-1.5 w-[110px] shrink-0 border rounded flex items-center justify-between gap-1 bg-background hover:bg-muted transition-colors"
        >
          <span className="truncate text-muted-foreground">Move to…</span>
          <Search className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-60 p-1.5">
        <div className="relative mb-1">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search heading…"
            className="h-6 text-xs pl-6"
          />
        </div>
        <div className="max-h-48 overflow-auto space-y-0.5">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-1 italic">No match</p>
          ) : (
            filtered.map(opt => (
              <button
                key={opt.id}
                type="button"
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted transition-colors"
                onMouseDown={e => { e.preventDefault(); onSelect(opt.id); setOpen(false); setSearch(""); }}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Custom-row inline editor ─────────────────────────────────────────────────

function CustomRowEditor({
  row, cyVal, pyVal, isPatternA,
  cyLtVal, cyStVal, pyLtVal, pyStVal,
  onChangeCy, onChangePy, onChangeCyLt, onChangeCySt, onChangePyLt, onChangePySt,
  onChangeLabel, onDelete, headingOptions, onPromote,
}: {
  row: NCECustomRow;
  cyVal: number; pyVal: number;
  isPatternA: boolean;
  cyLtVal: number; cyStVal: number; pyLtVal: number; pyStVal: number;
  onChangeCy: (v: number) => void; onChangePy: (v: number) => void;
  onChangeCyLt: (v: number) => void; onChangeCySt: (v: number) => void;
  onChangePyLt: (v: number) => void; onChangePySt: (v: number) => void;
  onChangeLabel: (s: string) => void; onDelete: () => void;
  headingOptions: { id: string; label: string }[];
  onPromote: (staticId: string) => void;
}) {
  const merged = row.sources && row.sources.length > 1;
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
          {merged && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button"
                  className="text-blue-600 hover:text-blue-800 shrink-0"
                  title="View merged ledgers">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2 text-xs" align="start">
                <div className="font-semibold mb-1">Merged ledgers ({row.sources!.length}):</div>
                <ul className="space-y-0.5">
                  {row.sources!.map((s, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">
                        {s.ledger}
                        {s.column && <span className="text-muted-foreground ml-1">[{s.column.toUpperCase()}]</span>}
                      </span>
                      <span className="tabular-nums shrink-0">{fmtNum(s.amountCy)}</span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
          {headingOptions.length > 0 && (
            <MoveToCombobox options={headingOptions} onSelect={onPromote} />
          )}
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
  customRows, hiddenRows, labelOverrides, cySources,
  onChangeCy, onChangePy, onAddRow, onDeleteRow, onChangeLabel,
  onHideStatic, onChangeStaticLabel, onPromote, onEjectSource,
}: {
  config:       NoteConfig;
  cy:           Record<string, number>;
  py:           Record<string, number>;
  cyYear:       number; pyYear: number;
  customRows:   NCECustomRow[];
  hiddenRows:   string[];
  labelOverrides: Record<string, string>;
  cySources:    Record<string, { ledger: string; amountCy: number }[]>;
  onChangeCy:   (key: string, v: number) => void;
  onChangePy:   (key: string, v: number) => void;
  onAddRow:     () => void;
  onDeleteRow:  (id: string) => void;
  onChangeLabel:(id: string, label: string) => void;
  onHideStatic: (id: string) => void;
  onChangeStaticLabel: (id: string, label: string) => void;
  onPromote:    (customId: string, staticId: string) => void;
  onEjectSource:(rowId: string, ledger: string, amount: number) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);
  const headingOptions = useMemo(
    () => config.rows
      .filter(r => !r.isSectionHeader && !r.isTotal && !hiddenRows.includes(r.id))
      .map(r => ({ id: r.id, label: labelOverrides[r.id] ?? r.label })),
    [config, hiddenRows, labelOverrides],
  );

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
          if (!row.isSectionHeader && !row.isTotal && hiddenRows.includes(row.id)) return null;
          const insertCustomBefore = idx === grandTotalIdx;
          const displayLabel = labelOverrides[row.id] ?? row.label;
          const attachedHere = !row.isSectionHeader && !row.isTotal
            ? customRows.filter(cr => cr.attachedTo === row.id)
            : [];
          const unattachedAtGrand = customRows.filter(cr => !cr.attachedTo);
          return (
            <>
              {/* Custom rows inserted just before grand total (only those NOT attached anywhere) */}
              {insertCustomBefore && unattachedAtGrand.map(cr => (
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
                  headingOptions={headingOptions}
                  onPromote={(staticId) => onPromote(cr.id, staticId)}
                />
              ))}

              {row.isSectionHeader ? (
                <TableRow key={row.id} className="bg-muted/20">
                  <TableCell colSpan={4} className={cn("text-xs font-semibold py-1.5 text-muted-foreground", indentCls(row.indent))}>
                    {displayLabel}
                  </TableCell>
                </TableRow>
              ) : row.isTotal ? (
                <TableRow key={row.id} className="bg-muted/10 border-t-2 border-border/40">
                  <TableCell className={cn("text-xs font-bold py-1.5", indentCls(row.indent))}>{displayLabel}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold">{fmtNum(cy[row.id] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold">{fmtNum(py[row.id] ?? 0)}</TableCell>
                  <TableCell />
                </TableRow>
              ) : (
                <TableRow key={row.id} className="hover:bg-muted/10">
                  <TableCell className={cn("p-1", indentCls(row.indent))}>
                    <div className="flex items-center gap-1">
                      <Input
                        value={displayLabel}
                        onChange={e => onChangeStaticLabel(row.id, e.target.value)}
                        className="h-6 text-xs px-1.5 border-transparent hover:border-input focus:border-input bg-transparent"
                      />
                      {(cySources[row.id]?.length ?? 0) > 0 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button"
                              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                              title="View mapped ledgers">
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-80 p-3 text-xs">
                            <p className="font-semibold mb-1">
                              Mapped from Tally ({cySources[row.id].length} ledger{cySources[row.id].length > 1 ? "s" : ""}):
                            </p>
                            <p className="text-[10px] text-muted-foreground mb-2">
                              Click <CornerUpRight className="inline h-2.5 w-2.5 mx-0.5" /> to eject a ledger as its own separate row.
                            </p>
                            <ul className="space-y-1">
                              {cySources[row.id].map((s, i) => (
                                <li key={i} className="flex items-center justify-between gap-2 group">
                                  <span className="text-muted-foreground truncate flex-1">{s.ledger}</span>
                                  <span className="shrink-0 font-medium">₹{s.amountCy.toLocaleString("en-IN")}</span>
                                  {cySources[row.id].length > 1 && (
                                    <button
                                      type="button"
                                      title={`Eject "${s.ledger}" as separate row`}
                                      onClick={() => onEjectSource(row.id, s.ledger, s.amountCy)}
                                      className="shrink-0 text-muted-foreground hover:text-indigo-600 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                      <CornerUpRight className="h-3 w-3" />
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawCy[row.id] ?? 0} onChange={v => onChangeCy(row.id, v)} disabled={row.naAll} />
                  </TableCell>
                  <TableCell className="p-1">
                    <NumInput value={rawPy[row.id] ?? 0} onChange={v => onChangePy(row.id, v)} disabled={row.naAll} />
                  </TableCell>
                  <TableCell className="p-1 text-center w-8">
                    <button type="button" onClick={() => onHideStatic(row.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Hide row">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              )}

              {/* Custom rows attached under this static row */}
              {attachedHere.map(cr => (
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
                  headingOptions={headingOptions.filter(opt => opt.id !== row.id)}
                  onPromote={(staticId) => onPromote(cr.id, staticId)}
                />
              ))}
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
  customRows, hiddenRows, labelOverrides, cySources,
  onChangeCy, onChangePy, onAddRow, onDeleteRow, onChangeLabel,
  onHideStatic, onChangeStaticLabel, onPromote, onEjectSource,
}: {
  config:       NoteConfig;
  cy:           Record<string, number>;
  py:           Record<string, number>;
  cyYear:       number; pyYear: number;
  customRows:   NCECustomRow[];
  hiddenRows:   string[];
  labelOverrides: Record<string, string>;
  cySources:    Record<string, { ledger: string; amountCy: number }[]>;
  onChangeCy:   (key: string, v: number) => void;
  onChangePy:   (key: string, v: number) => void;
  onAddRow:     () => void;
  onDeleteRow:  (id: string) => void;
  onChangeLabel:(id: string, label: string) => void;
  onHideStatic: (id: string) => void;
  onChangeStaticLabel: (id: string, label: string) => void;
  onPromote:    (customId: string, staticId: string) => void;
  onEjectSource:(rowId: string, ledger: string, amount: number) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);

  // Group custom rows by section (for section-aware insertion in Pattern A).
  // Attached rows are excluded — they're rendered beneath their parent static row.
  const customBySection = useMemo(() => {
    const groups: Record<string, NCECustomRow[]> = { _global: [] };
    for (const cr of customRows) {
      if (cr.attachedTo) continue;
      const key = cr.section ?? "_global";
      if (!groups[key]) groups[key] = [];
      groups[key].push(cr);
    }
    return groups;
  }, [customRows]);

  const headingOptions = useMemo(
    () => config.rows
      .filter(r => !r.isSectionHeader && !r.isTotal && !hiddenRows.includes(r.id))
      .map(r => ({ id: r.id, label: labelOverrides[r.id] ?? r.label })),
    [config, hiddenRows, labelOverrides],
  );

  // For each sectionTag total, build the set of static-row IDs that belong
  // to that section (all non-header, non-total rows between the previous total
  // and this one). Used to exclude sibling static rows from the "Move to..."
  // dropdown when a custom row is already in that section.
  const sectionStaticIds = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    let sectionStart = 0;
    config.rows.forEach((r, i) => {
      if (r.isTotal && r.sectionTag) {
        const ids = new Set<string>();
        for (let j = sectionStart; j < i; j++) {
          const sr = config.rows[j];
          if (!sr.isSectionHeader && !sr.isTotal) ids.add(sr.id);
        }
        result[r.sectionTag] = ids;
        sectionStart = i + 1;
      }
    });
    return result;
  }, [config]);

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
          if (!row.isSectionHeader && !row.isTotal && hiddenRows.includes(row.id)) return null;
          // Determine which custom rows to render before this row:
          //  • If this is a section-total (has sectionTag) → rows with that section
          //  • If this is the grand-total (last isTotal) → global (untagged) rows
          const sectionRows: NCECustomRow[] = row.sectionTag
            ? (customBySection[row.sectionTag] ?? [])
            : idx === grandTotalIdx
              ? (customBySection["_global"] ?? [])
              : [];
          // headingOptions for sectionRows: exclude static rows in the same section
          const sectionHeadingOptions = row.sectionTag
            ? headingOptions.filter(opt => !sectionStaticIds[row.sectionTag!]?.has(opt.id))
            : headingOptions;
          const attachedHere = !row.isSectionHeader && !row.isTotal
            ? customRows.filter(cr => cr.attachedTo === row.id)
            : [];
          const displayLabel = labelOverrides[row.id] ?? row.label;
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
                  headingOptions={sectionHeadingOptions}
                  onPromote={(staticId) => onPromote(cr.id, staticId)}
                />
              ))}

              {row.isSectionHeader ? (
                <TableRow key={row.id} className="bg-muted/20">
                  <TableCell colSpan={6} className={cn("text-xs font-semibold py-1.5 text-muted-foreground", indentCls(row.indent))}>
                    {displayLabel}
                  </TableCell>
                </TableRow>
              ) : row.isTotal ? (
                <TableRow key={row.id} className="bg-muted/10 border-t-2 border-border/40">
                  <TableCell className={cn("text-xs font-bold py-1.5 border-r", indentCls(row.indent))}>{displayLabel}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold">{fmtNum(cy[row.id + "_lt"] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold border-r">{fmtNum(py[row.id + "_lt"] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold">{fmtNum(cy[row.id + "_st"] ?? 0)}</TableCell>
                  <TableCell className="text-xs text-right py-1.5 font-bold">{fmtNum(py[row.id + "_st"] ?? 0)}</TableCell>
                  <TableCell />
                </TableRow>
              ) : (
                <TableRow key={row.id} className="hover:bg-muted/10">
                  <TableCell className={cn("p-1 border-r", indentCls(row.indent))}>
                    <div className="flex items-center gap-1">
                      <Input
                        value={displayLabel}
                        onChange={e => onChangeStaticLabel(row.id, e.target.value)}
                        className="h-6 text-xs px-1.5 border-transparent hover:border-input focus:border-input bg-transparent"
                      />
                      {(cySources[row.id]?.length ?? 0) > 0 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button"
                              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                              title="View mapped ledgers">
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="right" className="w-80 p-3 text-xs">
                            <p className="font-semibold mb-1">
                              Mapped from Tally ({cySources[row.id].length} ledger{cySources[row.id].length > 1 ? "s" : ""}):
                            </p>
                            <p className="text-[10px] text-muted-foreground mb-2">
                              Click <CornerUpRight className="inline h-2.5 w-2.5 mx-0.5" /> to eject a ledger as its own separate row.
                            </p>
                            <ul className="space-y-1">
                              {cySources[row.id].map((s, i) => (
                                <li key={i} className="flex items-center justify-between gap-2 group">
                                  <span className="text-muted-foreground truncate flex-1">{s.ledger}
                                    {(s as any).column && <span className="ml-1 text-[9px] uppercase">[{(s as any).column}]</span>}
                                  </span>
                                  <span className="shrink-0 font-medium">₹{s.amountCy.toLocaleString("en-IN")}</span>
                                  {cySources[row.id].length > 1 && (
                                    <button
                                      type="button"
                                      title={`Eject "${s.ledger}" as separate row`}
                                      onClick={() => onEjectSource(row.id, s.ledger, s.amountCy)}
                                      className="shrink-0 text-muted-foreground hover:text-indigo-600 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                      <CornerUpRight className="h-3 w-3" />
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </TableCell>
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
                  <TableCell className="p-1 text-center w-8">
                    <button type="button" onClick={() => onHideStatic(row.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Hide row">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              )}

              {/* Custom rows attached under this static row */}
              {attachedHere.map(cr => (
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
                  headingOptions={headingOptions.filter(opt => opt.id !== row.id)}
                  onPromote={(staticId) => onPromote(cr.id, staticId)}
                />
              ))}
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
            // Back-fill cy_sources for engagements saved before the feature was added
            const needsCySources = Object.values(built).some(
              d => Object.keys(d.cy ?? {}).some(k => !k.startsWith("custom_")) &&
                   (!d.cy_sources || Object.keys(d.cy_sources).length === 0)
            );
            if (needsCySources) {
              // Silent background refresh — don't block the UI
              nceAutoPopulate(engagementId, built).then(refreshed => {
                if (!cancelled) setNoteData(refreshed);
                persistNotes(refreshed, fy).catch(() => {});
              }).catch(() => {}); // best-effort
            }
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

  // ── Static row hide / label override / promote custom→static ───────────
  const handleHideStatic = useCallback((noteType: string, id: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const hidden = cur.hiddenRows ?? [];
      if (hidden.includes(id)) return prev;
      const next = { ...prev, [noteType]: { ...cur, hiddenRows: [...hidden, id] } };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const handleChangeStaticLabel = useCallback((noteType: string, id: string, label: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const overrides = { ...(cur.labelOverrides ?? {}), [id]: label };
      const next = { ...prev, [noteType]: { ...cur, labelOverrides: overrides } };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const handlePromoteCustomToStatic = useCallback((noteType: string, customId: string, staticId: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      // Attach the custom row beneath the chosen static row. Amounts stay on
      // the custom row's own keys — they continue to roll up into the same
      // section/grand total via computeDisplayData. The static row itself is
      // untouched so the move is fully reversible.
      const next = { ...prev, [noteType]: {
        ...cur,
        customRows: cur.customRows.map(r =>
          r.id === customId ? { ...r, attachedTo: staticId } : r,
        ),
      } };
      scheduleSave(next);
      return next;
    });
    toast.success("Attached under selected heading");
  }, [scheduleSave]);

  // Eject a mapped Tally ledger from a static row → new custom row
  const handleEjectSource = useCallback((noteType: string, rowId: string, ledger: string, amount: number) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      // 1. Remove ledger from cy_sources
      const newCySources = { ...(cur.cy_sources ?? {}) };
      const remaining = (newCySources[rowId] ?? []).filter(s => s.ledger !== ledger);
      if (remaining.length === 0) delete newCySources[rowId];
      else newCySources[rowId] = remaining;
      // 2. Subtract amount from static row's CY
      const newCy = { ...cur.cy, [rowId]: Math.max(0, (cur.cy[rowId] ?? 0) - amount) };
      // 3. Create new custom row with that ledger name + amount
      const newId = newCustomId();
      const newRow: NCECustomRow = { id: newId, label: ledger, source: "auto" };
      newCy[newId] = amount;
      const next = { ...prev, [noteType]: {
        ...cur,
        cy: newCy,
        cy_sources: newCySources,
        customRows: [...cur.customRows, newRow],
      }};
      scheduleSave(next);
      return next;
    });
    toast.success(`"${ledger}" moved to a separate row`);
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
                    hiddenRows={d.hiddenRows ?? []}
                    labelOverrides={d.labelOverrides ?? {}}
                    cySources={d.cy_sources ?? {}}
                    onChangeCy={(key, v) => handleChange(nc.noteType, key, true,  v)}
                    onChangePy={(key, v) => handleChange(nc.noteType, key, false, v)}
                    onAddRow={() => handleAddRow(nc.noteType)}
                    onDeleteRow={id => handleDeleteRow(nc.noteType, id)}
                    onChangeLabel={(id, lbl) => handleChangeLabel(nc.noteType, id, lbl)}
                    onHideStatic={id => handleHideStatic(nc.noteType, id)}
                    onChangeStaticLabel={(id, lbl) => handleChangeStaticLabel(nc.noteType, id, lbl)}
                    onPromote={(cid, sid) => handlePromoteCustomToStatic(nc.noteType, cid, sid)}
                    onEjectSource={(rid, ledger, amt) => handleEjectSource(nc.noteType, rid, ledger, amt)}
                  />
                ) : (
                  <PatternBTable
                    config={nc}
                    cy={d.cy} py={d.py}
                    cyYear={cyYear} pyYear={pyYear}
                    customRows={d.customRows}
                    hiddenRows={d.hiddenRows ?? []}
                    labelOverrides={d.labelOverrides ?? {}}
                    cySources={d.cy_sources ?? {}}
                    onChangeCy={(key, v) => handleChange(nc.noteType, key, true,  v)}
                    onChangePy={(key, v) => handleChange(nc.noteType, key, false, v)}
                    onAddRow={() => handleAddRow(nc.noteType)}
                    onDeleteRow={id => handleDeleteRow(nc.noteType, id)}
                    onChangeLabel={(id, lbl) => handleChangeLabel(nc.noteType, id, lbl)}
                    onHideStatic={id => handleHideStatic(nc.noteType, id)}
                    onChangeStaticLabel={(id, lbl) => handleChangeStaticLabel(nc.noteType, id, lbl)}
                    onPromote={(cid, sid) => handlePromoteCustomToStatic(nc.noteType, cid, sid)}
                    onEjectSource={(rid, ledger, amt) => handleEjectSource(nc.noteType, rid, ledger, amt)}
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
