/**
 * tally-billing.js — CAFlow <-> Tally BILLING sync agent (Phase 1 forward + Phase 2 reverse)
 *
 * Runs ON the firm's PC (only place that can reach Tally's localhost:9000).
 *
 *   FORWARD (push):  reads tally_sync_queue (invoices/CNs the user queued in CAFlow),
 *                    fetches each party's GST from the Tally MASTER, generates the
 *                    invoice-mode voucher (bifurcated income + break-up narration +
 *                    REMOTEID), posts DELETE-by-REMOTEID -> CREATE (idempotent),
 *                    writes tally_voucher_log + queue status.
 *
 *   REVERSE (pull-receipts): pulls bank/cash Receipt vouchers from Tally, classifies
 *                    legs (party / bank / TDS), dedupes by Tally GUID, matches the
 *                    party ledger to a CAFlow client, and stages them in
 *                    tally_receipt_staging. Matched rows can be imported into billing
 *                    via the post_receipt RPC (--auto-import, or a review UI).
 *
 * Usage:
 *   node src/tally-billing.js push            # forward: process the sync queue
 *   node src/tally-billing.js pull-receipts   # reverse: stage Tally receipts
 *   node src/tally-billing.js pull-receipts --auto-import   # + import confident matches
 *   node src/tally-billing.js status          # show queue + staging counts
 *
 * Env (.env): SUPABASE_URL, SUPABASE_SERVICE_KEY, FIRM_ID, TALLY_HOST, TALLY_PORT,
 *             TALLY_COMPANY (optional override; else read from tally_firm_companies).
 */

require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const {
  buildVoucherXml, invoiceToVoucherInput, buildDeleteByRemoteId, defaultResolveIncome, escXml,
} = require('./voucher-xml');

// ---- config ----------------------------------------------------------------
const CFG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  firmId: process.env.FIRM_ID,
  tallyUrl: `http://${process.env.TALLY_HOST || 'localhost'}:${process.env.TALLY_PORT || 9000}`,
  companyOverride: process.env.TALLY_COMPANY || null,
  gstLedgers: { output_cgst: 'Output CGST', output_sgst: 'Output SGST', output_igst: 'Output IGST', round_off: 'Round Off' },
};

