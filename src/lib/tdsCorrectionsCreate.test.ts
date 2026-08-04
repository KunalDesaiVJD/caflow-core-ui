/**
 * createCorrection — a SECOND correction for the same period must seed from
 * the FIRST correction's filed data, not the original pre-correction data.
 *
 * Regression: createCorrection used to read tds_challans/tds_deductees
 * directly by filing_id. Since a correction never writes back to those
 * tables (see tdsCorrections.ts's own header invariant), that meant a second
 * correction for a period that already had a FILED correction silently
 * re-based itself on the pre-correction-#1 numbers the instant it was
 * opened — correction #1's changes were invisible to correction #2, even
 * though #1 was already filed with the tax department. The fix routes the
 * snapshot through getEffectiveClientLedger() (already trusted for the same
 * "what's actually true now" question by cross-quarter carry-forward math),
 * filtered by financial_year/quarter/form_type rather than filing_id or
 * challan_id — see createCorrection's own comment for why.
 */
import { describe, it, expect, vi } from "vitest";

const { rows } = vi.hoisted(() => ({
  rows: {
    tds_challans: [] as any[],
    tds_deductees: [] as any[],
    tds_corrections: [] as any[],
    tds_correction_challans: [] as any[],
    tds_correction_deductees: [] as any[],
    tds_correction_audit_log: [] as any[],
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  let genSeq = 0;
  const build = (table: string) => {
    let data = (rows as any)[table] ?? [];
    const b: any = {
      select: () => b,
      order: () => b,
      eq: (col: string, val: any) => { data = data.filter((r: any) => r[col] === val); return b; },
      in: (col: string, vals: any[]) => { data = data.filter((r: any) => vals.includes(r[col])); return b; },
      insert: (payload: any) => {
        const arr = Array.isArray(payload) ? payload : [payload];
        const withIds = arr.map((r: any) => ({ id: r.id ?? `${table}-gen-${genSeq++}`, ...r }));
        (rows as any)[table].push(...withIds);
        data = withIds;
        return b;
      },
      single: () => ({ then: (resolve: any) => Promise.resolve({ data: data[0] ?? null, error: null }).then(resolve) }),
    };
    b.then = (resolve: any) => Promise.resolve({ data, error: null }).then(resolve);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

import { createCorrection } from "./tdsCorrections";

const reset = () => {
  rows.tds_challans = [];
  rows.tds_deductees = [];
  rows.tds_corrections = [];
  rows.tds_correction_challans = [];
  rows.tds_correction_deductees = [];
  rows.tds_correction_audit_log = [];
};

const actor = { id: "u1", name: "Reviewer", role: "manager" };
const BASE_ARGS = {
  firmId: "f1", clientId: "c1", financialYear: "2025-26", quarter: "Q4", formType: "26Q",
  filingId: "filing1", reason: "test", actor,
};

describe("createCorrection — seeds from the latest FILED correction, not the original filing", () => {
  it("with no prior correction, seeds from the original tds_challans/tds_deductees (unchanged behaviour)", async () => {
    reset();
    rows.tds_challans = [{ id: "ch1", client_id: "c1", filing_id: "filing1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_challan_amount: 1000, is_archived: false }];
    rows.tds_deductees = [{ id: "d1", client_id: "c1", filing_id: "filing1", challan_id: "ch1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_tax_deducted: 1000 }];

    const { correction, error } = await createCorrection(BASE_ARGS);
    expect(error).toBeNull();
    expect(correction).not.toBeNull();

    const snapDeductees = rows.tds_correction_deductees.filter(d => d.correction_id === correction!.id);
    expect(snapDeductees).toHaveLength(1);
    expect(snapDeductees[0]).toMatchObject({ total_tax_deducted: 1000, action: "unchanged" });
  });

  it("THE BUG, FIXED: a second correction seeds from the first FILED correction's corrected amount, not the pre-correction original", async () => {
    reset();
    rows.tds_challans = [{ id: "ch1", client_id: "c1", filing_id: "filing1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_challan_amount: 1000, is_archived: false }];
    rows.tds_deductees = [{ id: "d1", client_id: "c1", filing_id: "filing1", challan_id: "ch1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_tax_deducted: 1000 }];
    // Correction #1: already filed, revised the deductee's TDS from 1000 -> 700.
    rows.tds_corrections = [{ id: "corr1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", status: "filed", filed_at: "2026-07-31T10:00:00Z" }];
    rows.tds_correction_challans = [{ id: "cc1", correction_id: "corr1", original_challan_id: "ch1", action: "unchanged", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_challan_amount: 1000 }];
    rows.tds_correction_deductees = [{
      id: "cd1", correction_id: "corr1", correction_challan_id: "cc1", original_deductee_id: "d1",
      action: "modify", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_tax_deducted: 700,
      original_values: { total_tax_deducted: 1000 },
    }];

    // Now prepare correction #2 for the SAME period.
    const { correction: corr2, error } = await createCorrection({ ...BASE_ARGS, reason: "second correction" });
    expect(error).toBeNull();

    const snapDeductees = rows.tds_correction_deductees.filter(d => d.correction_id === corr2!.id);
    expect(snapDeductees).toHaveLength(1);
    // THE ASSERTION THAT WOULD HAVE FAILED BEFORE THE FIX: seeded from
    // correction #1's 700, not the original filing's 1000.
    expect(snapDeductees[0].total_tax_deducted).toBe(700);
    expect(snapDeductees[0].action).toBe("unchanged"); // correction #2 opens as a faithful snapshot, nothing pre-flagged as changed
    // The snapshot must still point back at the ORIGINAL deductee id (d1),
    // not correction #1's own row id (cd1) — every later cross-reference
    // (a subsequent correction, live carry-forward) keys off the original id.
    expect(snapDeductees[0].original_deductee_id).toBe("d1");
  });

  it("a deductee correction #1 DELETED must not reappear in correction #2's snapshot", async () => {
    reset();
    rows.tds_challans = [{ id: "ch1", client_id: "c1", filing_id: "filing1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_challan_amount: 500, is_archived: false }];
    rows.tds_deductees = [
      { id: "d1", client_id: "c1", filing_id: "filing1", challan_id: "ch1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_tax_deducted: 500 },
    ];
    rows.tds_corrections = [{ id: "corr1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", status: "filed", filed_at: "2026-07-31T10:00:00Z" }];
    rows.tds_correction_deductees = [{
      id: "cd1", correction_id: "corr1", correction_challan_id: null, original_deductee_id: "d1",
      action: "delete", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_tax_deducted: 500,
    }];

    const { correction: corr2 } = await createCorrection({ ...BASE_ARGS, reason: "second correction" });
    const snapDeductees = rows.tds_correction_deductees.filter(d => d.correction_id === corr2!.id);
    expect(snapDeductees).toEqual([]);
  });

  it("a DRAFT (not yet filed) correction is ignored — only a FILED correction is a valid new baseline", async () => {
    reset();
    rows.tds_challans = [{ id: "ch1", client_id: "c1", filing_id: "filing1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_challan_amount: 1000, is_archived: false }];
    rows.tds_deductees = [{ id: "d1", client_id: "c1", filing_id: "filing1", challan_id: "ch1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_tax_deducted: 1000 }];
    // An UNFILED draft correction with a different amount must not be used —
    // it hasn't been submitted to the department, so it isn't "current" yet.
    rows.tds_corrections = [{ id: "corr1", client_id: "c1", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", status: "draft" }];
    rows.tds_correction_deductees = [{
      id: "cd1", correction_id: "corr1", correction_challan_id: null, original_deductee_id: "d1",
      action: "modify", financial_year: "2025-26", quarter: "Q4", form_type: "26Q", total_tax_deducted: 250,
    }];

    const { correction: corr2 } = await createCorrection(BASE_ARGS);
    const snapDeductees = rows.tds_correction_deductees.filter(d => d.correction_id === corr2!.id);
    expect(snapDeductees[0].total_tax_deducted).toBe(1000); // original, not the draft's 250
  });
});
