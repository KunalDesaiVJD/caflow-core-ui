import { describe, it, expect } from "vitest";
import { noteAmt } from "./nceAutoPopulate";
import { NCE_SIGNED_NOTE_AMOUNTS } from "./nceFeatureFlags";

// BUG 1 (sign) — the choke-point converter every TB→note-amount writer calls.
// signed=true must apply the head-nature sign so a contra DEDUCTS; signed=false
// must reproduce the legacy Math.abs magnitude. The production default flag is
// asserted OFF so this build is byte-identical to pre-fix.

describe("noteAmt choke-point (BUG 1 sign)", () => {
  describe("signed = true (the fix)", () => {
    it("deducts a DEBIT party inside a Cr-natural head (Long-Term Borrowings)", () => {
      // A ₹50L Dr party sitting in borrowings is a contra → must be negative.
      const amt = noteAmt({ closing_balance: 5_000_000, balance_type: "Dr" }, "borrowings", true);
      expect(amt).toBe(-5_000_000);
    });

    it("keeps a normal CREDIT balance in a Cr-natural head positive", () => {
      const amt = noteAmt({ closing_balance: 5_000_000, balance_type: "Cr" }, "borrowings", true);
      expect(amt).toBe(5_000_000);
    });

    it("deducts a CREDIT-balance write-back inside a Dr-natural expense head", () => {
      // A ₹10L Cr write-back in other_expenses must reduce total expenses.
      const amt = noteAmt({ closing_balance: 1_000_000, balance_type: "Cr" }, "other_expenses", true);
      expect(amt).toBe(-1_000_000);
    });

    it("keeps a normal DEBIT expense positive", () => {
      const amt = noteAmt({ closing_balance: 1_000_000, balance_type: "Dr" }, "other_expenses", true);
      expect(amt).toBe(1_000_000);
    });

    it("deducts a CREDIT balance sitting in a Dr-natural asset head", () => {
      const amt = noteAmt({ closing_balance: 200_000, balance_type: "Cr" }, "loans_advances", true);
      expect(amt).toBe(-200_000);
    });
  });

  describe("signed = false (legacy magnitude)", () => {
    it("returns the magnitude regardless of side (Dr party added, not deducted)", () => {
      expect(noteAmt({ closing_balance: 5_000_000, balance_type: "Dr" }, "borrowings", false)).toBe(5_000_000);
      expect(noteAmt({ closing_balance: 1_000_000, balance_type: "Cr" }, "other_expenses", false)).toBe(1_000_000);
    });
  });

  describe("production default", () => {
    // The sign fix was permanently enabled in d3d4a95b ("enable permanent NCE sign fix +
    // transfer-safe re-sync") and deployed. This block previously asserted the flag was still OFF,
    // which is why it began failing on main; the guard is kept but now pins the shipped behaviour,
    // so an accidental revert to the legacy magnitude is still caught.
    it("flag is ON, so the signed convention applies by default", () => {
      expect(NCE_SIGNED_NOTE_AMOUNTS).toBe(true);
      // Default call must deduct a contra, matching signed = true above.
      expect(noteAmt({ closing_balance: 5_000_000, balance_type: "Dr" }, "borrowings")).toBe(-5_000_000);
      expect(noteAmt({ closing_balance: 1_000_000, balance_type: "Cr" }, "borrowings")).toBe(1_000_000);
    });
  });
});
