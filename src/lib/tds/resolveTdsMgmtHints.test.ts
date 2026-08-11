import { describe, it, expect } from "vitest";
import { resolveTdsMgmtHints } from "./resolveTdsMgmtHints";

const TB = (names: string[]) => names.map(ledger_name => ({ ledger_name }));

describe("resolveTdsMgmtHints", () => {
  it("resolves an exact (post-normalization) match with confidence 100", () => {
    const result = resolveTdsMgmtHints(
      [{ office_name: "SHRI DEVI RAM", tally_party: "Yug Security Services" }],
      TB(["Yug Security Services", "Some Other Ledger"]),
    );
    expect(result[0]).toMatchObject({
      outcome: "exact", resolvedLedgerName: "Yug Security Services", confidence: 100, nameTier: 0,
    });
  });

  it("resolves case/spacing differences as exact via normalizeName", () => {
    const result = resolveTdsMgmtHints(
      [{ office_name: "VANA RAM", tally_party: "vanaram   ramaram  suthar" }],
      TB(["Vanaram Ramaram Suthar"]),
    );
    expect(result[0].outcome).toBe("exact");
    expect(result[0].resolvedLedgerName).toBe("Vanaram Ramaram Suthar");
  });

  it("resolves a clean spelling variant (tier <=3) as fuzzy, not exact", () => {
    const result = resolveTdsMgmtHints(
      [{ office_name: "SAHIL PARAMAR", tally_party: "Sahil Parmar" }],
      TB(["Sahil Parmar Enterprises", "Unrelated Traders"]),
    );
    expect(result[0].outcome).toBe("fuzzy");
    expect(result[0].resolvedLedgerName).toBe("Sahil Parmar Enterprises");
    expect(result[0].confidence).toBeGreaterThanOrEqual(75);
  });

  it("tolerates a trailing parenthetical annotation via match.ts's own clause-stripping", () => {
    const result = resolveTdsMgmtHints(
      [{ office_name: "HPC CORPORATION", tally_party: "HPC Corporation (2%)" }],
      TB(["HPC Corporation", "Some Other Party"]),
    );
    expect(result[0].resolvedLedgerName).toBe("HPC Corporation");
    expect(["exact", "fuzzy"]).toContain(result[0].outcome);
  });

  it("correctly stays unresolved (never guesses) on a free-form annotation match.ts's clause-stripping can't parse", () => {
    // Real row from tds_tally_party_maps: office "HPC CORPORATION" mapped to
    // tally_party "HPC Corporation @2% OF 16000/-". match.ts's trailing-
    // clause stripping only recognises "(...)" or " - text" endings — this
    // free-form "@...OF...16000/-" shape isn't one of them, so the token
    // union ratio (HPC/OF vs HPC) falls under the 0.6 acceptance threshold
    // and the pair lands at tier 5 ("mismatch"), same as any two unrelated
    // strings. This is the CORRECT, conservative outcome — not a bug: some
    // tally_party values are free-form notes rather than clean ledger
    // names, and this is exactly the case manual mapping exists to catch.
    const result = resolveTdsMgmtHints(
      [{ office_name: "HPC CORPORATION", tally_party: "HPC Corporation @2% OF 16000/-" }],
      TB(["HPC Corporation", "Some Other Party"]),
    );
    expect(result[0].outcome).toBe("unresolved");
    expect(result[0].resolvedLedgerName).toBeNull();
  });

  it("does NOT force a match when office_name and tally_party are legitimately different people sharing one ledger", () => {
    // Real row: office "GOGA RAM" confirmed (by a human, in TDS Management)
    // against tally_party "Mota Ram" — a different real name. The resolver's
    // job is only "does 'Mota Ram' exist as a live TB ledger", not "do these
    // two names look alike" — confirm it resolves purely on tally_party text.
    const result = resolveTdsMgmtHints(
      [{ office_name: "GOGA RAM", tally_party: "Mota Ram" }],
      TB(["Mota Ram", "Goga Ram"]),
    );
    expect(result[0].outcome).toBe("exact");
    expect(result[0].resolvedLedgerName).toBe("Mota Ram");
  });

  it("marks unresolved when no TB ledger matches at all", () => {
    const result = resolveTdsMgmtHints(
      [{ office_name: "SEJAL SHAILESHBHAI PARMAR", tally_party: "(as per details)" }],
      TB(["Completely Unrelated Ledger", "Another Ledger"]),
    );
    expect(result[0].outcome).toBe("unresolved");
    expect(result[0].resolvedLedgerName).toBeNull();
    expect(result[0].confidence).toBe(0);
  });

  it("marks ambiguous — never guesses — when two TB ledgers tie for best match", () => {
    const result = resolveTdsMgmtHints(
      [{ office_name: "RAMESH", tally_party: "Ramesh Patel" }],
      TB(["Ramesh Patel Traders", "Ramesh Patel Enterprises"]),
    );
    expect(result[0].outcome).toBe("ambiguous");
    expect(result[0].resolvedLedgerName).toBeNull();
    expect(result[0].candidates).toHaveLength(2);
    expect(result[0].candidates).toEqual(expect.arrayContaining(["Ramesh Patel Traders", "Ramesh Patel Enterprises"]));
  });

  it("handles the multi-ledger-per-deductee case (two TB ledgers, same real party) independently per row", () => {
    // Mirrors the real ACCURATE PMS scenario: "Cavitak Marketing (P) Ltd" and
    // "Cavitak Marketing (P) Ltd- Sales" both bill the same deductee. Each
    // row of tds_tally_party_maps is resolved on its own — this is not
    // something resolveTdsMgmtHints needs to dedupe; TDS Analytics' own
    // multi-ledger mapping support (already built) is what consumes this.
    const tb = TB(["Cavitak Marketing (P) Ltd", "Cavitak Marketing (P) Ltd- Sales"]);
    const result = resolveTdsMgmtHints(
      [
        { office_name: "CAVITAK MARKETING PRIVATE LIMITED", tally_party: "Cavitak Marketing (P) Ltd" },
        { office_name: "CAVITAK MARKETING PRIVATE LIMITED", tally_party: "Cavitak Marketing (P) Ltd- Sales" },
      ],
      tb,
    );
    expect(result[0].outcome).toBe("exact");
    expect(result[0].resolvedLedgerName).toBe("Cavitak Marketing (P) Ltd");
    expect(result[1].outcome).toBe("exact");
    expect(result[1].resolvedLedgerName).toBe("Cavitak Marketing (P) Ltd- Sales");
  });

  it("returns unresolved for a blank tally_party without throwing", () => {
    const result = resolveTdsMgmtHints(
      [{ office_name: "SOME OFFICE NAME", tally_party: "" }],
      TB(["Any Ledger"]),
    );
    expect(result[0].outcome).toBe("unresolved");
  });

  it("is pure — never mutates its inputs", () => {
    const partyMaps = [{ office_name: "A", tally_party: "Foo Traders" }];
    const tbLedgers = TB(["Foo Traders"]);
    const snapshotPm = JSON.stringify(partyMaps);
    const snapshotTb = JSON.stringify(tbLedgers);
    resolveTdsMgmtHints(partyMaps, tbLedgers);
    expect(JSON.stringify(partyMaps)).toBe(snapshotPm);
    expect(JSON.stringify(tbLedgers)).toBe(snapshotTb);
  });
});
