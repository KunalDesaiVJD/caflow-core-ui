import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { validateCorporateFSReconciliation, CANONICAL_NCE_CODE, computeCOATotals } from "@/lib/fsReconciliation";

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

describe("computeCOATotals — RC-21 regression (VADIWALA / RAY WINGS TECHNOLOGY)", () => {
  it("includes a control-char/entity-corrupted TB ledger name the same as its clean equivalent", () => {
    // coa_mapping is always persisted keyed by cleanTallyName() output
    // (PipelineStage3.tsx), but a raw TB row can carry a Tally-exported
    // artifact like "&#13;&#10;". Before the fix, computeCOATotals's
    // lookupMapping only trimmed + lowercased -- never stripped control
    // chars / numeric entities -- so this ledger silently vanished from the
    // anchor total, producing a false "unmapped ledger" + false note drift
    // on the FsHealthPanel, and (via nceAutoPopulate's PY safety-reconcile)
    // a spurious "Other (prior year)" plug row.
    const coaMapping = { "The District TB Centre": { code: "NCE_TR" } };
    const cleanTb = [{ ledger_name: "The District TB Centre", closing_balance: 120960, balance_type: "Dr" }];
    const corruptedTb = [{ ledger_name: "The District TB Centre&#13;&#10;", closing_balance: 120960, balance_type: "Dr" }];

    const cleanResult = computeCOATotals(cleanTb, [], coaMapping);
    const corruptedResult = computeCOATotals(corruptedTb, [], coaMapping);

    expect(corruptedResult["NCE_TR"]).toBeDefined();
    expect(corruptedResult["NCE_TR"].cy).toBe(cleanResult["NCE_TR"].cy);
  });

  it("still resolves via cleanTallyName when the PY-shell TB carries the corrupted name", () => {
    const coaMapping = { "Vehical Expenses": { code: "NCE_OTH_EXP" } };
    const pyTb = [{ ledger_name: "Vehical Expenses&#13;&#10;", closing_balance: 8240, balance_type: "Dr" }];

    const result = computeCOATotals([], pyTb, coaMapping);
    expect(result["NCE_OTH_EXP"]).toBeDefined();
    expect(result["NCE_OTH_EXP"].py).not.toBe(0);
  });

  it("AMBICA regression: a closed PY-only ledger with no direct mapping in either year resolves via parent_group inheritance, matching nceAutoPopulate's own PY-only walk and the COA Mapping screen's pyShellPLAmounts", () => {
    // "Office Expense 18%" existed only in FY 2024-25 (closed before this
    // year), so it has no entry in this year's coaMapping (never existed) and
    // was never individually mapped inside the PY-shell engagement either
    // (pyCoaMap has no key for it) -- direct name lookup fails on both sides.
    // Every OTHER ledger sharing its Tally parent_group ("Indirect Expenses")
    // is consistently mapped to NCE_OTH_EXP, so group inheritance is the only
    // way to classify it -- exactly how nceAutoPopulate's own note-population
    // walk and PipelineStage3.tsx's pyShellPLAmounts already resolve it. Before
    // this fix, computeCOATotals had no group-inheritance tier at all, so this
    // real ₹8,240 ledger silently dropped out of its PY total -- the exact
    // shortfall the PY-safety-reconcile pass "corrected" by plugging a
    // spurious "Other (prior year)" (8,240) row onto an already-correct note.
    const coaMapping = {
      "Freight P":       { code: "NCE_OTH_EXP" },
      "ISI Testing":     { code: "NCE_OTH_EXP" },
    };
    const tb = [
      { ledger_name: "Freight P",   closing_balance: 59801, balance_type: "Dr", parent_group: "Indirect Expenses" },
      { ledger_name: "ISI Testing", closing_balance: 30700, balance_type: "Dr", parent_group: "Indirect Expenses" },
    ];
    const pyTb = [
      { ledger_name: "Freight P",           closing_balance: 178900, balance_type: "Dr", parent_group: "Indirect Expenses" },
      { ledger_name: "Office Expense 18%",  closing_balance: 8240,   balance_type: "Dr", parent_group: "Indirect Expenses" },
    ];

    const result = computeCOATotals(tb, pyTb, coaMapping, {});
    expect(result["NCE_OTH_EXP"]).toBeDefined();
    expect(result["NCE_OTH_EXP"].py).toBe(178900 + 8240);
  });
});
