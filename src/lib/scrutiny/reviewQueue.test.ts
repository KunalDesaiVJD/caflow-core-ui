import { describe, it, expect } from "vitest";
import { reviewQueue, type QueueInputFinding } from "./reviewQueue";

const F = (o: Partial<QueueInputFinding> & { id: string }): QueueInputFinding => ({
  client_id: "c1",
  rule_id: "CASH-01",
  severity: "HIGH",
  status: "open",
  actioned_by: null,
  queryStatus: null,
  ...o,
});

describe("reviewQueue", () => {
  it("routes each open finding to exactly one lane", () => {
    const q = reviewQueue([
      F({ id: "a", queryStatus: "Draft", actioned_by: "u1" }), // to_review
      F({ id: "b", queryStatus: "Open", actioned_by: "u2" }), // awaiting_client
      F({ id: "c", severity: "HIGH", queryStatus: null }), // to_raise
      F({ id: "d", severity: "LOW", queryStatus: null }), // to_dispose
    ]);
    const lane = (id: string) => q.items.find((i) => i.id === id)?.lane;
    expect(lane("a")).toBe("to_review");
    expect(lane("b")).toBe("awaiting_client");
    expect(lane("c")).toBe("to_raise");
    expect(lane("d")).toBe("to_dispose");
  });

  it("sets the maker and blocker on review / client lanes", () => {
    const q = reviewQueue([F({ id: "a", queryStatus: "Draft", actioned_by: "u1" })]);
    expect(q.items[0].maker).toBe("u1");
    expect(q.items[0].blockedOn).toBe("checker");
  });

  it("excludes resolved and waived findings", () => {
    const q = reviewQueue([
      F({ id: "a", status: "resolved" }),
      F({ id: "b", status: "waived", queryStatus: "Open" }),
      F({ id: "c", status: "open" }),
    ]);
    expect(q.items.map((i) => i.id)).toEqual(["c"]);
    expect(q.total).toBe(1);
  });

  it("treats a rejected draft as still needing a query", () => {
    const q = reviewQueue([F({ id: "a", severity: "HIGH", queryStatus: "Rejected" })]);
    expect(q.items[0].lane).toBe("to_raise");
  });

  it("counts lanes in fixed order", () => {
    const q = reviewQueue([
      F({ id: "a", queryStatus: "Draft", actioned_by: "u1" }),
      F({ id: "b", severity: "MEDIUM", queryStatus: null }),
      F({ id: "c", severity: "MEDIUM", queryStatus: null }),
    ]);
    expect(q.lanes.map((l) => l.lane)).toEqual(["to_review", "to_raise", "awaiting_client", "to_dispose"]);
    expect(q.lanes.find((l) => l.lane === "to_raise")?.count).toBe(2);
    expect(q.lanes.find((l) => l.lane === "to_review")?.count).toBe(1);
  });

  it("rolls up drafts awaiting review per maker, busiest first", () => {
    const q = reviewQueue([
      F({ id: "a", queryStatus: "Draft", actioned_by: "u1" }),
      F({ id: "b", queryStatus: "Draft", actioned_by: "u1" }),
      F({ id: "c", queryStatus: "Draft", actioned_by: "u2" }),
      F({ id: "d", queryStatus: "Open", actioned_by: "u3" }), // client lane — not counted
    ]);
    expect(q.makers).toEqual([
      { maker: "u1", awaitingReview: 2 },
      { maker: "u2", awaitingReview: 1 },
    ]);
  });

  it("sorts by lane then severity", () => {
    const q = reviewQueue([
      F({ id: "lowraise", severity: "MEDIUM", queryStatus: null }),
      F({ id: "review", severity: "LOW", queryStatus: "Draft", actioned_by: "u1" }),
    ]);
    // to_review lane sorts ahead of to_raise regardless of severity
    expect(q.items.map((i) => i.id)).toEqual(["review", "lowraise"]);
  });
});
