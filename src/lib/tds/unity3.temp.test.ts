import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseTallyPdfPages, type PdfTextItem } from "./tallyPdf";
import {
  resolveTaxableIncomeReading, reconcileTallyFull, mergeDualLedgerResults,
  aggregateTaxableByEmployeeMonth, type OfficeTxn, type TallyRow,
} from "./tallyRecon";
import { canonicalSection } from "./match";

const load = (name: string): PdfTextItem[][] => JSON.parse(readFileSync(
  `C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-OneDrive-Documents-GitHub-caflow-core-ui/34ef5319-3a58-45bd-84d3-e6b4533c68ad/scratchpad/${name}.json`,
  "utf8",
));

// Real Unity Organics office data (tds_deductees), FY2026-27 Q1 24Q, from a
// direct DB query — filing b498b67f-37a8-43b2-b345-e52ce4f22eb1.
const office: OfficeTxn[] = [
  { deductee_id: "g1", name: "GHANSHYAMBHAI HIRJIBHAI SAVALIYA", date_iso: "2026-04-30", amount: 41990, tds: 0, section: "192B" },
  { deductee_id: "g2", name: "GHANSHYAMBHAI HIRJIBHAI SAVALIYA", date_iso: "2026-05-31", amount: 41990, tds: 0, section: "192B" },
  { deductee_id: "g3", name: "GHANSHYAMBHAI HIRJIBHAI SAVALIYA", date_iso: "2026-06-30", amount: 41990, tds: 0, section: "192B" },
  { deductee_id: "k1", name: "KARISHMA HIREN PATOLIYA", date_iso: "2026-04-30", amount: 150000, tds: 13000, section: "192B" },
  { deductee_id: "k2", name: "KARISHMA HIREN PATOLIYA", date_iso: "2026-05-31", amount: 150000, tds: 13000, section: "192B" },
  { deductee_id: "u1", name: "UMANG PRAVINBHAI KAPOPARA", date_iso: "2026-04-30", amount: 125000, tds: 9000, section: "192B" },
  { deductee_id: "u2", name: "UMANG PRAVINBHAI KAPOPARA", date_iso: "2026-05-31", amount: 125000, tds: 9000, section: "192B" },
  { deductee_id: "z1", name: "ZALAK PRAVINBHAI KAPOPARA", date_iso: "2026-04-30", amount: 215000, tds: 30000, section: "192B" },
  { deductee_id: "z2", name: "ZALAK PRAVINBHAI KAPOPARA", date_iso: "2026-05-31", amount: 215000, tds: 30000, section: "192B" },
];

describe("Unity real-file diagnostic 3 — full dual-ledger pipeline", () => {
  it("runs the exact runAudit sequence", () => {
    const salaryParsed = parseTallyPdfPages(load("unity_salary_pdf_pages"));
    const tdsParsed = parseTallyPdfPages(load("unity_192b_pdf_pages"));
    const tally: TallyRow[] = [...salaryParsed.rows, ...tdsParsed.rows];

    const taggedRows = tally.filter((t) => t.amountKind === "taxable_income");
    const untaggedRows = tally.filter((t) => t.amountKind !== "taxable_income");
    const creditsIn = (rows: TallyRow[], sec: string | null) =>
      rows.filter((t) => t.credit != null && t.credit !== 0 && (canonicalSection(t.section) ?? null) === sec).length;
    const taggedSections = new Set(taggedRows.map((t) => canonicalSection(t.section) ?? null));
    const isRealExpenseLedger = [...taggedSections].some(
      (sec) => creditsIn(taggedRows, sec) > creditsIn(untaggedRows, sec),
    );
    console.log("taggedSections:", [...taggedSections]);
    console.log("isRealExpenseLedger:", isRealExpenseLedger);
    console.log("taggedRows count:", taggedRows.length, "untaggedRows count:", untaggedRows.length);

    const partiesForAmount: OfficeTxn[] = office.map((o) => ({ ...o, tds: null, section: null }));

    const resolved = resolveTaxableIncomeReading(partiesForAmount, taggedRows);
    console.log("--- resolved taggedRows (after net/gross vote) ---");
    for (const r of resolved) console.log(JSON.stringify(r));

    const salaryLedgerRows = isRealExpenseLedger ? aggregateTaxableByEmployeeMonth(resolved) : [];
    console.log("--- salaryLedgerRows (post-aggregation) ---");
    for (const r of salaryLedgerRows) console.log(JSON.stringify(r));

    const tdsLedgerRows = isRealExpenseLedger ? aggregateTaxableByEmployeeMonth(untaggedRows) : aggregateTaxableByEmployeeMonth(tally);

    const dualLedgerMode = salaryLedgerRows.length > 0;
    console.log("dualLedgerMode:", dualLedgerMode);

    if (dualLedgerMode) {
      const tdsResult = reconcileTallyFull(office, tdsLedgerRows, null, {});
      const salaryResult = reconcileTallyFull(partiesForAmount, salaryLedgerRows, null, {});
      const merged = mergeDualLedgerResults(tdsResult.rows, salaryResult.rows);
      console.log("--- merged results ---");
      for (const r of merged) console.log(JSON.stringify({
        office_name: r.office_name, result: r.result, taxable_income_status: r.taxable_income_status,
        tds_status: r.tds_status, salary_tally_credit: r.salary_tally_credit, tally_credit: r.tally_credit,
        office_amount: r.office_amount, office_tds: r.office_tds,
      }));
    }
  });
});
