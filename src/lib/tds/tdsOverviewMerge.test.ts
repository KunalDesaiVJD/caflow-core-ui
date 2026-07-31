/**
 * mergeQuarterlyReports() classifies each quarter into Filed / Ready to File /
 * Not Ready by matching the PREFIX of the finalStatus string that
 * fetchFilingReport() built for that quarter. That coupling is easy to break:
 * add a new "done" status string upstream and forget it here, and the quarter
 * silently lands in Not Ready — which also drags `overview.ready` false and
 * paints the exported report's headline banner amber (tdsReportExcel.ts's
 * `fill(o.ready ? OK : WARN)`, tdsReportPdf.ts's colour choice).
 *
 * That is exactly what happened when "Ready to File" was introduced. These
 * tests pin the classification so it can't regress again.
 */
import { describe, it, expect } from "vitest";
import { mergeQuarterlyReports, type QuarterReportInput } from "./tdsOverviewFetch";

/** Minimal quarter input — only the fields the Overview classification reads
 *  need to be realistic; the StageReport merge path is exercised elsewhere. */
const quarterInput = (quarter: string, status: string): QuarterReportInput => ({
  quarter,
  meta: { client: "ORVIX TECHNOLOGIES PRIVATE LIMITED", tan: "AHMO03206A", form: "24Q", quarter, fy: "2026-27", status },
  stageReports: [],
  quarterStage: { title: quarter, applicable: true, ran: true, summary: [], status },
});

const READY_TO_FILE = "Ready to File — validation complete and signed, not yet filed";
const FILED = "Filed (validation complete)";
const CLEAN_UNSIGNED = "All validations complete — ready to mark as Ready to File";
const NOT_READY = "Not ready to file — Stage 1: 3 unresolved";

const countsOf = (o: ReturnType<typeof mergeQuarterlyReports>["overview"]) =>
  Object.fromEntries(o.overall.map((r) => [r.label, r.value]));

describe("mergeQuarterlyReports — a Ready-to-File quarter counts as ready, not Not Ready", () => {
  it("counts a single Ready to File quarter under 'Ready to File' and keeps ready=true", () => {
    const overview = mergeQuarterlyReports([quarterInput("Q1", READY_TO_FILE)]).overview;
    const counts = countsOf(overview);
    expect(counts["Ready to File"]).toBe(1);
    expect(counts["Not Ready"]).toBe(0);
    expect(counts["Filed"]).toBe(0);
    // Drives the exported report's headline banner colour — amber here would
    // tell a partner a fully validated, signed return is not ready.
    expect(overview.ready).toBe(true);
  });

  it("keeps ready=true across all four quarters marked Ready to File", () => {
    const overview = mergeQuarterlyReports(
      ["Q1", "Q2", "Q3", "Q4"].map((q) => quarterInput(q, READY_TO_FILE)),
    ).overview;
    expect(countsOf(overview)["Ready to File"]).toBe(4);
    expect(countsOf(overview)["Not Ready"]).toBe(0);
    expect(overview.ready).toBe(true);
  });

  it("still counts Filed and clean-but-unsigned quarters in their own buckets", () => {
    const overview = mergeQuarterlyReports([
      quarterInput("Q1", FILED),
      quarterInput("Q2", READY_TO_FILE),
      quarterInput("Q3", CLEAN_UNSIGNED),
    ]).overview;
    const counts = countsOf(overview);
    expect(counts["Filed"]).toBe(1);
    expect(counts["Ready to File"]).toBe(2); // signed + clean-unsigned
    expect(counts["Not Ready"]).toBe(0);
    expect(overview.ready).toBe(true);
  });

  it("a genuinely unfinished quarter still counts as Not Ready and forces ready=false", () => {
    const overview = mergeQuarterlyReports([
      quarterInput("Q1", READY_TO_FILE),
      quarterInput("Q2", NOT_READY),
    ]).overview;
    const counts = countsOf(overview);
    expect(counts["Ready to File"]).toBe(1);
    expect(counts["Not Ready"]).toBe(1);
    expect(overview.ready).toBe(false);
  });
});
