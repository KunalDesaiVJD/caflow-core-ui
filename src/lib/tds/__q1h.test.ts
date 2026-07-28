import { describe, it, expect } from "vitest";
import fs from "node:fs";
import * as XLSX from "xlsx";
const FILE = "K:/eTDS202627/ca flow TDS 26-27/KWIK TEAM SUPPORT SERVICE PRIVATE LIMITED/24 Q/Q1.xls";
describe("Kwikteam 24Q Annex-I headers", () => {
  it("prints every Annex-I header in full", () => {
    const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer" });
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Annex-I_DeducteeDetails"], { header: 1, defval: null, raw: false });
    (grid[0] || []).forEach((h, i) => { if (h != null && String(h).trim()) console.log(`H[${i}] = ${JSON.stringify(String(h))}`); });
    console.log("--- data row 1 ---");
    (grid[1] || []).forEach((v, i) => { if (v != null && String(v).trim()) console.log(`D[${i}] = ${JSON.stringify(String(v))}`); });
    expect(grid.length).toBeGreaterThan(1);
  }, 120000);
});
