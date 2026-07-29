import { describe, it, expect } from "vitest";
import { nameEvidence, rank, nameCompare } from "./match";
describe("Virender vs Urvashi Virender", () => {
  it("shows the tiers", () => {
    const pairs: [string,string][] = [
      ["VIRENDER SINGH", "Virender Singh - Salary"],
      ["URVASHI VIRENDER SINGH", "Virender Singh - Salary"],
      ["URVASHI VIRENDER SINGH", "Urvashi Virender Singh-Salary"],
    ];
    for (const [o,l] of pairs) {
      const ev = nameEvidence(o,l);
      console.log(`${o.padEnd(26)} vs ${l.padEnd(32)} -> tier=${ev.tier} rank=${rank(ev.tier)} cmp=${nameCompare(o,l)}`);
    }
    expect(true).toBe(true);
  });
});
