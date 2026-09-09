import { describe, it, expect } from "vitest";
import { todayInIndia, taxYearForDate } from "./form141";

/**
 * The whole module reads "today" from todayInIndia rather than from
 * `new Date().toISOString()`, which is UTC.
 *
 * IST runs 5½ hours ahead of UTC, so between midnight and 05:30 IST the UTC
 * expression returns YESTERDAY. Every consequence of that is silent: a
 * deduction dated a day early, a statement not reported as overdue on the
 * morning it fell due, and — for six hours every 1 April — the previous Tax
 * Year offered as the default. A CA firm working at 4 a.m. in filing season
 * is not a hypothetical.
 */
describe("todayInIndia", () => {
  it("is already tomorrow when UTC still says today", () => {
    // 18:45 UTC on 9 September is 00:15 IST on the 10th.
    const at = new Date("2026-09-09T18:45:00Z");
    expect(todayInIndia(at)).toBe("2026-09-10");
    expect(at.toISOString().slice(0, 10)).toBe("2026-09-09");
  });

  it("agrees with UTC during Indian working hours", () => {
    const at = new Date("2026-09-09T06:30:00Z"); // 12:00 IST
    expect(todayInIndia(at)).toBe("2026-09-09");
  });

  it("holds the last moment of the IST day", () => {
    // 18:29 UTC is 23:59 IST — still the 9th.
    expect(todayInIndia(new Date("2026-09-09T18:29:00Z"))).toBe("2026-09-09");
  });

  it("rolls the Tax Year over at Indian midnight on 1 April, not UTC's", () => {
    // 20:00 UTC on 31 March is 01:30 IST on 1 April — Tax Year 2026-27 has
    // begun in the only timezone that matters here.
    const at = new Date("2026-03-31T20:00:00Z");
    expect(todayInIndia(at)).toBe("2026-04-01");
    expect(taxYearForDate(todayInIndia(at))).toBe("2026-27");
    // What the old expression would have said, and the year it would have
    // defaulted the whole screen to.
    expect(taxYearForDate(at.toISOString().slice(0, 10))).toBe("2025-26");
  });

  it("returns a plain YYYY-MM-DD, the wire format everything else uses", () => {
    expect(todayInIndia()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
