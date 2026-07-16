/**
 * EditableCell + Notes primitives — shared building blocks for the Stage 5
 * Notes tab (UI-6). Re-used by NoteBSLiab, NoteBSAsset, NotePL, FAGrid.
 *
 * Although the file name says "EditableCell", it also exports the lightweight
 * layout primitives (NoteCard, SubSection, EditableRow, ListTable,
 * AgeingTable) so every note file imports from one place.
 *
 * Bug 9 — Restore Link is OBSOLETE.  Bug 10 removed the lock + override form
 * (Phase C reversal) so auto-linked rows are now read-only.  With no
 * overrides possible, there is nothing to restore.  The menu item was
 * removed in Bug 10; the onRestoreLink prop survives only for backwards
 * compatibility with old call sites.  To change an auto-linked amount the
 * auditor must edit the COA mapping in Stage 6.
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, Plus, Trash2, ChevronDown, ChevronRight, MoreVertical, Info, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import { useFsUnits, formatINRWhole } from "@/lib/fsUnits";

// Indian numbering — whole numbers only (no paise) per audit-presentation
// requirement.  The number itself is also scaled (Actual / '000 / Lakhs /
// Crores) according to the active FS units context.
//
// Standalone (non-React) callers can keep using `formatINR()` as before; it
// gracefully falls back to "Actual" units when no provider is mounted.
export function formatINR(n: number | null | undefined): string {
  return formatINRWhole(n);
}

/** React hook variant — applies the active FS units scaling + rounding. */
export function useFormatINR(): (n: number | null | undefined) => string {
  const { format } = useFsUnits();
  return format;
}

/** All mappable FS line-item codes with human-readable labels, grouped by section. */
export const FS_CODE_OPTIONS: { code: string; label: string; section: string }[] = [
  { code: "BS_EQ_SC",   label: "Share Capital",                section: "BS — Equity" },
  { code: "BS_EQ_RS",   label: "Reserves and Surplus",         section: "BS — Equity" },
  { code: "BS_NCL_LTB", label: "Long-term Borrowings",         section: "BS — Non-Current Liabilities" },
  { code: "BS_NCL_DTL", label: "Deferred Tax Liabilities",     section: "BS — Non-Current Liabilities" },
  { code: "BS_NCL_OLT", label: "Other Long-term Liabilities",  section: "BS — Non-Current Liabilities" },
  { code: "BS_NCL_LTP", label: "Long-term Provisions",         section: "BS — Non-Current Liabilities" },
  { code: "BS_CL_STB",  label: "Short-term Borrowings",        section: "BS — Current Liabilities" },
  { code: "BS_CL_TP",   label: "Trade Payables",               section: "BS — Current Liabilities" },
  { code: "BS_CL_OCL",  label: "Other Current Liabilities",    section: "BS — Current Liabilities" },
  { code: "BS_CL_STP",  label: "Short-term Provisions",        section: "BS — Current Liabilities" },
  { code: "BS_NCA_FA",  label: "PP&E / Fixed Assets",          section: "BS — Non-Current Assets" },
  { code: "BS_NCA_INV", label: "Non-current Investments",      section: "BS — Non-Current Assets" },
  { code: "BS_NCA_DTA", label: "Deferred Tax Assets",          section: "BS — Non-Current Assets" },
  { code: "BS_NCA_LLA", label: "Long-term Loans & Advances",   section: "BS — Non-Current Assets" },
  { code: "BS_NCA_ONA", label: "Other Non-current Assets",     section: "BS — Non-Current Assets" },
  { code: "BS_CA_CI",   label: "Current Investments",          section: "BS — Current Assets" },
  { code: "BS_CA_INV",  label: "Inventories",                  section: "BS — Current Assets" },
  { code: "BS_CA_TR",   label: "Trade Receivables",            section: "BS — Current Assets" },
  { code: "BS_CA_CCE",  label: "Cash & Bank Equivalents",      section: "BS — Current Assets" },
  { code: "BS_CA_SLA",  label: "Short-term Loans & Advances",  section: "BS — Current Assets" },
  { code: "BS_CA_OCA",  label: "Other Current Assets",         section: "BS — Current Assets" },
  { code: "PL_REV_OPS", label: "Revenue from Operations",      section: "P&L — Income" },
  { code: "PL_REV_OI",  label: "Other Income",                 section: "P&L — Income" },
  { code: "PL_EXP_MAT", label: "Cost of Materials Consumed",   section: "P&L — Expenses" },
  { code: "PL_EXP_SIT", label: "Purchases of Stock-in-Trade",  section: "P&L — Expenses" },
  { code: "PL_EXP_CII", label: "Changes in Inventories",       section: "P&L — Expenses" },
  { code: "PL_EXP_EMP", label: "Employee Benefits Expense",    section: "P&L — Expenses" },
  { code: "PL_EXP_FIN", label: "Finance Costs",                section: "P&L — Expenses" },
  { code: "PL_EXP_DEP", label: "Depreciation & Amortisation",  section: "P&L — Expenses" },
  { code: "PL_EXP_OTH", label: "Other Expenses",               section: "P&L — Expenses" },
  { code: "PL_TAX_CUR", label: "Current Tax",                  section: "P&L — Tax" },
  { code: "PL_TAX_DEF", label: "Deferred Tax",                 section: "P&L — Tax" },
];

// ─────────────────────────────────────────────────────────────────────────
// EditableCell — text or number input with auto/manual tinting
// ─────────────────────────────────────────────────────────────────────────

interface EditableCellProps {
  value:           number | string | null | undefined;
  autoValue?:      number | string | null;
  onCommit:        (next: number | string | null) => void;
  onResetToAuto?:  () => void;
  isOverridden?:   boolean;
  isAutoFilled?:   boolean;
  /** Bug 10 — When true and !isOverridden, renders a fully read-only blue-tinted
   *  display.  No icon, no override form.  To change a linked amount, the auditor
   *  must edit the COA mapping in Stage 6. */
  isLocked?:       boolean;
  /** @deprecated Bug 10 removed override capability. Prop kept for backwards
   *  compatibility only — never invoked. */
  onOverride?:     (amount: number, reason: string) => void;
  type?:           "number" | "text";
  placeholder?:    string;
  className?:      string;
  disabled?:       boolean;
}

