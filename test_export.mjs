/**
 * Standalone Node.js test for corporate Excel export.
 * Mirrors buildCorporateFinancialsXLSX() but reads template from disk.
 * Run: node test_export.mjs  OR  bun test_export.mjs
 */
import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "public/templates/corporate-financials.xlsx");
const OUTPUT_PATH = path.join(__dirname, "Audit Report/COMPARISION/PVT LTD/CLAUDE_TEST_EXPORT.xlsx");

// ── Test inputs (from live app: KWIKTEAM SUPPORT SERVICES PVT LTD FY2025-26)
const inputs = {
  entityName:     "KWIKTEAM SUPPORT SERVICES PRIVATE LIMITED",
  entityType:     "Private Limited",
  address:        "SURAT, GUJARAT",
  pan:            "AABCK1234Z",
  gstin:          "24AABCK1234Z1Z5",
  tan:            "SRTK12345A",
  cin:            "U74999GJ2020PTC123456",
  business:       "IT Support Services",
  financialYear:  "2025-26",
  assessmentYear: "2026-27",
  cyYear:         2026,
  pyYear:         2025,
  firmName:       "V J DESAI & CO. LLP",
  firmFRN:        "123456W",
  partnerName:    "VIJAY J DESAI",
  membershipNo:   "M12345",
  place:          "SURAT",
  reportDate:     "16/05/2026",
  udin:           "26012345AAAAAA1234",
  // Amounts from app (positive face values — equity/liab/rev already abs'd by pos())
  amounts: {
    // Equity & Liabilities
    BS_EQ_SC:   { cy: 100000,   py: 100000  },   // Share capital 1,00,000
    BS_EQ_RS:   { cy: 536933,   py: 0       },   // Reserves & surplus ≈ net profit
    BS_NCL_LTB: { cy: 0,        py: 0       },
    BS_NCL_DTL: { cy: 0,        py: 0       },
    BS_NCL_OLT: { cy: 0,        py: 0       },
    BS_NCL_LTP: { cy: 0,        py: 0       },
    BS_CL_STB:  { cy: 0,        py: 0       },
    BS_CL_TP:   { cy: 500000,   py: 400000  },
    BS_CL_OCL:  { cy: 200000,   py: 150000  },
    BS_CL_STP:  { cy: 0,        py: 0       },
    // Assets
    BS_NCA_FA:  { cy: 600000,   py: 700000  },
    BS_NCA_INV: { cy: 0,        py: 0       },
    BS_NCA_DTA: { cy: 0,        py: 0       },
    BS_NCA_LLA: { cy: 0,        py: 0       },
    BS_NCA_ONA: { cy: 0,        py: 0       },
    BS_CA_CI:   { cy: 0,        py: 0       },
    BS_CA_INV:  { cy: 200000,   py: 150000  },
    BS_CA_TR:   { cy: 400000,   py: 300000  },
    BS_CA_CCE:  { cy: 136641,   py: 100000  },
    BS_CA_SLA:  { cy: 0,        py: 0       },
    BS_CA_OCA:  { cy: 0,        py: 0       },
    // P&L
    PL_REV_OPS: { cy: 2000000,  py: 1800000 },
    PL_REV_OI:  { cy: 50000,    py: 40000   },
    PL_EXP_MAT: { cy: 0,        py: 0       },
    PL_EXP_SIT: { cy: 0,        py: 0       },
    PL_EXP_EMP: { cy: 800000,   py: 750000  },
    PL_EXP_FIN: { cy: 50000,    py: 45000   },
    PL_EXP_DEP: { cy: 100000,   py: 100000  },
    PL_EXP_OTH: { cy: 563067,   py: 545000  },
    PL_EXP_CII: { cy: 0,        py: 0       },
    PL_TAX_CUR: { cy: 0,        py: 0       },
    PL_TAX_DEF: { cy: 0,        py: 0       },
  },
  noteNumbers: {
    BS_EQ_SC:   2,
    BS_EQ_RS:   3,
    BS_NCL_LTB: null,
    BS_NCL_DTL: null,
    BS_NCL_OLT: null,
    BS_NCL_LTP: null,
    BS_CL_STB:  null,
    BS_CL_TP:   8,
    BS_CL_OCL:  9,
    BS_CL_STP:  null,
    BS_NCA_FA:  10,
    BS_NCA_INV: null,
    BS_NCA_DTA: null,
    BS_NCA_LLA: null,
    BS_NCA_ONA: null,
    BS_CA_CI:   null,
    BS_CA_INV:  14,
    BS_CA_TR:   15,
    BS_CA_CCE:  16,
    BS_CA_SLA:  null,
    BS_CA_OCA:  null,
  },
};

