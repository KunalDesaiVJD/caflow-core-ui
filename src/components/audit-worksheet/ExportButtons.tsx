/**
 * ExportButtons
 * Req #5: Export the full Audit Worksheet to Excel (xlsx) and PDF (jsPDF + autotable).
 */
import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import type { WsMaster, WsItem } from "./hooks/useWorksheetStorage";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

interface Props {
  data: AuditWorksheetData;
  master: WsMaster;
  worksheetItems: WsItem[];
  specialAttentionItems: WsItem[];
  checklistItems: WsItem[];
}

// ─── Excel ─────────────────────────────────────────────────────────────────

function exportExcel({ data, master, worksheetItems, specialAttentionItems, checklistItems }: Props) {
  const wb = XLSX.utils.book_new();

  // Sheet 1 – Tax Audit Master
  const taxRows = [
    ["Tax Audit Master Sheet"],
    [],
    ["CA Firm", data.firmName],
    ["Client Name", master.tax_client_name],
    ["Address", master.tax_address],
    ["PAN", master.tax_pan],
    ["CIN", master.tax_cin],
    ["GSTIN", master.tax_gstin],
    ["Entity Type", master.tax_entity_type],
    ["Financial Year", master.tax_financial_year],
    ["Period From", master.tax_period_from],
    ["Period To", master.tax_period_to],
    ["Prev Year From", master.tax_prev_year_from],
    ["Prev Year To", master.tax_prev_year_to],
    ["Turnover", master.tax_turnover],
    ["Accounting Method", master.tax_accounting_method],
    ["Section", master.tax_section],
    ["Form Type", master.tax_form_type],
    ["Remarks", master.tax_remarks],
    [],
    ["Auditor Details"],
    ["Firm Name", master.tax_auditor_firm],
    ["Address", master.tax_auditor_address],
    ["ICAI Reg No", master.tax_icai_reg],
    ["Partner Name", master.tax_partner_name],
    ["Partner ICAI", master.tax_partner_icai],
    ["UDIN", master.tax_udin],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(taxRows), "Tax Audit Master");

  // Sheet 2 – Internal Audit Master
  const intRows = [
    ["Internal Audit Master Sheet"],
    [],
    ["CA Firm", data.firmName],
    ["Client Name", master.int_client_name],
    ["Address", master.int_address],
    ["PAN", master.int_pan],
    ["Entity Type", master.int_entity_type],
    ["Financial Year", master.int_financial_year],
    ["Period Label", master.int_period_label],
    ["Period From", master.int_period_from],
    ["Period To", master.int_period_to],
    ["Scope", master.int_scope],
    ["Objectives", master.int_objectives],
    ["Methodology", master.int_methodology],
    [],
    ["Audit Firm", master.int_audit_firm],
    ["Partner Name", master.int_partner_name],
    ["Team Members", master.int_team_members],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(intRows), "Internal Audit Master");

  // Sheet 3 – Special Attention
  const saHeaders = ["Sr No", "Particulars", "Work Done", "Remarks", "Status", "Priority", "Due Date", "Done?"];
  const saData = specialAttentionItems.map(r => [
    r.sr_no, r.particulars, r.work_done, r.remarks,
    r.status, r.priority, r.due_date, r.is_done ? "Yes" : "No",
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([saHeaders, ...saData]), "Special Attention");

  // Sheet 4 – Audit Worksheet
  const wsHeaders = ["Sr No", "Area / Particulars", "Work Done", "Remarks", "Assigned To", "Status", "Priority", "Due Date", "Done?"];
  const wsData = worksheetItems.map(r => [
    r.sr_no, r.particulars, r.work_done, r.remarks, r.assigned_name,
    r.status, r.priority, r.due_date, r.is_done ? "Yes" : "No",
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([wsHeaders, ...wsData]), "Audit Worksheet");

  // Sheet 5 – Checklist
  const clHeaders = ["Sr No", "Document / Activity", "Remarks", "Done?"];
  const clData = checklistItems.map(r => [
    r.sr_no, r.particulars, r.remarks, r.is_done ? "✓" : "✗",
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([clHeaders, ...clData]), "Checklist");

  XLSX.writeFile(wb, `AuditWorksheet_${data.clientName || "Export"}_${data.financialYear || "FY"}.xlsx`);
}

// ─── PDF ───────────────────────────────────────────────────────────────────

async function exportPdf({ data, master, worksheetItems, specialAttentionItems, checklistItems }: Props) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const title = `Audit Worksheet — ${data.clientName || ""} | FY ${data.financialYear || ""}`;
  const firmLine = data.firmName ? `Firm: ${data.firmName}` : "";

  let y = 14;
  const addPageHeader = () => {
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(title, 14, y);
    if (firmLine) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(firmLine, 14, y + 6);
    }
    y += firmLine ? 14 : 8;
  };

  addPageHeader();

  // Tax Audit Master table
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Tax Audit Master", 14, y);
  y += 4;
  autoTable(doc, {
    startY: y,
    head: [["Field", "Value", "Field", "Value"]],
    body: [
      ["Client Name", master.tax_client_name, "PAN", master.tax_pan],
      ["Financial Year", master.tax_financial_year, "Section", master.tax_section],
      ["Period From", master.tax_period_from, "Period To", master.tax_period_to],
      ["Turnover", master.tax_turnover, "Form Type", master.tax_form_type],
      ["Accounting Method", master.tax_accounting_method, "Entity Type", master.tax_entity_type],
      ["Auditor Firm", master.tax_auditor_firm, "ICAI Reg", master.tax_icai_reg],
      ["Partner", master.tax_partner_name, "UDIN", master.tax_udin],
    ],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [59, 130, 246] },
    columnStyles: { 0: { fontStyle: "bold" }, 2: { fontStyle: "bold" } },
    theme: "grid",
  });

  // Worksheet items
  doc.addPage();
  y = 14;
  addPageHeader();
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Audit Worksheet", 14, y);
  y += 4;
  autoTable(doc, {
    startY: y,
    head: [["Sr", "Area / Particulars", "Work Done", "Remarks", "Assigned To", "Status", "Due Date", "Done"]],
    body: worksheetItems.map(r => [
      r.sr_no, r.particulars, r.work_done, r.remarks, r.assigned_name,
      r.status, r.due_date, r.is_done ? "✓" : "",
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    headStyles: { fillColor: [16, 185, 129] },
    theme: "grid",
  });

  // Special Attention
  if (specialAttentionItems.length > 0) {
    doc.addPage();
    y = 14;
    addPageHeader();
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Special Attention Items", 14, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["Sr", "Particulars", "Work Done", "Remarks", "Status", "Priority", "Done"]],
      body: specialAttentionItems.map(r => [
        r.sr_no, r.particulars, r.work_done, r.remarks, r.status, r.priority, r.is_done ? "✓" : "",
      ]),
      styles: { fontSize: 7.5, cellPadding: 1.5 },
      headStyles: { fillColor: [245, 158, 11] },
      theme: "grid",
    });
  }

  // Checklist
  doc.addPage();
  y = 14;
  addPageHeader();
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Audit Documentation Checklist", 14, y);
  y += 4;
  autoTable(doc, {
    startY: y,
    head: [["Sr", "Document / Activity", "Remarks", "Done"]],
    body: checklistItems.map(r => [r.sr_no, r.particulars, r.remarks, r.is_done ? "✓" : "✗"]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [99, 102, 241] },
    theme: "grid",
  });

  doc.save(`AuditWorksheet_${data.clientName || "Export"}_${data.financialYear || "FY"}.pdf`);
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function ExportButtons(props: Props) {
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-green-700 border-green-300 hover:bg-green-50"
        onClick={() => exportExcel(props)}
      >
        <Download size={14} /> Excel
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-red-700 border-red-300 hover:bg-red-50"
        onClick={() => exportPdf(props)}
      >
        <FileText size={14} /> PDF
      </Button>
    </div>
  );
}
