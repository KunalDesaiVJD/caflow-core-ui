/**
 * fsExcelTemplateCorporate — fills the firm's
 * "CAFlow_Audit_Pack_Corporate_AY2026-27.xlsx" template with engagement
 * data and returns the resulting workbook as a Blob.
 *
 * Mirrors fsExcelTemplateNCE.ts but for Schedule III (Div I) corporate
 * entities.  The template is shipped as a public asset and only the data
 * cells / scalar placeholders are mutated at export time — every heading,
 * border, font and merged-cell from the firm's hand-crafted master is
 * preserved untouched.
 *
 * Template asset:  public/templates/corporate-financials.xlsx
 *   served at the runtime URL `/templates/corporate-financials.xlsx`.
 *
 * Sheet / row positions extracted from the template's xl/sharedStrings.xml
 * + xl/worksheets/sheet4.xml (BS) and sheet5.xml (PL).  Each row writes
 * column G (CY) and column H (PY).
 */

import ExcelJS from "exceljs";

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface CorporateFinancialsInputs {
  entityName:    string;
  entityType:    string;
  address:       string;
  pan:           string;
  gstin:         string;
  tan:           string;
  cin:           string;
  business:      string;
  financialYear: string;     // "2025-26"
  assessmentYear: string;    // "2026-27"
  cyYear:        number;     // 2026
  pyYear:        number;     // 2025
  firmName:      string;
  firmFRN:       string;
  partnerName:   string;
  membershipNo:  string;
  place:         string;
  reportDate:    string;     // already "DD/MM/YYYY"
  udin:          string;

  /**
   * Map of corporate FS code → { cy, py }.  Liability + revenue codes
   * are sign-flipped by the caller (positive face values).  Values in
   * the template are written as raw rupees with the existing cell
   * number-format (#,##0.00 etc.) preserved.
   */
  amounts:       Record<string, { cy: number; py: number }>;
}

// ─── Cell mappings ───────────────────────────────────────────────────────────

const BS_ROW_MAP: Record<string, number> = {
  // Equity & Liabilities (sheet "BS")
  BS_EQ_SC:       12,  // (a) Share capital
  BS_EQ_RS:       13,  // (b) Reserves and surplus
  // 15 = (2) Share application money pending allotment — leave 0
  BS_NCL_LTB:     18,  // (a) Long-term borrowings
  BS_NCL_DTL:     19,  // (b) Deferred tax liabilities (Net)
  BS_NCL_OLT:     20,  // (c) Other long-term liabilities
  BS_NCL_LTP:     21,  // (d) Long-term provisions
  BS_CL_STB:      24,  // (a) Short-term borrowings
  // 26 = (i) MSME — split out of trade payables; placed at row 27 (Others)
  BS_CL_TP:       27,  // (b) Trade payables — Others
  BS_CL_OCL:      28,  // (c) Other current liabilities
  BS_CL_STP:      29,  // (d) Short-term provisions
  // Assets
  BS_NCA_FA:      37,  // (a)(i) PPE + Intangible Assets (combined)
  BS_NCA_INV:     40,  // (b) Non-current investments
  BS_NCA_DTA:     41,  // (c) Deferred tax assets (Net)
  BS_NCA_LLA:     42,  // (d) Long-term loans and advances
  BS_NCA_ONA:     43,  // (e) Other non-current Assets
  BS_CA_CI:       46,  // (a) Current investments
  BS_CA_INV:      47,  // (b) Inventories
  BS_CA_TR:       48,  // (c) Trade receivables
  BS_CA_CCE:      49,  // (d) Cash and bank balances
  BS_CA_SLA:      50,  // (e) Short-term loans and advances
  BS_CA_OCA:      51,  // (f) Other current assets
};

const PL_ROW_MAP: Record<string, number> = {
  PL_REV_OPS:   9,    // I.   Revenue from operations
  PL_REV_OI:   10,    // II.  Other income
  // 11 = III. Total Income (formula in template — leave alone)
  PL_EXP_MAT:  14,    // Cost of materials consumed
  PL_EXP_SIT:  15,    // Purchases of Stock-in-Trade
  PL_EXP_EMP:  17,    // Employee benefits expense
  PL_EXP_FIN:  18,    // Finance costs
  PL_EXP_DEP:  19,    // Depreciation & Amortisation
  PL_EXP_OTH:  20,    // Other expenses
  PL_EXP_CII:  21,    // Changes in inventories
  PL_TAX_CUR:  30,    // (1) Current tax
  PL_TAX_DEF:  31,    // (2) Deferred tax
};

