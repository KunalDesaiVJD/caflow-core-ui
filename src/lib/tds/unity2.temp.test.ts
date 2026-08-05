import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseTallyPdfPages, type PdfTextItem } from "./tallyPdf";

const load = (name: string): PdfTextItem[][] => JSON.parse(readFileSync(
  `C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-OneDrive-Documents-GitHub-caflow-core-ui/34ef5319-3a58-45bd-84d3-e6b4533c68ad/scratchpad/${name}.json`,
  "utf8",
));

describe("Unity real-file diagnostic 2", () => {
  it("dumps SALARY.pdf parsed rows", () => {
    const parsed = parseTallyPdfPages(load("unity_salary_pdf_pages"));
    console.log("ledgerName:", parsed.ledgerName, "section:", parsed.section);
    console.log("issues:", parsed.issues);
    for (const r of parsed.rows) console.log(JSON.stringify(r));
  });
  it("dumps 192B.pdf parsed rows", () => {
    const parsed = parseTallyPdfPages(load("unity_192b_pdf_pages"));
    console.log("ledgerName:", parsed.ledgerName, "section:", parsed.section);
    console.log("issues:", parsed.issues);
    for (const r of parsed.rows) console.log(JSON.stringify(r));
  });
});
