/**
 * SpecialAttention — Sheet 3
 * "Advanced Checklist For Tax & Statutory Auditing"
 *
 * CONDITIONAL RENDERING (Req #3):
 * Hidden (not just disabled) for any entity that is NOT Private Ltd / Public Ltd.
 * The parent (AuditWorksheetPage) is responsible for the visibility guard.
 *
 * Table columns:
 *   Sr.No | Particulars | Checked By | Verified By | Query Y/N | Remarks | Documents
 *
 * 10 main checklist items with sub-points, exactly from Excel.
 * All hardcoded years are derived dynamically from engagement.financial_year (Req #4).
 */
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button }    from "@/components/ui/button";
import { Input }     from "@/components/ui/input";
import { Textarea }  from "@/components/ui/textarea";
import { Badge }     from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, Building2, Plus, Trash2 } from "lucide-react";

import { useSpecialAttentionStorage, type AuditorEntry } from "./hooks/useSpecialAttentionStorage";
import { useEmployeeDropdown }         from "./hooks/useEmployeeDropdown";
import type { AuditWorksheetData }     from "./hooks/useAuditWorksheetData";
import { awLoad }                      from "@/lib/awStorage";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChecklistRow {
  id:         string;
  sr:         string;
  particulars: string;       // may use {fyEnd} placeholder
  documents?: string;
  isSection:  boolean;       // true = dark header row, no interactive cols
  indent:     boolean;       // true = sub-item (indented text)
}

// ─── Static checklist definition ─────────────────────────────────────────────
// {fyEnd} is replaced at render time with the actual end-year of the FY.

