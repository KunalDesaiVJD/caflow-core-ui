/**
 * getEffectiveClientLedger — carry-forward must see corrected numbers.
 *
 * A challan whose consumption a filed correction reduced has to show the
 * freed-up balance to the NEXT quarter, not the amount that was originally
 * filed. tds_challans / tds_deductees are never written by a correction (see
 * tdsCorrections.ts header), so this is the one place that reconciles them.
 */
import { describe, it, expect, vi } from "vitest";

const { rows } = vi.hoisted(() => ({
  rows: {
    tds_challans: [] as any[],
    tds_deductees: [] as any[],
    tds_corrections: [] as any[],
    tds_correction_challans: [] as any[],
    tds_correction_deductees: [] as any[],
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  // A real (if tiny) filter, not a no-op — getEffectiveClientLedger's
  // correctness depends on .eq/.in actually narrowing which rows come back
  // (e.g. only the latest-filed correction's own child rows).
  const build = (table: string) => {
    let data = (rows as any)[table] ?? [];
    const b: any = {
      select: () => b,
      order: () => b,
      eq: (col: string, val: any) => { data = data.filter((r: any) => r[col] === val); return b; },
      in: (col: string, vals: any[]) => { data = data.filter((r: any) => vals.includes(r[col])); return b; },
    };
    b.then = (resolve: any) => Promise.resolve({ data, error: null }).then(resolve);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

import { getEffectiveClientLedger } from "./tdsCorrections";

const reset = () => {
  rows.tds_challans = [];
  rows.tds_deductees = [];
  rows.tds_corrections = [];
  rows.tds_correction_challans = [];
  rows.tds_correction_deductees = [];
};

describe("getEffectiveClientLedger", () => {
  it("returns the original data untouched when nothing has been corrected", async () => {
    reset();
    rows.tds_challans = [{ id: "ch1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", total_challan_amount: 675, late_fees_234e: 0 }];
    rows.tds_deductees = [{ id: "d1", client_id: "c1", challan_id: "ch1", financial_year: "2025-26", quarter: "Q4", total_tax_deducted: 675 }];

    const { challans, deductees } = await getEffectiveClientLedger("c1");
    expect(challans).toEqual(rows.tds_challans);
    expect(deductees).toEqual(rows.tds_deductees);
  });

  it("substitutes a filed correction's reduced deductee amount, freeing up balance for carry-forward", async () => {
    reset();
    rows.tds_challans = [{ id: "ch1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", total_challan_amount: 675, late_fees_234e: 0 }];
    rows.tds_deductees = [{ id: "d1", client_id: "c1", challan_id: "ch1", financial_year: "2025-26", quarter: "Q4", total_tax_deducted: 675 }];
    rows.tds_corrections = [{ id: "corr1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", status: "filed", filed_at: "2026-07-31T10:00:00Z" }];
    rows.tds_correction_challans = [{ id: "cc1", correction_id: "corr1", original_challan_id: "ch1", action: "unchanged", financial_year: "2025-26", quarter: "Q4", total_challan_amount: 675, late_fees_234e: 0 }];
    rows.tds_correction_deductees = [{
      id: "cd1", correction_id: "corr1", correction_challan_id: "cc1", original_deductee_id: "d1",
      action: "modify", financial_year: "2025-26", quarter: "Q4", total_tax_deducted: 550,
      original_values: { total_tax_deducted: 675 },
    }];

    const { challans, deductees } = await getEffectiveClientLedger("c1");
    expect(challans).toHaveLength(1);
    expect(challans[0]).toMatchObject({ id: "ch1", total_challan_amount: 675 });

    expect(deductees).toHaveLength(1);
    expect(deductees[0]).toMatchObject({ id: "d1", challan_id: "ch1", total_tax_deducted: 550 });

    const applied = deductees.reduce((s, d: any) => s + (d.total_tax_deducted || 0), 0);
    expect(675 - applied).toBe(125); // the balance the correction actually freed up
  });

  it("drops a deductee the correction deleted", async () => {
    reset();
    rows.tds_challans = [{ id: "ch1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", total_challan_amount: 500, late_fees_234e: 0 }];
    rows.tds_deductees = [{ id: "d1", client_id: "c1", challan_id: "ch1", financial_year: "2025-26", quarter: "Q4", total_tax_deducted: 500 }];
    rows.tds_corrections = [{ id: "corr1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", status: "filed", filed_at: "2026-07-31T10:00:00Z" }];
    rows.tds_correction_deductees = [{
      id: "cd1", correction_id: "corr1", correction_challan_id: null, original_deductee_id: "d1", action: "delete",
      financial_year: "2025-26", quarter: "Q4", total_tax_deducted: 500,
    }];

    const { deductees } = await getEffectiveClientLedger("c1");
    expect(deductees).toEqual([]);
  });

  it("drops a challan the correction deleted entirely", async () => {
    reset();
    rows.tds_challans = [{ id: "ch1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", total_challan_amount: 500, late_fees_234e: 0 }];
    rows.tds_corrections = [{ id: "corr1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", status: "filed", filed_at: "2026-07-31T10:00:00Z" }];
    rows.tds_correction_challans = [{ id: "cc1", correction_id: "corr1", original_challan_id: "ch1", action: "delete", financial_year: "2025-26", quarter: "Q4", total_challan_amount: 500 }];

    const { challans } = await getEffectiveClientLedger("c1");
    expect(challans).toEqual([]);
  });

  it("uses only the most recently filed correction when a period was corrected twice", async () => {
    reset();
    rows.tds_challans = [{ id: "ch1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", total_challan_amount: 1000, late_fees_234e: 0 }];
    rows.tds_deductees = [{ id: "d1", client_id: "c1", challan_id: "ch1", financial_year: "2025-26", quarter: "Q4", total_tax_deducted: 1000 }];
    rows.tds_corrections = [
      { id: "corr1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", status: "filed", filed_at: "2026-07-01T10:00:00Z" },
      { id: "corr2", client_id: "c1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", status: "filed", filed_at: "2026-07-31T10:00:00Z" },
    ];
    rows.tds_correction_deductees = [
      { id: "cd1", correction_id: "corr1", correction_challan_id: null, original_deductee_id: "d1", action: "modify", financial_year: "2025-26", quarter: "Q4", total_tax_deducted: 900 },
      { id: "cd2", correction_id: "corr2", correction_challan_id: null, original_deductee_id: "d1", action: "modify", financial_year: "2025-26", quarter: "Q4", total_tax_deducted: 800 },
    ];

    const { deductees } = await getEffectiveClientLedger("c1");
    expect(deductees[0]).toMatchObject({ total_tax_deducted: 800 });
  });
});
