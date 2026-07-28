import { describe, it, expect } from "vitest";
import fs from "node:fs";
import * as XLSX from "xlsx";

const FILE = "K:/eTDS202627/ca flow TDS 26-27/MICROCIRCUTS INNOVATION PRIVATE LIMITED/Q1.xls";

describe("REAL FILE — Genius Q1.xls (24Q)", () => {
  it("dumps sheet names and the rows around the salary/taxable detail", () => {
    const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer", cellDates: true });
    console.log("SHEETS:", JSON.stringify(wb.SheetNames));

    for (const name of wb.SheetNames) {
      const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, raw: false });
      const nonEmpty = grid.filter((r) => r && r.some((c) => c != null && String(c).trim() !== ""));
      console.log(`\n===== SHEET "${name}" — ${grid.length} rows (${nonEmpty.length} non-empty) =====`);
      grid.slice(0, 14).forEach((r, i) => {
        const cells = (r || []).map((c, j) => (c == null || String(c).trim() === "" ? null : `[${j}]${String(c).slice(0, 28)}`)).filter(Boolean);
        if (cells.length) console.log(`r${i}: ${cells.join(" ")}`);
      });
    }
    expect(wb.SheetNames.length).toBeGreaterThan(0);
  }, 180000);
});
