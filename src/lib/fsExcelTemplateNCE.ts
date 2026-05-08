/**
 * fsExcelTemplateNCE — fills the firm's "NCE Financials.xlsx" template
 * with engagement data and returns the resulting workbook as a Blob.
 *
 * Why this exists: the previous NCE export built sheets from scratch
 * with ExcelJS, which never matched the firm's hand-crafted formatting
 * (column widths, merged cells, fonts, borders, headings).  Instead of
 * rebuilding all of that, we ship the template as a public asset and
 * mutate only the cells that need to change:
 *
 *   1. Scalar placeholders ([ENTITY NAME], [ENTER FRN], …) replaced
 *      via sharedStrings text edits — preserves all formatting since
 *      we only touch the t-element text.
 *   2. Balance-Sheet amounts written to columns G (CY) and H (PY) at
 *      the known row positions for each NCE FS code.
 *   3. Profit & Loss amounts written to columns G/H at the known
 *      positions.
 *
 * Template asset: public/templates/nce-financials.xlsx
 *   served at the runtime URL `/templates/nce-financials.xlsx`.
 *
 * The template's row positions were extracted from sheet3.xml /
 * sheet4.xml — see the BS_ROW_MAP and PL_ROW_MAP constants below.
 */

import ExcelJS from "exceljs";

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface NCEFinancialsInputs {
  /** Display name of the assessee. */
  entityName:    string;
  /** Entity type as printed (e.g. "Partnership"). */
  entityType:    string;
  /** Registered office / address. */
  address:       string;
  /** PAN. */
  pan:           string;
  /** GSTIN. */
  gstin:         string;
  /** TAN. */
  tan:           string;
  /** Nature of business. */
  business:      string;
  /** Financial year e.g. "2025-26". */
  financialYear: string;
  /** Assessment year e.g. "2026-27". */
  assessmentYear: string;
  /** Comparative-year-end date in the format the template expects ("2025"). */
  cyYear:        number;
  pyYear:        number;
  /** Firm details for sign-off. */
  firmName:      string;
  firmFRN:       string;
  partnerName:   string;
  membershipNo:  string;
  place:         string;
  /** Report date already formatted as DD/MM/YYYY. */
  reportDate:    string;
  /** UDIN. */
  udin:          string;

  /**
   * Map of NCE FS code → { cy, py } amount.  Codes follow the same
   * convention as PipelineFinancialStatements:
   *   NCE_CAP / NCE_LTB / NCE_OLTL / NCE_LTP / NCE_STB / NCE_TP /
   *   NCE_OCL / NCE_STP / NCE_PPE / NCE_CWIP / NCE_INTG / NCE_NCINV /
   *   NCE_LTLA / NCE_ONCA / NCE_CINV / NCE_STCK / NCE_TR / NCE_CASH /
   *   NCE_STLA / NCE_OCA / NCE_REV_OPS / NCE_REV_OTH / NCE_COGS /
   *   NCE_EMP_EXP / NCE_FIN_COST / NCE_DEPR / NCE_OTH_EXP
   * Liabilities are stored as positive (already negated by the caller).
   */
  amounts:       Record<string, { cy: number; py: number }>;
}

// ─── Cell mappings ───────────────────────────────────────────────────────────
// Row numbers extracted from xl/worksheets/sheet3.xml (Balance Sheet) and
// xl/worksheets/sheet4.xml (Profit & Loss).  Each row writes column G (CY)
// and column H (PY).

const BS_ROW_MAP: Record<string, number> = {
  NCE_CAP:   10,
  NCE_LTB:   13,
  NCE_OLTL:  14,
  NCE_LTP:   15,
  NCE_STB:   18,
  NCE_TP:    19,
  NCE_OCL:   20,
  NCE_STP:   21,
  // 23 = TOTAL EQUITY AND LIABILITIES (formula — leave alone)
  NCE_PPE:   27,
  NCE_CWIP:  28,
  NCE_INTG:  29,
  NCE_NCINV: 30,
  NCE_LTLA:  31,
  NCE_ONCA:  32,
  NCE_CINV:  35,
  NCE_STCK:  36,
  NCE_TR:    37,
  NCE_CASH:  38,
  NCE_STLA:  39,
  NCE_OCA:   40,
  // 42 = TOTAL ASSETS (formula — leave alone)
};

