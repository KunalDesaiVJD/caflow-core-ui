/**
 * Regression test for a real reported bug: the exported Validation Overview PDF
 * came back essentially blank (a real file was ~3KB, no embedded image, an empty
 * `/XObject` dict) while the Excel export of the SAME data was fine.
 *
 * Root cause: html2pdf.js clones the element passed to `exportToPdf` and re-parents
 * the clone inside its OWN wrapper `<div>` (`height: auto`) to rasterise it via
 * html2canvas. `cloneNode` preserves inline styles, so if THAT element itself is
 * `position: fixed` (or `absolute`), the clone stays out of the wrapper's normal
 * flow and contributes nothing to its height — the wrapper measures 0px tall, and
 * html2canvas rasterises a 0-height canvas. Confirmed against a real browser: the
 * exact same bug reproduced byte-for-byte (3058 bytes, no image) with the old
 * position:fixed host, and was resolved (real embedded image, ~100KB+) by keeping
 * the host in normal flow and moving the off-screen positioning to a SEPARATE
 * wrapper that is never passed to html2pdf.
 *
 * This test pins the STRUCTURAL fix — the DOM shape handed to exportToPdf — since
 * html2canvas itself does not produce a meaningful raster in jsdom.
 */
import { describe, it, expect, vi } from "vitest";

// `printHtml`'s `finally { hider.remove() }` runs before control returns to the
// test's `await`, so the DOM shape must be captured SYNCHRONOUSLY inside the mock
// implementation — by the time the outer export*Pdf() call resolves, the host has
// already been detached and `.parentElement` reads back null either way.
const { exportToPdfMock, snapshots } = vi.hoisted(() => {
  const snapshots: { hostPosition: string; parentPosition: string | null; parentIsBody: boolean; parentParentIsBody: boolean; html: string }[] = [];
  const exportToPdfMock = vi.fn((el: HTMLElement) => {
    const parent = el.parentElement;
    snapshots.push({
      hostPosition: el.style.position,
      parentPosition: parent ? parent.style.position : null,
      parentIsBody: parent === document.body,
      parentParentIsBody: parent?.parentElement === document.body,
      html: el.innerHTML,
    });
    return Promise.resolve(undefined);
  });
  return { exportToPdfMock, snapshots };
});
vi.mock("@/lib/exportUtils", () => ({ exportToPdf: exportToPdfMock }));

import { exportStagePdf, exportOverviewPdf } from "./tdsReportPdf";
import type { StageReport, OverviewReport, ReportMeta } from "./tdsReport";

const meta: ReportMeta = { client: "ACCURATE PMS PVT. LTD.", tan: "AHMA13819B", form: "26Q", quarter: "Q4", fy: "2025-26" };

const sampleReport: StageReport = {
  title: "Stage 3 - Tally Ledger Reconciliation",
  subtitle: "Office Data vs the imported Tally ledger PDFs",
  summary: [{ label: "Total", value: 89 }, { label: "Matched", value: 40 }, { label: "Mismatched", value: 9 }, { label: "Overridden", value: 0 }],
  sections: [{ title: "Mismatched", rows: [{ "Office Party": "LALITKUMAR MOHANBHAI PATEL", Result: "Ledger Entry Not Found" }], emptyNote: "None" }],
};

const sampleOverview: OverviewReport = {
  overall: [{ label: "Total", value: 89 }],
  finalStatus: "Ready to file",
  ready: true,
  stages: [{ title: "Stage 1", status: "Complete", applicable: true, ran: true, summary: [{ label: "Matched", value: 89 }] }],
};

