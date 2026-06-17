import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  respectNceManualEdits,
  addNceEdit,
  removeNceEdit,
  findNceEdit,
  computeResyncDiff,
  type NceEdit,
  type NCENoteData,
} from "@/lib/nceAutoPopulate";

const makeNote = (
  cy: Record<string, number> = {},
  py: Record<string, number> = {},
  customRows: NCENoteData["customRows"] = [],
): NCENoteData => ({ cy, py, customRows });

const withEdits = (edits: NceEdit[]): NCENoteData => ({ ...makeNote(), manualEdits: edits });

describe("edit-ledger mutation helpers", () => {
  it("addNceEdit replaces same-key edit (last-write-wins) and keeps noteType-distinct ones", () => {
    let edits: NceEdit[] = [];
    edits = addNceEdit(edits, { kind: "value", noteType: "n", rowId: "r", cy: 1 });
    edits = addNceEdit(edits, { kind: "value", noteType: "n", rowId: "r", cy: 2 });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ cy: 2 });
    edits = addNceEdit(edits, { kind: "value", noteType: "m", rowId: "r", cy: 9 }); // diff note
    expect(edits).toHaveLength(2);
    // a different column is a distinct target
    edits = addNceEdit(edits, { kind: "value", noteType: "n", rowId: "r", col: "st", cy: 3 });
    expect(edits).toHaveLength(3);
  });

  it("removeNceEdit / findNceEdit", () => {
    const edits: NceEdit[] = [
      { kind: "hide", noteType: "n", rowId: "a" },
      { kind: "hide", noteType: "n", rowId: "b" },
    ];
    expect(findNceEdit(edits, e => e.kind === "hide" && e.rowId === "b")).toBeTruthy();
    expect(removeNceEdit(edits, e => e.kind === "hide" && e.rowId === "a")).toHaveLength(1);
  });
});

