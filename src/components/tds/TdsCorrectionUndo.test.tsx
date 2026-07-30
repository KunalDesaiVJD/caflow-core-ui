/**
 * Undo returns a change to the FILED state.
 *
 *   added    -> row removed outright (it never existed in the filing)
 *   modified -> every field restored from the pre-edit snapshot
 *   deleted  -> row comes back, values restored
 *
 * Restoring from `original_values` reproduces the filed row exactly rather
 * than guessing, which is why the snapshot exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { calls } = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => {
  const build = (table: string) => {
    const b: any = {};
    b.update = (u: any) => { calls.push({ op: "update", table, payload: u }); return b; };
    b.delete = () => { calls.push({ op: "delete", table }); return b; };
    b.eq = (_c: string, v: any) => { calls[calls.length - 1].id = v; return Promise.resolve({ error: null }); };
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});
import { undoCorrectionRow } from "@/lib/tdsCorrections";

describe("undoCorrectionRow", () => {
  beforeEach(() => { calls.length = 0; });

  it("removes a row that was ADDED in this correction", async () => {
    await undoCorrectionRow("tds_correction_deductees", { id: "d2", action: "add" } as any);
    expect(calls[0]).toMatchObject({ op: "delete", table: "tds_correction_deductees", id: "d2" });
  });

  it("restores every field of a MODIFIED row from the snapshot", async () => {
    await undoCorrectionRow("tds_correction_deductees", {
      id: "d1", action: "modify",
      original_values: { deductee_name: "ORIGINAL", tds_amount: 100, amount_paid_credited: 4000 },
    } as any);
    const c = calls[0];
    expect(c.op).toBe("update");
    expect(c.id).toBe("d1");
    expect(c.payload).toMatchObject({
      deductee_name: "ORIGINAL", tds_amount: 100, amount_paid_credited: 4000,
      action: "unchanged", original_values: null,
    });
  });

  it("brings a DELETED row back with its filed values", async () => {
    await undoCorrectionRow("tds_correction_deductees", {
      id: "d3", action: "delete",
      original_values: { deductee_name: "GONE", tds_amount: 900 },
    } as any);
    expect(calls[0].payload).toMatchObject({
      deductee_name: "GONE", tds_amount: 900, action: "unchanged",
    });
  });

  it("never writes id/action/original_values back from the snapshot", async () => {
    await undoCorrectionRow("tds_correction_challans", {
      id: "c1", action: "modify",
      original_values: { id: "STALE", action: "unchanged", original_values: { x: 1 }, bsr_code: "0510308" },
    } as any);
    const p = calls[0].payload;
    expect(p.id).toBeUndefined();          // must not resurrect a stale id
    expect(p.bsr_code).toBe("0510308");
    expect(p.action).toBe("unchanged");
    expect(p.original_values).toBeNull();  // cleared, not nested
  });
});
