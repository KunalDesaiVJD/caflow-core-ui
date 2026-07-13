/**
 * tallyVoucherXml.ts — Build Tally "Import Data" XML for Sales / Credit Note
 * vouchers from a CAFlow invoice, in ACCOUNTING INVOICE mode (the firm's style).
 *
 * Matches the firm's own entries: OBJVIEW="Invoice Voucher View", ISINVOICE=Yes,
 * entries under <LEDGERENTRIES.LIST> (NOT <ALLLEDGERENTRIES.LIST>), party
 * auto-debited (ISPARTYLEDGER=Yes), and ONE income line PER SERVICE line-item.
 *
 *   SALES:        Dr Party (total)   Cr Income-line×N   Cr Output CGST/SGST/IGST  [±Round Off]
 *   CREDIT NOTE:  Cr Party (total)   Dr Income-line×N   Dr Output CGST/SGST/IGST   [±Round Off]
 *
 * Tally sign rule: Debit → ISDEEMEDPOSITIVE=Yes, AMOUNT negative;
 *                  Credit → ISDEEMEDPOSITIVE=No,  AMOUNT positive.  Σ AMOUNT == 0.
 *
 * TDS is NOT posted at invoice time (CA-firm TDS is deducted on payment → reverse-sync).
 * Idempotency: CAFlow invoice id embedded in narration as "[CAFlow:<id>]".
 */

export interface GstLedgers {
  output_cgst: string;
  output_sgst: string;
  output_igst: string;
  round_off: string;
}

export interface IncomeLine { ledger: string; amount: number; }

/** Party GST/registration details — sourced from the Tally party MASTER (never
 *  invented / never from CAFlow), so the voucher shows real State/GSTIN instead
 *  of "Not Applicable". Any field left blank is simply omitted from the XML. */
export interface PartyGst {
  state?: string;            // buyer/consignee state (e.g. "Gujarat")
  gstin?: string;            // party GSTIN
  regType?: string;          // "Regular" | "Composition" | "Unregistered" | "Consumer" …
  country?: string;          // default "India"
  mailingName?: string;      // party mailing/base name for print
}

