import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

/**
 * Genius XLS Export — writes data into the exact template format used by Genius Software.
 * Templates are bundled in public/tds-templates/{form}.xls
 * 
 * Template structure (from actual Genius files):
 * 
 * ALL FORMS share ChallanDetails headers (row 0):
 *   C0: Challan Serial No. | C1: Section/Collection Code | C2: Income Tax | C3: Surcharge
 *   C4: Health and Education Cess | C5: Interest | C6: Late Fee u/s 234E | C7: Others
 *   C8: Total Tax Deposited | C9: Cheque/DD No. | C10: BSR Code
 *   C11: Date on which Tax Deposited | C12: Bank Challan No./Transfer Voucher No.
 *   C13: Whether deposited by book entry?Yes/No | C14: Minor Head of Challan
 *   C15: Interest (As per Deductee Annexure) | C16: Others (As per Deductee Annexure)
 * 
 * DeductorDetails/EmployerDetails/CollectorDetails: 40 rows x 3 cols
 *   Col A = label, Col B = value, Col C = AY/Quarter/Form (rows 0-5 only)
 */

interface Filing {
  tan?: string;
  financial_year?: string;
  quarter?: string;
  return_type?: string;
  previous_receipt_number?: string;
  [key: string]: any;
}

interface Client {
  id: string;
  name?: string | null;
  pan?: string | null;
  tan_number?: string | null;
  address?: string | null;
  email?: string | null;
  registered_state?: string | null;
  [key: string]: any;
}

interface Challan {
  id: string;
  challan_serial_no?: string;
  section_code?: string;
  total_tax_deposited?: number;
  surcharge_deposited?: number;
  education_cess_deposited?: number;
  interest_deposited?: number;
  late_fee?: number;
  other_amount?: number;
  total_challan_amount?: number;
  cheque_dd_no?: string;
  bsr_code?: string;
  deposit_date?: string;
  is_book_entry?: boolean;
  minor_head_of_challan?: string;
  [key: string]: any;
}

interface Deductee {
  challan_id: string;
  section_code?: string;
  deductee_type?: string;
  deductee_pan?: string;
  deductee_ref_no?: string;
  deductee_name?: string;
  amount_paid_credited?: number;
  date_of_payment?: string;
  rate_of_tds?: number;
  surcharge_rate?: number;
  tds_amount?: number;
  surcharge_amount?: number;
  cess_amount?: number;
  total_tax_deducted?: number;
  date_of_deduction?: string;
  reason_for_lower_or_nil_deduction?: string;
  lower_deduction_certificate_no?: string;
  country_of_residence?: string;
  [key: string]: any;
}