// Profit & Loss data rows (sheet4) — best-effort mapping based on the
// template's formula structure (G11 = Total Income = G9+G10).
const PL_ROW_MAP: Record<string, number> = {
  NCE_REV_OPS:  9,
  NCE_REV_OTH:  10,
  NCE_COGS:     14,
  NCE_EMP_EXP:  15,
  NCE_FIN_COST: 16,   // (b)/(c) ordering may shift; verify after first export
  NCE_DEPR:     17,
  NCE_OTH_EXP:  18,
};

// Scalar placeholder map — text in the template's sharedStrings exactly
// matches these keys.  Values come from inputs at export time.
function buildPlaceholderMap(i: NCEFinancialsInputs): Record<string, string> {
  return {
    "[ENTITY NAME]":          i.entityName || "",
    "[ENTER ENTITY NAME]":    i.entityName || "",
    "[ENTITY ADDRESS]":       i.address || "",
    "[ENTER ADDRESS]":        i.address || "",
    "[ENTITY TYPE]":          i.entityType || "",
    "[ENTER PAN]":            i.pan || "",
    "[ENTER GSTIN]":          i.gstin || "",
    "[ENTER TAN]":            i.tan || "",
    "[ENTER BUSINESS]":       i.business || "",
    "[ENTER FIRM NAME]":      i.firmName || "",
    "[ENTER FRN]":            i.firmFRN || "",
    "[ENTER SIGNATORY NAME]": i.partnerName || "",
    "[ENTER MEMBERSHIP NO.]": i.membershipNo || "",
    "[ENTER UDIN]":           i.udin || "",
    "[ENTER PLACE]":          i.place || "",
    "[ENTER DATE]":           i.reportDate || "",
    "[ENTER REPORT DATE]":    i.reportDate || "",
    "[ENTER DETAILS]":        "",
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load the NCE template, substitute placeholders + fill data cells, return Blob.
 * Throws if the template cannot be fetched or parsed — caller should fall back
 * to the legacy ExcelJS writer in that case.
 */
export async function buildNCEFinancialsXLSX(
  inputs: NCEFinancialsInputs,
): Promise<Blob> {
  // 1. Fetch template
  const res = await fetch("/templates/nce-financials.xlsx");
  if (!res.ok) {
    throw new Error(`Failed to load NCE template: HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();

  // 2. Open with ExcelJS
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  // 3. Substitute scalar placeholders by walking every cell's shared-string
  //    value.  ExcelJS auto-resolves shared strings, so editing cell.value
  //    on a string cell updates the underlying sharedStrings entry on save.
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
        // Some cells store rich-text / object value — handle the .text variant.
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

  // 4. Fill Balance Sheet amounts
  const bs = wb.getWorksheet("Balance Sheet");
  if (bs) {
    for (const [code, row] of Object.entries(BS_ROW_MAP)) {
      const amt = inputs.amounts[code];
      if (!amt) continue;
      const rg = bs.getCell(`G${row}`);
      const rh = bs.getCell(`H${row}`);
      rg.value = round2(amt.cy);
      rh.value = round2(amt.py);
    }
  }

  // 5. Fill Profit & Loss amounts
  const pl = wb.getWorksheet("Profit & Loss");
  if (pl) {
    for (const [code, row] of Object.entries(PL_ROW_MAP)) {
      const amt = inputs.amounts[code];
      if (!amt) continue;
      pl.getCell(`G${row}`).value = round2(amt.cy);
      pl.getCell(`H${row}`).value = round2(amt.py);
    }
  }

  // 6. Substitute year/date placeholders that appear inline in headings.
  //    The template uses "31 March, ____" / "31 March, _____" style — we
  //    overwrite only the underscore-blank with the actual year text.  This
  //    is best-effort: cells whose strings exactly match get patched.
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "string") return;
        let v = cell.value;
        let dirty = false;
        // Replace literal placeholder fragments only — never substring-match
        // shorter blanks because that would corrupt unrelated cells.
        if (v.includes("31 March, _____") || v.includes("31 March, ____")) {
          v = v.replace(/31 March, _+/g, `31 March, ${inputs.cyYear}`);
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
