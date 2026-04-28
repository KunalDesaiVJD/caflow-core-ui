/**
 * Worksheet — Sheet 4 "AUDIT WORK SHEET"  (Phase 1 — Vouching 2.0)
 *
 * Phase 1 additions:
 *   • Multi-period rows per book — different staff, extents & dates per period
 *   • Per-period status toggle (Pending / Done / N/A)
 *   • Sign-off completion tracker in header (books complete + periods done)
 *   • Inline "Raise Query" button on every period and book header
 *   • Backward-compatible: books with no periods render the legacy single-row UI
 *
 * Column layout (7 cols):
 *   Sr | Name of Books | Extent of Check | Date | Assigned To | Status | Actions
 */
import React from "react";
import { cn } from "@/lib/utils";
import { Button }    from "@/components/ui/button";
import { Input }     from "@/components/ui/input";
import { Textarea }  from "@/components/ui/textarea";
import { Badge }     from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Save, Loader2, ClipboardList, Plus, Trash2,
  MessageSquareWarning, CheckCircle2,
} from "lucide-react";

import {
  useWorksheetSheetStorage,
  type VouchingPeriod,
} from "./hooks/useWorksheetSheetStorage";
import { useEmployeeDropdown }     from "./hooks/useEmployeeDropdown";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

// ─── Row definitions (unchanged) ─────────────────────────────────────────────

type ExtentType = "range" | "as_on";

interface RowDef {
  id:          string;
  sr:          string;
  label:       string;
  extentType:  ExtentType;
  subNote?:    string;
  optional?:   boolean;
}

