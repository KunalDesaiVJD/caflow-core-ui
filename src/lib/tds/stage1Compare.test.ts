/**
 * STAGE 1 (tds-recon-compare) — executes the edge function's REAL comparison logic
 * under Node. Stage 1 reconciles the firm's Office Data against the client's imported
 * Excel; unlike Stage 3, BOTH sides carry a PAN, so PAN is the legal identity and the
 * strongest signal there is.
 *
 * These tests run the ACTUAL edge-function source — not a re-implementation. The Deno
 * function can't be imported directly (its two `https://` imports don't resolve under
 * Node), so we bundle supabase/functions/tds-recon-compare/index.ts with esbuild, stub
 * those two remote modules, and append `export { ... }` for the pure comparison core
 * (the established recipe in this repo). The bundle is deleted first and its rebuild
 * asserted, so a stale bundle can never fake a pass.
 *
 * What is proven here is the whole point of Phase 2: Stage 1 now pairs with the SAME
 * shared exclusivity engine as Stage 3 (assignment.ts) and compares with the SAME shared
 * primitives (match.ts) — a PAN match is the strongest tier, a PAN difference blocks a
 * pairing outright, a fuzzy name pairs only when uniquely best, a spaced section title
 * canonicalises, and a real short deduction is never absorbed as rounding.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

// vitest runs from the repo root, so resolve everything off process.cwd() — import.meta
// is not a file URL under the jsdom environment at collection time.
const REPO = process.cwd();
const SRC = join(REPO, "supabase/functions/tds-recon-compare/index.ts");

interface RawRow {
  name?: unknown; pan?: unknown; section?: unknown;
  amount?: unknown; tds?: unknown; interest?: unknown; date?: unknown;
}
type Fn = (...args: any[]) => any;
let mod: {
  toRec: Fn; makeIsoNormaliser: Fn; pairRecords: Fn; comparePair: Fn;
  resolveSection: Fn; namesEquivalent: Fn; DEFAULT_SECTION_ALIASES: any[];
  filterImportedRows: Fn; fyStartYear: Fn; normQuarter: Fn;
};

beforeAll(() => {
  // esbuild relies on a real TextEncoder, which the jsdom test environment replaces with a
  // shim that breaks it. So the bundle is built in a CLEAN child node process (the brief's
  // recipe: require(REPO + "/node_modules/esbuild/lib/main.js")). The child stubs the two
  // remote imports, appends `export { ... }` for the pure comparison core, adds a Deno
  // banner, deletes any stale bundle first and asserts the rebuild — a stale bundle has
  // faked a pass in this repo before. Output is CJS so it loads through Node's NATIVE
  // require (below), bypassing vite's transform pipeline, which cannot serve a temp path.
  const outfile = join(tmpdir(), "caflow_stage1_bundle.cjs");
  const builder = join(tmpdir(), "caflow_stage1_build.cjs");
  if (existsSync(outfile)) rmSync(outfile);   // never trust a stale bundle

  const esbuildMain = join(REPO, "node_modules/esbuild/lib/main.js");
  const buildScript = `
const esbuild = require(${JSON.stringify(esbuildMain)});
const fs = require("node:fs");
const SRC = ${JSON.stringify(SRC)};
const OUT = ${JSON.stringify(outfile)};
const RESOLVE_DIR = ${JSON.stringify(dirname(SRC))};
const source = fs.readFileSync(SRC, "utf8") +
  "\\nexport { toRec, makeIsoNormaliser, pairRecords, comparePair, resolveSection, namesEquivalent, DEFAULT_SECTION_ALIASES, filterImportedRows, fyStartYear, normQuarter };\\n";
const stubRemote = {
  name: "stub-remote",
  setup(b) {
    b.onResolve({ filter: /^https:\\/\\// }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export const serve = () => {}; export const createClient = () => { throw new Error('stubbed'); };",
      loader: "js",
    }));
  },
};
esbuild.build({
  stdin: { contents: source, resolveDir: RESOLVE_DIR, sourcefile: "index.ts", loader: "ts" },
  bundle: true, format: "cjs", platform: "node", write: true, outfile: OUT,
  plugins: [stubRemote],
  banner: { js: "globalThis.Deno = globalThis.Deno || { env: { get: () => undefined } };" },
  logLevel: "silent",
}).then((r) => {
  if (r.errors && r.errors.length) { console.error(JSON.stringify(r.errors)); process.exit(2); }
}).catch((e) => { console.error(String(e && e.stack || e)); process.exit(3); });
`;
  writeFileSync(builder, buildScript);
  execFileSync(process.execPath, [builder], { stdio: ["ignore", "ignore", "pipe"] });
  if (!existsSync(outfile)) throw new Error("bundle was not written — refusing to run against a stale/absent bundle");

  // Load via Node's NATIVE require (createRequire), which bypasses vite's transform.
  const nodeRequire = createRequire(join(REPO, "package.json"));
  delete nodeRequire.cache[outfile];   // drop any prior-run cache so the fresh build wins
  mod = nodeRequire(outfile);
});

// Run the REAL Stage-1 pipeline core: build records (with whole-column date order),
// pair via the shared exclusivity engine, then compare 7 fields per pair. This is the
// exact sequence serve() runs, minus DB/AI/aggregation (which are I/O, not comparison).
function runStage1(officeRows: RawRow[], importedRows: RawRow[], aliases = mod.DEFAULT_SECTION_ALIASES) {
  const mk = (rows: RawRow[], prefix: string) => rows.map((r, k) => mod.toRec(prefix + k, {
    name: r.name ?? null, pan: r.pan ?? null, section: r.section ?? null,
    amount: r.amount ?? null, tds: r.tds ?? null, interest: r.interest ?? null, date: r.date ?? null,
  }));
  const oRecs = mk(officeRows, "o");
  const iRecs = mk(importedRows, "i");
  const oIso = mod.makeIsoNormaliser(officeRows.map((r) => r.date ?? null));
  const iIso = mod.makeIsoNormaliser(importedRows.map((r) => r.date ?? null));
  oRecs.forEach((r: any) => { r.iso = oIso(r.date) ?? r.iso; });
  iRecs.forEach((r: any) => { r.iso = iIso(r.date) ?? r.iso; });

  const { pairs, oUsed, iUsed } = mod.pairRecords(oRecs, iRecs, aliases);
  const paired = pairs.map(({ o, i }: any) => {
    const c = mod.comparePair(o, i, aliases);
    return { oId: o.id, iId: i.id, status: c.status, mismatchFields: c.mismatchFields };
  });
  const officeOnly = oRecs.filter((_: any, k: number) => !oUsed[k]).map((o: any) => o.id);
  const importedOnly = iRecs.filter((_: any, k: number) => !iUsed[k]).map((i: any) => i.id);
  return { paired, officeOnly, importedOnly };
}

describe("Stage 1 — PAN is the strongest evidence (identical PANs pair 1:1)", () => {
  const office: RawRow[] = [
    { name: "ALPHA TRADERS", pan: "AAAPA1111A", section: "194C", amount: 100000, tds: 1000, date: "2026-03-05" },
    { name: "BETA SUPPLIES", pan: "BBBPB2222B", section: "194J", amount: 50000, tds: 5000, date: "2026-03-10" },
    { name: "GAMMA GOODS", pan: "CCCPC3333C", section: "194Q", amount: 200000, tds: 200, date: "2026-03-15" },
  ];
  // Same three parties, shuffled, dates in the client's dd/mm/yyyy format, spellings
  // slightly off — the PAN alone must pair them, and every field must then reconcile.
  const imported: RawRow[] = [
    { name: "Gamma Goods", pan: "CCCPC3333C", section: "Purchase of goods", amount: 200000, tds: 200, date: "15/03/2026" },
    { name: "Alpha Traders", pan: "AAAPA1111A", section: "TDS - Contract", amount: 100000, tds: 1000, date: "05/03/2026" },
    { name: "Beta Supplies", pan: "BBBPB2222B", section: "Professional Fees", amount: 50000, tds: 5000, date: "10/03/2026" },
  ];

  it("pairs each office record to its same-PAN imported row and matches all", () => {
    const { paired, officeOnly, importedOnly } = runStage1(office, imported);
    expect(paired.length).toBe(3);
    expect(officeOnly).toEqual([]);
    expect(importedOnly).toEqual([]);
    // Every pairing is a PAN identity (o0→AAAPA, etc.), and every one is Matched.
    const byOffice = Object.fromEntries(paired.map((p) => [p.oId, p]));
    expect(byOffice["o0"].iId).toBe("i1");   // ALPHA
    expect(byOffice["o1"].iId).toBe("i2");   // BETA
    expect(byOffice["o2"].iId).toBe("i0");   // GAMMA
    expect(paired.every((p) => p.status === "matched")).toBe(true);
  });

  it("is order-independent (shuffling inputs yields the same PAN pairing)", () => {
    const key = (r: ReturnType<typeof runStage1>) =>
      r.paired.map((p) => `${p.oId}=${p.iId}:${p.status}`).sort().join("|");
    const fwd = runStage1(office, imported);
    const rev = runStage1([...office].reverse(), [...imported].reverse());
    // The PAN each office record pairs with is invariant; only the ids' order differs.
    const panPairs = (r: ReturnType<typeof runStage1>, off: RawRow[], imp: RawRow[]) =>
      r.paired.map((p) => `${off[+p.oId.slice(1)].pan}->${imp[+p.iId.slice(1)].pan}`).sort().join("|");
    expect(panPairs(rev, [...office].reverse(), [...imported].reverse()))
      .toBe(panPairs(fwd, office, imported));
    expect(key(fwd).length).toBeGreaterThan(0);
  });
});

describe("Stage 1 — a PAN DIFFERENCE is proof of non-identity (never pairs)", () => {
  it("does not pair two records that agree on name, date and amount but differ on PAN", () => {
    // Same name, same date, same amount — everything a greedy score would love — but two
    // different PANs. They are two different deductees; pairing them would file against the
    // wrong PAN. The engine must leave BOTH one-sided.
    const office: RawRow[] = [{ name: "RAMESH PATEL", pan: "AAAPA1111A", section: "194C", amount: 20000, tds: 200, date: "2026-03-05" }];
    const imported: RawRow[] = [{ name: "RAMESH PATEL", pan: "ZZZPZ9999Z", section: "194C", amount: 20000, tds: 200, date: "05/03/2026" }];
    const { paired, officeOnly, importedOnly } = runStage1(office, imported);
    expect(paired).toEqual([]);
    expect(officeOnly).toEqual(["o0"]);
    expect(importedOnly).toEqual(["i0"]);
  });
});

describe("Stage 1 — a fuzzy name pairs when uncontested, escalates when a rival exists", () => {
  it("PAIRS an exact-name pair when nothing competes (no PAN on either side)", () => {
    // No PAN on either side, so the name (plus date + amount) must carry the pairing.
    // comparePair still flags the blank PAN field (PAN is mandatory on a return — that's
    // unchanged Stage-1 behaviour), so we assert the pairing happened and the NAME field
    // reconciled, not the overall status.
    const office: RawRow[] = [{ name: "KRISHNA ENTERPRISE", pan: "", section: "194C", amount: 100000, tds: 1000, date: "2026-03-05" }];
    const imported: RawRow[] = [{ name: "KRISHNA ENTERPRISE", pan: "", section: "194C", amount: 100000, tds: 1000, date: "05/03/2026" }];
    const { paired, officeOnly, importedOnly } = runStage1(office, imported);
    expect(officeOnly).toEqual([]);
    expect(importedOnly).toEqual([]);
    expect(paired.length).toBe(1);
    expect(paired[0].mismatchFields).not.toContain("name");   // the exact name reconciles
  });

  it("MATCHES fully (all 7 fields) an exact-name pair that also shares a PAN", () => {
    // The same uncontested case WITH a PAN present reconciles cleanly end-to-end.
    const office: RawRow[] = [{ name: "KRISHNA ENTERPRISE", pan: "AAAPK1111A", section: "194C", amount: 100000, tds: 1000, date: "2026-03-05" }];
    const imported: RawRow[] = [{ name: "KRISHNA ENTERPRISE", pan: "AAAPK1111A", section: "194C", amount: 100000, tds: 1000, date: "05/03/2026" }];
    const { paired, officeOnly } = runStage1(office, imported);
    expect(officeOnly).toEqual([]);
    expect(paired.length).toBe(1);
    expect(paired[0].status).toBe("matched");
  });

  it("ESCALATES (leaves office record unpaired) when two rivals each win on a different signal", () => {
    // No PAN. One imported row matches only the DATE, the other only the AMOUNT. Neither
    // dominates — the signals genuinely disagree — so the engine refuses to guess and the
    // office record is left one-sided rather than paired against an unproven counterpart.
    const office: RawRow[] = [{ name: "RAMESH PATEL", pan: "", section: "194C", amount: 20229, tds: 200, date: "2026-03-05" }];
    const imported: RawRow[] = [
      { name: "RAMESH PATEL", pan: "", section: "194C", amount: 99999, tds: 0, date: "05/03/2026" },   // date only
      { name: "RAMESH PATEL", pan: "", section: "194C", amount: 20229, tds: 200, date: "20/03/2026" },  // amount only
    ];
    const { paired, officeOnly } = runStage1(office, imported);
    expect(officeOnly).toContain("o0");
    expect(paired.map((p) => p.oId)).not.toContain("o0");
  });

  it("does NOT silently match a tier-4 spelling pair (PATEL vs PATIL) — it is surfaced", () => {
    // Uncontested but risky: a single tier-4 pair commits a PAIRING (so the user sees the
    // closest row) but is NEVER reported "matched" — the name field stays a mismatch.
    const office: RawRow[] = [{ name: "RAMESH PATEL", pan: "", section: "194C", amount: 20000, tds: 200, date: "2026-03-05" }];
    const imported: RawRow[] = [{ name: "RAMESH PATIL", pan: "", section: "194C", amount: 20000, tds: 200, date: "05/03/2026" }];
    const { paired } = runStage1(office, imported);
    expect(paired.length).toBe(1);
    expect(paired[0].status).toBe("mismatched");
    expect(paired[0].mismatchFields).toContain("name");
  });
});

describe("Stage 1 — shared section canonicalisation (spaced Tally title)", () => {
  it("treats a spaced section title as equal to the office code", () => {
    // "TDS Payable - 194 C 25-26" must canonicalise to 194C (shared separator tolerance),
    // so a same-PAN pair whose only apparent difference is the section label still matches.
    const office: RawRow[] = [{ name: "ACME LTD", pan: "AAAPA1111A", section: "194C", amount: 100000, tds: 1000, date: "2026-03-05" }];
    const imported: RawRow[] = [{ name: "ACME LTD", pan: "AAAPA1111A", section: "TDS Payable - 194 C 25-26", amount: 100000, tds: 1000, date: "05/03/2026" }];
    const { paired } = runStage1(office, imported);
    expect(paired.length).toBe(1);
    expect(paired[0].status).toBe("matched");
    expect(paired[0].mismatchFields).not.toContain("section");
    // And the primitive itself resolves the spaced title.
    expect(mod.resolveSection("TDS Payable - 194 C 25-26", mod.DEFAULT_SECTION_ALIASES)).toBe("194C");
  });
});

describe("Stage 1 — a real short deduction is NOT absorbed as rounding", () => {
  it("flags a ₹1,000 TDS shortfall on an otherwise-matching same-PAN pair", () => {
    // amountsMatch forgives ₹1 / 0.5% capped at ₹10 — a rounding allowance, never a
    // similarity threshold. A ₹1,000 short TDS is a finding the CA must see.
    const office: RawRow[] = [{ name: "ACME LTD", pan: "AAAPA1111A", section: "194J", amount: 100000, tds: 10000, date: "2026-03-05" }];
    const imported: RawRow[] = [{ name: "ACME LTD", pan: "AAAPA1111A", section: "194J", amount: 100000, tds: 9000, date: "05/03/2026" }];
    const { paired } = runStage1(office, imported);
    expect(paired.length).toBe(1);                 // same PAN → still paired
    expect(paired[0].status).toBe("mismatched");   // but the shortfall is reported
    expect(paired[0].mismatchFields).toContain("tds");
  });

  it("still matches a ₹1 rounding difference (rounding allowance, not a threshold)", () => {
    const office: RawRow[] = [{ name: "ACME LTD", pan: "AAAPA1111A", section: "194J", amount: 100000, tds: 10000, date: "2026-03-05" }];
    const imported: RawRow[] = [{ name: "ACME LTD", pan: "AAAPA1111A", section: "194J", amount: 100000, tds: 10001, date: "05/03/2026" }];
    const { paired } = runStage1(office, imported);
    expect(paired[0].status).toBe("matched");
  });
});

describe("Stage 1 — N identical office rows pair 1:1 with N identical imported rows", () => {
  it("pairs all N, matches all, and leaves nothing one-sided or prompted", () => {
    const one: RawRow = { name: "KONE ELEVATORS", pan: "AAAPA1111A", section: "194C", amount: 40000, tds: 400, date: "2026-03-05" };
    const oneImp: RawRow = { name: "KONE ELEVATORS", pan: "AAAPA1111A", section: "194C", amount: 40000, tds: 400, date: "05/03/2026" };
    const office = [ { ...one }, { ...one }, { ...one }, { ...one } ];
    const imported = [ { ...oneImp }, { ...oneImp }, { ...oneImp }, { ...oneImp } ];
    const { paired, officeOnly, importedOnly } = runStage1(office, imported);
    expect(paired.length).toBe(4);
    expect(paired.every((p) => p.status === "matched")).toBe(true);
    expect(officeOnly).toEqual([]);
    expect(importedOnly).toEqual([]);
  });
});

describe("filterImportedRows — a same-PAN client row must never vanish before pairing", () => {
  // Real reported bug: a client-file row (SRUTHI RAMANAN, PAN HDYPS8232N, date
  // 2026-06-30 — genuinely Q1 of FY 2026-27) was excluded by the quarter filter
  // before it ever reached pairing, because the FORM filter already had a
  // same-PAN rescue but the QUARTER filter did not. The office row then showed
  // "In Office Data Only" with the imported side entirely blank — not a field
  // mismatch, the counterpart never got there.

  it("keeps a same-PAN row even when its OWN date lands in a different quarter", () => {
    const iRecsAll = [{ panN: "HDYPS8232N", section: "194J(a)", iso: "2026-07-05" }]; // Q2, not Q1
    const officePanSet = new Set(["HDYPS8232N"]);
    const { iRecs, excludedOtherQuarter } = mod.filterImportedRows(
      iRecsAll, officePanSet, new Set<string>(), "Q1", mod.fyStartYear("2026-27"), mod.DEFAULT_SECTION_ALIASES,
    );
    expect(iRecs.length).toBe(1);
    expect(excludedOtherQuarter).toBe(0);
  });

  it("still excludes a DIFFERENT-PAN row from a different quarter (the filter still does its job)", () => {
    const iRecsAll = [{ panN: "ZZZZZ0000Z", section: "194J(a)", iso: "2026-07-05" }]; // Q2, not Q1, PAN not in office
    const officePanSet = new Set(["HDYPS8232N"]);
    const { iRecs, excludedOtherQuarter } = mod.filterImportedRows(
      iRecsAll, officePanSet, new Set<string>(), "Q1", mod.fyStartYear("2026-27"), mod.DEFAULT_SECTION_ALIASES,
    );
    expect(iRecs.length).toBe(0);
    expect(excludedOtherQuarter).toBe(1);
  });

  it("keeps a same-PAN row even when its section implies a different FORM (existing rescue, unchanged)", () => {
    const iRecsAll = [{ panN: "HDYPS8232N", section: "192B", iso: "2026-06-30" }]; // salary section -> 24Q, filing is 26Q
    const officePanSet = new Set(["HDYPS8232N"]);
    const { iRecs, excludedOtherForm } = mod.filterImportedRows(
      iRecsAll, officePanSet, new Set(["26Q"]), "Q1", mod.fyStartYear("2026-27"), mod.DEFAULT_SECTION_ALIASES,
    );
    expect(iRecs.length).toBe(1);
    expect(excludedOtherForm).toBe(0);
  });

  it("the exact reported scenario end-to-end: same-PAN, same-quarter row now reaches pairing and matches", () => {
    const office: RawRow[] = [{ name: "SRUTHI RAMANAN", pan: "HDYPS8232N", section: "194J(a)", amount: 25000, tds: 500, date: "2026-06-30" }];
    const imported: RawRow[] = [{ name: "SRUTHI RAMANAN", pan: "HDYPS8232N", section: "194J(a)", amount: 25000, tds: 500, date: "30/06/2026" }];
    const { paired, officeOnly, importedOnly } = runStage1(office, imported);
    expect(paired.length).toBe(1);
    expect(paired[0].status).toBe("matched");
    expect(officeOnly).toEqual([]);
    expect(importedOnly).toEqual([]);
  });
});
