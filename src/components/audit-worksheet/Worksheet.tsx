/**
 * Worksheet — Sheet 4 "AUDIT WORK SHEET"
 *
 * 9 book-category rows, each with:
 *   • Extent of Check  — free text "MM/YY TO MM/YY"  (rows 1-3, 5-7)
 *                        OR  "AS ON" + date picker    (rows 4, 8, 9)
 *   • Date             — date picker (when work was done)
 *   • Checked By       — employee dropdown
 *   • Notes            — 2-3 sub-row textarea for additional remarks
 *
 * Special row 8: Opening Balances
 *   — has sub-note "(Check With Previous Year Physical Audit Report Copy)"
 *
 * Header: '{auditTypeLabel} — YEAR {financialYear}'
 *         'Name of Client: {clientName}'
 *         'AUDIT WORK SHEET'
 */
import React from "react";
import { cn } from "@/lib/utils";
import { Button }    from "@/components/ui/button";
import { Input }     from "@/components/ui/input";
import { Textarea }  from "@/components/ui/textarea";
import { Badge }     from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, ClipboardList } from "lucide-react";

import { useWorksheetSheetStorage } from "./hooks/useWorksheetSheetStorage";
import { useEmployeeDropdown }       from "./hooks/useEmployeeDropdown";
import type { AuditWorksheetData }   from "./hooks/useAuditWorksheetData";

// ─── Row definitions ─────────────────────────────────────────────────────────

type ExtentType = "range" | "as_on";

interface RowDef {
  id:          string;
  sr:          string;
  label:       string;
  extentType:  ExtentType;
  subNote?:    string;       // note shown inside the row (italic text)
  optional?:   boolean;
}

