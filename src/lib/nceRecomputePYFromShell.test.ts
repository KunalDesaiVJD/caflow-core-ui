import { describe, it, expect } from "vitest";
import { recomputeNotePYFromShell, type TBRow } from "@/lib/nceRecomputePYFromShell";

const tb = (ledger: string, closing: number, type: "Dr" | "Cr"): TBRow => ({
  ledger_name: ledger, closing_balance: closing, balance_type: type,
});

describe("recomputeNotePYFromShell", () => {
  it("fixes an opening-leak: PY row driven to the shell CLOSING (0 for a settled advance)", () => {
    const cyData = {
      custom_dilip_0: 0,
      _custom_rows: [{ id: "custom_dilip_0", label: "Dilipbhai Mandanka", source: "manual", tbDerived: true }],
    };
    const pyData = { custom_dilip_0: 12000 }; // leaked PY OPENING
    const r = recomputeNotePYFromShell(
      { noteType: "other_cl", cyData, pyData },
      [tb("Dilipbhai Mandanka", 0, "Dr")],   // CY closing 0
      [tb("Dilipbhai Mandanka", 0, "Dr")],   // shell closing 0
    );
    expect(r.patternA).toBe(false);
    expect(r.newPyData.custom_dilip_0).toBe(0);
    expect(r.changes).toContainEqual(
      expect.objectContaining({ rowId: "custom_dilip_0", oldPy: 12000, newPy: 0 }),
    );
  });

  it("fixes under-population: empty PY row refilled from the shell closing", () => {
    const cyData = {
      custom_abc_0: 0,
      _custom_rows: [{ id: "custom_abc_0", label: "ABC Suppliers", sources: [{ ledger: "ABC Suppliers" }] }],
    };
    const pyData = {}; // PY never populated
    const r = recomputeNotePYFromShell(
      { noteType: "trade_payables", cyData, pyData },
      [tb("ABC Suppliers", 0, "Cr")],
      [tb("ABC Suppliers", 50000, "Cr")], // shell has a real payable
    );
    expect(r.newPyData.custom_abc_0).toBe(50000); // CR head, Cr balance → +
  });

  it("flags a ledger owned by >1 row (SKYLARK double-count) and leaves both untouched", () => {
    const cyData = {
      parent_a: 0,
      custom_memberx_1: 0,
      _custom_rows: [
        { id: "parent_a", label: "A", sources: [{ ledger: "Member X" }] },
        { id: "custom_memberx_1", label: "Member X" },
      ],
    };
    const pyData = { parent_a: 100000, custom_memberx_1: 100000 };
    const r = recomputeNotePYFromShell(
      { noteType: "other_cl", cyData, pyData },
      [tb("Member X", 100000, "Cr")],
      [tb("Member X", 100000, "Cr")],
    );
    expect(r.hasAmbiguity).toBe(true);
    expect(r.duplicateLedgers).toContainEqual(
      expect.objectContaining({ ledger: "member x" }),
    );
    // both ambiguous rows preserved unchanged
    expect(r.newPyData.parent_a).toBe(100000);
    expect(r.newPyData.custom_memberx_1).toBe(100000);
    expect(r.changes).toHaveLength(0);
  });

  it("preserves a hand-typed manual row (no ledger behind it)", () => {
    const cyData = {
      custom_scn_0: 10900,
      _custom_rows: [{ id: "custom_scn_0", label: "Provision for SCN demand", source: "manual" }],
    };
    const pyData = { custom_scn_0: 10900 };
    const r = recomputeNotePYFromShell(
      { noteType: "other_cl", cyData, pyData },
      [], [], // no TB ledger matches
    );
    expect(r.newPyData.custom_scn_0).toBe(10900);
    expect(r.changes).toHaveLength(0);
  });

  it("refuses Pattern-A notes (borrowings) and returns them unchanged", () => {
    const cyData = { custom_loan_0_lt: 135457, _custom_rows: [{ id: "custom_loan_0", label: "Axis Machinery" }] };
    const pyData = { custom_loan_0_lt: 135457 };
    const r = recomputeNotePYFromShell(
      { noteType: "borrowings", cyData, pyData },
      [tb("Axis Machinery", 0, "Cr")],
      [tb("Axis Machinery", 0, "Cr")],
    );
    expect(r.patternA).toBe(true);
    expect(r.newPyData).toEqual(pyData); // untouched
  });

  it("never mutates the note structure (_custom_rows preserved)", () => {
    const customRows = [{ id: "custom_abc_0", label: "ABC Suppliers", sources: [{ ledger: "ABC Suppliers" }], userMoved: true, attachedTo: "others" }];
    const cyData = { custom_abc_0: 0, _custom_rows: customRows };
    const r = recomputeNotePYFromShell(
      { noteType: "trade_payables", cyData, pyData: {} },
      [tb("ABC Suppliers", 0, "Cr")],
      [tb("ABC Suppliers", 50000, "Cr")],
    );
    expect(r.newCyData._custom_rows).toEqual(customRows); // structure intact
  });
});
