import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseTallyPdfPages, type PdfTextItem } from "./tallyPdf";
const K = "K:/eTDS202627/KWIK TEAM SUPPORT SERVICE PVT LTD/Q1/24Q/New folder";
const M = "K:/eTDS202627/MICROCIRCUTS INNOVATION PVT LTD/Q1/24Q/New folder";
async function pagesOf(f: string): Promise<PdfTextItem[][]> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), useSystemFonts: true }).promise;
  const out: PdfTextItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out.push(tc.items.filter((i: any) => typeof i.str === "string" && i.str.trim())
      .map((i: any) => ({ x: i.transform[4], y: i.transform[5], w: i.width, str: i.str.trim() })));
  }
  return out;
}
async function show(label: string, f: string) {
  const { rows, skipped } = parseTallyPdfPages(await pagesOf(f));
  const c = rows.filter((r) => r.credit);
  console.log(`\n### ${label}: ${c.length} credit rows | skipped=${JSON.stringify(skipped)}`);
  console.log(c.slice(0, 5).map((r) => `  ${r.party} | ${r.date} | ${r.credit} | ${r.amountKind ?? "tds"}`).join("\n"));
  return c;
}
describe("all real salary-side ledgers", () => {
  it("parses every one", async () => {
    const apr = await show("KWIK apr-26", `${K}/apr-26.pdf`);
    const may = await show("KWIK may26", `${K}/may26.pdf`);
    const jun = await show("KWIK JUN-26", `${K}/JUN-26.pdf`);
    const sal = await show("MICRO salary expense", `${M}/salary expense.pdf`);
    const dir = await show("MICRO direc", `${M}/direc.pdf`);
    expect(apr.length).toBeGreaterThan(10);
    expect(sal.length).toBe(54);
    expect(dir.filter((r) => /^madhukant/i.test(r.party ?? "")).every((r) => r.credit === 200000)).toBe(true);
    expect(sal.filter((r) => /nevil/i.test(r.party ?? "")).every((r) => r.credit === 51372)).toBe(true);
  }, 300000);
});