export function EditableCell({
  value, autoValue, onCommit, onResetToAuto,
  isOverridden, isAutoFilled, isLocked, onOverride: _onOverride /* Bug 10: deprecated; kept for backwards compat */,
  type = "number", placeholder, className, disabled,
}: EditableCellProps) {
  const [focused, setFocused] = useState(false);
  const [draft,   setDraft]   = useState<string>("");
  const fsUnits = useFsUnits();
  // Bug 10: override form state and handler removed.  Auto-linked rows
  // are read-only; auditor must edit COA mapping (Stage 6) to change them.

  // ── Bug 10 + 2026-06-25 (V J Desai) — Locked path is READ-ONLY, always ─
  // Auto-linked rows show in blue; MANUAL rows in a note with lockAmounts
  // set now ALSO stay read-only, tinted amber to keep the "override" hint
  // visible. Previously the `!isOverridden` guard let manual rows fall
  // through to the editable input path (so renaming a linked ledger — which
  // flipped source to "manual" — accidentally unlocked the amount cell).
  // The only way to change an amount now is via COA Mapping, never the
  // Notes editor.
  if (isLocked && !disabled) {
    return (
      <div
        className={cn(
          "flex items-center justify-end gap-1 rounded px-1 border",
          isOverridden
            ? "border-amber-300 bg-amber-50/40"
            : "border-blue-200 bg-blue-50/30",
          className,
        )}
        title={
          isOverridden
            ? "Manual value — locked from editing here. Change via COA Mapping (Stage 6)."
            : "Auto-linked from Tally TB. Edit COA mapping in Stage 6 to change."
        }
      >
        <span
          className={cn(
            "flex-1 text-right tabular-nums text-[11px] select-none",
            isOverridden
              ? "text-amber-900 dark:text-amber-200"
              : "text-blue-900 dark:text-blue-200",
          )}
        >
          {fsUnits.format(Number(value ?? 0))}
        </span>
      </div>
    );
  }

  const display = focused
    ? draft
    : (type === "number" ? fsUnits.format(Number(value || 0)) : (value ?? ""));

  if (disabled) {
    return <span className={cn("tabular-nums", className)}>{String(display)}</span>;
  }

  const tintCls = isOverridden
    ? "border-amber-300 bg-amber-50/40 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
    : isAutoFilled
      ? "border-blue-300/60 bg-blue-50/30 text-blue-900 dark:bg-blue-900/15 dark:text-blue-200"
      : "border-dashed border-muted-foreground/30 bg-background/40";

  const inputEl = (
    <input
      type={type === "number" ? "text" : "text"}
      inputMode={type === "number" ? "decimal" : "text"}
      value={String(display ?? "")}
      placeholder={placeholder}
      title={
        isOverridden  ? "(manual) — overridden value · click × to reset to (auto)"
        : isAutoFilled ? "(auto) — auto-filled from COA mapping"
        : ""
      }
      onFocus={(e) => {
        setFocused(true);
        const v = value;
        const raw = type === "number"
          ? (v === 0 || v === null || v === undefined
              ? ""
              : String(fsUnits.scaleAmount(Number(v))))
          : String(v ?? "");
        setDraft(raw);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onBlur={() => {
        setFocused(false);
        const t = draft.trim();
        if (t === "") { onCommit(null); return; }
        if (type === "number") {
          const parsed = Number(t.replace(/,/g, ""));
          if (Number.isFinite(parsed)) {
            const actual = parsed * fsUnits.meta.divisor;
            onCommit(actual);
          }
        } else {
          onCommit(t);
        }
      }}
      className={cn(
        "w-full rounded px-1 outline-none border cursor-text",
        type === "number" ? "text-right tabular-nums" : "text-left",
        tintCls,
        "hover:bg-background hover:border-muted-foreground/60 focus:border-primary focus:bg-background focus:border-solid",
        className,
      )}
    />
  );

  if (isOverridden && onResetToAuto) {
    return (
      <div className="flex items-center gap-1">
        {inputEl}
        <button
          type="button"
          onClick={onResetToAuto}
          className="p-0.5 rounded hover:bg-amber-100 text-amber-700"
          title={`Reset to auto value: ${type === "number" ? fsUnits.format(Number(autoValue || 0)) : (autoValue ?? "—")}`}
        >
          <X size={11} />
        </button>
      </div>
    );
  }
  return inputEl;
}

// ─────────────────────────────────────────────────────────────────────────
// Layout primitives
// ─────────────────────────────────────────────────────────────────────────

export function NoteCard({
  noteNo, title, children, defaultCollapsed = false, collapseControl,
  hideWhenEmpty = false, cyTotal, pyTotal, readOnly = false, engagementId,
}: {
  noteNo: number | string | null;
  title: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
  collapseControl?: boolean;
  /** Corporate Lock Preview parity with NCE: when true and both totals are
   *  blank/zero, the entire NoteCard is skipped so the preview/locked view
   *  drops empty notes (Long-term borrowings, Other long-term liabilities
   *  etc.) instead of cluttering the layout. */
  hideWhenEmpty?: boolean;
  cyTotal?: number;
  pyTotal?: number;
  /** Locked-preview mode — disables the header click handler, hides the
   *  expand/collapse chevron and label. In readOnly the persisted collapse
   *  state (from localStorage) decides whether to render content. The
   *  preview should read like the final DOCX, not an editable card. */
  readOnly?: boolean;
  /** Corporate Lock Preview parity with NCE: persist this NoteCard's
   *  collapsed state to localStorage so the preview popup reflects whatever
   *  the auditor had collapsed in the editor. Uses noteNo (or title as
   *  fallback) as the per-engagement key. */
  engagementId?: string;
}) {
  // Build a stable storage key per (engagement, note). Falls back to title
  // when noteNo isn't assigned yet (e.g. before dynamic registry resolution).
  const noteKey = noteNo != null ? String(noteNo) : title;
  const storageKey = engagementId ? `fs_corp_collapsed_notes_${engagementId}` : null;
  const loadCollapsed = (): boolean => {
    if (!storageKey || typeof window === "undefined") return defaultCollapsed;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) return parsed.includes(noteKey);
    } catch { /* storage unavailable — ignore */ }
    return defaultCollapsed;
  };
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed);

  // Re-hydrate when the storageKey changes (engagement switch) or when the
  // note's identity changes (note number registry resolved late).
  useEffect(() => {
    setCollapsed(loadCollapsed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, noteKey]);

  useEffect(() => {
    if (collapseControl !== undefined) setCollapsed(collapseControl);
  }, [collapseControl]);

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      // Persist so the preview popup sees the same collapsed/expanded
      // decision the auditor made in the editor.
      if (storageKey && typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem(storageKey);
          const list: string[] = Array.isArray(JSON.parse(raw ?? "[]")) ? JSON.parse(raw ?? "[]") : [];
          const set = new Set<string>(list);
          if (next) set.add(noteKey); else set.delete(noteKey);
          localStorage.setItem(storageKey, JSON.stringify([...set]));
        } catch { /* storage unavailable — ignore */ }
      }
      return next;
    });
  };

  // Empty-note suppression — only when caller opts in and both totals collapse
  // to near-zero. Using <1 (rupees) instead of ===0 so floating-point drift
  // doesn't keep a "Rs. 0.000001" note visible.
  if (
    hideWhenEmpty
    && Math.abs(Number(cyTotal ?? 0)) < 1
    && Math.abs(Number(pyTotal ?? 0)) < 1
  ) {
    return null;
  }

  // readOnly preview: no interactivity, no chevron, no expand/collapse label.
  // But still honor the persisted collapsed state — if the auditor collapsed
  // the note in the editor, the preview shows it collapsed (matches export).
  if (readOnly) {
    return (
      <section
        id={noteNo != null ? `note-${noteNo}` : undefined}
        className="rounded-lg border bg-card mb-4"
      >
        <header className="border-b bg-muted/30 px-3 py-1.5 flex items-center gap-1.5 select-none">
          <h3 className="text-xs font-semibold flex-1">
            {noteNo != null ? `Note ${noteNo} — ` : ""}{title}
          </h3>
        </header>
        {!collapsed && (
          <div className="px-3 py-2 text-[11px] space-y-2">{children}</div>
        )}
      </section>
    );
  }

  return (
    <section
      id={noteNo != null ? `note-${noteNo}` : undefined}
      className="rounded-lg border bg-card mb-4"
    >
      <header
        className="border-b bg-muted/30 px-3 py-1.5 flex items-center gap-1.5 cursor-pointer select-none hover:bg-muted/50 transition-colors"
        onClick={toggleCollapsed}
      >
        {collapsed
          ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronDown  className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        }
        <h3 className="text-xs font-semibold flex-1">
          {noteNo != null ? `Note ${noteNo} — ` : ""}{title}
        </h3>
        <span className="text-[9px] text-muted-foreground">{collapsed ? "expand" : "collapse"}</span>
      </header>
      {!collapsed && (
        <div className="px-3 py-2 text-[11px] space-y-2">{children}</div>
      )}
    </section>
  );
}

export function SubSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      {title && <div className="font-semibold text-[11px] text-muted-foreground mt-1">{title}</div>}
      {children}
    </div>
  );
}

