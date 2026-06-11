/**
 * ecosystem_full_g.mjs — Pattern G for ALL missing/empty notes, including
 * inserting new nce_financial_notes rows for engagements that lack them.
 *
 * Uses cache from ecosystem_fix.mjs for engagement list + COA totals.
 * Fetches TB ledger detail in bulk for ALL drifted (eng × note) pairs.
 */
import { execSync } from "child_process";
import { writeFileSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";

const LOG = join(process.cwd(), "ecosystem_full_g.log");
try { writeFileSync(LOG, ""); } catch {}
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG, line); } catch {}
}

const cache = JSON.parse(readFileSync(join(process.cwd(),"_ecosys_cache.json"),"utf-8"));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => n == null ? "-" : Number(n).toLocaleString("en-IN",{maximumFractionDigits:0});
const norm = (s) => String(s||"").toLowerCase().replace(/[^a-z0-9]/g, "");

const NOTE_DEFS_BY_KEY = {
  borrowings:{nature:"CR",section:"BS-Liab",codes:["NCE_LTB","BS_NCL_LTB","NCE_STB","BS_CL_STB"]},
  other_lt_liab:{nature:"CR",section:"BS-Liab",codes:["NCE_OLTL","BS_NCL_OLT","BS_NCL_DTL"]},
  provisions:{nature:"CR",section:"BS-Liab",codes:["NCE_LTP","BS_NCL_LTP","NCE_STP","BS_CL_STP"]},
  trade_payables:{nature:"CR",section:"BS-Liab",codes:["NCE_TP","BS_CL_TP","BS_CL_TP_MSME","BS_CL_TP_OTH"]},
  other_cl:{nature:"CR",section:"BS-Liab",codes:["NCE_OCL","BS_CL_OCL"]},
  investments:{nature:"DR",section:"BS-Asst",codes:["NCE_NCINV","BS_NCA_INV","NCE_CINV","BS_CA_CI"]},
  loans_advances:{nature:"DR",section:"BS-Asst",codes:["NCE_LTLA","BS_NCA_LLA","NCE_STLA","BS_CA_SLA"]},
  other_nc_assets:{nature:"DR",section:"BS-Asst",codes:["NCE_ONCA","BS_NCA_ONA","BS_NCA_DTA"]},
  inventories:{nature:"DR",section:"BS-Asst",codes:["NCE_STCK","BS_CA_INV","INV_RM","INV_WIP","INV_FG","INV_STT","INV_STOCK"]},
  trade_receivables:{nature:"DR",section:"BS-Asst",codes:["NCE_TR","BS_CA_TR"]},
  cash_bank:{nature:"DR",section:"BS-Asst",codes:["NCE_CASH","BS_CA_CCE"]},
  other_ca:{nature:"DR",section:"BS-Asst",codes:["NCE_OCA","BS_CA_OCA"]},
  revenue_ops:{nature:"CR",section:"PL-Inc",codes:["NCE_REV_OPS","PL_REV_OPS"]},
  other_income:{nature:"CR",section:"PL-Inc",codes:["NCE_REV_OTH","PL_REV_OI"]},
  employee_exp:{nature:"DR",section:"PL-Exp",codes:["NCE_EMP_EXP","PL_EXP_EMP"]},
  finance_costs:{nature:"DR",section:"PL-Exp",codes:["NCE_FIN_COST","PL_EXP_FIN"]},
  other_expenses:{nature:"DR",section:"PL-Exp",codes:["NCE_OTH_EXP","PL_EXP_OTH","PL_EXP_OEX"]},
};
const isPL = (s) => s.startsWith("PL");

function dbQuery(sql) {
  const tmp = join(process.cwd(),"_efg_q.sql");
  writeFileSync(tmp, sql, "utf-8");
  const raw = execSync(`npx supabase db query --linked -f "${tmp}"`, { encoding:"utf-8", maxBuffer:400*1024*1024, timeout:300_000, stdio:["ignore","pipe","pipe"] });
  const i = raw.indexOf("{");
  return JSON.parse(raw.slice(i)).rows ?? [];
}
function asObj(v) { if (v==null) return {}; if (typeof v==="string") { try { return JSON.parse(v)||{}; } catch { return {}; } } return typeof v==="object"?v:{}; }
function sumKeys(obj) { let s=0; for (const [k,v] of Object.entries(obj)) { if (k.startsWith("_")) continue; const n = typeof v==="number"?v:(typeof v==="string"&&/^-?\d+(\.\d+)?$/.test(v.trim())?Number(v):null); if (n!==null) s += n; } return r2(s); }