/** The element html2pdf actually rasterises — never itself out of normal flow. */
function assertHostIsSafeForHtml2pdf() {
  expect(exportToPdfMock).toHaveBeenCalledTimes(1);
  const snap = snapshots[snapshots.length - 1];

  // The host itself must stay in NORMAL FLOW — html2pdf clones exactly this node
  // and re-parents the clone inside its own `height:auto` wrapper; a fixed/absolute
  // host would carry that positioning into the clone and never contribute height.
  expect(["", "static"]).toContain(snap.hostPosition);

  // Off-screen hiding must live on a SEPARATE ancestor that is not the html2pdf
  // source itself, so it never gets cloned into html2pdf's wrapper.
  expect(snap.parentIsBody).toBe(false);
  expect(snap.parentPosition).toBe("fixed");
  expect(snap.parentParentIsBody).toBe(true);
}

describe("tdsReportPdf — the html2pdf source element stays in normal flow", () => {
  it("exportStagePdf hands html2pdf a non-fixed, non-absolute host", async () => {
    exportToPdfMock.mockClear();
    await exportStagePdf(sampleReport, meta);
    assertHostIsSafeForHtml2pdf();
  });

  it("exportOverviewPdf hands html2pdf a non-fixed, non-absolute host", async () => {
    exportToPdfMock.mockClear();
    await exportOverviewPdf(sampleOverview, meta, [sampleReport]);
    assertHostIsSafeForHtml2pdf();
  });

  it("removes the off-screen wrapper afterwards, even on success", async () => {
    exportToPdfMock.mockClear();
    const before = document.body.childElementCount;
    await exportStagePdf(sampleReport, meta);
    expect(document.body.childElementCount).toBe(before);
  });

  it("removes the off-screen wrapper even when exportToPdf throws", async () => {
    exportToPdfMock.mockClear();
    exportToPdfMock.mockRejectedValueOnce(new Error("html2canvas failed"));
    const before = document.body.childElementCount;
    await expect(exportStagePdf(sampleReport, meta)).rejects.toThrow("html2canvas failed");
    expect(document.body.childElementCount).toBe(before);
  });
});

describe("tdsReportPdf — Overview carries each stage's real rows, not just its counts", () => {
  // Regression for a real reported bug: the Excel Overview export had 4 sheets
  // (Overview + a detail sheet per stage that ran, ~300 rows of actual records),
  // but the PDF Overview only ever rendered the summary-card counts — the two
  // "same" exports disagreed on CONTENT, not just layout. exportOverviewPdf now
  // takes the same `stageReports` buildOverviewWorkbook already receives.
  it("includes each stage report's detail table rows in the rendered HTML", async () => {
    exportToPdfMock.mockClear();
    await exportOverviewPdf(sampleOverview, meta, [sampleReport]);
    const html = snapshots[snapshots.length - 1].html;
    expect(html).toContain("LALITKUMAR MOHANBHAI PATEL");
    expect(html).toContain("Ledger Entry Not Found");
    expect(html).toContain(sampleReport.title);
  });

  it("renders nothing extra when no stage has run yet", async () => {
    exportToPdfMock.mockClear();
    await exportOverviewPdf(sampleOverview, meta, []);
    const html = snapshots[snapshots.length - 1].html;
    expect(html).not.toContain("LALITKUMAR");
  });
});

describe("tdsReportPdf — summary cards are coloured BY MEANING, matching the Excel export", () => {
  it("colours a non-zero Mismatched/Issues count red, not the same as a clean one", async () => {
    exportToPdfMock.mockClear();
    await exportStagePdf(sampleReport, meta); // Mismatched: 9
    const html = snapshots[snapshots.length - 1].html;
    expect(html).toMatch(/color:#C00000;">9</);
  });

  it("colours a zero Overridden/Mismatched count green or neutral, never red", async () => {
    exportToPdfMock.mockClear();
    await exportStagePdf(sampleReport, meta); // Overridden: 0
    const html = snapshots[snapshots.length - 1].html;
    expect(html).not.toMatch(/color:#C00000;">0</);
  });

  it("colours Matched green", async () => {
    exportToPdfMock.mockClear();
    await exportStagePdf(sampleReport, meta); // Matched: 40
    const html = snapshots[snapshots.length - 1].html;
    expect(html).toMatch(/color:#107C41;">40</);
  });
});