// PD-4 (note side, per the product-owner ruling): the "Total — … (per BS/P&L)"
// grand-total rows are COA-derived and must NOT be hand-edited (Rule 8). They are
// detected by the firm's naming convention (label ends in "(per BS)"/"(per P&L)").
// Statutory DISCLOSURE rows (ageing, MSME/Others split, share-capital reconciliation,
// deferred-tax components, etc.) do NOT match and stay editable. Figure-neutral: the
// BS/P&L face reads the breakup sum, not these headline totals (see sumNotesSubRowsCY),
// so locking them only removes an inert override affordance. An explicit isLocked prop
// always takes precedence. Set false to restore fully-editable totals.
const FS_NOTE_TOTAL_READONLY = true;
const isNoteTotalLabel = (label: string): boolean => /\(per (BS|P&L)\)\s*$/.test(label);

export function EditableRow({
  label, indent = 0,
  cy, py, autoCY, autoPY,
  isOverriddenCy, isOverriddenPy,
  onCommitCy, onCommitPy, onResetCy, onResetPy,
  bold,
  actionGutter = true,
  isLocked,
}: {
  label:           string;
  indent?:         number;
  cy:              number | null | undefined;
  py:              number | null | undefined;
  autoCY?:         number | null;
  autoPY?:         number | null;
  isOverriddenCy?: boolean;
  isOverriddenPy?: boolean;
  onCommitCy:      (v: number | null) => void;
  onCommitPy:      (v: number | null) => void;
  onResetCy?:      () => void;
  onResetPy?:      () => void;
  bold?:           boolean;
  actionGutter?:   boolean;
  isLocked?:       boolean;
}) {
  const cyCol = "col-span-3";
  const pyCol = actionGutter ? "col-span-2" : "col-span-3";
  const locked = isLocked ?? (FS_NOTE_TOTAL_READONLY && isNoteTotalLabel(label));
  return (
    <div className={cn("grid grid-cols-12 gap-2 items-center py-0.5", bold && "font-semibold")}>
      <div className="col-span-6" style={{ paddingLeft: indent * 12 }}>{label}</div>
      <div className={cyCol}>
        <EditableCell
          value={cy ?? 0}
          autoValue={autoCY ?? null}
          isAutoFilled={autoCY !== undefined && autoCY !== null}
          isOverridden={!!isOverriddenCy}
          isLocked={locked}
          onCommit={(v) => onCommitCy(v == null ? null : Number(v))}
          onResetToAuto={onResetCy}
        />
      </div>
      <div className={pyCol}>
        <EditableCell
          value={py ?? 0}
          autoValue={autoPY ?? null}
          isAutoFilled={autoPY !== undefined && autoPY !== null}
          isOverridden={!!isOverriddenPy}
          isLocked={locked}
          onCommit={(v) => onCommitPy(v == null ? null : Number(v))}
          onResetToAuto={onResetPy}
        />
      </div>
      {actionGutter && <div className="col-span-1" />}
    </div>
  );
}

export function NoteHeaderRow({
  cyLabel, pyLabel, actionGutter = true,
}: { cyLabel: string; pyLabel: string; actionGutter?: boolean }) {
  const cyCol = "col-span-3";
  const pyCol = actionGutter ? "col-span-2" : "col-span-3";
  return (
    <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-muted-foreground border-b pb-1 mb-1">
      <div className="col-span-6">Particulars</div>
      <div className={cn(cyCol, "text-right")}>{cyLabel}</div>
      <div className={cn(pyCol, "text-right")}>{pyLabel}</div>
      {actionGutter && <div className="col-span-1" />}
    </div>
  );
}