// ---- Tally IO (encoding-safe) ----------------------------------------------
async function postXml(xml) {
  const res = await axios.post(CFG.tallyUrl, xml, {
    headers: { 'Content-Type': 'text/xml;charset=utf-8' },
    timeout: 60000, responseType: 'arraybuffer', validateStatus: () => true,
  });
  const b = Buffer.from(res.data);
  const utf16 = b.length > 1 && b[1] === 0;          // UTF-16LE if 2nd byte is null
  return b.toString(utf16 ? 'utf16le' : 'utf8');
}
function parseImport(text) {
  const g = (t) => { const m = text.match(new RegExp(`<${t}>\\s*(-?\\d+)`)); return m ? +m[1] : 0; };
  return {
    created: g('CREATED'), altered: g('ALTERED'), deleted: g('DELETED'),
    lastVch: (text.match(/<LASTVCHID>\s*(\d+)/) || [])[1] || null,
    error: (text.match(/<LINEERROR>([^<]*)/) || [])[1] || null,
  };
}
// full-company voucher collection with retry-until-complete (Tally truncates under load)
async function fetchVouchers(fetchFields) {
  const q = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>C</ID></HEADER>` +
    `<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>` +
    `<TDL><TDLMESSAGE><COLLECTION NAME="C" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>${fetchFields}</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
  let xml = '';
  for (let i = 0; i < 6; i++) { xml = await postXml(q); if ((xml.match(/<VOUCHER\s/g) || []).length > 30) break; }
  return xml;
}
async function fetchLedgerGst(company, ledgerName) {
  const q = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>L</ID></HEADER>` +
    `<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${escXml(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` +
    `<TDL><TDLMESSAGE><COLLECTION NAME="L" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name,Parent,LedStateName,PartyGSTIN,GSTRegistrationType</FETCH>` +
    `<FILTER>fLed</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="fLed">$$IsEqual:$Name:"${escXml(ledgerName.replace(/"/g, ''))}"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
  const xml = await postXml(q);
  const b = (xml.match(/<LEDGER\s[\s\S]*?<\/LEDGER>/) || [])[0] || '';
  const get = (t) => ((b.match(new RegExp(`<${t}[^>]*>([^<]*)<`)) || [])[1] || '').trim();
  const gstin = get('PARTYGSTIN');
  return {
    state: get('LEDSTATENAME') || null,
    gstin: gstin || null,
    regType: get('GSTREGISTRATIONTYPE') || (gstin ? 'Regular' : 'Unregistered'),
    found: !!b,
  };
}
async function fetchLedgerGroups(company) {
  const q = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>L</ID></HEADER>` +
    `<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${escXml(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` +
    `<TDL><TDLMESSAGE><COLLECTION NAME="L" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name,Parent</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
  let xml = '';
  for (let i = 0; i < 5; i++) { xml = await postXml(q); if ((xml.match(/<LEDGER\s/g) || []).length > 100) break; }
  const map = new Map();
  for (const m of xml.matchAll(/<LEDGER\s([^>]*)>([\s\S]*?)<\/LEDGER>/g)) {
    const name = ((m[1].match(/NAME="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');
    const parent = ((m[2].match(/<PARENT[^>]*>([^<]*)</) || [])[1] || '').replace(/&amp;/g, '&').trim();
    if (name) map.set(name, parent);
  }
  return map;
}

// ---- FORWARD: process the outbound queue -----------------------------------
async function resolveBillingCompany(sb) {
  if (CFG.companyOverride) return CFG.companyOverride;
  const { data } = await sb.from('tally_firm_companies')
    .select('tally_company_name').eq('firm_id', CFG.firmId).eq('is_active', true).maybeSingle();
  if (!data) throw new Error('No active tally_firm_companies row for firm ' + CFG.firmId + ' (set TALLY_COMPANY in .env).');
  return data.tally_company_name;
}
async function resolvePartyLedger(sb, clientId, clientName) {
  const { data } = await sb.from('tally_party_map')
    .select('tally_ledger_name,status').eq('firm_id', CFG.firmId).eq('client_id', clientId).maybeSingle();
  if (data && data.status === 'approved' && data.tally_ledger_name) return data.tally_ledger_name;
  return clientName; // fall back to the client's own name (V J Desai debtors == client names)
}

async function processForwardQueue(sb, company) {
  const { data: queue, error } = await sb.from('tally_sync_queue')
    .select('*').eq('firm_id', CFG.firmId).eq('direction', 'forward')
    .in('status', ['pending', 'failed']).lt('attempts', 3).order('requested_at');
  if (error) throw error;
  if (!queue || !queue.length) { console.log('  forward: queue empty.'); return; }
  console.log(`  forward: ${queue.length} queued.`);

  // Load the company's ledger names once, so we can resolve the EXACT Tally casing
  // for a party (CAFlow stores names uppercased; Tally lookups are case-sensitive).
  const groups = await fetchLedgerGroups(company);
  const ciLedger = new Map([...groups.keys()].map((n) => [n.toLowerCase(), n]));

  for (const q of queue) {
    await sb.from('tally_sync_queue').update({ status: 'processing', attempts: q.attempts + 1 }).eq('id', q.id);
    try {
      const { data: inv } = await sb.from('invoices').select('*').eq('id', q.invoice_id).single();
      const { data: client } = await sb.from('clients').select('id,name').eq('id', inv.client_id).single();
      const candidate = await resolvePartyLedger(sb, client.id, client.name);
      const partyLedger = ciLedger.get(String(candidate).toLowerCase()) || candidate; // exact Tally casing
      const party = await fetchLedgerGst(company, partyLedger);
      const vi = invoiceToVoucherInput(inv, {
        companyName: company, partyLedger, gstLedgers: CFG.gstLedgers,
        resolveIncome: defaultResolveIncome, party: party.found ? party : undefined,
      });
      const remoteId = `CAFLOW-${inv.id}`;
      const vchType = inv.document_type === 'credit_note' ? 'Credit Note' : 'Sales';
      // idempotent: delete-by-REMOTEID (no-op first time) then create
      await postXml(buildDeleteByRemoteId(company, vchType, vi.date, vi.voucherNumber, remoteId));
      const resp = parseImport(await postXml(buildVoucherXml(vi)));
      if (resp.error) throw new Error(resp.error);

      await sb.from('tally_sync_queue').update({
        status: 'done', tally_vch_id: resp.lastVch, last_error: null, processed_at: new Date().toISOString(),
      }).eq('id', q.id);
      await sb.from('tally_voucher_log').upsert({
        firm_id: CFG.firmId, invoice_id: inv.id, tally_company_name: company,
        voucher_number: vi.voucherNumber, tally_vch_id: resp.lastVch, direction: 'forward', status: 'created',
      }, { onConflict: 'invoice_id,tally_company_name,direction' });
      console.log(`    OK ${vi.voucherNumber} -> vch#${resp.lastVch} (party ${party.found ? 'GST from master' : 'no master'})`);
    } catch (e) {
      await sb.from('tally_sync_queue').update({ status: 'failed', last_error: String(e.message || e) }).eq('id', q.id);
      console.log(`    FAIL ${q.document_no || q.invoice_id}: ${e.message || e}`);
    }
  }
}

// ---- REVERSE: pull bank/cash Receipts, stage, match ------------------------
function isBankOrCash(parent) { return /bank|cash/i.test(parent || ''); }
function isTds(name) { return /\btds\b|tax deduct/i.test(name || ''); }

function parseReceiptVouchers(xml, groups) {
  const out = [];
  for (const m of xml.matchAll(/<VOUCHER\s([^>]*)>([\s\S]*?)<\/VOUCHER>/g)) {
    if (!m[1].includes('VCHTYPE="Receipt"')) continue;
    const b = m[2];
    const guid = (b.match(/<GUID>([^<]*)</) || [])[1] || '';
    if (!guid) continue;
    const number = (b.match(/<VOUCHERNUMBER>([^<]*)</) || [])[1] || '';
    const dateRaw = (b.match(/<DATE>([^<]*)</) || [])[1] || '';
    const voucher_date = dateRaw.length === 8 ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}` : null;
    const narration = (b.match(/<NARRATION>([^<]*)</) || [])[1] || '';
    const legs = [];
    for (const le of b.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)) {
      const ln = ((le[1].match(/<LEDGERNAME>([^<]*)</) || [])[1] || '').replace(/&amp;/g, '&');
      const am = parseFloat((le[1].match(/<AMOUNT>(-?[\d.]+)</) || [])[1] || '0');
      if (ln) legs.push({ ledger: ln, amount: am, parent: groups.get(ln) || '' });
    }
    let bank = null, tds = 0, party = null;
    for (const l of legs) {
      if (isBankOrCash(l.parent)) { if (!bank || Math.abs(l.amount) > Math.abs(bank.amount)) bank = l; }
      else if (isTds(l.ledger)) tds += Math.abs(l.amount);
      else if (l.amount > 0) { if (!party || l.amount > party.amount) party = l; } // debtor credited (positive)
    }
    if (!party) continue; // not a party receipt (e.g. capital/other) -> skip
    out.push({
      tally_guid: guid, voucher_number: number, voucher_date,
      party_ledger: party.ledger, bank_ledger: bank ? bank.ledger : null,
      amount: bank ? Math.abs(bank.amount) : party.amount, tds_amount: tds,
      narration, raw: { legs },
    });
  }
  return out;
}

async function matchPartyToClient(sb, partyLedger) {
  // 1) approved tally_party_map by ledger name
  const { data: mapRow } = await sb.from('tally_party_map')
    .select('client_id,status').eq('firm_id', CFG.firmId).ilike('tally_ledger_name', partyLedger).maybeSingle();
  if (mapRow && mapRow.status === 'approved' && mapRow.client_id) return { clientId: mapRow.client_id, method: 'manual', conf: 100 };
  // 2) exact client-name match
  const { data: exact } = await sb.from('clients')
    .select('id,name').eq('firm_id', CFG.firmId).ilike('name', partyLedger).limit(2);
  if (exact && exact.length === 1) return { clientId: exact[0].id, method: 'name_exact', conf: 95 };
  return { clientId: null, method: 'unmatched', conf: 0 };
}

async function pullAndStageReceipts(sb, company, autoImport) {
  const groups = await fetchLedgerGroups(company);
  const xml = await fetchVouchers('VoucherTypeName,VoucherNumber,Date,Guid,Narration,AllLedgerEntries');
  const receipts = parseReceiptVouchers(xml, groups);
  console.log(`  reverse: ${receipts.length} party-receipts found in Tally.`);
  let staged = 0, matched = 0, imported = 0, dup = 0;
  for (const r of receipts) {
    // dedupe by GUID
    const { data: existing } = await sb.from('tally_receipt_staging')
      .select('id,status').eq('firm_id', CFG.firmId).eq('tally_guid', r.tally_guid).maybeSingle();
    if (existing) { dup++; continue; }
    const mt = await matchPartyToClient(sb, r.party_ledger);
    if (mt.clientId) matched++;
    const row = {
      firm_id: CFG.firmId, tally_company_name: company, tally_guid: r.tally_guid,
      voucher_number: r.voucher_number, voucher_date: r.voucher_date, party_ledger: r.party_ledger,
      bank_ledger: r.bank_ledger, amount: r.amount, tds_amount: r.tds_amount, narration: r.narration,
      matched_client_id: mt.clientId, match_method: mt.method, match_confidence: mt.conf,
      status: mt.clientId ? 'matched' : 'pending', raw: r.raw,
    };
    const { data: ins, error: insErr } = await sb.from('tally_receipt_staging').insert(row).select('id').single();
    if (insErr) { console.log(`    stage FAIL ${r.voucher_number}: ${insErr.message}`); continue; }
    staged++;
    if (autoImport && mt.clientId && mt.conf >= 95) {
      try { await importStagedReceipt(sb, { ...row, id: ins.id }); imported++; }
      catch (e) { await sb.from('tally_receipt_staging').update({ status: 'failed', error: String(e.message || e) }).eq('id', ins.id); }
    }
  }
  console.log(`  reverse: staged ${staged} (matched ${matched}, imported ${imported}), skipped ${dup} dup.`);
}

async function importStagedReceipt(sb, s) {
  const fy = fyFromDate(s.voucher_date);
  const { data: receiptId, error } = await sb.rpc('post_receipt', {
    p_firm_id: CFG.firmId, p_client_id: s.matched_client_id, p_invoice_id: null,
    p_receipt_type: 'on_account', p_receipt_date: s.voucher_date, p_amount: Number(s.amount),
    p_payment_mode: /cash/i.test(s.bank_ledger || '') ? 'cash' : 'bank',
    p_payment_reference: s.voucher_number || null, p_tds: Number(s.tds_amount) || 0, p_gst_tds: 0,
    p_tds_date: Number(s.tds_amount) > 0 ? s.voucher_date : null,
    p_remarks: `Auto-imported from Tally receipt ${s.voucher_number} [${s.tally_guid}]`,
    p_gstin: null, p_created_by: null, p_financial_year: fy,
  });
  if (error) throw error;
  await sb.from('tally_receipt_staging').update({ status: 'imported', receipt_id: receiptId, imported_at: new Date().toISOString() }).eq('id', s.id);
}
function fyFromDate(d) {
  const [y, m] = String(d).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

// ---- CLI -------------------------------------------------------------------
async function main() {
  const cmd = process.argv[2] || 'status';
  const autoImport = process.argv.includes('--auto-import');
  if (!CFG.supabaseUrl || !CFG.supabaseKey || !CFG.firmId) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / FIRM_ID in .env'); process.exit(1);
  }
  const sb = createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false } });
  const company = await resolveBillingCompany(sb);
  console.log(`Tally billing sync | firm ${CFG.firmId} | company "${company}" | ${CFG.tallyUrl}`);

  if (cmd === 'push') await processForwardQueue(sb, company);
  else if (cmd === 'pull-receipts') await pullAndStageReceipts(sb, company, autoImport);
  else if (cmd === 'status') {
    const { count: qn } = await sb.from('tally_sync_queue').select('*', { count: 'exact', head: true }).eq('firm_id', CFG.firmId).eq('status', 'pending');
    const { count: rn } = await sb.from('tally_receipt_staging').select('*', { count: 'exact', head: true }).eq('firm_id', CFG.firmId).eq('status', 'matched');
    console.log(`  queue pending: ${qn || 0} | staged receipts awaiting import (matched): ${rn || 0}`);
  } else { console.error('Unknown command. Use: push | pull-receipts | status'); process.exit(1); }
  console.log('Done.');
}
if (require.main === module) main().catch((e) => { console.error('FATAL:', e.message || e); process.exit(1); });

module.exports = {
  postXml, parseImport, fetchLedgerGst, fetchLedgerGroups, fetchVouchers,
  parseReceiptVouchers, matchPartyToClient, processForwardQueue, pullAndStageReceipts,
};
