import { describe, it, expect } from "vitest";
import { computeNceDynamicNoteMap, getDynamicNoteDisplay } from "@/lib/nceDynamicNoteNumbers";
import { NOTE_META } from "@/config/nceNotesConfig";

// Regression for the reported "Note 8 is missing" bug (RAYWINGS SERVICES LLP):
// the printed BS/Notes sequence jumped 2,3,4,5,6,7,9,10,11,12 — skipping 8 —
// even though computeNceDynamicNoteMap is supposed to renumber active notes
// with NO gaps. Root cause: NCE_CINV (static ref 16, "Current investments")
// had a real non-zero balance so it consumed a sequence slot, but had no
// NOTES_CONFIG/NOTE_META entry (nceNotesConfig.ts's "investments" Pattern A
// note only carried static ref 13, Non-Current Investments) and no
// NCE_CODE_TO_STATIC_REF entry, so nothing was ever rendered against that
// reserved slot — a silent gap, not lost data (the amount itself always
// flowed correctly through the note total to the face).
describe("nceDynamicNoteNumbers — Current Investments (Note 16) no longer creates a numbering gap", () => {
  it("NOTE_META has real entries for investments_lt (13) and investments_st (16); no stale combined 'investments' key", () => {
    expect(NOTE_META["investments_lt"]?.noteNumber).toBe("13");
    expect(NOTE_META["investments_st"]?.noteNumber).toBe("16");
    expect(NOTE_META["investments"]).toBeUndefined();
  });

  it("reproduces the Raywings scenario — PPE(10) active, Non-Current Investments(13) zero, Current Investments(16) non-zero — sequence stays contiguous with no gap at 8", () => {
    const cy: Record<string, number> = {
      NCE_CAP: 13784507, NCE_LTB: 2343618, NCE_TP: -249678, NCE_OCL: 1266004,
      NCE_STP: 4623161, NCE_PPE: 196529,
      NCE_CINV: 5114247, // Current investments has real data (like Raywings) …
      // … while Non-Current Investments (ref 13) stays zero — omitted here.
      NCE_TR: 11697563, NCE_CASH: 1535414, NCE_STLA: 76500, NCE_OCA: 3147358,
    };
    const py: Record<string, number> = {};
    const map = computeNceDynamicNoteMap(cy, py);

    const values = [...map.values()].sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: values.length }, (_, i) => i + 1));

    // Static ref 16 (Current Investments) now lands on dynamic 8 — the exact
    // number the printed sequence previously skipped — and Trade receivables
    // (static ref 18) stays 9, matching what the user's screenshot already
    // showed unchanged on either side of the gap.
    expect(map.get(16)).toBe(8);
    expect(map.get(18)).toBe(9);
    expect(map.get(10)).toBe(7);
  });

  it("getDynamicNoteDisplay resolves investments_st to the same dynamic number used for BS-face navigation", () => {
    const cy: Record<string, number> = { NCE_CINV: 100 };
    const py: Record<string, number> = {};
    const map = computeNceDynamicNoteMap(cy, py);
    expect(getDynamicNoteDisplay("investments_st", map)).toBe(String(map.get(16)));
  });
});
