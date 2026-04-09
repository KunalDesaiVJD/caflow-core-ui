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
import { awLoad } from "@/lib/awStorage";
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

// ─── Excel export ──────────────────────────────────────────────────────────────

function exportExcel(engagementId: string, data: AuditWorksheetData) {
  const wb = XLSX.utils.book_new();
  const auditType = data.auditType;

  // ── Master sheet ─────────────────────────────────────────────────────────
  const isBoth       = auditType === "both";
  const isTax        = auditType === "tax_audit" || isBoth;
  const isStat       = auditType === "statutory"  || isBoth;

  const tax  = awLoad<Partial<TaxMasterData>>(engagementId, "tax_master_json") ?? {};
  const stat = awLoad<Partial<StatutoryMasterData>>(engagementId, "statutory_master_json") ?? {};

  const masterLabel = isBoth ? "Tax & Statutory Audit Master"
    : isTax ? "Tax Audit Master"
    : isStat ? "Statutory Audit Master"
    : "Audit Master";

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
    ["Accountant Name", tax.accountant_name ?? stat.accountant_name ?? ""],
    ["Mobile No.",      tax.mobile_no ?? stat.mobile_no ?? ""],
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
    ["Audit Date From", tax.audit_date_from ?? stat.audit_date_from ?? ""],
    ["Audit Date To",   tax.audit_date_to   ?? stat.audit_date_to   ?? ""],
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

  const auditCarriedBy = (tax.audit_carried_by ?? stat.audit_carried_by ?? [])
    .map((a: any) => a.name).filter(Boolean).join(", ");
  masterRows.push(
    [],
    ["Audit Carried Out By", auditCarriedBy],
    [],
    ["A/c (Tally) File Path",    tax.ac_path ?? stat.ac_path ?? ""],
    ["Report / Working Path",    tax.report_path ?? stat.report_path ?? ""],
    ["Footer: Prepared By",      tax.footer_prepared_by_name ?? stat.footer_prepared_by_name ?? ""],
    ["Footer: Verified By",      tax.footer_verified_by_name ?? stat.footer_verified_by_name ?? ""],
    ["Footer: Reviewed By",      tax.footer_reviewed_by_name ?? stat.footer_reviewed_by_name ?? ""],
  );

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(masterRows), masterLabel.slice(0, 31));

  // ── Audit Worksheet ───────────────────────────────────────────────────────
  const ws = awLoad<WorksheetSheetData>(engagementId, "worksheet_json") ?? { rows: {} };
  const wsHeader = ["Sr", "Area / Particulars", "Extent / As-on Date", "Work Date", "Checked By", "Notes"];
  const wsBody = WORKSHEET_ROWS.map(r => {
    const row = ws.rows[r.id] ?? {};
    const extent = (row as any).extent_text || (row as any).extent_date || "";
    return [r.sr, r.label, extent, (row as any).date ?? "", (row as any).checked_by_name ?? "", (row as any).notes ?? ""];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([wsHeader, ...wsBody]), "Audit Worksheet");

  // ── Special Attention ─────────────────────────────────────────────────────
  const sa = awLoad<SpecialAttentionFormData>(engagementId, "special_attention_json") ?? { rows: {}, audit_carried_by: [] };
  const saHeader = ["Sr", "Particulars", "Query", "Remarks", "Checked By", "Verified By"];
  const saBody: (string | null)[][] = [];
  // We export all row IDs present in storage
  for (const [rowId, rowData] of Object.entries(sa.rows ?? {})) {
    const r = rowData as any;
    saBody.push([rowId, "", yesNo(r.query), r.remarks ?? "", r.checked_by_name ?? "", r.verified_by_name ?? ""]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([saHeader, ...saBody]), "Special Attention");

  // ── Query Sheet ───────────────────────────────────────────────────────────
  const qs = awLoad<QuerySheetData>(engagementId, "query_sheet_json") ?? { queries: [] };
  const qsHeader = ["#", "Head", "Particulars", "Query Description", "Required Documents", "Remark", "Correction Status"];
  const qsBody = (qs.queries ?? []).map((q: any, i: number) => [
    i + 1, q.head, q.particulars, q.query_description, q.required_documents, q.remark, q.correction_status,
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([qsHeader, ...qsBody]), "Query Sheet");

  // ── Checklist ─────────────────────────────────────────────────────────────
  const cl = awLoad<ChecklistSheetData>(engagementId, "checklist_sheet_json") ?? { rows: {}, dynamicRowIds: [] };
  const clHeader = ["Sr", "Particulars", "Document Attached", "Page From", "Page To"];
  const fyEndYear = data.fyEndDate ? data.fyEndDate.match(/^(\d{4})/)?.[1] ?? "" : "";
  const allClDefs = [
    ...CHECKLIST_DEFS,
    ...(cl.dynamicRowIds ?? []).map((id: string, i: number) => ({
      id, sr: CHECKLIST_DEFS.length + i + 1, particulars: "",
    })),
  ];
  const clBody = allClDefs.map(def => {
    const row = (cl.rows ?? {})[def.id] ?? {};
    const particulars = (row as any).particulars || def.particulars.replace(/\{fyEndYear\}/g, fyEndYear);
    return [
      def.sr,
      particulars,
      (row as any).file_name ?? "",
      (row as any).page_from ?? "",
      (row as any).page_to ?? "",
    ];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([clHeader, ...clBody]), "Checklist");

  XLSX.writeFile(wb, `AuditWorksheet_${data.clientName || "Export"}_${data.financialYear || "FY"}.xlsx`);
}

// ─── PDF export ────────────────────────────────────────────────────────────────

async function exportPdf(engagementId: string, data: AuditWorksheetData) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const clientLine = `${data.firmName || "CA Firm"}  |  ${data.clientName || "Client"}  |  FY ${data.financialYear || ""}`;

  function pageHeader(sheetTitle: string) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(clientLine, 14, 9);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text(sheetTitle, 14, 16);
  }

  const auditType = data.auditType;
  const isBoth = auditType === "both";
  const isTax  = auditType === "tax_audit" || isBoth;
  const isStat = auditType === "statutory"  || isBoth;
  const tax  = awLoad<Partial<TaxMasterData>>(engagementId, "tax_master_json") ?? {};
  const stat = awLoad<Partial<StatutoryMasterData>>(engagementId, "statutory_master_json") ?? {};

  const masterLabel = isBoth ? "Tax & Statutory Audit Master"
    : isTax ? "Tax Audit Master"
    : isStat ? "Statutory Audit Master"
    : "Audit Master";

  // ── Page 1: Master ────────────────────────────────────────────────────────
  pageHeader(masterLabel);

  const auditCarriedBy = (tax.audit_carried_by ?? stat.audit_carried_by ?? [])
    .map((a: any) => a.name).filter(Boolean).join(", ");

  const masterBody: (string | null)[][] = [
    ["Client Name",     data.clientName,           "PAN",            data.pan],
    ["Address",         data.clientAddress,         "Entity Type",    data.entityType],
    ["Financial Year",  data.financialYear,         "Firm Name",      data.firmName],
    ["Accountant",      tax.accountant_name ?? stat.accountant_name ?? "",
     "Mobile",          tax.mobile_no ?? stat.mobile_no ?? ""],
    ["Audit Date From", tax.audit_date_from ?? stat.audit_date_from ?? "",
     "Audit Date To",   tax.audit_date_to   ?? stat.audit_date_to   ?? ""],
    ["Books Verified",  booksChecked((isTax ? tax : stat) as TaxMasterData & StatutoryMasterData), "", ""],
    ["Audit Carried By", auditCarriedBy, "", ""],
  ];

  if (isTax) {
    masterBody.push(
      ["Stock Qty Records", yesNo(tax.stock_qty_records),
       "GST Registered",    yesNo(tax.gst_details)],
    );
    if (tax.gst_details === "yes") {
      masterBody.push(["GST ID", tax.gst_id ?? "", "", ""]);
    }
  }
  if (isStat) {
    masterBody.push(["CARO 2020 Applicable", yesNo(stat.caro_applicable), "", ""]);
  }
  masterBody.push(
    ["Prepared By",  tax.footer_prepared_by_name  ?? stat.footer_prepared_by_name  ?? "",
     "Verified By",  tax.footer_verified_by_name  ?? stat.footer_verified_by_name  ?? ""],
    ["Reviewed By",  tax.footer_reviewed_by_name  ?? stat.footer_reviewed_by_name  ?? "",
     "A/c Path",     tax.ac_path ?? stat.ac_path ?? ""],
  );

  autoTable(doc, {
    startY: 20,
    head: [["Field", "Value", "Field", "Value"]],
    body: masterBody,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [79, 70, 229] },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 42 }, 2: { fontStyle: "bold", cellWidth: 42 } },
    theme: "grid",
  });

  // ── Page 2: Audit Worksheet ────────────────────────────────────────────────
  doc.addPage();
  pageHeader("Audit Worksheet");
  const ws = awLoad<WorksheetSheetData>(engagementId, "worksheet_json") ?? { rows: {} };
  autoTable(doc, {
    startY: 20,
    head: [["Sr", "Area / Particulars", "Extent / As-on Date", "Work Date", "Checked By", "Notes"]],
    body: WORKSHEET_ROWS.map(r => {
      const row = (ws.rows ?? {})[r.id] ?? {} as any;
      const extent = row.extent_text || row.extent_date || "";
      return [r.sr, r.label, extent, row.date ?? "", row.checked_by_name ?? "", row.notes ?? ""];
    }),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [16, 185, 129] },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 52 } },
    theme: "grid",
  });

  // ── Page 3: Special Attention ──────────────────────────────────────────────
  doc.addPage();
  pageHeader("Special Attention");
  const sa = awLoad<SpecialAttentionFormData>(engagementId, "special_attention_json") ?? { rows: {} };
  const saRows = Object.entries(sa.rows ?? {}).map(([rowId, r]: [string, any]) => [
    rowId, yesNo(r.query), r.remarks ?? "", r.checked_by_name ?? "", r.verified_by_name ?? "",
  ]);
  autoTable(doc, {
    startY: 20,
    head: [["Sr / ID", "Query", "Remarks", "Checked By", "Verified By"]],
    body: saRows.length > 0 ? saRows : [["—", "", "", "", ""]],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [245, 158, 11] },
    theme: "grid",
  });

  // ── Page 4: Query Sheet ────────────────────────────────────────────────────
  doc.addPage();
  pageHeader("Query Sheet");
  const qs = awLoad<QuerySheetData>(engagementId, "query_sheet_json") ?? { queries: [] };
  autoTable(doc, {
    startY: 20,
    head: [["#", "Head", "Particulars", "Query Description", "Required Documents", "Remark", "Correction"]],
    body: (qs.queries ?? []).length > 0
      ? (qs.queries ?? []).map((q: any, i: number) => [
          i + 1, q.head, q.particulars, q.query_description, q.required_documents, q.remark, q.correction_status,
        ])
      : [["—", "", "", "", "", "", ""]],
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    headStyles: { fillColor: [239, 68, 68] },
    theme: "grid",
  });

  // ── Page 5: Checklist ──────────────────────────────────────────────────────
  doc.addPage();
  pageHeader("Audit Documentation Checklist");
  const cl = awLoad<ChecklistSheetData>(engagementId, "checklist_sheet_json") ?? { rows: {}, dynamicRowIds: [] };
  const fyEndYear = data.fyEndDate ? data.fyEndDate.match(/^(\d{4})/)?.[1] ?? "" : "";
  const allClDefs = [
    ...CHECKLIST_DEFS,
    ...(cl.dynamicRowIds ?? []).map((id: string, i: number) => ({
      id, sr: CHECKLIST_DEFS.length + i + 1, particulars: "",
    })),
  ];
  autoTable(doc, {
    startY: 20,
    head: [["Sr", "Particulars", "Document Attached", "Page From", "Page To"]],
    body: allClDefs.map(def => {
      const row = (cl.rows ?? {})[def.id] ?? {} as any;
      const particulars = row.particulars || def.particulars.replace(/\{fyEndYear\}/g, fyEndYear);
      return [def.sr, particulars, row.file_name ?? "", row.page_from ?? "", row.page_to ?? ""];
    }),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [99, 102, 241] },
    columnStyles: { 0: { cellWidth: 10 }, 3: { cellWidth: 20 }, 4: { cellWidth: 20 } },
    theme: "grid",
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
        onClick={() => exportExcel(engagementId, data)}
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
