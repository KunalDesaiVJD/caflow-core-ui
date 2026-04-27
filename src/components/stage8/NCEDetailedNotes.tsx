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

import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
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
import { Loader2, Save, RefreshCw, Plus, Trash2, Search, CornerUpRight, Minus, MoreVertical } from "lucide-react";
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

// ─── Note card (collapsible) ──────────────────────────────────────────────────

function NoteCard({
  noteNumber, title, autoCount, manualCount, children, collapseControl,
}: {
  noteNumber: string;
  title:      string;
  autoCount:  number;
  manualCount: number;
  children:   React.ReactNode;
  collapseControl?: boolean;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (collapseControl !== undefined) setOpen(!collapseControl);
  }, [collapseControl]);
  return (
    <div id={`nce-note-${noteNumber}`} className="border rounded-lg overflow-hidden bg-background">
      {/* Header strip — click to collapse/expand */}
      <div
        className="bg-muted/40 px-4 py-2 border-b flex items-center gap-2 flex-wrap cursor-pointer select-none hover:bg-muted/60 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {/* +/- toggle */}
        <button
          type="button"
          className="w-5 h-5 flex items-center justify-center rounded border border-muted-foreground/30 bg-background text-muted-foreground hover:bg-muted shrink-0"
          tabIndex={-1}
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? <Minus className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
        </button>
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
      {open && children}
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

// ─── Row actions menu (⋮) — Move to / Add separate row / Delete ──────────────

function RowActionsMenu({
  headingOptions, onPromote, onDelete, onAddRow,
}: {
  headingOptions: { id: string; label: string }[];
  onPromote:      (id: string) => void;
  onDelete:       () => void;
  onAddRow?:      () => void;
}) {
  const [open,     setOpen]     = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [search,   setSearch]   = useState("");

  const filtered = useMemo(() =>
    search
      ? headingOptions.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
      : headingOptions,
    [headingOptions, search],
  );

  const closeAll = () => { setOpen(false); setShowMove(false); setSearch(""); };

  return (
    <Popover open={open} onOpenChange={v => { setOpen(v); if (!v) { setShowMove(false); setSearch(""); } }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Row actions"
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-52 p-1">
        {showMove ? (
          /* Move-to search panel */
          <>
            <button
              type="button"
              className="w-full text-left px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted flex items-center gap-1 mb-0.5"
              onClick={() => { setShowMove(false); setSearch(""); }}
            >
              ← Back
            </button>
            <div className="relative mb-1 px-0.5">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <Input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search heading…"
                className="h-6 text-xs pl-6"
              />
            </div>
            <div className="max-h-40 overflow-auto space-y-0.5">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-1 italic">No match</p>
              ) : filtered.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted transition-colors"
                  onMouseDown={e => { e.preventDefault(); onPromote(opt.id); closeAll(); }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          /* Main action list */
          <div className="space-y-0.5">
            {headingOptions.length > 0 && (
              <button
                type="button"
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted flex items-center gap-1.5 transition-colors"
                onClick={() => setShowMove(true)}
              >
                <CornerUpRight className="h-3 w-3 shrink-0" /> Move to…
              </button>
            )}
            {onAddRow && (
              <button
                type="button"
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted flex items-center gap-1.5 transition-colors"
                onClick={() => { onAddRow(); closeAll(); }}
              >
                <Plus className="h-3 w-3 shrink-0" /> Add separate row
              </button>
            )}
            <div className="border-t my-0.5" />
            <button
              type="button"
              className="w-full text-left px-2 py-1 rounded text-xs hover:bg-red-50 text-destructive flex items-center gap-1.5 transition-colors"
              onClick={() => { onDelete(); closeAll(); }}
            >
              <Trash2 className="h-3 w-3 shrink-0" /> Delete row
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Custom-row inline editor ─────────────────────────────────────────────────

function CustomRowEditor({
  row, cyVal, pyVal, isPatternA,
  cyLtVal, cyStVal, pyLtVal, pyStVal,
  onChangeCy, onChangePy, onChangeCyLt, onChangeCySt, onChangePyLt, onChangePySt,
  onChangeLabel, onDelete, headingOptions, onPromote, onEjectCustomSource, onAddRow,
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
  onEjectCustomSource?: (ledger: string, amountCy: number) => void;
  onAddRow?: () => void;
}) {
  const hasSources = (row.sources?.length ?? 0) > 0;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const colCount = isPatternA ? 6 : 4;
  return (
    <>
      <TableRow className="bg-blue-50/30 hover:bg-blue-50/50">
        <TableCell className={cn("p-1", isPatternA && "border-r")}>
          <div className="flex items-center gap-1 min-w-0">
            {/* +/- toggle for merged/source ledgers */}
            {hasSources ? (
              <button
                type="button"
                className="w-5 h-5 flex items-center justify-center rounded border border-blue-300 bg-background text-blue-600 hover:bg-blue-50 shrink-0"
                onClick={() => setSourcesOpen(o => !o)}
                title={sourcesOpen ? "Collapse source ledgers" : "Expand source ledgers"}
              >
                {sourcesOpen ? <Minus className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
              </button>
            ) : (
              <div className="w-5 shrink-0" />
            )}
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
          <RowActionsMenu
            headingOptions={headingOptions}
            onPromote={onPromote}
            onDelete={onDelete}
            onAddRow={onAddRow}
          />
        </TableCell>
      </TableRow>

      {/* Inline source-ledger sub-rows */}
      {hasSources && sourcesOpen && row.sources!.map((s, i) => (
        <TableRow key={i} className="bg-blue-50/10 hover:bg-blue-50/20">
          <TableCell className={cn("py-0.5 pl-10 pr-1 text-xs text-muted-foreground", isPatternA && "border-r")}>
            <div className="flex items-center gap-1.5">
              <span className="truncate flex-1 italic">
                {s.ledger}
                {s.column && (
                  <span className="text-[9px] uppercase ml-1 font-semibold not-italic">
                    [{s.column}]
                  </span>
                )}
              </span>
              {onEjectCustomSource && (
                <button
                  type="button"
                  title={`Move "${s.ledger}" to its own row`}
                  onClick={() => onEjectCustomSource(s.ledger, s.amountCy)}
                  className="shrink-0 text-indigo-500 hover:text-indigo-700 transition-colors"
                >
                  <CornerUpRight className="h-3 w-3" />
                </button>
              )}
            </div>
          </TableCell>
          {isPatternA ? (
            <>
              <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                {s.column === "lt" ? fmtNum(s.amountCy) : "—"}
              </TableCell>
              <TableCell className="py-0.5 border-r" />
              <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                {s.column === "st" ? fmtNum(s.amountCy) : "—"}
              </TableCell>
              <TableCell className="py-0.5" />
            </>
          ) : (
            <>
              <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                {fmtNum(s.amountCy)}
              </TableCell>
              <TableCell className="py-0.5" />
            </>
          )}
          <TableCell className="py-0.5" />
        </TableRow>
      ))}
    </>
  );
}

// ─── Pattern B table ──────────────────────────────────────────────────────────

function PatternBTable({
  config, cy: rawCy, py: rawPy, cyYear, pyYear,
  customRows, hiddenRows, labelOverrides, cySources,
  onChangeCy, onChangePy, onAddRow, onDeleteRow, onChangeLabel,
  onHideStatic, onChangeStaticLabel, onPromote, onEjectSource, onEjectCustomSource,
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
  onEjectCustomSource:(customRowId: string, ledger: string, amount: number) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);
  // Track which static rows have their source-ledger list expanded
  const [openSources, setOpenSources] = useState<Set<string>>(new Set());
  const toggleSources = (id: string) => setOpenSources(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const staticHeadingOptions = useMemo(
    () => config.rows
      .filter(r => !r.isSectionHeader && !r.isTotal && !hiddenRows.includes(r.id))
      .map(r => ({ id: r.id, label: labelOverrides[r.id] ?? r.label })),
    [config, hiddenRows, labelOverrides],
  );
  // Include OTHER custom rows so "Site Expense - 18%" can move under "Site Expense"
  const allHeadingOptions = useMemo(
    () => [
      ...staticHeadingOptions,
      ...customRows.map(cr => ({ id: cr.id, label: cr.label || "(unnamed row)" })),
    ],
    [staticHeadingOptions, customRows],
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
          // Only truly top-level (no parent). Custom rows attached to OTHER custom rows
          // are rendered beneath their custom parent row below.
          const unattachedAtGrand = customRows.filter(cr => !cr.attachedTo);
          return (
            <>
              {/* Custom rows just before grand total */}
              {insertCustomBefore && unattachedAtGrand.map(cr => {
                // Custom rows "promoted" to sit under THIS custom row
                const customSubRows = customRows.filter(sub => sub.attachedTo === cr.id);
                return (
                  <Fragment key={cr.id}>
                    <CustomRowEditor
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
                      headingOptions={allHeadingOptions.filter(o => o.id !== cr.id)}
                      onPromote={(targetId) => onPromote(cr.id, targetId)}
                      onEjectCustomSource={(ledger, amt) => onEjectCustomSource(cr.id, ledger, amt)}
                      onAddRow={onAddRow}
                    />
                    {customSubRows.map(sub => (
                      <CustomRowEditor
                        key={sub.id}
                        row={sub}
                        cyVal={rawCy[sub.id] ?? 0}
                        pyVal={rawPy[sub.id] ?? 0}
                        isPatternA={false}
                        cyLtVal={0} cyStVal={0} pyLtVal={0} pyStVal={0}
                        onChangeCy={v => onChangeCy(sub.id, v)}
                        onChangePy={v => onChangePy(sub.id, v)}
                        onChangeCyLt={() => {}} onChangeCySt={() => {}}
                        onChangePyLt={() => {}} onChangePySt={() => {}}
                        onChangeLabel={label => onChangeLabel(sub.id, label)}
                        onDelete={() => onDeleteRow(sub.id)}
                        headingOptions={allHeadingOptions.filter(o => o.id !== sub.id)}
                        onPromote={(targetId) => onPromote(sub.id, targetId)}
                        onEjectCustomSource={(ledger, amt) => onEjectCustomSource(sub.id, ledger, amt)}
                        onAddRow={onAddRow}
                      />
                    ))}
                  </Fragment>
                );
              })}

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
                      {/* +/- expand for mapped Tally ledgers */}
                      {(cySources[row.id]?.length ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="w-5 h-5 flex items-center justify-center rounded border border-muted-foreground/30 bg-background text-muted-foreground hover:bg-muted shrink-0"
                          onClick={() => toggleSources(row.id)}
                          title={openSources.has(row.id) ? "Collapse mapped ledgers" : "Expand mapped ledgers"}
                        >
                          {openSources.has(row.id) ? <Minus className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
                        </button>
                      ) : (
                        <div className="w-5 shrink-0" />
                      )}
                      <Input
                        value={displayLabel}
                        onChange={e => onChangeStaticLabel(row.id, e.target.value)}
                        className="h-6 text-xs px-1.5 border-transparent hover:border-input focus:border-input bg-transparent"
                      />
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

              {/* Inline source-ledger sub-rows for static rows */}
              {!row.isSectionHeader && !row.isTotal && openSources.has(row.id) &&
                cySources[row.id]?.map((s, i) => (
                  <TableRow key={i} className="bg-muted/5 hover:bg-muted/10">
                    <TableCell className="py-0.5 pl-10 pr-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate flex-1 italic">{s.ledger}</span>
                        <button
                          type="button"
                          title={`Move "${s.ledger}" to its own row`}
                          onClick={() => onEjectSource(row.id, s.ledger, s.amountCy)}
                          className="shrink-0 text-indigo-500 hover:text-indigo-700 transition-colors"
                        >
                          <CornerUpRight className="h-3 w-3" />
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                      {fmtNum(s.amountCy)}
                    </TableCell>
                    <TableCell className="py-0.5" />
                    <TableCell className="py-0.5" />
                  </TableRow>
                ))
              }

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
                  headingOptions={allHeadingOptions.filter(o => o.id !== cr.id && o.id !== row.id)}
                  onPromote={(targetId) => onPromote(cr.id, targetId)}
                  onEjectCustomSource={(ledger, amt) => onEjectCustomSource(cr.id, ledger, amt)}
                  onAddRow={onAddRow}
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
  onHideStatic, onChangeStaticLabel, onPromote, onEjectSource, onEjectCustomSource,
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
  onEjectCustomSource:(customRowId: string, ledger: string, amount: number) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);
  // Track which static rows have their source-ledger list expanded
  const [openSources, setOpenSources] = useState<Set<string>>(new Set());
  const toggleSources = (id: string) => setOpenSources(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

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

  const staticHeadingOptions = useMemo(
    () => config.rows
      .filter(r => !r.isSectionHeader && !r.isTotal && !hiddenRows.includes(r.id))
      .map(r => ({ id: r.id, label: labelOverrides[r.id] ?? r.label })),
    [config, hiddenRows, labelOverrides],
  );
  // Include custom rows in dropdown so items can move under other custom rows
  const allHeadingOptions = useMemo(
    () => [
      ...staticHeadingOptions,
      ...customRows.map(cr => ({ id: cr.id, label: cr.label || "(unnamed row)" })),
    ],
    [staticHeadingOptions, customRows],
  );
  // Keep backward-compatible alias for filter expressions below
  const headingOptions = staticHeadingOptions;

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
          // but include all custom rows so rows can be grouped under other custom rows
          const sectionHeadingOptions = row.sectionTag
            ? allHeadingOptions.filter(opt => !sectionStaticIds[row.sectionTag!]?.has(opt.id))
            : allHeadingOptions;
          const attachedHere = !row.isSectionHeader && !row.isTotal
            ? customRows.filter(cr => cr.attachedTo === row.id)
            : [];
          const displayLabel = labelOverrides[row.id] ?? row.label;
          return (
            <>
              {sectionRows.map(cr => {
                const customSubRows = customRows.filter(sub => sub.attachedTo === cr.id);
                return (
                  <Fragment key={cr.id}>
                    <CustomRowEditor
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
                      headingOptions={sectionHeadingOptions.filter(o => o.id !== cr.id)}
                      onPromote={(targetId) => onPromote(cr.id, targetId)}
                      onEjectCustomSource={(ledger, amt) => onEjectCustomSource(cr.id, ledger, amt)}
                      onAddRow={onAddRow}
                    />
                    {customSubRows.map(sub => (
                      <CustomRowEditor
                        key={sub.id}
                        row={sub}
                        cyVal={0} pyVal={0}
                        isPatternA={true}
                        cyLtVal={rawCy[sub.id + "_lt"] ?? 0}
                        cyStVal={rawCy[sub.id + "_st"] ?? 0}
                        pyLtVal={rawPy[sub.id + "_lt"] ?? 0}
                        pyStVal={rawPy[sub.id + "_st"] ?? 0}
                        onChangeCy={() => {}} onChangePy={() => {}}
                        onChangeCyLt={v => onChangeCy(sub.id + "_lt", v)}
                        onChangeCySt={v => onChangeCy(sub.id + "_st", v)}
                        onChangePyLt={v => onChangePy(sub.id + "_lt", v)}
                        onChangePySt={v => onChangePy(sub.id + "_st", v)}
                        onChangeLabel={label => onChangeLabel(sub.id, label)}
                        onDelete={() => onDeleteRow(sub.id)}
                        headingOptions={sectionHeadingOptions.filter(o => o.id !== sub.id)}
                        onPromote={(targetId) => onPromote(sub.id, targetId)}
                        onEjectCustomSource={(ledger, amt) => onEjectCustomSource(sub.id, ledger, amt)}
                        onAddRow={onAddRow}
                      />
                    ))}
                  </Fragment>
                );
              })}

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
                      {/* +/- expand for mapped Tally ledgers */}
                      {(cySources[row.id]?.length ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="w-5 h-5 flex items-center justify-center rounded border border-muted-foreground/30 bg-background text-muted-foreground hover:bg-muted shrink-0"
                          onClick={() => toggleSources(row.id)}
                          title={openSources.has(row.id) ? "Collapse mapped ledgers" : "Expand mapped ledgers"}
                        >
                          {openSources.has(row.id) ? <Minus className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
                        </button>
                      ) : (
                        <div className="w-5 shrink-0" />
                      )}
                      <Input
                        value={displayLabel}
                        onChange={e => onChangeStaticLabel(row.id, e.target.value)}
                        className="h-6 text-xs px-1.5 border-transparent hover:border-input focus:border-input bg-transparent"
                      />
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

              {/* Inline source-ledger sub-rows for Pattern A static rows */}
              {!row.isSectionHeader && !row.isTotal && openSources.has(row.id) &&
                cySources[row.id]?.map((s, i) => (
                  <TableRow key={i} className="bg-muted/5 hover:bg-muted/10">
                    <TableCell className="py-0.5 pl-10 pr-1 text-xs text-muted-foreground border-r">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate flex-1 italic">
                          {s.ledger}
                          {(s as any).column && (
                            <span className="text-[9px] uppercase ml-1 font-semibold not-italic">[{(s as any).column}]</span>
                          )}
                        </span>
                        <button
                          type="button"
                          title={`Move "${s.ledger}" to its own row`}
                          onClick={() => onEjectSource(row.id, s.ledger, s.amountCy)}
                          className="shrink-0 text-indigo-500 hover:text-indigo-700 transition-colors"
                        >
                          <CornerUpRight className="h-3 w-3" />
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                      {(s as any).column === "lt" || !(s as any).column ? fmtNum(s.amountCy) : "—"}
                    </TableCell>
                    <TableCell className="py-0.5 border-r" />
                    <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                      {(s as any).column === "st" ? fmtNum(s.amountCy) : "—"}
                    </TableCell>
                    <TableCell className="py-0.5" />
                    <TableCell className="py-0.5" />
                  </TableRow>
                ))
              }

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
                  headingOptions={allHeadingOptions.filter(o => o.id !== cr.id && o.id !== row.id)}
                  onPromote={(targetId) => onPromote(cr.id, targetId)}
                  onEjectCustomSource={(ledger, amt) => onEjectCustomSource(cr.id, ledger, amt)}
                  onAddRow={onAddRow}
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
  const [noteData,    setNoteData]    = useState<Record<string, NCENoteData>>({});
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [syncing,     setSyncing]     = useState(false);
  const [eng,         setEng]         = useState<any>(null);
  // undefined = uncontrolled; true = all collapsed; false = all expanded
  const [collapseAll, setCollapseAll] = useState<boolean | undefined>(undefined);
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
      const sourceEntry = (newCySources[rowId] ?? []).find(s => s.ledger === ledger);
      const column = (sourceEntry as any)?.column as string | undefined;
      const remaining = (newCySources[rowId] ?? []).filter(s => s.ledger !== ledger);
      if (remaining.length === 0) delete newCySources[rowId];
      else newCySources[rowId] = remaining;
      // 2. Subtract amount from static row's CY (plain + Pattern-A suffixed keys)
      const newCy = { ...cur.cy };
      newCy[rowId] = Math.max(0, (cur.cy[rowId] ?? 0) - amount);
      if (column === "lt") newCy[rowId + "_lt"] = Math.max(0, (cur.cy[rowId + "_lt"] ?? 0) - amount);
      if (column === "st") newCy[rowId + "_st"] = Math.max(0, (cur.cy[rowId + "_st"] ?? 0) - amount);
      // 3. Create new custom row with that ledger name + amount
      const newId = newCustomId();
      const newRow: NCECustomRow = { id: newId, label: ledger, source: "auto" };
      newCy[newId] = amount;
      // For Pattern A notes, also store with the column suffix so computeDisplayData picks it up
      if (column === "lt") newCy[newId + "_lt"] = amount;
      if (column === "st") newCy[newId + "_st"] = amount;
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

  // Eject a source ledger from a CUSTOM (auto/merged) row → new standalone custom row
  const handleEjectCustomSource = useCallback((noteType: string, customRowId: string, ledger: string, amountCy: number) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      // Find the source entry to get its column (Pattern A: "lt" | "st")
      const sourceEntry = cur.customRows.find(r => r.id === customRowId)?.sources?.find(s => s.ledger === ledger);
      const column = (sourceEntry as any)?.column as string | undefined;
      // Remove the ledger from the custom row's sources[]
      const updatedRows = cur.customRows.map(r => {
        if (r.id !== customRowId) return r;
        const newSources = (r.sources ?? []).filter(s => s.ledger !== ledger);
        return { ...r, sources: newSources };
      });
      // Subtract from the merged row's CY amount (plain + Pattern-A suffixed keys)
      const newCy = { ...cur.cy };
      newCy[customRowId] = Math.max(0, (cur.cy[customRowId] ?? 0) - amountCy);
      if (column === "lt") newCy[customRowId + "_lt"] = Math.max(0, (cur.cy[customRowId + "_lt"] ?? 0) - amountCy);
      if (column === "st") newCy[customRowId + "_st"] = Math.max(0, (cur.cy[customRowId + "_st"] ?? 0) - amountCy);
      // Create new standalone custom row for this ledger
      const newId = newCustomId();
      newCy[newId] = amountCy;
      // For Pattern A notes, also store with the column suffix so computeDisplayData picks it up
      if (column === "lt") newCy[newId + "_lt"] = amountCy;
      if (column === "st") newCy[newId + "_st"] = amountCy;
      const newRow: NCECustomRow = { id: newId, label: ledger, source: "auto" };
      const next = { ...prev, [noteType]: { ...cur, cy: newCy, customRows: [...updatedRows, newRow] } };
      scheduleSave(next);
      return next;
    });
    toast.success(`"${ledger}" moved to its own row`);
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
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button" size="sm" variant="ghost"
            onClick={() => setCollapseAll(false)}
            className="h-7 text-xs gap-1"
            title="Expand all note cards"
          >
            <Plus className="w-3 h-3" /> Expand All
          </Button>
          <Button
            type="button" size="sm" variant="ghost"
            onClick={() => setCollapseAll(true)}
            className="h-7 text-xs gap-1"
            title="Collapse all note cards"
          >
            <Minus className="w-3 h-3" /> Collapse All
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}
            className="h-7 text-xs gap-1.5">
            {saving ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            Save All Notes
          </Button>
        </div>
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
              collapseControl={collapseAll}
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
                    onEjectCustomSource={(cid, ledger, amt) => handleEjectCustomSource(nc.noteType, cid, ledger, amt)}
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
                    onEjectCustomSource={(cid, ledger, amt) => handleEjectCustomSource(nc.noteType, cid, ledger, amt)}
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
