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
    // Previous assessment year placeholder (e.g. "[2025-26]_ AUTO")
    // Derived from cyYear: e.g. 2026 → "2025-26"
    [`[${i.pyYear}-${String(i.cyYear).slice(-2)}]_ AUTO`]: `${i.pyYear}-${String(i.cyYear).slice(-2)}`,
    // NOTE: "_____ AUTO" handled by a smart regex below (NOT here) so it
    //       doesn't double-prefix cells that already contain "31 March, "
    //       and so PY-column cells can be patched separately to PY year.

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

  // 5c. Strip stray "AUTO" / "_ AUTO" residue from STRING and RICH-TEXT cells.
  //     Step 3 handles fully-mapped placeholders; this catches:
  //       • Standalone "AUTO" cells → cleared
  //       • Trailing "_ AUTO" / " AUTO" suffixes on plain strings
  //       • Trailing "_ AUTO" segments in rich-text cells (e.g. cover page)
  //       • Bracket-only UNFILLED placeholders with "_ AUTO" suffix → cleared
  //         (e.g. "[ENTER DETAILS]_ AUTO" left over after step 3 misses a key)
  //     NOTE: plain "[Insert response]" instructions WITHOUT "_ AUTO" are
  //     intentional user-editable placeholders — they must NOT be stripped.
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        // ── Plain string handling ────────────────────────────────────────
        if (typeof cell.value === "string") {
          const original = cell.value;
          let v = original;
          if (v === "AUTO") { cell.value = ""; return; }
          // Strip "_ AUTO" / " AUTO" suffix
          v = v.replace(/_? AUTO$/i, "");
          // Strip ONLY bracket placeholders that STILL have "_ AUTO" suffix
          // (e.g. "[ENTER DETAILS]_ AUTO" that step 3 didn't map).
          // Do NOT strip plain "[Insert response]" clauses — those are kept.
          v = v.replace(/^\[[^\]]+\]_\s*AUTO\s*$/i, "");
          if (v !== original) cell.value = v;
          return;
        }
        // ── Rich-text handling ───────────────────────────────────────────
        // Cover page and some other sheets store cell text as rich-text
        // objects with per-segment formatting.  If the placeholder key
        // "[ENTER ENTITY NAME]_ AUTO" is split across two rich-text segments
        // (e.g. "[ENTER ENTITY NAME]" + "_ AUTO"), step 3 substitutes the
        // first segment but leaves the "_ AUTO" segment intact.  Strip it.
        if (
          cell.value &&
          typeof cell.value === "object" &&
          "richText" in (cell.value as any)
        ) {
          const rt = cell.value as any;
          let dirty = false;
          const cleaned = rt.richText.filter((seg: any) => {
            if (typeof seg.text !== "string") return true;
            const stripped = seg.text.replace(/_? AUTO$/i, "").trim();
            // Remove entire segments that are ONLY "_ AUTO" / "AUTO"
            if (stripped === "" && /^\s*_?\s*AUTO\s*$/i.test(seg.text)) {
              dirty = true;
              return false; // drop this segment
            }
            if (stripped !== seg.text) {
              seg.text = stripped;
              dirty = true;
            }
            return true;
          });
          if (dirty) {
            rt.richText = cleaned;
            cell.value = rt;
          }
        }
      });
    });
  });

  // 5d. Strip design-annotation cells that carry a red font (these are
  //     author notes baked into the template, e.g. "We can remove this
  //     head", "Notes required?").  Red = any ARGB that ends in FF0000.
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "string" || !cell.value.trim()) return;
        const font = (cell.font as any);
        if (!font?.color) return;
        const argb = ((font.color.argb ?? font.color.rgb ?? "") as string)
          .toUpperCase();
        // Match fully-opaque red: "FFFF0000" or bare "FF0000"
        if (argb.endsWith("FF0000")) {
          cell.value = "";
        }
      });
    });
  });

  // 5e. Strip known internal workflow / template annotation strings that are
  //     NOT red-font but must not appear in final client exports.
  const ANNOTATION_STRINGS = [
    "Workflow Notes for Lovable / Automation",
    "Mode of valuation shall be stated",
    "in notes to a/c given in details",
    "Secured / Unsecured - specify and specify nature of security for secured position",
    "Old Format",
    "As ON",
    "1% of Rev. from Op.",
    "As per P&L",
  ];
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "string") return;
        for (const ann of ANNOTATION_STRINGS) {
          if (cell.value.includes(ann)) { cell.value = ""; break; }
        }
      });
    });
  });

  // 6. Replace year/date placeholders.  CY year used by default.
  //
  //    Smart regex `(31(?:st)? March,\s*)?_____ AUTO` matches BOTH:
  //      "_____ AUTO"              → "31st March, <cy>"
  //      "31 March, _____ AUTO"    → "31st March, <cy>" (no double-prefix)
  //      "31st March, _____ AUTO"  → "31st March, <cy>" (no double-prefix)
  //    The optional prefix gets eaten so we never get "31st March, 31st March, …"
  const cyDateStr = `31st March, ${inputs.cyYear}`;
  const pyDateStr = `31st March, ${inputs.pyYear}`;
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "string") return;
        let v = cell.value;
        let dirty = false;
        // "_____ AUTO" / "____ AUTO" with optional date prefix (handles both
        // "31 March," and "31st March," so we never double-prefix)
        const reUnderscores = /(?:31(?:st)? March,?\s*)?_+ AUTO/g;
        if (reUnderscores.test(v)) {
          v = v.replace(reUnderscores, cyDateStr);
          dirty = true;
        }
        // "31 March, ___" or "31st March, ___" without AUTO suffix
        if (/31(?:st)? March,?\s*_{2,}/.test(v)) {
          v = v.replace(/31(?:st)? March,?\s*_+/g, cyDateStr);
          dirty = true;
        }
        // 20XX year placeholders
        if (v.includes("20XX")) {
          // "31st/31 March, 20XX" → CY date (balance-sheet closing date)
          v = v.replace(/31(?:st)? March,?\s*20XX/g, cyDateStr);
          // "1 April 20XX" → OPENING balance date = PY year
          // (Fixed Asset schedule D7/H7 and similar opening-balance headers)
          v = v.replace(
            /(?:As\s+at\s+)?1(?:st)?\s+April[,\s]+20XX/gi,
            `As at 1 April ${inputs.pyYear}`,
          );
          // "Previous Year 20XX-XX" → prior-year assessment period
          const prevAY = `${inputs.pyYear}-${String(inputs.cyYear).slice(-2)}`;
          v = v.replace(/Previous Year 20XX-XX/gi, `Previous Year ${prevAY}`);
          // Generic assessment year and bare year
          v = v.replace(/20XX-XX/g, inputs.assessmentYear || "");
          v = v.replace(/20XX/g, String(inputs.cyYear));
          dirty = true;
        }
        if (dirty) cell.value = v;
      });
    });
  });

  // 6b. Patch PY-column cells.
  //
  //     After step 6, ALL "20XX" / "_____ AUTO" placeholders have been
  //     replaced with the CY date — but PY columns must show the prior-year.
  //
  //     BS sheet layout (verified from template):
  //       Row 6  col E → "As at"  (plain text, do NOT overwrite)
  //       Row 6  col F → "As at"  (plain text, do NOT overwrite)
  //       Row 7  col E → CY date  (step 6 already set this correctly)
  //       Row 7  col F → PY date  (step 6 wrongly set to CY — patch here)
  //
  //     PL sheet layout (verified from template):
  //       G6:G7 merged → "For the year ended 31st March, <cy>"
  //                      (step 6 already rewrites G6 via the 20XX regex)
  //       H6:H7 merged → must be patched to PY year
  //
  //     Note sheets pull dates via cross-sheet formulas; fullCalcOnLoad
  //     (set above) refreshes those automatically.
  if (bs) {
    // Only patch F7 (PY column date). E6/F6 are "As at" labels — leave them.
    bs.getCell("F7").value = pyDateStr;
  }
  if (pl) {
    // G6:G7 and H6:H7 are merged cells; ExcelJS addresses the top-left.
    // Step 6 already wrote CY into G6; patch H6 to PY with the full prefix.
    pl.getCell("G6").value = `For the year ended 31st March, ${inputs.cyYear}`;
    pl.getCell("H6").value = `For the year ended 31st March, ${inputs.pyYear}`;
  }

  // 6c. Control Sheet — find rows labelled "Balance sheet date" and
  //     "Comparative year-end" and overwrite the value cell with the
  //     correct year date string.
  const ctl = wb.getWorksheet("01_Control");
  if (ctl) {
    ctl.eachRow({ includeEmpty: false }, (row) => {
      let labelText = "";
      let firstValueCol: number | null = null;
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const v = cell.value;
        if (typeof v === "string") {
          // First B-column-ish text cell holds the row label
          if (!labelText && (colNum === 2 || colNum === 3)) labelText = v;
          // First cell after the label area (col F = 6) is the value cell
          if (firstValueCol == null && colNum >= 6) firstValueCol = colNum;
        }
      });
      const lbl = labelText.trim().toLowerCase();
      if (lbl.startsWith("balance sheet date") && firstValueCol != null) {
        row.getCell(firstValueCol).value = cyDateStr;
      } else if (lbl.startsWith("comparative year-end") && firstValueCol != null) {
        row.getCell(firstValueCol).value = pyDateStr;
      }
    });
  }

  // 6d. Universal PY-column date-header fix.
  //
  //     After step 6, EVERY "20XX" placeholder in every sheet becomes the CY
  //     date — including PY column headers in Notes, FA, CFS, DT, etc. sheets.
  //     Steps 6b/6c only patch the known BS/PL/Control cells; this pass
  //     catches every other sheet by detecting ADJACENT same-date cell pairs:
  //
  //       If cell (row, col) contains cyDateStr AND the IMMEDIATELY PRECEDING
  //       cell (row, col-1) ALSO contains cyDateStr, then cell (row, col) is
  //       the PY column header → replace cyDateStr with pyDateStr in its value.
  //
  //     This heuristic is safe because the CY date only appears in paired
  //     column headers; the replacement is limited to the date substring so
  //     surrounding text (e.g. "As at", "For the year ended") is preserved.
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      let prevWasCy = false;
      let prevColNum = -1;
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        if (typeof cell.value !== "string") {
          prevWasCy = false; prevColNum = -1;
          return;
        }
        const hasCy = cell.value.includes(cyDateStr);
        if (hasCy && prevWasCy && colNum === prevColNum + 1) {
          // Two consecutive cells with CY date — this one is the PY column
          cell.value = (cell.value as string).replace(
            new RegExp(cyDateStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            pyDateStr,
          );
          prevWasCy = false; // reset so we don't chain further
        } else {
          prevWasCy = hasCy;
          prevColNum = hasCy ? colNum : -1;
        }
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