function buildPlaceholderMap(i: CorporateFinancialsInputs): Record<string, string> {
  return {
    "[NAME OF THE COMPANY]":       i.entityName || "",
    "[ENTER ENTITY NAME]":         i.entityName || "",
    "[ADDRESS]":                   i.address || "",
    "[ENTER ADDRESS]":             i.address || "",
    "[ENTER PAN]":                 i.pan || "",
    "[ENTER GSTIN]":               i.gstin || "",
    "[ENTER TAN]":                 i.tan || "",
    "[ENTER BUSINESS]":            i.business || "",
    "[NAME OF AUDITOR / FIRM]":    i.firmName || "",
    "[NAME OF FIRM]":              i.firmName || "",
    "[ENTER FIRM NAME]":           i.firmName || "",
    "[FRN]":                       i.firmFRN || "",
    "[ENTER FRN]":                 i.firmFRN || "",
    "[NAME OF SIGNING PARTNER / PROPRIETOR]": i.partnerName || "",
    "[SIGNING PARTNER / PROPRIETOR]": i.partnerName || "",
    "[ENTER SIGNATORY NAME]":      i.partnerName || "",
    "[NAME]":                      i.partnerName || "",
    "[ENTER MEMBERSHIP NO.]":      i.membershipNo || "",
    "[ENTER UDIN]":                i.udin || "",
    "[PLACE]":                     i.place || "",
    "[ENTER PLACE]":               i.place || "",
    "[DATE]":                      i.reportDate || "",
    "[ENTER DATE]":                i.reportDate || "",
    "[ENTER REPORT DATE]":         i.reportDate || "",
    "[BALANCE SHEET DATE]":        `31 March, ${i.cyYear}`,
    "[STATUTORY AUDITOR NAME]":    i.firmName || "",
    "[DIRECTOR NAME]":             "",
    "[NAME AND ADDRESS OF ASSESSEE WITH PAN / AADHAAR]":
      [i.entityName, i.address, i.pan ? `PAN: ${i.pan}` : ""].filter(Boolean).join(", "),
    "[APPLICABLE ACT]":            "Companies Act, 2013",
    "[DETAILS]":                   "",
    "[ENTER DETAILS]":             "",
    "[XXXXXXXXXXXX]":              "",
    "[XXXXXX]":                    "",
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function buildCorporateFinancialsXLSX(
  inputs: CorporateFinancialsInputs,
): Promise<Blob> {
  // 1. Fetch template
  const res = await fetch("/templates/corporate-financials.xlsx");
  if (!res.ok) {
    throw new Error(`Failed to load corporate template: HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();

  // 2. Open with ExcelJS
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  // 3. Substitute scalar placeholders across every sheet
  const placeholderMap = buildPlaceholderMap(inputs);
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === "string") {
          let v = cell.value;
          let dirty = false;
          for (const [from, to] of Object.entries(placeholderMap)) {
            if (v.includes(from)) {
              v = v.split(from).join(to);
              dirty = true;
            }
          }
          if (dirty) cell.value = v;
        }
        else if (cell.value && typeof cell.value === "object" && "richText" in (cell.value as any)) {
          const rt = cell.value as any;
          let dirty = false;
          for (const seg of rt.richText) {
            if (typeof seg.text === "string") {
              for (const [from, to] of Object.entries(placeholderMap)) {
                if (seg.text.includes(from)) {
                  seg.text = seg.text.split(from).join(to);
                  dirty = true;
                }
              }
            }
          }
          if (dirty) cell.value = rt;
        }
      });
    });
  });

  // 4. Fill Balance Sheet amounts (sheet name "BS")
  const bs = wb.getWorksheet("BS");
  if (bs) {
    for (const [code, row] of Object.entries(BS_ROW_MAP)) {
      const amt = inputs.amounts[code];
      if (!amt) continue;
      bs.getCell(`G${row}`).value = round2(amt.cy);
      bs.getCell(`H${row}`).value = round2(amt.py);
    }
  }

  // 5. Fill P&L amounts (sheet name "PL")
  const pl = wb.getWorksheet("PL");
  if (pl) {
    for (const [code, row] of Object.entries(PL_ROW_MAP)) {
      const amt = inputs.amounts[code];
      if (!amt) continue;
      pl.getCell(`G${row}`).value = round2(amt.cy);
      pl.getCell(`H${row}`).value = round2(amt.py);
    }
  }

  // 6. Replace year/date underscores in headings.
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "string") return;
        let v = cell.value;
        let dirty = false;
        if (v.includes("31 March, _____") || v.includes("31 March, ____") || v.includes("31 March, ___") || v.includes("31 March, __")) {
          v = v.replace(/31 March, _+/g, `31 March, ${inputs.cyYear}`);
          dirty = true;
        }
        if (v.includes("31st March, 20XX") || v.includes("31 March, 20XX")) {
          v = v.replace(/31(?:st)? March, 20XX/g, `31 March, ${inputs.cyYear}`);
          dirty = true;
        }
        if (dirty) cell.value = v;
      });
    });
  });

  // 7. Generate the buffer + Blob
  const out = await wb.xlsx.writeBuffer();
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function round2(n: number | null | undefined): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}
