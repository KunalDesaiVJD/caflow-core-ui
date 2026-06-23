import { describe, it, expect, vi } from "vitest";

// nceAutoPopulate / fsReconciliation pull the Supabase client at import.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  buildNoteFsMap,
  buildNoteNature,
  buildNceFsCodeNature,
  buildCanonicalNceCode,
  buildNceLiabCodeSet,
  normalizeCoaCodes,
} from "@/lib/nceNoteRegistry";
import { NCE_NOTE_FS_MAP, NCE_CODE_TO_NOTE } from "@/lib/nceAutoPopulate";
import { NOTE_NATURE, FS_CODE_NATURE } from "@/lib/fsSignConvention";
import { CANONICAL_NCE_CODE, NCE_LIAB_CODE_SET } from "@/lib/fsReconciliation";

// ─── Parity gate: every builder must reproduce the CURRENT live literal ───────
// This MUST pass BEFORE any literal is swapped to a builder. After the swap the
// live literal IS the builder, so the durable safety lives in the invariants
// block below + the import-cycle smoke test.
describe("nceNoteRegistry — parity with current live literals", () => {
  it("buildNoteFsMap() ≡ NCE_NOTE_FS_MAP", () => {
    expect(buildNoteFsMap()).toEqual(NCE_NOTE_FS_MAP);
  });

  it("buildNoteNature() ≡ NOTE_NATURE", () => {
    expect(buildNoteNature()).toEqual(NOTE_NATURE);
  });

  it("buildNceFsCodeNature() ≡ the NCE_* subset of FS_CODE_NATURE, with NO corporate/INV keys", () => {
    const liveNce = Object.fromEntries(
      Object.entries(FS_CODE_NATURE).filter(([k]) => k.startsWith("NCE_")),
    );
    const built = buildNceFsCodeNature();
    expect(built).toEqual(liveNce);
    for (const k of Object.keys(built)) {
      expect(k.startsWith("BS_") || k.startsWith("PL_") || k.startsWith("INV_")).toBe(false);
    }
  });

  it("buildCanonicalNceCode() ≡ CANONICAL_NCE_CODE", () => {
    expect(buildCanonicalNceCode()).toEqual(CANONICAL_NCE_CODE);
  });

  it("buildNceLiabCodeSet() ≡ NCE_LIAB_CODE_SET (order-independent)", () => {
    expect([...buildNceLiabCodeSet()].sort()).toEqual([...NCE_LIAB_CODE_SET].sort());
  });
});

// ─── Durable invariants (meaningful before AND after the swap) ─────────────────
describe("nceNoteRegistry — durable invariants", () => {
  it("the 4 equity codes are NEVER folded by buildCanonicalNceCode", () => {
    const c = buildCanonicalNceCode();
    expect(c["NCE_PCAP"]).toBeUndefined();
    expect(c["NCE_RES"]).toBeUndefined();
    expect(c["NCE_NCB"]).toBeUndefined();
    expect(c["NCE_CAP"]).toBeUndefined();
  });

  it("NCE_CII is dual-role: folded to NCE_COGS in canonical, distinct cogs_c in NCE_CODE_TO_NOTE", () => {
    expect(buildCanonicalNceCode()["NCE_CII"]).toBe("NCE_COGS");
    expect(NCE_CODE_TO_NOTE["NCE_CII"]).toEqual({ note: "cogs", config: "cogs_c" });
    expect(NCE_CODE_TO_NOTE["NCE_COGS"]).toEqual({ note: "cogs", config: "cogs_a" });
  });

  it("twin survival: BS_CA_CI folds to NCE_CINV; corporate BS_CA_CINV stays distinct", () => {
    expect(buildCanonicalNceCode()["BS_CA_CI"]).toBe("NCE_CINV");
    expect(buildNceFsCodeNature()["BS_CA_CINV"]).toBeUndefined(); // never emitted by NCE half
    expect(buildNceFsCodeNature()["BS_CA_CI"]).toBeUndefined();   // twin, not NCE_*
    expect(FS_CODE_NATURE["BS_CA_CINV"]).toBe("DR");              // survives in corporate half
  });

  it("equity codes carry CR nature and are in the liab set", () => {
    expect(buildNceFsCodeNature()["NCE_CAP"]).toBe("CR");
    const liab = buildNceLiabCodeSet();
    expect(liab.has("NCE_CAP")).toBe(true);
    expect(liab.has("NCE_PCAP")).toBe(true);
  });

  it("RC1: the 9 note-less Dr codes are DR, never folded, never in the liab set", () => {
    const NINE = ["NCE_PPE","NCE_INTG","NCE_DEPR","NCE_PART_REM","NCE_CUR_TAX","NCE_PRIOR_TAX","NCE_DEFER_TAX","NCE_EXCEP","NCE_EXTORD"];
    const fsNat = buildNceFsCodeNature();
    const canon = buildCanonicalNceCode();
    const liab = buildNceLiabCodeSet();
    const noteMap = buildNoteFsMap();
    const notedCodes = new Set(Object.values(noteMap).flatMap(e => [...(e.all||[]), ...(e.lt||[]), ...(e.st||[])]));
    for (const c of NINE) {
      expect(fsNat[c]).toBe("DR");        // resolves via FS_CODE_NATURE -> Dr balance signs +
      expect(canon[c]).toBeUndefined();   // never folded
      expect(liab.has(c)).toBe(false);    // Dr asset/expense, not a liability
      expect(notedCodes.has(c)).toBe(false); // owns no note (FA schedule / direct P&L leaf)
    }
  });
});

// ─── Import-cycle smoke test ──────────────────────────────────────────────────
// If the registry ever creates an init cycle with fsSignConvention, NOTE_NATURE
// reads as undefined → resolveNature falls back to all-CR. cash_bank would then
// be "CR" instead of "DR". This is the only assertion that catches that.
describe("nceNoteRegistry — no all-CR init cycle", () => {
  it("NOTE_NATURE resolves real natures (cash_bank is DR, not all-CR)", () => {
    expect(NOTE_NATURE.borrowings).toBe("CR");
    expect(NOTE_NATURE.cash_bank).toBe("DR");
  });
});

// ─── normalizeCoaCodes ────────────────────────────────────────────────────────
describe("normalizeCoaCodes — fold corporate twins to canonical NCE codes at save", () => {
  it("folds twins", () => {
    const r = normalizeCoaCodes({ "Loan A": { code: "BS_CL_STB" }, "Inv B": { code: "BS_CA_CI" } });
    expect(r["Loan A"].code).toBe("NCE_STB");
    expect(r["Inv B"].code).toBe("NCE_CINV");
  });

  it("leaves canonical / unknown codes untouched and preserves other props", () => {
    const r = normalizeCoaCodes({ X: { code: "NCE_TP", confidence: 0.9 }, Y: { code: "SOMETHING_ELSE" } });
    expect(r.X).toEqual({ code: "NCE_TP", confidence: 0.9 });
    expect(r.Y.code).toBe("SOMETHING_ELSE");
  });

  it("is null/clear-safe (the wipe/clear save paths pass through unchanged)", () => {
    expect(normalizeCoaCodes(null)).toBeNull();
    expect(normalizeCoaCodes(undefined)).toBeUndefined();
    expect(normalizeCoaCodes({})).toEqual({});
    expect(normalizeCoaCodes([])).toEqual([]);
  });

  it("does not mutate the input", () => {
    const input = { "Loan A": { code: "BS_CL_STB" } };
    const snap = JSON.stringify(input);
    normalizeCoaCodes(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});
