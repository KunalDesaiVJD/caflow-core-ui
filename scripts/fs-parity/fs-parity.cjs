#!/usr/bin/env node
/*
 * FS Parity Harness — Phase 0 safety net for the COA->Notes->Face remediation.
 *
 * WHY: §11 of docs/fs-remediation/REMEDIATION-RULES.md forbids flipping any
 * figure-moving flag until a zero-delta parity run over all live engagements
 * passes. This script captures the *persisted figure layer* (the rows that
 * actually drive the BS/PL face) and diffs two captures.
 *
 * It is deliberately ENGINE-FREE: it does NOT recompute note totals (that would
 * just be a second engine). It snapshots raw persisted rows and compares them.
 *   - figure-neutral change  => diff must report ZERO changed figures.
 *   - figure-moving change    => diff lists exactly which engagement/note/code
 *                                moved, old -> new, so it can be signed off.
 *
 * SECRETS: reads .env.local at runtime (same as probe-ambica.cjs). No secret is
 * stored in this file. Run from a repo checkout that has node_modules + .env.local.
 *
 * USAGE:
 *   node scripts/fs-parity/fs-parity.cjs capture baseline.json [--client "name"] [--engagement <id>]
 *   node scripts/fs-parity/fs-parity.cjs diff baseline.json after.json [--tol 0.005]
 *
 * Exit code of `diff` is 1 if ANY figure changed (handy for a CI/parity gate).
 */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const p = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) {
    console.error('ERROR: .env.local not found in', process.cwd(), '- run from the repo root.');
    process.exit(2);
  }
  return fs.readFileSync(p, 'utf8').split('\n').reduce((a, l) => {
    const i = l.indexOf('=');
    if (i > 0) a[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    return a;
  }, {});
}

function makeClient() {
  const { createClient } = require('@supabase/supabase-js');
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error('ERROR: VITE_SUPABASE_URL / key missing in .env.local'); process.exit(2); }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('WARN: no SUPABASE_SERVICE_ROLE_KEY — using anon key; RLS may hide rows and break parity coverage.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }

async function fetchAll(sb, table, columns, eqCol, eqVal) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = sb.from(table).select(columns).range(from, from + page - 1);
    if (eqCol) q = q.eq(eqCol, eqVal);
    const { data, error } = await q;
    if (error) { if (from === 0) return { rows: null, error: error.message }; break; }
    rows.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return { rows, error: null };
}

// Collect numeric leaves of an arbitrary JSON value, keyed by dotted path.
function numericLeaves(val, prefix, out) {
  if (val == null) return out;
  if (typeof val === 'number') { out[prefix || '.'] = val; return out; }
  if (Array.isArray(val)) { val.forEach((v, i) => numericLeaves(v, prefix + '[' + i + ']', out)); return out; }
  if (typeof val === 'object') { for (const k of Object.keys(val)) numericLeaves(val[k], prefix ? prefix + '.' + k : k, out); return out; }
  return out;
}

function diffNumeric(a, b, tol) {
  const la = numericLeaves(a, '', {}), lb = numericLeaves(b, '', {});
  const changes = [];
  const keys = new Set([...Object.keys(la), ...Object.keys(lb)]);
  for (const k of keys) {
    const x = la[k], y = lb[k];
    if (x === undefined && y === undefined) continue;
    if (x === undefined) { changes.push({ path: k, from: null, to: y }); continue; }
    if (y === undefined) { changes.push({ path: k, from: x, to: null }); continue; }
    if (Math.abs(x - y) > tol) changes.push({ path: k, from: x, to: y });
  }
  return changes;
}

