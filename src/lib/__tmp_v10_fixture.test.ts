import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parseWorkbookRows } from "./tdsWorkbook";

describe("v10 template fixture (manual verification, throwaway)", () => {
  it("parses the filled v10 fixture end-to-end", () => {
    const buf = readFileSync("C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-OneDrive-Documents-GitHub-caflow-core-ui/c2868889-6f4c-412a-b3b8-8600852c896b/scratchpad/TDS_v10_Filled.xlsx");
    const ab = new ArrayBuffer(buf.length);
    new Uint8Array(ab).set(buf);
    const rows = parseWorkbookRows(ab);
    expect(rows.length).toBe(5);
  });

  it("blank (unfilled) v10 template yields 0 rows", () => {
    const buf = readFileSync("C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-OneDrive-Documents-GitHub-caflow-core-ui/c2868889-6f4c-412a-b3b8-8600852c896b/scratchpad/TDS_Data_Entry_v10.xlsx");
    const ab = new ArrayBuffer(buf.length);
    new Uint8Array(ab).set(buf);
    const rows = parseWorkbookRows(ab);
    expect(rows.length).toBe(0);
  });
});