const WORKSHEET_ROWS: RowDef[] = [
  { id: "purchase",         sr: "1",  label: "PURCHASE REGISTER",      extentType: "range" },
  { id: "sales",            sr: "2",  label: "SALES REGISTER",         extentType: "range" },
  { id: "cash_book",        sr: "3",  label: "CASH BOOK",              extentType: "range" },
  { id: "bank_book",        sr: "4",  label: "BANK BOOK",              extentType: "as_on" },
  { id: "journal",          sr: "5",  label: "JOURNAL",                extentType: "range" },
  { id: "expenses",         sr: "6",  label: "EXPENSES / SAL / WAGES", extentType: "range" },
  { id: "contra",           sr: "7",  label: "CONTRA",                 extentType: "range" },
  {
    id: "opening_balances", sr: "8",  label: "OPENING BALANCES",       extentType: "as_on",
    subNote: "(Check With Previous Year Physical Audit Report Copy)",
  },
  { id: "others",           sr: "9",  label: "OTHERS",                 extentType: "as_on", optional: true },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function expandFY(fy: string): string {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return fy;
  const y = parseInt(m[1]);
  return `${y}-${y + 1}`;
}

function periodIsDone(p: VouchingPeriod) {
  return p.status === "done" || p.status === "na";
}

// ─── Multi-select employee chip picker (unchanged from Phase 0) ───────────────

function MultiEmpSelect({
  ids, names, onChange, employees,
}: {
  ids:       string[];
  names:     string[];
  onChange:  (ids: string[], names: string[]) => void;
  employees: { id: string; name: string | null; role: string | null }[];
}) {
  const unselected = employees.filter(e => !ids.includes(e.id));

  function add(empId: string) {
    const emp = employees.find(e => e.id === empId);
    if (!emp || ids.includes(empId)) return;
    onChange([...ids, empId], [...names, emp.name || ""]);
  }
  function remove(empId: string) {
    const idx = ids.indexOf(empId);
    if (idx === -1) return;
    onChange(ids.filter(x => x !== empId), names.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-1 min-w-[130px]">
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ids.map((id, i) => (
            <span
              key={id}
              className="inline-flex items-center gap-0.5 bg-teal-100 text-teal-800
                         text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            >
              {names[i] || "—"}
              <button
                type="button"
                onClick={() => remove(id)}
                className="ml-0.5 text-teal-600 hover:text-red-600 leading-none"
                aria-label={`Remove ${names[i]}`}
              >×</button>
            </span>
          ))}
        </div>
      )}
      {unselected.length > 0 && (
        <Select value="" onValueChange={add}>
          <SelectTrigger className="h-6 text-[10px] w-full border-dashed">
            <SelectValue placeholder={ids.length === 0 ? "Assign…" : "+ Add checker…"} />
          </SelectTrigger>
          <SelectContent>
            {unselected.map(e => (
              <SelectItem key={e.id} value={e.id} className="text-xs">
                {e.name || "—"}{e.role ? ` · ${e.role}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

// ─── Period status 3-way mini-toggle ─────────────────────────────────────────

function PeriodStatusToggle({
  status, onChange,
}: {
  status:   VouchingPeriod["status"];
  onChange: (s: VouchingPeriod["status"]) => void;
}) {
  const opts = [
    {
      v: "pending" as const, label: "Pending",
      active: "bg-amber-100 text-amber-700 border-amber-300",
    },
    {
      v: "done" as const, label: "✓ Done",
      active: "bg-green-100 text-green-700 border-green-300",
    },
    {
      v: "na" as const, label: "N/A",
      active: "bg-slate-100 text-slate-500 border-slate-300",
    },
  ] as const;

  return (
    <div className="inline-flex rounded border overflow-hidden">
      {opts.map(({ v, label, active }) => (
        <button
          key={v}
          type="button"
          title={v === "pending" ? "Mark as Pending" : v === "done" ? "Mark as Done" : "Mark as N/A"}
          onClick={() => onChange(v)}
          className={cn(
            "px-1.5 py-0.5 text-[10px] font-medium transition-colors border-r last:border-r-0",
            status === v ? active : "text-muted-foreground hover:bg-muted/40",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Per-book completion badge ────────────────────────────────────────────────

function CompletionBadge({ periods }: { periods: VouchingPeriod[] }) {
  if (periods.length === 0) return null;
  const done  = periods.filter(periodIsDone).length;
  const total = periods.length;
  const allDone = done === total;

  return (
    <span
      className={cn(
        "ml-2 inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
        allDone
          ? "bg-green-100 text-green-700"
          : done > 0
          ? "bg-amber-100 text-amber-700"
          : "bg-muted text-muted-foreground",
      )}
    >
      {allDone ? "✓ " : ""}{done}/{total}
    </span>
  );
}

// ─── Extent input (shared between legacy row and period row) ──────────────────

function ExtentInput({
  extentType, extentText, extentDate,
  onText, onDate,
}: {
  extentType: ExtentType;
  extentText: string;
  extentDate: string;
  onText:     (v: string) => void;
  onDate:     (v: string) => void;
}) {
  if (extentType === "range") {
    return (
      <Input
        className="h-7 text-xs font-mono w-full"
        placeholder="MM/YY  TO  MM/YY"
        value={extentText}
        onChange={e => onText(e.target.value)}
      />
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap">
        AS ON
      </span>
      <Input
        type="date"
        className="h-7 text-xs flex-1 min-w-[100px]"
        value={extentDate}
        onChange={e => onDate(e.target.value)}
      />
    </div>
  );
}

// ─── Table rows for one book (book-header + period sub-rows + notes) ──────────

interface BookRowsProps {
  row:           RowDef;
  employees:     { id: string; name: string | null; role: string | null }[];
  getRow:        (id: string) => ReturnType<ReturnType<typeof useWorksheetSheetStorage>["getRow"]>;
  setRowField:   ReturnType<typeof useWorksheetSheetStorage>["setRowField"];
  patchRow:      ReturnType<typeof useWorksheetSheetStorage>["patchRow"];
  addPeriod:     ReturnType<typeof useWorksheetSheetStorage>["addPeriod"];
  updatePeriod:  ReturnType<typeof useWorksheetSheetStorage>["updatePeriod"];
  removePeriod:  ReturnType<typeof useWorksheetSheetStorage>["removePeriod"];
  onRaiseQuery?: (group: string, ledger: string, note?: string) => void;
}

function BookRows({
  row, employees, getRow, setRowField, patchRow,
  addPeriod, updatePeriod, removePeriod, onRaiseQuery,
}: BookRowsProps) {
  const rs          = getRow(row.id);
  const hasPeriods  = rs.periods.length > 0;

  const raiseForPeriod = (period?: VouchingPeriod) => {
    const extentStr = period
      ? (period.extent_text || period.extent_date || "")
      : (rs.extent_text || rs.extent_date || "");
    const note = period
      ? `[Vouching] ${row.label} • ${period.period_label}${extentStr ? ` • ${extentStr}` : ""}`
      : `[Vouching] ${row.label}`;
    onRaiseQuery?.(row.label, "", note);
  };

  return (
    <>
      {/* ── Book header row ───────────────────────────────────────────── */}
      <tr className="bg-slate-50/70 hover:bg-slate-50 transition-colors">
        {/* Sr */}
        <td className="border border-border px-2 py-2 text-center align-middle w-10">
          <span className="text-xs font-mono font-semibold text-muted-foreground">
            {row.sr}
          </span>
        </td>

        {/* Name */}
        <td className={cn(
          "border border-border px-3 py-2 align-middle",
          hasPeriods ? "" : "min-w-[160px]",
        )}>
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-bold text-xs uppercase tracking-wide text-foreground">
              {row.label}
            </span>
            {row.optional && (
              <span className="text-[10px] font-normal normal-case text-muted-foreground">
                (optional)
              </span>
            )}
            {hasPeriods && <CompletionBadge periods={rs.periods} />}
          </div>
          {row.subNote && (
            <p className="text-[10px] text-amber-700 italic font-medium mt-0.5">
              {row.subNote}
            </p>
          )}
        </td>

        {hasPeriods ? (
          /* Multi-period mode: span remaining columns with action buttons */
          <td
            colSpan={5}
            className="border border-border px-3 py-2 align-middle"
          >
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] gap-1 text-teal-700 hover:text-teal-800 hover:bg-teal-50"
                onClick={() => addPeriod(row.id)}
              >
                <Plus size={11} /> Add Period
              </Button>
              {onRaiseQuery && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[11px] gap-1 text-amber-700 hover:text-amber-800 hover:bg-amber-50"
                  title="Raise a query for this book"
                  onClick={() => raiseForPeriod()}
                >
                  <MessageSquareWarning size={11} /> Raise Query
                </Button>
              )}
            </div>
          </td>
        ) : (
          /* Legacy mode: show extent / date / assigned-to inline */
          <>
            {/* Extent */}
            <td className="border border-border px-2 py-2 align-middle min-w-[160px]">
              <ExtentInput
                extentType={row.extentType}
                extentText={rs.extent_text}
                extentDate={rs.extent_date}
                onText={v => setRowField(row.id, "extent_text", v)}
                onDate={v => setRowField(row.id, "extent_date", v)}
              />
            </td>
            {/* Date */}
            <td className="border border-border px-2 py-2 align-middle">
              <Input
                type="date"
                className="h-7 text-xs w-full"
                value={rs.date}
                onChange={e => setRowField(row.id, "date", e.target.value)}
              />
            </td>
            {/* Assigned To */}
            <td className="border border-border px-2 py-2 align-middle">
              <MultiEmpSelect
                ids={rs.checked_by_ids ?? []}
                names={rs.checked_by_names ?? []}
                onChange={(ids, names) => patchRow(row.id, {
                  checked_by_ids: ids, checked_by_names: names,
                })}
                employees={employees}
              />
            </td>
            {/* Status — empty in legacy mode */}
            <td className="border border-border px-2 py-2 align-middle">
              <span className="text-[10px] text-muted-foreground italic">—</span>
            </td>
            {/* Actions */}
            <td className="border border-border px-2 py-2 align-middle">
              <div className="flex flex-col gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] gap-1 text-teal-700 hover:text-teal-800 hover:bg-teal-50 w-full justify-start"
                  onClick={() => addPeriod(row.id)}
                  title="Switch to multi-period mode"
                >
                  <Plus size={10} /> Add Period
                </Button>
                {onRaiseQuery && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] gap-1 text-amber-700 hover:text-amber-800 hover:bg-amber-50 w-full justify-start"
                    onClick={() => raiseForPeriod()}
                    title="Raise query for this book"
                  >
                    <MessageSquareWarning size={10} /> Raise Query
                  </Button>
                )}
              </div>
            </td>
          </>
        )}
      </tr>

      {/* ── Period sub-rows ────────────────────────────────────────────── */}
      {hasPeriods && rs.periods.map((period, idx) => (
        <tr
          key={period.id}
          className={cn(
            "transition-colors align-top",
            period.status === "done"
              ? "bg-green-50/40 hover:bg-green-50/60"
              : period.status === "na"
              ? "bg-slate-50/60 hover:bg-slate-50/80"
              : idx % 2 === 0
              ? "bg-white hover:bg-teal-50/20"
              : "bg-slate-50/30 hover:bg-teal-50/20",
          )}
        >
          {/* Sr spacer with tree line */}
          <td className="border-x border-b border-border/50 px-1 py-1.5 text-center">
            <span className="text-[9px] text-muted-foreground/40">└</span>
          </td>

          {/* Period label — small editable input */}
          <td className="border-x border-b border-border/50 px-2 py-1.5">
            <Input
              value={period.period_label}
              onChange={e => updatePeriod(row.id, period.id, { period_label: e.target.value })}
              className="h-6 text-[11px] font-medium w-28 bg-transparent border-dashed
                         focus:border-solid focus:bg-white"
              placeholder="Period label…"
            />
          </td>

          {/* Extent */}
          <td className="border-x border-b border-border/50 px-2 py-1.5">
            <ExtentInput
              extentType={row.extentType}
              extentText={period.extent_text}
              extentDate={period.extent_date}
              onText={v => updatePeriod(row.id, period.id, { extent_text: v })}
              onDate={v => updatePeriod(row.id, period.id, { extent_date: v })}
            />
          </td>

          {/* Date */}
          <td className="border-x border-b border-border/50 px-2 py-1.5">
            <Input
              type="date"
              className="h-7 text-xs w-full"
              value={period.date}
              onChange={e => updatePeriod(row.id, period.id, { date: e.target.value })}
            />
          </td>

          {/* Assigned To */}
          <td className="border-x border-b border-border/50 px-2 py-1.5">
            <MultiEmpSelect
              ids={period.assigned_ids}
              names={period.assigned_names}
              onChange={(ids, names) =>
                updatePeriod(row.id, period.id, { assigned_ids: ids, assigned_names: names })
              }
              employees={employees}
            />
          </td>

          {/* Status toggle */}
          <td className="border-x border-b border-border/50 px-2 py-1.5">
            <PeriodStatusToggle
              status={period.status}
              onChange={s => updatePeriod(row.id, period.id, { status: s })}
            />
          </td>

          {/* Actions */}
          <td className="border-x border-b border-border/50 px-2 py-1.5">
            <div className="flex items-center gap-1">
              {onRaiseQuery && (
                <button
                  type="button"
                  title="Raise query for this period"
                  onClick={() => raiseForPeriod(period)}
                  className="h-6 w-6 flex items-center justify-center rounded
                             text-amber-600 hover:bg-amber-50 transition-colors"
                >
                  <MessageSquareWarning size={13} />
                </button>
              )}
              <button
                type="button"
                title="Remove this period"
                onClick={() => removePeriod(row.id, period.id)}
                className="h-6 w-6 flex items-center justify-center rounded
                           text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </td>
        </tr>
      ))}

      {/* ── Book-level notes sub-row ────────────────────────────────────── */}
      <tr className="bg-muted/5">
        <td className="border-x border-b border-border/40 px-1 py-0.5 text-center">
          <span className="text-[9px] text-muted-foreground/50">↳</span>
        </td>
        <td colSpan={6} className="border-x border-b border-border/40 px-3 py-1">
          <Textarea
            rows={2}
            className={cn(
              "text-xs resize-none bg-transparent border-none shadow-none",
              "focus-visible:ring-0 p-0",
              "placeholder:text-muted-foreground/40 text-muted-foreground",
            )}
            placeholder="Notes / additional remarks for this book…"
            value={rs.notes}
            onChange={e => setRowField(row.id, "notes", e.target.value)}
          />
        </td>
      </tr>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  data:          AuditWorksheetData;
  engagementId:  string;
  onSaved?:      () => void;
  /** Phase 1: navigate to Query Sheet with pre-filled context */
  onRaiseQuery?: (group: string, ledger: string, note?: string) => void;
}

export default function Worksheet({ data, engagementId, onSaved, onRaiseQuery }: Props) {
  const {
    getRow, setRowField, patchRow, manualSave, saving,
    addPeriod, updatePeriod, removePeriod,
  } = useWorksheetSheetStorage(engagementId, data.engagement?.firm_id);

  const { employees } = useEmployeeDropdown();
  const fyExpanded    = expandFY(data.financialYear);

  // ── Completion stats ──────────────────────────────────────────────────────
  const stats = (() => {
    let totalPeriods = 0;
    let donePeriods  = 0;
    let booksComplete = 0;
    let booksWithPeriods = 0;

    for (const row of WORKSHEET_ROWS) {
      const rs = getRow(row.id);
      if (rs.periods.length > 0) {
        booksWithPeriods++;
        totalPeriods += rs.periods.length;
        const doneCount = rs.periods.filter(periodIsDone).length;
        donePeriods += doneCount;
        if (doneCount === rs.periods.length) booksComplete++;
      }
    }
    return { totalPeriods, donePeriods, booksComplete, booksWithPeriods };
  })();

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">

      {/* ══════════ PAGE HEADER ══════════ */}
      <div className="bg-teal-700 text-white px-6 py-4 space-y-0.5">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} />
          <span className="text-base font-semibold tracking-wide">
            {data.firmName || "CA Firm"}
          </span>
        </div>
        <p className="text-[13px] font-bold opacity-95 tracking-widest uppercase">
          {data.auditTypeLabel} — Year {fyExpanded || data.financialYear}
        </p>
      </div>

      {/* Sub-header */}
      <div className="border-b bg-muted/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <div>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mr-1.5">
              Name of Client:
            </span>
            <span className="font-semibold text-foreground">{data.clientName || "—"}</span>
          </div>
          <Badge className="bg-teal-100 text-teal-800 text-xs">AUDIT WORK SHEET</Badge>

          {/* Completion badges */}
          {stats.totalPeriods > 0 ? (
            <>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs gap-1",
                  stats.booksComplete === stats.booksWithPeriods && stats.booksWithPeriods > 0
                    ? "border-green-400 text-green-700 bg-green-50"
                    : "border-amber-400 text-amber-700 bg-amber-50",
                )}
              >
                <CheckCircle2 size={11} />
                {stats.booksComplete}/{stats.booksWithPeriods} books
              </Badge>
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {stats.donePeriods}/{stats.totalPeriods} periods done
              </Badge>
            </>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Click &quot;Add Period&quot; on any book to begin
            </Badge>
          )}
        </div>

        <Button
          size="sm"
          className="gap-1 h-7 text-xs bg-teal-700 hover:bg-teal-800"
          onClick={async () => { await manualSave(); onSaved?.(); }}
          disabled={saving}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save
        </Button>
      </div>

      {/* ══════════ TABLE ══════════ */}
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[860px]">
          <thead>
            <tr className="bg-teal-700 text-white text-[11px] uppercase tracking-wide">
              <th className="border border-teal-600 px-2 py-2.5 text-center w-10">Sr.</th>
              <th className="border border-teal-600 px-3 py-2.5 text-left min-w-[160px]">
                Name of Books
              </th>
              <th className="border border-teal-600 px-3 py-2.5 text-left min-w-[170px]">
                Extent of Check
              </th>
              <th className="border border-teal-600 px-2 py-2.5 text-center min-w-[120px]">
                Date
              </th>
              <th className="border border-teal-600 px-2 py-2.5 text-center min-w-[160px]">
                Assigned To
              </th>
              <th className="border border-teal-600 px-2 py-2.5 text-center min-w-[140px]">
                Status
              </th>
              <th className="border border-teal-600 px-2 py-2.5 text-center w-20">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {WORKSHEET_ROWS.map(row => (
              <BookRows
                key={row.id}
                row={row}
                employees={employees}
                getRow={getRow}
                setRowField={setRowField}
                patchRow={patchRow}
                addPeriod={addPeriod}
                updatePeriod={updatePeriod}
                removePeriod={removePeriod}
                onRaiseQuery={onRaiseQuery}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ══════════ FOOTER ══════════ */}
      <div className="border-t bg-muted/20 px-4 py-2 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {stats.totalPeriods === 0
            ? 'Use "+ Add Period" on any book row to start multi-period vouching'
            : stats.donePeriods === stats.totalPeriods
            ? `✓ All ${stats.totalPeriods} periods signed off`
            : `${stats.totalPeriods - stats.donePeriods} period(s) pending sign-off`
          }
        </p>
        {saving && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> Auto-saving…
          </p>
        )}
      </div>
    </div>
  );
}
