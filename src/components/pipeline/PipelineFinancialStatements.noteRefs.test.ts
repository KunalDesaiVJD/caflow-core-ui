import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  NCE_CODE_TO_STATIC_REF,
  buildNCEBSRows,
  buildNCEPLRows,
} from "@/components/pipeline/PipelineFinancialStatements";

// RC-22 regression (VADIWALA "Short-term loans and advances" note click did
// nothing): buildNCEBSRows/buildNCEPLRows hardcode a static noteNo per row
// via sn(X, cy, py), while NoteCell derives the *displayed* number from
// NCE_CODE_TO_STATIC_REF[row.code] independently. NCE_STLA's row passed
// sn(14, ...) (a stale pre-refactor value shared with NCE_LTLA) while
// NCE_CODE_TO_STATIC_REF said 20 — so the cell displayed "20" but navigated
// to note 14, which usually has no anchor (LT loans is commonly zero for
// proprietorships) and the click silently no-op'd.
//
// This test asserts the two sources can never drift apart again: for every
// row with a `code`, the noteNo baked into the row (used for navigation)
// must equal NCE_CODE_TO_STATIC_REF[code] (used for the displayed label).
describe("NCE BS/PL note-number consistency (navigation vs. displayed label)", () => {
  // Every code with a static ref gets a non-zero CY value so sn() never
  // zero-suppresses the row out of the check.
  const cy: Record<string, number> = {};
  const py: Record<string, number> = {};
  for (const code of Object.keys(NCE_CODE_TO_STATIC_REF)) {
    cy[code] = 1;
    py[code] = 1;
  }

  it("every buildNCEBSRows() item's noteNo matches NCE_CODE_TO_STATIC_REF[code]", () => {
    const rows = buildNCEBSRows(cy, py);
    const mismatches: string[] = [];
    for (const row of rows) {
      if (!("code" in row) || !row.code || row.noteNo == null) continue;
      const expected = NCE_CODE_TO_STATIC_REF[row.code];
      if (expected != null && row.noteNo !== expected) {
        mismatches.push(`${row.code}: row.noteNo=${row.noteNo} but NCE_CODE_TO_STATIC_REF=${expected}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("every buildNCEPLRows() item's noteNo matches NCE_CODE_TO_STATIC_REF[code]", () => {
    const rows = buildNCEPLRows(cy, py);
    const mismatches: string[] = [];
    for (const row of rows) {
      if (!("code" in row) || !row.code || row.noteNo == null) continue;
      const expected = NCE_CODE_TO_STATIC_REF[row.code];
      if (expected != null && row.noteNo !== expected) {
        mismatches.push(`${row.code}: row.noteNo=${row.noteNo} but NCE_CODE_TO_STATIC_REF=${expected}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