const WORKSHEET_ROWS: RowDef[] = [
  { id: "purchase",         sr: "1", label: "PURCHASE REGISTER",     extentType: "range" },
  { id: "sales",            sr: "2", label: "SALES REGISTER",        extentType: "range" },
  { id: "cash_book",        sr: "3", label: "CASH BOOK",             extentType: "range" },
  { id: "bank_book",        sr: "4", label: "BANK BOOK",             extentType: "as_on" },
  { id: "journal",          sr: "5", label: "JOURNAL",               extentType: "range" },
  { id: "expenses",         sr: "6", label: "EXPENSES / SAL / WAGES",extentType: "range" },
  { id: "contra",           sr: "7", label: "CONTRA",                extentType: "range" },
  {
    id: "opening_balances", sr: "8", label: "OPENING BALANCES",      extentType: "as_on",
    subNote: "(Check With Previous Year Physical Audit Report Copy)",
  },
  {
    id: "others",           sr: "9", label: "OTHERS",                extentType: "as_on",
    optional: true,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function expandFY(fy: string): string {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return fy;
  const y = parseInt(m[1]);
  return `${y}-${y + 1}`;
}

// ─── Employee dropdown ────────────────────────────────────────────────────────

function EmpSelect({
  value, onChange, employees,
}: {
  value:     string;
  onChange:  (id: string, name: string) => void;
  employees: { id: string; name: string | null; role: string | null }[];
}) {
  return (
    <Select
      value={value || "__none__"}
      onValueChange={id => {
        const realId = id === "__none__" ? "" : id;
        const emp = employees.find(e => e.id === realId);
        onChange(realId, emp?.name || "");
      }}
    >
      <SelectTrigger className="h-7 text-xs w-full min-w-[115px]">
        <SelectValue placeholder="Assign…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">— Unassigned —</SelectItem>
        {employees.map(e => (
          <SelectItem key={e.id} value={e.id}>
            {e.name || "—"}{e.role ? ` · ${e.role}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
}

export default function Worksheet({ data, engagementId }: Props) {
  const { getRow, setRowField, patchRow, manualSave, saving } =
    useWorksheetSheetStorage(engagementId, data.engagement?.firm_id);

  const { employees } = useEmployeeDropdown();

  const fyExpanded = expandFY(data.financialYear);

  // Count how many rows have a checked-by assigned
  const assignedCount = WORKSHEET_ROWS.filter(r => {
    const rs = getRow(r.id);
    return !!rs.checked_by_id;
  }).length;

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
        <div className="flex flex-wrap gap-6 items-center text-sm">
          <div>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mr-1.5">
              Name of Client:
            </span>
            <span className="font-semibold text-foreground">{data.clientName || "—"}</span>
          </div>
          <Badge className="bg-teal-100 text-teal-800 text-xs">
            AUDIT WORK SHEET
          </Badge>
          <Badge variant="outline" className="text-xs">
            {assignedCount}/{WORKSHEET_ROWS.length} rows assigned
          </Badge>
        </div>
        <Button
          size="sm"
          className="gap-1 h-7 text-xs bg-teal-700 hover:bg-teal-800"
          onClick={manualSave}
          disabled={saving}
        >
          {saving
            ? <Loader2 size={12} className="animate-spin" />
            : <Save size={12} />
          }
          Save
        </Button>
      </div>

      {/* ══════════ TABLE ══════════ */}
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[720px]">
          <thead>
            <tr className="bg-teal-700 text-white text-[11px] uppercase tracking-wide">
              <th className="border border-teal-600 px-2 py-2.5 text-center w-12">Sr.</th>
              <th className="border border-teal-600 px-3 py-2.5 text-left min-w-[180px]">Name of Books</th>
              <th className="border border-teal-600 px-3 py-2.5 text-left min-w-[200px]">Extent of Check</th>
              <th className="border border-teal-600 px-2 py-2.5 text-center min-w-[130px]">Date</th>
              <th className="border border-teal-600 px-2 py-2.5 text-center min-w-[140px]">Checked By</th>
            </tr>
          </thead>
          <tbody>
            {WORKSHEET_ROWS.map(row => {
              const rs = getRow(row.id);

              return (
                <React.Fragment key={row.id}>
                  {/* ── Main Row ── */}
                  <tr className="align-top hover:bg-muted/10 transition-colors">
                    {/* Sr.No */}
                    <td className="border border-border px-2 py-2 text-center align-middle">
                      <span className="text-xs font-mono text-muted-foreground">
                        {row.sr}
                      </span>
                    </td>

                    {/* Name of Books */}
                    <td className="border border-border px-3 py-2 align-middle">
                      <div className="space-y-0.5">
                        <p className="font-semibold text-xs uppercase tracking-wide text-foreground">
                          {row.label}
                          {row.optional && (
                            <span className="ml-1 text-[10px] font-normal normal-case text-muted-foreground">
                              (optional)
                            </span>
                          )}
                        </p>
                        {row.subNote && (
                          <p className="text-[10px] text-amber-700 italic font-medium">
                            {row.subNote}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Extent of Check */}
                    <td className="border border-border px-2 py-2 align-middle">
                      {row.extentType === "range" ? (
                        <Input
                          className="h-7 text-xs font-mono w-full"
                          placeholder="MM/YY  TO  MM/YY"
                          value={rs.extent_text}
                          onChange={e => setRowField(row.id, "extent_text", e.target.value)}
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap flex-shrink-0">
                            AS ON
                          </span>
                          <Input
                            type="date"
                            className="h-7 text-xs flex-1 min-w-[110px]"
                            value={rs.extent_date}
                            onChange={e => setRowField(row.id, "extent_date", e.target.value)}
                          />
                        </div>
                      )}
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

                    {/* Checked By */}
                    <td className="border border-border px-2 py-2 align-middle">
                      <EmpSelect
                        value={rs.checked_by_id}
                        onChange={(id, name) =>
                          patchRow(row.id, { checked_by_id: id, checked_by_name: name })
                        }
                        employees={employees}
                      />
                      {rs.checked_by_name && (
                        <p className="text-[10px] text-teal-700 mt-0.5 font-medium truncate">
                          ✓ {rs.checked_by_name}
                        </p>
                      )}
                    </td>
                  </tr>

                  {/* ── Notes Sub-row ── */}
                  <tr
                    key={`${row.id}_notes`}
                    className="bg-muted/5"
                  >
                    <td className="border-x border-b border-border/40 px-1 py-0.5 text-center">
                      <span className="text-[9px] text-muted-foreground/50">↳</span>
                    </td>
                    <td
                      colSpan={4}
                      className="border-x border-b border-border/40 px-3 py-1"
                    >
                      <Textarea
                        rows={2}
                        className={cn(
                          "text-xs resize-none bg-transparent border-none shadow-none focus-visible:ring-0 p-0",
                          "placeholder:text-muted-foreground/40 text-muted-foreground"
                        )}
                        placeholder="Notes / additional remarks for this book…"
                        value={rs.notes}
                        onChange={e => setRowField(row.id, "notes", e.target.value)}
                      />
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ══════════ FOOTER ══════════ */}
      <div className="border-t bg-muted/20 px-4 py-2 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {assignedCount === WORKSHEET_ROWS.length
            ? "✓ All books assigned to team members"
            : `${WORKSHEET_ROWS.length - assignedCount} book(s) not yet assigned`
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
