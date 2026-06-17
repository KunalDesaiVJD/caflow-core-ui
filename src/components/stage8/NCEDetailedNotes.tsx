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
import { useQueryClient } from "@tanstack/react-query";
import { supabase }    from "@/integrations/supabase/client";
import { Button }      from "@/components/ui/button";
import { Input }       from "@/components/ui/input";
import { Badge }       from "@/components/ui/badge";
import { Checkbox }    from "@/components/ui/checkbox";
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
import { Loader2, Save, RefreshCw, Plus, Trash2, Search, CornerUpRight, Minus, MoreVertical, ArrowRightLeft, SpellCheck } from "lucide-react";
import { cn }          from "@/lib/utils";
import { findSpellIssues, applyAllSuggestions } from "@/lib/spellSuggest";
import {
  NoteConfig, NoteRowDef, NOTES_CONFIG, NOTE_META, computeDisplayData, extractSplitData,
} from "@/config/nceNotesConfig";
// 2026-06-05 Phase 3 — canonical per-row aggregator used by the renderer's
// sumCustomDisplayB/A. Same numbers as the Notes Total row, BS / P&L face,
// and DOCX export — all four now read from this one helper.
import { computeNoteTotals } from "@/lib/nceNoteTotals";
import {
  NCECustomRow, NCENoteData,
  nceAutoPopulate, deserialiseNoteData, serialiseNoteData, computeResyncDiff,
} from "@/lib/nceAutoPopulate";
import { getDynamicNoteDisplay } from "@/lib/nceDynamicNoteNumbers";

/** The note's grand total (CY & PY), via the single canonical aggregator — the
 *  SAME function the Note Total row and the BS/P&L face read. Used by the
 *  guarded auto-save to prove a reclassification leaves the total untouched. */
