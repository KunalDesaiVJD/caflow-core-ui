/**
 * voucher-xml.js — Build Tally "Import Data" XML for Sales / Credit Note vouchers
 * from a CAFlow invoice, in ACCOUNTING INVOICE mode (the firm's style).
 *
 * This is the Node/CommonJS twin of supabase/functions/_shared/tallyVoucherXml.ts,
 * and is the exact logic proven live against "V J Desai & Co LLP":
 *   - Invoice mode: OBJVIEW="Invoice Voucher View", ISINVOICE=Yes, LEDGERENTRIES.LIST
 *   - Party auto-debited (ISPARTYLEDGER=Yes); ONE income line PER income ledger
 *     (service lines are bifurcated to their income ledger and summed)
 *   - Party GST (State/GSTIN/Registration) carried from the Tally MASTER so the
 *     voucher shows real details instead of "Not Applicable"
 *   - Full service break-up written into the narration
 *   - REMOTEID = CAFLOW-<invoiceId> so re-sync is idempotent (delete-by-REMOTEID
 *     then create) and never duplicates
 *
 * Tally sign rule: Debit -> ISDEEMEDPOSITIVE=Yes, AMOUNT negative;
 *                  Credit -> ISDEEMEDPOSITIVE=No,  AMOUNT positive.  Sum(AMOUNT)==0.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const amt = (n) => round2(n).toFixed(2);

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Indian-grouped amount (no decimals for whole numbers): 100000 -> "1,00,000". */
function formatInr(n) {
  const neg = n < 0;
  const s = Math.abs(round2(n)).toFixed(2).replace(/\.00$/, '');
  const [intp, dec] = s.split('.');
  const last3 = intp.slice(-3), rest = intp.slice(0, -3);
  const grouped = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
  return (neg ? '-' : '') + grouped + (dec ? '.' + dec : '');
}

/** Default service-description -> Tally income ledger map (verified to exist in
 *  "V J Desai & Co LLP"). Override via opts.resolveIncome for other firms, or
 *  wire to tally_element_map once the matcher is built. */
function defaultResolveIncome(desc) {
  const d = String(desc || '').toLowerCase();
  if (/tax audit/.test(d)) return 'Tax Audit Fees Income';
  if (/rera/.test(d)) return 'RERA Consultancy';
  if (/gst/.test(d)) return 'GST Consultancy';
  if (/income tax|i\.tax/.test(d)) return 'Fees- Income Tax Matter';
  if (/certification/.test(d)) return 'Certification Fees';
  if (/professional/.test(d)) return 'Professional Fees-Income';
  return 'Professional Fees-Income';
}

/** Ordered, Tally-signed ledger entries: party first, then income lines, GST, round-off. */
function buildEntries(v) {
  const e = [];
  const isCN = v.documentType === 'credit_note';
  const drSide = (ledger, x, isParty = false) => e.push({ ledger, deemedPositive: true, amount: -Math.abs(round2(x)), isParty });
  const crSide = (ledger, x, isParty = false) => e.push({ ledger, deemedPositive: false, amount: Math.abs(round2(x)), isParty });
  const party = isCN ? crSide : drSide;    // sales: party is a debit; CN flips
  const alloc = isCN ? drSide : crSide;

  party(v.partyLedger, v.total, true);
  for (const li of v.incomeLines) if (li.amount) alloc(li.ledger, li.amount);
  if (v.cgst) alloc(v.gstLedgers.output_cgst, v.cgst);
  if (v.sgst) alloc(v.gstLedgers.output_sgst, v.sgst);
  if (v.igst) alloc(v.gstLedgers.output_igst, v.igst);
  if (v.roundOff) (v.roundOff > 0 ? alloc : party)(v.gstLedgers.round_off, Math.abs(v.roundOff));
  return e;
}

function entriesImbalance(entries) {
  return round2(entries.reduce((s, e) => s + e.amount, 0));
}

/** Build the import XML. opts.action = "Create" | "Alter"; opts.remoteId overrides
 *  the default CAFLOW-<cafId>. */
