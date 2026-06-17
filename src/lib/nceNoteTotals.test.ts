import { describe, it, expect } from "vitest";
import {
  computeNoteTotals,
  columnsFor,
  keyFor,
  lookupColumn,
  type NoteTotalsResultA,
  type NoteTotalsResultB,
} from "@/lib/nceNoteTotals";
import type { NoteConfig, NoteRowDef } from "@/config/nceNotesConfig";

// Minimal NoteConfig fixture — computeNoteTotals only reads `pattern` + `rows`.
const cfg = (pattern: "A" | "B", rows: NoteRowDef[]): NoteConfig => ({
  noteType: "test",
  title: "Test",
  pattern,
  rows,
});

describe("columnsFor", () => {
  it("Pattern A → [lt, st]", () => {
    expect(columnsFor({ pattern: "A" })).toEqual(["lt", "st"]);
  });
  it("Pattern B → [all]", () => {
    expect(columnsFor({ pattern: "B" })).toEqual(["all"]);
  });
});

describe("keyFor", () => {
  it("all column → bare id", () => expect(keyFor("x", "all")).toBe("x"));
  it("lt column → _lt suffix", () => expect(keyFor("x", "lt")).toBe("x_lt"));
  it("st column → _st suffix", () => expect(keyFor("x", "st")).toBe("x_st"));
});

describe("lookupColumn — bare-key asymmetry (the 2026-06-12 decision)", () => {
  it("all: reads the bare key", () => {
    expect(lookupColumn({ x: 100 }, { x: 40 }, "x", "all")).toEqual({ cy: 100, py: 40 });
  });

  it("lt: falls back to bare ONLY when neither suffix key exists", () => {
    expect(lookupColumn({ x: 70 }, { x: 30 }, "x", "lt")).toEqual({ cy: 70, py: 30 });
  });

  it("lt: does NOT use bare when an _st key exists (prevents double-count)", () => {
    // _st present, _lt absent, bare present → lt must be 0 (bare NOT pulled).
    expect(lookupColumn({ x: 100, x_st: 50 }, {}, "x", "lt")).toEqual({ cy: 0, py: 0 });
  });

  it("st: NEVER falls back to the bare key", () => {
    expect(lookupColumn({ x: 100 }, { x: 40 }, "x", "st")).toEqual({ cy: 0, py: 0 });
    expect(lookupColumn({ x_st: 50 }, { x_st: 20 }, "x", "st")).toEqual({ cy: 50, py: 20 });
  });

  it("each map decides bare-vs-suffixed independently (PY-only bare key resolves)", () => {
    // cy has suffix, py has only bare → lt PY must still resolve from bare.
    const r = lookupColumn({ x_lt: 100 }, { x: 30 }, "x", "lt");
    expect(r).toEqual({ cy: 100, py: 30 });
  });
});

describe("computeNoteTotals — Pattern B characterization", () => {
  it("sums static rows into the grand total", () => {
    const config = cfg("B", [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "total", label: "Total", isTotal: true, formulaAdd: ["a", "b"] },
    ]);
    const r = computeNoteTotals(config, { a: 100, b: 50 }, { a: 90, b: 40 }) as NoteTotalsResultB;
    expect(r.pattern).toBe("B");
    expect(r.perRow.a).toEqual({ cy: 100, py: 90 });
    expect(r.grandTotal).toEqual({ cy: 150, py: 130 });
  });

  it("custom row sources[] contribute only when the row's raw is 0", () => {
    const config = cfg("B", [
      { id: "a", label: "A" },
      { id: "total", label: "Total", isTotal: true, formulaAdd: ["a"] },
    ]);
    const customRows = [{ id: "c1", sources: [{ ledger: "x", amountCy: 30, amountPy: 10 }] }];
    const r = computeNoteTotals(config, { a: 100, c1: 0 }, { a: 90, c1: 0 }, customRows) as NoteTotalsResultB;
    // c1 raw is 0 → sources add; sectionless+unattached → folded into grand total.
    expect(r.perRow.c1).toEqual({ cy: 30, py: 10 });
    expect(r.grandTotal).toEqual({ cy: 130, py: 100 });
  });

  it("custom row with a non-zero raw ignores its sources (no double-count)", () => {
    const config = cfg("B", [{ id: "total", label: "Total", isTotal: true, formulaAdd: [] }]);
    const customRows = [{ id: "c1", sources: [{ ledger: "x", amountCy: 30 }] }];
    const r = computeNoteTotals(config, { c1: 25 }, {}, customRows) as NoteTotalsResultB;
    expect(r.perRow.c1.cy).toBe(25); // raw wins, sources skipped
    expect(r.grandTotal.cy).toBe(25);
  });

  it("attached children roll up into their parent (and parent skips its own sources)", () => {
    const config = cfg("B", [{ id: "total", label: "Total", isTotal: true, formulaAdd: [] }]);
    const customRows = [
      { id: "parent", sources: [{ ledger: "x", amountCy: 999 }] }, // ignored: has children
      { id: "child", attachedTo: "parent" },
    ];
    const r = computeNoteTotals(config, { parent: 0, child: 40 }, {}, customRows) as NoteTotalsResultB;
    expect(r.perRow.parent.cy).toBe(40); // child only, sources suppressed
  });
});

describe("computeNoteTotals — Pattern A characterization", () => {
  const config = cfg("A", [
    { id: "r1", label: "R1" },
    { id: "total", label: "Total", isTotal: true, formulaAdd: ["r1"] },
  ]);

  it("splits LT/ST from suffixed keys", () => {
    const r = computeNoteTotals(config, { r1_lt: 100, r1_st: 40 }, { r1_lt: 90, r1_st: 30 }) as NoteTotalsResultA;
    expect(r.pattern).toBe("A");
    expect(r.perRow.r1).toEqual({ ltCy: 100, ltPy: 90, stCy: 40, stPy: 30 });
    expect(r.grandTotal).toEqual({ ltCy: 100, ltPy: 90, stCy: 40, stPy: 30 });
  });

  it("legacy bare key flows into LT only, never ST", () => {
    const r = computeNoteTotals(config, { r1: 70 }, { r1: 25 }) as NoteTotalsResultA;
    expect(r.perRow.r1).toEqual({ ltCy: 70, ltPy: 25, stCy: 0, stPy: 0 });
  });

  it("bare key is ignored for LT when an _st key is present (double-count guard)", () => {
    const r = computeNoteTotals(config, { r1: 70, r1_st: 50 }, {}) as NoteTotalsResultA;
    expect(r.perRow.r1.ltCy).toBe(0); // bare NOT pulled because _st suffix exists
    expect(r.perRow.r1.stCy).toBe(50);
  });
});