async function capture(outPath, opts) {
  const sb = makeClient();
  let engQ = sb.from('audit_engagements').select('id,client_id,financial_year,is_py_shell,status,coa_mapping');
  if (opts.engagement) engQ = engQ.eq('id', opts.engagement);
  const { data: engs, error: engErr } = await engQ;
  if (engErr) { console.error('ERROR reading audit_engagements:', engErr.message); process.exit(2); }
  const { data: clients } = await sb.from('clients').select('id,name');
  const nameById = Object.fromEntries((clients || []).map(c => [c.id, c.name]));

  let list = engs || [];
  if (opts.client) list = list.filter(e => (nameById[e.client_id] || '').toLowerCase().includes(opts.client.toLowerCase()));

  const out = { capturedNote: 'persisted figure layer; compare with `diff`', engagementCount: list.length, engagements: [] };
  for (const e of list) {
    const fnotes = await fetchAll(sb, 'nce_financial_notes', '*', 'engagement_id', e.id);
    const fa = await fetchAll(sb, 'fa_financial_statements', '*', 'engagement_id', e.id);
    const s5 = await fetchAll(sb, 'stage5_notes', '*', 'engagement_id', e.id);
    out.engagements.push({
      id: e.id,
      client: nameById[e.client_id] || e.client_id,
      fy: e.financial_year,
      is_py_shell: e.is_py_shell,
      status: e.status,
      coa_fingerprint: djb2(JSON.stringify(e.coa_mapping || {})),
      tables: {
        nce_financial_notes: fnotes.error ? { error: fnotes.error } : fnotes.rows,
        fa_financial_statements: fa.error ? { error: fa.error } : fa.rows,
        stage5_notes: s5.error ? { error: s5.error } : s5.rows,
      },
    });
    process.stderr.write('.');
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.error('\nCaptured ' + list.length + ' engagement(s) -> ' + outPath);
}

function indexRows(rows, keyFn) {
  const m = {};
  if (!Array.isArray(rows)) return m;
  for (const r of rows) m[keyFn(r)] = r;
  return m;
}

function diff(aPath, bPath, tol) {
  const A = JSON.parse(fs.readFileSync(aPath, 'utf8'));
  const B = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  const Bby = Object.fromEntries(B.engagements.map(e => [e.id, e]));
  let totalChanges = 0;
  const report = [];

  for (const ea of A.engagements) {
    const eb = Bby[ea.id];
    if (!eb) { report.push(`ENGAGEMENT REMOVED: ${ea.client} ${ea.fy} (${ea.id})`); totalChanges++; continue; }
    const lines = [];
    if (ea.coa_fingerprint !== eb.coa_fingerprint) lines.push(`  coa_mapping CHANGED (fingerprint ${ea.coa_fingerprint} -> ${eb.coa_fingerprint})`);

    // fa_financial_statements: scalar amount columns
    const faA = indexRows(ea.tables.fa_financial_statements, r => r.line_item_code);
    const faB = indexRows(eb.tables.fa_financial_statements, r => r.line_item_code);
    for (const code of new Set([...Object.keys(faA), ...Object.keys(faB)])) {
      const x = faA[code], y = faB[code];
      if (!x) { lines.push(`  fa[${code}] ADDED cy=${y.amount_cy} py=${y.amount_py}`); totalChanges++; continue; }
      if (!y) { lines.push(`  fa[${code}] REMOVED cy=${x.amount_cy} py=${x.amount_py}`); totalChanges++; continue; }
      if (Math.abs((x.amount_cy || 0) - (y.amount_cy || 0)) > tol) { lines.push(`  fa[${code}].cy ${x.amount_cy} -> ${y.amount_cy}`); totalChanges++; }
      if (Math.abs((x.amount_py || 0) - (y.amount_py || 0)) > tol) { lines.push(`  fa[${code}].py ${x.amount_py} -> ${y.amount_py}`); totalChanges++; }
      if (!!x.is_manual !== !!y.is_manual) lines.push(`  fa[${code}].is_manual ${x.is_manual} -> ${y.is_manual}`);
    }

    // nce_financial_notes: deep numeric diff of cy_data / py_data
    const nA = indexRows(ea.tables.nce_financial_notes, r => r.note_type + '|' + (r.financial_year || ''));
    const nB = indexRows(eb.tables.nce_financial_notes, r => r.note_type + '|' + (r.financial_year || ''));
    for (const k of new Set([...Object.keys(nA), ...Object.keys(nB)])) {
      const x = nA[k], y = nB[k];
      if (!x) { lines.push(`  note[${k}] ADDED (orphan/new note_type)`); totalChanges++; continue; }
      if (!y) { lines.push(`  note[${k}] REMOVED`); totalChanges++; continue; }
      for (const col of ['cy_data', 'py_data']) {
        const ch = diffNumeric(x[col], y[col], tol);
        for (const c of ch) { lines.push(`  note[${k}].${col} ${c.path}: ${c.from} -> ${c.to}`); totalChanges++; }
      }
    }

    // stage5_notes: deep numeric diff of the whole blob (corporate)
    const sA = (ea.tables.stage5_notes && ea.tables.stage5_notes[0]) || null;
    const sB = (eb.tables.stage5_notes && eb.tables.stage5_notes[0]) || null;
    if (sA || sB) {
      const ch = diffNumeric(sA, sB, tol);
      for (const c of ch.slice(0, 200)) { lines.push(`  stage5 ${c.path}: ${c.from} -> ${c.to}`); totalChanges++; }
      if (ch.length > 200) lines.push(`  stage5 ... +${ch.length - 200} more changed leaves`);
    }

    if (lines.length) report.push(`\n${ea.client} ${ea.fy} (${ea.id}):\n` + lines.join('\n'));
  }
  for (const eb of B.engagements) if (!A.engagements.find(e => e.id === eb.id)) { report.push(`ENGAGEMENT ADDED: ${eb.client} ${eb.fy}`); totalChanges++; }

  console.log(report.length ? report.join('\n') : '(no row-level differences)');
  console.log(`\n=== PARITY RESULT: ${totalChanges} changed figure(s) across ${A.engagements.length} engagement(s) ===`);
  console.log(totalChanges === 0 ? 'PASS — zero delta (figure-neutral).' : 'FIGURES MOVED — review each change above and sign off before flipping any flag (§11).');
  process.exit(totalChanges === 0 ? 0 : 1);
}

function parseOpts(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--client') o.client = args[++i];
    else if (args[i] === '--engagement') o.engagement = args[++i];
    else if (args[i] === '--tol') o.tol = parseFloat(args[++i]);
  }
  return o;
}

(async () => {
  const [, , mode, a, b] = process.argv;
  const flags = parseOpts(process.argv.slice(2));
  if (mode === 'capture') {
    if (!a) { console.error('usage: capture <out.json> [--client name] [--engagement id]'); process.exit(2); }
    await capture(a, flags);
  } else if (mode === 'diff') {
    if (!a || !b) { console.error('usage: diff <baseline.json> <after.json> [--tol 0.005]'); process.exit(2); }
    diff(a, b, flags.tol != null ? flags.tol : 0.005);
  } else {
    console.error('FS Parity Harness\n  capture <out.json> [--client name] [--engagement id]\n  diff <baseline.json> <after.json> [--tol 0.005]');
    process.exit(2);
  }
})();
