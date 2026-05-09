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

  /** Map of corporate FS code → dynamic note number from the registry.
   *  Written into the BS Note-No column (D) and PL Note-No column (F),
   *  replacing the template's "[01 Apr ...]_ AUTO" placeholder. */
  noteNumbers?:  Record<string, number | null | undefined>;
}

// ─── Cell mappings ───────────────────────────────────────────────────────────
// IMPORTANT: corporate template column letters differ from NCE template:
//   BS sheet  →  D = Note No,  E = CY amount,  F = PY amount
//   PL sheet  →  F = Note No,  G = CY amount,  H = PY amount
// (The G/H pair on the BS sheet — visible to the right of the printed
//  table — is unbordered overflow space, NOT the data columns.)

// Cross-sheet cell coordinates per sheet:
const BS_NOTE_COL = "D";
const BS_CY_COL   = "E";
const BS_PY_COL   = "F";
const PL_NOTE_COL = "F";
const PL_CY_COL   = "G";
const PL_PY_COL   = "H";

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
  // Date range for "Previous year" = full FY span.  Template currently
  // shows literal "[01 Apr 2025 to 31 Mar 2026]" — we substitute with the
  // engagement's actual FY span derived from cyYear.
  const fyStartYear  = i.cyYear - 1;
  const fyDateRange  = `01 Apr ${fyStartYear} to 31 Mar ${i.cyYear}`;

  return {
    // ── Plain placeholders (no AUTO suffix) ────────────────────────────────
    "[NAME OF THE COMPANY]":       i.entityName || "",
    "[ADDRESS]":                   i.address || "",
    "[NAME OF AUDITOR / FIRM]":    i.firmName || "",
    "[NAME OF FIRM]":              i.firmName || "",
    "[FRN]":                       i.firmFRN || "",
    "[NAME OF SIGNING PARTNER / PROPRIETOR]": i.partnerName || "",
    "[SIGNING PARTNER / PROPRIETOR]": i.partnerName || "",
    "[NAME]":                      i.partnerName || "",
    "[PLACE]":                     i.place || "",
    "[DATE]":                      i.reportDate || "",
    "[BALANCE SHEET DATE]":        `31 March, ${i.cyYear}`,
    "[STATUTORY AUDITOR NAME]":    i.firmName || "",
    "[DIRECTOR NAME]":             "",
    "[NAME AND ADDRESS OF ASSESSEE WITH PAN / AADHAAR]":
      [i.entityName, i.address, i.pan ? `PAN: ${i.pan}` : ""].filter(Boolean).join(", "),
    "[APPLICABLE ACT]":            "Companies Act, 2013",
    "[DETAILS]":                   "",
    "[XXXXXXXXXXXX]":              "",
    "[XXXXXX]":                    "",

    // ── "_ AUTO" variants ──────────────────────────────────────────────────
    // Many template cells store the placeholder + "_ AUTO" suffix as a
    // single string (e.g. "[ENTER ENTITY NAME]_ AUTO").  We map the FULL
    // string so the entire cell gets replaced — no dangling "_ AUTO".
    "[ENTER ENTITY NAME]_ AUTO":   i.entityName || "",
    "[ENTER ADDRESS]_ AUTO":       i.address || "",
    "[ENTER PAN]_ AUTO":           i.pan || "",
    "[ENTER TAN]_ AUTO":           i.tan || "",
    "[ENTER GSTIN]_ AUTO":         i.gstin || "",
    "[ENTER BUSINESS]_ AUTO":      i.business || "",
    "[ENTER FIRM NAME]_ AUTO":     i.firmName || "",
    "[ENTER FRN]_ AUTO":           i.firmFRN || "",
    "[ENTER SIGNATORY NAME]_ AUTO": i.partnerName || "",
    "[ENTER MEMBERSHIP NO.]_ AUTO": i.membershipNo || "",
    "[ENTER UDIN]_ AUTO":          i.udin || "",
    "[ENTER PLACE]_ AUTO":         i.place || "",
    "[ENTER DATE]_ AUTO":          i.reportDate || "",
    "[ENTER REPORT DATE]_ AUTO":   i.reportDate || "",
    "[ENTER DETAILS]_ AUTO":       "",
    // "[01 Apr 2025 to 31 Mar 2026]_ AUTO" is the literal hardcoded year
    // range in the template — substitute with engagement's actual FY span.
    "[01 Apr 2025 to 31 Mar 2026]_ AUTO":   fyDateRange,
    "[2026-27]_ AUTO":             i.assessmentYear || "",
    "_____ AUTO":                  `31 March, ${i.cyYear}`,

    // ── Bare placeholders without AUTO (keep as fallback for other sheets) ─
    "[ENTER ENTITY NAME]":         i.entityName || "",
    "[ENTER ADDRESS]":             i.address || "",
    "[ENTER PAN]":                 i.pan || "",
    "[ENTER GSTIN]":               i.gstin || "",
    "[ENTER TAN]":                 i.tan || "",
    "[ENTER BUSINESS]":            i.business || "",
    "[ENTER FIRM NAME]":           i.firmName || "",
    "[ENTER FRN]":                 i.firmFRN || "",
    "[ENTER SIGNATORY NAME]":      i.partnerName || "",
    "[ENTER MEMBERSHIP NO.]":      i.membershipNo || "",
    "[ENTER UDIN]":                i.udin || "",
    "[ENTER PLACE]":               i.place || "",
    "[ENTER DATE]":                i.reportDate || "",
    "[ENTER REPORT DATE]":         i.reportDate || "",
    "[ENTER DETAILS]":             "",
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

  // 4. Fill Balance Sheet amounts (sheet "BS") — columns E (CY) / F (PY).
  //    Also writes the dynamic note number to D when supplied.  Each cell
  //    overwrite replaces the template's cross-sheet pull formula
  //    ('Note BS-Liab'!Gxx) with a direct value, so the printed BS is
  //    self-contained (no inter-sheet dependency).
  const bs = wb.getWorksheet("BS");
  if (bs) {
    const noteMap = inputs.noteNumbers ?? {};
    for (const [code, row] of Object.entries(BS_ROW_MAP)) {
      const amt = inputs.amounts[code];
      if (amt) {
        bs.getCell(`${BS_CY_COL}${row}`).value = round2(amt.cy);
        bs.getCell(`${BS_PY_COL}${row}`).value = round2(amt.py);
      }
      const noteNo = noteMap[code];
      const noteCell = bs.getCell(`${BS_NOTE_COL}${row}`);
      if (noteNo != null && Number.isFinite(noteNo)) {
        noteCell.value = noteNo;
      } else {
        // Clear the "[01 Apr ...]_ AUTO" placeholder when no note applies.
        noteCell.value = "";
      }
    }
  }

  // 5. Fill P&L amounts (sheet "PL") — columns G (CY) / H (PY), Note No in F.
  const pl = wb.getWorksheet("PL");
  if (pl) {
    const noteMap = inputs.noteNumbers ?? {};
    for (const [code, row] of Object.entries(PL_ROW_MAP)) {
      const amt = inputs.amounts[code];
      if (amt) {
        pl.getCell(`${PL_CY_COL}${row}`).value = round2(amt.cy);
        pl.getCell(`${PL_PY_COL}${row}`).value = round2(amt.py);
      }
      const noteNo = noteMap[code];
      const noteCell = pl.getCell(`${PL_NOTE_COL}${row}`);
      if (noteNo != null && Number.isFinite(noteNo)) {
        noteCell.value = noteNo;
      } else {
        noteCell.value = "";
      }
    }
  }

  // 5b. Update cached results of cross-sheet formulas that reference the
  //     BS Note-No column.  The Note BS-Liab / BS-Asset / PL sheets have
  //     section headings whose value is `+BS!D<row>` (a formula pulling
  //     the note number from the BS sheet's Note-No column).  ExcelJS
  //     preserves the formula but keeps the OLD cached "AUTO" string as
  //     <v>, so Excel shows "AUTO Share capital" until the user presses
  //     F9 to recompute.  Patch the cached result to the actual note
  //     number we wrote to BS!Dxx so Excel renders correctly on open.
  //
  //     Also force fullCalcOnLoad so Excel re-evaluates every formula
  //     when the file is first opened — belt-and-braces fallback for
  //     formulas we don't explicitly patch.
  const bsNoteByRow: Record<number, number> = {};
  for (const [code, row] of Object.entries(BS_ROW_MAP)) {
    const nn = inputs.noteNumbers?.[code];
    if (nn != null && Number.isFinite(nn)) bsNoteByRow[row] = nn;
  }
  const plNoteByRow: Record<number, number> = {};
  for (const [code, row] of Object.entries(PL_ROW_MAP)) {
    const nn = inputs.noteNumbers?.[code];
    if (nn != null && Number.isFinite(nn)) plNoteByRow[row] = nn;
  }

  // Patch any formula cell whose formula matches BS!D<row> or PL!F<row>
  // — replace the cached result with the dynamic note number so Excel
  // displays it before recalc.
  const reBsD = /BS!\$?D\$?(\d+)/i;
  const rePlF = /PL!\$?F\$?(\d+)/i;
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        // Cell.formula returns the formula string; cell.value returns
        // an object { formula, result } when it's a formula cell.
        const v: any = cell.value;
        if (!v || typeof v !== "object" || !("formula" in v)) return;
        const f: string = v.formula;
        const mBs = f.match(reBsD);
        const mPl = f.match(rePlF);
        let newResult: any = undefined;
        if (mBs) {
          const tgtRow = parseInt(mBs[1], 10);
          if (bsNoteByRow[tgtRow] != null) newResult = bsNoteByRow[tgtRow];
          else if (v.result === "AUTO") newResult = "";
        } else if (mPl) {
          const tgtRow = parseInt(mPl[1], 10);
          if (plNoteByRow[tgtRow] != null) newResult = plNoteByRow[tgtRow];
          else if (v.result === "AUTO") newResult = "";
        }
        if (newResult !== undefined) {
          cell.value = { formula: f, result: newResult } as any;
        }
      });
    });
  });

  // Force Excel to recompute every formula on open — covers any
  // cross-sheet formula whose cached result we didn't explicitly patch.
  (wb as any).calcProperties = { fullCalcOnLoad: true };

  // 5c. Strip stray "AUTO" / "_ AUTO" residue from STRING cells across
  //     every sheet so the final file is clean.  Substitution above
  //     handles the mapped placeholders; this catches any standalone
  //     "AUTO" cells and trailing "_ AUTO" suffixes that survived.
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "string") return;
        const original = cell.value;
        let v = original;
        if (v === "AUTO") {
          cell.value = "";
          return;
        }
        // Strip "_ AUTO" / " AUTO" suffix
        v = v.replace(/_? AUTO$/i, "");
        // Strip surrounding bracket placeholders that didn't match a key
        // (unmapped "[XYZ]_ AUTO" → empty rather than dangling text).
        v = v.replace(/^\[[^\]]+\]\s*$/, "");
        if (v !== original) cell.value = v;
      });
    });
  });

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