// ── Column mappings (same as fsExcelTemplateCorporate.ts)
const BS_NOTE_COL = "D", BS_CY_COL = "E", BS_PY_COL = "F";
const PL_NOTE_COL = "F", PL_CY_COL = "G", PL_PY_COL = "H";

const BS_ROW_MAP = {
  BS_EQ_SC: 12, BS_EQ_RS: 13,
  BS_NCL_LTB: 18, BS_NCL_DTL: 19, BS_NCL_OLT: 20, BS_NCL_LTP: 21,
  BS_CL_STB: 24, BS_CL_TP: 27, BS_CL_OCL: 28, BS_CL_STP: 29,
  BS_NCA_FA: 37, BS_NCA_INV: 40, BS_NCA_DTA: 41, BS_NCA_LLA: 42, BS_NCA_ONA: 43,
  BS_CA_CI: 46, BS_CA_INV: 47, BS_CA_TR: 48, BS_CA_CCE: 49, BS_CA_SLA: 50, BS_CA_OCA: 51,
};

const PL_ROW_MAP = {
  PL_REV_OPS: 9, PL_REV_OI: 10,
  PL_EXP_MAT: 14, PL_EXP_SIT: 15, PL_EXP_EMP: 17, PL_EXP_FIN: 18,
  PL_EXP_DEP: 19, PL_EXP_OTH: 20, PL_EXP_CII: 21,
  PL_TAX_CUR: 30, PL_TAX_DEF: 31,
};

