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

// Table-aware mock: tds_rate_master (select existing / upsert new),
// tds_challans and tds_deductees (select current rows / update in place —
// exercised by repairFilingSectionCodes, which reads and rewrites ALREADY
// STORED rows without touching tds_rate_master's own select/upsert path).
const upsertCalls: { rows: any[]; opts: any }[] = [];
const updateCalls: { table: string; patch: any; ids: any[] }[] = [];
let existingRows: { section_code: string }[] = [];
let challanRows: { id: string; section_code: string }[] = [];
let deducteeRows: { id: string; section_code: string }[] = [];

function makeBuilder(table: string) {
  let pendingPatch: any = null;
  const eqFilters: [string, any][] = [];
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: any) => { eqFilters.push([col, val]); return builder; },
    delete: () => builder,
    update: (patch: any) => { pendingPatch = patch; return builder; },
    in: (col: string, vals: any[]) => {
      if (pendingPatch) {
        updateCalls.push({ table, patch: pendingPatch, ids: vals });
        return Promise.resolve({ data: vals, error: null });
      }
      // Real filtering, but ONLY for tds_challans — the table
      // resolveExistingChallansByNumber's client-scoping regression needs to
      // actually prove out. Every other table keeps returning its full
      // canned set regardless of .eq()/.in(), exactly as before, so none of
      // the other tests below need to change.
      if (table === "tds_challans") {
        const filtered = challanRows.filter((r: any) =>
          eqFilters.every(([c, v]) => r[c] === v) && vals.includes(r.challan_serial_no));
        return Promise.resolve({ data: filtered, error: null });
      }
      return builder;
    },
    upsert: (rows: any[], opts: any) => {
      upsertCalls.push({ rows, opts });
      return Promise.resolve({ data: rows, error: null });
    },
    then: (resolve: any) => {
      const data = table === "tds_challans" ? challanRows : table === "tds_deductees" ? deducteeRows : existingRows;
      resolve({ data, error: null });
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

import { cleanSection, ensureRateMasterSections, repairFilingSectionCodes, resolveExistingChallansByNumber, resolveDeclaredAssessmentYear, validateFinancialYearMatch } from "./genius-import";

beforeEach(() => {
  upsertCalls.length = 0;
  updateCalls.length = 0;
  existingRows = [];
  challanRows = [];
  deducteeRows = [];
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

describe("repairFilingSectionCodes — fixes rows already sitting in the database", () => {
  // The user's reported symptom AFTER the importer fix shipped: the SAME
  // filing's deductee rows, imported before the fix, still show a blank
  // Section dropdown. Re-importing is not the answer — deductees have no
  // dedup, so it would double the rows instead of correcting them. This
  // rewrites what's already stored, exercised end-to-end against the exact
  // shape the bug produced: challan "194J", deductees corrupted to "194J(B)".
  it("rewrites the corrupted deductee rows in place, without touching challans that are already correct", async () => {
    existingRows = []; // firm has never seeded 194J(b)
    challanRows = [{ id: "ch-1", section_code: "194J" }];
    deducteeRows = [
      { id: "d-1", section_code: "194J(B)" },
      { id: "d-2", section_code: "194J(B)" },
      { id: "d-3", section_code: "194J(B)" },
    ];

    const result = await repairFilingSectionCodes("filing-1", "firm-1", "26Q", "2025-26");

    expect(result.deducteesFixed).toBe(3);
    // 194J (bare) has no seed rate — it's created as a placeholder, not
    // rewritten, so the challan needs NO update (its stored text already
    // equals its own canonical form).
    expect(result.challansFixed).toBe(0);

    const deducteeUpdate = updateCalls.find((u) => u.table === "tds_deductees");
    expect(deducteeUpdate?.patch).toEqual({ section_code: "194J(b)" });
    expect(deducteeUpdate?.ids.sort()).toEqual(["d-1", "d-2", "d-3"]);
    expect(updateCalls.some((u) => u.table === "tds_challans")).toBe(false);

    // Rate Master gained the missing sections along the way (194J(b) from
    // the seed table, bare 194J as a flagged placeholder) — same generic
    // path a fresh import uses.
    const created = upsertCalls.flatMap((u) => u.rows).map((r: any) => r.section_code);
    expect(created).toEqual(expect.arrayContaining(["194J(b)", "194J"]));
  });

  it("costs zero writes when everything already matches Rate Master", async () => {
    existingRows = [{ section_code: "194C" }];
    challanRows = [{ id: "ch-1", section_code: "194C" }];
    deducteeRows = [{ id: "d-1", section_code: "194C" }];

    const result = await repairFilingSectionCodes("filing-2", "firm-1", "26Q", "2025-26");

    expect(result.challansFixed).toBe(0);
    expect(result.deducteesFixed).toBe(0);
    expect(updateCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("never touches a blank section_code", async () => {
    challanRows = [{ id: "ch-1", section_code: "" }];
    deducteeRows = [{ id: "d-1", section_code: "" }];

    const result = await repairFilingSectionCodes("filing-3", "firm-1", "26Q", "2025-26");

    expect(result.challansFixed).toBe(0);
    expect(result.deducteesFixed).toBe(0);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("resolveExistingChallansByNumber — scoped to ONE client AND ONE financial year", () => {
  // The reported symptom: importing "q3 dbs.xls" for a brand-new client (DBS
  // REALTY, status "Not Started") reported "re-used 1 carry-forward
  // challan(s)" and inserted 1 deductee, yet the Challans list stayed empty.
  // Root cause, traced to the real database: the lookup matched ANY challan
  // in the firm sharing the same Bank Challan Number, with no client scope at
  // all — a short, often-sequential OLTAS number with zero cross-client
  // uniqueness guarantee. DBS Realty's challan "55043" collided with an
  // unrelated challan already belonging to AMADIUS REALTY; the deductee got
  // attached to Amadius's challan (a different filing_id), so it vanished
  // from DBS Realty's own list, and 8 duplicate copies accumulated across
  // repeated import attempts (deductees have no dedup).
  it("does NOT match a different client's challan sharing the same Bank Challan Number", async () => {
    challanRows = [
      { id: "challan-CLIENT-A", client_id: "client-A", challan_serial_no: "55043", financial_year: "2025-26" } as any,
    ];
    const { reusable } = await resolveExistingChallansByNumber(["55043"], "client-B", "2025-26");
    expect(reusable.has("55043")).toBe(false);
  });

  it("DOES find the SAME client's own challan in the SAME financial year — legitimate cross-quarter carry-forward still works", async () => {
    challanRows = [
      { id: "challan-B-prior-quarter", client_id: "client-B", challan_serial_no: "55043", quarter: "Q2", financial_year: "2025-26", form_type: "26Q" } as any,
    ];
    const { reusable } = await resolveExistingChallansByNumber(["55043"], "client-B", "2025-26");
    expect(reusable.get("55043")?.id).toBe("challan-B-prior-quarter");
  });

  it("does NOT reuse the SAME client's own challan from a DIFFERENT financial year, and reports it", async () => {
    // A challan deposit is tied to one return period; it cannot legitimately
    // fund a different FY's filing, even for the same client.
    challanRows = [
      { id: "challan-B-old-fy", client_id: "client-B", challan_serial_no: "55043", quarter: "Q4", financial_year: "2023-24", form_type: "26Q" } as any,
    ];
    const { reusable, yearMismatched } = await resolveExistingChallansByNumber(["55043"], "client-B", "2025-26");
    expect(reusable.has("55043")).toBe(false);
    expect(yearMismatched).toHaveLength(1);
    expect(yearMismatched[0]).toMatchObject({ challanNumber: "55043", ref: { id: "challan-B-old-fy", financial_year: "2023-24" } });
  });

  it("is a no-op for an empty or all-blank challan-number list", async () => {
    challanRows = [{ id: "x", client_id: "client-B", challan_serial_no: "1", financial_year: "2025-26" } as any];
    expect((await resolveExistingChallansByNumber([], "client-B", "2025-26")).reusable.size).toBe(0);
    expect((await resolveExistingChallansByNumber([null, undefined, ""], "client-B", "2025-26")).reusable.size).toBe(0);
  });
});

describe("validateFinancialYearMatch — a hard stop, not a warning", () => {
  // Traced to a real client's file: "Q3 SHREE MARUTI INFRA.xls" states
  // "A.Y. 2025-26" (= Financial Year 2024-25 — deposit date 07/08/2024
  // confirms it). Nothing previously compared this to the SELECTED filing's
  // Financial Year, so a file for one year could be imported straight into a
  // different year's filing with no error at all.
  it("throws when the file's Assessment Year implies a DIFFERENT Financial Year", () => {
    expect(() => validateFinancialYearMatch("2025-26", "2025-26")).toThrowError(/Financial Year mismatch/);
  });

  it("names both years and tells the user which FY to select", () => {
    expect(() => validateFinancialYearMatch("2025-26", "2025-26")).toThrowError(/2024-25/);
  });

  it("does NOT throw when the Assessment Year correctly implies the selected Financial Year", () => {
    expect(() => validateFinancialYearMatch("2025-26", "2024-25")).not.toThrow();
  });

  it("fails open on a blank or malformed Assessment Year, matching Form/Quarter", () => {
    expect(() => validateFinancialYearMatch("", "2025-26")).not.toThrow();
    expect(() => validateFinancialYearMatch("garbled", "2025-26")).not.toThrow();
  });
});

describe("resolveDeclaredAssessmentYear — Genius files disagree on what this field means", () => {
  // Real reported bug: a client's genuine Genius-generated file
  // ("KWIKTEAM SUPPORT SERVICES...Q1.xls") states "T.Y. 2026-27" for an
  // honest FY 2026-27 return. Reading that value as an Assessment Year (the
  // classic "A.Y." case validateFinancialYearMatch itself is built around)
  // silently shifted it back a year to FY 2025-26, so importing the file into
  // its OWN, correct FY 2026-27 filing failed with a false mismatch.
  it("pre-converts a literal Financial-Year label (T.Y.) so it round-trips to itself", () => {
    expect(resolveDeclaredAssessmentYear("T.Y.", "2026-27")).toBe("2027-28");
    expect(() => validateFinancialYearMatch(resolveDeclaredAssessmentYear("T.Y.", "2026-27"), "2026-27")).not.toThrow();
  });

  it("recognises T.Y./F.Y. in a few real-world spellings", () => {
    expect(resolveDeclaredAssessmentYear("TY", "2026-27")).toBe("2027-28");
    expect(resolveDeclaredAssessmentYear("F.Y.", "2026-27")).toBe("2027-28");
    expect(resolveDeclaredAssessmentYear("Financial Year", "2026-27")).toBe("2027-28");
  });

  it("leaves a genuine Assessment Year label untouched — the incident this whole check exists for", () => {
    expect(resolveDeclaredAssessmentYear("A.Y.", "2025-26")).toBe("2025-26");
    expect(() => validateFinancialYearMatch(resolveDeclaredAssessmentYear("A.Y.", "2025-26"), "2025-26")).toThrowError(/Financial Year mismatch/);
    expect(() => validateFinancialYearMatch(resolveDeclaredAssessmentYear("A.Y.", "2025-26"), "2024-25")).not.toThrow();
  });

  it("defaults to the original (Assessment Year) behaviour on a blank or unrecognised label", () => {
    expect(resolveDeclaredAssessmentYear("", "2025-26")).toBe("2025-26");
    expect(resolveDeclaredAssessmentYear("Period", "2025-26")).toBe("2025-26");
  });
});
