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

describe("tdsReportPdf — Stage 1's Office/Imported field-pairs render as compact cards", () => {
  // Real reported bug: a Stage 1 row carries up to 7 "Office {field}"/"Imported
  // {field}" pairs (19 columns total incl. Record/Result/Remarks/Overridden), so
  // the old one-table-every-key-is-a-column renderer wrapped every cell onto
  // several lines — one mismatch spanned 4-5 printed pages, and a REAL exported
  // PDF for ~170 total records across 3 stages came back 74 pages long.
  const mismatchRow = {
    Record: "JATIN PATEL", Result: "Mismatched", "Mismatched Fields": "Amount, TDS",
    Remarks: "Mismatch — Amount, TDS differ.", Overridden: "No",
    "Office Name": "JATIN PATEL", "Imported Name": "Jatin Patel",
    "Office PAN": "ASBPP1794K", "Imported PAN": "ASBPP1794K",
    "Office Amount": 81770, "Imported Amount": 81870,
    "Office TDS": 8177, "Imported TDS": 8187,
  };
  const matchedRow = {
    Record: "CAVITAK MARKETING", Result: "Matched", "Mismatched Fields": "",
    Remarks: "All 7 fields match.", Overridden: "No",
    "Office Name": "CAVITAK MARKETING", "Imported Name": "CAVITAK MARKETING",
    "Office PAN": "AAECC3416H", "Imported PAN": "AAECC3416H",
    "Office Amount": 42800, "Imported Amount": 42800,
    "Office TDS": 856, "Imported TDS": 856,
  };
  const stage1Report: StageReport = {
    title: "Stage 1 - Data Validation",
    sections: [{ title: "Mismatched", rows: [mismatchRow], emptyNote: "None" }, { title: "Matched", rows: [matchedRow], emptyNote: "None" }],
    summary: [{ label: "Total", value: 2 }],
  };

  it("shows only the fields that actually differ, not all 7", async () => {
    exportToPdfMock.mockClear();
    await exportStagePdf(stage1Report, meta);
    const html = snapshots[snapshots.length - 1].html;
    expect(html).toContain('<div class="rec-card">');
    expect(html).toMatch(/<td>Amount<\/td><td>81770<\/td><td>81870<\/td>/);
    expect(html).toMatch(/<td>TDS<\/td><td>8177<\/td><td>8187<\/td>/);
    // Name and PAN agree on both sides for this record — must NOT appear as a diff row.
    expect(html).not.toMatch(/<td>Name<\/td>/);
    expect(html).not.toMatch(/<td>PAN<\/td>/);
  });

  it("collapses a fully-agreeing (Matched) record to one row in a plain table, not a card", async () => {
    exportToPdfMock.mockClear();
    await exportStagePdf(stage1Report, meta);
    const html = snapshots[snapshots.length - 1].html;
    expect(html).toContain('<table class="clean">');
    expect(html).toMatch(/<td>CAVITAK MARKETING<\/td><td>Matched<\/td>/);
    // The Matched record's own name must not spawn a second .rec-card.
    expect(html.match(/<div class="rec-card">/g)?.length ?? 0).toBe(1);
  });

  it("shows an em dash, not a blank cell, for a record with no office-side counterpart", async () => {
    const extraRow = {
      Record: "Dinesh Padsala", Result: "Extra in Imported File",
      "Mismatched Fields": "Name, PAN, Amount", Remarks: "In the imported client file only — no matching Office Data record.", Overridden: "No",
      "Office Name": "", "Imported Name": "Dinesh Padsala",
      "Office PAN": "", "Imported PAN": "AHYPP2567Q",
      "Office Amount": "", "Imported Amount": 151700,
    };
    const report: StageReport = { title: "Stage 1 - Data Validation", summary: [], sections: [{ title: "Extra in Imported", rows: [extraRow], emptyNote: "None" }] };
    exportToPdfMock.mockClear();
    await exportStagePdf(report, meta);
    const html = snapshots[snapshots.length - 1].html;
    expect(html).toMatch(/<td>Name<\/td><td>—<\/td><td>Dinesh Padsala<\/td>/);
    expect(html).not.toMatch(/<td>Name<\/td><td><\/td>/);
  });

  it("does not touch Stage 2/3's flat rows (no Office/Imported pairs)", async () => {
    exportToPdfMock.mockClear();
    await exportStagePdf(sampleReport, meta); // Stage 3 fixture from above — no field pairs
    const html = snapshots[snapshots.length - 1].html;
    expect(html).not.toContain('<div class="rec-card">');
    expect(html).toContain("LALITKUMAR MOHANBHAI PATEL");
  });
});
