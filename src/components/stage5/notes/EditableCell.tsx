/**
 * EditableCell + Notes primitives — shared building blocks for the Stage 5
 * Notes tab (UI-6). Re-used by NoteBSLiab, NoteBSAsset, NotePL, FAGrid.
 *
 * Although the file name says "EditableCell", it also exports the lightweight
 * layout primitives (NoteCard, SubSection, EditableRow, ListTable,
 * AgeingTable) so every note file imports from one place.
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Pencil, X, Plus, Trash2, ChevronDown, ChevronRight, MoreVertical, Info, GripVertical } from "lucide-react";
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
  /** When true and !isOverridden, renders a read-only f(x) display with a pencil-to-override UX. */
  isLocked?:       boolean;
  /** Called when the user completes the override form. Falls back to onCommit when omitted. */
  onOverride?:     (amount: number, reason: string) => void;
  type?:           "number" | "text";
  placeholder?:    string;
  className?:      string;
  disabled?:       boolean;
}

export function EditableCell({
  value, autoValue, onCommit, onResetToAuto,
  isOverridden, isAutoFilled, isLocked, onOverride,
  type = "number", placeholder, className, disabled,
}: EditableCellProps) {
  const [focused,        setFocused]        = useState(false);
  const [draft,          setDraft]          = useState<string>("");
  const [overrideOpen,   setOverrideOpen]   = useState(false);
  const [overrideAmt,    setOverrideAmt]    = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const fsUnits = useFsUnits();

  const handleOverrideSave = () => {
    const t = overrideAmt.trim();
    if (!t || !overrideReason.trim()) return;
    const parsed = Number(t.replace(/,/g, ""));
    if (!Number.isFinite(parsed)) return;
    const actual = parsed * fsUnits.meta.divisor;
    if (onOverride) {
      onOverride(actual, overrideReason.trim());
    } else {
      onCommit(actual);
    }
    setOverrideOpen(false);
    setOverrideAmt("");
    setOverrideReason("");
  };

  // ── Locked path (auto-populated from TB, requires override form to edit) ──
  if (isLocked && !isOverridden && !disabled) {
    if (overrideOpen) {
      return (
        <div className="flex flex-col gap-1 p-1.5 rounded border border-blue-300 bg-blue-50/60">
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            placeholder="New amount"
            value={overrideAmt}
            onChange={(e) => setOverrideAmt(e.target.value)}
            className="w-full text-right border rounded px-1 py-0.5 bg-white text-[11px] outline-none focus:ring-1 focus:ring-blue-400"
          />
          <input
            type="text"
            placeholder="Reason for override (required)"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleOverrideSave(); }}
            className="w-full border rounded px-1 py-0.5 bg-white text-[11px] outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="flex justify-end gap-1 mt-0.5">
            <button
              type="button"
              onClick={() => { setOverrideOpen(false); setOverrideAmt(""); setOverrideReason(""); }}
              className="text-[10px] px-2 py-0.5 rounded border hover:bg-muted text-muted-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleOverrideSave}
              disabled={!overrideReason.trim() || !overrideAmt.trim()}
              className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className={cn("flex items-center gap-1 rounded px-1 border border-blue-200 bg-blue-50/30", className)}>
        <span className="flex-1 text-right tabular-nums text-[11px] text-blue-900 dark:text-blue-200 select-none">
          {fsUnits.format(Number(value ?? 0))}
          <sup className="ml-0.5 text-[8px] font-bold text-blue-500 align-super">f(x)</sup>
        </span>
        <button
          type="button"
          onClick={() => {
            const raw = (value === 0 || value === null || value === undefined)
              ? ""
              : String(fsUnits.scaleAmount(Number(value)));
            setOverrideAmt(raw);
            setOverrideOpen(true);
          }}
          title="Auto-computed from TB. Click to override."
          className="shrink-0 p-0.5 rounded hover:bg-blue-100 text-blue-400 hover:text-blue-600 transition-colors"
        >
          <Pencil size={10} />
        </button>
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
}: {
  noteNo: number | string | null;
  title: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
  collapseControl?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    if (collapseControl !== undefined) setCollapsed(collapseControl);
  }, [collapseControl]);

  return (
    <section
      id={noteNo != null ? `note-${noteNo}` : undefined}
      className="rounded-lg border bg-card mb-4"
    >
      <header
        className="border-b bg-muted/30 px-3 py-1.5 flex items-center gap-1.5 cursor-pointer select-none hover:bg-muted/50 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
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

export function EditableRow({
  label, indent = 0,
  cy, py, autoCY, autoPY,
  isOverriddenCy, isOverriddenPy,
  onCommitCy, onCommitPy, onResetCy, onResetPy,
  bold,
  actionGutter = true,
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
}) {
  const cyCol = "col-span-3";
  const pyCol = actionGutter ? "col-span-2" : "col-span-3";
  return (
    <div className={cn("grid grid-cols-12 gap-2 items-center py-0.5", bold && "font-semibold")}>
      <div className="col-span-6" style={{ paddingLeft: indent * 12 }}>{label}</div>
      <div className={cyCol}>
        <EditableCell
          value={cy ?? 0}
          autoValue={autoCY ?? null}
          isAutoFilled={autoCY !== undefined && autoCY !== null}
          isOverridden={!!isOverriddenCy}
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
  onChangeMapping,
  subGroups,
  onMoveToGroup,
  onCreateGroup,
  onRestoreLink,
}: {
  onDelete: () => void;
  onRemoveFromGroup?: () => void;
  linkedLedger?: string;
  onChangeMapping?: (ledgerName: string, newCode: string) => void;
  subGroups?: { id: string; name: string }[];
  onMoveToGroup?: (groupId: string) => void;
  onCreateGroup?: (groupName: string) => void;
  /** When set, the row is MANUAL but was previously LINKED — shows "Restore Link" option. */
  onRestoreLink?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingSearch, setMappingSearch] = useState("");
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const filteredCodes = FS_CODE_OPTIONS.filter(
    (opt) =>
      opt.label.toLowerCase().includes(mappingSearch.toLowerCase()) ||
      opt.section.toLowerCase().includes(mappingSearch.toLowerCase()) ||
      opt.code.toLowerCase().includes(mappingSearch.toLowerCase()),
  );

  const bySection: Record<string, typeof FS_CODE_OPTIONS> = {};
  for (const opt of filteredCodes) {
    if (!bySection[opt.section]) bySection[opt.section] = [];
    bySection[opt.section].push(opt);
  }

  if (mappingOpen && linkedLedger && onChangeMapping) {
    return (
      <Popover open={mappingOpen} onOpenChange={(o) => { setMappingOpen(o); if (!o) setOpen(false); }}>
        <PopoverTrigger asChild>
          <button type="button" className="p-0.5 rounded text-muted-foreground hover:text-foreground">
            <MoreVertical size={12} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-64 p-2 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground truncate">
            Change mapping: <span className="text-foreground">{linkedLedger}</span>
          </div>
          <input
            type="text"
            placeholder="Search FS line item…"
            value={mappingSearch}
            onChange={(e) => setMappingSearch(e.target.value)}
            autoFocus
            className="w-full text-xs border rounded px-2 py-1 bg-background outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="max-h-52 overflow-y-auto space-y-1 pr-0.5">
            {Object.entries(bySection).map(([section, opts]) => (
              <div key={section}>
                <div className="text-[9px] font-semibold text-muted-foreground px-1 py-0.5 uppercase tracking-wide">{section}</div>
                {opts.map((opt) => (
                  <button
                    key={opt.code}
                    type="button"
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-primary/10 hover:text-primary transition-colors"
                    onClick={() => { onChangeMapping(linkedLedger, opt.code); setMappingOpen(false); setOpen(false); }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ))}
            {filteredCodes.length === 0 && (
              <div className="text-[10px] italic text-muted-foreground px-2 py-1">No match</div>
            )}
          </div>
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted text-muted-foreground"
            onClick={() => { setMappingOpen(false); setOpen(true); }}
          >
            ← Back
          </button>
        </PopoverContent>
      </Popover>
    );
  }

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
        {/* Restore Link — for manual rows that were previously linked */}
        {onRestoreLink && (
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded text-xs hover:bg-green-50 text-green-700 flex items-center gap-1.5 transition-colors"
            onClick={() => { onRestoreLink(); setOpen(false); }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Restore Link
          </button>
        )}
        {/* Change Mapping — only for linked rows */}
        {linkedLedger && onChangeMapping && (
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded text-xs hover:bg-blue-50 text-blue-700 flex items-center gap-1.5 transition-colors"
            onClick={() => { setOpen(false); setMappingOpen(true); }}
          >
            <Pencil size={11} className="shrink-0" /> Change Mapping
          </button>
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

        <button
          type="button"
          className="w-full text-left px-2 py-1 rounded text-xs hover:bg-red-50 text-destructive flex items-center gap-1.5 transition-colors"
          onClick={() => { onDelete(); setOpen(false); }}
        >
          <Trash2 size={11} className="shrink-0" /> Delete row
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** Single row in a ListTable — shows description, CY, PY, actions, and optionally expands sources. */
function ListRowWithSources({
  r, origIdx, isLinked, isManual, hasSources, descPlaceholder, update, remove,
  onChangeMapping, subGroups, onMoveToGroup, onCreateGroup, onRemoveFromGroup,
  handleDragStart, onRestoreLink,
}: {
  r: ListRow;
  origIdx: number;
  isLinked: boolean;
  isManual: boolean;
  hasSources: boolean;
  descPlaceholder: string;
  update: (i: number, patch: Partial<ListRow>) => void;
  remove: (i: number) => void;
  onChangeMapping?: (ledgerName: string, newCode: string) => void;
  subGroups?: { id: string; name: string }[];
  onMoveToGroup?: (groupId: string) => void;
  onCreateGroup?: (groupName: string) => void;
  onRemoveFromGroup?: () => void;
  handleDragStart?: (e: React.DragEvent, origIdx: number) => void;
  /** Issue-3: When manual row has an original linked_ledger, call this to re-link. */
  onRestoreLink?: () => void;
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
              title={r.linked_ledger ? `Linked from TB ledger: ${r.linked_ledger} — amounts locked (click f(x) pencil to override)` : "Linked from TB — amounts locked"}
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
            isLocked={isLinked}
            onOverride={(amt, reason) => update(origIdx, { amount_cy: amt, override_reason: reason })}
            onCommit={(v) => update(origIdx, { amount_cy: v == null ? 0 : Number(v) })}
          />
        </div>
        <div className="col-span-2">
          <EditableCell
            value={r.amount_py ?? 0}
            isAutoFilled={isLinked}
            isOverridden={isManual && (r.amount_py ?? 0) !== 0}
            isLocked={isLinked}
            onOverride={(amt, reason) => update(origIdx, { amount_py: amt, override_reason: reason })}
            onCommit={(v) => update(origIdx, { amount_py: v == null ? 0 : Number(v) })}
          />
        </div>
        <div className="col-span-1 flex justify-end">
          <ListRowActionsMenu
            onDelete={() => remove(origIdx)}
            onRemoveFromGroup={onRemoveFromGroup}
            linkedLedger={r.linked_ledger}
            onChangeMapping={onChangeMapping}
            subGroups={subGroups}
            onMoveToGroup={onMoveToGroup}
            onCreateGroup={onCreateGroup}
            onRestoreLink={onRestoreLink}
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
}: {
  rows:             ListRow[];
  onChange:         (next: ListRow[]) => void;
  addLabel?:        string;
  descPlaceholder?: string;
  showSubtotal?:    boolean;
  onRemapLedger?:   (ledgerName: string, newCode: string) => void;
}) {
  const [dragRow,          setDragRow]          = useState<number | null>(null);
  const [dragOverRow,      setDragOverRow]       = useState<number | null>(null);
  const [collapsedGroups,  setCollapsedGroups]   = useState<Set<string>>(new Set());

  // ── CRUD helpers ─────────────────────────────────────────────────────────
  const update = (i: number, patch: Partial<ListRow>) => {
    const cur = rows[i] || {};
    const flipsToManual =
      cur.source === "linked" &&
      (Object.prototype.hasOwnProperty.call(patch, "description") ||
        Object.prototype.hasOwnProperty.call(patch, "amount_cy") ||
        Object.prototype.hasOwnProperty.call(patch, "amount_py"));
    const next = rows.slice();
    next[i] = {
      ...cur,
      ...patch,
      // Issue-3: Keep linked_ledger when flipping to manual so user can restore later.
      // We intentionally do NOT clear linked_ledger here.
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
                        onChangeMapping={
                          mr.linked_ledger && onRemapLedger
                            ? (ledger, code) => onRemapLedger(ledger, code)
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
              onChangeMapping={
                r.linked_ledger && onRemapLedger
                  ? (ledger, code) => onRemapLedger(ledger, code)
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

export const PencilIcon = Pencil;
