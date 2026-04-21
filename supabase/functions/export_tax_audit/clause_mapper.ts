/**
 * clause_mapper.ts
 * Maps form_3cd JSONB columns to exact cell addresses in Form_3CD and Annexure sheets.
 *
 * Sheet targets:
 *   "Form_3CD"          – main form, answer column = J (top-left of merged J:M range)
 *   "ANX_3CD_Main"      – annexure for most table clauses
 *   "ANX_3CD_Cl34_TDS"  – TDS-specific annexure (clause 34)
 *
 * Rules:
 *   • ONLY write .v (value) and .t (type) – never touch .s (style)
 *   • Write to top-left cell of any merged range
 *   • Skip undefined / null / empty values silently
 */

import * as XLSX from "npm:xlsx@0.18.5";
type WS = XLSX.WorkSheet;
type WB = XLSX.WorkBook;

// ─── low-level helpers ────────────────────────────────────────────────────────

/** Write a value to a cell, preserving its existing style. */
function setV(ws: WS, addr: string, v: unknown): void {
  if (v === null || v === undefined || v === "") return;
  const s = String(v).trim();
  if (!s) return;
  const existing = ws[addr] as XLSX.CellObject | undefined;
  const style = existing?.s;
  ws[addr] = { v: s, t: "s", ...(style ? { s: style } : {}) } as XLSX.CellObject;
}

/** Write a numeric value to a cell, preserving style. */
function setN(ws: WS, addr: string, v: unknown): void {
  if (v === null || v === undefined || v === "") return;
  const n = Number(v);
  if (isNaN(n)) return;
  const existing = ws[addr] as XLSX.CellObject | undefined;
  const style = existing?.s;
  ws[addr] = { v: n, t: "n", ...(style ? { s: style } : {}) } as XLSX.CellObject;
}

/** Write a row of values into an ANX sheet starting at (rowIdx, colIdx). colMap maps object keys to column indices (0-based). */
function writeRow(ws: WS, rowIdx: number, row: Record<string, unknown>, colMap: Record<string, number>): void {
  for (const [key, col] of Object.entries(colMap)) {
    const val = row[key];
    if (val === undefined || val === null || val === "") continue;
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c: col });
    const n = Number(val);
    if (!isNaN(n) && String(val).trim() !== "") {
      setN(ws, addr, val);
    } else {
      setV(ws, addr, val);
    }
  }
}

/** Write Sr.No. column (A=0) for a list of data rows starting at rowIdx. */
function writeSrNos(ws: WS, startRowIdx: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const addr = XLSX.utils.encode_cell({ r: startRowIdx + i, c: 0 });
    setN(ws, addr, i + 1);
  }
}

/** Safely get rows from a structured data object. Handles _rows directly or inside a sub-key. */
function rows(data: Record<string, unknown> | null | undefined): Record<string, unknown>[] {
  if (!data) return [];
  if (Array.isArray(data._rows)) return data._rows as Record<string, unknown>[];
  return [];
}

/** Summarise a yes/no/na answer as a short label. */
function ynSummary(data: Record<string, unknown> | null | undefined, defaultText?: string): string {
  if (!data) return "";
  const v = data._value;
  if (v === true || v === "yes") return "Yes";
  if (v === false || v === "no") return "No";
  if (v === "na" || v === "n.a." || v === "not_applicable") return "Not Applicable";
  if (v === "notdue") return "Not Due";
  if (defaultText && (!v || v === "")) return defaultText;
  return v ? String(v) : (defaultText ?? "");
}

/** Summarise a not_applicable_annexure answer. */
function naSummary(data: Record<string, unknown> | null | undefined): string {
  if (!data) return "";
  if (data._notApplicable) return "Not Applicable";
  const r = rows(data);
  if (r.length > 0) return "As Per Annexure";
  if (data._asPerAnnexure) return "As Per Annexure";
  return "";
}

/** Safe deep-get on an `any` object. */
function dig(obj: unknown, ...keys: string[]): Record<string, unknown> {
  let cur: unknown = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return {};
    cur = (cur as Record<string, unknown>)[k];
  }
  return (cur && typeof cur === "object" ? cur : {}) as Record<string, unknown>;
}

// ─── main export ─────────────────────────────────────────────────────────────

