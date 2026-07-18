/**
 * Regression tests for the Genius Excel Section-field bug the user reported on
 * a real client file ("revti Q4.xls", verified directly). Two independent
 * defects, both generic (neither is specific to any one client or section):
 *
 *  BUG A — cleanSection() force-uppercased the whole cell, corrupting every
 *  section with a parenthetical sub-code ("194J(b)" -> "194J(B)"), which then
 *  matched nothing already in Rate Master anywhere in the app. Plain codes
 *  (194A, 194C, 194H…) were unaffected — exactly why the Section field went
 *  missing "sometimes" rather than always.
 *
 *  BUG B — the importer only ever auto-created "194C" in Rate Master. Any
 *  other section, correctly cased or not, was left unusable if the firm's
 *  Rate Master didn't already have it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertCalls: { rows: any[]; opts: any }[] = [];
let existingRows: { section_code: string }[] = [];

function makeBuilder() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    delete: () => builder,
    update: () => builder,
    in: () => builder,
    upsert: (rows: any[], opts: any) => {
      upsertCalls.push({ rows, opts });
      return Promise.resolve({ data: rows, error: null });
    },
    then: (resolve: any) => resolve({ data: existingRows, error: null }),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => makeBuilder() },
}));

import { cleanSection, ensureRateMasterSections } from "./genius-import";

beforeEach(() => {
  upsertCalls.length = 0;
  existingRows = [];
});

describe("cleanSection — preserves the file's own casing", () => {
  it("strips Genius's internal numeric prefix", () => {
    expect(cleanSection("1023-194C")).toBe("194C");
  });

  it("does NOT force-uppercase a parenthetical sub-code (the actual bug)", () => {
    // Verified against the user's real file: the challan carries "194J", the
    // deductee rows carry "194J(b)" verbatim — a genuine sub-rate split, not a
    // typo. Uppercasing this produced "194J(B)", matching nothing in Rate
    // Master (whose own convention, confirmed with zero exceptions across the
    // codebase, is a lowercase letter inside the parens).
    expect(cleanSection("194J(b)")).toBe("194J(b)");
    expect(cleanSection("194I(a)")).toBe("194I(a)");
    expect(cleanSection("206C(1G)(a)")).toBe("206C(1G)(a)");
  });

  it("leaves a plain code untouched", () => {
    expect(cleanSection("194A")).toBe("194A");
    expect(cleanSection("  194C  ")).toBe("194C");
  });

  it("handles blank/absent cells", () => {
    expect(cleanSection("")).toBe("");
    expect(cleanSection(null)).toBe("");
    expect(cleanSection(undefined)).toBe("");
  });
});

describe("ensureRateMasterSections — generic auto-create, not a 194C special case", () => {
  it("rewrites to the EXISTING row's casing when one already matches case-insensitively", async () => {
    existingRows = [{ section_code: "194J(b)" }];
    const { rewrite, warnings } = await ensureRateMasterSections(
      ["194j(B)"], "firm-1", "26Q", "2025-26",
    );
    expect(rewrite.get("194j(B)")).toBe("194J(b)");
    expect(upsertCalls).toHaveLength(0); // already exists — nothing to create
    expect(warnings).toHaveLength(0);
  });

  it("auto-creates a genuinely missing section using CAFlow's standard rate table", async () => {
    existingRows = []; // firm has no 194J(b) yet
    const { rewrite, warnings } = await ensureRateMasterSections(
      ["194J(b)"], "firm-1", "26Q", "2025-26",
    );
    expect(rewrite.get("194J(b)")).toBe("194J(b)");
    expect(upsertCalls).toHaveLength(1);
    const row = upsertCalls[0].rows[0];
    expect(row.section_code).toBe("194J(b)");
    expect(row.nature_of_payment).toBe("Technical Services");
    expect(row.rate_individual).toBe(2);
    expect(row.assessment_year).toBe("2026-27"); // derived from FY 2025-26
    expect(row.firm_id).toBe("firm-1");
    expect(warnings[0]).toMatch(/standard rate table/i);
  });

  it("still auto-creates 194C exactly as before, via the SAME generic path", async () => {
    existingRows = [];
    const { rewrite, warnings } = await ensureRateMasterSections(
      ["194C"], "firm-1", "26Q", "2025-26",
    );
    expect(rewrite.get("194C")).toBe("194C");
    expect(upsertCalls[0].rows[0].nature_of_payment).toBe("Contractor / Sub-contractor");
    expect(warnings[0]).toMatch(/standard rate table/i);
  });

  it("creates a flagged placeholder for a section CAFlow has never seen", async () => {
    existingRows = [];
    const { rewrite, warnings } = await ensureRateMasterSections(
      ["194ZZ"], "firm-1", "26Q", "2025-26",
    );
    expect(rewrite.get("194ZZ")).toBe("194ZZ");
    const row = upsertCalls[0].rows[0];
    expect(row.section_code).toBe("194ZZ");
    expect(row.rate_individual).toBe(0);
    expect(row.notes).toMatch(/verify/i);
    expect(warnings[0]).toMatch(/placeholder/i);
  });

  it("never creates two rows for two different-cased spellings of one section", async () => {
    existingRows = [];
    const { rewrite } = await ensureRateMasterSections(
      ["194j(b)", "194J(B)", "194J(b)"], "firm-1", "26Q", "2025-26",
    );
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].rows).toHaveLength(1); // deduped to ONE canonical row
    expect(rewrite.get("194j(b)")).toBe("194J(b)");
    expect(rewrite.get("194J(B)")).toBe("194J(b)");
    expect(rewrite.get("194J(b)")).toBe("194J(b)");
  });

  it("is a no-op for an empty section list", async () => {
    const { rewrite, warnings } = await ensureRateMasterSections([], "firm-1", "26Q", "2025-26");
    expect(rewrite.size).toBe(0);
    expect(warnings).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });
});