export interface VoucherInput {
  documentType: "invoice" | "credit_note";
  companyName: string;
  voucherNumber: string;
  date: string;              // YYYYMMDD
  partyLedger: string;
  cafId: string;
  narration?: string;
  incomeLines: IncomeLine[]; // one per service line (Cr on sales)
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;             // party amount (incl GST)
  gstLedgers: GstLedgers;
  party?: PartyGst;          // GST details from the Tally master
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const amt = (n: number) => round2(n).toFixed(2);

export function escXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

interface Entry { ledger: string; deemedPositive: boolean; amount: number; isParty?: boolean; }

/** Ordered ledger entries (Tally-signed): party first, then income lines, then GST, then round-off. */
export function buildEntries(v: VoucherInput): Entry[] {
  const e: Entry[] = [];
  const isCN = v.documentType === "credit_note";
  const drSide = (ledger: string, x: number, isParty = false) =>
    e.push({ ledger, deemedPositive: true,  amount: -Math.abs(round2(x)), isParty });
  const crSide = (ledger: string, x: number, isParty = false) =>
    e.push({ ledger, deemedPositive: false, amount:  Math.abs(round2(x)), isParty });
  // On sales the party is a debit and income/GST are credits; a credit note flips both.
  const party = isCN ? crSide : drSide;
  const alloc = isCN ? drSide : crSide;

  party(v.partyLedger, v.total, true);
  for (const li of v.incomeLines) if (li.amount) alloc(li.ledger, li.amount);
  if (v.cgst) alloc(v.gstLedgers.output_cgst, v.cgst);
  if (v.sgst) alloc(v.gstLedgers.output_sgst, v.sgst);
  if (v.igst) alloc(v.gstLedgers.output_igst, v.igst);
  if (v.roundOff) {
    // roundOff>0 (total rounded up) is a credit on sales / debit on CN.
    (v.roundOff > 0 ? alloc : party === crSide ? crSide : drSide)(v.gstLedgers.round_off, Math.abs(v.roundOff));
  }
  return e;
}

export function entriesImbalance(entries: Entry[]): number {
  return round2(entries.reduce((s, e) => s + e.amount, 0));
}

export function buildVoucherXml(v: VoucherInput, opts?: { action?: "Create" | "Alter"; remoteId?: string }): string {
  const vchType = v.documentType === "credit_note" ? "Credit Note" : "Sales";
  const action = opts?.action ?? "Create";
  // REMOTEID = stable idempotency key. Defaults to CAFLOW-<invoiceId> so that a
  // re-sync ALTERS the same voucher (never duplicates) and the voucher stays
  // deletable by this key. This is what makes forward sync safely repeatable.
  const remoteId = opts?.remoteId ?? (v.cafId ? `CAFLOW-${v.cafId}` : "");
  const remoteAttr = remoteId ? `REMOTEID="${escXml(remoteId)}" ` : "";
  const entries = buildEntries(v);
  const ledgerXml = entries.map(e => `
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>${escXml(e.ledger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${e.deemedPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <ISPARTYLEDGER>${e.isParty ? "Yes" : "No"}</ISPARTYLEDGER>
          <AMOUNT>${amt(e.amount)}</AMOUNT>
        </LEDGERENTRIES.LIST>`).join("");
  // Narration = the caller-supplied service breakup (no CAFlow tag — idempotency
  // is carried by REMOTEID, so the narration stays clean like the firm's own).
  const narration = (v.narration ?? `Being ${vchType} ${v.voucherNumber}`).trim();

  // Party GST block — emitted only for fields present in the Tally master, so a
  // registered party shows its real State/GSTIN and an incomplete master simply
  // omits the tag (rather than my import forcing "Not Applicable").
  const p = v.party ?? {};
  const gstBlock = [
    p.mailingName ? `<BASICBASEPARTYNAME>${escXml(p.mailingName)}</BASICBASEPARTYNAME>` : "",
    p.state ? `<STATENAME>${escXml(p.state)}</STATENAME>` : "",
    `<COUNTRYOFRESIDENCE>${escXml(p.country || "India")}</COUNTRYOFRESIDENCE>`,
    p.gstin ? `<PARTYGSTIN>${escXml(p.gstin)}</PARTYGSTIN>` : "",
    p.regType ? `<GSTREGISTRATIONTYPE>${escXml(p.regType)}</GSTREGISTRATIONTYPE>` : "",
    p.state ? `<PLACEOFSUPPLY>${escXml(p.state)}</PLACEOFSUPPLY>` : "",
    p.state ? `<CONSIGNEESTATENAME>${escXml(p.state)}</CONSIGNEESTATENAME>` : "",
    p.gstin ? `<CONSIGNEEGSTIN>${escXml(p.gstin)}</CONSIGNEEGSTIN>` : "",
  ].filter(Boolean).map(s => "\n          " + s).join("");

  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>Vouchers</REPORTNAME>
      <STATICVARIABLES><SVCURRENTCOMPANY>${escXml(v.companyName)}</SVCURRENTCOMPANY></STATICVARIABLES>
    </REQUESTDESC>
    <REQUESTDATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER ${remoteAttr}VCHTYPE="${escXml(vchType)}" ACTION="${action}" OBJVIEW="Invoice Voucher View">
          <DATE>${escXml(v.date)}</DATE>
          <VOUCHERTYPENAME>${escXml(vchType)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escXml(v.voucherNumber)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${escXml(v.partyLedger)}</PARTYLEDGERNAME>
          <PARTYNAME>${escXml(v.partyLedger)}</PARTYNAME>${gstBlock}
          <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
          <ISINVOICE>Yes</ISINVOICE>
          <NARRATION>${escXml(narration)}</NARRATION>${ledgerXml}
        </VOUCHER>
      </TALLYMESSAGE>
    </REQUESTDATA>
  </IMPORTDATA></BODY>
</ENVELOPE>`;
}

/** Delete-by-key XML (used to remove a previously-posted voucher before re-posting). */
export function buildDeleteXml(companyName: string, vchType: string, date: string, voucherNumber: string, remoteId?: string): string {
  const idTag = remoteId ? `\n          <REMOTEID>${escXml(remoteId)}</REMOTEID>` : "";
  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA>
    <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
      <STATICVARIABLES><SVCURRENTCOMPANY>${escXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES>
    </REQUESTDESC>
    <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER ACTION="Delete" VCHTYPE="${escXml(vchType)}">${idTag}
        <DATE>${escXml(date)}</DATE>
        <VOUCHERTYPENAME>${escXml(vchType)}</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${escXml(voucherNumber)}</VOUCHERNUMBER>
      </VOUCHER>
    </TALLYMESSAGE></REQUESTDATA>
  </IMPORTDATA></BODY>
</ENVELOPE>`;
}

/** Ledger-master create XML (party ledger under Sundry Debtors). */
export function buildLedgerCreateXml(companyName: string, name: string, parent = "Sundry Debtors"): string {
  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA>
    <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>
      <STATICVARIABLES><SVCURRENTCOMPANY>${escXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES>
    </REQUESTDESC>
    <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${escXml(name)}" ACTION="Create">
        <NAME>${escXml(name)}</NAME><PARENT>${escXml(parent)}</PARENT><ISBILLWISEON>Yes</ISBILLWISEON>
      </LEDGER>
    </TALLYMESSAGE></REQUESTDATA>
  </IMPORTDATA></BODY>
</ENVELOPE>`;
}

/** Indian-grouped amount (no decimals for whole numbers): 100000 → "1,00,000". */
export function formatInr(n: number): string {
  const neg = n < 0; let s = Math.abs(round2(n)).toFixed(2).replace(/\.00$/, "");
  const [intp, dec] = s.split(".");
  const last3 = intp.slice(-3), rest = intp.slice(0, -3);
  const grouped = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last3;
  return (neg ? "-" : "") + grouped + (dec ? "." + dec : "");
}

/** Map a CAFlow invoices row → VoucherInput. `resolveIncome(desc,i)` maps each
 *  line-item's service description to the firm's Tally income ledger. Each line
 *  is bifurcated to its income ledger (lines sharing a ledger are summed), and
 *  the full service break-up (with amounts) is written into the narration. */
export function invoiceToVoucherInput(row: any, opts: {
  companyName: string;
  partyLedger: string;
  gstLedgers: GstLedgers;
  resolveIncome: (lineDescription: string, index: number) => string;
  party?: PartyGst;
}): VoucherInput {
  const num = (x: any) => Number(x ?? 0) || 0;
  const cgst = num(row.total_cgst), sgst = num(row.total_sgst), igst = num(row.total_igst);
  const total = num(row.total_amount);
  const lines: any[] = Array.isArray(row.line_items) ? row.line_items : [];
  // Group taxable by income ledger (multiple service lines may share a ledger),
  // preserving first-seen order so the voucher lines read like the invoice.
  const byLedger = new Map<string, number>();
  const narrParts: string[] = [];
  let taxableSum = 0;
  lines.forEach((li, i) => {
    const tv = num(li.taxable_value ?? li.rate ?? 0);
    taxableSum += tv;
    const led = opts.resolveIncome(String(li.description ?? ""), i);
    byLedger.set(led, round2((byLedger.get(led) ?? 0) + tv));
    const desc = String(li.description ?? "").trim();
    const det = String(li.description_details ?? "").trim();
    if (desc) narrParts.push(`${desc}${det ? ` (${det})` : ""} ₹${formatInr(tv)}`);
  });
  if (byLedger.size === 0) { // no line items → single income line off subtotal
    byLedger.set(opts.resolveIncome("", 0), num(row.subtotal));
    taxableSum = num(row.subtotal);
  }
  const incomeLines = [...byLedger].map(([ledger, amount]) => ({ ledger, amount }));
  const roundOff = round2(total - (taxableSum + cgst + sgst + igst));
  const date = String(row.invoice_date ?? "").slice(0, 10).replace(/-/g, "");
  const narration = narrParts.length ? narrParts.join(" + ") : `Being ${row.document_type === "credit_note" ? "credit note" : "invoice"} ${row.invoice_no}`;

  return {
    documentType: row.document_type === "credit_note" ? "credit_note" : "invoice",
    companyName: opts.companyName,
    voucherNumber: String(row.invoice_no ?? ""),
    date,
    partyLedger: opts.partyLedger,
    cafId: String(row.id ?? ""),
    narration,
    incomeLines, cgst, sgst, igst, roundOff, total,
    gstLedgers: opts.gstLedgers,
    party: opts.party,
  };
}
