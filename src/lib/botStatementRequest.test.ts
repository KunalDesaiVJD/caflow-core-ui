import { describe, it, expect } from "vitest";
import { detectStatementRequest as d } from "../../supabase/functions/_shared/botAgent";

describe("detectStatementRequest", () => {
  it("reads plain statement requests", () => {
    expect(d("Send ledger of Ramani group")).toEqual({ name: "Ramani", group: true });
    expect(d("ramani group ledger")).toEqual({ name: "ramani", group: true });
    expect(d("Group statement Amadius Group Ramani")).toEqual({ name: "Amadius Ramani", group: true });
    expect(d("Satved Realty statement")).toEqual({ name: "Satved Realty", group: false });
    expect(d("khata of TVM Space Management pdf")).toEqual({ name: "TVM Space Management", group: false });
  });
  it("takes a bare name after the bot asked which group", () => {
    expect(d("Ramani group", "Which group ledger do you need? Please tell me the group name")).toEqual({ name: "Ramani", group: true });
    expect(d("Ramani", "Please tell me the group name")).toEqual({ name: "Ramani", group: true });
  });
  it("leaves anything needing judgement to the AI", () => {
    expect(d("Ramani group")).toBeNull();                         // no statement word, nothing asked
    expect(d("email ledger of Ramani group")).toBeNull();
    expect(d("ledger of Ramani group for FY 2025-26")).toBeNull();
    expect(d("ledger of Ramani group without ACS")).toBeNull();
    expect(d("Give me ledger & last 2 invoices of Satve Realty")).toBeNull();
    expect(d("Need group ledger")).toBeNull();                   // no name
    expect(d("/statement Ramani")).toBeNull();
  });
});

import { bestNameMatches, nameScore } from "../../supabase/functions/_shared/botAgent";

describe("forgiving name matching", () => {
  it("finds a name from a misspelt or shortened query", () => {
    expect(nameScore("Satve Realty", "SATVED REALTY")).toBe(1);
    expect(nameScore("Amadius Ramani", "Amadius Group Ramani")).toBe(1);
    expect(nameScore("Amadius Ramani", "Amadius Group Dobariya")).toBe(0.5);
    const rows = [{ name: "Amadius Group Dobariya" }, { name: "Amadius Group Ramani" }];
    expect(bestNameMatches("amadius ramani", rows).map(r => r.name)).toEqual(["Amadius Group Ramani"]);
    expect(bestNameMatches("xyz", rows)).toEqual([]);
  });
});