const CHECKLIST: ChecklistRow[] = [
  // ── 1 ──
  {
    id: "1", sr: "1",
    particulars: "Changes in Profit & Loss ratio of Partner or Shareholding",
    documents: "Copy of Partnership Deed / Shareholder Register",
    isSection: false, indent: false,
  },

  // ── 2 — TDS Payable ──
  {
    id: "2", sr: "2",
    particulars: "TDS Payable Checking",
    isSection: true, indent: false,
  },
  {
    id: "2_1", sr: "2.1",
    particulars: "TDS payable at end of quarter verified with Q4 return & challan paid after 31.03.{fyEnd}",
    documents: "TDS return copy, TDS challan paid after March end",
    isSection: false, indent: true,
  },
  {
    id: "2_2", sr: "2.2",
    particulars: "Bifurcation of TDS by section-wise",
    documents: "Verification of 26Q / 24Q",
    isSection: false, indent: true,
  },
  {
    id: "2_3", sr: "2.3",
    particulars: "Interest on late TDS payment and return filing dates",
    documents: "TDS acknowledgement copy, Interest amount",
    isSection: false, indent: true,
  },
  {
    id: "2_4", sr: "2.4",
    particulars: "Scrutiny of each TDS ledger",
    isSection: false, indent: true,
  },

  // ── 3 — TDS Receivable ──
  {
    id: "3", sr: "3",
    particulars: "TDS Receivable Checking — 26AS reconciliation with P&L income and Balance Sheet TDS receivable",
    documents: "Copy of 26AS, Ledger of TDS receivable",
    isSection: false, indent: false,
  },

  // ── 4 — Chapter-VIA ──
  {
    id: "4", sr: "4",
    particulars: "Deduction under Chapter-VIA — List of deductions section-wise",
    documents: "Receipts / proof of all deductions claimed",
    isSection: false, indent: false,
  },

  // ── 5 — Related Party ──
  {
    id: "5", sr: "5",
    particulars: "Related Party Transactions — List with Name, Relationship, PAN, Nature of Payment",
    documents: "Format as specified in audit report (AS-18 / Ind AS 24)",
    isSection: false, indent: false,
  },

  // ── 6 — Unsecured Loan ──
  {
    id: "6", sr: "6",
    particulars: "Details of Unsecured Loan — List with PAN & Address; verify mode of payment",
    documents: "Format as specified in audit report",
    isSection: false, indent: false,
  },

  // ── 7 — Secured Loan ──
  {
    id: "7", sr: "7",
    particulars: "Details of Secured Loan",
    isSection: true, indent: false,
  },
  {
    id: "7_1", sr: "7.1",
    particulars: "Whether interest on secured loan charged to expenses",
    isSection: false, indent: true,
  },
  {
    id: "7_2", sr: "7.2",
    particulars: "Whether TDS deducted on interest (applicable for NBFC loans)",
    documents: "Verification of Loan Statement",
    isSection: false, indent: true,
  },

  // ── 8 — GST ──
  {
    id: "8", sr: "8",
    particulars: "GST",
    isSection: true, indent: false,
  },
  {
    id: "8_1", sr: "8.1",
    particulars: "GST offset entries verified",
    isSection: false, indent: true,
  },
  {
    id: "8_2", sr: "8.2",
    particulars: "CGST / SGST / IGST credit & payable verification",
    documents: "GST challan paid after {fyEnd}-03-31",
    isSection: false, indent: true,
  },
  {
    id: "8_3", sr: "8.3",
    particulars: "ITC match with electronic credit ledger",
    documents: "Verify with GSTR-3B",
    isSection: false, indent: true,
  },

  // ── 9 — Manufacturing ──
  {
    id: "9", sr: "9",
    particulars: "Manufacturing Unit Details (Only for Manufacturing Companies) — " +
      "Opening Qty (RM / FG), Qty Purchased / Produced, Qty Sold / Consumed, Closing Qty",
    isSection: false, indent: false,
  },

  // ── 10 — Pvt Ltd / Ltd specifics ──
  {
    id: "10", sr: "10",
    particulars: "Private Limited / Limited Company — Specific Audit Points",
    isSection: true, indent: false,
  },
  {
    id: "10_1", sr: "10.1",
    particulars: "Unsecured loan taken and repaid during the year",
    isSection: false, indent: true,
  },
  {
    id: "10_2", sr: "10.2",
    particulars: "Loans given to shareholders during the year",
    isSection: false, indent: true,
  },
  {
    id: "10_3", sr: "10.3",
    particulars: "Remuneration paid to Directors",
    documents: "Board / Shareholders Resolutions",
    isSection: false, indent: true,
  },
  {
    id: "10_4", sr: "10.4",
    particulars: "Change of Registered Office",
    documents: "Board / Shareholders Resolutions",
    isSection: false, indent: true,
  },
  {
    id: "10_5", sr: "10.5",
    particulars: "Change in authorized / paid-up share capital",
    documents: "Board Resolutions + Updated shareholder list",
    isSection: false, indent: true,
  },
  {
    id: "10_6", sr: "10.6",
    particulars: "Related party transactions (AS-18 / Ind AS 24 compliance)",
    isSection: false, indent: true,
  },
  {
    id: "10_7", sr: "10.7",
    particulars: "Pending disputes / litigations with government authorities",
    isSection: false, indent: true,
  },
  {
    id: "10_8", sr: "10.8",
    particulars: "CARO clauses — specifically clauses 11, 13 & 15",
    documents: "Written answers to each CARO reporting point from management",
    isSection: false, indent: true,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** "2024-25" → { start: "2024", end: "2025" } */
function fyYears(fy: string): { start: string; end: string } {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return { start: "", end: "" };
  const s = parseInt(m[1]);
  return { start: String(s), end: String(s + 1) };
}

function injectYear(text: string, fyEnd: string): string {
  return text.replaceAll("{fyEnd}", fyEnd);
}

function expandFY(fy: string): string {
  const { start, end } = fyYears(fy);
  return start && end ? `${start}-${end}` : fy;
}

// ─── Sub-component: Employee dropdown ────────────────────────────────────────

function EmpSelect({
  value, onChange, employees, placeholder = "Select…",
}: {
  value:      string;
  onChange:   (id: string, name: string) => void;
  employees:  { id: string; name: string | null; role: string | null }[];
  placeholder?: string;
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
      <SelectTrigger className="h-7 text-xs min-w-[110px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">—</SelectItem>
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
  data:          AuditWorksheetData;
  engagementId:  string;
  /** Issue #10: When true (tax_audit for non-corporate entity),
   *  hide section 10 "Private Ltd / Ltd Company — Specific Audit Points" */
  taxAuditMode?: boolean;
}

export default function SpecialAttention({ data, engagementId, taxAuditMode = false }: Props) {
  const {
    data: m, setHeader, setRowField, patchRow, getRow,
    manualSave, saving, loaded,
  } = useSpecialAttentionStorage(engagementId, data.engagement?.firm_id);

  const { employees } = useEmployeeDropdown();

  // #3 — Auto-fetch Audit Carried Out By from master (statutory → tax fallback)
  // One-way: only fills when the Special Attention list is empty (user override preserved)
  useEffect(() => {
    if (!loaded) return;
    if (m.audit_carried_by.length > 0) return; // user has data — don't overwrite

    const statutory = awLoad<{ audit_carried_by?: AuditorEntry[] }>(engagementId, "statutory_master_json");
    const tax       = awLoad<{ audit_carried_by?: AuditorEntry[] }>(engagementId, "tax_master_json");

    const source =
      (statutory?.audit_carried_by?.filter(e => e.id).length ?? 0) > 0
        ? statutory!.audit_carried_by!
        : (tax?.audit_carried_by?.filter(e => e.id).length ?? 0) > 0
          ? tax!.audit_carried_by!
          : null;

    if (source) setHeader({ audit_carried_by: source });
  }, [loaded, engagementId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { end: fyEnd } = fyYears(data.financialYear);
  const fyExpanded     = expandFY(data.financialYear);

  // Resolve checklist with dynamic year substitution.
  // Issue #10: In taxAuditMode, exclude section 10 (Private Ltd / Ltd specific points).
  const rows = CHECKLIST
    .filter(r => !taxAuditMode || !r.id.startsWith("10"))
    .map(r => ({
      ...r,
      particulars: injectYear(r.particulars, fyEnd),
      documents:   r.documents ? injectYear(r.documents, fyEnd) : undefined,
    }));

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">

      {/* ══════════ PAGE HEADER ══════════ */}
      <div className="bg-indigo-700 text-white px-6 py-4 space-y-1">
        <div className="flex items-center gap-2">
          <Building2 size={18} />
          <h2 className="text-lg font-bold tracking-wide">
            {data.firmName || "CA Firm"}
          </h2>
        </div>
        <p className="text-[13px] font-semibold opacity-90 tracking-wide">
          Advanced Checklist For Tax &amp; Statutory Auditing
        </p>
      </div>

      {/* ══════════ SUB-HEADER ══════════ */}
      <div className="border-b bg-muted/30 px-4 py-3 space-y-3">
        {/* Assessee + FY */}
        <div className="flex flex-wrap gap-6 items-end">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">
              Assessee's Name
            </p>
            <p className="font-semibold text-sm text-foreground">
              {data.clientName || "—"}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">
              Financial Year
            </p>
            <Badge variant="outline" className="text-xs font-mono">
              {fyExpanded || data.financialYear || "—"}
            </Badge>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              className="gap-1 h-7 text-xs bg-indigo-700 hover:bg-indigo-800"
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
        </div>

        {/* Audit Carried Out By — dynamic list */}
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            Audit Carried Out By
          </p>
          {(m.audit_carried_by.length === 0 ? [{ id: "", name: "" }] : m.audit_carried_by)
            .map((entry: AuditorEntry, idx: number) => (
              <div key={idx} className="flex items-center gap-2">
                <EmpSelect
                  value={entry.id}
                  placeholder={`Select auditor ${idx + 1}…`}
                  onChange={(id, name) => {
                    const updated = [...(m.audit_carried_by.length === 0 ? [{ id: "", name: "" }] : m.audit_carried_by)];
                    updated[idx] = { id, name };
                    setHeader({ audit_carried_by: updated });
                  }}
                  employees={employees}
                />
                {entry.name && (
                  <span className="text-[11px] text-indigo-700 font-medium whitespace-nowrap">
                    ✓ {entry.name}
                  </span>
                )}
                {(m.audit_carried_by.length > 1) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                    onClick={() =>
                      setHeader({ audit_carried_by: m.audit_carried_by.filter((_: AuditorEntry, i: number) => i !== idx) })
                    }
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50 mt-1"
            onClick={() =>
              setHeader({
                audit_carried_by: [
                  ...(m.audit_carried_by.length === 0 ? [{ id: "", name: "" }] : m.audit_carried_by),
                  { id: "", name: "" },
                ],
              })
            }
          >
            <Plus size={12} /> Add Auditor
          </Button>
        </div>
      </div>

      {/* ══════════ CHECKLIST TABLE ══════════ */}
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-indigo-700 text-white text-[11px] uppercase tracking-wide">
              <th className="border border-indigo-600 px-2 py-2 text-center w-12">Sr.</th>
              <th className="border border-indigo-600 px-3 py-2 text-left min-w-[260px]">Particulars</th>
              <th className="border border-indigo-600 px-2 py-2 text-center min-w-[120px]">Checked By</th>
              <th className="border border-indigo-600 px-2 py-2 text-center min-w-[130px]">Verified By (Sr. Head)</th>
              <th className="border border-indigo-600 px-2 py-2 text-center w-24">Query?</th>
              <th className="border border-indigo-600 px-2 py-2 text-left min-w-[150px]">Query / Remarks</th>
              <th className="border border-indigo-600 px-2 py-2 text-left min-w-[180px]">Documents to Verify</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              if (row.isSection) {
                // ── Section header row ──
                return (
                  <tr key={row.id} className="bg-indigo-50">
                    <td className="border border-indigo-200 px-2 py-1.5 text-center text-xs font-bold text-indigo-800">
                      {row.sr}
                    </td>
                    <td
                      colSpan={6}
                      className="border border-indigo-200 px-3 py-1.5 font-bold text-[12px] text-indigo-800 uppercase tracking-wide"
                    >
                      {row.particulars}
                    </td>
                  </tr>
                );
              }

              // ── Interactive item row ──
              const rs = getRow(row.id);

              return (
                <tr
                  key={row.id}
                  className={cn(
                    "hover:bg-muted/20 transition-colors",
                    rs.query === "yes" && "bg-amber-50"
                  )}
                >
                  {/* Sr.No */}
                  <td className="border border-border px-2 py-1.5 text-center text-xs font-mono text-muted-foreground align-top">
                    {row.sr}
                  </td>

                  {/* Particulars */}
                  <td className="border border-border px-3 py-1.5 align-top">
                    <p className={cn(
                      "text-sm leading-snug",
                      row.indent && "ml-3 pl-2 border-l-2 border-indigo-200"
                    )}>
                      {row.particulars}
                    </p>
                  </td>

                  {/* Checked By */}
                  <td className="border border-border px-2 py-1.5 align-top">
                    <EmpSelect
                      value={rs.checked_by_id}
                      placeholder="Checked by…"
                      onChange={(id, name) => patchRow(row.id, {
                        checked_by_id: id, checked_by_name: name,
                      })}
                      employees={employees}
                    />
                    {rs.checked_by_name && (
                      <p className="text-[10px] text-green-700 mt-0.5 font-medium truncate">
                        ✓ {rs.checked_by_name}
                      </p>
                    )}
                  </td>

                  {/* Verified By */}
                  <td className="border border-border px-2 py-1.5 align-top">
                    <EmpSelect
                      value={rs.verified_by_id}
                      placeholder="Verified by…"
                      onChange={(id, name) => patchRow(row.id, {
                        verified_by_id: id, verified_by_name: name,
                      })}
                      employees={employees}
                    />
                    {rs.verified_by_name && (
                      <p className="text-[10px] text-blue-700 mt-0.5 font-medium truncate">
                        ✓ {rs.verified_by_name}
                      </p>
                    )}
                  </td>

                  {/* Query Y/N */}
                  <td className="border border-border px-2 py-1.5 text-center align-top">
                    <Select
                      value={rs.query || "__none__"}
                      onValueChange={v => setRowField(row.id, "query", v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="h-7 text-xs w-20 mx-auto">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        <SelectItem value="yes">Yes</SelectItem>
                        <SelectItem value="no">No</SelectItem>
                      </SelectContent>
                    </Select>
                    {rs.query === "yes" && (
                      <Badge className="mt-1 text-[9px] px-1 py-0 bg-amber-100 text-amber-700 block">
                        Query raised
                      </Badge>
                    )}
                  </td>

                  {/* Remarks */}
                  <td className="border border-border px-2 py-1.5 align-top">
                    <Textarea
                      rows={2}
                      className="text-xs min-w-[120px] resize-none"
                      placeholder="Remarks…"
                      value={rs.remarks}
                      onChange={e => setRowField(row.id, "remarks", e.target.value)}
                    />
                  </td>

                  {/* Documents */}
                  <td className="border border-border px-2 py-1.5 align-top">
                    {row.documents ? (
                      <p className="text-[11px] text-muted-foreground leading-snug italic">
                        {row.documents}
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground/40">—</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ══════════ FOOTER ══════════ */}
      <div className="border-t bg-muted/20 px-4 py-2 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {Object.keys(m.rows).filter(id => m.rows[id]?.query === "yes").length > 0
            ? `⚠ ${Object.keys(m.rows).filter(id => m.rows[id]?.query === "yes").length} item(s) have queries raised`
            : "✓ No queries raised"
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