const codeList = (codes) => codes.map(c=>`'${c}'`).join(",");
function signedSumExpr(balCol, nature) {
  if (nature === "DR") return `CASE WHEN upper(t.${balCol})='DR' THEN abs(t.closing_balance) WHEN upper(t.${balCol})='CR' THEN -abs(t.closing_balance) ELSE -abs(t.closing_balance) END`;
  return `CASE WHEN upper(t.${balCol})='CR' THEN abs(t.closing_balance) WHEN upper(t.${balCol})='DR' THEN -abs(t.closing_balance) ELSE abs(t.closing_balance) END`;
}
function signedSumExprOpening(nature) {
  if (nature === "DR") return `CASE WHEN upper(t.opening_type)='DR' THEN abs(t.opening_balance) WHEN upper(t.opening_type)='CR' THEN -abs(t.opening_balance) ELSE -abs(t.opening_balance) END`;
  return `CASE WHEN upper(t.opening_type)='CR' THEN abs(t.opening_balance) WHEN upper(t.opening_type)='DR' THEN -abs(t.opening_balance) ELSE abs(t.opening_balance) END`;
}

// Step 1: load existing notes
log("Loading existing notes...");
const NOTE_KEYS = Object.keys(NOTE_DEFS_BY_KEY);
const noteRows = dbQuery(`SELECT engagement_id, note_type, cy_data, py_data FROM nce_financial_notes WHERE note_type IN (${NOTE_KEYS.map(k=>`'${k}'`).join(",")});`);
log(`  ${noteRows.length} note rows fetched`);
const noteIndex = {};
for (const r of noteRows) (noteIndex[r.note_type] ??= {})[r.engagement_id] = r;

// Step 2: compute current drift per cell (using cached COA)
log("Computing drift per cell...");
const driftCells = []; // { eng, noteType, def, hasRow, cy, py, noteCy, notePy, coaCyVal, coaPyVal, cyDrift, pyDrift }
const engById = {};
for (const e of cache.engagements) engById[e.id] = e;
for (const eng of cache.engagements) {
  for (const noteType of NOTE_KEYS) {
    const def = NOTE_DEFS_BY_KEY[noteType];
    const noteRow = (noteIndex[noteType]||{})[eng.id];
    const cy = asObj(noteRow?.cy_data);
    const py = asObj(noteRow?.py_data);
    const noteCy = sumKeys(cy);
    const notePy = sumKeys(py);
    const coaCyVal = cache.coaCy[noteType]?.[eng.id] ?? 0;
    const coaPyVal = isPL(def.section) ? (eng._shellId ? (cache.coaPy[noteType]?.[eng.id] ?? 0) : null) : (cache.coaPy[noteType]?.[eng.id] ?? 0);
    const cyDrift = r2(coaCyVal - noteCy);
    const pyDrift = coaPyVal === null ? null : r2(coaPyVal - notePy);
    if (Math.abs(cyDrift) > 1 || (pyDrift !== null && Math.abs(pyDrift) > 1)) {
      driftCells.push({ eng, noteType, def, hasRow: !!noteRow, cy, py, noteCy, notePy, coaCyVal, coaPyVal, cyDrift, pyDrift });
    }
  }
}
log(`  Drifted cells: ${driftCells.length}`);

// Step 3: fetch TB ledger detail for ALL drift cells in bulk per note_type
log("Fetching TB ledger detail in bulk...");
const ledgerDetail = {}; // engId__noteType -> { cy:[], py:[] }
const driftByNote = {};
for (const c of driftCells) (driftByNote[c.noteType] ??= []).push(c);