function buildVoucherXml(v, opts = {}) {
  const vchType = v.documentType === 'credit_note' ? 'Credit Note' : 'Sales';
  const action = opts.action || 'Create';
  const remoteId = opts.remoteId != null ? opts.remoteId : (v.cafId ? `CAFLOW-${v.cafId}` : '');
  const remoteAttr = remoteId ? `REMOTEID="${escXml(remoteId)}" ` : '';
  const entries = buildEntries(v);
  const ledgerXml = entries.map((e) => `
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>${escXml(e.ledger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${e.deemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
          <ISPARTYLEDGER>${e.isParty ? 'Yes' : 'No'}</ISPARTYLEDGER>
          <AMOUNT>${amt(e.amount)}</AMOUNT>
        </LEDGERENTRIES.LIST>`).join('');
  const narration = (v.narration || `Being ${vchType} ${v.voucherNumber}`).trim();

  const p = v.party || {};
  const gstBlock = [
    p.mailingName ? `<BASICBASEPARTYNAME>${escXml(p.mailingName)}</BASICBASEPARTYNAME>` : '',
    p.state ? `<STATENAME>${escXml(p.state)}</STATENAME>` : '',
    `<COUNTRYOFRESIDENCE>${escXml(p.country || 'India')}</COUNTRYOFRESIDENCE>`,
    p.gstin ? `<PARTYGSTIN>${escXml(p.gstin)}</PARTYGSTIN>` : '',
    p.regType ? `<GSTREGISTRATIONTYPE>${escXml(p.regType)}</GSTREGISTRATIONTYPE>` : '',
    p.state ? `<PLACEOFSUPPLY>${escXml(p.state)}</PLACEOFSUPPLY>` : '',
    p.state ? `<CONSIGNEESTATENAME>${escXml(p.state)}</CONSIGNEESTATENAME>` : '',
    p.gstin ? `<CONSIGNEEGSTIN>${escXml(p.gstin)}</CONSIGNEEGSTIN>` : '',
  ].filter(Boolean).map((s) => '\n          ' + s).join('');

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

/** Two-leg Journal (used for a CAFlow kasar/write-off -> Tally):
 *  Dr <kasar/rebate ledger>, Cr <party>. REMOTEID makes it idempotent/deletable. */
function buildJournalXml(companyName, { date, remoteId, drLedger, crLedger, amount, narration }) {
  const a = amt(Math.abs(amount));
  const rid = remoteId ? `REMOTEID="${escXml(remoteId)}" ` : '';
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${escXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>` +
    `<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER ${rid}VCHTYPE="Journal" ACTION="Create">` +
    `<DATE>${escXml(date)}</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>${escXml(narration || '')}</NARRATION>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escXml(drLedger)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${a}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escXml(crLedger)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${a}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
    `</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

/** Delete-by-REMOTEID XML. Only works when the voucher was created WITH this
 *  REMOTEID (the idempotency key). Run before create for safe re-sync. */
function buildDeleteByRemoteId(companyName, vchType, date, voucherNumber, remoteId) {
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${escXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>` +
    `<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="${escXml(remoteId)}" VCHTYPE="${escXml(vchType)}" ACTION="Delete">` +
    `<DATE>${escXml(date)}</DATE><VOUCHERTYPENAME>${escXml(vchType)}</VOUCHERTYPENAME><VOUCHERNUMBER>${escXml(voucherNumber)}</VOUCHERNUMBER>` +
    `</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

/** Map a CAFlow invoices row (+ line_items) -> VoucherInput. */
function invoiceToVoucherInput(row, opts) {
  const num = (x) => Number(x || 0) || 0;
  const resolveIncome = opts.resolveIncome || defaultResolveIncome;
  const cgst = num(row.total_cgst), sgst = num(row.total_sgst), igst = num(row.total_igst);
  const total = num(row.total_amount);
  let lines = Array.isArray(row.line_items) ? row.line_items : [];
  if (typeof row.line_items === 'string') { try { lines = JSON.parse(row.line_items); } catch { lines = []; } }

  const byLedger = new Map();
  const narrParts = [];
  let taxableSum = 0;
  lines.forEach((li, i) => {
    const tv = num(li.taxable_value != null ? li.taxable_value : li.rate);
    taxableSum += tv;
    const led = resolveIncome(String(li.description || ''), i);
    byLedger.set(led, round2((byLedger.get(led) || 0) + tv));
    const desc = String(li.description || '').trim();
    const det = String(li.description_details || '').trim();
    if (desc) narrParts.push(`${desc}${det ? ` (${det})` : ''} ₹${formatInr(tv)}`);
  });
  if (byLedger.size === 0) { byLedger.set(resolveIncome('', 0), num(row.subtotal)); taxableSum = num(row.subtotal); }

  const incomeLines = [...byLedger].map(([ledger, amount]) => ({ ledger, amount }));
  const roundOff = round2(total - (taxableSum + cgst + sgst + igst));
  const date = String(row.invoice_date || '').slice(0, 10).replace(/-/g, '');
  const narration = narrParts.length ? narrParts.join(' + ') : `Being ${row.document_type === 'credit_note' ? 'credit note' : 'invoice'} ${row.invoice_no}`;

  return {
    documentType: row.document_type === 'credit_note' ? 'credit_note' : 'invoice',
    companyName: opts.companyName,
    voucherNumber: String(row.invoice_no || ''),
    date,
    partyLedger: opts.partyLedger,
    cafId: String(row.id || ''),
    narration,
    incomeLines, cgst, sgst, igst, roundOff, total,
    gstLedgers: opts.gstLedgers,
    party: opts.party,
  };
}

module.exports = {
  buildVoucherXml, buildEntries, entriesImbalance, invoiceToVoucherInput,
  buildDeleteByRemoteId, buildJournalXml, formatInr, escXml, defaultResolveIncome,
};