// ─── Row actions menu for ListTable rows (⋮) ─────────────────────────────────
function ListRowActionsMenu({
  onDelete,
  onRemoveFromGroup,
  linkedLedger,
  onUnmap,
  onSplitSources,
  subGroups,
  onMoveToGroup,
  onCreateGroup,
  onRestoreLink,
  deleteDisabledReason,
  splitToShortTermEnabled,
  currentStSplitCy,
  currentStSplitPy,
  onCommitStSplit,
}: {
  onDelete: () => void;
  onRemoveFromGroup?: () => void;
  linkedLedger?: string;
  /** Issue 2 — Unmap a TB-linked row.  Clears the linked_ledger so the row
   *  becomes a free-standing manual entry; auditor re-maps via Stage 6 COA. */
  onUnmap?: () => void;
  /** Issue 3 — Split a consolidated row (sources.length > 1) into one
   *  breakup row per underlying source ledger. */
  onSplitSources?: () => void;
  subGroups?: { id: string; name: string }[];
  onMoveToGroup?: (groupId: string) => void;
  onCreateGroup?: (groupName: string) => void;
  /** When set, the row is MANUAL but was previously LINKED — shows "Restore Link" option. */
  onRestoreLink?: () => void;
  /** 2026-06-23 (MICROCIRCUITS — non-zero-balance delete guard): when set,
   *  the Delete row button is rendered disabled with this string as the
   *  validation message. Used to block deletion of any breakup row whose
   *  CY or PY amount is non-zero (Auto OR Manual) — deleting amount-bearing
   *  rows leaves the BS/PL face out of sync with the COA mapping. */
  deleteDisabledReason?: string;
  /** 2026-06-25 (V J Desai — LT/ST split): only enabled on Long-term
   *  borrowings and Long-term loans & advances rows. Shows an inline
   *  "Split to Short-term" popover with CY and PY inputs. */
  splitToShortTermEnabled?: boolean;
  currentStSplitCy?: number;
  currentStSplitPy?: number;
  onCommitStSplit?: (cy: number | null, py: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [showSplitInput, setShowSplitInput] = useState(false);
  const [stSplitCyDraft, setStSplitCyDraft] = useState<string>(
    currentStSplitCy != null && currentStSplitCy !== 0 ? String(currentStSplitCy) : "",
  );
  const [stSplitPyDraft, setStSplitPyDraft] = useState<string>(
    currentStSplitPy != null && currentStSplitPy !== 0 ? String(currentStSplitPy) : "",
  );
  // Issue 2 — Change-Mapping popover removed.  Re-mapping now happens
  // exclusively at Stage 6 COA Mapping; here we offer Unmap instead.

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setGroupMenuOpen(false); setShowNewGroupInput(false); setNewGroupName(""); } }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Row actions"
          className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <MoreVertical size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-48 p-1">
        {/* Bug 10: Restore Link removed — auto-linked rows are now read-only,
            so there's nothing to restore.  The onRestoreLink prop is kept on
            the interface for backwards compatibility but the menu item is
            no longer rendered. */}
        {/* Issue 2 — Unmap (replaces Change Mapping for linked rows).
            Severs the row's link to the TB ledger so it becomes a manual
            free-standing row.  Re-mapping happens in Stage 6 COA Mapping. */}
        {linkedLedger && onUnmap && (
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded text-xs hover:bg-amber-50 text-amber-700 flex items-center gap-1.5 transition-colors"
            onClick={() => { onUnmap(); setOpen(false); }}
            title={`Unlink "${linkedLedger}" — re-map in Stage 6 COA Mapping`}
          >
            <X size={11} className="shrink-0" /> Unmap
          </button>
        )}
        {/* Issue 3 — Split into individual rows (sources.length > 1).
            Breaks a consolidated row that consolidates several TB ledgers
            into one row per source ledger, so each can be moved to its own
            sub-group or unmapped independently. */}
        {onSplitSources && (
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded text-xs hover:bg-blue-50 text-blue-700 flex items-center gap-1.5 transition-colors"
            onClick={() => { onSplitSources(); setOpen(false); }}
            title="Split this consolidated row into one row per underlying ledger"
          >
            <ChevronDown size={11} className="shrink-0 -rotate-90" /> Split into individual rows
          </button>
        )}

        {/* 2026-06-25 (V J Desai — LT/ST split): only on Long-term notes.
            Auditor enters the CY / PY portion that should reclassify to the
            Short-term counterpart. The LT total subtracts this; the ST note
            adds a "Current maturities" row for the same amount. */}
        {splitToShortTermEnabled && onCommitStSplit && (
          <>
            {!showSplitInput ? (
              <button
                type="button"
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-indigo-50 text-indigo-700 flex items-center gap-1.5 transition-colors"
                onClick={() => setShowSplitInput(true)}
                title="Reclassify part of this ledger to the Short-term note"
              >
                <ChevronDown size={11} className="shrink-0 -rotate-90" />
                Split to Short-term
                {(currentStSplitCy || currentStSplitPy) ? (
                  <span className="ml-auto text-[10px] rounded bg-indigo-100 text-indigo-700 px-1">
                    active
                  </span>
                ) : null}
              </button>
            ) : (
              <div className="px-1 py-1 space-y-1.5 bg-indigo-50/50 dark:bg-indigo-950/20 rounded">
                <div className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                  Short-term portion
                </div>
                <div className="flex gap-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="CY"
                    value={stSplitCyDraft}
                    onChange={e => setStSplitCyDraft(e.target.value)}
                    className="w-1/2 text-xs border rounded px-1.5 py-1 bg-background outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="PY"
                    value={stSplitPyDraft}
                    onChange={e => setStSplitPyDraft(e.target.value)}
                    className="w-1/2 text-xs border rounded px-1.5 py-1 bg-background outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="flex-1 text-[11px] px-2 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                    onClick={() => {
                      const cy = stSplitCyDraft.trim() === ""
                        ? null
                        : Number(stSplitCyDraft.replace(/,/g, ""));
                      const py = stSplitPyDraft.trim() === ""
                        ? null
                        : Number(stSplitPyDraft.replace(/,/g, ""));
                      onCommitStSplit(
                        Number.isFinite(cy as number) ? (cy as number) : null,
                        Number.isFinite(py as number) ? (py as number) : null,
                      );
                      setShowSplitInput(false);
                      setOpen(false);
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="text-[11px] px-2 py-0.5 rounded hover:bg-muted"
                    onClick={() => {
                      setShowSplitInput(false);
                      setStSplitCyDraft(currentStSplitCy != null && currentStSplitCy !== 0 ? String(currentStSplitCy) : "");
                      setStSplitPyDraft(currentStSplitPy != null && currentStSplitPy !== 0 ? String(currentStSplitPy) : "");
                    }}
                  >
                    Cancel
                  </button>
                  {(currentStSplitCy || currentStSplitPy) ? (
                    <button
                      type="button"
                      className="text-[11px] px-2 py-0.5 rounded hover:bg-red-50 text-red-600"
                      onClick={() => {
                        onCommitStSplit(null, null);
                        setStSplitCyDraft("");
                        setStSplitPyDraft("");
                        setShowSplitInput(false);
                        setOpen(false);
                      }}
                      title="Clear the split — full amount stays on this Long-term note"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </>
        )}

        {/* Move to Sub Group — only shown when handlers are provided (not for group headers) */}
        {(onMoveToGroup || onCreateGroup) && (
          <Popover open={groupMenuOpen} onOpenChange={(o) => { setGroupMenuOpen(o); if (!o) { setShowNewGroupInput(false); setNewGroupName(""); } }}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted flex items-center gap-1.5 transition-colors"
              >
                <ChevronDown size={11} className="shrink-0" /> Move to Sub Group
              </button>
            </PopoverTrigger>
            <PopoverContent side="left" align="start" className="w-48 p-1">
              {/* Existing groups */}
              {subGroups && subGroups.length > 0 && (
                <>
                  {subGroups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-purple-50 text-purple-700 flex items-center gap-1.5 transition-colors"
                      onClick={() => { onMoveToGroup?.(g.id); setGroupMenuOpen(false); setOpen(false); }}
                    >
                      <span className="truncate">{g.name || "(unnamed group)"}</span>
                    </button>
                  ))}
                  <div className="border-t my-0.5" />
                </>
              )}
              {/* Create new group */}
              {showNewGroupInput ? (
                <div className="px-1 py-1 space-y-1">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Group name…"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newGroupName.trim()) {
                        onCreateGroup?.(newGroupName.trim());
                        setShowNewGroupInput(false); setNewGroupName(""); setGroupMenuOpen(false); setOpen(false);
                      }
                      if (e.key === "Escape") { setShowNewGroupInput(false); setNewGroupName(""); }
                    }}
                    className="w-full text-xs border rounded px-2 py-1 bg-background outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="flex-1 text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
                      onClick={() => {
                        if (newGroupName.trim()) {
                          onCreateGroup?.(newGroupName.trim());
                          setShowNewGroupInput(false); setNewGroupName(""); setGroupMenuOpen(false); setOpen(false);
                        }
                      }}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      className="text-xs px-2 py-0.5 rounded hover:bg-muted transition-colors"
                      onClick={() => { setShowNewGroupInput(false); setNewGroupName(""); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-green-50 text-green-700 flex items-center gap-1.5 transition-colors"
                  onClick={() => setShowNewGroupInput(true)}
                >
                  <Plus size={11} className="shrink-0" /> Create New Group
                </button>
              )}
            </PopoverContent>
          </Popover>
        )}

        {/* Remove from group */}
        {onRemoveFromGroup && (
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted flex items-center gap-1.5 transition-colors"
            onClick={() => { onRemoveFromGroup(); setOpen(false); }}
          >
            <X size={11} className="shrink-0" /> Remove from group
          </button>
        )}

        {/* 2026-06-23 (MICROCIRCUITS — non-zero-balance delete guard):
            Delete is disabled when the row carries any CY or PY amount.
            The validation reason is shown in a tooltip (title attribute)
            and visually as a muted, non-interactive entry. Auditor must
            first zero / unmap the ledger in Stage 6 COA Mapping before
            deletion — preserves Notes ↔ FS ↔ COA reconciliation. */}
        {deleteDisabledReason ? (
          <div
            role="button"
            aria-disabled="true"
            tabIndex={-1}
            title={deleteDisabledReason}
            className="w-full text-left px-2 py-1 rounded text-xs text-muted-foreground/60 flex items-center gap-1.5 cursor-not-allowed select-none"
          >
            <Trash2 size={11} className="shrink-0" /> Delete row
          </div>
        ) : (
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded text-xs hover:bg-red-50 text-destructive flex items-center gap-1.5 transition-colors"
            onClick={() => { onDelete(); setOpen(false); }}
          >
            <Trash2 size={11} className="shrink-0" /> Delete row
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Single row in a ListTable — shows description, CY, PY, actions, and optionally expands sources. */
function ListRowWithSources({
  r, origIdx, isLinked, isManual, hasSources, descPlaceholder, update, remove,
  onUnmap, onSplitSources, subGroups, onMoveToGroup, onCreateGroup, onRemoveFromGroup,
  handleDragStart, onRestoreLink, lockAmounts = false, splitToShortTermEnabled = false,
}: {
  r: ListRow;
  origIdx: number;
  isLinked: boolean;
  isManual: boolean;
  hasSources: boolean;
  descPlaceholder: string;
  update: (i: number, patch: Partial<ListRow>) => void;
  remove: (i: number) => void;
  /** Issue 2 — Unmap a TB-linked row (clears linked_ledger and sources). */
  onUnmap?: () => void;
  /** Issue 3 — Split a consolidated row (sources.length > 1) into per-source rows. */
  onSplitSources?: () => void;
  subGroups?: { id: string; name: string }[];
  onMoveToGroup?: (groupId: string) => void;
  onCreateGroup?: (groupName: string) => void;
  onRemoveFromGroup?: () => void;
  handleDragStart?: (e: React.DragEvent, origIdx: number) => void;
  /** Issue-3: When manual row has an original linked_ledger, call this to re-link. */
  onRestoreLink?: () => void;
  /** 2026-06-18 (GROWQ PVT LTD, Issue 2) — when true, both amount cells are
   *  rendered read-only regardless of `source` / `linked_ledger`. Threaded
   *  through from ListTable's `lockAmounts` prop. */
  lockAmounts?: boolean;
  /** 2026-06-25 (V J Desai — LT/ST split): threaded through from ListTable
   *  so the ⋮ menu on Long-term notes exposes the ST-portion input. */
  splitToShortTermEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="grid grid-cols-12 gap-2 items-center">
        <div className="col-span-6 flex items-center gap-1">
          {/* Drag handle — drag only starts from here, not from inputs */}
          <span
            className="drag-handle shrink-0 cursor-grab text-muted-foreground/30 hover:text-muted-foreground/70 py-1 select-none"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', String(origIdx));
              e.dataTransfer.effectAllowed = 'move';
              e.stopPropagation();
              handleDragStart?.(e, origIdx);
            }}
            title="Drag to reorder"
          >
            <GripVertical size={11} />
          </span>
          {hasSources ? (
            <button
              type="button"
              className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded border border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100"
              title={`${r.sources!.length} ledgers merged — click to expand`}
              onClick={() => setOpen(o => !o)}
            >
              {open ? <ChevronDown className="w-3 h-3" /> : <Info className="w-3 h-3" />}
            </button>
          ) : (
            <div className="w-4 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <EditableCell
              type="text"
              value={r.description ?? ""}
              placeholder={descPlaceholder}
              isAutoFilled={isLinked}
              isOverridden={isManual && !!r.description}
              onCommit={(v) => update(origIdx, { description: String(v ?? "") })}
            />
          </div>
          {isLinked && (
            <span
              title={r.linked_ledger ? `Linked from TB ledger: ${r.linked_ledger} — amount is read-only. Edit COA mapping in Stage 6 to change.` : "Linked from TB — amount is read-only. Edit COA mapping in Stage 6 to change."}
              className="shrink-0 inline-flex items-center px-1 py-[1px] rounded text-[8px] font-semibold uppercase tracking-wide border border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
            >
              Linked
            </span>
          )}
          {isManual && (
            <span
              title={r.override_reason ? `Overridden — reason: ${r.override_reason}` : "Manually entered — re-sync from COA will not change this row"}
              className="shrink-0 inline-flex items-center px-1 py-[1px] rounded text-[8px] font-semibold uppercase tracking-wide border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
            >
              {r.override_reason ? "Overridden" : "Manual"}
            </span>
          )}
        </div>
        <div className="col-span-3">
          <EditableCell
            value={r.amount_cy ?? 0}
            isAutoFilled={isLinked}
            isOverridden={isManual && (r.amount_cy ?? 0) !== 0}
            isLocked={lockAmounts || isLinked || !!r.linked_ledger}
            onOverride={(amt, reason) => update(origIdx, { amount_cy: amt, override_reason: reason })}
            onCommit={(v) => update(origIdx, { amount_cy: v == null ? 0 : Number(v) })}
          />
        </div>
        <div className="col-span-2">
          <EditableCell
            value={r.amount_py ?? 0}
            isAutoFilled={isLinked}
            isOverridden={isManual && (r.amount_py ?? 0) !== 0}
            isLocked={lockAmounts || isLinked || !!r.linked_ledger}
            onOverride={(amt, reason) => update(origIdx, { amount_py: amt, override_reason: reason })}
            onCommit={(v) => update(origIdx, { amount_py: v == null ? 0 : Number(v) })}
          />
        </div>
        <div className="col-span-1 flex justify-end">
          <ListRowActionsMenu
            onDelete={() => remove(origIdx)}
            onRemoveFromGroup={onRemoveFromGroup}
            linkedLedger={r.linked_ledger}
            onUnmap={onUnmap}
            onSplitSources={onSplitSources}
            subGroups={subGroups}
            onMoveToGroup={onMoveToGroup}
            onCreateGroup={onCreateGroup}
            onRestoreLink={onRestoreLink}
            // 2026-06-25 (V J Desai — LT/ST split). Enabled only on the
            // Long-term notes; the menu shows an inline CY/PY input for the
            // portion that should reclassify to the Short-term counterpart.
            splitToShortTermEnabled={splitToShortTermEnabled}
            currentStSplitCy={r.st_split_cy}
            currentStSplitPy={r.st_split_py}
            onCommitStSplit={(cy, py) => update(origIdx, { st_split_cy: cy ?? undefined, st_split_py: py ?? undefined })}
            deleteDisabledReason={
              // 2026-06-23 (MICROCIRCUITS — delete guard): block deletion
              // when the row carries any CY or PY amount, regardless of
              // Auto/Manual source. Deleting amount-bearing rows leaves
              // the BS/PL face out of sync with COA mapping; auditor must
              // zero the amount (or unmap in Stage 6 COA) first.
              (Math.abs(Number(r.amount_cy ?? 0)) > 0.005 || Math.abs(Number(r.amount_py ?? 0)) > 0.005)
                ? "Cannot delete — row has a non-zero balance. Set both CY and PY amounts to zero (or unmap the ledger in Stage 6 COA Mapping) before deleting, otherwise the Notes and the BS/PL face would drift from the COA mapping."
                : undefined
            }
          />
        </div>
      </div>
      {hasSources && open && (
        <div className="ml-6 pl-2 border-l-2 border-blue-200 space-y-0.5 py-1">
          {r.sources!.map((s, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center text-[10px] text-muted-foreground italic">
              <div className="col-span-6 truncate" title={s.ledger}>↳ {s.ledger}</div>
              <div className="col-span-3 text-right tabular-nums pr-2">{formatINR(s.amount_cy)}</div>
              <div className="col-span-2 text-right tabular-nums pr-2">{formatINR(s.amount_py)}</div>
              <div className="col-span-1" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ListRow — data shape for every row in a ListTable
// ─────────────────────────────────────────────────────────────────────────

export interface ListRow {
  /** Unique ID — required for group header rows (is_group=true); optional for regular rows. */
  id?: string;
  /** True for GROUP header rows. Renders with GROUP badge and computed total from members. */
  is_group?: boolean;
  description?: string;
  amount_cy?: number;
  amount_py?: number;
  source?: "linked" | "manual";
  linked_ledger?: string;
  /** 2026-06-25 (V J Desai — LT/ST split): only used by Long-term notes
   *  (LT Borrowings, LT Loans & Advances). Represents the portion of the
   *  ledger's balance that should reclassify to the Short-term counterpart
   *  note (Current Maturity of long-term debt / short-term loans & advances).
   *  When set:
   *    • The LT note displays / totals amount_cy − st_split_cy.
   *    • The ST note renders a MIRROR row (source: "linked", locked) with
   *      description="<ledger> (current maturity)" and amount = st_split_cy.
   *  Sum of LT + ST across the two notes still equals the ledger's TB
   *  balance, so the FS invariant BS = COA holds. */
  st_split_cy?: number;
  st_split_py?: number;
  /** Marker set on the injected ST mirror row so we can (a) render a subtle
   *  "Current Maturity" tag and (b) prevent it from being persisted back to
   *  the ST note's own breakup on save — the mirror is derived data. */
  st_mirror_of?: string;
  /** Points to the `id` of the parent group header row. Set on member rows. */
  subgroup_id?: string;
  /** When this row consolidates multiple TB ledgers, lists the underlying ledgers + amounts. */
  sources?: { ledger: string; amount_cy: number; amount_py: number }[];
  /** Auditor's stated reason when manually overriding a TB-linked amount. */
  override_reason?: string;
}

/** Generate a short unique ID for new group headers. */
function genGroupId(): string {
  return `sg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// ListTable — managed list of rows with sub-group support + drag & drop
// ─────────────────────────────────────────────────────────────────────────

export function ListTable({
  rows,
  onChange,
  addLabel = "Add row",
  descPlaceholder = "Particulars",
  showSubtotal = false,
  onRemapLedger,
  onUnmapLedger,
  engagementId,
  // 2026-06-18 (GROWQ PVT LTD, Issue 2) — corporate Notes-to-Accounts must
  // be read-only on amounts (ledger totals always flow TB → COA → Notes).
  // ListTable is used exclusively by corporate notes (stage5 directory), so
  // the default is `true`. Share Capital, Reserves and Surplus, and PPE /
  // FA notes use bespoke editors (not ListTable) and remain editable.
  lockAmounts = true,
  splitToShortTermEnabled = false,
}: {
  rows:             ListRow[];
  onChange:         (next: ListRow[]) => void;
  addLabel?:        string;
  descPlaceholder?: string;
  showSubtotal?:    boolean;
  onRemapLedger?:   (ledgerName: string, newCode: string) => void;
  /** Issue 4 (Aesha) — also clears the ledger from coa_mapping in DB so it
   *  appears as Unmapped on the COA Mapping page and is removed from FS. */
  onUnmapLedger?:   (ledgerName: string) => void;
  /** 2026-06-25 (V J Desai — LT/ST split): opt-in per-note. When true, each
   *  row's ⋮ menu exposes "Split to Short-term" with CY/PY inputs. Only
   *  passed by Long-term borrowings and Long-term loans & advances. */
  splitToShortTermEnabled?: boolean;
  /** Corporate Lock Preview parity with NCE: when set, the per-group
   *  collapse/expand state is persisted to localStorage under a single
   *  engagement-scoped key. This is what lets the locked preview popup
   *  inherit the editor's collapse decisions (collapsed "GST Receivable"
   *  in the editor → collapsed in the popup → matches export). Group IDs
   *  are unique across ListTables in a single engagement so one shared
   *  key is sufficient. */
  engagementId?:    string;
  /** 2026-06-18 (GROWQ PVT LTD, Issue 2) — when true every amount cell in the
   *  table is read-only regardless of `source`. Used by the corporate Notes
   *  editor to lock all notes EXCEPT Share Capital, Reserves and Surplus,
   *  and PPE / Fixed Assets, where the auditor still needs to type the
   *  paid-up / opening / additions / disposals values that have no TB
   *  counterpart. Manual rows can still be added / deleted; only the
   *  amount columns are locked. */
  lockAmounts?:     boolean;
}) {
  const [dragRow,          setDragRow]          = useState<number | null>(null);
  const [dragOverRow,      setDragOverRow]       = useState<number | null>(null);
  const storageKey = engagementId ? `fs_corp_collapsed_groups_${engagementId}` : null;
  const [collapsedGroups,  setCollapsedGroups]   = useState<Set<string>>(() => {
    if (!storageKey || typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? new Set<string>(parsed) : new Set();
    } catch {
      return new Set();
    }
  });
  // Re-hydrate when the storageKey changes (e.g. switching engagements
  // in the same browser tab). Without this, ListTables would freeze on
  // the first engagement's collapse state.
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setCollapsedGroups(Array.isArray(parsed) ? new Set<string>(parsed) : new Set());
    } catch { /* storage unavailable — ignore */ }
  }, [storageKey]);

  // ── CRUD helpers ─────────────────────────────────────────────────────────
  const update = (i: number, patch: Partial<ListRow>) => {
    const cur = rows[i] || {};
    // Issue 3 (Aesha) — Linked → Manual flip rule:
    // ONLY flip when the patched value actually DIFFERS from the current
    // stored value.  Previously, simply clicking into the description cell
    // and blurring (no typing) re-emitted the same string via onCommit,
    // which triggered an unintended conversion to manual.  Amount cells
    // are already locked at the EditableCell isLocked path; we still
    // defensively check amount changes here so any future code path that
    // edits amount on a linked row also requires a real value change.
    const hasReal = (key: keyof ListRow): boolean => {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) return false;
      const before = (cur as any)[key];
      const after  = (patch as any)[key];
      // Treat null / undefined / "" as equivalent so blur-with-empty
      // doesn't count as a change.
      const norm = (v: unknown) => (v == null || v === "" ? null : v);
      return norm(before) !== norm(after);
    };
    const flipsToManual =
      cur.source === "linked" &&
      (hasReal("description") || hasReal("amount_cy") || hasReal("amount_py"));
    const next = rows.slice();
    next[i] = {
      ...cur,
      ...patch,
      // Keep linked_ledger when flipping to manual so user can restore later.
      ...(flipsToManual ? { source: "manual" } : {}),
    };
    onChange(next);
  };

  const remove = (i: number) => {
    const next = rows.slice();
    next.splice(i, 1);
    onChange(next);
  };

  const removeGroupWithUngroup = (i: number) => {
    const row = rows[i];
    const next = rows.slice();
    // Un-group all members first
    if (row.is_group && row.id) {
      for (let j = 0; j < next.length; j++) {
        if (next[j].subgroup_id === row.id) {
          next[j] = { ...next[j], subgroup_id: undefined };
        }
      }
    }
    next.splice(i, 1);
    onChange(next);
  };

  const add = () => onChange([
    ...rows,
    { id: genGroupId(), description: "", amount_cy: 0, amount_py: 0, source: "manual" },
  ]);

  const addGroup = () => onChange([
    ...rows,
    { id: genGroupId(), is_group: true, description: "New Group", source: "manual" },
  ]);

  const moveToGroup = (rowIdx: number, groupId: string) => {
    const next = rows.slice();
    next[rowIdx] = { ...next[rowIdx], subgroup_id: groupId };
    onChange(next);
  };

  // Creates a new group header immediately before the row at rowIdx, then moves that row into it.
  const createGroupForRow = (rowIdx: number, groupName: string) => {
    const groupId = genGroupId();
    const next = rows.slice();
    next[rowIdx] = { ...next[rowIdx], subgroup_id: groupId };
    next.splice(rowIdx, 0, { id: groupId, is_group: true, description: groupName, source: "manual" });
    onChange(next);
  };

  const removeFromGroup = (rowIdx: number) => {
    const next = rows.slice();
    next[rowIdx] = { ...next[rowIdx], subgroup_id: undefined };
    onChange(next);
  };

  // Issue 4 (Aesha) — Unmap: clear the COA mapping for the underlying TB
  // ledger AND remove the row from the breakup entirely.  This propagates
  // the unmap to the Stage 6 COA Mapping page (so the ledger appears as
  // "Unmapped") and to the BS / P&L face (so the ledger no longer feeds
  // any FS line item).  When the parent component supplies onUnmapLedger,
  // it is invoked with the linked ledger name; the parent is responsible
  // for the DB write + a re-sync that will rebuild the breakup without
  // this row.  As a safety net we also strip the row locally so the user
  // sees the change immediately even before the re-sync completes.
  const unmapRow = (rowIdx: number) => {
    const cur = rows[rowIdx];
    if (!cur) return;

    // Collect every ledger the row represents — single linked_ledger PLUS
    // any merged sub-sources (smart-merge consolidates several ledgers
    // into one breakup row; unmapping should clear ALL of them).
    const linkedNames: string[] = [];
    if (cur.linked_ledger) linkedNames.push(cur.linked_ledger);
    if (Array.isArray(cur.sources)) {
      for (const s of cur.sources) {
        if (s?.ledger) linkedNames.push(s.ledger);
      }
    }
    if (onUnmapLedger && linkedNames.length > 0) {
      // Fire & forget — parent re-syncs the notes after each call
      for (const name of linkedNames) onUnmapLedger(name);
    }

    // Remove the row locally
    const next = rows.slice();
    next.splice(rowIdx, 1);
    onChange(next);
  };

  // Issue 3 — Split a consolidated row (multiple sources merged into one
  // breakup row) into one row per source ledger so each can be moved /
  // unmapped independently.  Preserves the parent row's subgroup_id.
  const splitSources = (rowIdx: number) => {
    const cur = rows[rowIdx];
    if (!cur || !Array.isArray(cur.sources) || cur.sources.length < 2) return;
    const next = rows.slice();
    const replacements: ListRow[] = cur.sources.map((s) => ({
      id:            genGroupId(),
      description:   s.ledger,
      amount_cy:     s.amount_cy,
      amount_py:     s.amount_py,
      source:        "linked",
      linked_ledger: s.ledger,
      subgroup_id:   cur.subgroup_id,
    }));
    next.splice(rowIdx, 1, ...replacements);
    onChange(next);
  };

  // ── Drag & drop — only starts from the .drag-handle span ──────────────────
  const handleDragStart = (_e: React.DragEvent, origIdx: number) => setDragRow(origIdx);
  const handleDragOver  = (e: React.DragEvent, origIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverRow(origIdx);
  };
  const handleDrop = (e: React.DragEvent, origIdx: number) => {
    e.preventDefault();
    const fromStr = e.dataTransfer.getData('text/plain');
    const from = fromStr !== '' ? parseInt(fromStr, 10) : dragRow;
    if (from === null || from === undefined || isNaN(from as number) || from === origIdx) {
      setDragRow(null); setDragOverRow(null);
      return;
    }
    const destRow = rows[origIdx];
    const sourceRow = rows[from as number];

    // If dropping onto a group header: move the dragged row INTO that group
    if (destRow?.is_group && destRow?.id) {
      const next = rows.slice();
      next[from as number] = { ...next[from as number], subgroup_id: destRow.id };
      onChange(next);
      setDragRow(null); setDragOverRow(null);
      return;
    }

    // If source was in a group and destination is in a DIFFERENT group: move to new group
    if (sourceRow?.subgroup_id && destRow?.subgroup_id && sourceRow.subgroup_id !== destRow.subgroup_id) {
      const next = rows.slice();
      next[from as number] = { ...next[from as number], subgroup_id: destRow.subgroup_id };
      onChange(next);
      setDragRow(null); setDragOverRow(null);
      return;
    }

    // Issue-1: If source was in a group but destination is NOT in any group,
    // remove the source from its group (clear subgroup_id) and reorder.
    const next = rows.slice();
    const movedRow = {
      ...next[from as number],
      // Clear subgroup_id only when dropping outside the group (flat area)
      ...(sourceRow?.subgroup_id && !destRow?.subgroup_id ? { subgroup_id: undefined } : {}),
    };
    next.splice(from as number, 1);
    next.splice(origIdx > (from as number) ? origIdx - 1 : origIdx, 0, movedRow);
    onChange(next);
    setDragRow(null); setDragOverRow(null);
  };
  const handleDragEnd = () => { setDragRow(null); setDragOverRow(null); };

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      // Persist so the locked preview popup sees the same collapse state.
      if (storageKey && typeof window !== "undefined") {
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch { /* storage unavailable — ignore */ }
      }
      return next;
    });
  };

  // ── Build group structure ─────────────────────────────────────────────────
  const groupHeaderMap = new Map<string, { row: ListRow; origIdx: number }>();
  const membersByGroup  = new Map<string, { row: ListRow; origIdx: number }[]>();

  rows.forEach((r, i) => {
    if (!r) return;
    if (r.is_group && r.id) {
      groupHeaderMap.set(r.id, { row: r, origIdx: i });
      membersByGroup.set(r.id, []);
    }
  });
  rows.forEach((r, i) => {
    if (!r) return;
    if (r.subgroup_id && groupHeaderMap.has(r.subgroup_id)) {
      membersByGroup.get(r.subgroup_id)!.push({ row: r, origIdx: i });
    }
  });

  // Rows already shown inside a group — skip at flat level
  const isMember = (r: ListRow | null) => !!(r?.subgroup_id && groupHeaderMap.has(r.subgroup_id!));

  // All group headers (for "Move to Sub Group" sub-menu in every row)
  const allSubGroups = [...groupHeaderMap.entries()].map(([id, { row }]) => ({
    id,
    name: row.description ?? id,
  }));

  // Flat display list: excludes nulls, members, and zero-amount linked non-group rows
  const displayItems = rows
    .map((r, origIdx) => ({ r, origIdx }))
    .filter(({ r }) =>
      r != null &&
      !(!r.is_group && r.source === "linked" && (r.amount_cy || 0) === 0 && (r.amount_py || 0) === 0) &&
      !isMember(r)
    );

  // ── Sub-total (accounts for group members) ────────────────────────────────
  const computeGroupAmounts = (groupId: string) => {
    const members = membersByGroup.get(groupId) ?? [];
    return {
      cy: members.reduce((s, m) => s + (m?.row?.amount_cy ?? 0), 0),
      py: members.reduce((s, m) => s + (m?.row?.amount_py ?? 0), 0),
    };
  };

  const subTotalCY = displayItems.reduce((s, { r }) =>
    r?.is_group && r?.id ? s + computeGroupAmounts(r.id).cy : s + (r?.amount_cy ?? 0), 0);
  const subTotalPY = displayItems.reduce((s, { r }) =>
    r?.is_group && r?.id ? s + computeGroupAmounts(r.id).py : s + (r?.amount_py ?? 0), 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-1">
      {displayItems.length === 0 && (
        <div className="text-[10px] italic text-muted-foreground py-1">No entries yet.</div>
      )}

      {displayItems.map(({ r, origIdx }) => {
        const isGroupRow = !!(r.is_group && r.id);
        const isLinked = r.source === "linked";
        const isManual = r.source === "manual";
        const hasSources = Array.isArray(r.sources) && r.sources.length > 1;

        if (isGroupRow) {
          // ─── GROUP HEADER + MEMBERS ───────────────────────────────────────
          const groupId   = r.id!;
          const members   = membersByGroup.get(groupId) ?? [];
          const groupAmts = computeGroupAmounts(groupId);
          const collapsed = collapsedGroups.has(groupId);

          return (
            <div
              key={`grp_${groupId}`}
              onDragOver={(e) => handleDragOver(e, origIdx)}
              onDrop={(e) => handleDrop(e,origIdx)}
              onDragEnd={handleDragEnd}
              className={cn("rounded", dragOverRow === origIdx && "ring-1 ring-primary")}
            >
              {/* Group header row */}
              <div className="grid grid-cols-12 gap-2 items-center py-0.5 rounded bg-purple-50/40 dark:bg-purple-900/10">
                <div className="col-span-6 flex items-center gap-1">
                  {/* Drag handle */}
                  <span
                    className="drag-handle shrink-0 cursor-grab text-purple-300 hover:text-purple-500 py-1 select-none"
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(origIdx)); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); handleDragStart(e, origIdx); }}
                    title="Drag group to reorder"
                  >
                    <GripVertical size={11} />
                  </span>
                  {/* Collapse toggle */}
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapse(groupId)}
                    className="shrink-0 text-purple-400 hover:text-purple-600 transition-colors"
                    title={collapsed ? "Expand group" : "Collapse group"}
                  >
                    {collapsed
                      ? <ChevronRight className="w-3.5 h-3.5" />
                      : <ChevronDown  className="w-3.5 h-3.5" />
                    }
                  </button>
                  <div className="flex-1 min-w-0">
                    <EditableCell
                      type="text"
                      value={r.description ?? ""}
                      placeholder="Group name"
                      onCommit={(v) => update(origIdx, { description: String(v ?? "") })}
                      className="text-left font-semibold text-[11px]"
                    />
                  </div>
                  <span className="shrink-0 inline-flex items-center px-1 py-[1px] rounded text-[8px] font-semibold uppercase tracking-wide border border-purple-300 bg-purple-50 text-purple-700">
                    Group
                  </span>
                </div>
                <div className="col-span-3 text-right tabular-nums font-semibold text-[11px] pr-1">
                  {groupAmts.cy !== 0 ? formatINR(groupAmts.cy) : <span className="text-muted-foreground">—</span>}
                </div>
                <div className="col-span-2 text-right tabular-nums font-semibold text-[11px] pr-1">
                  {groupAmts.py !== 0 ? formatINR(groupAmts.py) : <span className="text-muted-foreground">—</span>}
                </div>
                <div className="col-span-1 flex justify-end">
                  {/* Issue-2: Group headers do NOT get "Move to Sub Group" option */}
                  <ListRowActionsMenu
                    onDelete={() => removeGroupWithUngroup(origIdx)}
                    deleteDisabledReason={
                      // 2026-06-23 (MICROCIRCUITS — delete guard) — same
                      // rule for sub-group headers: if the aggregated
                      // group total (CY or PY) is non-zero, deletion is
                      // blocked. Members under the group carry amounts;
                      // removing the header would orphan them.
                      (Math.abs(Number(groupAmts.cy ?? 0)) > 0.005 || Math.abs(Number(groupAmts.py ?? 0)) > 0.005)
                        ? "Cannot delete — this sub-group has a non-zero balance from its member rows. Zero or unmap each member ledger first."
                        : undefined
                    }
                  />
                </div>
              </div>

              {/* Member rows — indented under the group */}
              {!collapsed && (
                <div className="ml-5 pl-2 border-l-2 border-purple-200 dark:border-purple-700 space-y-0.5 py-0.5">
                  {members.length === 0 && (
                    <div className="text-[10px] italic text-muted-foreground py-0.5">No items — move rows here via ⋮ menu.</div>
                  )}
                  {members.map(({ row: mr, origIdx: mi }) => (
                    <div
                      key={mr.id || mi}
                      onDragOver={(e) => handleDragOver(e, mi)}
                      onDrop={(e) => handleDrop(e,mi)}
                      onDragEnd={handleDragEnd}
                      className={cn("rounded", dragOverRow === mi && "ring-1 ring-primary")}
                    >
                      <ListRowWithSources
                        r={mr}
                        origIdx={mi}
                        isLinked={mr.source === "linked"}
                        isManual={mr.source === "manual"}
                        hasSources={Array.isArray(mr.sources) && mr.sources.length > 1}
                        descPlaceholder={descPlaceholder}
                        update={update}
                        remove={remove}
                        onUnmap={mr.linked_ledger ? () => unmapRow(mi) : undefined}
                        onSplitSources={
                          Array.isArray(mr.sources) && mr.sources.length > 1
                            ? () => splitSources(mi)
                            : undefined
                        }
                        subGroups={allSubGroups.filter((g) => g.id !== groupId)}
                        onMoveToGroup={(targetId) => moveToGroup(mi, targetId)}
                        onCreateGroup={(name) => createGroupForRow(mi, name)}
                        onRemoveFromGroup={() => removeFromGroup(mi)}
                        handleDragStart={handleDragStart}
                        onRestoreLink={
                          mr.source === "manual" && mr.linked_ledger
                            ? () => update(mi, { source: "linked" })
                            : undefined
                        }
                        lockAmounts={lockAmounts}
                        splitToShortTermEnabled={splitToShortTermEnabled}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        // ─── REGULAR ROW ───────────────────────────────────────────────────
        return (
          <div
            key={origIdx}
            onDragOver={(e) => handleDragOver(e, origIdx)}
            onDrop={(e) => handleDrop(e,origIdx)}
            onDragEnd={handleDragEnd}
            className={cn("rounded", dragOverRow === origIdx && "ring-1 ring-primary")}
          >
            <ListRowWithSources
              r={r}
              origIdx={origIdx}
              isLinked={isLinked}
              isManual={isManual}
              hasSources={hasSources}
              descPlaceholder={descPlaceholder}
              update={update}
              remove={remove}
              onUnmap={r.linked_ledger ? () => unmapRow(origIdx) : undefined}
              onSplitSources={
                Array.isArray(r.sources) && r.sources.length > 1
                  ? () => splitSources(origIdx)
                  : undefined
              }
              subGroups={allSubGroups}
              onMoveToGroup={(targetId) => moveToGroup(origIdx, targetId)}
              onCreateGroup={(name) => createGroupForRow(origIdx, name)}
              handleDragStart={handleDragStart}
              onRestoreLink={
                isManual && r.linked_ledger
                  ? () => update(origIdx, { source: "linked" })
                  : undefined
              }
              lockAmounts={lockAmounts}
              splitToShortTermEnabled={splitToShortTermEnabled}
            />
          </div>
        );
      })}

      {/* Sub-total row */}
      {showSubtotal && displayItems.length >= 2 && (
        <div className="grid grid-cols-12 gap-2 items-center border-t border-muted pt-1 mt-0.5">
          <div className="col-span-6 text-[10px] font-semibold text-muted-foreground">Sub-total</div>
          <div className="col-span-3 text-right text-[10px] font-semibold tabular-nums pr-1">{formatINR(subTotalCY)}</div>
          <div className="col-span-2 text-right text-[10px] font-semibold tabular-nums pr-1">{formatINR(subTotalPY)}</div>
          <div className="col-span-1" />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <Button
          type="button" variant="outline" size="sm"
          onClick={add}
          className="h-6 text-[10px] gap-1"
        >
          <Plus size={11} /> {addLabel}
        </Button>
        <Button
          type="button" variant="ghost" size="sm"
          onClick={addGroup}
          className="h-6 text-[10px] gap-1 text-purple-600 hover:bg-purple-50 hover:text-purple-700"
        >
          <Plus size={11} /> Add Sub Group
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AgeingTable
// ─────────────────────────────────────────────────────────────────────────

export interface AgeingMatrix {
  [rowKey: string]: { [bucket: string]: number };
}

export function AgeingTable({
  rowDefs,
  bucketDefs,
  matrix,
  onChange,
}: {
  rowDefs:    { key: string; label: string }[];
  bucketDefs: { key: string; label: string }[];
  matrix:     AgeingMatrix | undefined;
  onChange:   (next: AgeingMatrix) => void;
}) {
  const m = matrix || {};
  const update = (rk: string, bk: string, v: number | null) => {
    const next: AgeingMatrix = JSON.parse(JSON.stringify(m));
    next[rk] = next[rk] || {};
    if (v == null) delete next[rk][bk];
    else next[rk][bk] = v;
    onChange(next);
  };
  const rowTotal = (rk: string) =>
    bucketDefs.reduce((s, b) => s + (m[rk]?.[b.key] || 0), 0);
  const colTotal = (bk: string) =>
    rowDefs.reduce((s, r) => s + (m[r.key]?.[bk] || 0), 0);
  const grand = rowDefs.reduce((s, r) => s + rowTotal(r.key), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="bg-muted/40">
            <th className="text-left p-1 border w-[28%]">Particulars</th>
            {bucketDefs.map(b => (
              <th key={b.key} className="text-right p-1 border">{b.label}</th>
            ))}
            <th className="text-right p-1 border bg-muted/60">Total</th>
          </tr>
        </thead>
        <tbody>
          {rowDefs.map(r => (
            <tr key={r.key}>
              <td className="p-1 border">{r.label}</td>
              {bucketDefs.map(b => (
                <td key={b.key} className="p-0.5 border">
                  <EditableCell
                    value={m[r.key]?.[b.key] ?? 0}
                    onCommit={(v) => update(r.key, b.key, v == null ? null : Number(v))}
                  />
                </td>
              ))}
              <td className="p-1 border text-right tabular-nums font-semibold bg-muted/30">{formatINR(rowTotal(r.key))}</td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <td className="p-1 border">Total</td>
            {bucketDefs.map(b => (
              <td key={b.key} className="p-1 border text-right tabular-nums">{formatINR(colTotal(b.key))}</td>
            ))}
            <td className="p-1 border text-right tabular-nums">{formatINR(grand)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