function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function buildPlaceholderMap(i) {
  const fyStartYear = i.cyYear - 1;
  const fyDateRange = `01 Apr ${fyStartYear} to 31 Mar ${i.cyYear}`;
  return {
    "[NAME OF THE COMPANY]": i.entityName,
    "[ADDRESS]": i.address,
    "[NAME OF AUDITOR / FIRM]": i.firmName,
    "[NAME OF FIRM]": i.firmName,
    "[FRN]": i.firmFRN,
    "[NAME OF SIGNING PARTNER / PROPRIETOR]": i.partnerName,
    "[SIGNING PARTNER / PROPRIETOR]": i.partnerName,
    "[NAME]": i.partnerName,
    "[PLACE]": i.place,
    "[DATE]": i.reportDate,
    "[BALANCE SHEET DATE]": `31 March, ${i.cyYear}`,
    "[STATUTORY AUDITOR NAME]": i.firmName,
    "[DIRECTOR NAME]": "",
    "[NAME AND ADDRESS OF ASSESSEE WITH PAN / AADHAAR]":
      [i.entityName, i.address, i.pan ? `PAN: ${i.pan}` : ""].filter(Boolean).join(", "),
    "[APPLICABLE ACT]": "Companies Act, 2013",
    "[DETAILS]": "",
    "[XXXXXXXXXXXX]": "",
    "[XXXXXX]": "",
    "[ENTER ENTITY NAME]_ AUTO": i.entityName,
    "[ENTER ADDRESS]_ AUTO": i.address,
    "[ENTER PAN]_ AUTO": i.pan,
    "[ENTER TAN]_ AUTO": i.tan,
    "[ENTER GSTIN]_ AUTO": i.gstin,
    "[ENTER BUSINESS]_ AUTO": i.business,
    "[ENTER FIRM NAME]_ AUTO": i.firmName,
    "[ENTER FRN]_ AUTO": i.firmFRN,
    "[ENTER SIGNATORY NAME]_ AUTO": i.partnerName,
    "[ENTER MEMBERSHIP NO.]_ AUTO": i.membershipNo,
    "[ENTER UDIN]_ AUTO": i.udin,
    "[ENTER PLACE]_ AUTO": i.place,
    "[ENTER DATE]_ AUTO": i.reportDate,
    "[ENTER REPORT DATE]_ AUTO": i.reportDate,
    "[ENTER DETAILS]_ AUTO": "",
    "[01 Apr 2025 to 31 Mar 2026]_ AUTO": fyDateRange,
    "[2026-27]_ AUTO": i.assessmentYear,
    [`[${i.pyYear}-${String(i.cyYear).slice(-2)}]_ AUTO`]: `${i.pyYear}-${String(i.cyYear).slice(-2)}`,
    // _AUTO (no space) variants — some cover-page cells omit the space
    "[ENTER ENTITY NAME]_AUTO": i.entityName,
    "[ENTER ADDRESS]_AUTO": i.address,
    "[ENTER PAN]_AUTO": i.pan,
    "[ENTER TAN]_AUTO": i.tan,
    "[ENTER GSTIN]_AUTO": i.gstin,
    "[ENTER BUSINESS]_AUTO": i.business,
    "[ENTER FIRM NAME]_AUTO": i.firmName,
    "[ENTER FRN]_AUTO": i.firmFRN,
    "[ENTER SIGNATORY NAME]_AUTO": i.partnerName,
    "[ENTER MEMBERSHIP NO.]_AUTO": i.membershipNo,
    "[ENTER UDIN]_AUTO": i.udin,
    "[ENTER PLACE]_AUTO": i.place,
    "[ENTER DATE]_AUTO": i.reportDate,
    "[ENTER REPORT DATE]_AUTO": i.reportDate,
    "[ENTER DETAILS]_AUTO": "",
    "[01 Apr 2025 to 31 Mar 2026]_AUTO": fyDateRange,
    "[2026-27]_AUTO": i.assessmentYear,
    [`[${i.pyYear}-${String(i.cyYear).slice(-2)}]_AUTO`]: `${i.pyYear}-${String(i.cyYear).slice(-2)}`,
    "[ENTER ENTITY NAME]": i.entityName,
    "[ENTER ADDRESS]": i.address,
    "[ENTER PAN]": i.pan,
    "[ENTER GSTIN]": i.gstin,
    "[ENTER TAN]": i.tan,
    "[ENTER BUSINESS]": i.business,
    "[ENTER FIRM NAME]": i.firmName,
    "[ENTER FRN]": i.firmFRN,
    "[ENTER SIGNATORY NAME]": i.partnerName,
    "[ENTER MEMBERSHIP NO.]": i.membershipNo,
    "[ENTER UDIN]": i.udin,
    "[ENTER PLACE]": i.place,
    "[ENTER DATE]": i.reportDate,
    "[ENTER REPORT DATE]": i.reportDate,
    "[ENTER DETAILS]": "",
  };
}

