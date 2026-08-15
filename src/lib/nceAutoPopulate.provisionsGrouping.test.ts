import { describe, it, expect } from "vitest";
import { computeNoteTotals } from "@/lib/nceNoteTotals";
import { NOTES_CONFIG } from "@/config/nceNotesConfig";

// Regression for "bifurcation not displaying / ledgers show in a haphazard
// manner" on the Short-Term Provisions note: NOTE_SMART_MAP has no rules for
// "provisions" (unlike other_cl/employee_exp/etc.), so every provisions
// ledger previously landed as an UNATTACHED customRow — which
// computeNoteTotals only rolls into the grand total directly (as an
// "extra"), bypassing the "Other Provisions" static row entirely. On an
// entity with many individually-named provision ledgers (RAYWINGS: "ANIL",
// "ASHOK", "BHARAT" ... 73 of them) that rendered as one flat, unsorted list
// with no indication of which real Tally sub-group each ledger came from.
//
// The fix (nceAutoPopulate.ts, the `noteType === "provisions"` branch) groups
// per-ledger customRows under a synthetic wrapper customRow keyed by each
// ledger's own Tally parent_group, with the wrapper itself attached to
// "other_prov". This test proves that restructuring is loss-free: the grand
// total, computed by the SAME canonical aggregator the BS face and DOCX
// export use, is byte-identical whether the ledgers are flat/unattached (the
// old shape) or grouped under per-parent_group wrappers (the new shape).
describe("nceNoteTotals — provisions per-ledger grouping preserves totals exactly", () => {
  const config = NOTES_CONFIG.find(c => c.noteType === "provisions_st")!;

  it("provisions_st config exists with the expected catch-all row", () => {
    expect(config).toBeDefined();
    expect(config.rows.map(r => r.id)).toEqual(["income_tax", "other_prov", "total"]);
  });

  it("grand total is identical whether ledgers are flat/unattached or grouped by parent_group", () => {
    const rawCy = { income_tax: 0, other_prov: 0 };
    const rawPy = { income_tax: 0, other_prov: 0 };

    // OLD shape — every ledger unattached, no section (matches pre-fix
    // nceAutoPopulate behaviour when NOTE_SMART_MAP had no "provisions" rule).
    const flatRows = [
      { id: "custom_anil",   label: "ANIL" },
      { id: "custom_ashok",  label: "ASHOK" },
      { id: "custom_bharat", label: "BHARAT" },
    ];
    const flatCy = { ...rawCy, custom_anil: 22138, custom_ashok: 22058, custom_bharat: 16258 };
    const flatPy = { ...rawPy, custom_anil: 26200, custom_ashok: 20124, custom_bharat: 12384 };
    const flatTotals = computeNoteTotals(config, flatCy, flatPy, flatRows);

    // NEW shape — grouped under two synthetic parent_group wrappers, both
    // attached to "other_prov". Wrapper rows carry no value of their own.
    const groupedRows = [
      { id: "custom_provgrp_outstanding_salary",     label: "Outstanding Salary",     attachedTo: "other_prov" },
      { id: "custom_provgrp_outstanding_for_labour",  label: "Outstanding For Labour", attachedTo: "other_prov" },
      { id: "custom_anil",   label: "ANIL",   attachedTo: "custom_provgrp_outstanding_salary" },
      { id: "custom_ashok",  label: "ASHOK",  attachedTo: "custom_provgrp_outstanding_salary" },
      { id: "custom_bharat", label: "BHARAT", attachedTo: "custom_provgrp_outstanding_for_labour" },
    ];
    const groupedCy = { ...rawCy, custom_anil: 22138, custom_ashok: 22058, custom_bharat: 16258 };
    const groupedPy = { ...rawPy, custom_anil: 26200, custom_ashok: 20124, custom_bharat: 12384 };
    const groupedTotals = computeNoteTotals(config, groupedCy, groupedPy, groupedRows);

    expect(groupedTotals.pattern).toBe("B");
    expect(flatTotals.pattern).toBe("B");
    if (groupedTotals.pattern === "B" && flatTotals.pattern === "B") {
      // The invariant that matters: no drift between the old flat shape and
      // the new grouped shape.
      expect(groupedTotals.grandTotal).toEqual(flatTotals.grandTotal);
      expect(groupedTotals.grandTotal).toEqual({ cy: 60454, py: 58708 });

      // The NEW shape additionally makes "Other Provisions" itself reflect
      // its real content (the old shape left it at 0 — the money bypassed it
      // via the grand-total's unattached "extras" path).
      expect(groupedTotals.perRow["other_prov"]).toEqual({ cy: 60454, py: 58708 });
      expect(flatTotals.perRow["other_prov"]).toEqual({ cy: 0, py: 0 });

      // Each group wrapper subtotals only its own members.
      expect(groupedTotals.perRow["custom_provgrp_outstanding_salary"]).toEqual({ cy: 44196, py: 46324 });
      expect(groupedTotals.perRow["custom_provgrp_outstanding_for_labour"]).toEqual({ cy: 16258, py: 12384 });
    }
  });
});
