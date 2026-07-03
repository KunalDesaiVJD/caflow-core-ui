import { describe, it, expect } from "vitest";
import {
  QUERY_STATUS_DRAFT,
  QUERY_STATUS_OPEN,
  QUERY_STATUS_REJECTED,
  CLIENT_HIDDEN_QUERY_STATUSES,
  SCRUTINY_QUERY_SOURCE,
  priorityFromSeverity,
  buildDraftQuery,
  canReviewQuery,
  findingQueryState,
} from "./makerChecker";

describe("CLIENT_HIDDEN_QUERY_STATUSES", () => {
  it("hides Draft and Rejected from clients but never Open", () => {
    expect(CLIENT_HIDDEN_QUERY_STATUSES).toContain(QUERY_STATUS_DRAFT);
    expect(CLIENT_HIDDEN_QUERY_STATUSES).toContain(QUERY_STATUS_REJECTED);
    expect(CLIENT_HIDDEN_QUERY_STATUSES).not.toContain(QUERY_STATUS_OPEN);
  });
});

describe("priorityFromSeverity", () => {
  it("maps severities case-insensitively, defaulting to Low", () => {
    expect(priorityFromSeverity("HIGH")).toBe("High");
    expect(priorityFromSeverity("medium")).toBe("Medium");
    expect(priorityFromSeverity("low")).toBe("Low");
    expect(priorityFromSeverity(null)).toBe("Low");
    expect(priorityFromSeverity("whatever")).toBe("Low");
  });
});

describe("buildDraftQuery", () => {
  const finding = { id: "f1", rule_id: "CASH-001", severity: "high", flag_message: "Cash payment ₹2,00,000" };

  it("creates a Draft query linked to the finding, preferring the rule template", () => {
    const row = buildDraftQuery({
      finding,
      ruleQueryTemplate: "Please explain the cash payment.",
      engagement_id: "e1",
      client_id: "c1",
      firm_id: "firm1",
      financial_year: "2024-25",
    });
    expect(row.status).toBe(QUERY_STATUS_DRAFT);
    expect(row.source).toBe(SCRUTINY_QUERY_SOURCE);
    expect(row.source_ref_id).toBe("f1");
    expect(row.query_text).toBe("Please explain the cash payment.");
    expect(row.priority).toBe("High");
    expect(row.client_id).toBe("c1");
    expect(row.financial_year).toBe("2024-25");
  });

  it("falls back to the finding text when no template is given", () => {
    const row = buildDraftQuery({ finding, client_id: "c1", financial_year: "2024-25" });
    expect(row.query_text).toBe("Cash payment ₹2,00,000");
    expect(row.engagement_id).toBeNull();
    expect(row.firm_id).toBeNull();
  });

  it("ignores a blank template", () => {
    const row = buildDraftQuery({ finding, ruleQueryTemplate: "   ", client_id: "c1", financial_year: "2024-25" });
    expect(row.query_text).toBe("Cash payment ₹2,00,000");
  });
});

describe("canReviewQuery (maker-checker guard)", () => {
  it("blocks the maker from reviewing their own query and needs a logged-in reviewer", () => {
    expect(canReviewQuery("u1", "u1")).toBe(false); // maker == checker
    expect(canReviewQuery("u1", "u2")).toBe(true); // different reviewer
    expect(canReviewQuery("u1", null)).toBe(false); // not logged in
    expect(canReviewQuery(null, "u2")).toBe(true); // no recorded maker → any reviewer ok
  });
});

describe("findingQueryState", () => {
  it("maps a linked query's status to the finding's maker-checker state", () => {
    expect(findingQueryState(null)).toBe("none");
    expect(findingQueryState(undefined)).toBe("none");
    expect(findingQueryState(QUERY_STATUS_DRAFT)).toBe("draft");
    expect(findingQueryState(QUERY_STATUS_REJECTED)).toBe("rejected");
    expect(findingQueryState(QUERY_STATUS_OPEN)).toBe("approved");
    expect(findingQueryState("Client Acknowledged")).toBe("approved");
  });
});