function noteGrandTotal(config: NoteConfig, nd: NCENoteData): { cy: number; py: number } {
  const t = computeNoteTotals(config, nd.cy, nd.py, nd.customRows);
  return t.pattern === "A"
    ? { cy: t.grandTotal.ltCy + t.grandTotal.stCy, py: t.grandTotal.ltPy + t.grandTotal.stPy }
    : { cy: t.grandTotal.cy, py: t.grandTotal.py };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  engagementId: string;
  /** Dynamic note number map from PipelineFinancialStatements.
   *  Maps originalNoteRef → dynamicNoteNo so NoteCard headings stay in
   *  sync with the numbers shown in the BS/PL columns.
   *  When omitted (e.g. when rendered standalone from Stage 8), falls back
   *  to parsing the static number from NOTES_CONFIG title strings. */
  dynamicNoteMap?: Map<number, number>;
  /** Task 8: Lock Preview — called whenever a PatternBTable's expand/collapse
   *  state changes. The parent can use this to capture the current expansion
   *  state and pass it to generateNCEFinancialsDocx as expandedRows. */
  onExpansionStateUpdate?: (state: Record<string, Set<string>>) => void;
  /** Task 1 (doc6): when true, the entire notes panel is read-only (locked preview mode).
   *  Toolbar is hidden, inputs/buttons are disabled, and a lock banner is shown. */
  readOnly?: boolean;
  /** Bug 1: initial expand/collapse state.  When opening the locked preview,
   *  PipelineFinancialStatements passes the captured nceExpandedRows here so
   *  every PatternBTable starts with the same rows expanded as in the editor. */
  initialExpandedRows?: Set<string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INDENT_CLS = ["pl-2", "pl-5", "pl-8", "pl-11"] as const;
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
  // tie to BS/PL even after individual rows are rounded. Negatives are shown
  // in parentheses, e.g. (25,000), per financial-reporting convention.
  if (!Number.isFinite(v) || Math.abs(v) < 0.5) return "—";
  const abs = Math.round(Math.abs(v)).toLocaleString("en-IN", {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
  return v < 0 ? `(${abs})` : abs;
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
  noteNumber, title, autoCount, manualCount, children, collapseControl, anchorId, forceOpen,
}: {
  noteNumber:  string;
  title:       string;
  autoCount:   number;
  manualCount: number;
  children:    React.ReactNode;
  collapseControl?: boolean;
  /** Stable DOM id for scroll-to-note. Falls back to noteNumber when omitted. */
  anchorId?: string;
  /** NCE Tasks 2+3+5: when true (readOnly preview), always show content open,
   *  hide the collapse toggle and auto/manual badges — mimics the export rendering. */
  forceOpen?: boolean;
}) {
  // Default COLLAPSED: every Note in "Notes to Accounts" starts collapsed with
  // a "+" beside the heading; clicking expands to reveal the ledger breakup
  // (Word-file requirement). The global Expand All / Collapse All control still
  // overrides via collapseControl.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (collapseControl !== undefined) setOpen(!collapseControl);
  }, [collapseControl]);

  // NCE Tasks 2+3+5: in readOnly (preview) mode the card is always open,
  // the toggle is hidden, and auto/manual badges are stripped so the view
  // matches the final-document presentation style.
  const isOpen = forceOpen ? true : open;

  return (
    <div id={anchorId ?? `nce-note-${noteNumber}`} className="border rounded-lg overflow-hidden bg-background">
      {/* Header strip — click to collapse/expand (hidden in forceOpen / preview mode) */}
      <div
        className={cn(
          "bg-muted/40 px-4 py-2 border-b flex items-center gap-2 flex-wrap",
          forceOpen ? "cursor-default" : "cursor-pointer select-none hover:bg-muted/60 transition-colors",
        )}
        onClick={forceOpen ? undefined : () => setOpen(o => !o)}
      >
        {/* +/- toggle — hidden in preview mode */}
        {!forceOpen && (
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center rounded border border-muted-foreground/30 bg-background text-muted-foreground hover:bg-muted shrink-0"
            tabIndex={-1}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <Minus className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
          </button>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Note {noteNumber}
        </span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {/* auto/manual badges — shown only in edit mode, not in preview */}
        {!forceOpen && autoCount > 0 && (
          <Badge variant="outline" className="text-[9px] px-1.5 ml-1 text-blue-600 border-blue-300">
            {autoCount} auto
          </Badge>
        )}
        {!forceOpen && manualCount > 0 && (
          <Badge variant="outline" className="text-[9px] px-1.5 ml-1 text-amber-600 border-amber-300">
            {manualCount} manual
          </Badge>
        )}
      </div>
      {isOpen && children}
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
  // Parse a displayed value back to a number, accepting both "-1,234" and the
  // accounting "(1,234)" bracket form for negatives.
  const parseLocal = (s: string): number => {
    let t = String(s).trim().replace(/,/g, "");
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    const n = parseFloat(t) || 0;
    return neg ? -Math.abs(n) : n;
  };
  // Display: negatives in parentheses, e.g. (25,000), per financial-reporting
  // convention (Word-file requirement — applies to every editable Note cell).
  const formatDisplay = (v: number): string => {
    if (!Number.isFinite(v) || v === 0) return "";
    const abs = Math.round(Math.abs(v)).toLocaleString("en-IN", {
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
    return v < 0 ? `(${abs})` : abs;
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
        // While editing show the plain signed integer (no commas/brackets) so
        // typing/backspace works naturally; on blur we re-apply Indian
        // formatting with parentheses for negatives.
        setFocused(true);
        const v = parseLocal(local);
        setLocal(v === 0 ? "" : String(Math.round(v)));
      }}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const parsed = Math.round(parseLocal(local));
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

/**
 * Fix D — inline spelling suggestion (suggest-only, never auto-applies).
 * Renders nothing when the label has no known misspelling. When it does, shows a
 * small amber "Fix" pill whose tooltip lists every correction; clicking applies
 * them via onApply (which routes through the normal label-edit → persist path).
 * Hidden in read-only/preview mode so the printed preview stays clean.
 */
function SpellFix({ value, onApply, hidden }: {
  value: string;
  onApply: (fixed: string) => void;
  hidden?: boolean;
}) {
  const issues = useMemo(() => findSpellIssues(value), [value]);
  if (hidden || issues.length === 0) return null;
  const tip = issues.map(i => `${i.word} → ${i.suggestion}`).join(", ");
  return (
    <button
      type="button"
      onClick={() => onApply(applyAllSuggestions(value))}
      title={`Fix spelling: ${tip}`}
      aria-label={`Fix spelling: ${tip}`}
      className="shrink-0 inline-flex items-center gap-0.5 h-5 px-1 rounded border border-amber-300 bg-amber-50 text-amber-700 text-[10px] leading-none hover:bg-amber-100"
    >
      <SpellCheck className="h-3 w-3" /> Fix
    </button>
  );
}

function CustomRowEditor({
  row, cyVal, pyVal, isPatternA, isChild, readOnly,
  cyLtVal, cyStVal, pyLtVal, pyStVal,
  onChangeCy, onChangePy, onChangeCyLt, onChangeCySt, onChangePyLt, onChangePySt,
  onChangeLabel, onDelete, headingOptions, onPromote, onEjectCustomSource, onAddRow,
  onSwapLtSt,
  isOpen: isOpenProp, onToggle: onToggleProp, hasSubRows,
  sourceLabelOverrides, onChangeSourceLabel,
  isSelected, onSelect,
}: {
  row: NCECustomRow;
  cyVal: number; pyVal: number;
  isPatternA: boolean;
  isChild?: boolean;
  /** Read-only/preview mode — hides the inline spell-fix affordance. */
  readOnly?: boolean;
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
  /** Bulk-select: whether this row is currently selected */
  isSelected?: boolean;
  /** Bulk-select: called when the checkbox is toggled */
  onSelect?: (checked: boolean) => void;
}) {
  const hasSources = (row.sources?.length ?? 0) > 0;
  const [sourcesOpenLocal, setSourcesOpenLocal] = useState(false);
  // If parent passes isOpen/onToggle, use external state; otherwise use local
  const sourcesOpen = isOpenProp !== undefined ? isOpenProp : sourcesOpenLocal;
  const handleToggle = onToggleProp ?? (() => setSourcesOpenLocal(o => !o));
  const showToggle = hasSources || hasSubRows;
  const colCount = isPatternA ? 6 : 4;
  // Lock figures of auto-linked rows (source === "auto"): the amount comes from
  // the COA/Tally mapping and must be changed there, not typed over here —
  // matching the corporate notes' isLocked behaviour. The label stays editable.
  // 2026-06-02 — Lock the amount when the row's value originates from TB
  // (auto-populated, moved via "Move to…", or ejected). Decoupled from
  // `source` because moving a row sets source="manual" so it survives
  // Re-sync — but the amount is still TB-derived and must not be editable.
  // Hand-typed rows (+ Add row) have tbDerived undefined → editable.
  const amountLocked = row.source === "auto" || row.tbDerived === true;
  return (
    <>
      <TableRow className={cn("hover:bg-blue-50/50", isChild ? "bg-blue-50/10 border-l-2 border-l-blue-200" : "bg-blue-50/30", isSelected && "ring-1 ring-inset ring-blue-400 bg-blue-100/40")}>
        <TableCell className={cn("p-1", isPatternA && "border-r", isChild && "pl-8")}>
          <div className="flex items-center gap-1 min-w-0">
            {/* Bulk-select checkbox — only shown in Pattern B when onSelect is provided */}
            {onSelect && !isPatternA && (
              <Checkbox
                checked={!!isSelected}
                onCheckedChange={(v) => onSelect(!!v)}
                className="shrink-0 h-3.5 w-3.5 mr-0.5"
                aria-label="Select row for bulk move"
              />
            )}
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
            <SpellFix value={row.label} onApply={onChangeLabel} hidden={readOnly} />
            <SourceBadge source={row.source} />
          </div>
        </TableCell>
        {isPatternA ? (
          <>
            <TableCell className="p-1"><NumInput value={cyLtVal} onChange={onChangeCyLt} disabled={amountLocked} /></TableCell>
            <TableCell className="p-1 border-r"><NumInput value={pyLtVal} onChange={onChangePyLt} disabled={amountLocked} /></TableCell>
            <TableCell className="p-1"><NumInput value={cyStVal} onChange={onChangeCySt} disabled={amountLocked} /></TableCell>
            <TableCell className="p-1"><NumInput value={pyStVal} onChange={onChangePySt} disabled={amountLocked} /></TableCell>
          </>
        ) : (
          <>
            <TableCell className="p-1"><NumInput value={cyVal} onChange={onChangeCy} disabled={amountLocked} /></TableCell>
            <TableCell className="p-1"><NumInput value={pyVal} onChange={onChangePy} disabled={amountLocked} /></TableCell>
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
              <SpellFix value={slLabel} onApply={fixed => onChangeSourceLabel?.(row.id, s.ledger, fixed)} hidden={readOnly} />
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

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATION SAFETY NET (June 2026)
//
// The BHAKTI INFRA / "other_cl" bug surfaced when COA mapping populated
// a static row's `cy_sources[staticId]` from a ledger AND that same
// ledger ALSO existed as a customRow attached to the same staticId
// (because of a stale data state, a Move-to that didn't strip the source,
// or any future auto-populate path that wrote to both channels). The
// displayed aggregate at the per-row renderers (Pattern A and Pattern B)
// is `rawCy[staticId] + Σ customRow amounts` — when both channels held
// the same ledger, the same amount appeared in the user-visible total
// TWICE.
//
// computeOverlap detects this: for each cy_sources entry on the static
// whose ledger label matches one of the attached customRows' labels or
// `ejectedSource`, return the cumulative overlap amount. The aggregate
// formulas subtract this from the static portion BEFORE adding the
// children — so whichever channel holds a given ledger, it counts
// exactly once. Pattern A passes the column param so an LT-only source
// can't cancel an ST contribution and vice-versa.
//
// This is a defensive renderer-side guard. Write-time guards in
// handlePromoteCustomToStatic and nceAutoPopulate also exist; together
// they make the BHAKTI bug structurally impossible to recur regardless
// of how the data shape gets into a state where both channels overlap.
// ─────────────────────────────────────────────────────────────────────────────
type CySourceEntry = { ledger: string; amountCy: number; amountPy?: number; column?: "lt" | "st" };
function computeOverlap(
  cySources: Record<string, CySourceEntry[]>,
  staticId: string,
  attached: NCECustomRow[],
  side: "cy" | "py",
  column?: "lt" | "st",
): number {
  const srcs = cySources?.[staticId];
  if (!srcs || srcs.length === 0 || attached.length === 0) return 0;
  const childLedgerSet = new Set<string>();
  for (const cr of attached) {
    const lbl = (cr.label || "").trim().toLowerCase();
    const ej  = ((cr as any).ejectedSource || "").trim().toLowerCase();
    if (lbl) childLedgerSet.add(lbl);
    if (ej)  childLedgerSet.add(ej);
  }
  if (childLedgerSet.size === 0) return 0;
  let overlap = 0;
  for (const s of srcs) {
    if (column && s.column !== column) continue;
    const lg = (s.ledger || "").trim().toLowerCase();
    if (lg && childLedgerSet.has(lg)) {
      overlap += side === "cy" ? Number(s.amountCy || 0) : Number(s.amountPy || 0);
    }
  }
  return overlap;
}

// ─── Pattern B table ──────────────────────────────────────────────────────────

function PatternBTable({
  config, cy: rawCy, py: rawPy, cyYear, pyYear,
  customRows, hiddenRows, labelOverrides, cySources,
  sourceLabelOverrides,
  onChangeCy, onChangePy, onAddRow, onDeleteRow, onChangeLabel,
  onHideStatic, onChangeStaticLabel, onPromote, onEjectSource, onEjectCustomSource,
  onChangeSourceLabel, noteType, onExpansionChange, hideEmptySections, initialExpandedRows,
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
  /** Task 8: Lock Preview — note type key for expansion tracking */
  noteType?: string;
  /** Task 8: Lock Preview — called when the openSources set changes */
  onExpansionChange?: (noteType: string, expandedIds: Set<string>) => void;
  /** Task 2 (doc8): when true (lock preview / readOnly mode), hide empty section
   *  headers and their associated totals to remove clutter from the preview. */
  hideEmptySections?: boolean;
  /** Bug 1: when provided (e.g. from the locked preview), PatternBTable starts
   *  with these row IDs already expanded instead of the default fully-collapsed
   *  state.  The flat Set spans all note types; only IDs present in this note's
   *  data will actually match anything. */
  initialExpandedRows?: Set<string>;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);
  const grandTotalId  = grandTotalIdx >= 0 ? config.rows[grandTotalIdx].id : null;

  // 2026-06-05 Phase 3 — sumCustomDisplayB is now a thin lookup into the
  // canonical computeNoteTotals result so the renderer, the Notes Total
  // row, the BS / P&L face and the DOCX export ALL read the same numbers.
  // The legacy inline algorithm moved to src/lib/nceNoteTotals.ts.
  const totalsB = useMemo(
    () => computeNoteTotals(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const sumCustomDisplayB = (id: string): { cy: number; py: number } => {
    const v = totalsB.pattern === "B" ? totalsB.perRow[id] : undefined;
    return v ? { cy: v.cy, py: v.py } : { cy: rawCy[id] ?? 0, py: rawPy[id] ?? 0 };
  };

  // Use the module-level computeOverlap helper (see definition above PatternBTable).
  const overlapForRow = (staticId: string, attached: NCECustomRow[], side: "cy" | "py", column?: "lt" | "st") =>
    computeOverlap(cySources, staticId, attached, side, column);

  // BUG N4 FIX (2026-06-04): hasAnyDescendantValue walks the WHOLE attachedTo
  // tree to detect non-zero CY or PY amounts at any depth. The previous
  // implementation only checked direct children, which hid sections in
  // lock-preview / DOCX export when a deeply-nested grand-child carried the
  // amount (e.g. SHREE HARI's "A" → "Office No. 201" → "A-0903 Dineshbhai"
  // chain would falsely flag the section as empty).
  const hasAnyDescendantValue = (parentId: string, seen: Set<string> = new Set()): boolean => {
    if (seen.has(parentId)) return false;
    seen.add(parentId);
    const directChildren = customRows.filter(cr => cr.attachedTo === parentId);
    for (const c of directChildren) {
      if ((rawCy[c.id] ?? 0) !== 0 || (rawPy[c.id] ?? 0) !== 0) return true;
      if (hasAnyDescendantValue(c.id, seen)) return true;
    }
    return false;
  };

  // Task 2 (doc8): pre-compute empty section header IDs when hideEmptySections is active
  const emptySectionHdrIds = useMemo(() => {
    if (!hideEmptySections) return new Set<string>();
    const emptyHdrs = new Set<string>();
    let currentHdrId: string | null = null;
    let sectionHasData = false;
    for (const row of config.rows) {
      if (row.isSectionHeader) {
        if (currentHdrId !== null && !sectionHasData) emptyHdrs.add(currentHdrId);
        currentHdrId = row.id;
        sectionHasData = false;
      } else if (!row.isTotal && currentHdrId !== null && !hiddenRows.includes(row.id)) {
        if ((cy[row.id] ?? 0) !== 0 || (py[row.id] ?? 0) !== 0) sectionHasData = true;
        if (!sectionHasData && hasAnyDescendantValue(row.id)) sectionHasData = true;
      }
    }
    if (currentHdrId !== null && !sectionHasData) emptyHdrs.add(currentHdrId);
    return emptyHdrs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideEmptySections, config.rows, cy, py, rawCy, rawPy, customRows, hiddenRows]);

  // Task 2 (doc8): pre-compute empty section total IDs
  const emptySectionTotalIds = useMemo(() => {
    if (!hideEmptySections) return new Set<string>();
    const emptyTotals = new Set<string>();
    let currentHdrId: string | null = null;
    let currentSectionTotalId: string | null = null;
    let sectionHasData = false;
    for (const row of config.rows) {
      if (row.isSectionHeader) {
        if (currentHdrId !== null && !sectionHasData && currentSectionTotalId) emptyTotals.add(currentSectionTotalId);
        currentHdrId = row.id;
        currentSectionTotalId = null;
        sectionHasData = false;
      } else if (row.isTotal && row.id !== grandTotalId) {
        currentSectionTotalId = row.id;
      } else if (!row.isTotal && currentHdrId !== null && !hiddenRows.includes(row.id)) {
        if ((cy[row.id] ?? 0) !== 0 || (py[row.id] ?? 0) !== 0) sectionHasData = true;
        if (!sectionHasData && hasAnyDescendantValue(row.id)) sectionHasData = true;
      }
    }
    if (currentHdrId !== null && !sectionHasData && currentSectionTotalId) emptyTotals.add(currentSectionTotalId);
    return emptyTotals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideEmptySections, config.rows, cy, py, rawCy, rawPy, customRows, hiddenRows, grandTotalId]);

  // Suppress the lone section subtotal when ONLY ONE section has non-zero data —
  // its subtotal equals the grand total, so showing both is redundant (double Total).
  // Mirrors the DOCX suppressSubtotal pre-pass in nceFinancialsDocx.ts.
  const suppressSubtotalIds = useMemo(() => {
    if (!hideEmptySections) return new Set<string>();
    const nonEmptySubtotals = new Set<string>();
    let currentHdrId: string | null = null;
    let currentSectionTotalId: string | null = null;
    let sectionHasData = false;
    const flush = () => {
      if (currentHdrId !== null && sectionHasData && currentSectionTotalId)
        nonEmptySubtotals.add(currentSectionTotalId);
    };
    for (const row of config.rows) {
      if (row.isSectionHeader) {
        flush();
        currentHdrId = row.id; currentSectionTotalId = null; sectionHasData = false;
      } else if (row.isTotal && row.id !== grandTotalId) {
        currentSectionTotalId = row.id;
      } else if (!row.isTotal && currentHdrId !== null && !hiddenRows.includes(row.id)) {
        if ((cy[row.id] ?? 0) !== 0 || (py[row.id] ?? 0) !== 0) sectionHasData = true;
        if (!sectionHasData && hasAnyDescendantValue(row.id)) sectionHasData = true;
      }
    }
    flush();
    // Only suppress when exactly ONE section is non-empty
    return nonEmptySubtotals.size === 1 ? nonEmptySubtotals : new Set<string>();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideEmptySections, config.rows, cy, py, rawCy, rawPy, customRows, hiddenRows, grandTotalId]);

  // Track which static rows have their source-ledger list expanded.
  // Bug 1 fix: seed from initialExpandedRows when provided (preview mode) so
  // the preview shows the same expand/collapse state as the editor.
  const [openSources, setOpenSources] = useState<Set<string>>(() =>
    initialExpandedRows ? new Set(initialExpandedRows) : new Set()
  );
  const toggleSources = (id: string) => setOpenSources(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Task 8: notify parent when expansion state changes (Lock Preview)
  useEffect(() => {
    if (noteType && onExpansionChange) {
      onExpansionChange(noteType, new Set(openSources));
    }
  }, [openSources, noteType, onExpansionChange]);
  // ── Bulk-select state ────────────────────────────────────────────────────────
  const [selectedCustomRows, setSelectedCustomRows] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<string>("");
  const toggleRowSelect = (id: string, checked: boolean) =>
    setSelectedCustomRows(prev => { const n = new Set(prev); checked ? n.add(id) : n.delete(id); return n; });
  const handleBulkMove = () => {
    if (!bulkTarget || selectedCustomRows.size === 0) return;
    const count = selectedCustomRows.size;
    for (const id of selectedCustomRows) onPromote(id, bulkTarget);
    setSelectedCustomRows(new Set());
    setBulkTarget("");
    toast.success(`Moved ${count} row(s)`);
  };
  const clearSelection = () => { setSelectedCustomRows(new Set()); setBulkTarget(""); };
  // Build move-target options, qualifying each row's label with its section
  // header (Secured / Unsecured / Quoted / Unquoted). Without this, notes like
  // Borrowings list "Term loans — Banks" identically under BOTH Secured and
  // Unsecured, so moving a ledger to "Term Loans — Banks (Unsecured)" looked
  // like it landed in Secured (the user couldn't tell the two options apart).
  // The move itself keys off the distinct row id, so disambiguating the label
  // makes the correct sub-classification selectable. (Word-file Issue D.)
  const staticHeadingOptions = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    let currentSection = "";
    for (const r of config.rows) {
      if (r.isSectionHeader) { currentSection = r.label || ""; continue; }
      if (r.isTotal || hiddenRows.includes(r.id)) continue;
      const base = labelOverrides[r.id] ?? r.label;
      out.push({
        id: r.id,
        label: currentSection ? `${base} (${currentSection})` : base,
      });
    }
    return out;
  }, [config, hiddenRows, labelOverrides]);
  // Include OTHER custom rows so "Site Expense - 18%" can move under "Site Expense"
  // Exclude custom rows that are already attached to something (they're not standalone headings)
  const allHeadingOptions = useMemo(
    () => [
      ...staticHeadingOptions,
      ...customRows.filter(cr => !cr.attachedTo).map(cr => ({ id: cr.id, label: cr.label || "(unnamed row)" })),
    ],
    [staticHeadingOptions, customRows],
  );

  // ── Task 1: Group-level select-all support ────────────────────────────────────
  // Pre-compute which custom row IDs belong to each section header so the
  // section-header select-all checkbox knows what to select / deselect.
  // BUG N5 FIX (2026-06-04): include ALL descendants, not just direct
  // children, so bulk-select / bulk-move / bulk-delete covers grand-children
  // too (otherwise multi-level hierarchies leave orphans behind).
  const sectionCustomRows = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    let curSectionId: string | null = null;
    // Recursive descendant collector keyed by parent id.
    const collectDescendants = (parentId: string): string[] => {
      const direct = customRows.filter(cr => cr.attachedTo === parentId);
      const all: string[] = [];
      for (const d of direct) {
        all.push(d.id);
        all.push(...collectDescendants(d.id));
      }
      return all;
    };
    for (const r of config.rows) {
      if (r.isSectionHeader) {
        curSectionId = r.id;
        out[r.id] = [];
      } else if (!r.isTotal && curSectionId) {
        out[curSectionId].push(...collectDescendants(r.id));
      }
    }
    return out;
  }, [config.rows, customRows]);

  /** Tri-state checked value for a group of ids. */
  const groupChecked = (ids: string[]): boolean | "indeterminate" => {
    if (ids.length === 0) return false;
    const selCount = ids.filter(id => selectedCustomRows.has(id)).length;
    if (selCount === 0)         return false;
    if (selCount === ids.length) return true;
    return "indeterminate";
  };

  /** Toggle all ids in a group (select-all if none/some selected; deselect-all if all selected). */
  const toggleGroup = (ids: string[]) => {
    const allSel = ids.every(id => selectedCustomRows.has(id));
    setSelectedCustomRows(prev => {
      const n = new Set(prev);
      if (allSel) ids.forEach(id => n.delete(id));
      else        ids.forEach(id => n.add(id));
      return n;
    });
  };

  // ── BUG N1 FIX (2026-06-04) ──────────────────────────────────────────
  // Render every descendant of a custom-row tree recursively. The previous
  // implementation had three hand-coded 2-level loops (sites at lines 996,
  // 1212 in this file plus the Pattern A mirror) — any custom row that
  // had grand-children was rendered without them, and the grand-children's
  // amounts were invisible to the user. For SHREE HARI INFRA's Trade
  // Payables, this hid lakhs of rupees under "Other payables — Others"
  // → "A" → "Office No. 201" → "A-0903 Dineshbhai" (4 levels deep).
  //
  // The helper walks `roots` (an arbitrary set of customRows to render at
  // the current depth) and, for each, recurses into its own children when
  // the user has the row expanded. `ancestorIds` blocks self-attach cycles
  // in the move-to dropdown and provides a clean visual indent if a future
  // version wants to convey depth.
  const renderTreeB = (roots: NCECustomRow[], ancestorIds: Set<string>): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    for (const cr of roots) {
      if (ancestorIds.has(cr.id)) continue; // cycle guard
      const myChildren = customRows.filter(c => c.attachedTo === cr.id);
      const crIsOpen = openSources.has(cr.id);
      // SHREE HARI fix (2026-06-04): treat a non-empty `sources` array as
      // "having children" too, so heading rows like "A" / "B" / "C" / "D"
      // whose sub-ledger breakdowns live in `sources[]` (not as nested
      // customRows) still show their rolled-up aggregate. Also: show the
      // aggregate regardless of expand state when there ARE children —
      // identical reasoning to the static-row fix earlier today.
      const hasSrcs = Array.isArray((cr as any).sources) && (cr as any).sources.length > 0;
      const hasChildren = myChildren.length > 0 || hasSrcs;
      const crAgg = hasChildren ? sumCustomDisplayB(cr.id) : null;
      const isChild = ancestorIds.size > 0;
      const nextAncestors = new Set(ancestorIds);
      nextAncestors.add(cr.id);
      nodes.push(
        <CustomRowEditor
          key={cr.id}
          row={cr}
          cyVal={crAgg ? crAgg.cy : (rawCy[cr.id] ?? 0)}
          pyVal={crAgg ? crAgg.py : (rawPy[cr.id] ?? 0)}
          isPatternA={false}
          readOnly={hideEmptySections}
          isChild={isChild}
          cyLtVal={0} cyStVal={0} pyLtVal={0} pyStVal={0}
          onChangeCy={v => onChangeCy(cr.id, v)}
          onChangePy={v => onChangePy(cr.id, v)}
          onChangeCyLt={() => {}} onChangeCySt={() => {}}
          onChangePyLt={() => {}} onChangePySt={() => {}}
          onChangeLabel={label => onChangeLabel(cr.id, label)}
          onDelete={() => onDeleteRow(cr.id)}
          headingOptions={allHeadingOptions.filter(o => o.id !== cr.id && !ancestorIds.has(o.id))}
          onPromote={(targetId) => onPromote(cr.id, targetId)}
          onEjectCustomSource={(ledger, amt) => onEjectCustomSource(cr.id, ledger, amt)}
          onAddRow={onAddRow}
          hasSubRows={hasChildren}
          isOpen={crIsOpen}
          onToggle={() => toggleSources(cr.id)}
          sourceLabelOverrides={sourceLabelOverrides}
          onChangeSourceLabel={onChangeSourceLabel}
          isSelected={selectedCustomRows.has(cr.id)}
          onSelect={checked => toggleRowSelect(cr.id, checked)}
        />
      );
      if (hasChildren && crIsOpen) {
        nodes.push(...renderTreeB(myChildren, nextAncestors));
      }
    }
    return nodes;
  };

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
        {/* ── Bulk-move toolbar — visible only when ≥1 row is selected ──────── */}
        {selectedCustomRows.size > 0 && (
          <TableRow className="bg-blue-50 border-b border-blue-200 sticky top-0 z-10">
            <TableCell colSpan={4} className="py-1.5 px-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1 text-xs font-semibold text-blue-700">
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  {selectedCustomRows.size} row{selectedCustomRows.size > 1 ? "s" : ""} selected
                </span>
                <Select value={bulkTarget} onValueChange={setBulkTarget}>
                  <SelectTrigger className="h-6 text-xs w-52">
                    <SelectValue placeholder="Move to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allHeadingOptions.filter(o => !selectedCustomRows.has(o.id)).map(o => (
                      <SelectItem key={o.id} value={o.id} className="text-xs">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button" size="sm" variant="default"
                  className="h-6 text-xs px-2 bg-blue-600 hover:bg-blue-700"
                  disabled={!bulkTarget}
                  onClick={handleBulkMove}
                >
                  Move
                </Button>
                <Button
                  type="button" size="sm" variant="ghost"
                  className="h-6 text-xs px-2 text-muted-foreground"
                  onClick={clearSelection}
                >
                  Clear
                </Button>
              </div>
            </TableCell>
          </TableRow>
        )}
        {config.rows.map((row, idx) => {
          if (!row.isSectionHeader && !row.isTotal && hiddenRows.includes(row.id)) return null;
          // Task 2 (doc8): in lock preview mode, hide empty section headers and their totals
          if (row.isSectionHeader && emptySectionHdrIds.has(row.id)) return null;
          if (row.isTotal && emptySectionTotalIds.has(row.id)) return null;
          // Suppress lone section subtotal that equals grand total (double-Total fix)
          if (row.isTotal && suppressSubtotalIds.has(row.id)) return null;
          // Changes doc Task 2: in readOnly/preview mode, suppress individual static data
          // rows where BOTH CY and PY aggregates (including attached custom sub-rows) are
          // zero — mirrors the export's hideBlankNoteRows behaviour exactly.
          if (hideEmptySections && !row.isSectionHeader && !row.isTotal && !hiddenRows.includes(row.id)) {
            // Use the recursive descendant sum so grand-children with amounts
            // don't fall through this hide filter and disappear from the
            // lock-preview / DOCX export.
            const ownPlusDesc = sumCustomDisplayB(row.id);
            const aggCy = ownPlusDesc.cy;
            const aggPy = ownPlusDesc.py;
            if (!aggCy && !aggPy) return null;
          }
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
              {/* Task 1: select-all header for the unattached rows group */}
              {insertCustomBefore && unattachedAtGrand.length > 0 && (
                <TableRow className="bg-muted/5 border-t border-dashed border-muted-foreground/20">
                  <TableCell colSpan={4} className="py-0.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        checked={groupChecked(unattachedAtGrand.map(cr => cr.id))}
                        onCheckedChange={() => toggleGroup(unattachedAtGrand.map(cr => cr.id))}
                        className="h-3.5 w-3.5 shrink-0"
                        aria-label="Select all unattached rows"
                        title={
                          groupChecked(unattachedAtGrand.map(cr => cr.id)) === true
                            ? "Deselect all rows in this group"
                            : "Select all rows in this group"
                        }
                      />
                      <span className="text-[10px] text-muted-foreground font-medium select-none">
                        Select all
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {insertCustomBefore && renderTreeB(unattachedAtGrand, new Set())}

              {row.isSectionHeader ? (
                <TableRow key={row.id} className="bg-muted/20">
                  <TableCell colSpan={4} className={cn("text-xs font-semibold py-1.5 text-muted-foreground", indentCls(row.indent))}>
                    {/* Task 1: select-all checkbox for section group */}
                    {(sectionCustomRows[row.id]?.length ?? 0) > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <Checkbox
                          checked={groupChecked(sectionCustomRows[row.id])}
                          onCheckedChange={() => toggleGroup(sectionCustomRows[row.id])}
                          className="shrink-0 h-3.5 w-3.5"
                          aria-label={`Select all custom rows in ${displayLabel}`}
                          title={
                            groupChecked(sectionCustomRows[row.id]) === true
                              ? "Deselect all in this section"
                              : "Select all in this section"
                          }
                        />
                        {displayLabel}
                      </div>
                    ) : displayLabel}
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
                const hasSrcsB = (cySources[row.id]?.filter(s => Number(s.amountCy ?? 0) !== 0 || Number((s as any).amountPy ?? 0) !== 0).length ?? 0) > 0;
                const showToggleB = hasAttachedB || hasSrcsB;
                const isOpenB = openSources.has(row.id);
                // Safety net: subtract any overlap where the SAME ledger is
                // both in cy_sources[row.id] (auto-mapped contribution to the
                // static) AND in one of the attached customRows. See
                // computeOverlap docs above. Prevents BHAKTI-style "showing
                // all at 2 places" regressions regardless of how the data
                // shape arrived in this state.
                const overlapCyB = hasAttachedB ? overlapForRow(row.id, attachedHere, "cy") : 0;
                const overlapPyB = hasAttachedB ? overlapForRow(row.id, attachedHere, "py") : 0;
                const aggCyB = (rawCy[row.id] ?? 0) - overlapCyB + (hasAttachedB ? attachedHere.reduce((s, cr) => s + sumCustomDisplayB(cr.id).cy, 0) : 0);
                const aggPyB = (rawPy[row.id] ?? 0) - overlapPyB + (hasAttachedB ? attachedHere.reduce((s, cr) => s + sumCustomDisplayB(cr.id).py, 0) : 0);
                return (
                <TableRow key={row.id} className="hover:bg-muted/10">
                  <TableCell className={cn("p-1", indentCls(row.indent))}>
                    <div className="flex items-center gap-1">
                      {/* Task 1: group select-all — only when this static row has attached custom children */}
                      {hasAttachedB && (() => {
                        const ids = attachedHere.map(cr => cr.id);
                        return (
                          <Checkbox
                            checked={groupChecked(ids)}
                            onCheckedChange={() => toggleGroup(ids)}
                            className="shrink-0 h-3.5 w-3.5"
                            aria-label="Select all rows in this group"
                            title={
                              groupChecked(ids) === true
                                ? "Deselect all sub-rows"
                                : "Select all sub-rows"
                            }
                          />
                        );
                      })()}
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
                      {/* Template caption — LOCKED for editing (2026-06-17).
                          Only Tally-derived rows (custom rows + sub-ledger
                          names) are renameable; the statutory note captions are
                          read-only so the audit-report structure cannot drift. */}
                      <Input
                        value={displayLabel}
                        readOnly
                        tabIndex={-1}
                        title="Statutory caption — locked. Rename the Tally-derived ledger rows instead."
                        className="h-6 text-xs px-1.5 border-transparent bg-transparent cursor-default focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="p-1">
                    {/* SHREE HARI FIX (2026-06-04): when this static row has
                        attached customRows, ALWAYS show the rolled-up aggregate
                        — both collapsed and expanded. Previously the expanded
                        view rendered a disabled NumInput showing rawCy[row.id]
                        (typically 0), making "Other payables — Others" read
                        "—" even when its 46 attached ledgers summed to ₹1.1
                        crore. The user can't type into a parent with children
                        anyway (NumInput was always disabled), so showing the
                        aggregate is strictly more useful.
                        Preview/Export fix: when in readOnly (preview) mode and
                        the row is expanded with visible children (source ledgers
                        OR attached custom rows), suppress the parent's own amount
                        so the same total is not shown twice. */}
                    {hideEmptySections && isOpenB && (hasSrcsB || hasAttachedB)
                      ? <span className="text-xs tabular-nums text-right block pr-1" />
                      : hasAttachedB
                        ? <span className="text-xs tabular-nums text-right block pr-1">{aggCyB ? fmtNum(aggCyB) : "—"}</span>
                        : <NumInput value={rawCy[row.id] ?? 0} onChange={v => onChangeCy(row.id, v)} disabled={row.naAll} />}
                  </TableCell>
                  <TableCell className="p-1">
                    {/* SHREE HARI FIX — see CY comment above.
                        Same preview/export suppression for PY. */}
                    {hideEmptySections && isOpenB && (hasSrcsB || hasAttachedB)
                      ? <span className="text-xs tabular-nums text-right block pr-1" />
                      : hasAttachedB
                        ? <span className="text-xs tabular-nums text-right block pr-1">{aggPyB ? fmtNum(aggPyB) : "—"}</span>
                        : <NumInput value={rawPy[row.id] ?? 0} onChange={v => onChangePy(row.id, v)} disabled={row.naAll} />}
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
                cySources[row.id]?.filter(s => Number(s.amountCy ?? 0) !== 0 || Number((s as any).amountPy ?? 0) !== 0).map((s, i) => {
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

              {/* BUG N1 FIX — replaced 2-level loop with recursive renderTreeB.
                  Renders every descendant of this static row at any depth
                  (e.g. "Other payables — Others" → "A" → "Office No. 201"
                  → "A-0903 Dineshbhai" all become visible & editable). */}
              {attachedHere.length > 0 && openSources.has(row.id) &&
                renderTreeB(attachedHere, new Set([row.id]))}
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
  onChangeSourceLabel, hideEmptySections,
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
  /** Task 2 (doc8): when true (lock preview / readOnly mode), hide empty section
   *  headers and their associated totals to remove clutter from the preview. */
  hideEmptySections?: boolean;
}) {
  const { cy, py } = useMemo(
    () => computeDisplayData(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const grandTotalIdx = config.rows.reduce((last, row, i) => row.isTotal ? i : last, -1);
  const grandTotalId  = grandTotalIdx >= 0 ? config.rows[grandTotalIdx].id : null;

  // 2026-06-05 Phase 3 — sumCustomDisplayA is now a thin lookup into the
  // canonical computeNoteTotals result. See sumCustomDisplayB above.
  const totalsA = useMemo(
    () => computeNoteTotals(config, rawCy, rawPy, customRows),
    [config, rawCy, rawPy, customRows],
  );
  const sumCustomDisplayA = (id: string): { lc: number; lp: number; sc: number; sp: number } => {
    const v = totalsA.pattern === "A" ? totalsA.perRow[id] : undefined;
    if (v) return { lc: v.ltCy, lp: v.ltPy, sc: v.stCy, sp: v.stPy };
    return {
      lc: rawCy[id + "_lt"] ?? 0, lp: rawPy[id + "_lt"] ?? 0,
      sc: rawCy[id + "_st"] ?? 0, sp: rawPy[id + "_st"] ?? 0,
    };
  };

  // Duplication safety net — see computeOverlap docs above PatternBTable.
  const overlapForRow = (staticId: string, attached: NCECustomRow[], side: "cy" | "py", column?: "lt" | "st") =>
    computeOverlap(cySources, staticId, attached, side, column);

  // BUG N4 FIX (Pattern A): recursive descendant-value check across both LT
  // and ST columns so a deeply-nested grand-child with an amount doesn't
  // get hidden in lock-preview / DOCX export.
  const hasAnyDescendantValueA = (parentId: string, seen: Set<string> = new Set()): boolean => {
    if (seen.has(parentId)) return false;
    seen.add(parentId);
    const directChildren = customRows.filter(cr => cr.attachedTo === parentId);
    for (const c of directChildren) {
      if ((rawCy[c.id + "_lt"] ?? 0) !== 0 || (rawCy[c.id + "_st"] ?? 0) !== 0 ||
          (rawPy[c.id + "_lt"] ?? 0) !== 0 || (rawPy[c.id + "_st"] ?? 0) !== 0) return true;
      if (hasAnyDescendantValueA(c.id, seen)) return true;
    }
    return false;
  };

  // Task 2 (doc8): pre-compute empty section header IDs when hideEmptySections is active.
  // Pattern A stores values as key_lt / key_st, so check both suffixes.
  const emptySectionHdrIds = useMemo(() => {
    if (!hideEmptySections) return new Set<string>();
    const emptyHdrs = new Set<string>();
    let currentHdrId: string | null = null;
    let sectionHasData = false;
    for (const row of config.rows) {
      if (row.isSectionHeader) {
        if (currentHdrId !== null && !sectionHasData) emptyHdrs.add(currentHdrId);
        currentHdrId = row.id;
        sectionHasData = false;
      } else if (!row.isTotal && currentHdrId !== null && !hiddenRows.includes(row.id)) {
        if ((cy[row.id + "_lt"] ?? 0) !== 0 || (cy[row.id + "_st"] ?? 0) !== 0 ||
            (py[row.id + "_lt"] ?? 0) !== 0 || (py[row.id + "_st"] ?? 0) !== 0) sectionHasData = true;
        if (!sectionHasData && hasAnyDescendantValueA(row.id)) sectionHasData = true;
      }
    }
    if (currentHdrId !== null && !sectionHasData) emptyHdrs.add(currentHdrId);
    return emptyHdrs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideEmptySections, config.rows, cy, py, rawCy, rawPy, customRows, hiddenRows]);

  // Task 2 (doc8): pre-compute empty section total IDs when hideEmptySections is active.
  const emptySectionTotalIds = useMemo(() => {
    if (!hideEmptySections) return new Set<string>();
    const emptyTotals = new Set<string>();
    let currentHdrId: string | null = null;
    let currentSectionTotalId: string | null = null;
    let sectionHasData = false;
    for (const row of config.rows) {
      if (row.isSectionHeader) {
        if (currentHdrId !== null && !sectionHasData && currentSectionTotalId) emptyTotals.add(currentSectionTotalId);
        currentHdrId = row.id; currentSectionTotalId = null; sectionHasData = false;
      } else if (row.isTotal && row.id !== grandTotalId) {
        currentSectionTotalId = row.id;
      } else if (!row.isTotal && currentHdrId !== null && !hiddenRows.includes(row.id)) {
        if ((cy[row.id + "_lt"] ?? 0) !== 0 || (cy[row.id + "_st"] ?? 0) !== 0 ||
            (py[row.id + "_lt"] ?? 0) !== 0 || (py[row.id + "_st"] ?? 0) !== 0) sectionHasData = true;
        if (!sectionHasData && hasAnyDescendantValueA(row.id)) sectionHasData = true;
      }
    }
    if (currentHdrId !== null && !sectionHasData && currentSectionTotalId) emptyTotals.add(currentSectionTotalId);
    return emptyTotals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideEmptySections, config.rows, cy, py, rawCy, rawPy, customRows, hiddenRows, grandTotalId]);

  // Suppress the lone section subtotal when ONLY ONE section has non-zero data
  // (mirrors Pattern B's suppressSubtotalIds, but uses Pattern A's _lt/_st key suffixes).
  const suppressSubtotalIds = useMemo(() => {
    if (!hideEmptySections) return new Set<string>();
    const nonEmptySubtotals = new Set<string>();
    let currentHdrId: string | null = null;
    let currentSectionTotalId: string | null = null;
    let sectionHasData = false;
    const flush = () => {
      if (currentHdrId !== null && sectionHasData && currentSectionTotalId)
        nonEmptySubtotals.add(currentSectionTotalId);
    };
    for (const row of config.rows) {
      if (row.isSectionHeader) {
        flush();
        currentHdrId = row.id; currentSectionTotalId = null; sectionHasData = false;
      } else if (row.isTotal && row.id !== grandTotalId) {
        currentSectionTotalId = row.id;
      } else if (!row.isTotal && currentHdrId !== null && !hiddenRows.includes(row.id)) {
        if ((cy[row.id + "_lt"] ?? 0) !== 0 || (cy[row.id + "_st"] ?? 0) !== 0 ||
            (py[row.id + "_lt"] ?? 0) !== 0 || (py[row.id + "_st"] ?? 0) !== 0) sectionHasData = true;
        if (!sectionHasData && hasAnyDescendantValueA(row.id)) sectionHasData = true;
      }
    }
    flush();
    return nonEmptySubtotals.size === 1 ? nonEmptySubtotals : new Set<string>();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideEmptySections, config.rows, cy, py, rawCy, rawPy, customRows, hiddenRows, grandTotalId]);

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

  // Build move-target options, qualifying each row's label with its section
  // header (Secured / Unsecured / Quoted / Unquoted). Without this, notes like
  // Borrowings list "Term loans — Banks" identically under BOTH Secured and
  // Unsecured, so moving a ledger to "Term Loans — Banks (Unsecured)" looked
  // like it landed in Secured (the user couldn't tell the two options apart).
  // The move itself keys off the distinct row id, so disambiguating the label
  // makes the correct sub-classification selectable. (Word-file Issue D.)
  const staticHeadingOptions = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    let currentSection = "";
    for (const r of config.rows) {
      if (r.isSectionHeader) { currentSection = r.label || ""; continue; }
      if (r.isTotal || hiddenRows.includes(r.id)) continue;
      const base = labelOverrides[r.id] ?? r.label;
      out.push({
        id: r.id,
        label: currentSection ? `${base} (${currentSection})` : base,
      });
    }
    return out;
  }, [config, hiddenRows, labelOverrides]);
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

  // ── BUG N1 FIX (Pattern A) ───────────────────────────────────────────
  // Same recursive descent as Pattern B's renderTreeB, but emitting the
  // LT/ST 4-column variant of CustomRowEditor. Used for borrowings,
  // provisions, investments, loans_advances and every other Pattern A
  // note where 3+ level nesting could occur (e.g. "Other LT Liab" →
  // "Group" → "Sub-group" → "Vendor").
  const renderTreeA = (roots: NCECustomRow[], ancestorIds: Set<string>): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    for (const cr of roots) {
      if (ancestorIds.has(cr.id)) continue; // cycle guard
      const myChildren = customRows.filter(c => c.attachedTo === cr.id);
      const crIsOpen = openSources.has(cr.id);
      // SHREE HARI mirror — sources[] array also counts as "children"
      // for aggregate-display purposes; show aggregate regardless of
      // expand state when there ARE children. See renderTreeB above.
      const hasSrcs = Array.isArray((cr as any).sources) && (cr as any).sources.length > 0;
      const hasChildren = myChildren.length > 0 || hasSrcs;
      const crAgg = hasChildren ? sumCustomDisplayA(cr.id) : null;
      const isChild = ancestorIds.size > 0;
      const nextAncestors = new Set(ancestorIds);
      nextAncestors.add(cr.id);
      nodes.push(
        <CustomRowEditor
          key={cr.id}
          row={cr}
          cyVal={0} pyVal={0}
          isPatternA={true}
          readOnly={hideEmptySections}
          isChild={isChild}
          cyLtVal={crAgg ? crAgg.lc : (rawCy[cr.id + "_lt"] ?? 0)}
          cyStVal={crAgg ? crAgg.sc : (rawCy[cr.id + "_st"] ?? 0)}
          pyLtVal={crAgg ? crAgg.lp : (rawPy[cr.id + "_lt"] ?? 0)}
          pyStVal={crAgg ? crAgg.sp : (rawPy[cr.id + "_st"] ?? 0)}
          onChangeCy={() => {}} onChangePy={() => {}}
          onChangeCyLt={v => onChangeCy(cr.id + "_lt", v)}
          onChangeCySt={v => onChangeCy(cr.id + "_st", v)}
          onChangePyLt={v => onChangePy(cr.id + "_lt", v)}
          onChangePySt={v => onChangePy(cr.id + "_st", v)}
          onChangeLabel={label => onChangeLabel(cr.id, label)}
          onDelete={() => onDeleteRow(cr.id)}
          headingOptions={allHeadingOptions.filter(o => o.id !== cr.id && !ancestorIds.has(o.id))}
          onPromote={(targetId) => onPromote(cr.id, targetId)}
          onSwapLtSt={onSwapLtSt ? () => onSwapLtSt(cr.id) : undefined}
          onEjectCustomSource={(ledger, amt) => onEjectCustomSource(cr.id, ledger, amt)}
          onAddRow={onAddRow}
          hasSubRows={hasChildren}
          isOpen={crIsOpen}
          onToggle={() => toggleSources(cr.id)}
          sourceLabelOverrides={sourceLabelOverrides}
          onChangeSourceLabel={onChangeSourceLabel}
        />
      );
      if (hasChildren && crIsOpen) {
        nodes.push(...renderTreeA(myChildren, nextAncestors));
      }
    }
    return nodes;
  };

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
          // Task 2 (doc8): in lock preview mode, hide empty section headers and their totals
          if (row.isSectionHeader && emptySectionHdrIds.has(row.id)) return null;
          if (row.isTotal && emptySectionTotalIds.has(row.id)) return null;
          // Suppress lone section subtotal that equals grand total (double-Total fix)
          if (row.isTotal && suppressSubtotalIds.has(row.id)) return null;
          // Changes doc Task 2: in readOnly/preview mode, suppress zero data rows.
          // Pattern A uses _lt and _st suffixed keys for Long-Term / Short-Term columns.
          if (hideEmptySections && !row.isSectionHeader && !row.isTotal && !hiddenRows.includes(row.id)) {
            // Use sumCustomDisplayA which recurses into the entire descendant
            // tree so grand-children with amounts keep their row visible.
            const own = sumCustomDisplayA(row.id);
            const aggCy = own.lc + own.sc;
            const aggPy = own.lp + own.sp;
            if (!aggCy && !aggPy) return null;
          }
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
              {/* BUG N1 (Pattern A) — section-level custom rows now rendered
                  recursively. Replaces 2-level hard-coded loop so any depth
                  of nested groupings (sub-groups under sub-groups) renders. */}
              {renderTreeA(sectionRows, new Set())}

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
                const hasSrcsA     = (cySources[row.id]?.filter(s => Number(s.amountCy ?? 0) !== 0 || Number((s as any).amountPy ?? 0) !== 0).length ?? 0) > 0;
                const showToggleA  = hasSrcsA || hasAttachedA;
                const isOpenA      = openSources.has(row.id);
                // Preview: blank only the column(s) covered by visible source-ledger entries —
                // LT sources blank LT cells; ST sources blank ST cells; custom children blank all.
                const hasLtSrcsA = hideEmptySections && isOpenA && (cySources[row.id]?.some(s => (s.column === "lt" || !s.column) && (Number(s.amountCy ?? 0) !== 0 || Number((s as any).amountPy ?? 0) !== 0)) ?? false);
                const hasStSrcsA = hideEmptySections && isOpenA && (cySources[row.id]?.some(s => s.column === "st" && (Number(s.amountCy ?? 0) !== 0 || Number((s as any).amountPy ?? 0) !== 0)) ?? false);

                // Safety net: per-column overlap subtract — same idea as
                // Pattern B but split by lt/st so an LT ejection doesn't
                // wipe an ST contribution.
                const overlapLtCy = hasAttachedA ? overlapForRow(row.id, attachedHere, "cy", "lt") : 0;
                const overlapStCy = hasAttachedA ? overlapForRow(row.id, attachedHere, "cy", "st") : 0;
                const overlapLtPy = hasAttachedA ? overlapForRow(row.id, attachedHere, "py", "lt") : 0;
                const overlapStPy = hasAttachedA ? overlapForRow(row.id, attachedHere, "py", "st") : 0;
                const aggLtCy = (rawCy[row.id + "_lt"] ?? 0) - overlapLtCy + (hasAttachedA ? attachedHere.reduce((s, cr) => s + sumCustomDisplayA(cr.id).lc, 0) : 0);
                const aggStCy = (rawCy[row.id + "_st"] ?? 0) - overlapStCy + (hasAttachedA ? attachedHere.reduce((s, cr) => s + sumCustomDisplayA(cr.id).sc, 0) : 0);
                const aggLtPy = (rawPy[row.id + "_lt"] ?? 0) - overlapLtPy + (hasAttachedA ? attachedHere.reduce((s, cr) => s + sumCustomDisplayA(cr.id).lp, 0) : 0);
                const aggStPy = (rawPy[row.id + "_st"] ?? 0) - overlapStPy + (hasAttachedA ? attachedHere.reduce((s, cr) => s + sumCustomDisplayA(cr.id).sp, 0) : 0);

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
                      {/* Template caption — LOCKED for editing (2026-06-17).
                          Only Tally-derived rows (custom rows + sub-ledger
                          names) are renameable; the statutory note captions are
                          read-only so the audit-report structure cannot drift. */}
                      <Input
                        value={displayLabel}
                        readOnly
                        tabIndex={-1}
                        title="Statutory caption — locked. Rename the Tally-derived ledger rows instead."
                        className="h-6 text-xs px-1.5 border-transparent bg-transparent cursor-default focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                    </div>
                  </TableCell>
                  {/* When collapsed with children: show aggregate as read-only.
                      When expanded with children: static row's own NumInput is disabled
                      to prevent double-counting (children's amounts are separately tracked).
                      When no children: editable NumInput as normal. */}
                  {/* SHREE HARI FIX (Pattern A) — always show the rolled-up
                      aggregate when this row has attached children. Previously
                      only the collapsed view did so; expanded view fell back
                      to a disabled NumInput showing 0. Same logic as Pattern B
                      above. */}
                  <TableCell className="p-1">
                    {(hideEmptySections && isOpenA && hasAttachedA) || hasLtSrcsA
                      ? <span className="text-xs tabular-nums text-right block pr-1" />
                      : hasAttachedA
                        ? <span className="text-xs tabular-nums text-right block pr-1">{aggLtCy ? fmtNum(aggLtCy) : "—"}</span>
                        : <NumInput value={rawCy[row.id + "_lt"] ?? 0} onChange={v => onChangeCy(row.id + "_lt", v)} disabled={row.naLT} />}
                  </TableCell>
                  <TableCell className="p-1 border-r">
                    {(hideEmptySections && isOpenA && hasAttachedA) || hasLtSrcsA
                      ? <span className="text-xs tabular-nums text-right block pr-1" />
                      : hasAttachedA
                        ? <span className="text-xs tabular-nums text-right block pr-1">{aggLtPy ? fmtNum(aggLtPy) : "—"}</span>
                        : <NumInput value={rawPy[row.id + "_lt"] ?? 0} onChange={v => onChangePy(row.id + "_lt", v)} disabled={row.naLT} />}
                  </TableCell>
                  <TableCell className="p-1">
                    {(hideEmptySections && isOpenA && hasAttachedA) || hasStSrcsA
                      ? <span className="text-xs tabular-nums text-right block pr-1" />
                      : hasAttachedA
                        ? <span className="text-xs tabular-nums text-right block pr-1">{aggStCy ? fmtNum(aggStCy) : "—"}</span>
                        : <NumInput value={rawCy[row.id + "_st"] ?? 0} onChange={v => onChangeCy(row.id + "_st", v)} disabled={row.naST} />}
                  </TableCell>
                  <TableCell className="p-1">
                    {(hideEmptySections && isOpenA && hasAttachedA) || hasStSrcsA
                      ? <span className="text-xs tabular-nums text-right block pr-1" />
                      : hasAttachedA
                        ? <span className="text-xs tabular-nums text-right block pr-1">{aggStPy ? fmtNum(aggStPy) : "—"}</span>
                        : <NumInput value={rawPy[row.id + "_st"] ?? 0} onChange={v => onChangePy(row.id + "_st", v)} disabled={row.naST} />}
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
                cySources[row.id]?.filter(s => Number(s.amountCy ?? 0) !== 0 || Number((s as any).amountPy ?? 0) !== 0).map((s, i) => {
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

              {/* BUG N1 (Pattern A static-expanded) — recursive render of
                  every descendant so deeper nesting (3+ levels) becomes
                  visible & editable. Mirrors the Pattern B fix. */}
              {attachedHere.length > 0 && openSources.has(row.id) &&
                renderTreeA(attachedHere, new Set([row.id]))}
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

export function NCEDetailedNotes({ engagementId, dynamicNoteMap, onExpansionStateUpdate, readOnly = false, initialExpandedRows }: Props) {
  const queryClient = useQueryClient();
  const [noteData,    setNoteData]    = useState<Record<string, NCENoteData>>({});
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [syncing,     setSyncing]     = useState(false);
  const [eng,         setEng]         = useState<any>(null);
  // undefined = uncontrolled; true = all collapsed; false = all expanded
  const [collapseAll, setCollapseAll] = useState<boolean | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Task 8: accumulate expansion state across all PatternBTables
  const expansionStateRef = useRef<Record<string, Set<string>>>({});
  // Label-edit persistence guards (2026-06-17).
  //  • initializedRef → false until the first DB load completes, so the initial
  //    deserialise / first-visit seed / one-shot heals never trigger a write.
  //  • notesFinalizedRef → mirrors audit_engagements.notes_finalized so every
  //    write path can hard-block edits on a finalized (rolled-over / closed)
  //    engagement. App-level enforcement of the "notes write-protected" rule.
  const initializedRef    = useRef(false);
  const notesFinalizedRef = useRef(false);
  // Fix E: when the parent omits initialExpandedRows (edit mode), fall back to
  // the expand/collapse layout persisted in localStorage so unlocking the
  // preview (or a refresh) restores the state the user had at lock time. This is
  // a STABLE memo (deps don't change while editing) so it only seeds the table's
  // openSources at mount — it never feeds a reactive prop back into the render
  // loop the way passing live nceExpandedRows in edit mode would.
  const seedExpanded = useMemo<Set<string> | undefined>(() => {
    if (initialExpandedRows) return initialExpandedRows;
    try {
      const raw = localStorage.getItem(`nce_expanded_${engagementId}`);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr) && arr.length > 0) return new Set<string>(arr);
    } catch { /* ignore */ }
    return undefined;
  }, [initialExpandedRows, engagementId]);

  // Stable expansion-change handler. Passing an INLINE arrow here re-created the
  // function every render, so PatternBTable's [openSources, noteType,
  // onExpansionChange] effect re-fired on every render → onExpansionStateUpdate →
  // parent setNceExpandedRows → re-render → effect re-fires → "Maximum update
  // depth exceeded". Memoising on the (already-stable) onExpansionStateUpdate
  // prop means the effect now only fires when openSources actually changes.
  const handleExpansionChange = useCallback((nt: string, ids: Set<string>) => {
    expansionStateRef.current[nt] = ids;
    onExpansionStateUpdate?.(expansionStateRef.current);
  }, [onExpansionStateUpdate]);

  const financialYear = (eng?.financial_year as string) || "";
  const clientName    = (eng?.clients?.name  as string) || "";
  const { cy: cyYear, py: pyYear } = useMemo(() => parseFY(financialYear), [financialYear]);


  // ── Persist helper ──────────────────────────────────────────────────────
  // WRITE-PROTECTED: persistNotes is a no-op. Notes are write-protected from
  // the UI to prevent silent overwrites of audit-verified data. All note
  // writes must go through direct DB updates from the audit team.
  const persistNotes = useCallback(async (
    _data: Record<string, NCENoteData>,
    _fy:   string,
  ) => {
    // no-op
  }, []);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!engagementId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: engRow } = await supabase
          .from("audit_engagements")
          .select("financial_year, notes_finalized, clients(name)")
          .eq("id", engagementId)
          .single();
        if (cancelled) return;
        if (engRow) setEng(engRow);
        notesFinalizedRef.current = (engRow as any)?.notes_finalized === true;

        const fy = (engRow as any)?.financial_year ?? "";

        // NCE Task 7 fix: always filter by financial_year so notes from
        // other FY rows never mix into the current year's load.
        const { data, error } = await supabase
          .from("nce_financial_notes")
          .select("note_type, cy_data, py_data")
          .eq("engagement_id", engagementId)
          .eq("financial_year", fy);
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
            // EMPTY ROWS: write-protected — do not overwrite. Show blank.
            if (!cancelled) setNoteData(built);
          } else {
            // ── MIGRATION: old split keys → unified source key ─────────────
            // Before the sourceNoteType architecture, borrowings_lt/borrowings_st
            // and provisions_lt/provisions_st were stored as independent DB rows
            // with BARE row IDs (no _lt/_st suffix).  New code reads from the
            // unified source key ("borrowings", "provisions") with suffixed keys.
            // If the source key is absent/empty but old split rows have data,
            // convert once so all four split display notes show the correct amounts.
            {
              const SPLIT_SOURCES: Array<{
                sourceKey: string;
                sides: Array<{ oldKey: string; side: "lt" | "st" }>;
              }> = [
                { sourceKey: "borrowings",    sides: [{ oldKey: "borrowings_lt",    side: "lt"  }, { oldKey: "borrowings_st",    side: "st"  }] },
                { sourceKey: "provisions",    sides: [{ oldKey: "provisions_lt",    side: "lt"  }, { oldKey: "provisions_st",    side: "st"  }] },
                // Task 6: loans_advances split — migrate any data stored under old combined key
                { sourceKey: "loans_advances", sides: [{ oldKey: "loans_advances_lt", side: "lt" }, { oldKey: "loans_advances_st", side: "st" }] },
              ];
              for (const { sourceKey, sides } of SPLIT_SOURCES) {
                const existing   = built[sourceKey];
                const srcEmpty   = !existing || Object.keys(existing.cy).length === 0;
                const hasOldData = sides.some(({ oldKey }) => {
                  const old = built[oldKey];
                  return !!(old && Object.keys(old.cy).length > 0);
                });
                if (srcEmpty && hasOldData) {
                  const migratedCy: Record<string, number>  = {};
                  const migratedPy: Record<string, number>  = {};
                  const migratedCrs: NCECustomRow[]          = [];
                  for (const { oldKey, side } of sides) {
                    const old = built[oldKey];
                    if (!old) continue;
                    for (const [k, v] of Object.entries(old.cy)) migratedCy[`${k}_${side}`] = v as number;
                    for (const [k, v] of Object.entries(old.py)) migratedPy[`${k}_${side}`] = v as number;
                    for (const cr of old.customRows ?? []) migratedCrs.push({ ...cr, section: side });
                  }
                  built[sourceKey] = {
                    cy:                  migratedCy,
                    py:                  migratedPy,
                    customRows:          migratedCrs,
                    ejectedLedgers:      existing?.ejectedLedgers      ?? [],
                    hiddenRows:          existing?.hiddenRows           ?? [],
                    labelOverrides:      existing?.labelOverrides       ?? {},
                    sourceLabelOverrides:existing?.sourceLabelOverrides ?? {},
                    cy_sources:          existing?.cy_sources           ?? {},
                  };
                  healed = true;
                }
              }
            }

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
            const isFallbackRow = (cr: NCECustomRow) =>
              cr.id === "custom_auto_total" || cr.label === "Auto-filled from COA total";
            for (const [nType, d] of Object.entries(built)) {
              // The "Auto-filled from COA total" row carries the WHOLE COA
              // fallback total. The moment any OTHER row (manual OR a real
              // auto-matched ledger row, e.g. "Interest On Deposit" placed via
              // "Move to…") holds a non-zero amount in CY or PY, that placeholder
              // double-counts. Strip it whenever such a row exists. (Broadened
              // from the old manual-only / CY-only check, which missed both
              // auto-matched ledger rows and notes whose figures live in PY.)
              const hasOtherData = (d.customRows || []).some(cr =>
                !isFallbackRow(cr) && (
                  Math.abs(d.cy?.[cr.id] ?? 0) > 0.005 ||
                  Math.abs(d.py?.[cr.id] ?? 0) > 0.005 ||
                  Math.abs(d.cy?.[cr.id + "_lt"] ?? 0) > 0.005 ||
                  Math.abs(d.py?.[cr.id + "_lt"] ?? 0) > 0.005 ||
                  Math.abs(d.cy?.[cr.id + "_st"] ?? 0) > 0.005 ||
                  Math.abs(d.py?.[cr.id + "_st"] ?? 0) > 0.005
                ),
              );
              if (!hasOtherData) continue;
              const autoTotalRows = (d.customRows || []).filter(isFallbackRow);
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
            // 2026-06-01 — Self-heal stale STATIC-ROW PY (and CY) values left
            // behind by the pre-fix Move-to / Eject. When a ledger was moved
            // off a smart-matched static row, the old eject handler only
            // subtracted the CY amount; the static row's PY kept the moved
            // ledger's value (e.g. REVTI INFRA: "Rates and taxes" PY stuck at
            // 39,96,555 after "Registration and Stamp Duty Expense" was
            // moved). cy_sources is the live list of contributing ledgers,
            // so the static row's amount must equal sum(amountCy / amountPy)
            // across remaining sources. Recompute and update if drifted.
            // Idempotent: if the values already match, nothing changes.
            for (const [nType, d] of Object.entries(built)) {
              if (!d.cy_sources || Object.keys(d.cy_sources).length === 0) continue;
              const cleanedCy = { ...d.cy };
              const cleanedPy = { ...d.py };
              let touched = false;
              for (const [rowId, sources] of Object.entries(d.cy_sources)) {
                if (!Array.isArray(sources)) continue;
                // Only heal rows that have a Pattern-B-style single value
                // (no _lt / _st suffix in cy/py). Pattern A column sums are
                // handled by their own LT/ST keys and the eject fix already
                // covers both columns symmetrically.
                const hasSuffix = (rowId + "_lt") in cleanedCy
                              || (rowId + "_st") in cleanedCy
                              || (rowId + "_lt") in cleanedPy
                              || (rowId + "_st") in cleanedPy;
                if (hasSuffix) continue;
                const expectedCy = (sources as any[]).reduce((s, x) => s + Number(x?.amountCy ?? 0), 0);
                const expectedPy = (sources as any[]).reduce((s, x) => s + Number(x?.amountPy ?? 0), 0);
                const curCy = Number(cleanedCy[rowId] ?? 0);
                const curPy = Number(cleanedPy[rowId] ?? 0);
                if (Math.abs(curCy - expectedCy) > 0.005) {
                  cleanedCy[rowId] = Math.round(expectedCy * 100) / 100;
                  touched = true;
                }
                // 2026-06-12 — RC-11 (OM REALTY Note 14): heal PY ONLY when the
                // sources actually carry PY data. Legacy cy_sources entries
                // (pre-amountPy feature) have no amountPy field at all —
                // expectedPy computes to 0 and this block was DESTROYING the
                // correct saved PY value in memory (cogs pc_close_wip PY
                // ₹13,65,98,000 → 0, so the note displayed PY Increase/Decrease
                // ₹17,53,11,000 while the P&L face correctly showed
                // ₹3,87,13,000 from the same DB row). If no source defines
                // amountPy, the saved PY value is the only truth — keep it.
                const anyPyDefined = (sources as any[]).some(
                  x => x && x.amountPy !== undefined && x.amountPy !== null,
                );
                if (anyPyDefined && Math.abs(curPy - expectedPy) > 0.005) {
                  cleanedPy[rowId] = Math.round(expectedPy * 100) / 100;
                  touched = true;
                }
              }
              if (touched) {
                built[nType] = { ...d, cy: cleanedCy, py: cleanedPy };
                healed = true;
              }
            }

            // 2026-06-02 self-heal — back-fill tbDerived on legacy saved rows
            // so the new amount-lock rule applies to previously-stored data.
            // Rules:
            //   • source === "auto"      → tbDerived: true (auto rows always
            //                              came from TB).
            //   • ejectedSource is set   → tbDerived: true (the row carries a
            //                              TB ledger's value).
            //   • everything else        → leave as-is (could be a hand-typed
            //                              "+ Add row" entry the user wants
            //                              editable — DO NOT lock retroactively).
            for (const [nType, d] of Object.entries(built)) {
              const patched = (d.customRows ?? []).map(cr => {
                if (cr.tbDerived === true) return cr;
                if (cr.source === "auto" || cr.ejectedSource) {
                  return { ...cr, tbDerived: true };
                }
                return cr;
              });
              if (patched.some((cr, i) => cr !== (d.customRows ?? [])[i])) {
                built[nType] = { ...d, customRows: patched };
                healed = true;
              }
            }

            // Task 4 heal (doc8): promote auto rows that the user previously
            // placed under a static parent via "Move to…" back to source:"manual"
            // so nceAutoPopulate preserves them verbatim on every subsequent
            // re-sync. Pre-fix saves stored these moves with source:"auto",
            // causing the hierarchy to reset on reload when auto-populate ran.
            // This one-shot heal upgrades any such rows in the DB on first load.
            // Idempotent: already-"manual" rows are untouched.
            //
            // 2026-06-02 — Also promote tbDerived during this conversion so
            // the moved row's amount stays locked (was previously source=auto
            // → locked; after this heal source=manual but we add tbDerived to
            // keep the lock).
            for (const [nType, d] of Object.entries(built)) {
              const patched = (d.customRows ?? []).map(cr =>
                cr.source === "auto" && cr.attachedTo && !cr.attachedTo.startsWith("custom_")
                  ? { ...cr, source: "manual" as const, tbDerived: true }
                  : cr,
              );
              if (patched.some((cr, i) => cr !== (d.customRows ?? [])[i])) {
                built[nType] = { ...d, customRows: patched };
                healed = true;
              }
            }

            // Task 4b heal: backfill userMoved flag for existing manual rows
            // that were placed by the user (Move To or Eject-to-heading).
            // source:"manual" + tbDerived:true + attachedTo (pointing at a
            // static row) can ONLY arise from a user Move To / Eject action
            // or the Task 4 heal above. Marking them userMoved prevents the
            // per-ledger-breakup purge from destroying the placement.
            // Rows with ejectedSource are already protected by ejectedLedgers
            // but also benefit from userMoved as a belt-and-suspenders guard.
            for (const [nType, d] of Object.entries(built)) {
              const patched = (d.customRows ?? []).map(cr => {
                if (cr.source === "manual" && cr.tbDerived === true &&
                    cr.attachedTo && !cr.attachedTo.startsWith("custom_") &&
                    !cr.userMoved) {
                  return { ...cr, userMoved: true };
                }
                return cr;
              });
              if (patched.some((cr, i) => cr !== (d.customRows ?? [])[i])) {
                built[nType] = { ...d, customRows: patched };
                healed = true;
              }
            }

            // Note 4 heal (NCE — duplicate rendering / runaway accumulation):
            // collapse EVERY duplicate custom row in a note down to a single row,
            // regardless of source. A pre-fix loop (auto walk re-creating each
            // ledger + the "promote to manual" heal converting them on every
            // cycle) accumulated the SAME ledger 10-20x (e.g. "ICICI Bank Car
            // Loan" x20, the "390 manual" purchases note), inflating totals and
            // wasting dozens of export pages. We key on label+attachedTo+section,
            // keep the FIRST occurrence (prefer a manual row if one exists so the
            // user's placement wins), and purge the dropped rows' cy/py amount
            // keys so totals stop multiplying. One-shot cleanup of saved data;
            // nceAutoPopulate + export now also dedupe, so it cannot recur.
            for (const [nType, d] of Object.entries(built)) {
              const rows = d.customRows ?? [];
              if (rows.length === 0) continue;
              const rowKey = (r: NCECustomRow) =>
                `${(r.label || "").trim().toLowerCase()}|${r.attachedTo ?? ""}|${r.section ?? ""}`;
              // First pass: for each key, prefer to keep a manual row over an auto row.
              const keepByKey = new Map<string, NCECustomRow>();
              for (const r of rows) {
                if (!(r.label || "").trim()) continue; // never dedupe blank labels
                const k = rowKey(r);
                const existing = keepByKey.get(k);
                if (!existing) { keepByKey.set(k, r); continue; }
                if (existing.source !== "manual" && r.source === "manual") keepByKey.set(k, r);
              }
              const keptIds = new Set([...keepByKey.values()].map(r => r.id));
              const keptRows: NCECustomRow[] = [];
              const droppedIds = new Set<string>();
              for (const r of rows) {
                if (!(r.label || "").trim()) { keptRows.push(r); continue; }
                if (keptIds.has(r.id)) keptRows.push(r);
                else droppedIds.add(r.id);
              }
              if (droppedIds.size === 0) continue;
              const cleanCy = { ...d.cy };
              const cleanPy = { ...d.py };
              for (const id of droppedIds) {
                for (const suffix of ["", "_lt", "_st"]) {
                  delete cleanCy[id + suffix];
                  delete cleanPy[id + suffix];
                }
              }
              built[nType] = { ...d, customRows: keptRows, cy: cleanCy, py: cleanPy };
              healed = true;
            }

            // SELF-HEAL WRITE DISABLED — write-protected from UI.
            if (!cancelled) setNoteData(built);
            // Whenever the heal touched a note (esp. un-ejected a ledger),
            // immediately re-run auto-populate so the freshly-unblocked
            // ledger gets smart-matched into its proper static row. This
            // restores Total (B) for clients whose stage8 state had orphan
            // ejected ledgers under deleted parents.
            const unEjectedAny = Object.keys(unEjectByNote).length > 0;
            // Back-fill cy_sources for engagements saved before the feature was added.
            // FIX: gate behind a one-shot localStorage flag — without this, notes
            // that legitimately have no cy_sources (e.g. only custom-row amounts)
            // would trigger re-sync on every page load, same class of bug as
            // the needsPyAnyEmpty infinite loop.
            const cySourcesMigrationKey = `nce_cy_sources_backfill_v1_${engagementId}`;
            const cySourcesMigrationDone = localStorage.getItem(cySourcesMigrationKey) === "1";
            const needsCySources = !cySourcesMigrationDone && Object.values(built).some(
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
            const pySourcesMigrationKey = `nce_cy_sources_amountpy_v12_${engagementId}`;
            const pySourcesMigrationDone = localStorage.getItem(pySourcesMigrationKey) === "1";
            // Issue (debit/credit netting): saved totals pre-fix added Math.abs
            // of opposite-side balances instead of subtracting. Force one-shot
            // re-sync so notes pick up the new signed aggregation.
            const drCrMigrationKey = `nce_drcr_netting_v2_${engagementId}`;
            const drCrMigrationDone = localStorage.getItem(drCrMigrationKey) === "1";
            // SIGN ROOT-CAUSE FIX (2026-06-05): manual TB-backed rows in
            // strictly-TB-driven notes (trade_payables, other_cl, other_lt_liab,
            // cogs) stored a WRONG-SIGNED PY when the engagement had no PY shell
            // — a Dr-on-Cr-head advance (e.g. SHREE HARI's "Member Sales (Pos)")
            // was kept as +27.9cr instead of −27.9cr, so the FS notes total and
            // BS face diverged from the signed-TB COA-Mapping BS by 2×. The
            // nceAutoPopulate refresh now falls back to the SIGNED CY opening
            // (signedLedgerOpeningAmt) for PY. Bump this one-shot flag so every
            // engagement re-runs the refresh ONCE to pick up the corrected sign.
            const signFixMigrationKey = `nce_sign_fix_v1_${engagementId}`;
            const signFixMigrationDone = localStorage.getItem(signFixMigrationKey) === "1";
            const needsPyAnyEmpty = Object.values(built).some(d => {
              const hasCY = Object.values(d.cy ?? {}).some(v => Math.abs(Number(v) || 0) > 0.005);
              const hasPY = Object.values(d.py ?? {}).some(v => Math.abs(Number(v) || 0) > 0.005);
              return hasCY && !hasPY;
            });
            // FIX: gate needsPyAnyEmpty behind the migration flag. Previously
            // the || made re-sync run on EVERY load for entities with any note
            // lacking PY data, destroying user Move To placements each time.
            const needsPyRefresh = !pyMigrationDone && needsPyAnyEmpty;
            const needsCySourcesPyRefresh = !pySourcesMigrationDone;
            const needsDrCrRefresh = !drCrMigrationDone;
            const needsSignFixRefresh = !signFixMigrationDone;
            // ─── PHASE 7 INSTRUMENTATION (REMOVE AFTER DIAGNOSIS) ───
            // Log silent re-sync trigger + the Member Sales py value in `built`
            // BEFORE nceAutoPopulate is called. Helps determine whether the
            // override is inside nceAutoPopulate or inside something upstream.
            try {
              const builtOcl = built["other_cl"] || { cy: {}, py: {}, customRows: [] };
              const msRow = (builtOcl.customRows || []).find((r: any) => /member sales/i.test(r.label || ""));
              const msId = msRow ? msRow.id : null;
              // eslint-disable-next-line no-console
              console.log("[SIGN-TRACE] CALLER  trigger conditions", {
                unEjectedAny, needsCySources, needsPyRefresh,
                needsCySourcesPyRefresh, needsDrCrRefresh, needsSignFixRefresh,
                signFixMigrationDone,
              });
              if (msId) {
                // eslint-disable-next-line no-console
                console.log("[SIGN-TRACE] CALLER  Member Sales in `built` before nceAutoPopulate", {
                  id: msId,
                  builtPy_ms: builtOcl.py?.[msId],
                  builtCy_ms: builtOcl.cy?.[msId],
                  source: msRow.source, attachedTo: msRow.attachedTo,
                });
              } else {
                // eslint-disable-next-line no-console
                console.log("[SIGN-TRACE] CALLER  no Member Sales row in built[other_cl]");
              }
            } catch (e) { /* ignore */ }
            // SILENT-RESYNC DISABLED — was overwriting audit-verified note
            // data whenever Notes page loaded if any localStorage migration
            // flag was missing. All such re-sync paths are now no-ops.
            // Touch the flags so subsequent loads skip even cheaper.
            try { localStorage.setItem(pyMigrationKey, "1"); } catch {}
            try { localStorage.setItem(pySourcesMigrationKey, "1"); } catch {}
            try { localStorage.setItem(drCrMigrationKey, "1"); } catch {}
            try { localStorage.setItem(signFixMigrationKey, "1"); } catch {}
            try { localStorage.setItem(cySourcesMigrationKey, "1"); } catch {}
          }
        } else {
          // FIRST VISIT (no rows in nce_financial_notes for this engagement
          // + FY yet) — SHREEYAM INFRA scenario. Run the standard auto-
          // populate so every NCE note gets its ledger bifurcation + amounts
          // from the COA mapping the auditor just completed, then SEED the
          // DB with those rows.
          //
          // The general write-protection above prevents silent overwrites of
          // audit-verified data — but on a fresh engagement there's nothing
          // to protect. Without this seed the Notes tab opens completely
          // empty (no rows, no totals) even though the BS / P&L face read
          // correct totals straight from the COA mapping, leaving the
          // auditor with no breakup at all.
          //
          // Concurrency guard: the auto-populate result is upserted with
          // onConflict on (engagement_id, financial_year, note_type) so a
          // second concurrent first-visit (e.g. two tabs) merges cleanly
          // instead of crashing on the unique index.
          try {
            const populated = await nceAutoPopulate(engagementId, {});
            if (!cancelled) setNoteData(populated);
            const noteTypes = Object.keys(populated);
            if (noteTypes.length > 0 && fy) {
              const rows = noteTypes.map(noteType => {
                const { cy_data, py_data } = serialiseNoteData(populated[noteType]);
                return {
                  engagement_id:  engagementId,
                  financial_year: fy,
                  note_type:      noteType,
                  cy_data,
                  py_data,
                };
              });
              try {
                await supabase
                  .from("nce_financial_notes")
                  .upsert(rows, { onConflict: "engagement_id,financial_year,note_type" });
                toast.success("Notes populated from COA mapping");
              } catch (writeErr) {
                console.warn("[NCEDetailedNotes] first-visit seed write failed", writeErr);
                toast.error("Notes loaded but could not be saved. Please refresh.");
              }
            }
          } catch (popErr) {
            console.error("[NCEDetailedNotes] first-visit auto-populate failed", popErr);
            if (!cancelled) setNoteData({});
          }
        }
      } catch (e: any) {
        toast.error(`Failed to load notes: ${e?.message || e}`);
      } finally {
        // Mark initialised AFTER the load (incl. first-visit seed + heals) has
        // settled, so label-edit persistence only fires on genuine user edits.
        if (!cancelled) { setLoading(false); initializedRef.current = true; }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  // AUTO-SAVE DISABLED — was overwriting audit-verified note data whenever
  // the Notes tab loaded. The toolbar "Save All Notes" button has also been
  // removed. Notes are now write-protected from the UI; direct DB writes only.
  const scheduleSave = useCallback((_data: Record<string, NCENoteData>) => {
    // no-op
  }, []);

  // ── Guarded auto-save (total-preserving reclassification only) ────────────
  // The blanket write-protection above stays in force for every figure edit.
  // The ONLY exception is a whole-ledger reclassification between sub-heads of
  // the same note (e.g. GST → TDS within Other Current Liabilities): it changes
  // no figure, so the note grand total — and therefore the BS/P&L face and the
  // BS/P&L grand totals — are mathematically unchanged. persistOneNote writes
  // exactly one note; commitMoveGuarded re-checks the note total before AND
  // after the move and only persists when it is byte-identical (CY and PY).
  // If a move would shift the total by even ₹1 it is reverted, never saved.
  const persistOneNote = useCallback(async (noteType: string, nd: NCENoteData) => {
    if (!engagementId || !financialYear) return;
    if (notesFinalizedRef.current) { toast.error("Notes are finalized — editing is locked."); return; }
    try {
      const { cy_data, py_data } = serialiseNoteData(nd);
      const { data: existing } = await supabase
        .from("nce_financial_notes")
        .select("id")
        .eq("engagement_id", engagementId)
        .eq("financial_year", financialYear)
        .eq("note_type", noteType)
        .maybeSingle();
      if ((existing as any)?.id) {
        await supabase.from("nce_financial_notes")
          .update({ cy_data, py_data, updated_at: new Date().toISOString() })
          .eq("id", (existing as any).id);
      } else {
        await supabase.from("nce_financial_notes")
          .insert({ engagement_id: engagementId, financial_year: financialYear, note_type: noteType, cy_data, py_data });
      }
      // Keep the pipeline's react-query cache (and therefore the DOCX export,
      // which reads from it) in sync with what was just written.
      queryClient.invalidateQueries({ queryKey: ["nce-financial-notes", engagementId] });
    } catch {
      toast.error("Auto-save failed — change not persisted.");
    }
  }, [engagementId, financialYear, queryClient]);

  // ── Labels-only guarded persist (2026-06-17) ──────────────────────────────
  // Renames (custom-row labels + sub-ledger overrides) must SAVE and survive a
  // refresh, but a rename must NEVER change an audit-verified figure. So instead
  // of writing the whole in-memory note (which could carry unsaved figure edits
  // or heal-time transforms), we fetch the existing DB row and overlay ONLY the
  // label-bearing metadata (_custom_rows, _label_overrides,
  // _source_label_overrides), keeping every numeric key byte-identical. This is
  // total-preserving by construction, so it cannot trip the reconciliation /
  // export-block invariants. Still hard-blocked when notes are finalized.
  const persistNoteLabels = useCallback(async (noteType: string) => {
    if (!engagementId || !financialYear) return;
    if (!initializedRef.current) return;
    if (notesFinalizedRef.current) { toast.error("Notes are finalized — editing is locked."); return; }
    const nd = noteDataRef.current[noteType];
    if (!nd) return;
    try {
      const { cy_data: memCy, py_data: memPy } = serialiseNoteData(nd);
      const { data: existing } = await supabase
        .from("nce_financial_notes")
        .select("id, cy_data")
        .eq("engagement_id", engagementId)
        .eq("financial_year", financialYear)
        .eq("note_type", noteType)
        .maybeSingle();
      if ((existing as any)?.id) {
        const dbCy = ((existing as any).cy_data ?? {}) as Record<string, any>;
        // Preserve ALL existing keys (numeric figures + other meta) from the DB;
        // overlay only the label metadata from memory. Figures are untouched.
        const mergedCy: Record<string, any> = {
          ...dbCy,
          _custom_rows:     (memCy as any)._custom_rows,
          _label_overrides: (memCy as any)._label_overrides,
          ...((memCy as any)._source_label_overrides
            ? { _source_label_overrides: (memCy as any)._source_label_overrides }
            : {}),
        };
        await supabase.from("nce_financial_notes")
          .update({ cy_data: mergedCy, updated_at: new Date().toISOString() })
          .eq("id", (existing as any).id);
      } else {
        // No row yet (rename before the note was seeded) → write the full note.
        await supabase.from("nce_financial_notes")
          .insert({ engagement_id: engagementId, financial_year: financialYear, note_type: noteType, cy_data: memCy, py_data: memPy });
      }
      queryClient.invalidateQueries({ queryKey: ["nce-financial-notes", engagementId] });
    } catch {
      toast.error("Save failed — name not persisted.");
    }
  }, [engagementId, financialYear, queryClient]);

  // Debounced wrapper for label-only persistence (separate timer namespace from
  // the move-persist below so a rename and a reclassification never collide).
  const pendingLabelPersist = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scheduleLabelPersist = useCallback((noteType: string) => {
    if (!initializedRef.current) return;
    const timers = pendingLabelPersist.current;
    if (timers[noteType]) clearTimeout(timers[noteType]);
    timers[noteType] = setTimeout(() => {
      delete timers[noteType];
      void persistNoteLabels(noteType).then(() => toast.success("Name saved"));
    }, 600);
  }, [persistNoteLabels]);

  // Latest note-data snapshot, kept fresh so the debounced persist below always
  // serialises the FINAL state — not a mid-bulk-move snapshot.
  const noteDataRef = useRef<Record<string, NCENoteData>>(noteData);
  useEffect(() => { noteDataRef.current = noteData; }, [noteData]);

  // Debounced, coalesced persist. A bulk "Move to…" reclassifies many rows in
  // one tick; persisting each move separately fired concurrent DB writes that
  // RACED, so a partial (mid-bulk) state won and rows reverted on reload. Now
  // every move just schedules one write per note, 500 ms after the last move,
  // serialising the final state once.
  const pendingPersist = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scheduleNotePersist = useCallback((noteType: string) => {
    if (!initializedRef.current) return;
    const timers = pendingPersist.current;
    if (timers[noteType]) clearTimeout(timers[noteType]);
    timers[noteType] = setTimeout(() => {
      delete timers[noteType];
      const nd = noteDataRef.current[noteType];
      if (nd) void persistOneNote(noteType, nd).then(() => toast.success("Reclassification saved"));
    }, 500);
  }, [persistOneNote]);

  const commitMoveGuarded = useCallback((
    noteType: string, cur: NCENoteData, nextNote: NCENoteData, _okMsg: string,
  ): NCENoteData => {
    const config = NOTES_CONFIG.find(c => c.noteType === noteType);
    const before = config ? noteGrandTotal(config, cur)      : { cy: 0, py: 0 };
    const after  = config ? noteGrandTotal(config, nextNote) : { cy: 0, py: 0 };
    const dCy = Math.abs(after.cy - before.cy);
    const dPy = Math.abs(after.py - before.py);
    if (dCy > 0.5 || dPy > 0.5) {
      const delta = Math.max(dCy, dPy);
      queueMicrotask(() => toast.error(
        `Move blocked — it would change the note total by ₹${Math.round(delta).toLocaleString("en-IN")}. Nothing was changed.`,
      ));
      return cur; // revert — keep the note exactly as it was
    }
    // Coalesced auto-save: one debounced write per note, immune to the bulk-move
    // race. The guard above already ran per move, so the accumulated state is
    // total-preserving.
    scheduleNotePersist(noteType);
    return nextNote;
  }, [scheduleNotePersist]);

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

      // 2026-05-30 — guard against deleting rows that carry an amount.
      // Removing a row with a non-zero CY / PY value silently drops it from
      // the note's breakup sum, leaving the Balance Sheet / P&L face total
      // (which still includes that amount via the COA mapping) divergent
      // from the note. The user reported the BS not balancing after such
      // deletions on OM REALTY. Block the deletion and surface a toast that
      // points the auditor at the right tools (Move to… / set value to 0,
      // or Re-sync from COA if they want the row back).
      const cyAmt = Math.abs(Number(cur.cy?.[id]        ?? 0))
                  + Math.abs(Number(cur.cy?.[id + "_lt"] ?? 0))
                  + Math.abs(Number(cur.cy?.[id + "_st"] ?? 0));
      const pyAmt = Math.abs(Number(cur.py?.[id]        ?? 0))
                  + Math.abs(Number(cur.py?.[id + "_lt"] ?? 0))
                  + Math.abs(Number(cur.py?.[id + "_st"] ?? 0));
      if (cyAmt > 0.005 || pyAmt > 0.005) {
        const row = cur.customRows.find(r => r.id === id);
        const label = row?.label || "this row";
        toast.error(
          `"${label}" carries an amount and cannot be deleted — deletion would break the Balance Sheet / P&L total. Set the value to 0 first, or use "Move to…" to re-parent it.`,
          { duration: 6000 },
        );
        return prev;     // <-- no state change
      }

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
    if (readOnly || notesFinalizedRef.current) return;
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      // Rename → mark source "manual" AND userMoved so the per-ledger-breakup
      // re-sync purge (nceAutoPopulate) can never rebuild over the corrected
      // name. Labels are metadata only — the row's amount is unchanged.
      const next = { ...prev, [noteType]: { ...cur, customRows: cur.customRows.map(r => r.id === id ? { ...r, label, source: "manual" as const, userMoved: true } : r) } };
      return next;
    });
    scheduleLabelPersist(noteType);
  }, [readOnly, scheduleLabelPersist]);

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
    if (readOnly || notesFinalizedRef.current) return;
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const key = `${rowId}::${ledger}`;
      const overrides = { ...(cur.sourceLabelOverrides ?? {}), [key]: newLabel };
      const next = { ...prev, [noteType]: { ...cur, sourceLabelOverrides: overrides } };
      return next;
    });
    scheduleLabelPersist(noteType);
  }, [readOnly, scheduleLabelPersist]);

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

      const movedRows = cur.customRows.map(r => {
        if (r.id === customId) {
          // Task 4 fix: mark as "manual" so nceAutoPopulate preserves this
          // user-set placement verbatim on every subsequent re-sync / reload,
          // instead of rebuilding from scratch and losing the attachedTo change.
          //
          // 2026-06-02 — A row that originated from TB (tbDerived=true OR was
          // an auto row) must keep its amount locked even after the move.
          // Promote tbDerived to true when the source was "auto" so legacy
          // saved data without the flag still gets locked post-move.
          const wasTbDerived = r.tbDerived === true || r.source === "auto";
          return {
            ...r,
            source: "manual" as const,
            attachedTo: targetId,
            userMoved: true,
            ...(wasTbDerived ? { tbDerived: true } : {}),
            ...(targetSection !== undefined ? { section: targetSection } : {}),
          };
        }
        if (r.id === targetId && shouldPromoteTarget) {
          return { ...r, section: sourceRow!.section };
        }
        return r;
      });

      // Drop the redundant "Auto-filled from COA total" placeholder row(s) once a
      // real ledger row carries the amount — otherwise that placeholder (the
      // whole COA fallback) double-counts and the note total balloons after the
      // move. Check BOTH cy AND py (a note's figures may live only in the PY
      // column). Only strip when a non-fallback row has a non-zero amount, so a
      // note that has ONLY the placeholder keeps it.
      const isFallback = (r: NCECustomRow) =>
        r.id === "custom_auto_total" || r.label === "Auto-filled from COA total";
      const nonZero = (id: string) =>
        Math.abs(cur.cy?.[id] ?? 0) > 0.005 || Math.abs(cur.py?.[id] ?? 0) > 0.005 ||
        Math.abs(cur.cy?.[id + "_lt"] ?? 0) > 0.005 || Math.abs(cur.py?.[id + "_lt"] ?? 0) > 0.005 ||
        Math.abs(cur.cy?.[id + "_st"] ?? 0) > 0.005 || Math.abs(cur.py?.[id + "_st"] ?? 0) > 0.005;
      const hasReal = movedRows.some(r => !isFallback(r) && nonZero(r.id));
      let finalRows = movedRows;
      let finalCy = cur.cy;
      let finalPy = cur.py;
      if (hasReal && movedRows.some(isFallback)) {
        finalRows = movedRows.filter(r => !isFallback(r));
        finalCy = { ...cur.cy };
        finalPy = { ...cur.py };
        // The fallback shares the id "custom_auto_total"; clear its keys once.
        for (const sfx of ["", "_lt", "_st"]) { delete finalCy["custom_auto_total" + sfx]; delete finalPy["custom_auto_total" + sfx]; }
      }

      // ── DUPLICATION SAFETY NET (write-time) ──────────────────────────
      // BHAKTI INFRA root cause: a customRow whose label/ejectedSource
      // matched a ledger already living in cy_sources[targetId] (i.e.
      // auto-mapped to feed cy[targetId]) was attached under that same
      // static. The renderer summed both → "showing all at 2 places".
      //
      // Now: when attaching a customRow under a static, drop matching
      // entries from cy_sources[targetId] and subtract the corresponding
      // amounts from cy[targetId] / py[targetId] (+ _lt/_st columns for
      // Pattern A). That removes the auto channel's contribution so the
      // customRow's own amount represents the ledger exactly once.
      // Pattern A honours `column` so an LT ejection only touches the
      // LT key. This complements the renderer-side overlap guard for
      // belt-and-braces protection. ──────────────────────────────────
      const movedRow = finalRows.find(r => r.id === customId);
      const targetIsStatic = !targetCustomRow; // only static heads carry cy_sources
      let finalCySources = cur.cy_sources;
      if (movedRow && targetIsStatic && cur.cy_sources?.[targetId]?.length) {
        const childLedgers = new Set<string>();
        const lbl = (movedRow.label || "").trim().toLowerCase();
        const ej  = ((movedRow as any).ejectedSource || "").trim().toLowerCase();
        if (lbl) childLedgers.add(lbl);
        if (ej)  childLedgers.add(ej);
        if (childLedgers.size > 0) {
          const before = cur.cy_sources[targetId] as Array<{ ledger: string; amountCy: number; amountPy?: number; column?: "lt" | "st" }>;
          const overlapping = before.filter(s => childLedgers.has((s.ledger || "").trim().toLowerCase()));
          if (overlapping.length > 0) {
            // Subtract overlap from the static's CY/PY (and column-specific keys).
            const newCy = finalCy === cur.cy ? { ...cur.cy } : finalCy;
            const newPy = finalPy === cur.py ? { ...cur.py } : finalPy;
            for (const s of overlapping) {
              const aCy = Number(s.amountCy || 0);
              const aPy = Number(s.amountPy || 0);
              newCy[targetId] = Math.max(0, (newCy[targetId] ?? 0) - aCy);
              newPy[targetId] = Math.max(0, (newPy[targetId] ?? 0) - aPy);
              if (s.column === "lt") {
                newCy[targetId + "_lt"] = Math.max(0, (newCy[targetId + "_lt"] ?? 0) - aCy);
                newPy[targetId + "_lt"] = Math.max(0, (newPy[targetId + "_lt"] ?? 0) - aPy);
              }
              if (s.column === "st") {
                newCy[targetId + "_st"] = Math.max(0, (newCy[targetId + "_st"] ?? 0) - aCy);
                newPy[targetId + "_st"] = Math.max(0, (newPy[targetId + "_st"] ?? 0) - aPy);
              }
            }
            finalCy = newCy;
            finalPy = newPy;
            // Strip overlapping ledgers from cy_sources[targetId].
            const remaining = before.filter(s => !childLedgers.has((s.ledger || "").trim().toLowerCase()));
            const nextSources = { ...(cur.cy_sources ?? {}) };
            if (remaining.length === 0) delete nextSources[targetId];
            else nextSources[targetId] = remaining;
            finalCySources = nextSources;
          }
        }
      }

      const nextNote: NCENoteData = {
        ...cur,
        customRows: finalRows,
        cy: finalCy,
        py: finalPy,
        cy_sources: finalCySources,
      };
      // Guarded auto-save: this is the path a manual/custom row takes when the
      // user picks "Move to…" a heading (e.g. ICICI Car Loan from Loans on
      // demand → Term loans). Persists only when the note total is unchanged.
      return { ...prev, [noteType]: commitMoveGuarded(noteType, cur, nextNote, "Moved to selected heading") };
    });
  }, [commitMoveGuarded]);

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
      // PY amount carried on the source entry — needed for the symmetric
      // PY-side subtract/assign that the original code skipped. Fixes the
      // REVTI INFRA / Rates & Taxes bug where moving "Registration and Stamp
      // Duty Expense" off "rates_taxes" left the static row's PY value
      // (39,96,555) behind — `cur.py[rowId]` was never touched.
      const amountPy = Number(sourceEntry?.amountPy ?? 0);
      const remaining = (newCySources[rowId] ?? []).filter(s => s.ledger !== ledger);
      if (remaining.length === 0) delete newCySources[rowId];
      else newCySources[rowId] = remaining;
      // 2. Subtract amount from static row's CY + PY (plain + Pattern-A suffixed keys).
      const newCy = { ...cur.cy };
      const newPy = { ...cur.py };
      newCy[rowId] = Math.max(0, (cur.cy[rowId] ?? 0) - amount);
      newPy[rowId] = Math.max(0, (cur.py[rowId] ?? 0) - amountPy);
      if (column === "lt") {
        newCy[rowId + "_lt"] = Math.max(0, (cur.cy[rowId + "_lt"] ?? 0) - amount);
        newPy[rowId + "_lt"] = Math.max(0, (cur.py[rowId + "_lt"] ?? 0) - amountPy);
      }
      if (column === "st") {
        newCy[rowId + "_st"] = Math.max(0, (cur.cy[rowId + "_st"] ?? 0) - amount);
        newPy[rowId + "_st"] = Math.max(0, (cur.py[rowId + "_st"] ?? 0) - amountPy);
      }
      // 3. Create new custom row with that ledger name + amount.
      //    Mark as "manual" so it survives Re-sync from COA.
      //    Store ejectedSource so deleting this row can clean up ejectedLedgers.
      const newId = newCustomId();
      const targetSection = attachToId ? resolveSection(config, cur, attachToId) : undefined;
      const newRow: NCECustomRow = {
        // 2026-06-02 — Ejected rows carry a TB-derived amount; lock the
        // value (auditor can re-categorise but not edit the figure).
        id: newId, label: ledger, source: "manual", tbDerived: true, ejectedSource: ledger,
        ...(attachToId ? { attachedTo: attachToId, userMoved: true } : {}),
        ...(targetSection ? { section: targetSection } : {}),
      };
      newCy[newId] = amount;
      newPy[newId] = amountPy;
      // For Pattern A notes, also store with the column suffix so computeDisplayData picks it up
      if (column === "lt") {
        newCy[newId + "_lt"] = amount;
        newPy[newId + "_lt"] = amountPy;
      }
      if (column === "st") {
        newCy[newId + "_st"] = amount;
        newPy[newId + "_st"] = amountPy;
      }
      // 4. Record this ledger in ejectedLedgers so Re-sync skips it from auto-grouping
      const newEjectedLedgers = [...new Set([...(cur.ejectedLedgers ?? []), ledger])];
      const nextNote: NCENoteData = {
        ...cur,
        cy: newCy,
        py: newPy,
        cy_sources: newCySources,
        customRows: [...cur.customRows, newRow],
        ejectedLedgers: newEjectedLedgers,
      };
      return { ...prev, [noteType]: commitMoveGuarded(
        noteType, cur, nextNote,
        attachToId ? `"${ledger}" moved to heading` : `"${ledger}" moved to a separate row`,
      )};
    });
  }, [commitMoveGuarded, resolveSection]);

  // Eject a source ledger from a CUSTOM (auto/merged) row → new standalone custom row.
  // If attachToId is provided the new row is immediately attached to that heading.
  const handleEjectCustomSource = useCallback((noteType: string, customRowId: string, ledger: string, amountCy: number, attachToId?: string) => {
    setNoteData(prev => {
      const cur = prev[noteType] ?? { cy: {}, py: {}, customRows: [] };
      const config = NOTES_CONFIG.find(c => c.noteType === noteType);
      // Find the source entry to get its column (Pattern A: "lt" | "st") and
      // its PY amount — needed for the symmetric PY-side bookkeeping that
      // the original code skipped (CY-only update left PY on both the source
      // merged row and the new standalone row out of sync with the move).
      const sourceEntry = cur.customRows.find(r => r.id === customRowId)?.sources?.find(s => s.ledger === ledger);
      const column = (sourceEntry as any)?.column as string | undefined;
      const amountPy = Number(sourceEntry?.amountPy ?? 0);
      // Remove the ledger from the custom row's sources[]
      const updatedRows = cur.customRows.map(r => {
        if (r.id !== customRowId) return r;
        const newSources = (r.sources ?? []).filter(s => s.ledger !== ledger);
        return { ...r, sources: newSources };
      });
      // Subtract from the merged row's CY + PY amount (plain + Pattern-A suffixed keys)
      const newCy = { ...cur.cy };
      const newPy = { ...cur.py };
      newCy[customRowId] = Math.max(0, (cur.cy[customRowId] ?? 0) - amountCy);
      newPy[customRowId] = Math.max(0, (cur.py[customRowId] ?? 0) - amountPy);
      if (column === "lt") {
        newCy[customRowId + "_lt"] = Math.max(0, (cur.cy[customRowId + "_lt"] ?? 0) - amountCy);
        newPy[customRowId + "_lt"] = Math.max(0, (cur.py[customRowId + "_lt"] ?? 0) - amountPy);
      }
      if (column === "st") {
        newCy[customRowId + "_st"] = Math.max(0, (cur.cy[customRowId + "_st"] ?? 0) - amountCy);
        newPy[customRowId + "_st"] = Math.max(0, (cur.py[customRowId + "_st"] ?? 0) - amountPy);
      }
      // Create new standalone custom row for this ledger.
      // Mark as "manual" so it survives Re-sync from COA.
      // Store ejectedSource so deleting this row can clean up ejectedLedgers.
      const newId = newCustomId();
      const targetSection = attachToId ? resolveSection(config, cur, attachToId) : undefined;
      newCy[newId] = amountCy;
      newPy[newId] = amountPy;
      // For Pattern A notes, also store with the column suffix so computeDisplayData picks it up
      if (column === "lt") {
        newCy[newId + "_lt"] = amountCy;
        newPy[newId + "_lt"] = amountPy;
      }
      if (column === "st") {
        newCy[newId + "_st"] = amountCy;
        newPy[newId + "_st"] = amountPy;
      }
      const newRow: NCECustomRow = {
        // 2026-06-02 — Ejected rows carry a TB-derived amount; lock the
        // value (auditor can re-categorise but not edit the figure).
        id: newId, label: ledger, source: "manual", tbDerived: true, ejectedSource: ledger,
        ...(attachToId ? { attachedTo: attachToId, userMoved: true } : {}),
        ...(targetSection ? { section: targetSection } : {}),
      };
      // Record this ledger in ejectedLedgers so Re-sync skips it from auto-grouping
      const newEjectedLedgers = [...new Set([...(cur.ejectedLedgers ?? []), ledger])];
      const nextNote: NCENoteData = { ...cur, cy: newCy, py: newPy, customRows: [...updatedRows, newRow], ejectedLedgers: newEjectedLedgers };
      return { ...prev, [noteType]: commitMoveGuarded(
        noteType, cur, nextNote,
        attachToId ? `"${ledger}" moved to heading` : `"${ledger}" moved to its own row`,
      )};
    });
  }, [commitMoveGuarded, resolveSection]);

  // ── Re-sync (safe, gated, dry-run preview) ───────────────────────────────
  // Rebuilds notes from the CURRENT Trial Balance + COA mapping — the ONLY path
  // by which a COA change (e.g. moving a ledger Long-Term↔Short-Term) reaches the
  // notes and the FS face. Safety: hard-blocked when notes are finalized; shows a
  // per-note change PREVIEW and writes ONLY on explicit confirmation; manual rows
  // and edits are preserved by nceAutoPopulate. (The old persistNotes was a
  // no-op — this is the explicit, confirmed, finalized-gated write.)
  const handleResync = useCallback(async () => {
    if (notesFinalizedRef.current) { toast.error("Notes are finalized — re-sync is locked."); return; }
    if (!engagementId || !financialYear) return;
    setSyncing(true);
    try {
      const populated = await nceAutoPopulate(engagementId, noteData);
      const diff = computeResyncDiff(noteData, populated);
      const totalRows = diff.reduce((s, d) => s + d.changes.length, 0);
      const lines = diff.slice(0, 20).map(d => {
        const label = NOTE_META[d.noteType]?.shortName
          ?? NOTE_META[`${d.noteType}_lt`]?.shortName
          ?? d.noteType;
        return `• ${label}: ${d.changes.length} row(s) change`;
      });
      const msg = diff.length === 0
        ? "Re-sync from COA mapping?\n\nNo changes detected — notes already match the current Trial Balance + COA mapping.\n\nClick OK to refresh anyway, Cancel to keep current notes."
        : `Re-sync from COA mapping?\n\n${diff.length} note(s), ${totalRows} row(s) will update from the current Trial Balance + COA mapping (this is how an LT↔ST mapping change reaches the statements). Manual rows and edits are preserved.\n\n`
          + lines.join("\n")
          + (diff.length > 20 ? `\n…and ${diff.length - 20} more note(s)` : "")
          + "\n\nClick OK to apply, Cancel to keep current notes.";
      if (!window.confirm(msg)) { setSyncing(false); return; }

      // Persist the rebuilt notes (explicit, confirmed, finalized-gated write).
      const rows = Object.keys(populated).map(noteType => {
        const { cy_data, py_data } = serialiseNoteData(populated[noteType]);
        return { engagement_id: engagementId, financial_year: financialYear, note_type: noteType, cy_data, py_data };
      });
      await supabase
        .from("nce_financial_notes")
        .upsert(rows, { onConflict: "engagement_id,financial_year,note_type" });
      // Clear non-manual FS fallback rows so the Stage-2 fallback can't re-inject
      // stale totals; manual (is_manual=true) overrides are kept. Invalidate
      // ["fs-rows"] so the FS face's manualOverrides state reloads fresh.
      await supabase
        .from("fa_financial_statements")
        .delete()
        .eq("engagement_id", engagementId)
        .eq("is_manual", false);
      setNoteData(populated);
      queryClient.invalidateQueries({ queryKey: ["fs-rows", engagementId] });
      queryClient.invalidateQueries({ queryKey: ["nce-financial-notes", engagementId] });
      toast.success(diff.length === 0 ? "Notes refreshed (already in sync)" : `Re-synced — ${diff.length} note(s) updated`);
    } catch (e: any) {
      toast.error(`Re-sync failed: ${e?.message || e}`);
    } finally {
      setSyncing(false);
    }
  }, [engagementId, financialYear, noteData, queryClient]);

  // ── Explicit save ───────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await persistNotes(noteData, financialYear);
      queryClient.invalidateQueries({ queryKey: ["nce-financial-notes", engagementId] });
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
      {/* Page header — NCE Tasks 1+5: company name only, identical styling to BS/PL headers.
          NO "Notes to Financial Statements for the year ended..." subtitle (removed per
          Changes doc: Note 1 page shows only company name then note title).
          The "(Amount in ₹)" annotation is also omitted here — it appears inside the
          section-heading rows below, following standard audit-report convention. */}
      <div className="text-center border-b bg-muted/30 py-2 px-3">
        {clientName && (
          <div className="font-bold text-sm">{clientName}</div>
        )}
      </div>

      {/* Toolbar — hidden in read-only (lock preview) mode */}
      {/* NOTE: "Re-sync from COA" and "Save All Notes" buttons removed to
          prevent accidental overwrites of audit-verified note data. */}
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            <span className="text-blue-600 font-medium">Blue = Auto</span> ·{" "}
            <span className="text-amber-600 font-medium">Amber = Manual</span>
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
          </div>
        </div>
      )}

      {/* All notes — always open; pointer-events disabled in read-only (lock preview) mode */}
      <div className={`space-y-4${readOnly ? " pointer-events-none select-none opacity-90" : ""}`}>
        {/* NCE Tasks 2+3+5+9: in readOnly (preview) mode use an imperative loop so we
            can (a) skip inactive notes (no dynamic number) and (b) insert section
            transition headers ("Notes to Balance Sheet" / "Notes to P&L") at the
            exact point where the BS→PL boundary occurs.
            In edit mode the original map() behaviour is preserved. */}
        {(() => {
          const visibleConfigs = NOTES_CONFIG.filter(nc => !(nc as any).hidden);
          const elements: React.ReactNode[] = [];
          let currentSection: string | null = null;

          for (const nc of visibleConfigs) {
            // For split notes (sourceNoteType set), read from the source note's data
            // and extract only the relevant LT or ST side via extractSplitData().
            const sourceKey  = nc.sourceNoteType ?? nc.noteType;
            const rawData    = noteData[sourceKey] ?? { cy: {}, py: {}, customRows: [] };
            const splitSide  = nc.splitSide;
            const extracted  = splitSide ? extractSplitData(rawData, splitSide) : null;
            // 2026-06-04 — SHREE HARI (5th report): customRows are read directly
            // from rawData.customRows here, NOT from extracted._custom_rows.
            // Without filtering, every borrowings customRow (Bajaj Housing Finance,
            // SBI Car Loan, all the HUF loans) rendered on BOTH the Long-Term and
            // Short-Term split notes — empty in ST because all the amounts live on
            // the _lt keys. Filter to ONLY rows that have non-zero amount on THIS
            // side (cy or py). Rows whose data sits on the OTHER side are dropped
            // from this view; rows with no suffixed amount at all (manual
            // placeholders) stay visible so the auditor can still see them.
            const splitCustomRows: typeof rawData.customRows = (() => {
              if (!splitSide) return rawData.customRows;
              const suffix      = `_${splitSide}`;
              const otherSuffix = splitSide === "lt" ? "_st" : "_lt";
              return rawData.customRows.filter(cr => {
                const thisCy  = Math.abs(Number(rawData.cy[cr.id + suffix]      ?? 0));
                const thisPy  = Math.abs(Number(rawData.py[cr.id + suffix]      ?? 0));
                const otherCy = Math.abs(Number(rawData.cy[cr.id + otherSuffix] ?? 0));
                const otherPy = Math.abs(Number(rawData.py[cr.id + otherSuffix] ?? 0));
                // Has data on THIS side → keep.
                if (thisCy > 0.005 || thisPy > 0.005) return true;
                // Has data only on the OTHER side → drop from this view.
                if (otherCy > 0.005 || otherPy > 0.005) return false;
                // No suffixed amounts at all (legacy bare key / placeholder) → keep
                // so the user can still see and edit the row in one of the views.
                return true;
              });
            })();
            const d: typeof rawData = extracted
              ? { ...rawData, cy: extracted.cy, py: extracted.py, customRows: splitCustomRows }
              : rawData;

            // 2026-06-13 — value-aware badge counts. Previously the "N manual"
            // / "N auto" badge counted rows by EXISTENCE, so an empty note full
            // of zero-valued placeholder rows (e.g. "Purchases (category 1/2/3)")
            // still showed "12 manual". Count only rows that actually carry data
            // — a non-zero CY or PY amount (any suffix), a non-zero source[]
            // contribution, or attached children that do. Empty placeholders no
            // longer inflate the badge.
            const rowHasData = (cr: typeof d.customRows[number]): boolean => {
              const own =
                Math.abs(Number(d.cy[cr.id] ?? 0)) + Math.abs(Number(d.cy[cr.id + "_lt"] ?? 0)) + Math.abs(Number(d.cy[cr.id + "_st"] ?? 0)) +
                Math.abs(Number(d.py[cr.id] ?? 0)) + Math.abs(Number(d.py[cr.id + "_lt"] ?? 0)) + Math.abs(Number(d.py[cr.id + "_st"] ?? 0));
              if (own > 0.005) return true;
              const srcs = (cr as any).sources;
              if (Array.isArray(srcs) && srcs.some((s: any) =>
                Math.abs(Number(s?.amountCy ?? 0)) > 0.005 || Math.abs(Number(s?.amountPy ?? 0)) > 0.005)) return true;
              if (d.customRows.some(c => c.attachedTo === cr.id)) return true;
              return false;
            };
            const autoCount  = d.customRows.filter(r => r.source === "auto"   && rowHasData(r)).length;
            const manuCount  = d.customRows.filter(r => r.source === "manual" && rowHasData(r)).length;

            // Dynamic note number: use the map when available (cross-tab sync),
            // else fall back to parsing from the title string (standalone Stage 8).
            const noteNum = dynamicNoteMap
              ? (getDynamicNoteDisplay(nc.noteType, dynamicNoteMap) ?? "")
              : (nc.title.match(/Note\s+([\d\s&]+):/i)?.[1]?.trim() ?? "");
            const noteTitle = nc.title.replace(/^Note\s+[\d\s&]+:\s*/i, "");

            // NCE Tasks 3 & 5: in readOnly preview, skip notes that have no dynamic
            // number — they are not referenced in any FS line item and must not appear
            // in the preview (prevents sequence gaps and phantom note cards).
            if (readOnly && !noteNum) continue;

            // Task 6: in the preview/readOnly view, emit the section heading
            // once per section boundary — "Notes to Balance Sheet as on…" at
            // the start of the BS block, then "Notes to Profit & Loss A/c as
            // on…" when the section switches to PL.  Not before every note
            // (which would be wrong) and not only at the BS→PL transition
            // (which would miss the initial BS heading).
            // currentSection is initialised to null so the first note always
            // triggers the heading regardless of which section it belongs to.
            if (readOnly) {
              const meta    = NOTE_META[nc.noteType];
              const section = meta?.section ?? "BS";
              if (section !== currentSection) {
                currentSection = section;
                const dateStr = `31.03.${cyYear}`;
                // Issue 2 — P&L is a period statement, so its heading reads "for
                // the accounting year YYYY-YYYY" (mirrors the Word export); the
                // Balance Sheet stays point-in-time "as on 31.03.YYYY".
                const heading = section === "PL"
                  ? `Notes to Profit & Loss A/c for the accounting year ${Number(cyYear) - 1}-${cyYear}`
                  : `Notes to Balance Sheet as on ${dateStr}`;
                elements.push(
                  <div
                    key={`section-hdr-${section}`}
                    className="pt-2 pb-1 border-b-2 border-foreground/30"
                  >
                    <span className="text-sm font-bold underline">{heading}</span>
                  </div>
                );
              }
            }

            // For split notes: when the user edits a bare key (e.g. "secured_other"),
            // write it back to the source note with the side suffix (e.g. "secured_lt_other").
            const mkChangeCy = splitSide
              ? (key: string, v: number) => handleChange(sourceKey, `${key}_${splitSide}`, true,  v)
              : (key: string, v: number) => handleChange(sourceKey, key,                   true,  v);
            const mkChangePy = splitSide
              ? (key: string, v: number) => handleChange(sourceKey, `${key}_${splitSide}`, false, v)
              : (key: string, v: number) => handleChange(sourceKey, key,                   false, v);

            elements.push(
              <NoteCard
                key={nc.noteType}
                noteNumber={noteNum}
                title={noteTitle}
                autoCount={autoCount}
                manualCount={manuCount}
                collapseControl={readOnly ? undefined : collapseAll}
                anchorId={noteNum ? `nce-note-${noteNum}` : `nce-note-type-${nc.noteType}`}
                forceOpen={readOnly}
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
                      onChangeCy={mkChangeCy}
                      onChangePy={mkChangePy}
                      onAddRow={(opts) => handleAddRow(sourceKey, opts)}
                      onDeleteRow={id => handleDeleteRow(sourceKey, id)}
                      onChangeLabel={(id, lbl) => handleChangeLabel(sourceKey, id, lbl)}
                      onHideStatic={id => handleHideStatic(sourceKey, id)}
                      onChangeStaticLabel={(id, lbl) => handleChangeStaticLabel(sourceKey, id, lbl)}
                      onPromote={(cid, sid) => handlePromoteCustomToStatic(sourceKey, cid, sid)}
                      onSwapLtSt={(rid) => handleSwapLtSt(sourceKey, rid)}
                      onEjectSource={(rid, ledger, amt, attachToId?) => handleEjectSource(sourceKey, rid, ledger, amt, attachToId)}
                      onEjectCustomSource={(cid, ledger, amt, attachToId?) => handleEjectCustomSource(sourceKey, cid, ledger, amt, attachToId)}
                      onChangeSourceLabel={(rid, ledger, lbl) => handleChangeSourceLabel(sourceKey, rid, ledger, lbl)}
                      hideEmptySections={readOnly}
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
                      onChangeCy={mkChangeCy}
                      onChangePy={mkChangePy}
                      onAddRow={(opts) => handleAddRow(sourceKey, opts)}
                      onDeleteRow={id => handleDeleteRow(sourceKey, id)}
                      onChangeLabel={(id, lbl) => handleChangeLabel(sourceKey, id, lbl)}
                      onHideStatic={id => handleHideStatic(sourceKey, id)}
                      onChangeStaticLabel={(id, lbl) => handleChangeStaticLabel(sourceKey, id, lbl)}
                      onPromote={(cid, sid) => handlePromoteCustomToStatic(sourceKey, cid, sid)}
                      onEjectSource={(rid, ledger, amt, attachToId?) => handleEjectSource(sourceKey, rid, ledger, amt, attachToId)}
                      onEjectCustomSource={(cid, ledger, amt, attachToId?) => handleEjectCustomSource(sourceKey, cid, ledger, amt, attachToId)}
                      onChangeSourceLabel={(rid, ledger, lbl) => handleChangeSourceLabel(sourceKey, rid, ledger, lbl)}
                      noteType={nc.noteType}
                      onExpansionChange={handleExpansionChange}
                      hideEmptySections={readOnly}
                      initialExpandedRows={seedExpanded}
                    />
                  )}
                </div>
              </NoteCard>
            );
          }
          return elements;
        })()}
      </div>

      {/* Bottom save button removed to prevent accidental overwrites of
          audit-verified note data. */}
    </div>
  );
}
