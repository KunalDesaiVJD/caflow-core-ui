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

// ─── Fetch helper — localStorage first, DB fallback ───────────────────────────

async function fetchSheet<T>(engagementId: string, key: string): Promise<T> {
  return (awLoad<T>(engagementId, key) ?? await awLoadFromDB<T>(engagementId, key) ?? {}) as T;
}

// ─── Excel export ──────────────────────────────────────────────────────────────

async function exportExcel(engagementId: string, data: AuditWorksheetData) {
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
    ["Accountant Name", pick(tax.accountant_name, stat.accountant_name)],
    ["Mobile No.",      pick(tax.mobile_no, stat.mobile_no)],
    [],
    ["MOA/AOA/Deed obtained",           yesNo(tax.prev_moa_aoa_deed ?? stat.prev_moa_aoa_deed)],
    ["Prev IT Return obtained",         yesNo(tax.prev_it_return ?? stat.prev_it_return)],
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
    ["Audit Date From", pick(tax.audit_date_from, stat.audit_date_from)],
    ["Audit Date To",   pick(tax.audit_date_to,   stat.audit_date_to)],
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

  const carriedListXls = pick(stat.audit_carried_by, tax.audit_carried_by) as any[];
  const auditCarriedBy = Array.isArray(carriedListXls)
    ? carriedListXls.map((a: any) => a?.name).filter(Boolean).join(", ")
    : "";
  masterRows.push(
    [],
    ["Audit Carried Out By", auditCarriedBy],
    [],
    ["A/c (Tally) File Path",       pick(tax.ac_path, stat.ac_path)],
    ["Report / Working File Path",  pick(tax.report_path, stat.report_path)],
    ["Footer: Prepared By",         pick(tax.footer_prepared_by_name, stat.footer_prepared_by_name)],
    ["Footer: Verified By",         pick(tax.footer_verified_by_name, stat.footer_verified_by_name)],
    ["Footer: Reviewed By",         pick(tax.footer_reviewed_by_name, stat.footer_reviewed_by_name)],
  );

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(masterRows), masterLabel.slice(0, 31));

  // ── Audit Worksheet ───────────────────────────────────────────────────────
  const ws = await fetchSheet<WorksheetSheetData>(engagementId, "worksheet_json");
  const wsHeader = ["Sr", "Area / Particulars", "Extent / As-on Date", "Work Date", "Checked By", "Notes"];
  const wsBody = WORKSHEET_ROWS.map(r => {
    const row = ((ws as any).rows ?? {})[r.id] ?? {};
    const extent = (row as any).extent_text || (row as any).extent_date || "";
    return [r.sr, r.label, extent, (row as any).date ?? "", (row as any).checked_by_name ?? "", (row as any).notes ?? ""];
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

  const carriedList = pick(stat.audit_carried_by, tax.audit_carried_by) as any[];
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

  masterBody.push(section("Engagement"));
  masterBody.push(["Firm Name",            fmt(data.firmName)]);
  masterBody.push(["Client / Assessee",    fmt(data.clientName)]);
  masterBody.push(["Registered Address",   fmt(data.clientAddress)]);
  masterBody.push(["PAN",                  fmt(data.pan)]);
  masterBody.push(["Entity Type",          fmt(data.entityType)]);
  masterBody.push(["Financial Year",       fmt(data.financialYear)]);

  masterBody.push(section("Contact"));
  masterBody.push(["Accountant Name",      fmt(pick(tax.accountant_name, stat.accountant_name))]);
  masterBody.push(["Mobile No.",           fmt(pick(tax.mobile_no, stat.mobile_no))]);

  masterBody.push(section("Previous Year Documents"));
  masterBody.push(["MOA / AOA / Deed obtained", yesNo(tax.prev_moa_aoa_deed ?? stat.prev_moa_aoa_deed) || "—"]);
  masterBody.push(["Previous IT Return obtained", yesNo(tax.prev_it_return ?? stat.prev_it_return) || "—"]);
  if (isStat) {
    masterBody.push(["Previous Statutory Audit Report obtained", yesNo(stat.prev_audit_report) || "—"]);
  }

  masterBody.push(section("Books of Accounts"));
  masterBody.push(["Books Verified", booksChecked((isTax ? tax : stat) as TaxMasterData & StatutoryMasterData) || "—"]);

  masterBody.push(section("Audit Dates"));
  masterBody.push(["Audit Date From", fmt(pick(tax.audit_date_from, stat.audit_date_from))]);
  masterBody.push(["Audit Date To",   fmt(pick(tax.audit_date_to,   stat.audit_date_to))]);

  if (isTax) {
    masterBody.push(section("Tax Audit Specifics"));
    masterBody.push(["Stock Quantity Records", yesNo(tax.stock_qty_records) || "—"]);
    if (tax.stock_qty_records === "yes") {
      masterBody.push(["Stock Quantity Details", fmt(tax.stock_qty_details)]);
    }
    masterBody.push(["GST Registered", yesNo(tax.gst_details) || "—"]);
    if (tax.gst_details === "yes") {
      masterBody.push(["GST ID", fmt(tax.gst_id)]);
    }
    masterBody.push(["Payments to Relatives",        yesNo(tax.payments_to_relatives) || "—"]);
    masterBody.push(["Secured / Unsecured Loan",     yesNo(tax.secured_unsecured_loan) || "—"]);
    masterBody.push(["Deduction Details",            yesNo(tax.deduction_details) || "—"]);
  }
  if (isStat) {
    masterBody.push(section("Statutory Audit Specifics"));
    masterBody.push(["CARO 2020 Applicable", yesNo(stat.caro_applicable) || "—"]);
    if ((stat as any).audit_form_type) {
      masterBody.push(["Audit Report Form", fmt((stat as any).audit_form_type)]);
    }
    masterBody.push(["Payments to Relatives",    yesNo(stat.payments_to_relatives) || "—"]);
    masterBody.push(["Secured / Unsecured Loan", yesNo(stat.secured_unsecured_loan) || "—"]);
  }
  masterBody.push(section("Preparation & Review"));
  masterBody.push(["Audit Report Prepared By",
    fmt(pick(tax.audit_report_prepared_by_name, stat.audit_report_prepared_by_name))]);
  masterBody.push(["Return Prepared By",
    fmt(pick(tax.return_prepared_by_name, stat.return_prepared_by_name))]);
  masterBody.push(["3CD Prepared By",
    fmt(pick(tax.cd_prepared_by_name, stat.cd_prepared_by_name))]);
  masterBody.push(["Signed Copy Received",
    fmt(pick(tax.signed_copy_received, stat.signed_copy_received))]);
  masterBody.push(["Management Representation Letter",
    fmt(pick(tax.management_repr_letter, stat.management_repr_letter))]);
  masterBody.push(["Appointment Letter",
    fmt(pick(tax.appointment_letter, stat.appointment_letter))]);

  masterBody.push(section("Audit Team"));
  masterBody.push(["Audit Carried Out By", auditCarriedBy || "—"]);

  masterBody.push(section("Paths"));
  masterBody.push(["A/c (Tally) File Path",     fmt(pick(tax.ac_path,     stat.ac_path))]);
  masterBody.push(["Report / Working File Path", fmt(pick(tax.report_path, stat.report_path))]);

  masterBody.push(section("Sign-off"));
  masterBody.push(["Prepared By", fmt(pick(tax.footer_prepared_by_name, stat.footer_prepared_by_name))]);
  masterBody.push(["Verified By", fmt(pick(tax.footer_verified_by_name, stat.footer_verified_by_name))]);
  masterBody.push(["Reviewed By", fmt(pick(tax.footer_reviewed_by_name, stat.footer_reviewed_by_name))]);

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

  // ── Page 2: Audit Worksheet ────────────────────────────────────────────────
  doc.addPage();
  const ws = await fetchSheet<WorksheetSheetData>(engagementId, "worksheet_json");
  autoTable(doc, {
    ...baseTable("Audit Worksheet"),
    head: [["Sr", "Area / Particulars", "Extent / As-on Date", "Work Date", "Checked By", "Notes"]],
    body: WORKSHEET_ROWS.map(r => {
      const row = ((ws as any).rows ?? {})[r.id] ?? {} as any;
      const extent = row.extent_text || row.extent_date || "";
      return [r.sr, r.label, extent, row.date ?? "", row.checked_by_name ?? "", row.notes ?? ""];
    }),
    headStyles: { ...baseTable("Audit Worksheet").headStyles, fillColor: [16, 185, 129] },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 55, fontStyle: "bold" },
      2: { cellWidth: 50 },
      3: { cellWidth: 28 },
      4: { cellWidth: 40 },
      5: { cellWidth: CONTENT_W - 10 - 55 - 50 - 28 - 40 },
    },
  });

  // ── Page 3: Special Attention ──────────────────────────────────────────────
  doc.addPage();
  const sa = await fetchSheet<SpecialAttentionFormData>(engagementId, "special_attention_json");
  const saRows = Object.entries((sa as any).rows ?? {}).map(([rowId, r]: [string, any]) => [
    rowId, yesNo(r.query), r.remarks ?? "", r.checked_by_name ?? "", r.verified_by_name ?? "",
  ]);
  autoTable(doc, {
    ...baseTable("Special Attention"),
    head: [["Sr / ID", "Query", "Remarks", "Checked By", "Verified By"]],
    body: saRows.length > 0 ? saRows : [["—", "", "", "", ""]],
    headStyles: { ...baseTable("Special Attention").headStyles, fillColor: [245, 158, 11] },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 18, halign: "center" },
      2: { cellWidth: CONTENT_W - 40 - 18 - 45 - 45 },
      3: { cellWidth: 45 },
      4: { cellWidth: 45 },
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
