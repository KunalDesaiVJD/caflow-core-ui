import { describe, it, expect } from "vitest";
import { materialityQueue, queueTotals, validateMateriality, basisLabel, inr, type MaterialityRow } from "./materialityQueue";

const row = (p: Partial<MaterialityRow>): MaterialityRow => ({
  id: p.id ?? "1",
  client_id: p.client_id ?? "c1",
  client_name: p.client_name ?? "Acme",
  financial_year: p.financial_year ?? "2025-26",
  status: p.status ?? "proposed",
  proposed: p.proposed ?? { materiality: 2_200_000, performance: 1_300_000, trivial: 110_000, benchmark: "turnover", benchmark_pct: 0.5, basis: { turnover: 440_000_000 } },
  decided: p.decided ?? null,
  finding_count: p.finding_count ?? 0,
});

describe("materialityQueue — ranks by what approving would actually change", () => {
  it("puts pending ahead of already-approved work", () => {
    const q = materialityQueue([
      row({ id: "a", client_name: "Approved Co", status: "approved", finding_count: 900 }),
      row({ id: "b", client_name: "Pending Co", status: "proposed", finding_count: 10 }),
    ]);
    expect(q[0].id).toBe("b");
  });

  it("within pending, the engagement with the most open findings comes first", () => {
    const q = materialityQueue([
      row({ id: "small", client_name: "Small", finding_count: 12 }),
      row({ id: "big", client_name: "Big", finding_count: 1048 }),
    ]);
    expect(q.map((i) => i.id)).toEqual(["big", "small"]);
  });

  // Where the system fell back to the floor it has no opinion at all, so a human must supply one.
  // That is precisely the case a silent default would hide, so it outranks even the biggest client.
  it("floats floor-fallback proposals above everything else pending", () => {
    const q = materialityQueue([
      row({ id: "big", client_name: "Big", finding_count: 1048 }),
      row({ id: "guess", client_name: "Guess", finding_count: 3, proposed: { benchmark: "floor", materiality: 25_000, performance: 15_000, trivial: 1_300 } }),
    ]);
    expect(q[0].id).toBe("guess");
    expect(q[0].needsAttention).toBe(true);
    expect(q[1].needsAttention).toBe(false);
  });

  it("reports how far a human moved the number", () => {
    const q = materialityQueue([
      row({ status: "approved", decided: { materiality: 4_400_000, performance: 2_600_000, trivial: 220_000 } }),
    ]);
    expect(q[0].overridePct).toBe(100); // doubled the proposal
  });

  it("leaves overridePct null while nothing has been decided", () => {
    expect(materialityQueue([row({})])[0].overridePct).toBeNull();
  });

  it("sorts stably by name when priority ties", () => {
    const q = materialityQueue([row({ id: "z", client_name: "Zeta" }), row({ id: "a", client_name: "Alpha" })]);
    expect(q.map((i) => i.client_name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("queueTotals — the size of the backlog and the prize", () => {
  it("counts findings sitting behind unapproved engagements", () => {
    const t = queueTotals(materialityQueue([
      row({ id: "1", finding_count: 1048 }),
      row({ id: "2", finding_count: 555 }),
      row({ id: "3", status: "approved", finding_count: 655, decided: { materiality: 1, performance: 1, trivial: 0 } }),
      row({ id: "4", finding_count: 3, proposed: { benchmark: "floor", performance: 15_000 } }),
    ]));
    expect(t.total).toBe(4);
    expect(t.pending).toBe(3);
    expect(t.approved).toBe(1);
    expect(t.needsAttention).toBe(1);
    expect(t.findingsBlocked).toBe(1606); // approved engagement excluded
  });
});

describe("validateMateriality — the three levels must stay ordered", () => {
  it("accepts a well-formed set", () => {
    expect(validateMateriality({ materiality: 2_200_000, performance: 1_300_000, trivial: 110_000 })).toBeNull();
  });

  it("rejects performance above overall materiality", () => {
    expect(validateMateriality({ materiality: 100_000, performance: 200_000, trivial: 5_000 }))
      .toMatch(/cannot exceed overall/i);
  });

  // A trivial threshold at or above performance materiality silently suppresses everything the
  // performance level exists to catch — the failure would look like "the rules stopped working".
  it("rejects a trivial threshold that would swallow the performance level", () => {
    expect(validateMateriality({ materiality: 100_000, performance: 60_000, trivial: 60_000 }))
      .toMatch(/below performance/i);
  });

  it("rejects zero and negative figures", () => {
    expect(validateMateriality({ materiality: 0, performance: 0, trivial: 0 })).toMatch(/greater than zero/i);
    expect(validateMateriality({ materiality: 100_000, performance: 60_000, trivial: -1 })).toMatch(/negative/i);
  });
});

describe("presentation", () => {
  it("formats rupees the Indian way", () => {
    expect(inr(1_300_000)).toBe("₹13,00,000");
  });

  it("explains what drove the proposal", () => {
    expect(basisLabel(row({}))).toContain("0.5% of turnover");
    expect(basisLabel(row({ proposed: { benchmark: "floor" } }))).toMatch(/no usable turnover/i);
  });
});
