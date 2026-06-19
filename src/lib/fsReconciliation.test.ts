import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { validateCorporateFSReconciliation, CANONICAL_NCE_CODE } from "@/lib/fsReconciliation";

describe("validateCorporateFSReconciliation — BUG-024/D2.8 COA anchor keying + corporate manualVerified", () => {
  it("looks up coaTotals via the canonical NCE fold (not the raw corporate code), so the COA anchor is real", () => {
    // computeCOATotals keys its output by CANONICAL_NCE_CODE[mapped.code]; the corporate
    // code must fold the same way. BS_CL_TP folds to a canonical NCE code (NCE_TP).
    const coaKey = CANONICAL_NCE_CODE["BS_CL_TP"] ?? "BS_CL_TP";
    expect(coaKey).not.toBe("BS_CL_TP"); // sanity: the corporate code genuinely folds

    const res = validateCorporateFSReconciliation({
      corporateNotes: {
        bs_liab: {
          trade_payables: {
            breakup: [{ description: "Creditor A", amount_cy: 1000, amount_py: 0, source: "manual" }],
          },
        },
      } as any,
      bsFaceCy: { BS_CL_TP: 1000 },
      bsFacePy: {},
      // Keyed by the CANONICAL code — i.e. exactly what computeCOATotals emits.
      coaTotals: { [coaKey]: { cy: 600, py: 0 } },
    });

    const tp = res.rows.find((r) => r.code === "BS_CL_TP");
    expect(tp).toBeTruthy();
    // Before the fix the lookup missed and coaTotal defaulted to the note total
    // (so manualDelta was ALWAYS 0). After the fix the anchor is the real COA value.
    expect(tp!.coaTotal.cy).toBe(600);
    // And the manual breakup row is recognised, so a genuine Note≠COA gap can be
    // distinguished from an unexplained engine divergence (PD-2).
    expect(tp!.manualVerified).toBe(true);
  });

  it("FS_BLOCK_UNEXPLAINED_DRIFT: an unexplained Note!=COA gap escalates to drift and blocks (PD-2 Phase-3)", () => {
    const coaKey = CANONICAL_NCE_CODE["BS_CL_TP"] ?? "BS_CL_TP";
    const notes = { bs_liab: { trade_payables: { breakup: [{ description: "X", amount_cy: 1000, amount_py: 0, source: "auto", linked_ledger: "L" }] } } } as any;
    const args = { corporateNotes: notes, bsFaceCy: { BS_CL_TP: 1000 }, bsFacePy: {}, coaTotals: { [coaKey]: { cy: 600, py: 0 } } };
    // OFF (default): a Note!=COA gap with no manual row is shown as "manual", does NOT block.
    const off = validateCorporateFSReconciliation(args);
    const offRow = off.rows.find((r) => r.code === "BS_CL_TP");
    expect(offRow!.status).toBe("manual");
    expect(off.severeCount).toBe(0);
    // ON: the unexplained gap (>= Rs.100, no manual row) escalates to drift and counts to the block.
    const on = validateCorporateFSReconciliation({ ...args, blockUnexplained: true });
    const onRow = on.rows.find((r) => r.code === "BS_CL_TP");
    expect(onRow!.status).toBe("drift_severe");
    expect(on.severeCount).toBeGreaterThanOrEqual(1);
  });

  it("does not crash and leaves manualVerified false when there is no manual breakup row", () => {
    const coaKey = CANONICAL_NCE_CODE["BS_CL_TP"] ?? "BS_CL_TP";
    const res = validateCorporateFSReconciliation({
      corporateNotes: { bs_liab: { trade_payables: { breakup: [{ description: "Linked", amount_cy: 500, source: "auto", linked_ledger: "X" }] } } } as any,
      bsFaceCy: { BS_CL_TP: 500 },
      bsFacePy: {},
      coaTotals: { [coaKey]: { cy: 500, py: 0 } },
    });
    const tp = res.rows.find((r) => r.code === "BS_CL_TP");
    expect(tp).toBeTruthy();
    expect(tp!.manualVerified).toBe(false);
  });
});
