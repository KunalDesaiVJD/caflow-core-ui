import { describe, it, expect } from "vitest";
import { queryLoopState, queryLoopSummary, type QueryLoopInput } from "./queryLoop";

const I = (o: Partial<QueryLoopInput>): QueryLoopInput => ({
  queryStatus: "Open",
  clientReply: null,
  findingStatus: "open",
  ...o,
});

describe("queryLoopState", () => {
  it("maps dispatched-but-unanswered queries to awaiting_client", () => {
    expect(queryLoopState(I({ queryStatus: "Open" })).state).toBe("awaiting_client");
    expect(queryLoopState(I({ queryStatus: "Client Acknowledged" })).state).toBe("awaiting_client");
  });

  it("maps a client reply to responded and flags auto-close when the finding is open", () => {
    const r = queryLoopState(I({ queryStatus: "Reply Received", clientReply: "Explained — see attached", findingStatus: "open" }));
    expect(r.state).toBe("responded");
    expect(r.hasReply).toBe(true);
    expect(r.autoClose).toBe(true);
  });

  it("does not auto-close a finding that is already resolved or waived", () => {
    expect(queryLoopState(I({ queryStatus: "Reply Received", findingStatus: "resolved" })).autoClose).toBe(false);
    expect(queryLoopState(I({ queryStatus: "Reply Received", findingStatus: "waived" })).autoClose).toBe(false);
  });

  it("maps clarified / closed / carried forward to closed", () => {
    for (const q of ["Clarified", "Closed", "Carried Forward"]) {
      expect(queryLoopState(I({ queryStatus: q })).state).toBe("closed");
      expect(queryLoopState(I({ queryStatus: q })).autoClose).toBe(false);
    }
  });

  it("treats draft / rejected / null as not_raised (not client-visible)", () => {
    expect(queryLoopState(I({ queryStatus: "Draft" })).state).toBe("not_raised");
    expect(queryLoopState(I({ queryStatus: "Rejected" })).state).toBe("not_raised");
    expect(queryLoopState(I({ queryStatus: null })).state).toBe("not_raised");
  });

  it("is case-insensitive on the status and ignores blank replies", () => {
    expect(queryLoopState(I({ queryStatus: "reply received", clientReply: "   " })).hasReply).toBe(false);
    expect(queryLoopState(I({ queryStatus: "REPLY RECEIVED" })).state).toBe("responded");
  });
});

describe("queryLoopSummary", () => {
  it("rolls up the lifecycle counts and auto-close candidates", () => {
    const s = queryLoopSummary([
      I({ queryStatus: "Open" }), // awaiting
      I({ queryStatus: "Reply Received", findingStatus: "open" }), // responded + auto-close
      I({ queryStatus: "Reply Received", findingStatus: "resolved" }), // responded, no auto-close
      I({ queryStatus: "Clarified" }), // closed
      I({ queryStatus: "Draft" }), // not_raised — excluded from all buckets
    ]);
    expect(s).toEqual({ awaitingClient: 1, responded: 2, closed: 1, autoCloseCandidates: 1 });
  });
});
