import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { computeCOATotals } from "@/lib/fsReconciliation";
import { computeNceCoaAnchoredFace } from "@/lib/nceFaceAnchor";

describe("computeCOATotals — pyOpen (PY-shell TB's own opening balance)", () => {
  it("sums the PY-shell TB's opening_balance for a mapped inventory ledger, independent of its closing", () => {
    const coaMapping = { "Closing Stock": { code: "NCE_STCK" } };
    // PY-shell TB row: opening_balance = stock at the START of PY (closing two
    // years back), closing_balance = stock at the END of PY (= CY opening).
    const pyTb = [{
      ledger_name: "Closing Stock",
      opening_balance: 400000, opening_type: "Dr",
      closing_balance: 300000, balance_type: "Dr",
    }];

    const result = computeCOATotals([], pyTb, coaMapping, coaMapping);
    expect(result["NCE_STCK"]).toBeDefined();
    expect(result["NCE_STCK"].py).toBe(300000);
    expect(result["NCE_STCK"].pyOpen).toBe(400000);
  });

  it("pyOpen is 0 (not populated) when there is no PY-shell TB", () => {
    const coaMapping = { "Closing Stock": { code: "NCE_STCK" } };
    const tb = [{
      ledger_name: "Closing Stock",
      opening_balance: 400000, opening_type: "Dr",
      closing_balance: 300000, balance_type: "Dr",
    }];
    const result = computeCOATotals(tb, [], coaMapping);
    expect(result["NCE_STCK"].pyOpen).toBe(0);
  });
});

describe("computeNceCoaAnchoredFace — RC4 PY Changes in Inventory derivation", () => {
  it("derives CY NCE_CII from PY-shell closing (py) minus CY closing (cy), always (ciiDerived=true)", () => {
    const coa = { NCE_STCK: { cy: 500, py: 300, pyOpen: 400 } };
    const { face, ciiDerived } = computeNceCoaAnchoredFace(coa, "cy");
    expect(face["NCE_CII"]).toBe(300 - 500); // opening(py) - closing(cy)
    expect(ciiDerived).toBe(true);
  });

  it("derives PY NCE_CII from the PY-shell's own opening stock (pyOpen) minus its closing (py), when pyOpen is available", () => {
    const coa = { NCE_STCK: { cy: 500, py: 300, pyOpen: 400 } };
    const { face, ciiDerived } = computeNceCoaAnchoredFace(coa, "py");
    expect(face["NCE_CII"]).toBe(400 - 300); // pre-PY opening - PY closing
    expect(ciiDerived).toBe(true);
  });

  it("leaves NCE_CII un-derived (ciiDerived=false) for PY when pyOpen is unavailable — no PY shell loaded", () => {
    const coa = { NCE_STCK: { cy: 500, py: 300 } }; // pyOpen absent (legacy / no shell)
    const { ciiDerived } = computeNceCoaAnchoredFace(coa, "py");
    expect(ciiDerived).toBe(false);
  });

  it("treats a genuine zero opening stock as derived (0 is a real value, not \"missing\")", () => {
    const coa = { NCE_STCK: { cy: 500, py: 300, pyOpen: 0 } };
    const { face, ciiDerived } = computeNceCoaAnchoredFace(coa, "py");
    expect(ciiDerived).toBe(true);
    expect(face["NCE_CII"]).toBe(0 - 300);
  });
});