export function buildClauseValues(
  cl: Record<string, unknown>,
  wb: WB,
  clientName?: string
): WB {
  const f3 = wb.Sheets["Form_3CD"];
  const ax = wb.Sheets["ANX_3CD_Main"];
  const td = wb.Sheets["ANX_3CD_Cl34_TDS"];
  if (!f3) return wb;

  // ── Clause 8 — Section 44AB & 115BA option ──────────────────────────────
  // clauseNo '8' → DB col 'cl_8' (flat). Section field uses composite+dropdown
  // so the value is stored as { _value: "44AB(a)" }, not a plain string.
  const cl8 = dig(cl, "cl_8");
  const cl8SectionRaw = cl8.cl_8_section;
  const cl8section = (typeof cl8SectionRaw === "object" && cl8SectionRaw !== null)
    ? String((cl8SectionRaw as Record<string, unknown>)._value ?? "")
    : String(cl8SectionRaw ?? "");
  setV(f3, "J14", cl8section);
  const cl8OptedRaw = cl8.cl_8_opted as Record<string, unknown> | undefined;
  const cl8opted = cl8OptedRaw?._value;
  if (cl8opted === true) {
    const schemeRaw = cl8OptedRaw?.cl_8_scheme as Record<string, unknown> | string | undefined;
    const scheme = (typeof schemeRaw === "object" && schemeRaw !== null)
      ? String((schemeRaw as Record<string, unknown>)._value ?? "")
      : String(schemeRaw ?? "");
    setV(f3, "J15", scheme ? `Yes – ${scheme}` : "Yes");
  } else if (cl8opted === false) {
    setV(f3, "J15", "No");
  }

  // ── Clause 9 — Partners / members ───────────────────────────────────────
  // clauseNo '9a' → DB col 'cl_9a' (flat); clauseNo '9b' → DB col 'cl_9b' (flat)
  const cl9a = dig(cl, "cl_9a");
  const cl9b = dig(cl, "cl_9b");
  const cl9bDetails = dig(cl9b, "cl_9b_details");
  const partners9 = rows(cl9bDetails).length > 0 ? rows(cl9bDetails) : rows(cl9a);
  if (ax && partners9.length > 0) {
    const ANX_CL9B_START = 7; // display row 8 → 0-idx 7
    writeSrNos(ax, ANX_CL9B_START, Math.min(partners9.length, 3));
    const colMap9b: Record<string, number> = { name: 1, old_ratio: 7, new_ratio: 8, date_of_change: 9, profit_share: 7 };
    partners9.slice(0, 3).forEach((r, i) => writeRow(ax, ANX_CL9B_START + i, r, colMap9b));
    setV(f3, "J18", "As Per Annexure");
  } else if (ynSummary(cl9b)) {
    setV(f3, "J18", ynSummary(cl9b, "No change"));
  }
  // J17: note reference for clause 9a (top-left of J:M merged answer cell)
  if (cl9a._notApplicable) {
    setV(f3, "J17", "Not Applicable");
  } else if (cl9a._noteRef) {
    const noteText = cl9a._asPerAnnexure
      ? `As Per Note No. ${cl9a._noteRef}`
      : `Note No. ${cl9a._noteRef}`;
    setV(f3, "J17", noteText);
  } else if (cl9a._asPerAnnexure || partners9.length > 0) {
    setV(f3, "J17", "As Per Annexure");
  }

  // ── Clause 10 — Nature of business ──────────────────────────────────────
  // clauseNo '10a' → DB col 'cl_10a' (flat); clauseNo '10b' → DB col 'cl_10b' (flat)
  const cl10a = dig(cl, "cl_10a");
  const cl10b = dig(cl, "cl_10b");
  const bizRows = rows(cl10a);
  if (bizRows.length > 0) {
    const desc = bizRows
      .map((r) => [r.sector, r.sub_sector, r.code].filter(Boolean).join(" - "))
      .join("; ");
    const codes = bizRows.map((r) => r.code || r.sub_sector || r.sector).filter(Boolean).join(", ");
    setV(f3, "J19", desc || codes || "As Per Annexure");
  } else if (cl10a._notApplicable) {
    setV(f3, "J19", "Not Applicable");
  }
  const cl10bAnswer = ynSummary(cl10b, "No change");
  setV(f3, "J20", cl10bAnswer);

  // ── Clause 11 — Books of account ────────────────────────────────────────
  // clauseNo '11a' → DB col 'cl_11a' (flat)
  const cl11a = dig(cl, "cl_11a");
  const books11 = rows(dig(cl11a, "cl_11a_books"));
  if (ax && books11.length > 0) {
    const ANX_CL11A_START = 14; // display row 15 → 0-idx 14
    writeSrNos(ax, ANX_CL11A_START, Math.min(books11.length, 3));
    books11.slice(0, 3).forEach((r, i) => {
      const bookName = [r.book, r.specify].filter(Boolean).join(" – ");
      setV(ax, XLSX.utils.encode_cell({ r: ANX_CL11A_START + i, c: 1 }), bookName);
    });
    setV(f3, "J21", "As Per Annexure");
  } else if (cl11a._value === true) {
    setV(f3, "J21", "Yes – As Per Annexure");
  } else if (cl11a._value === false) {
    setV(f3, "J21", "No");
  }

  // ── Clause 12 — Presumptive basis ────────────────────────────────────────
  // clauseNo '12' → DB col 'cl_12' (flat)
  const cl12 = dig(cl, "cl_12");
  setV(f3, "J24", ynSummary(cl12, "Not Applicable") || naSummary(dig(cl12, "cl_12_details")));

  // ── Clause 13 — Accounting method / ICDS ────────────────────────────────
  // clauseNos '13a','13b','13d','13f' → separate flat DB cols ('cl_13a' etc.)
  const cl13a = dig(cl, "cl_13a");
  const cl13b = dig(cl, "cl_13b");
  const cl13d = dig(cl, "cl_13d");
  const cl13f = dig(cl, "cl_13f");
  setV(f3, "J28", cl13a._value as string || "");
  setV(f3, "J29", ynSummary(cl13b, "No"));
  setV(f3, "J32", ynSummary(cl13d, "Not Applicable"));
  // 13f ICDS disclosure → ANX rows 22-31 col C (0-idx 2)
  const icdsRows = rows(cl13f);
  if (ax && icdsRows.length > 0) {
    const ANX_ICDS_START = 21; // display row 22
    icdsRows.slice(0, 10).forEach((r, i) => {
      const disc = r.disclosure || r.remarks || r.amount || "";
      if (disc) setV(ax, XLSX.utils.encode_cell({ r: ANX_ICDS_START + i, c: 2 }), String(disc));
    });
  }

  // ── Clause 14 — Closing stock method ─────────────────────────────────────
  // clauseNo '14a' → DB col 'cl_14a' (flat)
  const cl14a = dig(cl, "cl_14a");
  setV(f3, "J36", cl14a._value as string || "");

  // ── Clause 15–16 — Capital asset / P&L credits ───────────────────────────
  // clauseNos '15','16' share DB col 'cl_15_16' (nested under "15" / "16")
  const cl15 = dig(cl, "cl_15_16", "15");
  const cl16 = dig(cl, "cl_15_16", "16");
  setV(f3, "J39", naSummary(cl15) || "");
  // 16 composite sub-clauses → write a summary per row
  const sub16keys = ["cl_16a", "cl_16b", "cl_16c", "cl_16d", "cl_16e"] as const;
  const f16rows = [45, 46, 47, 48, 49] as const; // J45–J49 in template
  sub16keys.forEach((k, i) => {
    const sub = dig(cl16, k);
    const s = naSummary(sub);
    if (s) setV(f3, `J${f16rows[i]}`, s);
  });

  // ── Clause 17 — Land/building transfer ───────────────────────────────────
  // clauseNo '17' → DB col 'cl_17' (flat)
  const cl17 = dig(cl, "cl_17");
  setV(f3, "J50", naSummary(cl17) || ynSummary(cl17, "Not Applicable"));

  // ── Clause 18 — Depreciation schedule ────────────────────────────────────
  // clauseNo '18' → DB col 'cl_18' (flat)
  const cl18 = dig(cl, "cl_18");
  const deprRows = rows(cl18);
  if (ax && deprRows.length > 0) {
    const ANX_DEPR_START = 36; // display row 37 → 0-idx 36
    const colMap18: Record<string, number> = {
      block: 0, rate: 3, openingWDV: 4,
      addOver180: 5, addUnder180: 7, dep: 8, closingWDV: 9,
    };
    writeSrNos(ax, ANX_DEPR_START, Math.min(deprRows.length, 2));
    deprRows.slice(0, 2).forEach((r, i) => writeRow(ax, ANX_DEPR_START + i, r, colMap18));
    setV(f3, "J59", "As Per Annexure");
  } else {
    setV(f3, "J59", naSummary(cl18));
  }

  // ── Clause 19 — Admissible amounts ───────────────────────────────────────
  // clauseNo '19' → DB col 'cl_19' (flat)
  const cl19 = dig(cl, "cl_19");
  setV(f3, "J60", naSummary(cl19) || "Not Applicable");

  // ── Clause 20 — Bonus, employee fund contributions ───────────────────────
  // clauseNo '20b' → DB col 'cl_20b' (flat, separate from cl_20a)
  const cl20b = dig(cl, "cl_20b");
  const fundRows = rows(cl20b);
  if (ax && fundRows.length > 0) {
    const ANX_FUND_START = 44; // display row 45 → 0-idx 44
    const colMap20b: Record<string, number> = {
      fund: 2, employee_deduction: 4, employer_contribution: 6,
      due_date: 7, actual_date: 8, disallowance: 9,
    };
    writeSrNos(ax, ANX_FUND_START, Math.min(fundRows.length, 2));
    fundRows.slice(0, 2).forEach((r, i) => writeRow(ax, ANX_FUND_START + i, r, colMap20b));
    setV(f3, "J63", "As Per Annexure");
  } else {
    setV(f3, "J63", naSummary(cl20b));
  }

  // ── Clause 21 — Disallowances (large composite) ─────────────────────────
  // clauseNo '21' → DB col 'cl_21' (flat; all sub-data nested within this object)
  const cl21 = dig(cl, "cl_21");

  // 21(a) — 9 specific categories of P&L debits → J66–J74
  const cl21a = dig(cl21, "cl_21a");
  const lineRows21a = [66, 67, 68, 69, 70, 71, 72, 73, 74] as const;
  for (let idx = 1; idx <= lineRows21a.length; idx++) {
    const sub = dig(cl21a, `cl_21a_${idx}`);
    const r = rows(sub);
    const disp = r.length > 0 ? "As Per Annexure" : naSummary(sub);
    if (disp) setV(f3, `J${lineRows21a[idx - 1]}`, disp);
  }

  // 21(b) — sec 40(a) inadmissible
  const cl21b = dig(cl21, "cl_21b");
  const b_iA = dig(cl21b, "cl_21b_iA");
  const b_iB = dig(cl21b, "cl_21b_iB");
  const b_iiA = dig(cl21b, "cl_21b_iiA");
  const b_iiB = dig(cl21b, "cl_21b_iiB");
  const b_iiiA = dig(cl21b, "cl_21b_iiiA");
  const b_iiiB = dig(cl21b, "cl_21b_iiiB");
  const b_iv = dig(cl21b, "cl_21b_iv");
  const b_v = dig(cl21b, "cl_21b_v");
  const b_vi = dig(cl21b, "cl_21b_vi");
  const b_vii = dig(cl21b, "cl_21b_vii");
  const b_viii = dig(cl21b, "cl_21b_viii");
  const b_ix = dig(cl21b, "cl_21b_ix");
  // Single-value sub-clause fields (ic/iia/iib/iv/v of sec 40(a))
  setV(f3, "J122", b_iv._value as string || b_iv.defaultValue as string || "Nil");
  setV(f3, "J123", b_v._value as string || "Nil");
  setV(f3, "J124", b_vi._value as string || "Nil");
  setV(f3, "J129", b_viii._value as string || "Nil");
  setV(f3, "J130", b_ix._value as string || "Nil");
  // Sub-table summaries for TDS-related sub-clauses
  const ia_rows = rows(b_iA);
  const ib_rows = rows(b_iB);
  const iiA_rows = rows(b_iiA);
  const iiB_rows = rows(b_iiB);
  const iiiA_rows = rows(b_iiiA);
  const iiiB_rows = rows(b_iiiB);
  const vii_rows = rows(b_vii);
  [
    ["J80",  ia_rows,   b_iA],    // 40(a)(i) non-resident
    ["J92",  iiA_rows,  b_iiA],   // 40(a)(ia) resident
    ["J98",  iiB_rows,  b_iiB],   // 40(a)(ia) deducted-not-deposited
    ["J105", iiiA_rows, b_iiiA],  // 40(a)(ib)
    ["J111", iiiB_rows, b_iiiB],  // 40(a)(ib) deducted-not-deposited
    ["J131", vii_rows,  b_vii],   // interest / salary etc.
  ].forEach(([cell, rArr, dataObj]) => {
    const arr = rArr as Record<string, unknown>[];
    const d = dataObj as Record<string, unknown>;
    const disp = arr.length > 0 ? "As Per Annexure" : naSummary(d);
    if (disp) setV(f3, cell as string, disp);
  });

  // 21(c) — partner remuneration → ANX rows 58-59
  const cl21c = dig(cl21, "cl_21c");
  const cl21cRows = rows(cl21c);
  if (ax && cl21cRows.length > 0) {
    const ANX_21C_START = 57; // display row 58 → 0-idx 57
    const colMap21c: Record<string, number> = {
      partner_name: 1, interest: 7, salary: 8, total: 9,
    };
    writeSrNos(ax, ANX_21C_START, Math.min(cl21cRows.length, 2));
    cl21cRows.slice(0, 2).forEach((r, i) => writeRow(ax, ANX_21C_START + i, r, colMap21c));
  }

  // 21(d) — sec 40A(3) cash payments
  const cl21d = dig(cl21, "cl_21d");
  const cl21dA = dig(cl21d, "cl_21d_A");
  const cl21dB = dig(cl21d, "cl_21d_B");
  setV(f3, "J133", ynSummary(cl21dA, ""));
  setV(f3, "J138", ynSummary(cl21dB, ""));

  // 21(e)-(i) single fields
  setV(f3, "J143", dig(cl21, "cl_21e")._value as string || "Nil");
  setV(f3, "J144", dig(cl21, "cl_21f")._value as string || "Nil");
  // 21(g) contingent liabilities
  const cl21g = dig(cl21, "cl_21g");
  setV(f3, "J145", naSummary(cl21g) || "");
  // 21(h) sec 14A
  const cl21h = dig(cl21, "cl_21h");
  setV(f3, "J152", naSummary(cl21h) || "");
  setV(f3, "J155", dig(cl21, "cl_21i")._value as string || "Nil");

  // ── Clause 22 — MSME interest ────────────────────────────────────────────
  // clauseNo '22' → DB col 'cl_22' (flat)
  const cl22 = dig(cl, "cl_22");
  setV(f3, "J156", dig(cl22, "cl_22_i")._value as string || "Nil");
  setV(f3, "J157", dig(cl22, "cl_22_ii")._value as string || "Nil");
  setV(f3, "J158", dig(cl22, "cl_22_iii_a")._value as string || "Nil");
  setV(f3, "J160", dig(cl22, "cl_22_iii_b")._value as string || "Nil");

  // ── Clause 23 — Specified persons ────────────────────────────────────────
  // clauseNo '23' → DB col 'cl_23' (flat)
  const cl23 = dig(cl, "cl_23");
  const rows23 = rows(cl23);
  if (ax && rows23.length > 0) {
    const ANX_23_START = 77; // display row 78 → 0-idx 77
    const colMap23: Record<string, number> = {
      name: 1, relationship: 6, nature: 8, amount: 9,
    };
    writeSrNos(ax, ANX_23_START, Math.min(rows23.length, 3));
    rows23.slice(0, 3).forEach((r, i) => writeRow(ax, ANX_23_START + i, r, colMap23));
    setV(f3, "J161", "As Per Annexure");
  } else if (cl23._notApplicable) {
    setV(f3, "J161", "Not Applicable");
  }

  // ── Clause 24–25 — Deemed profits / Sec 41 ───────────────────────────────
  // clauseNos '24','25' share DB col 'cl_24_25' (nested under "24" / "25")
  const cl24 = dig(cl, "cl_24_25", "24");
  const cl25 = dig(cl, "cl_24_25", "25");
  setV(f3, "J162", naSummary(cl24) || ynSummary(cl24, "Not Applicable"));
  setV(f3, "J163", naSummary(cl25) || ynSummary(cl25, "Not Applicable"));

  // ── Clause 26 — Section 43B ──────────────────────────────────────────────
  // clauseNo '26' → DB col 'cl_26' (flat)
  const cl26 = dig(cl, "cl_26");
  const cl26Aa = dig(cl26, "cl_26iAa");
  const cl26Ab = dig(cl26, "cl_26iAb");
  const cl26Ba = dig(cl26, "cl_26iBa");
  const cl26Bb = dig(cl26, "cl_26iBb");
  const anyRows26 = [cl26Aa, cl26Ab, cl26Ba, cl26Bb].some(d => rows(d).length > 0);
  setV(f3, "J164", anyRows26 ? "Yes – As Per Annexure" : naSummary(cl26Ba) || "");
  setV(f3, "J166", naSummary(cl26Aa) || "");
  setV(f3, "J167", naSummary(cl26Ab) || "");
  setV(f3, "J169", naSummary(cl26Ba) || "");
  setV(f3, "J170", naSummary(cl26Bb) || "");
  if (ax) {
    const colMap26: Record<string, number> = { section: 1, nature: 3, amount: 8, date_of_payment: 9 };
    const r26Ba = rows(cl26Ba);
    if (r26Ba.length > 0) {
      const ANX_26BA_START = 84;
      writeSrNos(ax, ANX_26BA_START, Math.min(r26Ba.length, 4));
      r26Ba.slice(0, 4).forEach((r, i) => writeRow(ax, ANX_26BA_START + i, r, colMap26));
    }
    const r26Bb = rows(cl26Bb);
    if (r26Bb.length > 0) {
      const ANX_26BB_START = 92;
      writeSrNos(ax, ANX_26BB_START, Math.min(r26Bb.length, 8));
      r26Bb.slice(0, 8).forEach((r, i) => writeRow(ax, ANX_26BB_START + i, r, colMap26));
    }
  }

  // ── Clause 27 — CENVAT/ITC + prior period ───────────────────────────────
  // clauseNo '27' → DB col 'cl_27' (flat)
  const cl27 = dig(cl, "cl_27");
  const cl27a = dig(cl27, "cl_27a");
  const cl27b = dig(cl27, "cl_27b");
  if (ax && (cl27a.opening_balance || cl27a.credit_availed)) {
    const ITC_ROWS = [
      { key: "opening_balance", row: 106 },
      { key: "credit_availed", row: 107 },
      { key: "credit_utilized", row: 108 },
      { key: "closing_balance", row: 109 },
    ];
    ITC_ROWS.forEach(({ key, row }) => {
      const val = cl27a[key];
      if (val !== undefined && val !== "") {
        setN(ax, XLSX.utils.encode_cell({ r: row, c: 4 }), val); // col E
      }
    });
  }
  // 27(b) prior period → ANX rows 116-118
  const rows27b = rows(cl27b);
  if (ax && rows27b.length > 0) {
    const ANX_27B_START = 115;
    const colMap27b: Record<string, number> = { type: 1, particulars: 4, amount: 8, year: 7 };
    writeSrNos(ax, ANX_27B_START, Math.min(rows27b.length, 3));
    rows27b.slice(0, 3).forEach((r, i) => writeRow(ax, ANX_27B_START + i, r, colMap27b));
  }
  // J171: ITC summary; J172: prior-period summary
  setV(f3, "J171", (cl27a.opening_balance || cl27a.credit_availed) ? "As Per Annexure" : "Not Applicable");
  setV(f3, "J172", rows27b.length > 0 ? "As Per Annexure" : "Not Applicable");

  // ── Clause 30 — Hundi ────────────────────────────────────────────────────
  // clauseNo '30' → DB col 'cl_30' (flat)
  const cl30 = dig(cl, "cl_30");
  setV(f3, "J173", ynSummary(cl30, "No"));

  // ── Clause 30A — Transfer pricing / sec 94B / GAAR ──────────────────────
  // clauseNo '30A' → DB col 'cl_30A' (flat; contains sub-items cl_30a/cl_30b/cl_30c)
  const cl30A = dig(cl, "cl_30A");
  const cl30a_sub = dig(cl30A, "cl_30a");
  const cl30b_sub = dig(cl30A, "cl_30b");
  const cl30c_sub = dig(cl30A, "cl_30c");
  setV(f3, "J178", naSummary(cl30a_sub) || "");
  setV(f3, "J185", naSummary(cl30b_sub) || "");
  setV(f3, "J195", naSummary(cl30c_sub) || "");

  // ── Clause 31 — Loans/deposits 269SS/269T ────────────────────────────────
  // clauseNo '31' → DB col 'cl_31' (flat)
  const cl31 = dig(cl, "cl_31");
  const cl31a = dig(cl31, "cl_31a");
  const cl31b = dig(cl31, "cl_31b");
  const cl31c = dig(cl31, "cl_31c");
  const cl31d = dig(cl31, "cl_31d");
  const cl31e = dig(cl31, "cl_31e");
  setV(f3, "J199", naSummary(cl31a) || "");
  setV(f3, "J204", naSummary(cl31b) || "");
  setV(f3, "J205", naSummary(cl31c) || "");
  setV(f3, "J206", naSummary(cl31d) || "");
  setV(f3, "J209", naSummary(cl31e) || "");

  // ── Clause 32 — Brought forward losses ───────────────────────────────────
  // clauseNo '32' → DB col 'cl_32' (flat)
  const cl32 = dig(cl, "cl_32");
  const cl32a = dig(cl32, "cl_32a");
  const cl32b = dig(cl32, "cl_32b");
  const cl32c = dig(cl32, "cl_32c");
  const cl32d = dig(cl32, "cl_32d");
  const cl32e = dig(cl32, "cl_32e");
  setV(f3, "J212", naSummary(cl32a) || "");
  setV(f3, "J216", ynSummary(cl32b, "Not Applicable"));
  setV(f3, "J221", ynSummary(cl32c, "No"));
  setV(f3, "J222", ynSummary(cl32d, "No"));
  setV(f3, "J223", ynSummary(cl32e, "Not Applicable"));

  // ── Clause 33 — Chapter VIA deductions ───────────────────────────────────
  // clauseNo '33' → DB col 'cl_33' (flat)
  const cl33 = dig(cl, "cl_33");
  setV(f3, "J224", naSummary(cl33) || ynSummary(cl33, "Not Applicable"));

  // ── Clause 34 — TDS/TCS ──────────────────────────────────────────────────
  if (td) {
    // clauseNo '34' → DB col 'cl_34' (flat; sub-items cl_34a/b/c nested within)
    const cl34 = dig(cl, "cl_34");
    const cl34a = dig(cl34, "cl_34a");
    const cl34b = dig(cl34, "cl_34b");
    const cl34c = dig(cl34, "cl_34c");

    // Write client name to TDS sheet header
    if (clientName) {
      setV(td, "B2", clientName);
    }

    // 34(a) → rows 9-11 (0-idx 8-10)
    const rows34a = rows(cl34a);
    if (rows34a.length > 0) {
      const ANX_34A_START = 8;
      const colMap34a: Record<string, number> = {
        section: 1, nature_of_payment: 2,
        total_payment: 4, total_required: 5,
        tax_deducted_collected: 6, total_at_less: 7, tax_not_deposited: 8,
      };
      writeSrNos(td, ANX_34A_START, Math.min(rows34a.length, 3));
      rows34a.slice(0, 3).forEach((r, i) => writeRow(td, ANX_34A_START + i, r, colMap34a));
      setV(f3, "J227", "As Per Annexure");
    } else {
      setV(f3, "J227", naSummary(cl34a));
    }

    // 34(b) → rows 18-21 (0-idx 17-20)
    const rows34b = rows(cl34b);
    if (rows34b.length > 0) {
      const ANX_34B_START = 17;
      const colMap34b: Record<string, number> = {
        form_type: 1, due_date: 4, date_furnished: 5, all_reported: 6,
      };
      writeSrNos(td, ANX_34B_START, Math.min(rows34b.length, 4));
      rows34b.slice(0, 4).forEach((r, i) => writeRow(td, ANX_34B_START + i, r, colMap34b));
      setV(f3, "J228", "As Per Annexure");
    } else {
      setV(f3, "J228", naSummary(cl34b));
    }

    // 34(c) → rows 26-28 (0-idx 25-27)
    const rows34c = rows(cl34c);
    if (rows34c.length > 0) {
      const ANX_34C_START = 25;
      const colMap34c: Record<string, number> = {
        interest_payable: 1, amount_paid: 7, date_of_payment: 7,
      };
      writeSrNos(td, ANX_34C_START, Math.min(rows34c.length, 3));
      rows34c.slice(0, 3).forEach((r, i) => writeRow(td, ANX_34C_START + i, r, colMap34c));
      setV(f3, "J229", "As Per Annexure");
    } else {
      setV(f3, "J229", naSummary(cl34c));
    }
  }

  // ── Clause 35 — Quantitative details ─────────────────────────────────────
  // clauseNo '35' → DB col 'cl_35' (flat; sub-items cl_35a/cl_35b_A/cl_35b_B)
  const cl35 = dig(cl, "cl_35");
  const cl35a = dig(cl35, "cl_35a");
  const cl35b_A = dig(cl35, "cl_35b_A") || dig(cl35, "cl_35bA");
  const cl35b_B = dig(cl35, "cl_35b_B") || dig(cl35, "cl_35bB");
  setV(f3, "J230", naSummary(cl35a) || "");
  setV(f3, "J231", naSummary(cl35b_A) || naSummary(cl35b_B) || "");
  setV(f3, "J232", naSummary(cl35b_A) || "");
  setV(f3, "J233", naSummary(cl35b_B) || "");

  if (ax) {
    const colMap35: Record<string, number> = {
      item_name: 1, unit: 3, opening_stock: 4,
      purchases: 5, sales: 7, closing_stock: 8, shortage_excess: 9,
    };
    const rows35a = rows(cl35a);
    if (rows35a.length > 0) {
      const ANX_35A_START = 161;
      writeSrNos(ax, ANX_35A_START, Math.min(rows35a.length, 3));
      rows35a.slice(0, 3).forEach((r, i) => writeRow(ax, ANX_35A_START + i, r, colMap35));
    }
    const rows35bA = rows(cl35b_A);
    if (rows35bA.length > 0) {
      const ANX_35BA_START = 174;
      writeSrNos(ax, ANX_35BA_START, Math.min(rows35bA.length, 3));
      rows35bA.slice(0, 3).forEach((r, i) => writeRow(ax, ANX_35BA_START + i, r, colMap35));
    }
    const rows35bB = rows(cl35b_B);
    if (rows35bB.length > 0) {
      const ANX_35BB_START = 181;
      writeSrNos(ax, ANX_35BB_START, Math.min(rows35bB.length, 3));
      rows35bB.slice(0, 3).forEach((r, i) => writeRow(ax, ANX_35BB_START + i, r, colMap35));
    }
  }

  // ── Clause 36 — Dividend / buyback under sec 2(22) ───────────────────────
  // clauseNo '36' → DB col 'cl_36' (flat)
  const cl36 = dig(cl, "cl_36");
  const cl36A_sub = dig(cl36, "cl_36A") || dig(cl36, "cl_36a");
  const cl36B_sub = dig(cl36, "cl_36B") || dig(cl36, "cl_36b");
  setV(f3, "J234", ynSummary(cl36A_sub, "Not Applicable"));
  setV(f3, "J242", ynSummary(cl36B_sub, "Not Applicable"));

  // ── Clauses 37–39 — External audits ──────────────────────────────────────
  // clauseNos '37','38','39' share DB col 'cl_37_39' (nested under "37"/"38"/"39")
  const cl37_39 = dig(cl, "cl_37_39") as Record<string, unknown>;
  const cl37 = dig(cl37_39, "37");
  const cl38 = dig(cl37_39, "38");
  const cl39 = dig(cl37_39, "39");
  setV(f3, "J246", ynSummary(cl37, "Not Applicable"));
  setV(f3, "J247", ynSummary(cl38, "Not Applicable"));
  setV(f3, "J248", ynSummary(cl39, "Not Applicable"));

  // ── Clause 40 — Turnover ratios ───────────────────────────────────────────
  if (ax) {
    // clauseNo '40' → DB col 'cl_40' (flat)
    const cl40 = dig(cl, "cl_40");
    // Rows 189-193 (0-idx 188-192): col G (6) = prev year, col I (8) = preceding year
    const CL40_ROWS = ["r1", "r2", "r3", "r4", "r5"];
    CL40_ROWS.forEach((rkey, i) => {
      const rowIdx = 188 + i;
      const prev = cl40[`${rkey}_prev`];
      const prec = cl40[`${rkey}_prec`];
      if (prev !== undefined && prev !== "") setN(ax, XLSX.utils.encode_cell({ r: rowIdx, c: 6 }), prev);
      if (prec !== undefined && prec !== "") setN(ax, XLSX.utils.encode_cell({ r: rowIdx, c: 8 }), prec);
    });
    setV(f3, "J249", "As Per Annexure");
  }

  // ── Clause 41 — Demand/refund under other tax laws ───────────────────────
  // clauseNo '41' → DB col 'cl_41' (flat)
  const cl41 = dig(cl, "cl_41");
  setV(f3, "J250", naSummary(cl41) || "Not Applicable");

  // ── Clauses 42–43 ────────────────────────────────────────────────────────
  // clauseNos '42','43' share DB col 'cl_42_43' (nested under "42" / "43")
  const cl42 = dig(cl, "cl_42_43", "42");
  const cl43 = dig(cl, "cl_42_43", "43");
  setV(f3, "J251", naSummary(cl42) || ynSummary(cl42, "Not Applicable"));
  setV(f3, "J258", ynSummary(cl43, "Not Applicable"));

  // ── Clause 44 — GST breakup ──────────────────────────────────────────────
  // clauseNo '44' → DB col 'cl_44' (flat)
  const cl44 = dig(cl, "cl_44");
  const rows44 = rows(cl44);
  setV(f3, "J269", naSummary(cl44) || ynSummary(cl44, "Yes"));
  if (rows44.length > 0) {
    const r44 = rows44[0];
    const colMap44: Record<string, number> = {
      total_expenditure: 1,
      exempt_gst: 3,
      composition_gst: 4,
      other_registered: 6,
      total_registered: 7,
      not_registered: 8,
    };
    writeRow(f3, 268, r44, colMap44); // row 269 → 0-idx 268
  }

  return wb;
}