async function main() {
  console.log("Reading template from:", TEMPLATE_PATH);
  const templateBuf = fs.readFileSync(TEMPLATE_PATH);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuf);
  console.log(`Loaded workbook with ${wb.worksheets.length} sheets`);

  const i = inputs;
  const placeholderMap = buildPlaceholderMap(i);

  // Step 3: substitute placeholders
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === "string") {
          let v = cell.value, dirty = false;
          for (const [from, to] of Object.entries(placeholderMap)) {
            if (v.includes(from)) { v = v.split(from).join(to); dirty = true; }
          }
          if (dirty) cell.value = v;
        } else if (cell.value && typeof cell.value === "object" && "richText" in cell.value) {
          const rt = cell.value;
          let dirty = false;
          for (const seg of rt.richText) {
            if (typeof seg.text === "string") {
              for (const [from, to] of Object.entries(placeholderMap)) {
                if (seg.text.includes(from)) { seg.text = seg.text.split(from).join(to); dirty = true; }
              }
            }
          }
          if (dirty) cell.value = rt;
        }
      });
    });
  });

  // Step 4: BS amounts
  const bs = wb.getWorksheet("BS");
  if (bs) {
    const noteMap = i.noteNumbers ?? {};
    for (const [code, row] of Object.entries(BS_ROW_MAP)) {
      const amt = i.amounts[code];
      if (amt) {
        bs.getCell(`${BS_CY_COL}${row}`).value = round2(amt.cy);
        bs.getCell(`${BS_PY_COL}${row}`).value = round2(amt.py);
      }
      const noteNo = noteMap[code];
      bs.getCell(`${BS_NOTE_COL}${row}`).value =
        noteNo != null && Number.isFinite(noteNo) ? noteNo : "";
    }
    console.log("BS amounts written");
  } else { console.warn("WARNING: BS sheet not found"); }

  // Step 5: PL amounts
  const pl = wb.getWorksheet("PL");
  if (pl) {
    const noteMap = i.noteNumbers ?? {};
    for (const [code, row] of Object.entries(PL_ROW_MAP)) {
      const amt = i.amounts[code];
      if (amt) {
        pl.getCell(`${PL_CY_COL}${row}`).value = round2(amt.cy);
        pl.getCell(`${PL_PY_COL}${row}`).value = round2(amt.py);
      }
      const noteNo = noteMap[code];
      pl.getCell(`${PL_NOTE_COL}${row}`).value =
        noteNo != null && Number.isFinite(noteNo) ? noteNo : "";
    }
    console.log("PL amounts written");
  } else { console.warn("WARNING: PL sheet not found"); }

  // Step 5b: patch formula cached results
  const bsNoteByRow = {}, plNoteByRow = {};
  for (const [code, row] of Object.entries(BS_ROW_MAP)) {
    const nn = i.noteNumbers?.[code];
    if (nn != null && Number.isFinite(nn)) bsNoteByRow[row] = nn;
  }
  const reBsD = /BS!\$?D\$?(\d+)/i, rePlF = /PL!\$?F\$?(\d+)/i;
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (!v || typeof v !== "object" || !("formula" in v)) return;
        const f = v.formula;
        const mBs = f.match(reBsD), mPl = f.match(rePlF);
        let newResult;
        if (mBs) {
          const r = parseInt(mBs[1], 10);
          newResult = bsNoteByRow[r] != null ? bsNoteByRow[r] : (v.result === "AUTO" ? "" : undefined);
        } else if (mPl) {
          const r = parseInt(mPl[1], 10);
          newResult = plNoteByRow[r] != null ? plNoteByRow[r] : (v.result === "AUTO" ? "" : undefined);
        }
        if (newResult !== undefined) cell.value = { formula: f, result: newResult };
      });
    });
  });
  wb.calcProperties = { fullCalcOnLoad: true };

  // Step 5c: strip _ AUTO
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === "string") {
          const orig = cell.value; let v = orig;
          if (v === "AUTO") { cell.value = ""; return; }
          v = v.replace(/_?\s*AUTO$/i, "");
          v = v.replace(/^\[[^\]]+\]_\s*AUTO\s*$/i, "");
          if (v !== orig) cell.value = v;
        } else if (cell.value && typeof cell.value === "object" && "richText" in cell.value) {
          const rt = cell.value; let dirty = false;
          const cleaned = rt.richText.filter((seg) => {
            if (typeof seg.text !== "string") return true;
            const stripped = seg.text.replace(/_?\s*AUTO$/i, "").trim();
            if (stripped === "" && /^\s*_?\s*AUTO\s*$/i.test(seg.text)) { dirty = true; return false; }
            if (stripped !== seg.text) { seg.text = stripped; dirty = true; }
            return true;
          });
          if (dirty) { rt.richText = cleaned; cell.value = rt; }
        }
      });
    });
  });

  // Step 5d: strip red annotations
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "string" || !cell.value.trim()) return;
        const font = cell.font;
        if (!font?.color) return;
        const argb = ((font.color.argb ?? font.color.rgb ?? "")).toUpperCase();
        if (argb.endsWith("FF0000")) cell.value = "";
      });
    });
  });

  // Step 5e: strip known annotation strings
  const ANNOTATIONS = [
    "Workflow Notes for Lovable / Automation", "Mode of valuation shall be stated",
    "in notes to a/c given in details",
    "Secured / Unsecured - specify and specify nature of security for secured position",
    "Old Format", "As ON", "1% of Rev. from Op.", "As per P&L",
  ];
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "string") return;
        for (const ann of ANNOTATIONS) { if (cell.value.includes(ann)) { cell.value = ""; break; } }
      });
    });
  });

  // Step 6: date replacement
  const cyDateStr = `31st March, ${i.cyYear}`;
  const pyDateStr = `31st March, ${i.pyYear}`;
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "string") return;
        let v = cell.value, dirty = false;
        const reUnderscores = /(?:31(?:st)? March,?\s*)?_+ AUTO/g;
        if (reUnderscores.test(v)) { v = v.replace(reUnderscores, cyDateStr); dirty = true; }
        if (/31(?:st)? March,?\s*_{2,}/.test(v)) { v = v.replace(/31(?:st)? March,?\s*_+/g, cyDateStr); dirty = true; }
        if (v.includes("20XX")) {
          v = v.replace(/31(?:st)? March,?\s*20XX/g, cyDateStr);
          v = v.replace(/(?:As\s+at\s+)?1(?:st)?\s+April[,\s]+20XX/gi, `As at 1 April ${i.pyYear}`);
          const prevAY = `${i.pyYear}-${String(i.cyYear).slice(-2)}`;
          v = v.replace(/Previous Year 20XX-XX/gi, `Previous Year ${prevAY}`);
          v = v.replace(/20XX-XX/g, i.assessmentYear);
          v = v.replace(/20XX/g, String(i.cyYear));
          dirty = true;
        }
        if (dirty) cell.value = v;
      });
    });
  });

  // Step 6b: BS/PL specific PY patches
  if (bs) { bs.getCell("F7").value = pyDateStr; }
  if (pl) {
    pl.getCell("G6").value = `For the year ended 31st March, ${i.cyYear}`;
    pl.getCell("H6").value = `For the year ended 31st March, ${i.pyYear}`;
  }

  // Step 6c: Control sheet
  const ctl = wb.getWorksheet("01_Control");
  if (ctl) {
    ctl.eachRow({ includeEmpty: false }, (row) => {
      let labelText = "", firstValueCol = null;
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const v = cell.value;
        if (typeof v === "string") {
          if (!labelText && (colNum === 2 || colNum === 3)) labelText = v;
          if (firstValueCol == null && colNum >= 6) firstValueCol = colNum;
        }
      });
      const lbl = labelText.trim().toLowerCase();
      if (lbl.startsWith("balance sheet date") && firstValueCol != null)
        row.getCell(firstValueCol).value = cyDateStr;
      else if (lbl.startsWith("comparative year-end") && firstValueCol != null)
        row.getCell(firstValueCol).value = pyDateStr;
    });
  }

  // Step 6d: universal PY-column detection
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      let prevWasCy = false, prevColNum = -1;
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        if (typeof cell.value !== "string") { prevWasCy = false; prevColNum = -1; return; }
        const hasCy = cell.value.includes(cyDateStr);
        if (hasCy && prevWasCy && colNum === prevColNum + 1) {
          cell.value = cell.value.replace(
            new RegExp(cyDateStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), pyDateStr,
          );
          prevWasCy = false;
        } else { prevWasCy = hasCy; prevColNum = hasCy ? colNum : -1; }
      });
    });
  });

  // Step 6e: patch 20XX in formula cell cached results
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (!v || typeof v !== "object" || !("formula" in v)) return;
        const result = v.result;
        if (typeof result !== "string" || !result.includes("20XX")) return;
        const prevAY = `${i.pyYear}-${String(i.cyYear).slice(-2)}`;
        let fixed = result
          .replace(/31(?:st)? March,?\s*20XX/g, cyDateStr)
          .replace(/(?:As\s+at\s+)?1(?:st)?\s+April[,\s]+20XX/gi, `As at 1 April ${i.pyYear}`)
          .replace(/Previous Year 20XX-XX/gi, `Previous Year ${prevAY}`)
          .replace(/20XX-XX/g, i.assessmentYear || "")
          .replace(/20XX/g, String(i.cyYear));
        if (fixed !== result) cell.value = { formula: v.formula, result: fixed };
      });
    });
  });

  // Step 6f: reset red font on numeric cells (avoids red 0s in BS rows)
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "number") return;
        const font = cell.font;
        if (!font?.color) return;
        const argb = String(font.color.argb || font.color.rgb || "").toUpperCase();
        if (argb.endsWith("FF0000")) {
          cell.font = { ...cell.font, color: { argb: "FF000000" } };
        }
      });
    });
  });

  // Save
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  await wb.xlsx.writeFile(OUTPUT_PATH);
  console.log("\n✓ Export saved to:", OUTPUT_PATH);
  console.log("\nSheets written:");
  wb.worksheets.forEach((ws) => console.log(`  - ${ws.name}`));
}

main().catch((err) => { console.error("ERROR:", err); process.exit(1); });
