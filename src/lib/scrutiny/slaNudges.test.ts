import { describe, it, expect } from "vitest";
import { slaNudges, slaSummary, SLA_DEFAULTS, type SlaItem } from "./slaNudges";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed clock
const ago = (days: number) => NOW - days * DAY;

describe("slaNudges", () => {
  it("flags a draft query as overdue past 2d and escalate past 5d", () => {
    const items: SlaItem[] = [
      { id: "q1", kind: "draft_review", label: "R-01", since: ago(3) },
      { id: "q2", kind: "draft_review", label: "R-02", since: ago(6) },
    ];
    const n = slaNudges(items, NOW);
    expect(n.find((x) => x.id === "q1")?.level).toBe("overdue");
    expect(n.find((x) => x.id === "q2")?.level).toBe("escalate");
    expect(n.find((x) => x.id === "q2")?.message).toContain("ESCALATE");
  });

  it("does not nudge before the due threshold", () => {
    const items: SlaItem[] = [{ id: "h1", kind: "high_unraised", label: "R-9", since: ago(1) }];
    expect(slaNudges(items, NOW)).toHaveLength(0);
  });

  it("ages a client-response query at 7d/14d", () => {
    const items: SlaItem[] = [
      { id: "c1", kind: "client_response", label: "GST reco", since: ago(8) },
      { id: "c2", kind: "client_response", label: "Cash 40A", since: ago(20) },
    ];
    const n = slaNudges(items, NOW);
    expect(n.find((x) => x.id === "c1")?.level).toBe("overdue");
    expect(n.find((x) => x.id === "c2")?.level).toBe("escalate");
    expect(n.find((x) => x.id === "c1")?.ageDays).toBe(8);
  });

  it("skips items with a missing or future clock start", () => {
    const items: SlaItem[] = [
      { id: "n1", kind: "draft_review", label: "no-date", since: null },
      { id: "n2", kind: "draft_review", label: "future", since: ago(-5) },
      { id: "n3", kind: "draft_review", label: "bad", since: "not-a-date" },
    ];
    expect(slaNudges(items, NOW)).toHaveLength(0);
  });

  it("sorts escalate first, then oldest, then by kind", () => {
    const items: SlaItem[] = [
      { id: "a", kind: "client_response", label: "c", since: ago(8) }, // overdue
      { id: "b", kind: "high_unraised", label: "h", since: ago(30) }, // escalate, oldest
      { id: "c", kind: "draft_review", label: "d", since: ago(6) }, // escalate
    ];
    const n = slaNudges(items, NOW);
    expect(n.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("parses ISO-string clock starts", () => {
    const iso = new Date(ago(10)).toISOString();
    const n = slaNudges([{ id: "i", kind: "client_response", label: "x", since: iso }], NOW);
    expect(n[0].ageDays).toBe(10);
    expect(n[0].level).toBe("overdue");
  });

  it("honours custom thresholds", () => {
    const items: SlaItem[] = [{ id: "q", kind: "draft_review", label: "R", since: ago(3) }];
    const strict = { ...SLA_DEFAULTS, draft_review: { dueDays: 1, escalateDays: 3 } };
    expect(slaNudges(items, NOW, strict)[0].level).toBe("escalate");
  });

  it("summarises overdue vs escalate counts", () => {
    const items: SlaItem[] = [
      { id: "a", kind: "client_response", label: "c", since: ago(8) }, // overdue
      { id: "b", kind: "high_unraised", label: "h", since: ago(30) }, // escalate
      { id: "c", kind: "draft_review", label: "d", since: ago(6) }, // escalate
    ];
    expect(slaSummary(slaNudges(items, NOW))).toEqual({ overdue: 1, escalate: 2, total: 3 });
  });
});