for (const [noteType, cells] of Object.entries(driftByNote)) {
  const def = NOTE_DEFS_BY_KEY[noteType];
  const codes = codeList(def.codes);
  const engIds = [...new Set(cells.map(c => c.eng.id))];
  // CY in bulk
  const cyExpr = signedSumExpr("balance_type", def.nature);
  const cyRows = dbQuery(`
    SELECT t.engagement_id as eng, t.ledger_name as l,
      upper(t.balance_type) as bt,
      round((${cyExpr})::numeric,2) as amt
    FROM tally_trial_balance t, audit_engagements e
    WHERE t.engagement_id IN (${engIds.map(i=>`'${i}'`).join(",")})
      AND e.id = t.engagement_id
      AND (e.coa_mapping->t.ledger_name->>'code') IN (${codes})
      AND abs(t.closing_balance) > 0
  `);
  for (const r of cyRows) {
    const k = `${r.eng}__${noteType}`;
    (ledgerDetail[k] ??= { cy:[], py:[] }).cy.push({ ledger: r.l, bt: r.bt, amt: Number(r.amt) });
  }
  // PY in bulk — BS: from CY TB opening; PL: from PY-shell TB closing
  if (isPL(def.section)) {
    const pyExpr = signedSumExpr("balance_type", def.nature);
    const engsWithShell = cells.filter(c => c.eng._shellId);
    const pairs = engsWithShell.map(c => `('${c.eng.id}'::uuid,'${c.eng._shellId}'::uuid)`);
    if (pairs.length > 0) {
      const CHUNK = 12;
      for (let i=0; i<pairs.length; i+=CHUNK) {
        const slice = pairs.slice(i,i+CHUNK);
        const vals = slice.join(",");
        const pyRows = dbQuery(`
          SELECT p.cy_id as eng, t.ledger_name as l,
            upper(t.balance_type) as bt,
            round((${pyExpr})::numeric,2) as amt
          FROM (VALUES ${vals}) p(cy_id, py_id)
          JOIN audit_engagements cy ON cy.id=p.cy_id
          JOIN audit_engagements py ON py.id=p.py_id
          JOIN tally_trial_balance t ON t.engagement_id=p.py_id
          WHERE coalesce(cy.coa_mapping->t.ledger_name->>'code',
                         py.coa_mapping->t.ledger_name->>'code') IN (${codes})
            AND abs(t.closing_balance) > 0
        `);
        for (const r of pyRows) {
          const k = `${r.eng}__${noteType}`;
          (ledgerDetail[k] ??= { cy:[], py:[] }).py.push({ ledger: r.l, bt: r.bt, amt: Number(r.amt) });
        }
      }
    }
  } else {
    const opExpr = signedSumExprOpening(def.nature);
    const pyRows = dbQuery(`
      SELECT t.engagement_id as eng, t.ledger_name as l,
        upper(t.opening_type) as bt,
        round((${opExpr})::numeric,2) as amt
      FROM tally_trial_balance t, audit_engagements e
      WHERE t.engagement_id IN (${engIds.map(i=>`'${i}'`).join(",")})
        AND e.id = t.engagement_id
        AND (e.coa_mapping->t.ledger_name->>'code') IN (${codes})
        AND abs(t.opening_balance) > 0
    `);
    for (const r of pyRows) {
      const k = `${r.eng}__${noteType}`;
      (ledgerDetail[k] ??= { cy:[], py:[] }).py.push({ ledger: r.l, bt: r.bt, amt: Number(r.amt) });
    }
  }
  log(`  ✓ ${noteType}: ${cells.length} cells, detail collected`);
}

// Step 4: apply Pattern G — synthesize customRows and write/insert
log("\nApplying Pattern G...");
const tmpSqlPath = join(process.cwd(), "_efg_patch.sql");
const events = [];
let cellsTouched = 0, cellsInserted = 0, cellsUpdated = 0;