describe("respectNceManualEdits — overlay onto fresh auto layer", () => {
  it("hide → hiddenRows; label → labelOverrides; ledger-label → sourceLabelOverrides", () => {
    const auto = { other_cl: makeNote({ tds_payable: 100 }) };
    const existing = {
      other_cl: withEdits([
        { kind: "hide", noteType: "other_cl", rowId: "gst_payable" },
        { kind: "label", noteType: "other_cl", rowId: "tds_payable", text: "TDS (net)" },
        { kind: "label", noteType: "other_cl", rowId: "tds_payable", ledger: "TDS 194C", text: "Contractor TDS" },
      ]),
    };
    const out = respectNceManualEdits(auto, existing);
    expect(out.other_cl.hiddenRows).toContain("gst_payable");
    expect(out.other_cl.labelOverrides?.tds_payable).toBe("TDS (net)");
    expect(out.other_cl.sourceLabelOverrides?.["tds_payable::TDS 194C"]).toBe("Contractor TDS");
  });

  it("move → re-attaches a custom row; reclass → ejectedLedgers", () => {
    const auto = { other_cl: makeNote({ custom_a: 50 }, {}, [{ id: "custom_a", label: "A", source: "auto", tbDerived: true }]) };
    const existing = {
      other_cl: withEdits([
        { kind: "move", noteType: "other_cl", rowId: "custom_a", attachedTo: "others", section: "secured" },
        { kind: "reclass", noteType: "other_cl", ledger: "Some Ledger" },
      ]),
    };
    const out = respectNceManualEdits(auto, existing);
    const row = out.other_cl.customRows.find(r => r.id === "custom_a");
    expect(row?.attachedTo).toBe("others");
    expect(row?.section).toBe("secured");
    expect(row?.userMoved).toBe(true);
    expect(out.other_cl.ejectedLedgers).toContain("Some Ledger");
  });

  it("value edit overrides a key the build produced (signed, never abs)", () => {
    const auto = { other_cl: makeNote({ x: 0 }, { x: 0 }) };
    const existing = {
      other_cl: withEdits([{ kind: "value", noteType: "other_cl", rowId: "x", cy: 1500, py: -2790285 }]),
    };
    const out = respectNceManualEdits(auto, existing);
    expect(out.other_cl.cy.x).toBe(1500);
    expect(out.other_cl.py.x).toBe(-2790285); // negative preserved
  });

  it("value edit is GATED: does not resurrect a key the build did not produce", () => {
    const auto = { other_cl: makeNote({ a: 10 }) };
    const existing = {
      other_cl: withEdits([{ kind: "value", noteType: "other_cl", rowId: "ghost", cy: 999 }]),
    };
    const out = respectNceManualEdits(auto, existing);
    expect(out.other_cl.cy.ghost).toBeUndefined();
  });

  it("LT↔ST: a stale _lt value edit can NOT resurrect the old column after the build reclassified to _st", () => {
    // buildFromTb has reclassified the ledger to short-term (COA changed LT→ST):
    // it produced custom_x_st and OMITTED custom_x_lt.
    const auto = {
      borrowings: makeNote(
        { custom_x_st: 60000 },
        { custom_x_st: 55000 },
        [{ id: "custom_x", label: "Term Loan", source: "auto", tbDerived: true }],
      ),
    };
    // The saved ledger still carries a stale LT value edit from before the change.
    const existing = {
      borrowings: withEdits([{ kind: "value", noteType: "borrowings", rowId: "custom_x", col: "lt", cy: 60000, py: 55000 }]),
    };
    const out = respectNceManualEdits(auto, existing);
    expect(out.borrowings.cy.custom_x_lt).toBeUndefined(); // NOT resurrected
    expect(out.borrowings.py.custom_x_lt).toBeUndefined();
    expect(out.borrowings.cy.custom_x_st).toBe(60000);     // build's new ST classification stands
  });

  it("custom hand-typed row (no TB source) is re-created with its signed keys", () => {
    const auto = { other_cl: makeNote() };
    const existing = {
      other_cl: withEdits([
        { kind: "custom", noteType: "other_cl", rowId: "custom_scn", label: "Provision for SCN", keys: { custom_scn: { cy: 10900, py: 10900 } } },
      ]),
    };
    const out = respectNceManualEdits(auto, existing);
    expect(out.other_cl.customRows.find(r => r.id === "custom_scn")?.label).toBe("Provision for SCN");
    expect(out.other_cl.cy.custom_scn).toBe(10900);
    expect(out.other_cl.py.custom_scn).toBe(10900);
  });

  it("TB-derived custom edit is NOT re-created by the overlay (owned by buildFromTb)", () => {
    const auto = { other_cl: makeNote() };
    const existing = {
      other_cl: withEdits([
        { kind: "custom", noteType: "other_cl", rowId: "custom_tb", label: "X", tbDerived: true, ledgerRef: "X Ledger", keys: { custom_tb: { cy: 5 } } },
      ]),
    };
    const out = respectNceManualEdits(auto, existing);
    expect(out.other_cl.customRows.find(r => r.id === "custom_tb")).toBeUndefined();
    expect(out.other_cl.cy.custom_tb).toBeUndefined();
  });

  it("does not mutate its inputs", () => {
    const auto = { n: makeNote({ a: 1 }) };
    const existing = { n: withEdits([{ kind: "hide", noteType: "n", rowId: "a" }]) };
    const snap = JSON.stringify(auto);
    respectNceManualEdits(auto, existing);
    expect(JSON.stringify(auto)).toBe(snap);
  });
});

describe("computeResyncDiff — dry-run preview for the safe Re-sync", () => {
  it("returns no diffs when nothing changed", () => {
    const a = { other_cl: makeNote({ x: 100 }) };
    const b = { other_cl: makeNote({ x: 100 }) };
    expect(computeResyncDiff(a, b)).toEqual([]);
  });

  it("reports a changed value key", () => {
    const a = { other_cl: makeNote({ x: 100 }) };
    const b = { other_cl: makeNote({ x: 250 }) };
    const diff = computeResyncDiff(a, b);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ noteType: "other_cl" });
    expect(diff[0].changes).toContainEqual({ key: "x", oldCy: 100, newCy: 250 });
  });

  it("surfaces an LT→ST reclassification as BOTH columns changing", () => {
    const before = { borrowings: makeNote({ custom_x_lt: 60000 }) };
    const after = { borrowings: makeNote({ custom_x_st: 60000 }) }; // moved LT→ST
    const diff = computeResyncDiff(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].changes).toContainEqual({ key: "custom_x_lt", oldCy: 60000, newCy: 0 });
    expect(diff[0].changes).toContainEqual({ key: "custom_x_st", oldCy: 0, newCy: 60000 });
  });

  it("ignores sub-tolerance noise", () => {
    const a = { n: makeNote({ x: 100 }) };
    const b = { n: makeNote({ x: 100.3 }) };
    expect(computeResyncDiff(a, b)).toEqual([]);
  });

  it("reports a note that appears or disappears", () => {
    const a = { n: makeNote({ x: 100 }) };
    const b = {};
    const diff = computeResyncDiff(a, b);
    expect(diff).toHaveLength(1);
    expect(diff[0].changes).toContainEqual({ key: "x", oldCy: 100, newCy: 0 });
  });
});
