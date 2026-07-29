/**
 * Field-level diff — the data behind "Original vs Corrected".
 *
 * The snapshot is taken by a DB trigger the instant before the first edit, so
 * these tests pin the READING of it: what counts as a change, what must never
 * be reported as one, and that additions/deletions are not treated as diffs.
 */
import { describe, it, expect } from "vitest";
import { diffCorrectionRow } from "./tdsCorrections";

describe("diffCorrectionRow", () => {
  it("reports only the fields that actually changed", () => {
    const row = {
      deductee_name: "CORRECTED NAME", deductee_pan: "AAAPA1234A",
      tds_amount: 250, section_code: "194C",
      original_values: {
        deductee_name: "ORIGINAL NAME", deductee_pan: "AAAPA1234A",
        tds_amount: 100, section_code: "194C",
      },
    };
    const d = diffCorrectionRow(row);
    expect(d.map(x => x.field).sort()).toEqual(["deductee_name", "tds_amount"]);
    expect(d.find(x => x.field === "tds_amount")).toMatchObject({
      label: "TDS", original: 100, corrected: 250,
    });
  });

  it("does not treat 100 vs '100' or null vs '' as a change", () => {
    // Postgres numerics come back as strings over PostgREST, and a cleared
    // field is sometimes '' and sometimes null. Neither is a real edit.
    const row = {
      tds_amount: "100", remarks: "",
      original_values: { tds_amount: 100, remarks: null },
    };
    expect(diffCorrectionRow(row)).toEqual([]);
  });

  it("ignores bookkeeping columns the user never edits", () => {
    const row = {
      id: "new", correction_id: "c2", filing_id: "c2", updated_at: "later",
      action: "modify", firm_id: "f", client_id: "cl",
      original_values: {
        id: "old", correction_id: "c1", filing_id: "c1", updated_at: "earlier",
        action: "unchanged", firm_id: "f", client_id: "cl",
      },
    };
    expect(diffCorrectionRow(row)).toEqual([]);
  });

  it("returns nothing for an addition — there is no original to compare", () => {
    expect(diffCorrectionRow({ deductee_name: "NEW", action: "add" })).toEqual([]);
    expect(diffCorrectionRow({ deductee_name: "NEW", original_values: null })).toEqual([]);
  });

  it("labels challan fields too", () => {
    const d = diffCorrectionRow({
      bsr_code: "9999999",
      original_values: { bsr_code: "0510308" },
    });
    expect(d).toEqual([{
      field: "bsr_code", label: "BSR code",
      original: "0510308", corrected: "9999999",
    }]);
  });
});
