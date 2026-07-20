/**
 * Regression test for a real reported bug: the Office Data card ("89 parties") and
 * the PAN Verification summary ("37 Total Parties") disagreed because one counted
 * raw `tds_deductees` ROWS (one per TDS transaction) and the other counted DISTINCT
 * PARTIES (grouped by PAN, since a party routinely has several transactions in one
 * quarter). Both numbers must come from the same definition of "a party".
 */
import { describe, it, expect } from "vitest";
import { comparePanVerification, countDistinctOfficeParties, type OfficeParty, type TracesPanRow } from "./tdsPanVerification";

const office = (id: string, name: string, pan: string | null): OfficeParty =>
  ({ deductee_id: id, name, pan });

describe("countDistinctOfficeParties — a party, not a transaction row", () => {
  it("collapses several transactions for the SAME PAN into one party", () => {
    // The exact shape of the reported bug: one deductee with 6 separate TDS entries
    // across the quarter (routine — monthly payments to the same contractor).
    const rows: OfficeParty[] = Array.from({ length: 6 }, (_, i) =>
      office(`d${i}`, "LALITKUMAR MOHANBHAI PATEL", "AAAPL1234L"));
    expect(countDistinctOfficeParties(rows)).toEqual({ total: 1, withPan: 1 });
  });

  it("counts a missing/invalid PAN as its own party, never merged with another", () => {
    const rows: OfficeParty[] = [
      office("d1", "PARTY A", null),
      office("d2", "PARTY B", "BADPAN"),
      office("d3", "PARTY C", "AAAPC1234C"),
    ];
    expect(countDistinctOfficeParties(rows)).toEqual({ total: 3, withPan: 1 });
  });

  it("matches comparePanVerification's row count exactly — the invariant the bug broke", () => {
    // 89 raw transaction rows across 37 distinct parties (mirrors the real report).
    const rows: OfficeParty[] = [];
    for (let p = 0; p < 37; p++) {
      const pan = `AAAPA${String(1000 + p).slice(-4)}A`;
      const txns = p === 0 ? 53 : 1; // one party with many transactions, rest with one
      for (let t = 0; t < txns; t++) rows.push(office(`d${p}-${t}`, `PARTY ${p}`, pan));
    }
    expect(rows.length).toBe(89);
    const distinct = countDistinctOfficeParties(rows);
    expect(distinct.total).toBe(37);
    const audited = comparePanVerification(rows, []);
    expect(audited.length).toBe(distinct.total);
  });

  it("stays a no-op when every party already has exactly one row", () => {
    const rows: OfficeParty[] = Array.from({ length: 5 }, (_, i) => office(`d${i}`, `PARTY ${i}`, `AAAPA${1000 + i}A`));
    expect(countDistinctOfficeParties(rows)).toEqual({ total: 5, withPan: 5 });
  });
});
