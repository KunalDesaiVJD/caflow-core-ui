import { describe, it, expect } from "vitest";
import { dueDateFromTerms, effectiveDueDate } from "./invoiceDueDate";

describe("dueDateFromTerms", () => {
  it("adds the terms to the invoice date, across month and year ends", () => {
    expect(dueDateFromTerms("2026-05-01", 45)).toBe("2026-06-15");
    expect(dueDateFromTerms("2026-12-20", 30)).toBe("2027-01-19");
    expect(dueDateFromTerms("2028-02-15", 14)).toBe("2028-02-29");
  });
  it("returns null when it cannot be worked out", () => {
    expect(dueDateFromTerms(null, 45)).toBeNull();
    expect(dueDateFromTerms("2026-05-01", null)).toBeNull();
    expect(dueDateFromTerms("not a date", 5)).toBeNull();
    expect(dueDateFromTerms("2026-05-01", -1)).toBeNull();
  });
});

describe("effectiveDueDate", () => {
  it("prefers the stored date, else derives it", () => {
    expect(effectiveDueDate({ due_date: "2026-07-01", invoice_date: "2026-05-01", payment_due_days: 45 })).toBe("2026-07-01");
    expect(effectiveDueDate({ due_date: null, invoice_date: "2026-05-01", payment_due_days: 45 })).toBe("2026-06-15");
  });
});
