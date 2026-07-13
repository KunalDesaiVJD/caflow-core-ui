/**
 * tallyVoucherXml.ts — Build Tally "Import Data" XML for Sales / Credit Note
 * vouchers from a CAFlow invoice. Pure functions (no I/O) so they unit-test.
 *
 * Accounting (service invoice, no inventory):
 *   SALES:        Dr Party (total incl GST)   Cr Income (taxable)  Cr Output CGST/SGST/IGST  [±Round Off]
 *   CREDIT NOTE:  Cr Party (total)            Dr Income            Dr Output CGST/SGST/IGST   [±Round Off]
 *
 * Tally XML sign rule: Debit → ISDEEMEDPOSITIVE=Yes, AMOUNT negative;
 *                      Credit → ISDEEMEDPOSITIVE=No,  AMOUNT positive.
 * A balanced voucher has Σ AMOUNT == 0.
 *
 * TDS is NOT posted at invoice time — CA-firm TDS is deducted by the client on
 * PAYMENT, so it is handled by the receipt (reverse-sync), not here.
 *
 * Idempotency: the CAFlow invoice id is embedded in the narration as
 * "[CAFlow:<id>]" so a re-push can locate + ALTER the same voucher, and the
 * reverse direction can recognise CAFlow-originated vouchers.
 */

export interface ElementLedgers {
  income: string;
  output_cgst: string;
  output_sgst: string;
  output_igst: string;
  round_off: string;
}

export interface VoucherInput {
  documentType: "invoice" | "credit_note";
  companyName: string;   // Tally company (SVCURRENTCOMPANY)
  voucherNumber: string; // CAFlow invoice_no
  date: string;          // YYYYMMDD
  partyLedger: string;   // mapped Tally party ledger, else client name
  cafId: string;         // CAFlow invoice id (idempotency anchor)
  narration?: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;      // total − (taxable + all GST); +ve or −ve
  total: number;         // party amount (incl GST)
  ledgers: ElementLedgers;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const amt = (n: number) => round2(n).toFixed(2);

export function escXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

interface Entry { ledger: string; deemedPositive: boolean; amount: number; }

/** Ordered ledger entries for the voucher (Tally-signed). */
export function buildEntries(v: VoucherInput): Entry[] {
  const e: Entry[] = [];
  const dr = (ledger: string, x: number) => e.push({ ledger, deemedPositive: true,  amount: -Math.abs(round2(x)) });
  const cr = (ledger: string, x: number) => e.push({ ledger, deemedPositive: false, amount:  Math.abs(round2(x)) });
  const ro = (isCredit: boolean, x: number) => {
    if (!x) return;
    // roundOff > 0 means total was rounded UP (a credit on sales / debit on CN); mirror on CN.
    const positiveSide = isCredit ? dr : cr;
    const negativeSide = isCredit ? cr : dr;
    (x > 0 ? positiveSide : negativeSide)(v.ledgers.round_off, Math.abs(x));
  };

  if (v.documentType !== "credit_note") {
    dr(v.partyLedger, v.total);
    cr(v.ledgers.income, v.taxable);
    if (v.cgst) cr(v.ledgers.output_cgst, v.cgst);
    if (v.sgst) cr(v.ledgers.output_sgst, v.sgst);
    if (v.igst) cr(v.ledgers.output_igst, v.igst);
    ro(false, v.roundOff);
  } else {
    cr(v.partyLedger, v.total);
    dr(v.ledgers.income, v.taxable);
    if (v.cgst) dr(v.ledgers.output_cgst, v.cgst);
    if (v.sgst) dr(v.ledgers.output_sgst, v.sgst);
    if (v.igst) dr(v.ledgers.output_igst, v.igst);
    ro(true, v.roundOff);
  }
  return e;
}

/** Σ AMOUNT — must be ~0 for a valid double-entry voucher. */
export function entriesImbalance(entries: Entry[]): number {
  return round2(entries.reduce((s, e) => s + e.amount, 0));
}

export function buildVoucherXml(v: VoucherInput): string {
  const vchType = v.documentType === "credit_note" ? "Credit Note" : "Sales";
  const entries = buildEntries(v);
  const ledgerXml = entries.map(e => `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escXml(e.ledger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${e.deemedPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${amt(e.amount)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`).join("");
  const narration = `${v.narration ?? `Being ${vchType} ${v.voucherNumber}`} [CAFlow:${v.cafId}]`.trim();

  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>Vouchers</REPORTNAME>
      <STATICVARIABLES><SVCURRENTCOMPANY>${escXml(v.companyName)}</SVCURRENTCOMPANY></STATICVARIABLES>
    </REQUESTDESC>
    <REQUESTDATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="${escXml(vchType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>${escXml(v.date)}</DATE>
          <NARRATION>${escXml(narration)}</NARRATION>
          <VOUCHERTYPENAME>${escXml(vchType)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escXml(v.voucherNumber)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${escXml(v.partyLedger)}</PARTYLEDGERNAME>
          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>${ledgerXml}
        </VOUCHER>
      </TALLYMESSAGE>
    </REQUESTDATA>
  </IMPORTDATA></BODY>
</ENVELOPE>`;
}

/** Map a CAFlow invoices row → VoucherInput. `partyLedger`/`ledgers` come from
 *  the mapping tables; fall back to the client name / seeded defaults. */
export function invoiceToVoucherInput(row: any, opts: {
  companyName: string;
  partyLedger: string;
  ledgers: ElementLedgers;
}): VoucherInput {
  const num = (x: any) => Number(x ?? 0) || 0;
  const taxable = num(row.subtotal);
  const cgst = num(row.total_cgst);
  const sgst = num(row.total_sgst);
  const igst = num(row.total_igst);
  const total = num(row.total_amount);
  const roundOff = round2(total - (taxable + cgst + sgst + igst));
  const date = String(row.invoice_date ?? "").slice(0, 10).replace(/-/g, ""); // YYYY-MM-DD → YYYYMMDD
  const desc = Array.isArray(row.line_items) && row.line_items[0]?.description
    ? String(row.line_items[0].description).slice(0, 120) : "";

  return {
    documentType: row.document_type === "credit_note" ? "credit_note" : "invoice",
    companyName: opts.companyName,
    voucherNumber: String(row.invoice_no ?? ""),
    date,
    partyLedger: opts.partyLedger,
    cafId: String(row.id ?? ""),
    narration: desc ? `Being ${row.document_type === "credit_note" ? "credit note" : "invoice"} ${row.invoice_no} — ${desc}` : undefined,
    taxable, cgst, sgst, igst, roundOff, total,
    ledgers: opts.ledgers,
  };
}