const fmtDateGenius = (d: string | null | undefined): string => {
  if (!d) return "";
  try {
    const dt = new Date(d);
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch { return ""; }
};

const fyToAY = (fy: string): string => {
  const parts = fy.split("-");
  if (parts.length === 2) {
    const startYear = parseInt(parts[0]);
    return `${startYear + 1}-${String(startYear + 2).slice(2)}`;
  }
  return fy;
};

export async function generateGeniusExport(
  formType: string,
  filing: Filing,
  client: Client,
  challans: Challan[],
  deductees: Deductee[],
): Promise<void> {
  // Try Supabase storage (user-uploaded template) first, then bundled default
  let wb: XLSX.WorkBook;
  try {
    const { data: storageData } = await supabase.storage.from("tds-templates").download(`${formType}.xls`);
    if (storageData) {
      const buf = await storageData.arrayBuffer();
      wb = XLSX.read(buf, { type: "array" });
    } else {
      throw new Error("No storage template");
    }
  } catch {
    try {
      const resp = await fetch(`/tds-templates/${formType}.xls`);
      if (!resp.ok) throw new Error("Not found");
      const buf = await resp.arrayBuffer();
      wb = XLSX.read(buf, { type: "array" });
    } catch {
      wb = XLSX.utils.book_new();
    }
  }

  const ay = fyToAY(filing.financial_year || "2025-26");
  const quarter = filing.quarter || "Q1";
  const isRevised = filing.return_type === "Correction" ? "Y" : "N";

  // Internal template sheet names (as they appear in the Genius-generated template files)
  const internalDetailName = formType === "24Q" ? "EmployerDetails"
    : formType === "27EQ" ? "CollectorDetails"
    : "DeductorDetails";
  // Output sheet names (what Genius Import actually looks for — spaces matter)
  const detailSheetName = formType === "24Q" ? "Employer Details"
    : formType === "27EQ" ? "Collector Details"
    : "Deductor Details";

  // Read from template using internal name, then we'll rename before saving
  let wsDetail = wb.Sheets[internalDetailName] || wb.Sheets[detailSheetName];
  if (!wsDetail) {
    wsDetail = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(wb, wsDetail, detailSheetName);
  }

  const setCell = (ws: XLSX.WorkSheet, r: number, c: number, v: any) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    ws[addr] = { t: typeof v === "number" ? "n" : "s", v };
  };

  setCell(wsDetail, 0, 1, filing.tan || client.tan_number || "");
  setCell(wsDetail, 0, 2, "A.Y.");
  setCell(wsDetail, 1, 1, client.pan || "");
  setCell(wsDetail, 1, 2, ay);
  setCell(wsDetail, 2, 1, client.name || "");
  setCell(wsDetail, 2, 2, "Quarter");
  setCell(wsDetail, 3, 1, "0");
  setCell(wsDetail, 3, 2, quarter);
  setCell(wsDetail, 4, 1, "");
  setCell(wsDetail, 4, 2, "Form No.");
  setCell(wsDetail, 5, 1, "");
  setCell(wsDetail, 5, 2, formType);
  setCell(wsDetail, 6, 1, "");
  setCell(wsDetail, 7, 1, "");
  setCell(wsDetail, 8, 1, "");
  setCell(wsDetail, 9, 1, client.registered_state || "");
  setCell(wsDetail, 10, 1, "");
  setCell(wsDetail, 11, 1, client.email || "");
  setCell(wsDetail, 14, 1, "No");
  setCell(wsDetail, 15, 1, "O - Other than Central Government");
  setCell(wsDetail, 29, 1, isRevised);
  if (isRevised === "Y" && filing.previous_receipt_number) {
    setCell(wsDetail, 30, 1, filing.previous_receipt_number);
  }

  if (!wsDetail["!ref"]) {
    wsDetail["!ref"] = "A1:C40";
  }

  // Read from template (internal name "ChallanDetails"), output as "Challan Details"
  let wsChallan = wb.Sheets["ChallanDetails"] || wb.Sheets["Challan Details"];
  if (!wsChallan) {
    const headers = [
      "Challan Serial No.", "Section Code", "Income Tax", "Surcharge",
      "Health and Education Cess", "Interest", "Late Fee\nu/s 234E", "Others",
      "Total Tax Deposited", "Cheque/DD No.", "BSR Code",
      "Date on which Tax Deposited", "Bank Challan No./Transfer Voucher No.",
      "Whether deposited by book entry?Yes/No", "Minor Head of Challan",
      "Interest (As per Deductee Annexure)", "Others (As per Deductee Annexure)",
    ];
    wsChallan = XLSX.utils.aoa_to_sheet([headers]);
    XLSX.utils.book_append_sheet(wb, wsChallan, "Challan Details");
  }

  const challanRange = XLSX.utils.decode_range(wsChallan["!ref"] || "A1:Q1");
  for (let r = 1; r <= Math.max(challanRange.e.r, challans.length + 1); r++) {
    for (let c = 0; c <= 16; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      delete wsChallan[addr];
    }
  }

  challans.forEach((ch, i) => {
    const r = i + 1;
    setCell(wsChallan, r, 0, i + 1);
    setCell(wsChallan, r, 1, ch.section_code || "");
    setCell(wsChallan, r, 2, ch.total_tax_deposited || 0);
    setCell(wsChallan, r, 3, ch.surcharge_deposited || 0);
    setCell(wsChallan, r, 4, ch.education_cess_deposited || 0);
    setCell(wsChallan, r, 5, ch.interest_deposited || 0);
    setCell(wsChallan, r, 6, ch.late_fee || 0);
    setCell(wsChallan, r, 7, ch.other_amount || 0);
    setCell(wsChallan, r, 8, ch.total_challan_amount || ch.total_tax_deposited || 0);
    setCell(wsChallan, r, 9, ch.cheque_dd_no || "");
    setCell(wsChallan, r, 10, ch.bsr_code || "");
    setCell(wsChallan, r, 11, fmtDateGenius(ch.deposit_date));
    setCell(wsChallan, r, 12, ch.challan_serial_no || "");
    setCell(wsChallan, r, 13, ch.is_book_entry ? "Yes" : "No");
    setCell(wsChallan, r, 14, ch.minor_head_of_challan || "200");
    setCell(wsChallan, r, 15, 0);
    setCell(wsChallan, r, 16, 0);
  });

  wsChallan["!ref"] = `A1:Q${challans.length + 1}`;

  // Genius Import expects "Challan Details" (with space). Rename template sheet if needed.
  const challanSheetIdx = wb.SheetNames.indexOf("ChallanDetails");
  if (challanSheetIdx >= 0) wb.SheetNames[challanSheetIdx] = "Challan Details";

  // Annexure sheet: Genius Import expects "Deductee Details" / "Party Details"
  // Template has "Annex-I_DeducteeDetails" / "Annex-I_PartyDetails"
  const annexSheetName = formType === "27EQ" ? "Annex-I_PartyDetails" : "Annex-I_DeducteeDetails";
  const challanIndexMap = new Map<string, number>();
  challans.forEach((ch, i) => challanIndexMap.set(ch.id, i + 1));

  if (formType === "26Q") {
    let wsAnnex = wb.Sheets[annexSheetName];
    if (!wsAnnex) {
      const headers = [
        "Challan Serial No.", "Section Code", "Deductee Code",
        "Permanent Account Number (PAN) of deductee", "Deductee Ref. No. / PAN Ref. No.",
        "Name of Deductee", "Deductee  Address1", "Deductee  Address2",
        "Deductee  Address3", "Deductee  Address4", "Deductee  Address5",
        "Deductee State", "Deductee  PIN", "Amount of Payment",
        "Date on which Amount paid / credited", "Rate at which Tax deducted",
        "Surcharge Rate", "Health and Education Cess Rate",
        "Amount of Tax deducted", "Surcharge Amount", "Health and Education Cess Amount",
        "Total Tax Deposited", "Date on which tax deducted",
        "Reason for Non-deduction/Lower Deduction/Deduction at Higher Rate, if any",
        "Certificate number",
        "Amount of cash withdrawal in excess of Rs. 1 Crore (Section 194N)",
        "Amount of cash withdrawal in excess of Rs. 20 Lakhs but not excess of Rs. 1 Crore",
        "Amount of cash withdrawal which is in access of Rs. 1 Crore",
        "Email Id of the Deductee",
      ];
      wsAnnex = XLSX.utils.aoa_to_sheet([headers]);
      XLSX.utils.book_append_sheet(wb, wsAnnex, annexSheetName);
    }

    const annexRange = XLSX.utils.decode_range(wsAnnex["!ref"] || "A1:AC1");
    for (let r = 1; r <= Math.max(annexRange.e.r, deductees.length + 1); r++) {
      for (let c = 0; c <= 28; c++) {
        delete wsAnnex[XLSX.utils.encode_cell({ r, c })];
      }
    }

    deductees.forEach((d, i) => {
      const r = i + 1;
      const challanSr = challanIndexMap.get(d.challan_id) || 1;
      const cessRate = 4;
      const cessAmt = d.cess_amount || Math.round(((d.tds_amount || 0) + (d.surcharge_amount || 0)) * 0.04 * 100) / 100;

      setCell(wsAnnex, r, 0, challanSr);
      setCell(wsAnnex, r, 1, d.section_code || "");
      setCell(wsAnnex, r, 2, d.deductee_type === "Company" ? "01" : "02");
      setCell(wsAnnex, r, 3, d.deductee_pan || "");
      setCell(wsAnnex, r, 4, d.deductee_ref_no || "");
      setCell(wsAnnex, r, 5, d.deductee_name || "");
      for (let c = 6; c <= 12; c++) setCell(wsAnnex, r, c, "");
      setCell(wsAnnex, r, 13, d.amount_paid_credited || 0);
      setCell(wsAnnex, r, 14, fmtDateGenius(d.date_of_payment));
      setCell(wsAnnex, r, 15, d.rate_of_tds || 0);
      setCell(wsAnnex, r, 16, d.surcharge_rate || 0);
      setCell(wsAnnex, r, 17, cessRate);
      setCell(wsAnnex, r, 18, Math.round(d.tds_amount || 0));
      setCell(wsAnnex, r, 19, d.surcharge_amount || 0);
      setCell(wsAnnex, r, 20, cessAmt);
      setCell(wsAnnex, r, 21, d.total_tax_deducted || d.tds_amount || 0);
      setCell(wsAnnex, r, 22, fmtDateGenius(d.date_of_deduction || d.date_of_payment));
      setCell(wsAnnex, r, 23, d.reason_for_lower_or_nil_deduction || "");
      setCell(wsAnnex, r, 24, d.lower_deduction_certificate_no || "");
      setCell(wsAnnex, r, 25, "");
      setCell(wsAnnex, r, 26, "");
      setCell(wsAnnex, r, 27, "");
      setCell(wsAnnex, r, 28, "");
    });

    wsAnnex["!ref"] = `A1:AC${deductees.length + 1}`;

  } else if (formType === "24Q") {
    let wsAnnex = wb.Sheets[annexSheetName];
    if (!wsAnnex) {
      const headers = [
        "Challan Serial No.", "Section Code", "Employee Reference No. Provided by Employer",
        "PAN of the Employee", "PAN Ref. No.", "Name of Employee",
        "Date of Payment/Credited", "Taxable amount on which Tax Deducted",
        "TDS", "Surcharge", "Health and Education Cess", "Total Tax Deposited",
        "Date of Deduction", "Reason for Non-deduction / Lower Deduction, if any",
        "Certificate number", "Email Id of the Deductee",
      ];
      wsAnnex = XLSX.utils.aoa_to_sheet([headers]);
      XLSX.utils.book_append_sheet(wb, wsAnnex, annexSheetName);
    }

    const annexRange = XLSX.utils.decode_range(wsAnnex["!ref"] || "A1:P1");
    for (let r = 1; r <= Math.max(annexRange.e.r, deductees.length + 1); r++) {
      for (let c = 0; c <= 15; c++) {
        delete wsAnnex[XLSX.utils.encode_cell({ r, c })];
      }
    }

    deductees.forEach((d, i) => {
      const r = i + 1;
      const challanSr = challanIndexMap.get(d.challan_id) || 1;
      setCell(wsAnnex, r, 0, challanSr);
      setCell(wsAnnex, r, 1, d.section_code || "192");
      setCell(wsAnnex, r, 2, d.deductee_ref_no || "");
      setCell(wsAnnex, r, 3, d.deductee_pan || "");
      setCell(wsAnnex, r, 4, "");
      setCell(wsAnnex, r, 5, d.deductee_name || "");
      setCell(wsAnnex, r, 6, fmtDateGenius(d.date_of_payment));
      setCell(wsAnnex, r, 7, d.amount_paid_credited || 0);
      setCell(wsAnnex, r, 8, Math.round(d.tds_amount || 0));
      setCell(wsAnnex, r, 9, d.surcharge_amount || 0);
      setCell(wsAnnex, r, 10, d.cess_amount || 0);
      setCell(wsAnnex, r, 11, d.total_tax_deducted || d.tds_amount || 0);
      setCell(wsAnnex, r, 12, fmtDateGenius(d.date_of_deduction || d.date_of_payment));
      setCell(wsAnnex, r, 13, d.reason_for_lower_or_nil_deduction || "");
      setCell(wsAnnex, r, 14, d.lower_deduction_certificate_no || "");
      setCell(wsAnnex, r, 15, "");
    });

    wsAnnex["!ref"] = `A1:P${deductees.length + 1}`;

  } else if (formType === "27Q") {
    let wsAnnex = wb.Sheets[annexSheetName];
    if (!wsAnnex) {
      const headers = [
        "Challan Serial No.", "Section Code", "Deductee Code",
        "Permanent Account Number (PAN) of deductee", "PAN Ref. No.",
        "Name of Deductee", "Deductee  Address1", "Deductee  Address2",
        "Deductee  Address3", "Deductee  Address4", "Deductee  Address5",
        "Deductee State", "Deductee  PIN", "Amount of Payment",
        "Date on which Amount paid / credited", "Rate at which Tax deducted",
        "Surcharge Rate", "Health and Education Cess Rate",
        "Amount of Tax deducted", "Surcharge Amount", "Health and Education Cess Amount",
        "Total Tax Deposited", "Date on which tax deducted",
        "Reason for Non-deduction/Lower Deduction/Deduction at Higher Rate, if any",
        "Certificate number", "Grossing Up", "Whether TDS Rate is as per DTAA",
        "Nature of Remittance", "Ack. No. of Form 15CA",
        "Country of Residence of the Deductee", "Email Id of the Deductee",
        "Contact Number of the Deductee", "Address of Deductee in Country of Residence",
        "Tax Identification Number", 
        "Amount of cash withdrawal in excess of Rs. 1 Crore",
        "Amount of cash withdrawal in excess of Rs. 20 Lakhs",
        "Amount of cash withdrawal which is in access of Rs. 1 Crore",
        "Whether deductee opting out of taxation regime u/s 115BAC (1A)? (Y/N)",
      ];
      wsAnnex = XLSX.utils.aoa_to_sheet([headers]);
      XLSX.utils.book_append_sheet(wb, wsAnnex, annexSheetName);
    }

    const annexRange = XLSX.utils.decode_range(wsAnnex["!ref"] || "A1:AL1");
    for (let r = 1; r <= Math.max(annexRange.e.r, deductees.length + 1); r++) {
      for (let c = 0; c <= 37; c++) {
        delete wsAnnex[XLSX.utils.encode_cell({ r, c })];
      }
    }

    deductees.forEach((d, i) => {
      const r = i + 1;
      const challanSr = challanIndexMap.get(d.challan_id) || 1;
      const cessRate = 4;
      const cessAmt = d.cess_amount || Math.round(((d.tds_amount || 0) + (d.surcharge_amount || 0)) * 0.04 * 100) / 100;

      setCell(wsAnnex, r, 0, challanSr);
      setCell(wsAnnex, r, 1, d.section_code || "");
      setCell(wsAnnex, r, 2, d.deductee_type === "Company" ? "01" : "02");
      setCell(wsAnnex, r, 3, d.deductee_pan || "");
      setCell(wsAnnex, r, 4, "");
      setCell(wsAnnex, r, 5, d.deductee_name || "");
      for (let c = 6; c <= 12; c++) setCell(wsAnnex, r, c, "");
      setCell(wsAnnex, r, 13, d.amount_paid_credited || 0);
      setCell(wsAnnex, r, 14, fmtDateGenius(d.date_of_payment));
      setCell(wsAnnex, r, 15, d.rate_of_tds || 0);
      setCell(wsAnnex, r, 16, d.surcharge_rate || 0);
      setCell(wsAnnex, r, 17, cessRate);
      setCell(wsAnnex, r, 18, Math.round(d.tds_amount || 0));
      setCell(wsAnnex, r, 19, d.surcharge_amount || 0);
      setCell(wsAnnex, r, 20, cessAmt);
      setCell(wsAnnex, r, 21, d.total_tax_deducted || d.tds_amount || 0);
      setCell(wsAnnex, r, 22, fmtDateGenius(d.date_of_deduction || d.date_of_payment));
      setCell(wsAnnex, r, 23, d.reason_for_lower_or_nil_deduction || "");
      setCell(wsAnnex, r, 24, d.lower_deduction_certificate_no || "");
      setCell(wsAnnex, r, 25, "");
      setCell(wsAnnex, r, 26, "");
      setCell(wsAnnex, r, 27, "");
      setCell(wsAnnex, r, 28, "");
      setCell(wsAnnex, r, 29, d.country_of_residence || "");
      setCell(wsAnnex, r, 30, "");
      setCell(wsAnnex, r, 31, "");
      setCell(wsAnnex, r, 32, "");
      setCell(wsAnnex, r, 33, "");
      setCell(wsAnnex, r, 34, "");
      setCell(wsAnnex, r, 35, "");
      setCell(wsAnnex, r, 36, "");
      setCell(wsAnnex, r, 37, "");
    });

    wsAnnex["!ref"] = `A1:AL${deductees.length + 1}`;

  } else if (formType === "27EQ") {
    let wsAnnex = wb.Sheets[annexSheetName];
    if (!wsAnnex) {
      const headers = [
        "Challan Serial No.", "Collection Code", "Party Code",
        "Permanent Account Number (PAN) of Party", "PAN Ref. No.",
        "Name of Party", "Party  Address1", "Party  Address2",
        "Party  Address3", "Party  Address4", "Party  Address5",
        "Party State", "Party PIN", "Total Value of Purchases",
        "Amount Paid", "Date on which Amount Paid/debited",
        "Rate at which Tax collected", "Surcharge Rate",
        "Health and Education Cess Rate", "Amount of Tax collected",
        "Surcharge Amount", "Health and Education Cess Amount",
        "Total Tax Deposited", "Date on which tax collected",
        "Reason for Lower collection, if any", "Certificate number",
        "Deductee is Non-Resident", "Deductee is having Permanent Establishment in India",
        "Whether the payment by collectee is liable to TDS",
        "Challan No.", "Date of payment of TDS to Central Government",
        "Email Id of the Party",
        "Whether deductee opting out of taxation regime u/s 115BAC (1A)? (Y/N)",
      ];
      wsAnnex = XLSX.utils.aoa_to_sheet([headers]);
      XLSX.utils.book_append_sheet(wb, wsAnnex, annexSheetName);
    }

    const annexRange = XLSX.utils.decode_range(wsAnnex["!ref"] || "A1:AG1");
    for (let r = 1; r <= Math.max(annexRange.e.r, deductees.length + 1); r++) {
      for (let c = 0; c <= 32; c++) {
        delete wsAnnex[XLSX.utils.encode_cell({ r, c })];
      }
    }

    deductees.forEach((d, i) => {
      const r = i + 1;
      const challanSr = challanIndexMap.get(d.challan_id) || 1;
      const cessRate = 4;
      const cessAmt = d.cess_amount || Math.round(((d.tds_amount || 0) + (d.surcharge_amount || 0)) * 0.04 * 100) / 100;

      setCell(wsAnnex, r, 0, challanSr);
      setCell(wsAnnex, r, 1, d.section_code || "");
      setCell(wsAnnex, r, 2, d.deductee_type === "Company" ? "01" : "02");
      setCell(wsAnnex, r, 3, d.deductee_pan || "");
      setCell(wsAnnex, r, 4, "");
      setCell(wsAnnex, r, 5, d.deductee_name || "");
      for (let c = 6; c <= 12; c++) setCell(wsAnnex, r, c, "");
      setCell(wsAnnex, r, 13, d.amount_paid_credited || 0);
      setCell(wsAnnex, r, 14, d.amount_paid_credited || 0);
      setCell(wsAnnex, r, 15, fmtDateGenius(d.date_of_payment));
      setCell(wsAnnex, r, 16, d.rate_of_tds || 0);
      setCell(wsAnnex, r, 17, d.surcharge_rate || 0);
      setCell(wsAnnex, r, 18, cessRate);
      setCell(wsAnnex, r, 19, d.tds_amount || 0);
      setCell(wsAnnex, r, 20, d.surcharge_amount || 0);
      setCell(wsAnnex, r, 21, cessAmt);
      setCell(wsAnnex, r, 22, d.total_tax_deducted || d.tds_amount || 0);
      setCell(wsAnnex, r, 23, fmtDateGenius(d.date_of_deduction || d.date_of_payment));
      setCell(wsAnnex, r, 24, d.reason_for_lower_or_nil_deduction || "");
      setCell(wsAnnex, r, 25, d.lower_deduction_certificate_no || "");
      for (let c = 26; c <= 32; c++) setCell(wsAnnex, r, c, "");
    });

    wsAnnex["!ref"] = `A1:AG${deductees.length + 1}`;
  }

  // ── Rename template sheet names to Genius Import expected names ──────────────
  // Genius Import looks for "Deductee Details" / "Party Details" (with spaces).
  // Templates have "Annex-I_DeducteeDetails" / "Annex-I_PartyDetails" (no space).
  // Also rename detail sheets (DeductorDetails → Deductor Details, etc.)
  const nameMap: Record<string, string> = {
    "Annex-I_DeducteeDetails": "Deductee Details",
    "Annex-I_PartyDetails": "Party Details",
    "DeductorDetails": "Deductor Details",
    "EmployerDetails": "Employer Details",
    "CollectorDetails": "Collector Details",
    "ChallanDetails": "Challan Details",
  };
  wb.SheetNames = wb.SheetNames.map(n => nameMap[n] ?? n);

  const fileName = `Genius_${formType}_${(client.name || "Client").replace(/[^a-zA-Z0-9]/g, "_")}_${filing.financial_year || "FY"}_${quarter}.xls`;
  XLSX.writeFile(wb, fileName, { bookType: "xls" });
}
