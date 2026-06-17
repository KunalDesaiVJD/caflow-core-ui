import { describe, it, expect, vi } from "vitest";

// nceAutoPopulate imports the Supabase client at module load; stub it so these
// pure serialise/deserialise tests don't need env/network.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { serialiseNoteData, deserialiseNoteData, type NceEdit } from "@/lib/nceAutoPopulate";

describe("serialise/deserialise — edit-ledger round-trip (Phase 1 channel)", () => {
  it("is a fixed point for a full row incl. _manual_edits + all legacy channels", () => {
    const manualEdits: NceEdit[] = [
      { kind: "hide", noteType: "other_cl", rowId: "hide_me" },
      { kind: "value", noteType: "other_cl", rowId: "custom_x", col: "st", py: -5 },
    ];
    const cy_data = {
      total: 100,
      custom_x_lt: 50,
      custom_x_st: 25,
      _custom_rows: [{ id: "custom_x", label: "X", source: "manual" }],
      _hidden_rows: ["hide_me"],
      _label_overrides: { row1: "Renamed" },
      _ejected_ledgers: ["Some Ledger"],
      _source_label_overrides: { "row1::Ledger A": "Alias" },
      _cy_sources: { row1: [{ ledger: "Ledger A", amountCy: 10, amountPy: 8 }] },
      _manual_edits: manualEdits,
    };
    const py_data = { total: 90, custom_x_lt: 45, custom_x_st: -5 };

    const out = serialiseNoteData(deserialiseNoteData(cy_data, py_data));
    expect(out.cy_data).toEqual(cy_data);   // legacy channels passed through verbatim + ledger preserved
    expect(out.py_data).toEqual(py_data);   // negative PY preserved (sign, not magnitude)
  });

  it("omits _manual_edits entirely when there are none (no [] pollution)", () => {
    const cy_data = { total: 100, _custom_rows: [], _hidden_rows: [], _label_overrides: {}, _ejected_ledgers: [] };
    const out = serialiseNoteData(deserialiseNoteData(cy_data, { total: 90 }));
    expect("_manual_edits" in out.cy_data).toBe(false);
  });

  it("deserialise always returns manualEdits (defaults to [])", () => {
    const d = deserialiseNoteData({ total: 100 }, {});
    expect(d.manualEdits).toEqual([]);
  });

  it("does NOT leak _manual_edits (or any meta key) into the numeric cy/py maps", () => {
    const edits: NceEdit[] = [{ kind: "hide", noteType: "x", rowId: "r" }];
    const d = deserialiseNoteData(
      { total: 100, _manual_edits: edits, _custom_rows: [{ id: "c", label: "C" }] },
      { total: 90 },
    );
    expect(d.cy.total).toBe(100);
    expect((d.cy as Record<string, unknown>)._manual_edits).toBeUndefined();
    expect((d.cy as Record<string, unknown>)._custom_rows).toBeUndefined();
    expect(d.manualEdits).toHaveLength(1);
    expect(d.customRows).toHaveLength(1);
  });

  it("preserves the exact edit-ledger contents through a round-trip", () => {
    const edits: NceEdit[] = [
      {
        kind: "custom", noteType: "borrowings", rowId: "custom_loan_0",
        label: "Axis Machinery", section: "secured", tbDerived: true,
        ledgerRef: "Axis Machinery",
        keys: { custom_loan_0_lt: { cy: 0, py: 135457 } },
      },
      { kind: "reclass", noteType: "borrowings", ledger: "Bank OD", ejectFrom: "merged_od" },
    ];
    const d = deserialiseNoteData({ x: 1, _manual_edits: edits }, {});
    expect(d.manualEdits).toEqual(edits);
    const out = serialiseNoteData(d);
    expect(out.cy_data._manual_edits).toEqual(edits);
  });
});
