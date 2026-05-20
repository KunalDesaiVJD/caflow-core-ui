/**
 * ExportButtons
 *
 * Exports the full Audit Worksheet to Excel (.xlsx) and PDF.
 * Reads all data directly from localStorage via awLoad — the same keys
 * used by every other worksheet component — so it is always in sync.
 *
 * Excel: one worksheet per tab, headers match on-screen headers.
 * PDF:   page breaks between sheets, firm-name header on every page.
 */
import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import { awLoad, awLoadFromDB } from "@/lib/awStorage";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";
import type { TaxMasterData }       from "./hooks/useTaxMasterStorage";
import type { StatutoryMasterData } from "./hooks/useStatutoryMasterStorage";
import type { WorksheetSheetData }  from "./hooks/useWorksheetSheetStorage";
import type { SpecialAttentionFormData } from "./hooks/useSpecialAttentionStorage";
import type { QuerySheetData }      from "./hooks/useQuerySheetStorage";
import type { ChecklistSheetData }  from "./hooks/useChecklistSheetStorage";

// ─── Static row definitions (mirror what's on-screen) ─────────────────────

const WORKSHEET_ROWS = [
  { id: "purchase",         sr: "1",  label: "PURCHASE REGISTER" },
  { id: "sales",            sr: "2",  label: "SALES REGISTER" },
  { id: "cash_book",        sr: "3",  label: "CASH BOOK" },
  { id: "bank_book",        sr: "4",  label: "BANK BOOK" },
  { id: "journal",          sr: "5",  label: "JOURNAL" },
  { id: "expenses",         sr: "6",  label: "EXPENSES / SAL / WAGES" },
  { id: "contra",           sr: "7",  label: "CONTRA" },
  { id: "opening_balances", sr: "8",  label: "OPENING BALANCES" },
  { id: "others",           sr: "9",  label: "OTHERS" },
];

const CHECKLIST_DEFS = [
  { id: "p_and_l",         sr: 1,  particulars: "Profit and Loss" },
  { id: "balance_sheet",   sr: 2,  particulars: "Balance Sheet" },
  { id: "trial_balance",   sr: 3,  particulars: "Trial Balance" },
  { id: "form_26as",       sr: 4,  particulars: "26AS" },
  { id: "tis_ais",         sr: 5,  particulars: "TIS/AIS" },
  { id: "form_26q_24q",    sr: 6,  particulars: "26Q/24Q" },
  { id: "form_27eq",       sr: 7,  particulars: "27EQ" },
  { id: "tds_challan",     sr: 8,  particulars: "Challan of TDS/TCS paid after 31st March" },
  { id: "tds_ack",         sr: 9,  particulars: "TDS Ackw Receipt" },
  { id: "gst_challan",     sr: 10, particulars: "Challan of GST paid after 31st March" },
  { id: "ecl_ecash",       sr: 11, particulars: "Electronic Credit/Cash ledger matched with books & Reco." },
  { id: "pf_esic_challan", sr: 12, particulars: "Challan of PF/ESIC/PT paid after 31st March" },
  { id: "bank_last_page",  sr: 13, particulars: "Bank/FD Last Page reflecting balance matched with books" },
  { id: "bank_recon",      sr: 14, particulars: "Bank Reconciliation Statement (If any)" },
  { id: "sec_loan_last",   sr: 15, particulars: "Secured Loan Last Page reflecting balance matched with books" },
  { id: "sec_loan_letter", sr: 16, particulars: "Secured Loan Sanction Letter" },
  { id: "chapter_via",     sr: 17, particulars: "Chapter-VIA deduction Details & receipt of 80G" },
  { id: "unsec_loan_pan",  sr: 18, particulars: "Address and PAN of Unsecured Loan" },
  { id: "member_deposit",  sr: 19, particulars: "Address and PAN of Member Deposit" },
  { id: "stock_qty",       sr: 20, particulars: "Quantitative Details of Stock (if apply)" },
];

