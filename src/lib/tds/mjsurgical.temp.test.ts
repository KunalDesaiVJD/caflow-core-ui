import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseExpertPdfPages, type ExpertPdfTextItem } from "./expertPdf";
import { parseTallyPdfPages, type PdfTextItem } from "./tallyPdf";

const pages: PdfTextItem[][] = JSON.parse(readFileSync(
  "C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-OneDrive-Documents-GitHub-caflow-core-ui/34ef5319-3a58-45bd-84d3-e6b4533c68ad/scratchpad/mjsurgical_pages.json",
  "utf8",
));

describe("M J Surgical Provision Ledger diagnostic", () => {
  it("tries tallyPdf first", () => {
    const parsed = parseTallyPdfPages(pages);
    console.log("=== tallyPdf.ts ===");
    console.log("ledgerName:", parsed.ledgerName, "issues:", parsed.issues, "rows:", parsed.rows.length);
  });
  it("tries expertPdf", () => {
    const parsed = parseExpertPdfPages(pages as unknown as ExpertPdfTextItem[][]);
    console.log("=== expertPdf.ts ===");
    console.log("section:", parsed.section, "period:", parsed.period, "company:", parsed.company);
    console.log("issues:", parsed.issues);
    console.log("skipped:", parsed.skipped, "creditCount:", parsed.creditCount);
    const bySection = new Map<string, number>();
    for (const r of parsed.rows) bySection.set(r.section ?? "null", (bySection.get(r.section ?? "null") ?? 0) + 1);
    console.log("rows by section:", Object.fromEntries(bySection));
    for (const r of parsed.rows) console.log(JSON.stringify(r));
  });
});
