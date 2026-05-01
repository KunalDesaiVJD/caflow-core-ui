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
import { Pencil, X, Plus, Trash2, ChevronDown, ChevronRight, MoreVertical, Info } from "lucide-react";
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
  type?:           "number" | "text";
  placeholder?:    string;
  className?:      string;
  disabled?:       boolean;
}

export function EditableCell({
  value, autoValue, onCommit, onResetToAuto,
  isOverridden, isAutoFilled,
  type = "number", placeholder, className, disabled,
}: EditableCellProps) {
  const [focused, setFocused] = useState(false);
  const [draft,   setDraft]   = useState<string>("");
  const fsUnits = useFsUnits();

  // Display rules:
  //   • text cells           → raw text
  //   • number, focused      → user types in the ACTIVE scale (e.g. '000)
  //   • number, blurred      → scaled + rounded INR (whole numbers, no paise)
  // When the user commits a value typed under a non-actual scale we multiply
  // by the divisor before persisting so the underlying store always stays in
  // actual rupees.
  const display = focused
    ? draft
    : (type === "number" ? fsUnits.format(Number(value || 0)) : (value ?? ""));

  if (disabled) {
    return <span className={cn("tabular-nums", className)}>{String(display)}</span>;
  }

  // Tint colours: blue = auto-filled (untouched), amber = manually overridden.
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
              // Under '000 / lakhs / crores show the SCALED number for editing
              // so what the user sees and what they type are in the same units.
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
            // Scale UP back to actual rupees before persisting so the store
            // stays in the canonical unit regardless of display scale.
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

/**
 * collapseControl (optional):
 *   true  → force all NoteCards collapsed (Collapse All)
 *   false → force all NoteCards expanded  (Expand All)
 *   undefined → uncontrolled; user's own toggle governs
 */
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

  // Respond to Expand All / Collapse All from parent
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

/**
 * EditableRow — a labelled row with two value cells (CY + PY). The most
 * common note-row shape. Optional `autoCY` / `autoPY` enable the auto
 * tinting + reset behaviour.
 */
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
  /**
   * Set to false ONLY when this row is rendered standalone (not under a
   * ListTable). Default true keeps the CY/PY columns aligned with the
   * breakup rows above (which reserve a 1-col action gutter for ⋮).
   */
  actionGutter?:   boolean;
}) {
  // Layout: label | CY | PY | (gutter)
  //   actionGutter=true  → 6 / 3 / 2 / 1   (matches ListTable rows)
  //   actionGutter=false → 6 / 3 / 3       (legacy / standalone)
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

/** Header row matching EditableRow column layout (incl. action gutter). */
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
}: {
  onDelete: () => void;
  onRemoveFromGroup?: () => void;
  linkedLedger?: string;
  onChangeMapping?: (ledgerName: string, newCode: string) => void;
  subGroups?: { id: string; name: string }[];
  onMoveToGroup?: (groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingSearch, setMappingSearch] = useState("");
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);

  const filteredCodes = FS_CODE_OPTIONS.filter(
    (opt) =>
      opt.label.toLowerCase().includes(mappingSearch.toLowerCase()) ||
      opt.section.toLowerCase().includes(mappingSearch.toLowerCase()) ||
      opt.code.toLowerCase().includes(mappingSearch.toLowerCase()),
  );

  // Group by section for display
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
    <Popover open={open} onOpenChange={setOpen}>
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
        {/* Move to Sub Group */}
        {subGroups && subGroups.length > 0 && onMoveToGroup && (
          <Popover open={groupMenuOpen} onOpenChange={setGroupMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted flex items-center gap-1.5 transition-colors"
              >
                <ChevronDown size={11} className="shrink-0" /> Move to Sub Group
              </button>
            </PopoverTrigger>
            <PopoverContent side="left" align="start" className="w-44 p-1">
              {subGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-purple-50 text-purple-700 flex items-center gap-1.5 transition-colors"
                  onClick={() => { onMoveToGroup(g.id); setGroupMenuOpen(false); setOpen(false); }}
                >
                  <span className="truncate">{g.name || "(unnamed group)"}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
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

/** Renders a single ListTable row plus, when the row has multiple smart-merged
 *  source ledgers, an expandable list showing each source ledger with its
 *  CY/PY amount — so the auditor can see exactly what was bundled into
 *  e.g. "TDS Payable" (TDS 192B + TDS 194I + TDS 194C + ...). */
function ListRowWithSources({
  r, origIdx, isLinked, isManual, hasSources, descPlaceholder, update, remove,
  onChangeMapping, subGroups, onMoveToGroup,
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
  onMoveToGroup?: (i: number, groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="grid grid-cols-12 gap-2 items-center">
        <div className="col-span-6 flex items-center gap-1.5">
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
              title={r.linked_ledger ? `Linked from COA ledger: ${r.linked_ledger}` : "Linked from COA mapping"}
              className="shrink-0 inline-flex items-center px-1 py-[1px] rounded text-[8px] font-semibold uppercase tracking-wide border border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
            >
              Linked
            </span>
          )}
          {isManual && (
            <span
              title="Manually entered — re-sync from COA will not change this row"
              className="shrink-0 inline-flex items-center px-1 py-[1px] rounded text-[8px] font-semibold uppercase tracking-wide border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
            >
              Manual
            </span>
          )}
        </div>
        <div className="col-span-3">
          <EditableCell
            value={r.amount_cy ?? 0}
            isAutoFilled={isLinked}
            isOverridden={isManual && (r.amount_cy ?? 0) !== 0}
            onCommit={(v) => update(origIdx, { amount_cy: v == null ? 0 : Number(v) })}
          />
        </div>
        <div className="col-span-2">
          <EditableCell
            value={r.amount_py ?? 0}
            isAutoFilled={isLinked}
            isOverridden={isManual && (r.amount_py ?? 0) !== 0}
            onCommit={(v) => update(origIdx, { amount_py: v == null ? 0 : Number(v) })}
          />
        </div>
        <div className="col-span-1 flex justify-end">
          <ListRowActionsMenu
            onDelete={() => remove(origIdx)}
            linkedLedger={r.linked_ledger}
            onChangeMapping={onChangeMapping}
            subGroups={subGroups}
            onMoveToGroup={onMoveToGroup ? (groupId) => onMoveToGroup(origIdx, groupId) : undefined}
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

/**
 * ListTable — managed list of {description, amount_cy, amount_py} rows.
 * Used for note line-items where the user adds rows freely (e.g. ledger
 * break-ups under a note). Persisted as an array under a single dot-path.
 *
 * Row provenance:
 *   - source = "linked" — auto-built from a COA-mapped ledger; row shows a
 *     small "Linked" badge and renders the description / amount in the
 *     blue auto-fill tint.
 *   - source = "manual" — user-typed row (or a linked row the user has
 *     edited). Renders in the amber override tint. Re-sync from COA never
 *     overwrites manual rows.
 *   - source = undefined — legacy rows from before the breakup was wired
 *     to COA mapping. Treated as manual (preserved on re-sync).
 *
 * Editing the description or either amount of a "linked" row flips it to
 * "manual" automatically (and clears `linked_ledger`).
 */
export interface ListRow {
  description?:    string;
  amount_cy?:      number;
  amount_py?:      number;
  source?:         "linked" | "manual";
  linked_ledger?:  string;
  subgroup_id?:    string;
  /** When this row consolidates multiple TB ledgers (smart-merge — e.g.
   *  "TDS Payable" rolling up TDS 192B / 194I / 194C), this lists the
   *  underlying ledgers + amounts. The "i" expander reveals them. */
  sources?: { ledger: string; amount_cy: number; amount_py: number }[];
}

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
  /**
   * When true, a read-only "Sub-total" row is rendered below the items
   * whenever there are ≥ 2 rows. Useful when multiple auto-linked ledgers
   * (e.g. "Sand Purchase 5%", "Steel Purchase 18%") appear under the same
   * note — the user can see their combined value at a glance.
   */
  showSubtotal?:    boolean;
  onRemapLedger?:   (ledgerName: string, newCode: string) => void;
}) {
  const [dragRow,     setDragRow]     = useState<number | null>(null);
  const [dragOverRow, setDragOverRow] = useState<number | null>(null);

  // Patch a row. If the row is currently "linked" and the user touched any
  // user-visible field (description / amount), flip it to "manual" and
  // drop the linked_ledger so re-sync from COA leaves it alone.
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
      ...(flipsToManual ? { source: "manual", linked_ledger: undefined } : {}),
    };
    onChange(next);
  };
  const remove = (i: number) => {
    const next = rows.slice();
    next.splice(i, 1);
    onChange(next);
  };
  const add = () => onChange([
    ...rows,
    { description: "", amount_cy: 0, amount_py: 0, source: "manual" },
  ]);

  const moveToGroup = (i: number, groupId: string) => {
    const next = rows.slice();
    next[i] = { ...next[i], subgroup_id: groupId };
    onChange(next);
  };

  // Drag & drop handlers
  const handleDragStart = (origIdx: number) => setDragRow(origIdx);
  const handleDragOver  = (e: React.DragEvent, origIdx: number) => {
    e.preventDefault();
    setDragOverRow(origIdx);
  };
  const handleDrop = (origIdx: number) => {
    if (dragRow === null || dragRow === origIdx) {
      setDragRow(null); setDragOverRow(null);
      return;
    }
    const next = rows.slice();
    const [moved] = next.splice(dragRow, 1);
    next.splice(origIdx, 0, moved);
    onChange(next);
    setDragRow(null); setDragOverRow(null);
  };
  const handleDragEnd = () => { setDragRow(null); setDragOverRow(null); };

  // Compute subGroups from rows (rows with a subgroup_id act as group anchors)
  const subGroups = rows
    .filter((r) => r.subgroup_id)
    .reduce<{ id: string; name: string }[]>((acc, r) => {
      const id = r.subgroup_id!;
      if (!acc.find((g) => g.id === id)) {
        acc.push({ id, name: r.description ?? id });
      }
      return acc;
    }, []);

  // Issue 3: hide linked rows where both years are zero — they clutter the note
  // without adding information. Manual rows (user-added) are always shown so
  // the user can see and edit what they typed, even if still at zero.
  const displayRows = rows.filter(
    (r) => r.source !== "linked" || (r.amount_cy || 0) !== 0 || (r.amount_py || 0) !== 0,
  );

  return (
    <div className="space-y-1">
      {displayRows.length === 0 && (
        <div className="text-[10px] italic text-muted-foreground py-1">No entries yet.</div>
      )}
      {displayRows.map((r, i) => {
        const isLinked = r.source === "linked";
        const isManual = r.source === "manual";
        const hasSources = Array.isArray(r.sources) && r.sources.length > 1;
        // Map display index back to original rows array for edits/deletes
        const origIdx = rows.indexOf(r);
        return (
          <div
            key={i}
            draggable
            onDragStart={() => handleDragStart(origIdx)}
            onDragOver={(e) => handleDragOver(e, origIdx)}
            onDrop={() => handleDrop(origIdx)}
            onDragEnd={handleDragEnd}
            className={dragOverRow === origIdx ? "ring-1 ring-primary rounded" : undefined}
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
              subGroups={subGroups.length > 0 ? subGroups : undefined}
              onMoveToGroup={moveToGroup}
            />
          </div>
        );
      })}

      {/* Sub-total row — shown when showSubtotal=true and ≥ 2 rows exist */}
      {showSubtotal && displayRows.length >= 2 && (() => {
        const totalCY = displayRows.reduce((s, r) => s + (r.amount_cy ?? 0), 0);
        const totalPY = displayRows.reduce((s, r) => s + (r.amount_py ?? 0), 0);
        return (
          <div className="grid grid-cols-12 gap-2 items-center border-t border-muted pt-1 mt-0.5">
            <div className="col-span-6 text-[10px] font-semibold text-muted-foreground">Sub-total</div>
            <div className="col-span-3 text-right text-[10px] font-semibold tabular-nums pr-1">{formatINR(totalCY)}</div>
            <div className="col-span-2 text-right text-[10px] font-semibold tabular-nums pr-1">{formatINR(totalPY)}</div>
            <div className="col-span-1" />
          </div>
        );
      })()}

      <Button
        type="button" variant="outline" size="sm"
        onClick={add}
        className="h-6 text-[10px] gap-1 mt-1"
      >
        <Plus size={11} /> {addLabel}
      </Button>
    </div>
  );
}

/**
 * AgeingTable — fixed-schema 4 rows × 5 cols schedule used for
 * Trade Payables (MSME / Others / Disputed-MSME / Disputed-Others) and
 * Trade Receivables (Undisputed-good / Undisputed-doubtful / Disputed-good /
 * Disputed-doubtful). Row labels + column headers are caller-supplied so
 * one component covers both shapes.
 */
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