// Special Attention — "Advanced Checklist For Tax & Statutory Auditing".
// Mirrors the CHECKLIST array in SpecialAttention.tsx (Sheet 3). Section rows
// (`isSection: true`) render as merged dark-band headers in the PDF; indented
// rows are sub-points under their parent. {fyEnd} is replaced at render time.
const SA_CHECKLIST: Array<{
  id: string; sr: string; particulars: string; documents?: string;
  isSection: boolean; indent: boolean;
}> = [
  { id: "1",    sr: "1",    particulars: "Changes in Profit & Loss ratio of Partner or Shareholding",
    documents: "Copy of Partnership Deed / Shareholder Register", isSection: false, indent: false },
  { id: "2",    sr: "2",    particulars: "TDS Payable Checking", isSection: true,  indent: false },
  { id: "2_1",  sr: "2.1",  particulars: "TDS payable at end of quarter verified with Q4 return & challan paid after 31.03.{fyEnd}",
    documents: "TDS return copy, TDS challan paid after March end", isSection: false, indent: true },
  { id: "2_2",  sr: "2.2",  particulars: "Bifurcation of TDS by section-wise",
    documents: "Verification of 26Q / 24Q", isSection: false, indent: true },
  { id: "2_3",  sr: "2.3",  particulars: "Interest on late TDS payment and return filing dates",
    documents: "TDS acknowledgement copy, Interest amount", isSection: false, indent: true },
  { id: "2_4",  sr: "2.4",  particulars: "Scrutiny of each TDS ledger", isSection: false, indent: true },
  { id: "3",    sr: "3",    particulars: "TDS Receivable Checking — 26AS reconciliation with P&L income and Balance Sheet TDS receivable",
    documents: "Copy of 26AS, Ledger of TDS receivable", isSection: false, indent: false },
  { id: "4",    sr: "4",    particulars: "Deduction under Chapter-VIA — List of deductions section-wise",
    documents: "Receipts / proof of all deductions claimed", isSection: false, indent: false },
  { id: "5",    sr: "5",    particulars: "Related Party Transactions — List with Name, Relationship, PAN, Nature of Payment",
    documents: "Format as specified in audit report (AS-18 / Ind AS 24)", isSection: false, indent: false },
  { id: "6",    sr: "6",    particulars: "Details of Unsecured Loan — List with PAN & Address; verify mode of payment",
    documents: "Format as specified in audit report", isSection: false, indent: false },
  { id: "7",    sr: "7",    particulars: "Details of Secured Loan", isSection: true,  indent: false },
  { id: "7_1",  sr: "7.1",  particulars: "Whether interest on secured loan charged to expenses", isSection: false, indent: true },
  { id: "7_2",  sr: "7.2",  particulars: "Whether TDS deducted on interest (applicable for NBFC loans)",
    documents: "Verification of Loan Statement", isSection: false, indent: true },
  { id: "8",    sr: "8",    particulars: "GST", isSection: true,  indent: false },
  { id: "8_1",  sr: "8.1",  particulars: "GST offset entries verified", isSection: false, indent: true },
  { id: "8_2",  sr: "8.2",  particulars: "CGST / SGST / IGST credit & payable verification",
    documents: "GST challan paid after {fyEnd}-03-31", isSection: false, indent: true },
  { id: "8_3",  sr: "8.3",  particulars: "ITC match with electronic credit ledger",
    documents: "Verify with GSTR-3B", isSection: false, indent: true },
  { id: "9",    sr: "9",    particulars: "Manufacturing Unit Details (Only for Manufacturing Companies) — Opening Qty (RM / FG), Qty Purchased / Produced, Qty Sold / Consumed, Closing Qty",
    isSection: false, indent: false },
  { id: "10",   sr: "10",   particulars: "Private Limited / Limited Company — Specific Audit Points", isSection: true,  indent: false },
  { id: "10_1", sr: "10.1", particulars: "Unsecured loan taken and repaid during the year", isSection: false, indent: true },
  { id: "10_2", sr: "10.2", particulars: "Loans given to shareholders during the year", isSection: false, indent: true },
  { id: "10_3", sr: "10.3", particulars: "Remuneration paid to Directors",
    documents: "Board / Shareholders Resolutions", isSection: false, indent: true },
  { id: "10_4", sr: "10.4", particulars: "Change of Registered Office",
    documents: "Board / Shareholders Resolutions", isSection: false, indent: true },
  { id: "10_5", sr: "10.5", particulars: "Change in authorized / paid-up share capital",
    documents: "Board Resolutions + Updated shareholder list", isSection: false, indent: true },
  { id: "10_6", sr: "10.6", particulars: "Related party transactions (AS-18 / Ind AS 24 compliance)", isSection: false, indent: true },
  { id: "10_7", sr: "10.7", particulars: "Pending disputes / litigations with government authorities", isSection: false, indent: true },
  { id: "10_8", sr: "10.8", particulars: "CARO clauses — specifically clauses 11, 13 & 15",
    documents: "Written answers to each CARO reporting point from management", isSection: false, indent: true },
  { id: "11",   sr: "11",   particulars: "MSME — Verification of outstanding dues to Micro and Small Enterprises under MSMED Act, 2006",
    documents: "MSME Declaration / Udyam Registration Certificate of all Suppliers / Creditors", isSection: false, indent: false },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function yesNo(v: "yes" | "no" | "" | boolean | undefined): string {
  if (v === true || v === "yes") return "Yes";
  if (v === false || v === "no") return "No";
  return "";
}

function booksChecked(m: TaxMasterData | StatutoryMasterData): string {
  const list: string[] = [];
  if (m.books_cash_book)        list.push("Cash Book");
  if (m.books_bank_book)        list.push("Bank Book");
  if (m.books_journal_register) list.push("Journal Register");
  if (m.books_general_ledger)   list.push("General Ledger");
  if (m.books_purchase)         list.push("Purchase Book");
  if (m.books_sales_book)       list.push("Sales Book");
  if (m.books_stock_register)   list.push("Stock Register");
  if (m.books_others)           list.push(`Others${m.books_others_text ? `: ${m.books_others_text}` : ""}`);
  return list.join(", ");
}

// Format a date stored as ISO (YYYY-MM-DD) for display as DD-MMM-YYYY.
// IMPORTANT: we parse the Y/M/D parts manually instead of `new Date(iso)`,
// because `new Date("2026-04-21")` is parsed as UTC midnight and, when
// rendered in IST (or any positive-offset timezone), can shift to the
// previous day. The on-screen form stores plain calendar dates with no
// timezone, so we treat them as calendar dates here too.
function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mi = parseInt(iso[2], 10) - 1;
    return `${iso[3]}-${months[mi] ?? iso[2]}-${iso[1]}`;
  }
  return v;  // already formatted or unrecognized — pass through unchanged
}

