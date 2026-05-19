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
import { getDynamicNoteDisplay } from "@/lib/nceDynamicNoteNumbers";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
  /** Dynamic note number map from PipelineFinancialStatements.
   *  Maps originalNoteRef → dynamicNoteNo so NoteCard headings stay in
   *  sync with the numbers shown in the BS/PL columns.
   *  When omitted (e.g. when rendered standalone from Stage 8), falls back
   *  to parsing the static number from NOTES_CONFIG title strings. */
  dynamicNoteMap?: Map<number, number>;
}

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
  // Whole-rupee Indian formatting — Schedule III FS / Notes / Annexures must
  // never show paise (auditor-friendly). Round-half-away-from-zero so totals
  // tie to BS/PL even after individual rows are rounded.
  if (!Number.isFinite(v) || Math.abs(v) < 0.5) return "—";
  return Math.round(v).toLocaleString("en-IN", {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

function newCustomId(): string {
  return "custom_" + Math.random().toString(36).slice(2, 10);
}

// ─── Sub-ledger actions menu (single eject action) ─────────────────────────
function SubLedgerActionsMenu({
  ledger, onEject, headingOptions, onEjectAndAttach,
}: {
  ledger: string;
  onEject: () => void;
  headingOptions?: { id: string; label: string }[];
  onEjectAndAttach?: (targetId: string) => void;
}) {
  const [open,      setOpen]      = useState(false);
  const [showMove,  setShowMove]  = useState(false);
  const [search,    setSearch]    = useState("");

  const filtered = useMemo(
    () => !headingOptions ? [] : search
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
          title="Ledger actions"
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <MoreVertical className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-48 p-1">
        {showMove ? (
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
              {filtered.length === 0
                ? <p className="text-xs text-muted-foreground px-2 py-1 italic">No match</p>
                : filtered.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted transition-colors"
                    onMouseDown={e => { e.preventDefault(); onEjectAndAttach?.(opt.id); closeAll(); }}
                  >
                    {opt.label}
                  </button>
                ))
              }
            </div>
          </>
        ) : (
          <div className="space-y-0.5">
            <button
              type="button"
              className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted flex items-center gap-1.5 transition-colors"
              onClick={() => { onEject(); closeAll(); }}
            >
              <CornerUpRight className="h-3 w-3 shrink-0" /> Move to its own row
            </button>
            {headingOptions && headingOptions.length > 0 && onEjectAndAttach && (
              <button
                type="button"
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted flex items-center gap-1.5 transition-colors"
                onClick={() => setShowMove(true)}
              >
                <CornerUpRight className="h-3 w-3 shrink-0" /> Move to heading…
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Note card (collapsible) ──────────────────────────────────────────────────

function NoteCard({
  noteNumber, title, autoCount, manualCount, children, collapseControl, anchorId,
}: {
  noteNumber:  string;
  title:       string;
  autoCount:   number;
  manualCount: number;
  children:    React.ReactNode;
  collapseControl?: boolean;
  /** Stable DOM id for scroll-to-note. Falls back to noteNumber when omitted. */
  anchorId?: string;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (collapseControl !== undefined) setOpen(!collapseControl);
  }, [collapseControl]);
  return (
    <div id={anchorId ?? `nce-note-${noteNumber}`} className="border rounded-lg overflow-hidden bg-background">
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
  // Whole-rupee Indian formatting: Schedule III auditor presentation must
  // never show paise. Rounding happens both on initial display AND on blur,
  // so even if the underlying TB closing has decimals (Tally returns paise
  // on some ledgers), the displayed/saved figure is always a whole rupee.
  const formatDisplay = (v: number): string => {
    if (!Number.isFinite(v) || v === 0) return "";
    return Math.round(v).toLocaleString("en-IN", {
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
  };
  const [local, setLocal] = useState(formatDisplay(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setLocal(formatDisplay(value));
  }, [value, focused]);
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
      onFocus={() => {
        // While editing show the plain rounded integer (no commas) so typing/
        // backspace works naturally; on blur we re-apply Indian formatting.
        setFocused(true);
        const v = parseFloat(local.replace(/,/g, "")) || 0;
        setLocal(v === 0 ? "" : String(Math.round(v)));
      }}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const parsed = Math.round(parseFloat(local.replace(/,/g, "")) || 0);
        setLocal(formatDisplay(parsed));
        setFocused(false);
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
  headingOptions, onPromote, onDelete, onAddRow, onSwapLtSt,
}: {
  headingOptions: { id: string; label: string }[];
  onPromote:      (id: string) => void;
  onDelete:       () => void;
  onAddRow?:      () => void;
  /** Pattern A only: swap LT ↔ ST amounts on this custom row. */
  onSwapLtSt?:    () => void;
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
            {onSwapLtSt && (
              <button
                type="button"
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted flex items-center gap-1.5 transition-colors"
                onClick={() => { onSwapLtSt(); closeAll(); }}
                title="Swap Long-term ↔ Short-term amounts on this row"
              >
                <CornerUpRight className="h-3 w-3 shrink-0 rotate-90" /> Swap Long-term ↔ Short-term
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
  row, cyVal, pyVal, isPatternA, isChild,
  cyLtVal, cyStVal, pyLtVal, pyStVal,
  onChangeCy, onChangePy, onChangeCyLt, onChangeCySt, onChangePyLt, onChangePySt,
  onChangeLabel, onDelete, headingOptions, onPromote, onEjectCustomSource, onAddRow,
  onSwapLtSt,
  isOpen: isOpenProp, onToggle: onToggleProp, hasSubRows,
  sourceLabelOverrides, onChangeSourceLabel,
}: {
  row: NCECustomRow;
  cyVal: number; pyVal: number;
  isPatternA: boolean;
  isChild?: boolean;
  cyLtVal: number; cyStVal: number; pyLtVal: number; pyStVal: number;
  onChangeCy: (v: number) => void; onChangePy: (v: number) => void;
  onChangeCyLt: (v: number) => void; onChangeCySt: (v: number) => void;
  onChangePyLt: (v: number) => void; onChangePySt: (v: number) => void;
  onChangeLabel: (s: string) => void; onDelete: () => void;
  headingOptions: { id: string; label: string }[];
  onPromote: (staticId: string) => void;
  onEjectCustomSource?: (ledger: string, amountCy: number, attachToId?: string) => void;
  onAddRow?: () => void;
  /** Pattern A only: swap LT ↔ ST amounts on this row. */
  onSwapLtSt?: () => void;
  /** External open state — when provided, overrides internal sourcesOpen */
  isOpen?: boolean;
  /** Called when the +/- button is clicked (required when isOpen is provided) */
  onToggle?: () => void;
  /** Whether this row has attached child custom rows (so +/- shows even without Tally sources) */
  hasSubRows?: boolean;
  /** Per-ledger label overrides keyed as `${rowId}::${originalLedger}` */
  sourceLabelOverrides?: Record<string, string>;
  /** Called when user edits a source-ledger display name */
  onChangeSourceLabel?: (rowId: string, ledger: string, newLabel: string) => void;
}) {
  const hasSources = (row.sources?.length ?? 0) > 0;
  const [sourcesOpenLocal, setSourcesOpenLocal] = useState(false);
  // If parent passes isOpen/onToggle, use external state; otherwise use local
  const sourcesOpen = isOpenProp !== undefined ? isOpenProp : sourcesOpenLocal;
  const handleToggle = onToggleProp ?? (() => setSourcesOpenLocal(o => !o));
  const showToggle = hasSources || hasSubRows;
  const colCount = isPatternA ? 6 : 4;
  return (
    <>
      <TableRow className={cn("hover:bg-blue-50/50", isChild ? "bg-blue-50/10 border-l-2 border-l-blue-200" : "bg-blue-50/30")}>
        <TableCell className={cn("p-1", isPatternA && "border-r", isChild && "pl-8")}>
          <div className="flex items-center gap-1 min-w-0">
            {/* +/- toggle for merged/source ledgers and/or attached sub-rows */}
            {showToggle ? (
              <button
                type="button"
                className="w-5 h-5 flex items-center justify-center rounded border border-blue-300 bg-background text-blue-600 hover:bg-blue-50 shrink-0"
                onClick={handleToggle}
                title={sourcesOpen ? "Collapse" : "Expand"}
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
            onSwapLtSt={isPatternA ? onSwapLtSt : undefined}
          />
        </TableCell>
      </TableRow>

      {/* Inline source-ledger sub-rows */}
      {hasSources && sourcesOpen && row.sources!.map((s, i) => {
        const slKey = `${row.id}::${s.ledger}`;
        const slLabel = sourceLabelOverrides?.[slKey] ?? s.ledger;
        return (
        <TableRow key={i} className="bg-blue-50/10 border-l-2 border-l-blue-200 hover:bg-blue-50/20">
          <TableCell className={cn("py-0.5 pl-8 pr-1 text-xs text-muted-foreground", isPatternA && "border-r")}>
            <div className="flex items-center gap-1.5">
              <Input
                value={slLabel}
                onChange={e => onChangeSourceLabel?.(row.id, s.ledger, e.target.value)}
                className="h-5 text-xs px-1 border border-input/40 hover:border-input focus:border-input bg-background/50 italic flex-1 min-w-0"
                title={`Original: ${s.ledger}`}
              />
              {s.column && (
                <span className="text-[9px] uppercase shrink-0 font-semibold text-muted-foreground/60">
                  [{s.column}]
                </span>
              )}
              {onEjectCustomSource && (
                <SubLedgerActionsMenu
                  ledger={s.ledger}
                  onEject={() => onEjectCustomSource(s.ledger, s.amountCy)}
                  headingOptions={headingOptions}
                  onEjectAndAttach={(targetId) => onEjectCustomSource(s.ledger, s.amountCy, targetId)}
                />
              )}
            </div>
          </TableCell>
          {isPatternA ? (
            <>
              <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                {s.column === "lt" ? fmtNum(s.amountCy) : "—"}
              </TableCell>
              <TableCell className="py-0.5 border-r text-xs text-right text-muted-foreground tabular-nums">
                {s.column === "lt" && s.amountPy !== undefined && s.amountPy !== 0 ? fmtNum(s.amountPy) : "—"}
              </TableCell>
              <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                {s.column === "st" ? fmtNum(s.amountCy) : "—"}
              </TableCell>
              <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                {s.column === "st" && s.amountPy !== undefined && s.amountPy !== 0 ? fmtNum(s.amountPy) : "—"}
              </TableCell>
            </>
          ) : (
            <>
              <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                {fmtNum(s.amountCy)}
              </TableCell>
              <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                {s.amountPy !== undefined && s.amountPy !== 0 ? fmtNum(s.amountPy) : "—"}
              </TableCell>
            </>
          )}
          <TableCell className="py-0.5" />
        </TableRow>
        );
      })}
    </>
  );
}

// ─── Pattern B table ──────────────────────────────────────────────────────────

function PatternBTable({
  config, cy: rawCy, py: rawPy, cyYear, pyYear,
  customRows, hiddenRows, labelOverrides, cySources,
  sourceLabelOverrides,
  onChangeCy, onChangePy, onAddRow, onDeleteRow, onChangeLabel,
  onHideStatic, onChangeStaticLabel, onPromote, onEjectSource, onEjectCustomSource,
  onChangeSourceLabel,
}: {
  config:       NoteConfig;
  cy:           Record<string, number>;
  py:           Record<string, number>;
  cyYear:       number; pyYear: number;
  customRows:   NCECustomRow[];
  hiddenRows:   string[];
  labelOverrides: Record<string, string>;
  cySources:    Record<string, { ledger: string; amountCy: number; amountPy?: number; column?: "lt" | "st" }[]>;
  sourceLabelOverrides: Record<string, string>;
  onChangeCy:   (key: string, v: number) => void;
  onChangePy:   (key: string, v: number) => void;
  onAddRow:     (opts?: { section?: string; attachedTo?: string }) => void;
  onDeleteRow:  (id: string) => void;
  onChangeLabel:(id: string, label: string) => void;
  onHideStatic: (id: string) => void;
  onChangeStaticLabel: (id: string, label: string) => void;
  onPromote:    (customId: string, staticId: string) => void;
  onEjectSource:(rowId: string, ledger: string, amount: number, attachToId?: string) => void;
  onEjectCustomSource:(customRowId: string, ledger: string, amount: number, attachToId?: string) => void;
  onChangeSourceLabel: (rowId: string, ledger: string, newLabel: string) => void;
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
  // Exclude custom rows that are already attached to something (they're not standalone headings)
  const allHeadingOptions = useMemo(
    () => [
      ...staticHeadingOptions,
      ...customRows.filter(cr => !cr.attachedTo).map(cr => ({ id: cr.id, label: cr.label || "(unnamed row)" })),
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
                const crIsOpen = openSources.has(cr.id);
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
                      hasSubRows={customSubRows.length > 0}
                      isOpen={crIsOpen}
                      onToggle={() => toggleSources(cr.id)}
                      sourceLabelOverrides={sourceLabelOverrides}
                      onChangeSourceLabel={onChangeSourceLabel}
                    />
                    {customSubRows.length > 0 && crIsOpen && customSubRows.map(sub => (
                      <CustomRowEditor
                        key={sub.id}
                        row={sub}
                        cyVal={rawCy[sub.id] ?? 0}
                        pyVal={rawPy[sub.id] ?? 0}
                        isPatternA={false}
                        isChild={true}
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
                        sourceLabelOverrides={sourceLabelOverrides}
                        onChangeSourceLabel={onChangeSourceLabel}
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
              ) : (() => {
                const hasAttachedB = attachedHere.length > 0;
                const hasSrcsB = (cySources[row.id]?.filter(s => s.amountCy !== 0).length ?? 0) > 0;
                const showToggleB = hasAttachedB || hasSrcsB;
                const isOpenB = openSources.has(row.id);
                const aggCyB = (rawCy[row.id] ?? 0) + (hasAttachedB ? attachedHere.reduce((s, cr) => s + (rawCy[cr.id] ?? 0), 0) : 0);
                const aggPyB = (rawPy[row.id] ?? 0) + (hasAttachedB ? attachedHere.reduce((s, cr) => s + (rawPy[cr.id] ?? 0), 0) : 0);
                return (
                <TableRow key={row.id} className="hover:bg-muted/10">
                  <TableCell className={cn("p-1", indentCls(row.indent))}>
                    <div className="flex items-center gap-1">
                      {/* +/- expand for mapped Tally ledgers and/or attached custom rows */}
                      {showToggleB ? (
                        <button
                          type="button"
                          className="w-5 h-5 flex items-center justify-center rounded border border-muted-foreground/30 bg-background text-muted-foreground hover:bg-muted shrink-0"
                          onClick={() => toggleSources(row.id)}
                          title={isOpenB ? "Collapse" : "Expand"}
                        >
                          {isOpenB ? <Minus className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
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
                    {hasAttachedB && !isOpenB
                      ? <span className="text-xs tabular-nums text-right block pr-1">{aggCyB ? fmtNum(aggCyB) : "—"}</span>
                      : <NumInput value={rawCy[row.id] ?? 0} onChange={v => onChangeCy(row.id, v)} disabled={row.naAll || hasAttachedB} />}
                  </TableCell>
                  <TableCell className="p-1">
                    {hasAttachedB && !isOpenB
                      ? <span className="text-xs tabular-nums text-right block pr-1">{aggPyB ? fmtNum(aggPyB) : "—"}</span>
                      : <NumInput value={rawPy[row.id] ?? 0} onChange={v => onChangePy(row.id, v)} disabled={row.naAll || hasAttachedB} />}
                  </TableCell>
                  <TableCell className="p-1 text-center w-8">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button"
                        onClick={() => { onAddRow({ attachedTo: row.id }); toggleSources(row.id); }}
                        className="text-muted-foreground hover:text-blue-600 transition-colors"
                        title="Add sub-group under this row">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => onHideStatic(row.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Hide row">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })()}

              {/* Inline source-ledger sub-rows for static rows */}
              {!row.isSectionHeader && !row.isTotal && openSources.has(row.id) &&
                cySources[row.id]?.filter(s => s.amountCy !== 0).map((s, i) => {
                  const slKey = `${row.id}::${s.ledger}`;
                  const slLabel = sourceLabelOverrides[slKey] ?? s.ledger;
                  return (
                  <TableRow key={i} className="bg-muted/5 hover:bg-muted/10">
                    <TableCell className="py-0.5 pl-10 pr-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={slLabel}
                          onChange={e => onChangeSourceLabel(row.id, s.ledger, e.target.value)}
                          className="h-5 text-xs px-1 border-transparent hover:border-input focus:border-input bg-transparent italic flex-1 min-w-0"
                          title={s.ledger}
                        />
                        <SubLedgerActionsMenu
                          ledger={s.ledger}
                          onEject={() => onEjectSource(row.id, s.ledger, s.amountCy)}
                          headingOptions={allHeadingOptions.filter(o => o.id !== row.id)}
                          onEjectAndAttach={(targetId) => onEjectSource(row.id, s.ledger, s.amountCy, targetId)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                      {fmtNum(s.amountCy)}
                    </TableCell>
                    <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                      {s.amountPy !== undefined && s.amountPy !== 0 ? fmtNum(s.amountPy) : "—"}
                    </TableCell>
                    <TableCell className="py-0.5" />
                  </TableRow>
                  );
                })
              }

              {/* Custom rows attached under this static row — only visible when expanded */}
              {attachedHere.length > 0 && openSources.has(row.id) && attachedHere.map(cr => (
                <CustomRowEditor
                  key={cr.id}
                  row={cr}
                  cyVal={rawCy[cr.id] ?? 0}
                  pyVal={rawPy[cr.id] ?? 0}
                  isPatternA={false}
                  isChild={true}
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
                  sourceLabelOverrides={sourceLabelOverrides}
                  onChangeSourceLabel={onChangeSourceLabel}
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
  sourceLabelOverrides,
  onChangeCy, onChangePy, onAddRow, onDeleteRow, onChangeLabel,
  onHideStatic, onChangeStaticLabel, onPromote, onSwapLtSt,
  onEjectSource, onEjectCustomSource,
  onChangeSourceLabel,
}: {
  config:       NoteConfig;
  cy:           Record<string, number>;
  py:           Record<string, number>;
  cyYear:       number; pyYear: number;
  customRows:   NCECustomRow[];
  hiddenRows:   string[];
  labelOverrides: Record<string, string>;
  cySources:    Record<string, { ledger: string; amountCy: number; amountPy?: number; column?: "lt" | "st" }[]>;
  sourceLabelOverrides: Record<string, string>;
  onChangeCy:   (key: string, v: number) => void;
  onChangePy:   (key: string, v: number) => void;
  onAddRow:     (opts?: { section?: string; attachedTo?: string }) => void;
  onDeleteRow:  (id: string) => void;
  onChangeLabel:(id: string, label: string) => void;
  onHideStatic: (id: string) => void;
  onChangeStaticLabel: (id: string, label: string) => void;
  onPromote:    (customId: string, staticId: string) => void;
  onEjectSource:(rowId: string, ledger: string, amount: number, attachToId?: string) => void;
  onEjectCustomSource:(customRowId: string, ledger: string, amount: number, attachToId?: string) => void;
  onChangeSourceLabel: (rowId: string, ledger: string, newLabel: string) => void;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);

  // ISSUE 2 FIX — derive section-specific "Add row" buttons so a row added
  // under "Unsecured" gets section="unsecured" + attachedTo="unsec_other".
  // Without these, handleAddRow created a sectionless row that only fed Total
  // (A+B) grand-total; Total (B) and the BS face stayed unchanged.
  //
  // Heuristic: walk rows in document order, accumulating rows-since-last-total.
  // When we hit an isTotal row carrying sectionTag, all preceding non-total
  // rows belong to that section. Within those, pick the row whose id ends with
  // "_other" / "_specify" as the default attachedTo target (e.g. sec_other,
  // unsec_other, kb_unsecured, etc.). Falls back to the LAST row in the
  // section if nothing matches the suffix.
  const sectionAddTargets: { label: string; section: string; attachedTo: string }[] = useMemo(() => {
    const out: { label: string; section: string; attachedTo: string }[] = [];
    let sectionStart = 0;
    for (let i = 0; i < config.rows.length; i++) {
      const r = config.rows[i];
      if (!r.isTotal || !r.sectionTag) {
        if (r.isTotal) sectionStart = i + 1;
        continue;
      }
      const sectionRows = config.rows.slice(sectionStart, i)
        .filter(x => !x.isSectionHeader && !x.isTotal);
      const otherRow =
        sectionRows.find(x => x.id.endsWith("_other"))
        ?? sectionRows.find(x => x.id.endsWith("_specify"))
        ?? sectionRows.find(x => x.id.endsWith("_others"))
        ?? sectionRows[sectionRows.length - 1];
      if (otherRow) {
        const niceName = r.sectionTag.charAt(0).toUpperCase() + r.sectionTag.slice(1);
        out.push({
          label: `+ Add row to ${niceName}`,
          section: r.sectionTag,
          attachedTo: otherRow.id,
        });
      }
      sectionStart = i + 1;
    }
    return out;
  }, [config]);

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
  // Exclude custom rows that are already attached to something (they're not standalone headings)
  const allHeadingOptions = useMemo(
    () => [
      ...staticHeadingOptions,
      ...customRows.filter(cr => !cr.attachedTo).map(cr => ({ id: cr.id, label: cr.label || "(unnamed row)" })),
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
          // headingOptions for sectionRows: static rows are always valid move targets
          // (the sectionStaticIds filter was wrongly excluding same-section static rows);
          // already-attached custom rows are already excluded from allHeadingOptions.
          const sectionHeadingOptions = allHeadingOptions;
          const attachedHere = !row.isSectionHeader && !row.isTotal
            ? customRows.filter(cr => cr.attachedTo === row.id)
            : [];
          const displayLabel = labelOverrides[row.id] ?? row.label;
          return (
            <>
              {sectionRows.map(cr => {
                const customSubRows = customRows.filter(sub => sub.attachedTo === cr.id);
                const crIsOpen = openSources.has(cr.id);
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
                      onSwapLtSt={onSwapLtSt ? () => onSwapLtSt(cr.id) : undefined}
                      onEjectCustomSource={(ledger, amt) => onEjectCustomSource(cr.id, ledger, amt)}
                      onAddRow={onAddRow}
                      hasSubRows={customSubRows.length > 0}
                      isOpen={crIsOpen}
                      onToggle={() => toggleSources(cr.id)}
                      sourceLabelOverrides={sourceLabelOverrides}
                      onChangeSourceLabel={onChangeSourceLabel}
                    />
                    {customSubRows.length > 0 && crIsOpen && customSubRows.map(sub => (
                      <CustomRowEditor
                        key={sub.id}
                        row={sub}
                        cyVal={0} pyVal={0}
                        isPatternA={true}
                        isChild={true}
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
                        onSwapLtSt={onSwapLtSt ? () => onSwapLtSt(sub.id) : undefined}
                        onEjectCustomSource={(ledger, amt) => onEjectCustomSource(sub.id, ledger, amt)}
                        onAddRow={onAddRow}
                        sourceLabelOverrides={sourceLabelOverrides}
                        onChangeSourceLabel={onChangeSourceLabel}
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
              ) : (() => {
                /* Aggregate values: own static value + any attached custom rows */
                const hasAttachedA = attachedHere.length > 0;
                const hasSrcsA     = (cySources[row.id]?.filter(s => s.amountCy !== 0).length ?? 0) > 0;
                const showToggleA  = hasSrcsA || hasAttachedA;
                const isOpenA      = openSources.has(row.id);

                const aggLtCy = (rawCy[row.id + "_lt"] ?? 0) + (hasAttachedA ? attachedHere.reduce((s, cr) => s + (rawCy[cr.id + "_lt"] ?? 0), 0) : 0);
                const aggStCy = (rawCy[row.id + "_st"] ?? 0) + (hasAttachedA ? attachedHere.reduce((s, cr) => s + (rawCy[cr.id + "_st"] ?? 0), 0) : 0);
                const aggLtPy = (rawPy[row.id + "_lt"] ?? 0) + (hasAttachedA ? attachedHere.reduce((s, cr) => s + (rawPy[cr.id + "_lt"] ?? 0), 0) : 0);
                const aggStPy = (rawPy[row.id + "_st"] ?? 0) + (hasAttachedA ? attachedHere.reduce((s, cr) => s + (rawPy[cr.id + "_st"] ?? 0), 0) : 0);

                return (
                <TableRow key={row.id} className="hover:bg-muted/10">
                  <TableCell className={cn("p-1 border-r", indentCls(row.indent))}>
                    <div className="flex items-center gap-1">
                      {/* +/- expand for mapped Tally ledgers or attached custom rows */}
                      {showToggleA ? (
                        <button
                          type="button"
                          className="w-5 h-5 flex items-center justify-center rounded border border-muted-foreground/30 bg-background text-muted-foreground hover:bg-muted shrink-0"
                          onClick={() => toggleSources(row.id)}
                          title={isOpenA ? "Collapse" : "Expand"}
                        >
                          {isOpenA ? <Minus className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
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
                  {/* When collapsed with children: show aggregate as read-only.
                      When expanded with children: static row's own NumInput is disabled
                      to prevent double-counting (children's amounts are separately tracked).
                      When no children: editable NumInput as normal. */}
                  <TableCell className="p-1">
                    {hasAttachedA && !isOpenA
                      ? <span className="text-xs tabular-nums text-right block pr-1">{aggLtCy ? fmtNum(aggLtCy) : "—"}</span>
                      : <NumInput value={rawCy[row.id + "_lt"] ?? 0} onChange={v => onChangeCy(row.id + "_lt", v)} disabled={row.naLT || hasAttachedA} />}
                  </TableCell>
                  <TableCell className="p-1 border-r">
                    {hasAttachedA && !isOpenA
                      ? <span className="text-xs tabular-nums text-right block pr-1">{aggLtPy ? fmtNum(aggLtPy) : "—"}</span>
                      : <NumInput value={rawPy[row.id + "_lt"] ?? 0} onChange={v => onChangePy(row.id + "_lt", v)} disabled={row.naLT || hasAttachedA} />}
                  </TableCell>
                  <TableCell className="p-1">
                    {hasAttachedA && !isOpenA
                      ? <span className="text-xs tabular-nums text-right block pr-1">{aggStCy ? fmtNum(aggStCy) : "—"}</span>
                      : <NumInput value={rawCy[row.id + "_st"] ?? 0} onChange={v => onChangeCy(row.id + "_st", v)} disabled={row.naST || hasAttachedA} />}
                  </TableCell>
                  <TableCell className="p-1">
                    {hasAttachedA && !isOpenA
                      ? <span className="text-xs tabular-nums text-right block pr-1">{aggStPy ? fmtNum(aggStPy) : "—"}</span>
                      : <NumInput value={rawPy[row.id + "_st"] ?? 0} onChange={v => onChangePy(row.id + "_st", v)} disabled={row.naST || hasAttachedA} />}
                  </TableCell>
                  <TableCell className="p-1 text-center w-8">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button"
                        onClick={() => {
                          // Derive section by walking forward to next sectionTag total
                          const idx = config.rows.findIndex(r2 => r2.id === row.id);
                          let section: string | undefined;
                          if (idx >= 0) {
                            for (let i = idx + 1; i < config.rows.length; i++) {
                              const r2 = config.rows[i];
                              if (r2.isTotal && r2.sectionTag) { section = r2.sectionTag; break; }
                              if (r2.isSectionHeader) break;
                            }
                          }
                          onAddRow({ section, attachedTo: row.id });
                          toggleSources(row.id);
                        }}
                        className="text-muted-foreground hover:text-blue-600 transition-colors"
                        title="Add sub-group under this row">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => onHideStatic(row.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Hide row">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })()}

              {/* Inline source-ledger sub-rows for Pattern A static rows */}
              {!row.isSectionHeader && !row.isTotal && openSources.has(row.id) &&
                cySources[row.id]?.filter(s => s.amountCy !== 0).map((s, i) => {
                  const slKey = `${row.id}::${s.ledger}`;
                  const slLabel = sourceLabelOverrides[slKey] ?? s.ledger;
                  return (
                  <TableRow key={i} className="bg-muted/5 hover:bg-muted/10">
                    <TableCell className="py-0.5 pl-10 pr-1 text-xs text-muted-foreground border-r">
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={slLabel}
                          onChange={e => onChangeSourceLabel(row.id, s.ledger, e.target.value)}
                          className="h-5 text-xs px-1 border-transparent hover:border-input focus:border-input bg-transparent italic flex-1 min-w-0"
                          title={s.ledger}
                        />
                        {(s as any).column && (
                          <span className="text-[9px] uppercase shrink-0 font-semibold text-muted-foreground/60">[{(s as any).column}]</span>
                        )}
                        <SubLedgerActionsMenu
                          ledger={s.ledger}
                          onEject={() => onEjectSource(row.id, s.ledger, s.amountCy)}
                          headingOptions={allHeadingOptions.filter(o => o.id !== row.id)}
                          onEjectAndAttach={(targetId) => onEjectSource(row.id, s.ledger, s.amountCy, targetId)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                      {s.column === "lt" || !s.column ? fmtNum(s.amountCy) : "—"}
                    </TableCell>
                    <TableCell className="py-0.5 border-r text-xs text-right text-muted-foreground tabular-nums">
                      {(s.column === "lt" || !s.column) && s.amountPy !== undefined && s.amountPy !== 0 ? fmtNum(s.amountPy) : "—"}
                    </TableCell>
                    <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                      {s.column === "st" ? fmtNum(s.amountCy) : "—"}
                    </TableCell>
                    <TableCell className="py-0.5 text-xs text-right text-muted-foreground tabular-nums">
                      {s.column === "st" && s.amountPy !== undefined && s.amountPy !== 0 ? fmtNum(s.amountPy) : "—"}
                    </TableCell>
                    <TableCell className="py-0.5" />
                  </TableRow>
                  );
                })
              }

              {/* Custom rows attached under this static row — only visible when expanded */}
              {attachedHere.length > 0 && openSources.has(row.id) && attachedHere.map(cr => (
                <CustomRowEditor
                  key={cr.id}
                  row={cr}
                  cyVal={0} pyVal={0}
                  isPatternA={true}
                  isChild={true}
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
                  onSwapLtSt={onSwapLtSt ? () => onSwapLtSt(cr.id) : undefined}
                  onEjectCustomSource={(ledger, amt) => onEjectCustomSource(cr.id, ledger, amt)}
                  onAddRow={onAddRow}
                  sourceLabelOverrides={sourceLabelOverrides}
                  onChangeSourceLabel={onChangeSourceLabel}
                />
              ))}
            </>
          );
        })}
        {/* Add row — section-specific buttons so the new row's amount flows
            into the right section total (Issue 2 fix). Plus a fallback
            sectionless button for notes without sections. */}
        <TableRow>
          <TableCell colSpan={6} className="py-1.5 px-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {sectionAddTargets.length > 0
                ? sectionAddTargets.map(t => (
                    <Button
                      key={t.section}
                      type="button" size="sm" variant="ghost"
                      className="h-6 text-xs text-muted-foreground gap-1 hover:text-foreground"
                      onClick={() => onAddRow({ section: t.section, attachedTo: t.attachedTo })}
                      title={`Adds a new row under "${t.label.replace('+ Add row to ', '')}" section so its amount flows into the section total`}
                    >
                      <Plus className="h-3 w-3" /> {t.label.replace('+ ', '')}
                    </Button>
                  ))
                : (
                  <Button type="button" size="sm" variant="ghost"
                    className="h-6 text-xs text-muted-foreground gap-1 hover:text-foreground"
                    onClick={() => onAddRow()}>
                    <Plus className="h-3 w-3" /> Add row
                  </Button>
                )}
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NCEDetailedNotes({ engagementId, dynamicNoteMap }: Props) {
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
            // ── Self-heal: migrate legacy borrowings data ──────────────────
            // Old data may have unsecured borrowing custom rows with
            // section:"unsecured" but no attachedTo. These should be
            // attachedTo:"unsec_other" so the static row shows the correct
            // aggregate when collapsed. computeDisplayData already excludes
            // attached rows from section extras to prevent double-counting.
            //
            // ALSO: orphan custom rows (attachedTo points to a customRow id
            // that no longer exists — e.g. user created a synthetic wrapper
            // like "Unsecured Loans" and later deleted it, leaving children
            // pointing at a ghost parent) cause the children's amounts to
            // silently disappear from Total (A+B): the formula only adds
            // static rows + their attached children, and the orphans match
            // neither. Re-route them to a sane default static row so their
            // amounts re-enter the total math.
            const STATIC_DEFAULT_ATTACH: Record<string, Record<string, string>> = {
              borrowings:     { secured: "sec_other", unsecured: "unsec_other" },
              provisions:     { default: "other_prov" },
              investments:    { quoted: "quot_other", unquoted: "unquot_other" },
              loans_advances: { secured: "kb_secured", unsecured: "kb_unsecured" },
            };
            let healed = false;
            // Track ledgers to un-eject (so they re-enter the auto-aggregation
            // pipeline on next Re-sync and contribute to the proper static row
            // directly — avoiding the zero-out side-effect of being attached
            // as a custom row to a static row that ALSO has smart-matched
            // contributors).
            const unEjectByNote: Record<string, Set<string>> = {};
            const rebuildCustomRowsByNote: Record<string, Set<string>> = {};

            // ZERO-OUT-CONFLICT detector: if borrowings has any custom row
            // attached to unsec_related (or sec_related), AND that label looks
            // related-party, AND the underlying ledger is in ejectedLedgers,
            // un-eject + drop. Same pattern as the orphan handler, but for
            // custom rows that point at a STATIC smart-match target rather
            // than a deleted custom parent. Without this, the zero-out-when-
            // attached-children logic in nceAutoPopulate wipes the smart-
            // matched contributors and Total (B) becomes lower than COA.
            if (built["borrowings"]) {
              const d = built["borrowings"];
              const ejectedSet = new Set(d.ejectedLedgers ?? []);
              const dropIds = new Set<string>();
              for (const cr of d.customRows ?? []) {
                if (!cr.label) continue;
                if (cr.attachedTo !== "unsec_related" && cr.attachedTo !== "sec_related") continue;
                if (!ejectedSet.has(cr.label)) continue;
                const lbl = cr.label.toLowerCase();
                const isRel =
                  lbl.includes(" huf") || lbl.includes("(huf)") || lbl.includes("-huf") ||
                  /\b(director|partner|owner|proprietor|promoter|shareholder|relative|family|related)\b/.test(lbl);
                if (!isRel) continue;
                if (!unEjectByNote["borrowings"]) unEjectByNote["borrowings"] = new Set();
                unEjectByNote["borrowings"].add(cr.label);
                dropIds.add(cr.id);
              }
              if (dropIds.size > 0) {
                rebuildCustomRowsByNote["borrowings"] = dropIds;
                const filtered = d.customRows.filter(cr => !dropIds.has(cr.id));
                built["borrowings"] = { ...d, customRows: filtered };
                healed = true;
              }
            }
            for (const [nType, d] of Object.entries(built)) {
              const validIds = new Set((d.customRows || []).map(cr => cr.id));
              const sectionDefaults = STATIC_DEFAULT_ATTACH[nType];
              if (!sectionDefaults) continue;
              const dropIds = new Set<string>();
              const patched = d.customRows.map(cr => {
                // Case 1: legacy rows with section but no attachedTo
                if (cr.section && !cr.attachedTo) {
                  const target = sectionDefaults[cr.section] ?? sectionDefaults.default;
                  if (target) return { ...cr, attachedTo: target };
                }
                // Case 2: orphan — attachedTo points to a deleted custom row
                if (cr.attachedTo
                    && cr.attachedTo.startsWith("custom_")
                    && !validIds.has(cr.attachedTo)) {
                  // ROOT-CAUSE FIX: when an orphan's label suggests a smart-
                  // rule match (HUF/director/partner/etc.), the cleanest fix
                  // is to UN-EJECT the underlying ledger and drop the custom
                  // row entirely. The next Re-sync will smart-match the
                  // ledger directly into unsec_related (Dipak HUF etc.
                  // already there), restoring Total (B) to match COA without
                  // triggering the zero-out side-effect of static rows with
                  // attached children.
                  const lbl = (cr.label || "").toLowerCase();
                  const isRel = nType === "borrowings" && cr.section === "unsecured" && (
                    lbl.includes(" huf") || lbl.includes("(huf)") || lbl.includes("-huf") ||
                    /\b(director|partner|owner|proprietor|promoter|shareholder|relative|family|related)\b/.test(lbl)
                  );
                  if (isRel && cr.label) {
                    if (!unEjectByNote[nType]) unEjectByNote[nType] = new Set();
                    unEjectByNote[nType].add(cr.label);
                    dropIds.add(cr.id);
                    return cr; // will be filtered out below
                  }
                  const target =
                    (cr.section && sectionDefaults[cr.section])
                    ?? sectionDefaults.unsecured
                    ?? sectionDefaults.default
                    ?? "unsec_other";
                  return { ...cr, attachedTo: target };
                }
                return cr;
              }).filter(cr => !dropIds.has(cr.id));
              if (patched.length !== d.customRows.length
                  || patched.some((cr, i) => cr !== d.customRows[i])) {
                if (dropIds.size > 0) rebuildCustomRowsByNote[nType] = dropIds;
                built[nType] = { ...d, customRows: patched };
                healed = true;
              }
            }
            // Apply ejectedLedgers cleanup so the dropped custom-row labels
            // re-enter the smart-match pipeline on next sync. Also strip the
            // orphan custom_* cy/py keys so they don't linger as stale numbers.
            for (const [nType, labels] of Object.entries(unEjectByNote)) {
              const d = built[nType];
              if (!d) continue;
              const cleanedEjected = (d.ejectedLedgers ?? []).filter(l => !labels.has(l));
              const dropIds = rebuildCustomRowsByNote[nType] ?? new Set<string>();
              const cleanedCy = { ...d.cy };
              const cleanedPy = { ...d.py };
              for (const id of dropIds) {
                for (const suffix of ["", "_lt", "_st"]) {
                  delete cleanedCy[id + suffix];
                  delete cleanedPy[id + suffix];
                }
              }
              built[nType] = {
                ...d,
                cy: cleanedCy,
                py: cleanedPy,
                ejectedLedgers: cleanedEjected,
              };
              healed = true;
            }

            // PHANTOM-LT HEAL — for Pattern A notes (where customRows can
            // carry both bare key AND _lt/_st suffix keys), strip the bare
            // key whenever any suffix variant exists. Without this, the bare
            // key leaks into the LT total via the fallback path (see
            // computeDisplayData), producing a phantom amount in the LT
            // column for ST-only entries.
            for (const [nType, d] of Object.entries(built)) {
              if (!d.customRows?.length) continue;
              const cleanedCy = { ...d.cy };
              const cleanedPy = { ...d.py };
              let touched = false;
              for (const cr of d.customRows) {
                const hasLtCy = (cr.id + "_lt") in cleanedCy;
                const hasStCy = (cr.id + "_st") in cleanedCy;
                if ((hasLtCy || hasStCy) && cr.id in cleanedCy) {
                  delete cleanedCy[cr.id]; touched = true;
                }
                const hasLtPy = (cr.id + "_lt") in cleanedPy;
                const hasStPy = (cr.id + "_st") in cleanedPy;
                if ((hasLtPy || hasStPy) && cr.id in cleanedPy) {
                  delete cleanedPy[cr.id]; touched = true;
                }
              }
              if (touched) {
                built[nType] = { ...d, cy: cleanedCy, py: cleanedPy };
                healed = true;
              }
            }

            // ISSUE 1 HEAL — strip "Auto-filled from COA total" rows when
            // the same note already has manual entries. These rows were
            // inserted by a buggy version of the fallback logic that didn't
            // count manual rows as "data present". Their amounts duplicate
            // the manual totals, doubling Total (B) / Total (A+B). Healing
            // now is safe — manual amounts remain intact; only the synthetic
            // duplicate row + its cy/py keys are removed.
            for (const [nType, d] of Object.entries(built)) {
              const hasManual = (d.customRows || []).some(cr =>
                cr.source === "manual" && (
                  Math.abs(d.cy?.[cr.id] ?? 0) > 0.005 ||
                  Math.abs(d.cy?.[cr.id + "_lt"] ?? 0) > 0.005 ||
                  Math.abs(d.cy?.[cr.id + "_st"] ?? 0) > 0.005
                ),
              );
              if (!hasManual) continue;
              const autoTotalRows = (d.customRows || []).filter(
                cr => cr.id === "custom_auto_total" ||
                      cr.label === "Auto-filled from COA total",
              );
              if (autoTotalRows.length === 0) continue;
              const cleanedCy = { ...d.cy };
              const cleanedPy = { ...d.py };
              for (const r of autoTotalRows) {
                for (const suffix of ["", "_lt", "_st"]) {
                  delete cleanedCy[r.id + suffix];
                  delete cleanedPy[r.id + suffix];
                }
              }
              built[nType] = {
                ...d,
                customRows: (d.customRows || []).filter(
                  cr => cr.id !== "custom_auto_total" &&
                        cr.label !== "Auto-filled from COA total",
                ),
                cy: cleanedCy,
                py: cleanedPy,
              };
              healed = true;
            }

            for (const [, d] of Object.entries(built)) {
              // Strip stale custom_* keys: cy/py values that belong to a
              // customRow ID that no longer exists in the customRows array
              // (e.g. a previously-deleted parent_group wrapper). Otherwise
              // these get picked up via extras in section totals and inflate
              // the math.
              const validIds = new Set((d.customRows || []).map(cr => cr.id));
              for (const map of [d.cy, d.py]) {
                for (const k of Object.keys(map)) {
                  if (!k.startsWith("custom_")) continue;
                  const base = k.replace(/_lt$|_st$/, "");
                  if (!validIds.has(base)) { delete map[k]; healed = true; }
                }
              }
            }
            if (healed) {
              persistNotes(built, fy).catch(() => {/* best-effort */});
            }
            if (!cancelled) setNoteData(built);
            // Whenever the heal touched a note (esp. un-ejected a ledger),
            // immediately re-run auto-populate so the freshly-unblocked
            // ledger gets smart-matched into its proper static row. This
            // restores Total (B) for clients whose stage8 state had orphan
            // ejected ledgers under deleted parents.
            const unEjectedAny = Object.keys(unEjectByNote).length > 0;
            // Back-fill cy_sources for engagements saved before the feature was added
            const needsCySources = Object.values(built).some(
              d => Object.keys(d.cy ?? {}).some(k => !k.startsWith("custom_")) &&
                   (!d.cy_sources || Object.keys(d.cy_sources).length === 0)
            );
            // ROOT-CAUSE FIX (Issue 1, PY not populating): trigger a silent
            // re-sync when any note has CY data but no positive PY data OR
            // when this engagement hasn't yet been migrated by the per-key
            // PY-fallback in nceAutoPopulate. The migration is tracked via
            // a per-engagement localStorage flag so the trigger is one-shot:
            // we don't keep re-running on every page load once the data is
            // healed.
            const pyMigrationKey = `nce_py_per_key_fallback_v2_${engagementId}`;
            const pyMigrationDone = localStorage.getItem(pyMigrationKey) === "1";
            // Issue 2 fix (per-ledger PY in expanded sub-rows): saved cy_sources
            // pre-eaa14a2c only carry amountCy, not amountPy. Force one-shot
            // re-sync per engagement so the UI can render the PY column.
            const pySourcesMigrationKey = `nce_cy_sources_amountpy_v3_${engagementId}`;
            const pySourcesMigrationDone = localStorage.getItem(pySourcesMigrationKey) === "1";
            // Issue (debit/credit netting): saved totals pre-fix added Math.abs
            // of opposite-side balances instead of subtracting. Force one-shot
            // re-sync so notes pick up the new signed aggregation.
            const drCrMigrationKey = `nce_drcr_netting_v2_${engagementId}`;
            const drCrMigrationDone = localStorage.getItem(drCrMigrationKey) === "1";
            const needsPyAnyEmpty = Object.values(built).some(d => {
              const hasCY = Object.values(d.cy ?? {}).some(v => Math.abs(Number(v) || 0) > 0.005);
              const hasPY = Object.values(d.py ?? {}).some(v => Math.abs(Number(v) || 0) > 0.005);
              return hasCY && !hasPY;
            });
            const needsPyRefresh = needsPyAnyEmpty || !pyMigrationDone;
            const needsCySourcesPyRefresh = !pySourcesMigrationDone;
            const needsDrCrRefresh = !drCrMigrationDone;
            if (unEjectedAny || needsCySources || needsPyRefresh || needsCySourcesPyRefresh || needsDrCrRefresh) {
              // Silent background refresh — don't block the UI
              nceAutoPopulate(engagementId, built).then(refreshed => {
                if (!cancelled) setNoteData(refreshed);
                persistNotes(refreshed, fy).catch(() => {});
                // Mark the per-key PY migration as done so subsequent loads
                // skip the silent re-sync unless a genuine gap reappears.
                try { localStorage.setItem(pyMigrationKey, "1"); } catch {/* private mode */}
                try { localStorage.setItem(pySourcesMigrationKey, "1"); } catch {/* private mode */}
                try { localStorage.setItem(drCrMigrationKey, "1"); } catch {/* private mode */}
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
  /** Add a manual custom row to a note.
   *  Optional `section` (e.g. "secured" | "unsecured") tags the row so its
   *  amount feeds the matching section-total (Total A / Total B) via the
   *  extras path in computeDisplayData — without this the new row would only
   *  show up in the grand total. Optional `attachedTo` parents the row under
   *  a specific static row (e.g. unsec_other) so its amount also rolls up
   *  into that parent's aggregate display.
   *  ISSUE 2 FIX: previous version dropped section/attachedTo entirely — any
   *  row added in a Short-Term section appeared but never flowed into Total
   *  (B) Short-Term column nor into the BS face. */
  const handleAddRow = useCallback((
    noteType: string,
    opts?: { section?: string; attachedTo?: string },
  ) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const id  = newCustomId();
      const newRow: NCECustomRow = {
        id, label: "", source: "manual",
        ...(opts?.section    ? { section:    opts.section    } : {}),
        ...(opts?.attachedTo ? { attachedTo: opts.attachedTo } : {}),
      };
      const next = { ...prev, [noteType]: { ...cur, customRows: [...cur.customRows, newRow] } };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  /** Swap LT ↔ ST amounts on a custom row (Pattern A notes). Used by the
   *  Move LT↔ST action so the user can re-classify a row that landed in the
   *  wrong column at sync time (e.g. Akash D Patel showing under Long-Term
   *  when his COA mapping is NCE_STB). */
  const handleSwapLtSt = useCallback((noteType: string, rowId: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const newCy = { ...cur.cy };
      const newPy = { ...cur.py };
      const cyLt = newCy[rowId + "_lt"] ?? 0;
      const cyBase = newCy[rowId] ?? 0;
      const cyStOld = newCy[rowId + "_st"] ?? 0;
      // Swap LT (or bare key from legacy data) with ST
      newCy[rowId + "_lt"] = cyStOld;
      newCy[rowId + "_st"] = (cyLt || cyBase);
      if (cyBase !== 0) delete newCy[rowId];
      const pyLt = newPy[rowId + "_lt"] ?? 0;
      const pyBase = newPy[rowId] ?? 0;
      const pyStOld = newPy[rowId + "_st"] ?? 0;
      newPy[rowId + "_lt"] = pyStOld;
      newPy[rowId + "_st"] = (pyLt || pyBase);
      if (pyBase !== 0) delete newPy[rowId];
      const next = { ...prev, [noteType]: { ...cur, cy: newCy, py: newPy } };
      scheduleSave(next);
      return next;
    });
    toast.success("Swapped Long-term ↔ Short-term");
  }, [scheduleSave]);

  const handleDeleteRow = useCallback((noteType: string, id: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const newCy = { ...cur.cy };
      const newPy = { ...cur.py };
      for (const s of ["", "_lt", "_st"]) { delete newCy[id + s]; delete newPy[id + s]; }
      // If the deleted row was an ejected standalone row, remove its ledger from
      // ejectedLedgers so re-sync can auto-merge it again next time
      const deletedRow = cur.customRows.find(r => r.id === id);
      const newEjectedLedgers = deletedRow?.ejectedSource
        ? (cur.ejectedLedgers ?? []).filter(l => l !== deletedRow!.ejectedSource)
        : (cur.ejectedLedgers ?? []);
      const next = {
        ...prev,
        [noteType]: {
          ...cur,
          cy: newCy,
          py: newPy,
          customRows: cur.customRows.filter(r => r.id !== id),
          ejectedLedgers: newEjectedLedgers,
        },
      };
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

  const handleChangeSourceLabel = useCallback((noteType: string, rowId: string, ledger: string, newLabel: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const key = `${rowId}::${ledger}`;
      const overrides = { ...(cur.sourceLabelOverrides ?? {}), [key]: newLabel };
      const next = { ...prev, [noteType]: { ...cur, sourceLabelOverrides: overrides } };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const handlePromoteCustomToStatic = useCallback((noteType: string, customId: string, targetId: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const config = NOTES_CONFIG.find(c => c.noteType === noteType);

      // Determine section of the target row
      let targetSection: string | undefined;
      // Check if target is a custom row → inherit its section
      const targetCustomRow = cur.customRows.find(r => r.id === targetId);
      if (targetCustomRow) {
        targetSection = targetCustomRow.section;
      } else if (config) {
        // Target is a static row → find which section it belongs to
        let sectionStart = 0;
        outer: for (let i = 0; i < config.rows.length; i++) {
          const row = config.rows[i];
          if (row.isTotal && row.sectionTag) {
            for (let j = sectionStart; j < i; j++) {
              const sr = config.rows[j];
              if (!sr.isSectionHeader && !sr.isTotal && sr.id === targetId) {
                targetSection = row.sectionTag;
                break outer;
              }
            }
            sectionStart = i + 1;
          }
        }
      }

      // Attach the custom row beneath the chosen row. Amounts stay on
      // the custom row's own keys — they continue to roll up into the same
      // section/grand total via computeDisplayData. The target row itself is
      // untouched so the move is fully reversible.
      //
      // Section propagation: when the target is a sectionless custom row and
      // the source has a section, promote the target into the same section so
      // both rows appear in the same section total (e.g. both count in Total B).
      const sourceRow = cur.customRows.find(r => r.id === customId);
      const shouldPromoteTarget =
        targetCustomRow !== undefined && // target IS a custom row
        !targetCustomRow.section &&       // target has no section yet
        !!sourceRow?.section;             // source HAS a section to propagate

      const next = { ...prev, [noteType]: {
        ...cur,
        customRows: cur.customRows.map(r => {
          if (r.id === customId) {
            return { ...r, attachedTo: targetId, ...(targetSection !== undefined ? { section: targetSection } : {}) };
          }
          if (r.id === targetId && shouldPromoteTarget) {
            return { ...r, section: sourceRow!.section };
          }
          return r;
        }),
      }};
      scheduleSave(next);
      return next;
    });
    toast.success("Attached under selected heading");
  }, [scheduleSave]);

  // Shared helper: resolve the sectionTag for a given target row/custom-row id.
  const resolveSection = useCallback((
    config: NoteConfig | undefined,
    cur: { customRows?: NCECustomRow[] },
    targetId: string,
  ): string | undefined => {
    const targetCustom = (cur.customRows ?? []).find(r => r.id === targetId);
    if (targetCustom) return targetCustom.section;
    if (!config) return undefined;
    let sectionStart = 0;
    for (let i = 0; i < config.rows.length; i++) {
      const row = config.rows[i];
      if (row.isTotal && row.sectionTag) {
        for (let j = sectionStart; j < i; j++) {
          if (config.rows[j].id === targetId) return row.sectionTag;
        }
        sectionStart = i + 1;
      }
    }
    return undefined;
  }, []);

  // Eject a mapped Tally ledger from a static row → new custom row.
  // If attachToId is provided the new row is immediately attached to that heading.
  const handleEjectSource = useCallback((noteType: string, rowId: string, ledger: string, amount: number, attachToId?: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const config = NOTES_CONFIG.find(c => c.noteType === noteType);
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
      // 3. Create new custom row with that ledger name + amount.
      //    Mark as "manual" so it survives Re-sync from COA.
      //    Store ejectedSource so deleting this row can clean up ejectedLedgers.
      const newId = newCustomId();
      const targetSection = attachToId ? resolveSection(config, cur, attachToId) : undefined;
      const newRow: NCECustomRow = {
        id: newId, label: ledger, source: "manual", ejectedSource: ledger,
        ...(attachToId ? { attachedTo: attachToId } : {}),
        ...(targetSection ? { section: targetSection } : {}),
      };
      newCy[newId] = amount;
      // For Pattern A notes, also store with the column suffix so computeDisplayData picks it up
      if (column === "lt") newCy[newId + "_lt"] = amount;
      if (column === "st") newCy[newId + "_st"] = amount;
      // 4. Record this ledger in ejectedLedgers so Re-sync skips it from auto-grouping
      const newEjectedLedgers = [...new Set([...(cur.ejectedLedgers ?? []), ledger])];
      const next = { ...prev, [noteType]: {
        ...cur,
        cy: newCy,
        cy_sources: newCySources,
        customRows: [...cur.customRows, newRow],
        ejectedLedgers: newEjectedLedgers,
      }};
      scheduleSave(next);
      return next;
    });
    toast.success(attachToId ? `"${ledger}" moved to heading` : `"${ledger}" moved to a separate row`);
  }, [scheduleSave, resolveSection]);

  // Eject a source ledger from a CUSTOM (auto/merged) row → new standalone custom row.
  // If attachToId is provided the new row is immediately attached to that heading.
  const handleEjectCustomSource = useCallback((noteType: string, customRowId: string, ledger: string, amountCy: number, attachToId?: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const config = NOTES_CONFIG.find(c => c.noteType === noteType);
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
      // Create new standalone custom row for this ledger.
      // Mark as "manual" so it survives Re-sync from COA.
      // Store ejectedSource so deleting this row can clean up ejectedLedgers.
      const newId = newCustomId();
      const targetSection = attachToId ? resolveSection(config, cur, attachToId) : undefined;
      newCy[newId] = amountCy;
      // For Pattern A notes, also store with the column suffix so computeDisplayData picks it up
      if (column === "lt") newCy[newId + "_lt"] = amountCy;
      if (column === "st") newCy[newId + "_st"] = amountCy;
      const newRow: NCECustomRow = {
        id: newId, label: ledger, source: "manual", ejectedSource: ledger,
        ...(attachToId ? { attachedTo: attachToId } : {}),
        ...(targetSection ? { section: targetSection } : {}),
      };
      // Record this ledger in ejectedLedgers so Re-sync skips it from auto-grouping
      const newEjectedLedgers = [...new Set([...(cur.ejectedLedgers ?? []), ledger])];
      const next = { ...prev, [noteType]: { ...cur, cy: newCy, customRows: [...updatedRows, newRow], ejectedLedgers: newEjectedLedgers } };
      scheduleSave(next);
      return next;
    });
    toast.success(attachToId ? `"${ledger}" moved to heading` : `"${ledger}" moved to its own row`);
  }, [scheduleSave, resolveSection]);

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

          // Dynamic note number: use the map when available (cross-tab sync),
          // else fall back to parsing from the title string (standalone Stage 8).
          const noteNum = dynamicNoteMap
            ? (getDynamicNoteDisplay(nc.noteType, dynamicNoteMap) ?? "")
            : (nc.title.match(/Note\s+([\d\s&]+):/i)?.[1]?.trim() ?? "");
          const noteTitle = nc.title.replace(/^Note\s+[\d\s&]+:\s*/i, "");

          return (
            <NoteCard
              key={nc.noteType}
              noteNumber={noteNum}
              title={noteTitle}
              autoCount={autoCount}
              manualCount={manuCount}
              collapseControl={collapseAll}
              anchorId={noteNum ? `nce-note-${noteNum}` : `nce-note-type-${nc.noteType}`}
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
                    sourceLabelOverrides={d.sourceLabelOverrides ?? {}}
                    onChangeCy={(key, v) => handleChange(nc.noteType, key, true,  v)}
                    onChangePy={(key, v) => handleChange(nc.noteType, key, false, v)}
                    onAddRow={(opts) => handleAddRow(nc.noteType, opts)}
                    onDeleteRow={id => handleDeleteRow(nc.noteType, id)}
                    onChangeLabel={(id, lbl) => handleChangeLabel(nc.noteType, id, lbl)}
                    onHideStatic={id => handleHideStatic(nc.noteType, id)}
                    onChangeStaticLabel={(id, lbl) => handleChangeStaticLabel(nc.noteType, id, lbl)}
                    onPromote={(cid, sid) => handlePromoteCustomToStatic(nc.noteType, cid, sid)}
                    onSwapLtSt={(rid) => handleSwapLtSt(nc.noteType, rid)}
                    onEjectSource={(rid, ledger, amt, attachToId?) => handleEjectSource(nc.noteType, rid, ledger, amt, attachToId)}
                    onEjectCustomSource={(cid, ledger, amt, attachToId?) => handleEjectCustomSource(nc.noteType, cid, ledger, amt, attachToId)}
                    onChangeSourceLabel={(rid, ledger, lbl) => handleChangeSourceLabel(nc.noteType, rid, ledger, lbl)}
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
                    sourceLabelOverrides={d.sourceLabelOverrides ?? {}}
                    onChangeCy={(key, v) => handleChange(nc.noteType, key, true,  v)}
                    onChangePy={(key, v) => handleChange(nc.noteType, key, false, v)}
                    onAddRow={(opts) => handleAddRow(nc.noteType, opts)}
                    onDeleteRow={id => handleDeleteRow(nc.noteType, id)}
                    onChangeLabel={(id, lbl) => handleChangeLabel(nc.noteType, id, lbl)}
                    onHideStatic={id => handleHideStatic(nc.noteType, id)}
                    onChangeStaticLabel={(id, lbl) => handleChangeStaticLabel(nc.noteType, id, lbl)}
                    onPromote={(cid, sid) => handlePromoteCustomToStatic(nc.noteType, cid, sid)}
                    onEjectSource={(rid, ledger, amt, attachToId?) => handleEjectSource(nc.noteType, rid, ledger, amt, attachToId)}
                    onEjectCustomSource={(cid, ledger, amt, attachToId?) => handleEjectCustomSource(nc.noteType, cid, ledger, amt, attachToId)}
                    onChangeSourceLabel={(rid, ledger, lbl) => handleChangeSourceLabel(nc.noteType, rid, ledger, lbl)}
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