for (const c of driftCells) {
  const detail = ledgerDetail[`${c.eng.id}__${c.noteType}`];
  if (!detail) continue;
  const customRows = Array.isArray(c.cy._custom_rows) ? c.cy._custom_rows : [];
  const representedNorms = new Set();
  for (const cr of customRows) representedNorms.add(norm(cr.label));
  const srcObj = asObj(c.cy._cy_sources);
  for (const arr of Object.values(srcObj))
    if (Array.isArray(arr)) for (const s of arr) if (s?.ledger) representedNorms.add(norm(s.ledger));

  const missingCy = detail.cy.filter(l => l.amt !== 0 && !representedNorms.has(norm(l.ledger)));
  const missingPy = detail.py.filter(l => l.amt !== 0 && !representedNorms.has(norm(l.ledger)));
  const ledgerByName = new Map();
  for (const l of missingCy) ledgerByName.set(norm(l.ledger), { name: l.ledger, cy: l.amt, py: 0 });
  for (const l of missingPy) {
    const k = norm(l.ledger);
    if (ledgerByName.has(k)) ledgerByName.get(k).py = l.amt;
    else ledgerByName.set(k, { name: l.ledger, cy: 0, py: l.amt });
  }
  if (ledgerByName.size === 0) continue;

  const slug = (s) => String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,40);
  const newRows = [...customRows];
  const newCy = { ...c.cy };
  const newPy = { ...c.py };
  const newSources = asObj(c.cy._cy_sources);
  let i = customRows.length;
  const addedRows = [];

  for (const [normLedger, info] of ledgerByName) {
    const rowId = `custom_g_${slug(info.name)}_${i}`;
    i++;
    newRows.push({ id: rowId, label: info.name, source: "auto", tbDerived: true });
    newCy[rowId] = info.cy;
    newPy[rowId] = info.py;
    newSources[rowId] = [{ ledger: info.name, amountCy: info.cy, amountPy: info.py }];
    addedRows.push({ rowId, name: info.name, cy: info.cy, py: info.py });
  }
  newCy._custom_rows = newRows;
  newCy._cy_sources = newSources;
  if (!newCy._hidden_rows) newCy._hidden_rows = [];
  if (!newCy._ejected_ledgers) newCy._ejected_ledgers = [];
  if (!newCy._label_overrides) newCy._label_overrides = {};

  const newCyDrift = r2(c.coaCyVal - sumKeys(newCy));
  const newPyDrift = c.coaPyVal === null ? null : r2(c.coaPyVal - sumKeys(newPy));

  // Skip if drift worsens
  const cyImproved = Math.abs(newCyDrift) <= Math.abs(c.cyDrift) + 0.5;
  const pyImproved = c.coaPyVal === null || Math.abs(newPyDrift) <= Math.abs(c.pyDrift) + 0.5;
  if (!cyImproved || !pyImproved) {
    log(`  ✗ skip ${c.eng.client_name}/${c.noteType}: would worsen`);
    continue;
  }

  const cyJsonLit = JSON.stringify(newCy).replace(/'/g, "''");
  const pyJsonLit = JSON.stringify(newPy).replace(/'/g, "''");

  let sql;
  if (c.hasRow) {
    sql = `UPDATE nce_financial_notes SET cy_data='${cyJsonLit}'::jsonb, py_data='${pyJsonLit}'::jsonb WHERE engagement_id='${c.eng.id}' AND note_type='${c.noteType}' RETURNING engagement_id;`;
  } else {
    const fy = c.eng.financial_year.replace(/'/g, "''");
    sql = `INSERT INTO nce_financial_notes (engagement_id, financial_year, note_type, cy_data, py_data) VALUES ('${c.eng.id}', '${fy}', '${c.noteType}', '${cyJsonLit}'::jsonb, '${pyJsonLit}'::jsonb) RETURNING engagement_id;`;
  }
  try {
    writeFileSync(tmpSqlPath, sql, "utf-8");
    const out = execSync(`npx supabase db query --linked -f "${tmpSqlPath}"`, { encoding:"utf-8", maxBuffer:400*1024*1024, timeout:60000, stdio:["ignore","pipe","pipe"] });
    const idx = out.indexOf("{");
    const parsed = JSON.parse(out.slice(idx));
    if ((parsed.rows||[]).length) {
      cellsTouched++;
      if (c.hasRow) cellsUpdated++; else cellsInserted++;
      log(`  ✓ ${c.eng.client_name}/${c.noteType} (${c.hasRow?'UPD':'INS'}): +${addedRows.length} rows; drift ${fmt(c.cyDrift)}→${fmt(newCyDrift)}/${fmt(c.pyDrift)}→${fmt(newPyDrift)}`);
      for (const r of addedRows) events.push({ client: c.eng.client_name, fy: c.eng.financial_year, note: c.noteType, op: c.hasRow?'update':'insert', key: r.rowId, label: r.name, cy: r.cy, py: r.py });
    }
  } catch (e) {
    log(`  ✗ FAIL ${c.eng.client_name}/${c.noteType}: ${String(e.message||e).slice(0,200)}`);
  }
}

log(`\nDone. Cells touched: ${cellsTouched} (inserts: ${cellsInserted}, updates: ${cellsUpdated})`);
log(`Total events: ${events.length}`);
writeFileSync(join(process.cwd(),"pattern_g_full_events.json"), JSON.stringify(events,null,2));