// ─── Fetch helper — localStorage first, DB fallback ───────────────────────────

async function fetchSheet<T>(engagementId: string, key: string): Promise<T> {
  return (awLoad<T>(engagementId, key) ?? await awLoadFromDB<T>(engagementId, key) ?? {}) as T;
}

// Force every audit-worksheet storage hook to synchronously persist its
// current React state to localStorage NOW (cancels and runs the pending
// 1-second debounce). Without this, a user who types a value and clicks
// Export inside that 1-second window would see the PRIOR persisted value
// in the PDF (e.g. an auto-filled FY date range instead of the date they
// just typed). Storage hooks listen for the "aw:flush" event and call
// awSave(dataRef.current) immediately. The 25 ms tick gives synchronous
// listeners a chance to run; awSave's localStorage write is itself sync.
async function flushPendingSaves(): Promise<void> {
  try { window.dispatchEvent(new Event("aw:flush")); } catch { /* SSR-safe */ }
  await new Promise(resolve => setTimeout(resolve, 25));
}

// ─── Excel export ──────────────────────────────────────────────────────────────

async function exportExcel(engagementId: string, data: AuditWorksheetData) {
  await flushPendingSaves();
  const wb = XLSX.utils.book_new();
  const auditType = data.auditType;

  // ── Master sheet ─────────────────────────────────────────────────────────
  const isBoth       = auditType === "both";
  const isTax        = auditType === "tax_audit" || isBoth;
  const isStat       = auditType === "statutory"  || isBoth;

  const tax  = await fetchSheet<Partial<TaxMasterData>>(engagementId, "tax_master_json");
  const stat = await fetchSheet<Partial<StatutoryMasterData>>(engagementId, "statutory_master_json");

  const masterLabel = isBoth ? "Tax & Statutory Audit Master"
    : isTax ? "Tax Audit Master"
    : isStat ? "Statutory Audit Master"
    : "Audit Master";

  // Same first-non-empty logic the PDF export uses — see exportPdf().
  const pick = <T,>(...vals: (T | undefined | null)[]): T | "" => {
    for (const v of vals) {
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      return v as T;
    }
    return "" as T | "";
  };

  // Active-form blob wins — a stale tax_master_json on a statutory-only
  // engagement (or vice versa) must never override the value the auditor is
  // currently editing on the visible form.
  const pickByType = <T,>(
    taxVal: T | undefined | null,
    statVal: T | undefined | null,
  ): T | "" => {
    if (isStat && !isTax)  return pick(statVal, taxVal);
    if (isTax  && !isStat) return pick(taxVal,  statVal);
    return pick(taxVal, statVal);
  };

  const masterRows: (string | number | null)[][] = [
    [masterLabel],
    [],
    ["Firm Name",       data.firmName],
    ["Client Name",     data.clientName],
    ["Address",         data.clientAddress],
    ["PAN",             data.pan],
    ["Entity Type",     data.entityType],
    ["Financial Year",  data.financialYear],
    [],
    ["Accountant Name", pickByType(tax.accountant_name, stat.accountant_name)],
    ["Mobile No.",      pickByType(tax.mobile_no, stat.mobile_no)],
    [],
    ["MOA/AOA/Deed obtained",           yesNo(pickByType(tax.prev_moa_aoa_deed, stat.prev_moa_aoa_deed) as any)],
    ["Prev IT Return obtained",         yesNo(pickByType(tax.prev_it_return, stat.prev_it_return) as any)],
  ];

  if (isStat) {
    masterRows.push(["Prev Statutory Audit Report obtained", yesNo(stat.prev_audit_report)]);
  }

  masterRows.push(
    [],
    ["Books of Accounts Verified", booksChecked(
      (isTax ? tax : stat) as TaxMasterData & StatutoryMasterData
    )],
    [],
    ["Audit Date From", fmtDate(pickByType(tax.audit_date_from, stat.audit_date_from) as string)],
    ["Audit Date To",   fmtDate(pickByType(tax.audit_date_to,   stat.audit_date_to)   as string)],
  );

  if (isTax) {
    masterRows.push(
      [],
      ["Stock Qty Records",   yesNo(tax.stock_qty_records)],
      ["Stock Qty Details",   tax.stock_qty_records === "yes" ? (tax.stock_qty_details ?? "") : ""],
      [],
      ["GST Registered",      yesNo(tax.gst_details)],
      ["GST ID",              tax.gst_details === "yes" ? (tax.gst_id ?? "") : ""],
    );
  }

  if (isStat) {
    masterRows.push(
      [],
      ["CARO 2020 Applicable", yesNo(stat.caro_applicable)],
    );
  }

  const carriedListXls = pickByType(tax.audit_carried_by, stat.audit_carried_by) as any[];
  const auditCarriedBy = Array.isArray(carriedListXls)
    ? carriedListXls.map((a: any) => a?.name).filter(Boolean).join(", ")
    : "";
  masterRows.push(
    [],
    ["Audit Carried Out By", auditCarriedBy],
    [],
    ["A/c (Tally) File Path",       pickByType(tax.ac_path, stat.ac_path)],
    ["Report / Working File Path",  pickByType(tax.report_path, stat.report_path)],
    ["Footer: Prepared By",         pickByType(tax.footer_prepared_by_name, stat.footer_prepared_by_name)],
    ["Footer: Verified By",         pickByType(tax.footer_verified_by_name, stat.footer_verified_by_name)],
    ["Footer: Reviewed By",         pickByType(tax.footer_reviewed_by_name, stat.footer_reviewed_by_name)],
  );

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(masterRows), masterLabel.slice(0, 31));

  // ── Audit Worksheet ───────────────────────────────────────────────────────
  const ws = await fetchSheet<WorksheetSheetData>(engagementId, "worksheet_json");
  const wsHeader = ["Sr", "Area / Particulars", "Extent / As-on Date", "Work Date", "Checked By", "Notes"];
  const wsBody = WORKSHEET_ROWS.map(r => {
    const row = ((ws as any).rows ?? {})[r.id] ?? {};
    const extent = (row as any).extent_text || (row as any).extent_date || "";
    return [r.sr, r.label, extent, fmtDate((row as any).date), (row as any).checked_by_name ?? "", (row as any).notes ?? ""];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([wsHeader, ...wsBody]), "Audit Worksheet");

  // ── Special Attention ─────────────────────────────────────────────────────
  const sa = await fetchSheet<SpecialAttentionFormData>(engagementId, "special_attention_json");
  const saHeader = ["Sr", "Particulars", "Query", "Remarks", "Checked By", "Verified By"];
  const saBody: (string | null)[][] = [];
  for (const [rowId, rowData] of Object.entries((sa as any).rows ?? {})) {
    const r = rowData as any;
    saBody.push([rowId, "", yesNo(r.query), r.remarks ?? "", r.checked_by_name ?? "", r.verified_by_name ?? ""]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([saHeader, ...saBody]), "Special Attention");

  // ── Query Sheet ───────────────────────────────────────────────────────────
  const qs = await fetchSheet<QuerySheetData>(engagementId, "query_sheet_json");
  const qsHeader = ["#", "Head", "Particulars", "Query Description", "Required Documents", "Remark", "Correction Status"];
  const qsBody = ((qs as any).queries ?? []).map((q: any, i: number) => [
    i + 1, q.head, q.particulars, q.query_description, q.required_documents, q.remark, q.correction_status,
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([qsHeader, ...qsBody]), "Query Sheet");

  // ── Checklist ─────────────────────────────────────────────────────────────
  const cl = await fetchSheet<ChecklistSheetData>(engagementId, "checklist_sheet_json");
  const clHeader = ["Sr", "Particulars", "Document Attached", "Page From", "Page To"];
  const fyEndYear = data.fyEndDate ? data.fyEndDate.match(/^(\d{4})/)?.[1] ?? "" : "";
  const allClDefs = [
    ...CHECKLIST_DEFS,
    ...((cl as any).dynamicRowIds ?? []).map((id: string, i: number) => ({
      id, sr: CHECKLIST_DEFS.length + i + 1, particulars: "",
    })),
  ];
  const clBody = allClDefs.map(def => {
    const row = ((cl as any).rows ?? {})[def.id] ?? {};
    const particulars = (row as any).particulars || def.particulars.replace(/\{fyEndYear\}/g, fyEndYear);
    const docAttached = (row as any).is_na
      ? "N/A"
      : (Array.isArray((row as any).files) && (row as any).files.length > 0)
        ? (row as any).files.map((f: any) => f.file_name).join(", ")
        : "";
    return [
      def.sr,
      particulars,
      docAttached,
      (row as any).page_from ?? "",
      (row as any).page_to ?? "",
    ];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([clHeader, ...clBody]), "Checklist");

  XLSX.writeFile(wb, `AuditWorksheet_${data.clientName || "Export"}_${data.financialYear || "FY"}.xlsx`);
}

// ─── PDF export ────────────────────────────────────────────────────────────────
//
// Layout principles (do not regress):
//  • Landscape A4, 12 mm side margins, 22 mm top margin (room for header),
//    15 mm bottom margin (room for footer/page-number).
//  • Every section table uses didDrawPage to repaint header + footer on each
//    auto-paginated page, so long sections never lose their title.
//  • Master sheet uses a 2-column (Field | Value) layout — long values like the
//    full registered address, books-verified list, file paths, etc. get the
//    entire content-width to wrap into. The previous 4-column grid clipped
//    long values; do not switch back.
//  • All cells use overflow: "linebreak" so jspdf-autotable wraps instead of
//    truncating.
//

async function exportPdf(engagementId: string, data: AuditWorksheetData) {
  await flushPendingSaves();
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const PAGE_W = doc.internal.pageSize.getWidth();   // 297mm
  const PAGE_H = doc.internal.pageSize.getHeight();  // 210mm
  const MARGIN_X = 12;
  const MARGIN_TOP = 22;
  const MARGIN_BOTTOM = 15;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;            // 273 mm

  const clientLine = `${data.firmName || "CA Firm"}  |  ${data.clientName || "Client"}  |  FY ${data.financialYear || ""}`;
  const generatedOn = new Date().toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  // Per-page header + footer painter. Called by autoTable's didDrawPage.
  function paintChrome(sheetTitle: string) {
    // Header strip
    doc.setFillColor(243, 244, 246);
    doc.rect(0, 0, PAGE_W, 17, "F");
    doc.setDrawColor(209, 213, 219);
    doc.setLineWidth(0.2);
    doc.line(0, 17, PAGE_W, 17);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(75, 85, 99);
    doc.text(clientLine, MARGIN_X, 7);

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(17, 24, 39);
    doc.text(sheetTitle, MARGIN_X, 14);

    // Footer
    const pageNo = (doc as any).internal.getNumberOfPages
      ? doc.getCurrentPageInfo().pageNumber
      : 1;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(107, 114, 128);
    doc.text(`Generated ${generatedOn}`, MARGIN_X, PAGE_H - 6);
    doc.text(`Page ${pageNo}`, PAGE_W - MARGIN_X, PAGE_H - 6, { align: "right" });
  }

  // Common autoTable defaults — extend per section.
  const baseTable = (sheetTitle: string) => ({
    startY: MARGIN_TOP,
    margin: { left: MARGIN_X, right: MARGIN_X, top: MARGIN_TOP, bottom: MARGIN_BOTTOM },
    styles: {
      fontSize: 8.5,
      cellPadding: 2.2,
      overflow: "linebreak" as const,
      valign: "top" as const,
      lineColor: [209, 213, 219] as [number, number, number],
      lineWidth: 0.15,
    },
    headStyles: {
      fontSize: 9,
      fontStyle: "bold" as const,
      textColor: 255 as const,
      halign: "left" as const,
    },
    theme: "grid" as const,
    didDrawPage: () => paintChrome(sheetTitle),
  });

  const auditType = data.auditType;
  const isBoth = auditType === "both";
  const isTax  = auditType === "tax_audit" || isBoth;
  const isStat = auditType === "statutory"  || isBoth;
  const tax  = await fetchSheet<Partial<TaxMasterData>>(engagementId, "tax_master_json");
  const stat = await fetchSheet<Partial<StatutoryMasterData>>(engagementId, "statutory_master_json");

  const masterLabel = isBoth ? "Tax & Statutory Audit Master"
    : isTax ? "Tax Audit Master"
    : isStat ? "Statutory Audit Master"
    : "Audit Master";

  // ── Page 1: Master — 2-column Field/Value layout ──────────────────────────
  // pick: return the FIRST non-empty value across tax/stat blobs. `??` only
  // falls through on null/undefined, but stale blobs (e.g. an engagement that
  // briefly used "both" auditType then switched to statutory-only) leave the
  // OTHER blob populated with empty strings — `??` would surface those empties
  // and hide the real value. This treats "" and [] as misses.
  const pick = <T,>(...vals: (T | undefined | null)[]): T | "" => {
    for (const v of vals) {
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      return v as T;
    }
    return "" as T | "";
  };

  // For shared fields (accountant, audit dates, paths, sign-off, etc.) the
  // ON-SCREEN form for THIS engagement's audit_type is the source of truth.
  // A statutory-only engagement might still have a stale tax_master_json blob
  // from an earlier audit_type switch — surfacing tax's stale value would
  // hide the value the auditor is currently editing on the statutory form.
  // pickByType resolves the active form's blob FIRST and only falls back to
  // the other blob for "both"/legacy cases.
  const pickByType = <T,>(
    taxVal: T | undefined | null,
    statVal: T | undefined | null,
  ): T | "" => {
    if (isStat && !isTax)      return pick(statVal, taxVal);
    if (isTax  && !isStat)     return pick(taxVal,  statVal);
    return pick(taxVal, statVal);   // both: either is in sync
  };

  const carriedList = pickByType(tax.audit_carried_by, stat.audit_carried_by) as any[];
  const auditCarriedBy = Array.isArray(carriedList)
    ? carriedList.map((a: any) => a?.name).filter(Boolean).join(", ")
    : "";

  const fmt = (v: unknown) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "string" && v.trim() === "") return "—";
    return String(v);
  };

  // Section helper: emits a band-styled row that spans both columns.
  const section = (title: string): (string | { content: string; colSpan?: number; styles?: any })[] => [
    { content: title, colSpan: 2, styles: { fillColor: [241, 245, 249], fontStyle: "bold", textColor: [30, 41, 59] } },
  ];

  type Row = (string | { content: string; colSpan?: number; styles?: any })[];
  const masterBody: Row[] = [];

  // Fields below mirror, 1:1, what each on-screen Audit Master form actually
  // renders (TaxAuditMaster.tsx / StatutoryAuditMaster.tsx — numbered sections
  // 1-12 / 1-11 respectively). Do NOT add rows for data-shape fields that the
  // UI never collects (payments_to_relatives, secured_unsecured_loan,
  // deduction_details, *_prepared_by_name, signed_copy_received,
  // management_repr_letter, appointment_letter, audit_form_type) — they
  // appeared as empty rows in earlier PDFs and the auditor flagged it.
  const dateOfIncorporation = fmtDate((data as any).client?.date_of_incorporation) || "—";

  masterBody.push(section("Client"));
  masterBody.push(["Firm Name",            fmt(data.firmName)]);
  masterBody.push(["Client / Assessee",    fmt(data.clientName)]);
  masterBody.push(["Registered Address",   fmt(data.clientAddress)]);
  masterBody.push(["PAN",                  fmt(data.pan)]);
  masterBody.push([isStat ? "Date of Incorporation / Registration" : "Birth Date / Registration Date",
                   dateOfIncorporation]);
  masterBody.push(["Entity Type",          fmt(data.entityType)]);
  masterBody.push(["Financial Year",       fmt(data.financialYear)]);

  masterBody.push(section("Contact"));
  masterBody.push(["Accountant Name",      fmt(pickByType(tax.accountant_name, stat.accountant_name))]);
  masterBody.push(["Mobile No.",           fmt(pickByType(tax.mobile_no, stat.mobile_no))]);

  masterBody.push(section("Previous Years Details (Documents Obtained)"));
  masterBody.push(["MOA / AOA / Partnership Deed (if first year or any change)",
    yesNo(pickByType(tax.prev_moa_aoa_deed, stat.prev_moa_aoa_deed) as any) || "—"]);
  masterBody.push(["Previous Year IT Return & Balance Sheet",
    yesNo(pickByType(tax.prev_it_return, stat.prev_it_return) as any) || "—"]);
  if (isStat) {
    masterBody.push(["Previous Year Statutory Audit Report",
      yesNo(stat.prev_audit_report) || "—"]);
  }

  masterBody.push(section("Books of Accounts Verified"));
  masterBody.push(["Books Verified",
    booksChecked((isTax ? tax : stat) as TaxMasterData & StatutoryMasterData) || "—"]);

  if (isTax) {
    masterBody.push(section("Stock Quantity Records Maintained"));
    masterBody.push(["Stock Quantity Records", yesNo(tax.stock_qty_records) || "—"]);
    if (tax.stock_qty_records === "yes") {
      masterBody.push(["Stock Quantity Details", fmt(tax.stock_qty_details)]);
    }
  }

  masterBody.push(section("Dates Audit Conducted"));
  masterBody.push(["Audit Date From", fmtDate(pickByType(tax.audit_date_from, stat.audit_date_from) as string) || "—"]);
  masterBody.push(["Audit Date To",   fmtDate(pickByType(tax.audit_date_to,   stat.audit_date_to)   as string) || "—"]);

  if (isTax) {
    masterBody.push(section("GST Registered?"));
    masterBody.push(["GST Registered", yesNo(tax.gst_details) || "—"]);
    if (tax.gst_details === "yes") {
      masterBody.push(["GST ID", fmt(tax.gst_id)]);
    }
  }
  if (isStat) {
    masterBody.push(section("CARO 2020 Applicable?"));
    masterBody.push(["CARO 2020 Applicable", yesNo(stat.caro_applicable) || "—"]);
  }

  masterBody.push(section("Audit Carried Out By"));
  masterBody.push(["Auditors", auditCarriedBy || "—"]);

  masterBody.push(section("Paths"));
  masterBody.push(["A/c (Tally) File Path",     fmt(pickByType(tax.ac_path,     stat.ac_path))]);
  masterBody.push(["Report / Working File Path", fmt(pickByType(tax.report_path, stat.report_path))]);

  masterBody.push(section("Sign-off"));
  masterBody.push(["Prepared By", fmt(pickByType(tax.footer_prepared_by_name, stat.footer_prepared_by_name))]);
  masterBody.push(["Verified By", fmt(pickByType(tax.footer_verified_by_name, stat.footer_verified_by_name))]);
  masterBody.push(["Reviewed By", fmt(pickByType(tax.footer_reviewed_by_name, stat.footer_reviewed_by_name))]);

  autoTable(doc, {
    ...baseTable(masterLabel),
    head: [["Field", "Value"]],
    body: masterBody as any,
    headStyles: { ...baseTable(masterLabel).headStyles, fillColor: [79, 70, 229] },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 70, fillColor: [249, 250, 251] },
      1: { cellWidth: CONTENT_W - 70 },
    },
  });

  // ── Page 2: Vouching ──────────────────────────────────────────────────────
  // Columns mirror Worksheet.tsx on-screen header exactly:
  //   Sr. | Name of Books | Extent of Check | Date | Assigned To | Status | Notes
  // Multi-period rows (periods.length > 0) emit one sub-row per period under
  // the book name; single-period (legacy) rows emit a single row.
  doc.addPage();
  const ws = await fetchSheet<WorksheetSheetData>(engagementId, "worksheet_json");

  const STATUS_LABEL: Record<string, string> = { done: "Done", na: "N/A", pending: "Pending" };
  type VouchRow = (string | { content: string; colSpan?: number; styles?: any })[];
  const vouchBody: VouchRow[] = [];
  for (const r of WORKSHEET_ROWS) {
    const row = ((ws as any).rows ?? {})[r.id] ?? {} as any;
    const periods: any[] = Array.isArray(row.periods) ? row.periods : [];
    if (periods.length > 0) {
      periods.forEach((p, idx) => {
        const extent = p.extent_text || p.extent_date || "";
        const assigned = Array.isArray(p.assigned_names)
          ? p.assigned_names.filter(Boolean).join(", ")
          : "";
        const extentDisplay = p.extent_date
          ? fmtDate(p.extent_date)
          : (p.extent_text || "");
        vouchBody.push([
          idx === 0 ? r.sr : "",
          idx === 0 ? r.label : "",
          p.period_label ? `${p.period_label}${extentDisplay ? ` — ${extentDisplay}` : ""}` : extentDisplay,
          fmtDate(p.date),
          assigned,
          STATUS_LABEL[p.status] ?? "",
          idx === 0 ? (row.notes ?? "") : "",
        ]);
      });
    } else {
      const extent = row.extent_text
        ? row.extent_text
        : (row.extent_date ? fmtDate(row.extent_date) : "");
      const assigned = Array.isArray(row.checked_by_names) && row.checked_by_names.length > 0
        ? row.checked_by_names.filter(Boolean).join(", ")
        : (row.checked_by_name ?? "");
      vouchBody.push([
        r.sr, r.label, extent, fmtDate(row.date), assigned, "", row.notes ?? "",
      ]);
    }
  }
  autoTable(doc, {
    ...baseTable("Vouching"),
    head: [["Sr.", "Name of Books", "Extent of Check", "Date", "Assigned To", "Status", "Notes"]],
    body: vouchBody as any,
    headStyles: { ...baseTable("Vouching").headStyles, fillColor: [13, 148, 136] },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 50, fontStyle: "bold" },
      2: { cellWidth: 60 },
      3: { cellWidth: 25, halign: "center" },
      4: { cellWidth: 45 },
      5: { cellWidth: 22, halign: "center" },
      6: { cellWidth: CONTENT_W - 10 - 50 - 60 - 25 - 45 - 22 },
    },
  });

  // ── Page 3: Audit Worksheet (Advanced Checklist) ──────────────────────────
  // Renders the full SA_CHECKLIST in order — including section bands and
  // user-added extra_rows appended after the static checklist. Columns mirror
  // SpecialAttention.tsx on-screen header:
  //   Sr. | Particulars | Documents to Verify | Checked By | Verified By | Query? | Query / Remarks
  doc.addPage();
  const sa = await fetchSheet<SpecialAttentionFormData>(engagementId, "special_attention_json");
  const fyEndForSA = data.fyEndDate ? data.fyEndDate.match(/^(\d{4})/)?.[1] ?? "" : "";
  const inject = (s: string) => s.replaceAll("{fyEnd}", fyEndForSA);
  const saRowsData: Record<string, any> = (sa as any).rows ?? {};
  const extraRows: Array<{ id: string; particulars: string; documents?: string }> =
    Array.isArray((sa as any).extra_rows) ? (sa as any).extra_rows : [];

  type SARow = (string | { content: string; colSpan?: number; styles?: any })[];
  const saBody: SARow[] = [];

  const sectionStyle = { fillColor: [251, 191, 36], fontStyle: "bold" as const, textColor: [69, 26, 3] };
  for (const def of SA_CHECKLIST) {
    if (def.isSection) {
      saBody.push([{ content: `${def.sr}  ${inject(def.particulars)}`, colSpan: 7, styles: sectionStyle }]);
      continue;
    }
    const r = saRowsData[def.id] ?? {};
    const checkedBy = Array.isArray(r.checked_by_names) && r.checked_by_names.length > 0
      ? r.checked_by_names.filter(Boolean).join(", ")
      : (r.checked_by_name ?? "");
    saBody.push([
      def.sr,
      (def.indent ? "   " : "") + inject(def.particulars),
      def.documents ? inject(def.documents) : "",
      checkedBy,
      r.verified_by_name ?? "",
      yesNo(r.query),
      r.remarks ?? "",
    ]);
  }
  // Custom extra rows added by the user (appended after the static checklist).
  if (extraRows.length > 0) {
    saBody.push([{ content: "Additional Points", colSpan: 7, styles: sectionStyle }]);
    extraRows.forEach((er, idx) => {
      const r = saRowsData[er.id] ?? {};
      const checkedBy = Array.isArray(r.checked_by_names) && r.checked_by_names.length > 0
        ? r.checked_by_names.filter(Boolean).join(", ")
        : (r.checked_by_name ?? "");
      saBody.push([
        `A${idx + 1}`,
        er.particulars || "",
        er.documents || "",
        checkedBy,
        r.verified_by_name ?? "",
        yesNo(r.query),
        r.remarks ?? "",
      ]);
    });
  }

  autoTable(doc, {
    ...baseTable("Audit Worksheet — Advanced Checklist For Tax & Statutory Auditing"),
    head: [["Sr.", "Particulars", "Documents to Verify", "Checked By", "Verified By (Sr. Head)", "Query?", "Query / Remarks"]],
    body: saBody.length > 0 ? (saBody as any) : [["—", "", "", "", "", "", ""]],
    styles: { ...baseTable("").styles, fontSize: 8, cellPadding: 1.8 },
    headStyles: { ...baseTable("").headStyles, fillColor: [217, 119, 6], fontSize: 8.5 },
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: 75, fontStyle: "bold" },
      2: { cellWidth: 55 },
      3: { cellWidth: 35 },
      4: { cellWidth: 30 },
      5: { cellWidth: 14, halign: "center" },
      6: { cellWidth: CONTENT_W - 12 - 75 - 55 - 35 - 30 - 14 },
    },
  });

  // ── Page 4: Query Sheet ────────────────────────────────────────────────────
  doc.addPage();
  const qs = await fetchSheet<QuerySheetData>(engagementId, "query_sheet_json");
  autoTable(doc, {
    ...baseTable("Query Sheet"),
    head: [["#", "Head", "Particulars", "Query Description", "Required Documents", "Remark", "Correction"]],
    body: ((qs as any).queries ?? []).length > 0
      ? ((qs as any).queries ?? []).map((q: any, i: number) => [
          i + 1, q.head, q.particulars, q.query_description, q.required_documents, q.remark, q.correction_status,
        ])
      : [["—", "", "", "", "", "", ""]],
    styles: { ...baseTable("Query Sheet").styles, fontSize: 8, cellPadding: 1.8 },
    headStyles: { ...baseTable("Query Sheet").headStyles, fillColor: [239, 68, 68], fontSize: 8.5 },
    columnStyles: {
      0: { cellWidth: 8,  halign: "center" },
      1: { cellWidth: 32 },
      2: { cellWidth: 36 },
      3: { cellWidth: 60 },
      4: { cellWidth: 50 },
      5: { cellWidth: 50 },
      6: { cellWidth: CONTENT_W - 8 - 32 - 36 - 60 - 50 - 50 },
    },
  });

  // ── Page 5: Checklist ──────────────────────────────────────────────────────
  doc.addPage();
  const cl = await fetchSheet<ChecklistSheetData>(engagementId, "checklist_sheet_json");
  const fyEndYear = data.fyEndDate ? data.fyEndDate.match(/^(\d{4})/)?.[1] ?? "" : "";
  const allClDefs = [
    ...CHECKLIST_DEFS,
    ...((cl as any).dynamicRowIds ?? []).map((id: string, i: number) => ({
      id, sr: CHECKLIST_DEFS.length + i + 1, particulars: "",
    })),
  ];
  autoTable(doc, {
    ...baseTable("Audit Documentation Checklist"),
    head: [["Sr", "Particulars", "Document Attached", "Page From", "Page To"]],
    body: allClDefs.map(def => {
      const row = ((cl as any).rows ?? {})[def.id] ?? {} as any;
      const particulars = row.particulars || def.particulars.replace(/\{fyEndYear\}/g, fyEndYear);
      const docAttached = row.is_na
        ? "N/A"
        : (Array.isArray(row.files) && row.files.length > 0)
          ? row.files.map((f: any) => f.file_name).join(", ")
          : "";
      return [def.sr, particulars, docAttached, row.page_from ?? "", row.page_to ?? ""];
    }),
    headStyles: { ...baseTable("Audit Documentation Checklist").headStyles, fillColor: [99, 102, 241] },
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: 95, fontStyle: "bold" },
      2: { cellWidth: CONTENT_W - 12 - 95 - 25 - 25 },
      3: { cellWidth: 25, halign: "center" },
      4: { cellWidth: 25, halign: "center" },
    },
  });

  doc.save(`AuditWorksheet_${data.clientName || "Export"}_${data.financialYear || "FY"}.pdf`);
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  data:         AuditWorksheetData;
  engagementId: string;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ExportButtons({ data, engagementId }: Props) {
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-green-700 border-green-300 hover:bg-green-50"
        onClick={() => { exportExcel(engagementId, data); }}
      >
        <Download size={14} /> Excel
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-red-700 border-red-300 hover:bg-red-50"
        onClick={() => exportPdf(engagementId, data)}
      >
        <FileText size={14} /> PDF
      </Button>
    </div>
  );
}
