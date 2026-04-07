/**
 * Checklist — Sheet 6 "AUDIT DOCUMENTATION"
 *
 * 22 fixed document items with Page Number FROM / TO tracking.
 *
 * Rows 1-20: predefined particulars (read-only label).
 * Rows 21-22: blank, user-editable particulars (custom items).
 *
 * Items 8, 10, 12 contain "{fyEndYear}" which is replaced at render
 * with the actual year derived from data.fyEndDate (Req #4).
 *
 * Header: 'Audit Documentation' + firm name + client name
 */
import { cn } from "@/lib/utils";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Badge }   from "@/components/ui/badge";
import { Save, Loader2, ClipboardCheck } from "lucide-react";

import { useChecklistSheetStorage } from "./hooks/useChecklistSheetStorage";
import type { AuditWorksheetData }  from "./hooks/useAuditWorksheetData";

// ─── Static row definitions ───────────────────────────────────────────────────

interface ChecklistDef {
  id:          string;
  sr:          number;
  particulars: string;   // may contain "{fyEndYear}" placeholder
  isCustom?:   boolean;  // rows 21-22: user-editable particulars
}

const CHECKLIST_DEFS: ChecklistDef[] = [
  { id: "p_and_l",          sr: 1,  particulars: "Profit and Loss" },
  { id: "balance_sheet",    sr: 2,  particulars: "Balance Sheet" },
  { id: "trial_balance",    sr: 3,  particulars: "Trial Balance" },
  {
    id: "form_26as",        sr: 4,
    particulars: "26AS — Attached Compulsory even though IF NIL",
  },
  {
    id: "tis_ais",          sr: 5,
    particulars: "TIS/AIS — Attached Compulsory even though IF NIL",
  },
  { id: "form_26q_24q",     sr: 6,  particulars: "26Q/24Q" },
  { id: "form_27eq",        sr: 7,  particulars: "27EQ" },
  {
    id: "tds_challan",      sr: 8,
    particulars:
      "Challan of TDS/TCS paid after 31st March {fyEndYear} " +
      "duly matched with books closing balance",
  },
  { id: "tds_ack",          sr: 9,  particulars: "TDS Ackw Receipt" },
  {
    id: "gst_challan",      sr: 10,
    particulars:
      "Challan of GST paid after 31st March {fyEndYear} " +
      "duly matched with books closing balance",
  },
  {
    id: "ecl_ecash",        sr: 11,
    particulars: "Electronic Credit/Cash ledger matched with books & Reco.",
  },
  {
    id: "pf_esic_challan",  sr: 12,
    particulars:
      "Challan of PF/ESIC/PT paid after 31st March {fyEndYear} " +
      "duly matched with books closing balance",
  },
  {
    id: "bank_last_page",   sr: 13,
    particulars: "Bank/FD Last Page reflecting balance matched with books",
  },
  {
    id: "bank_recon",       sr: 14,
    particulars: "Bank Reconciliation Statement (If any)",
  },
  {
    id: "sec_loan_last",    sr: 15,
    particulars: "Secured Loan Last Page reflecting balance matched with books",
  },
  { id: "sec_loan_letter",  sr: 16, particulars: "Secured Loan Sanction Letter" },
  {
    id: "chapter_via",      sr: 17,
    particulars: "Chapter-VIA deduction Details & receipt of 80G (if applicable)",
  },
  { id: "unsec_loan_pan",   sr: 18, particulars: "Address and PAN of Unsecured Loan" },
  { id: "member_deposit",   sr: 19, particulars: "Address and PAN of Member Deposit" },
  {
    id: "stock_qty",        sr: 20,
    particulars: "Quantitative Details of Stock (if apply)",
  },
  { id: "custom_1",         sr: 21, particulars: "", isCustom: true },
  { id: "custom_2",         sr: 22, particulars: "", isCustom: true },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the 4-digit year from an ISO date string like "2026-03-31" → "2026" */
function fyEndYearFromDate(fyEndDate: string): string {
  if (!fyEndDate) return "____";
  const m = fyEndDate.match(/^(\d{4})/);
  return m ? m[1] : "____";
}

/** Replace all {fyEndYear} tokens in a particulars string with the real year */
function injectYear(text: string, year: string): string {
  return text.replace(/\{fyEndYear\}/g, year);
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Checklist({ data, engagementId }: Props) {
  const { getRow, setRowField, manualSave, saving } =
    useChecklistSheetStorage(engagementId, data.engagement?.firm_id);

  const fyEndYear = fyEndYearFromDate(data.fyEndDate);

  // Count rows where at least one page number is filled
  const filledCount = CHECKLIST_DEFS.filter(def => {
    const row = getRow(def.id);
    return row.page_from.trim() !== "" || row.page_to.trim() !== "";
  }).length;
  const pct = Math.round((filledCount / CHECKLIST_DEFS.length) * 100);

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">

      {/* ══════════ PAGE HEADER ══════════ */}
      <div className="bg-violet-700 text-white px-6 py-4 space-y-0.5">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={18} />
          <span className="text-base font-semibold tracking-wide">
            {data.firmName || "CA Firm"}
          </span>
        </div>
        <p className="text-[13px] font-bold opacity-95 tracking-widest uppercase">
          Audit Documentation
          {data.clientName ? ` — ${data.clientName}` : ""}
        </p>
      </div>

      {/* ══════════ PROGRESS BAR + SUB-HEADER ══════════ */}
      <div className="border-b bg-muted/30 px-4 py-2.5 space-y-2">
        {/* Progress row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Badge
              className={cn(
                "text-xs",
                pct === 100
                  ? "bg-green-100 text-green-700"
                  : pct >= 50
                  ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-600"
              )}
            >
              {filledCount} / {CHECKLIST_DEFS.length} documented ({pct}%)
            </Badge>
            {pct === 100 && (
              <span className="text-xs text-green-700 font-medium">
                ✓ All documents page-numbered
              </span>
            )}
          </div>
          <Button
            size="sm"
            className="gap-1 h-7 text-xs bg-violet-700 hover:bg-violet-800"
            onClick={manualSave}
            disabled={saving}
          >
            {saving
              ? <Loader2 size={12} className="animate-spin" />
              : <Save    size={12} />
            }
            Save
          </Button>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              pct === 100 ? "bg-green-500" : "bg-violet-500"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* ══════════ TABLE ══════════ */}
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[620px]">
          <thead>
            <tr className="bg-violet-700 text-white text-[11px] uppercase tracking-wide">
              <th className="border border-violet-600 px-2 py-2.5 text-center w-12">Sr.</th>
              <th className="border border-violet-600 px-3 py-2.5 text-left">Particulars</th>
              <th className="border border-violet-600 px-2 py-2.5 text-center w-36">
                Page Number From
              </th>
              <th className="border border-violet-600 px-2 py-2.5 text-center w-36">
                Page Number To
              </th>
            </tr>
          </thead>
          <tbody>
            {CHECKLIST_DEFS.map(def => {
              const row = getRow(def.id);
              const hasBoth  = row.page_from.trim() !== "" && row.page_to.trim() !== "";
              const hasEither = row.page_from.trim() !== "" || row.page_to.trim() !== "";
              const labelText = def.isCustom
                ? (row.particulars || "")
                : injectYear(def.particulars, fyEndYear);

              return (
                <tr
                  key={def.id}
                  className={cn(
                    "align-middle hover:bg-muted/10 transition-colors",
                    hasBoth && "bg-green-50/50"
                  )}
                >
                  {/* Sr No */}
                  <td className="border border-border px-2 py-2 text-center">
                    <span className="text-xs font-mono text-muted-foreground">
                      {def.sr}
                    </span>
                  </td>

                  {/* Particulars */}
                  <td className="border border-border px-3 py-2">
                    {def.isCustom ? (
                      <Input
                        className="h-7 text-xs w-full border-dashed"
                        placeholder="Enter custom item description…"
                        value={row.particulars}
                        onChange={e =>
                          setRowField(def.id, "particulars", e.target.value)
                        }
                      />
                    ) : (
                      <span
                        className={cn(
                          "text-xs leading-snug",
                          hasEither
                            ? "text-foreground font-medium"
                            : "text-muted-foreground"
                        )}
                      >
                        {labelText}
                      </span>
                    )}
                  </td>

                  {/* Page From */}
                  <td className="border border-border px-2 py-2 text-center">
                    <Input
                      type="number"
                      min="1"
                      className="h-7 text-xs text-center w-full"
                      placeholder="—"
                      value={row.page_from}
                      onChange={e =>
                        setRowField(def.id, "page_from", e.target.value)
                      }
                    />
                  </td>

                  {/* Page To */}
                  <td className="border border-border px-2 py-2 text-center">
                    <Input
                      type="number"
                      min="1"
                      className="h-7 text-xs text-center w-full"
                      placeholder="—"
                      value={row.page_to}
                      onChange={e =>
                        setRowField(def.id, "page_to", e.target.value)
                      }
                    />
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
          {pct === 100
            ? `✓ All ${CHECKLIST_DEFS.length} documents page-numbered`
            : `${CHECKLIST_DEFS.length - filledCount} document(s) without page numbers`}
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
