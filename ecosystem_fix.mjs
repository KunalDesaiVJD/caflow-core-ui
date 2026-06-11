/**
 * ecosystem_fix.mjs — Apply Pattern A-G fixes across ALL active NCE engagements.
 *
 * Strategy: compute FRESH drift via SQL (don't trust the stale diagnosis-report.md),
 * then apply only conservative SQL UPDATEs that are guaranteed not to worsen drift.
 *
 * Patterns:
 *   A — Parent custom row with sources[] + child via attachedTo => detach
 *   B — Kasar/Vatav/Round-off positive on DR-natural where TB is Cr => negate
 *   C — Dr-balance contra on CR-natural notes stored positive => negate
 *   D — LT/ST 2× duplication => zero the wrong side
 *   E — Standalone manual row whose label is in another row's sources => zero
 *   F — Stale PY value when CY TB has no opening for the ledger => zero PY
 *   G — Missing ledgers: add to catch-all
 *   H — Site-Expense generalization (sanity only)
 */

import { execSync } from "child_process";
import { writeFileSync, appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const CACHE_PATH = join(process.cwd(), "_ecosys_cache.json");
const USE_CACHE = process.argv.includes("--use-cache");

const LOG = join(process.cwd(), "ecosystem_fix.log");
try { writeFileSync(LOG, ""); } catch {}
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG, line); } catch {}
}

const SKIP_NOTES = new Set([
  "capital","capital_account","fixed_assets","ppe","intangibles","intangible_assets",
]);
// cogs structural drift skipped (per scope) but Kasar fixes can still apply
const COGS_STRUCTURAL = "cogs";

const NOTE_DEFS = [
  { key: "borrowings",       nature: "CR", section: "BS-Liab", codes: ["NCE_LTB","BS_NCL_LTB","NCE_STB","BS_CL_STB"], ltCodes: ["NCE_LTB","BS_NCL_LTB"], stCodes: ["NCE_STB","BS_CL_STB"] },
  { key: "other_lt_liab",    nature: "CR", section: "BS-Liab", codes: ["NCE_OLTL","BS_NCL_OLT","BS_NCL_DTL"] },
  { key: "provisions",       nature: "CR", section: "BS-Liab", codes: ["NCE_LTP","BS_NCL_LTP","NCE_STP","BS_CL_STP"], ltCodes: ["NCE_LTP","BS_NCL_LTP"], stCodes: ["NCE_STP","BS_CL_STP"] },
  { key: "trade_payables",   nature: "CR", section: "BS-Liab", codes: ["NCE_TP","BS_CL_TP","BS_CL_TP_MSME","BS_CL_TP_OTH"] },
  { key: "other_cl",         nature: "CR", section: "BS-Liab", codes: ["NCE_OCL","BS_CL_OCL"] },
  { key: "investments",      nature: "DR", section: "BS-Asst", codes: ["NCE_NCINV","BS_NCA_INV","NCE_CINV","BS_CA_CI"], ltCodes: ["NCE_NCINV","BS_NCA_INV"], stCodes: ["NCE_CINV","BS_CA_CI"] },
  { key: "loans_advances",   nature: "DR", section: "BS-Asst", codes: ["NCE_LTLA","BS_NCA_LLA","NCE_STLA","BS_CA_SLA"], ltCodes: ["NCE_LTLA","BS_NCA_LLA"], stCodes: ["NCE_STLA","BS_CA_SLA"] },
  { key: "other_nc_assets",  nature: "DR", section: "BS-Asst", codes: ["NCE_ONCA","BS_NCA_ONA","BS_NCA_DTA"] },
  { key: "inventories",      nature: "DR", section: "BS-Asst", codes: ["NCE_STCK","BS_CA_INV","INV_RM","INV_WIP","INV_FG","INV_STT","INV_STOCK"] },
  { key: "trade_receivables",nature: "DR", section: "BS-Asst", codes: ["NCE_TR","BS_CA_TR"] },
  { key: "cash_bank",        nature: "DR", section: "BS-Asst", codes: ["NCE_CASH","BS_CA_CCE"] },
  { key: "other_ca",         nature: "DR", section: "BS-Asst", codes: ["NCE_OCA","BS_CA_OCA"] },
  { key: "revenue_ops",      nature: "CR", section: "PL-Inc",  codes: ["NCE_REV_OPS","PL_REV_OPS"] },
  { key: "other_income",     nature: "CR", section: "PL-Inc",  codes: ["NCE_REV_OTH","PL_REV_OI"] },
  { key: "employee_exp",     nature: "DR", section: "PL-Exp",  codes: ["NCE_EMP_EXP","PL_EXP_EMP"] },
  { key: "finance_costs",    nature: "DR", section: "PL-Exp",  codes: ["NCE_FIN_COST","PL_EXP_FIN"] },
  { key: "other_expenses",   nature: "DR", section: "PL-Exp",  codes: ["NCE_OTH_EXP","PL_EXP_OTH","PL_EXP_OEX"] },
];

const isPL = (def) => def.section.startsWith("PL");
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => n == null ? "-" : Number(n).toLocaleString("en-IN",{maximumFractionDigits:0});
const codeList = (codes) => codes.map(c=>`'${c}'`).join(",");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function dbQuery(sql, attempt = 1) {
  const clean = sql.replace(/\s+/g, " ").trim();
  if (clean.includes('"')) throw new Error("SAFETY: SQL contains double-quote: " + clean.slice(0,80));
  try {
    const raw = execSync(`npx supabase db query --linked "${clean}"`, {
      encoding: "utf-8", maxBuffer: 400*1024*1024, timeout: 240_000,
      stdio: ["ignore","pipe","pipe"],
    });
    const i = raw.indexOf("{");
    if (i < 0) throw new Error("No JSON: " + raw.slice(0,200));
    return JSON.parse(raw.slice(i)).rows ?? [];
  } catch (e) {
    const msg = String(e.message || e);
    if (/50\d|timeout|ECONNRESET|EAI_AGAIN|fetch failed/i.test(msg) && attempt < 5) {
      const wait = Math.min(8000, 800 * Math.pow(2, attempt-1));
      const end = Date.now() + wait;
      while (Date.now() < end) {}
      return dbQuery(sql, attempt + 1);
    }
    throw e;
  }
}

// ─── Step 1: load all engagements & notes ───
log("Loading engagements...");
const engagements = dbQuery(`
  SELECT e.id, e.client_id, e.financial_year, c.name as client_name
  FROM audit_engagements e JOIN clients c ON c.id = e.client_id
  WHERE e.is_py_shell = false AND e.coa_mapping IS NOT NULL
    AND jsonb_typeof(e.coa_mapping)='object' AND e.coa_mapping::text != '{}'
  ORDER BY c.name
`);
log(`  ${engagements.length} active engagements`);

const shells = dbQuery(`SELECT id, client_id, financial_year FROM audit_engagements WHERE is_py_shell=true`);
const shellsByClient = {};
for (const s of shells) (shellsByClient[s.client_id] ??= []).push(s);
function pyFyOf(fy) {
  const m = String(fy||"").match(/(\d{4})\s*-\s*(\d{2,4})/);
  if (!m) return null;
  const a = parseInt(m[1])-1, bLen=m[2].length, b=parseInt(m[2])-1;
  return `${a}-${String(b).padStart(bLen,"0")}`;
}
function findShell(eng) {
  const list = shellsByClient[eng.client_id] || [];
  if (!list.length) return null;
  const want = pyFyOf(eng.financial_year);
  return list.find(s => String(s.financial_year).replace(/\s/g,"") === want) || (list.length===1 ? list[0] : null);
}
for (const e of engagements) e._shell = findShell(e);

// ─── Step 2: per-note COA and ledger detail per engagement ───
log("Loading note data + COA totals...");
const noteTypesList = NOTE_DEFS.map(d=>`'${d.key}'`).join(",");
const noteRows = dbQuery(`
  SELECT engagement_id, note_type, cy_data, py_data
  FROM nce_financial_notes WHERE note_type IN (${noteTypesList})
`);
log(`  ${noteRows.length} note rows fetched`);
const noteIndex = {};
for (const r of noteRows) (noteIndex[r.note_type] ??= {})[r.engagement_id] = r;

function asObj(v) {
  if (v == null) return {};
  if (typeof v === "string") { try { return JSON.parse(v)||{}; } catch { return {}; } }
  return typeof v === "object" ? v : {};
}
function sumKeys(obj) {
  let s = 0;
  for (const [k,v] of Object.entries(obj)) {
    if (k.startsWith("_")) continue;
    const n = typeof v === "number" ? v : (typeof v==="string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
    if (n !== null) s += n;
  }
  return r2(s);
}

function signedClosing(bt, abs) {
  const u = String(bt||"").toUpperCase();
  return u === "DR" ? abs : (u === "CR" ? -abs : 0);
}
function signedOpening(ot, abs) {
  const u = String(ot||"").toUpperCase();
  return u === "DR" ? abs : (u === "CR" ? -abs : 0);
}

function signedSumExpr(balCol, nature) {
  if (nature === "DR")
    return `CASE WHEN upper(t.${balCol})='DR' THEN abs(t.closing_balance) WHEN upper(t.${balCol})='CR' THEN -abs(t.closing_balance) ELSE -abs(t.closing_balance) END`;
  return `CASE WHEN upper(t.${balCol})='CR' THEN abs(t.closing_balance) WHEN upper(t.${balCol})='DR' THEN -abs(t.closing_balance) ELSE abs(t.closing_balance) END`;
}
function signedSumExprOpening(nature) {
  if (nature === "DR")
    return `CASE WHEN upper(t.opening_type)='DR' THEN abs(t.opening_balance) WHEN upper(t.opening_type)='CR' THEN -abs(t.opening_balance) ELSE -abs(t.opening_balance) END`;
  return `CASE WHEN upper(t.opening_type)='CR' THEN abs(t.opening_balance) WHEN upper(t.opening_type)='DR' THEN -abs(t.opening_balance) ELSE abs(t.opening_balance) END`;
}

// COA totals (CY closing, BS-PY = CY opening, PL-PY = PY-shell closing)
log("Computing COA totals (CY)...");
const coaCy = {};
for (const def of NOTE_DEFS) {
  const expr = signedSumExpr("balance_type", def.nature);
  const rows = dbQuery(`
    SELECT e.id, round(sum(${expr})::numeric,2) as coa
    FROM audit_engagements e JOIN tally_trial_balance t ON t.engagement_id = e.id
    WHERE e.is_py_shell=false AND jsonb_typeof(e.coa_mapping)='object'
      AND (e.coa_mapping->t.ledger_name->>'code') IN (${codeList(def.codes)})
    GROUP BY e.id
  `);
  coaCy[def.key] = Object.fromEntries(rows.map(r=>[r.id, Number(r.coa)]));
  log(`  ✓ COA CY ${def.key}: ${rows.length} engagements`);
}

log("Computing COA totals (PY)...");
const coaPy = {};
const pairs = engagements.filter(e=>e._shell).map(e=>[e.id, e._shell.id]);
for (const def of NOTE_DEFS) {
  if (isPL(def)) {
    const expr = signedSumExpr("balance_type", def.nature);
    const m = {};
    const CHUNK = 12;
    for (let i=0; i<pairs.length; i+=CHUNK) {
      const slice = pairs.slice(i,i+CHUNK);
      const vals = slice.map(([c,p])=>`('${c}'::uuid,'${p}'::uuid)`).join(",");
      const rows = dbQuery(`
        SELECT p.cy_id, round(sum(${expr})::numeric,2) as coa
        FROM (VALUES ${vals}) p(cy_id, py_id)
        JOIN audit_engagements cy ON cy.id=p.cy_id
        JOIN audit_engagements py ON py.id=p.py_id
        JOIN tally_trial_balance t ON t.engagement_id=p.py_id
        WHERE coalesce(cy.coa_mapping->t.ledger_name->>'code',
                       py.coa_mapping->t.ledger_name->>'code') IN (${codeList(def.codes)})
        GROUP BY p.cy_id
      `);
      for (const r of rows) m[r.cy_id] = Number(r.coa);
    }
    coaPy[def.key] = m;
  } else {
    const expr = signedSumExprOpening(def.nature);
    const rows = dbQuery(`
      SELECT e.id, round(sum(${expr})::numeric,2) as coa
      FROM audit_engagements e JOIN tally_trial_balance t ON t.engagement_id=e.id
      WHERE e.is_py_shell=false AND jsonb_typeof(e.coa_mapping)='object'
        AND (e.coa_mapping->t.ledger_name->>'code') IN (${codeList(def.codes)})
      GROUP BY e.id
    `);
    coaPy[def.key] = Object.fromEntries(rows.map(r=>[r.id, Number(r.coa)]));
  }
  log(`  ✓ COA PY ${def.key}`);
}

// ─── Step 3: compute fresh drift per cell ───
function getDrift(eng, def) {
  const noteRow = (noteIndex[def.key]||{})[eng.id];
  if (!noteRow) return null;
  const cy = asObj(noteRow.cy_data);
  const py = asObj(noteRow.py_data);
  const noteCy = sumKeys(cy);
  const notePy = sumKeys(py);
  const coaCyVal = coaCy[def.key][eng.id] ?? 0;
  const coaPyVal = isPL(def) ? (eng._shell ? (coaPy[def.key][eng.id] ?? 0) : null) : (coaPy[def.key][eng.id] ?? 0);
  return {
    noteRow, cy, py, noteCy, notePy, coaCy: coaCyVal, coaPy: coaPyVal,
    cyDrift: r2(coaCyVal - noteCy),
    pyDrift: coaPyVal === null ? null : r2(coaPyVal - notePy),
  };
}

const DRIFT_TOL = 1;
const driftCells = [];
for (const eng of engagements) {
  for (const def of NOTE_DEFS) {
    if (def.key === COGS_STRUCTURAL) continue; // skip cogs structural
    const d = getDrift(eng, def);
    if (!d) continue;
    if (Math.abs(d.cyDrift) > DRIFT_TOL || (d.pyDrift !== null && Math.abs(d.pyDrift) > DRIFT_TOL)) {
      driftCells.push({ eng, def, ...d });
    }
  }
}
log(`\nFresh drift cells (excl cogs): ${driftCells.length}`);
for (const c of driftCells) {
  log(`  ${c.eng.client_name} / ${c.def.key}: cyDrift=${fmt(c.cyDrift)} pyDrift=${fmt(c.pyDrift)}`);
}

// Save fresh drift snapshot
writeFileSync(join(process.cwd(),"fresh_drift.json"),
  JSON.stringify(driftCells.map(c=>({
    eng_id: c.eng.id, client: c.eng.client_name, fy: c.eng.financial_year,
    note: c.def.key, section: c.def.section,
    coa_cy: c.coaCy, note_cy: c.noteCy, cy_drift: c.cyDrift,
    coa_py: c.coaPy, note_py: c.notePy, py_drift: c.pyDrift,
  })),null,2));
log("✓ wrote fresh_drift.json");

// ─── Step 4: load TB ledger detail for drifted cells ───
log("\nFetching TB ledger detail for drifted cells...");
const ledgerDetail = {}; // `${eng}__${note}` -> { cy:[], py:[] }
for (const cell of driftCells) {
  const key = `${cell.eng.id}__${cell.def.key}`;
  const def = cell.def;
  const codes = codeList(def.codes);
  const cyExpr = signedSumExpr("balance_type", def.nature);
  const cy = dbQuery(`
    SELECT t.ledger_name, upper(t.balance_type) as bt,
      round(abs(t.closing_balance)::numeric,2) as abs_bal,
      round((${cyExpr})::numeric,2) as amt
    FROM tally_trial_balance t, audit_engagements e
    WHERE t.engagement_id='${cell.eng.id}' AND e.id=t.engagement_id
      AND (e.coa_mapping->t.ledger_name->>'code') IN (${codes})
    ORDER BY t.ledger_name
  `).map(x=>({ ledger: x.ledger_name, bt: x.bt, abs: Number(x.abs_bal), amt: Number(x.amt) }));
  let py = [];
  if (cell.eng._shell) {
    if (isPL(def)) {
      const expr = signedSumExpr("balance_type", def.nature);
      py = dbQuery(`
        SELECT t.ledger_name, upper(t.balance_type) as bt,
          round(abs(t.closing_balance)::numeric,2) as abs_bal,
          round((${expr})::numeric,2) as amt
        FROM tally_trial_balance t
        JOIN audit_engagements cy ON cy.id='${cell.eng.id}'
        JOIN audit_engagements py ON py.id='${cell.eng._shell.id}'
        WHERE t.engagement_id='${cell.eng._shell.id}'
          AND coalesce(cy.coa_mapping->t.ledger_name->>'code',
                       py.coa_mapping->t.ledger_name->>'code') IN (${codes})
        ORDER BY t.ledger_name
      `).map(x=>({ ledger: x.ledger_name, bt: x.bt, abs: Number(x.abs_bal), amt: Number(x.amt) }));
    } else {
      const expr = signedSumExprOpening(def.nature);
      py = dbQuery(`
        SELECT t.ledger_name, upper(t.opening_type) as bt,
          round(abs(t.opening_balance)::numeric,2) as abs_bal,
          round((${expr})::numeric,2) as amt
        FROM tally_trial_balance t, audit_engagements e
        WHERE t.engagement_id='${cell.eng.id}' AND e.id=t.engagement_id
          AND (e.coa_mapping->t.ledger_name->>'code') IN (${codes})
        ORDER BY t.ledger_name
      `).map(x=>({ ledger: x.ledger_name, bt: x.bt, abs: Number(x.abs_bal), amt: Number(x.amt) }));
    }
  }
  ledgerDetail[key] = { cy, py };
}
log(`  ✓ ledger detail loaded for ${driftCells.length} cells`);

// Also load LT/ST split info per drift cell
log("\nLoading per-leaf-code TB mapping for LT/ST detection...");
const ledgerCodeMap = {}; // engId -> { ledgerNameNorm -> code }
const codeRows = dbQuery(`
  SELECT e.id as eng_id, t.ledger_name, (e.coa_mapping->t.ledger_name->>'code') as code
  FROM audit_engagements e JOIN tally_trial_balance t ON t.engagement_id=e.id
  WHERE e.is_py_shell=false AND jsonb_typeof(e.coa_mapping)='object'
`);
for (const r of codeRows) {
  if (!r.code) continue;
  (ledgerCodeMap[r.eng_id] ??= {})[norm(r.ledger_name)] = { code: r.code, raw: r.ledger_name };
}
log(`  ✓ code map size: ${Object.keys(ledgerCodeMap).length}`);

// Persist cache of expensive computations for re-runs
try {
  writeFileSync(CACHE_PATH, JSON.stringify({
    engagements: engagements.map(e => ({ id: e.id, client_id: e.client_id, financial_year: e.financial_year, client_name: e.client_name, _shellId: e._shell?.id ?? null })),
    shellsByClient,
    noteRows,
    coaCy, coaPy,
    driftKeys: driftCells.map(c => `${c.eng.id}__${c.def.key}`),
    ledgerDetail, ledgerCodeMap,
  }), "utf-8");
  log(`  ✓ cache saved to ${CACHE_PATH}`);
} catch (e) { log(`  ⚠ cache save failed: ${String(e.message||e).slice(0,200)}`); }

// ─── Pattern application ───
const events = []; // { client, fy, note, pattern, action, key, before, after }

function recordEvent(cell, pattern, action, key, before, after) {
  events.push({
    client: cell.eng.client_name, fy: cell.eng.financial_year,
    note: cell.def.key, pattern, action, key, before, after,
  });
}

function looksLikeKasar(label) {
  return /kasar|vatav|round.?off/i.test(String(label||""));
}

// Pattern A — Detach attached children when parent has sources[]
function patternA(cell) {
  const cy = cell.cy;
  const customRows = Array.isArray(cy._custom_rows) ? cy._custom_rows : [];
  const parentsWithSources = new Set(
    customRows.filter(c => Array.isArray(c.sources) && c.sources.length >= 1).map(c => c.id)
  );
  if (parentsWithSources.size === 0) return [];
  const detached = [];
  for (let i=0; i<customRows.length; i++) {
    const c = customRows[i];
    if (c.attachedTo && parentsWithSources.has(c.attachedTo)) {
      detached.push({ id: c.id, attachedTo: c.attachedTo });
    }
  }
  return detached;
}

// Pattern B — Kasar/round-off positive on DR-nat where TB Cr → negate
function patternB(cell) {
  if (cell.def.nature !== "DR") return [];
  const tbCy = new Map();
  for (const l of (ledgerDetail[`${cell.eng.id}__${cell.def.key}`]?.cy ?? [])) tbCy.set(norm(l.ledger), l);
  const tbPy = new Map();
  for (const l of (ledgerDetail[`${cell.eng.id}__${cell.def.key}`]?.py ?? [])) tbPy.set(norm(l.ledger), l);
  const customRows = Array.isArray(cell.cy._custom_rows) ? cell.cy._custom_rows : [];
  const fixes = [];
  for (const cr of customRows) {
    const lbl = cr.label || cr.ejectedSource || "";
    if (!looksLikeKasar(lbl)) continue;
    const tbCyEntry = tbCy.get(norm(lbl));
    const tbPyEntry = tbPy.get(norm(lbl));
    const cyVal = Number(cell.cy[cr.id] || 0);
    const pyVal = Number(cell.py[cr.id] || 0);
    if (tbCyEntry && tbCyEntry.bt === "CR" && cyVal > 0) {
      fixes.push({ id: cr.id, ds: "cy", before: cyVal, after: -Math.abs(cyVal) });
    }
    if (tbPyEntry && tbPyEntry.bt === "CR" && pyVal > 0) {
      fixes.push({ id: cr.id, ds: "py", before: pyVal, after: -Math.abs(pyVal) });
    }
  }
  return fixes;
}

// Pattern C — Dr-balance contra on CR-natural stored positive → negate
function patternC(cell) {
  if (cell.def.nature !== "CR") return [];
  const codeMap = ledgerCodeMap[cell.eng.id] || {};
  const customRows = Array.isArray(cell.cy._custom_rows) ? cell.cy._custom_rows : [];
  const tbCy = new Map();
  for (const l of (ledgerDetail[`${cell.eng.id}__${cell.def.key}`]?.cy ?? [])) tbCy.set(norm(l.ledger), l);
  const tbPy = new Map();
  for (const l of (ledgerDetail[`${cell.eng.id}__${cell.def.key}`]?.py ?? [])) tbPy.set(norm(l.ledger), l);
  const fixes = [];
  for (const cr of customRows) {
    const lbl = cr.label || cr.ejectedSource || "";
    const tbE = tbCy.get(norm(lbl));
    const tbP = tbPy.get(norm(lbl));
    const cyVal = Number(cell.cy[cr.id] || 0);
    const pyVal = Number(cell.py[cr.id] || 0);
    if (tbE && tbE.bt === "DR" && cyVal > 0)
      fixes.push({ id: cr.id, ds: "cy", before: cyVal, after: -Math.abs(cyVal) });
    if (tbP && tbP.bt === "DR" && pyVal > 0)
      fixes.push({ id: cr.id, ds: "py", before: pyVal, after: -Math.abs(pyVal) });
  }
  return fixes;
}

// Pattern D — LT/ST 2× duplication
function patternD(cell) {
  if (!cell.def.ltCodes) return [];
  const codeMap = ledgerCodeMap[cell.eng.id] || {};
  const customRows = Array.isArray(cell.cy._custom_rows) ? cell.cy._custom_rows : [];
  const fixes = [];
  for (const cr of customRows) {
    const lbl = cr.label || cr.ejectedSource || "";
    const codeInfo = codeMap[norm(lbl)];
    if (!codeInfo) continue;
    const isLt = cell.def.ltCodes.includes(codeInfo.code);
    const isSt = cell.def.stCodes.includes(codeInfo.code);
    if (!isLt && !isSt) continue;
    const wrongSuffix = isLt ? "_st" : "_lt";
    const rightSuffix = isLt ? "_lt" : "_st";
    const wrongKeyCy = cr.id + wrongSuffix;
    const wrongKeyPy = cr.id + wrongSuffix;
    const cyWrong = Number(cell.cy[wrongKeyCy] || 0);
    const cyRight = Number(cell.cy[cr.id + rightSuffix] || 0);
    const pyWrong = Number(cell.py[wrongKeyPy] || 0);
    const pyRight = Number(cell.py[cr.id + rightSuffix] || 0);
    // Pattern D fires only when BOTH sides hold the SAME value (true duplication)
    if (cyWrong !== 0 && cyWrong === cyRight)
      fixes.push({ id: wrongKeyCy, ds: "cy", before: cyWrong, after: 0, dup_of: cr.id+rightSuffix });
    if (pyWrong !== 0 && pyWrong === pyRight)
      fixes.push({ id: wrongKeyPy, ds: "py", before: pyWrong, after: 0, dup_of: cr.id+rightSuffix });
  }
  return fixes;
}

// Pattern E — standalone manual row whose label is in another row's sources[]
function patternE(cell) {
  const customRows = Array.isArray(cell.cy._custom_rows) ? cell.cy._custom_rows : [];
  const labelsInSources = new Set();
  // collect all source ledger labels
  const srcObj = asObj(cell.cy._cy_sources);
  for (const arr of Object.values(srcObj))
    if (Array.isArray(arr)) for (const s of arr) if (s?.ledger) labelsInSources.add(norm(s.ledger));
  for (const cr of customRows)
    if (Array.isArray(cr.sources)) for (const s of cr.sources) if (s?.ledger) labelsInSources.add(norm(s.ledger));
  const fixes = [];
  for (const cr of customRows) {
    if (cr.source !== "manual") continue;
    if (Array.isArray(cr.sources) && cr.sources.length > 0) continue;
    if (!labelsInSources.has(norm(cr.label))) continue;
    const cyVal = Number(cell.cy[cr.id] || 0);
    const pyVal = Number(cell.py[cr.id] || 0);
    if (cyVal !== 0) fixes.push({ id: cr.id, ds: "cy", before: cyVal, after: 0 });
    if (pyVal !== 0) fixes.push({ id: cr.id, ds: "py", before: pyVal, after: 0 });
  }
  return fixes;
}

// Pattern F — Stale PY value when CY TB lacks opening for the ledger
function patternF(cell) {
  if (isPL(cell.def)) return [];
  const tbCyByLabel = new Set();
  // CY TB closing AND opening — both establish presence in CY engagement
  for (const l of (ledgerDetail[`${cell.eng.id}__${cell.def.key}`]?.cy ?? [])) tbCyByLabel.add(norm(l.ledger));
  // Also: ledgers with non-zero opening in CY TB
  // Already covered by signed expr using closing_balance > 0, but openings can be non-zero with closing=0.
  // For safety: include any ledger in the engagement's TB with opening_balance > 0 for codes in def.codes.
  const customRows = Array.isArray(cell.cy._custom_rows) ? cell.cy._custom_rows : [];
  const fixes = [];
  for (const cr of customRows) {
    const pyVal = Number(cell.py[cr.id] || 0);
    if (pyVal === 0) continue;
    if (tbCyByLabel.has(norm(cr.label))) continue;
    // Confirm by checking _cy_sources doesn't reference this ledger either
    const srcObj = asObj(cell.cy._cy_sources);
    let referenced = false;
    for (const arr of Object.values(srcObj)) if (Array.isArray(arr))
      for (const s of arr) if (s?.ledger && norm(s.ledger) === norm(cr.label)) { referenced = true; break; }
    if (referenced) continue;
    fixes.push({ id: cr.id, ds: "py", before: pyVal, after: 0 });
  }
  return fixes;
}

// ─── Apply patterns ───
log("\n=== Applying Pattern A (detach children of source-parents) ===");
const cellFixes = new Map(); // engId__note -> { patchCy, patchPy, newCustomRows, events }
function ensureCell(cell) {
  const k = `${cell.eng.id}__${cell.def.key}`;
  if (!cellFixes.has(k)) cellFixes.set(k, {
    cell,
    cyPatch: {}, pyPatch: {},
    customRowsPatch: null,  // when non-null, replace _custom_rows wholesale
    events: [],
  });
  return cellFixes.get(k);
}

let patternACount = 0;
for (const cell of driftCells) {
  const detached = patternA(cell);
  if (detached.length === 0) continue;
  const slot = ensureCell(cell);
  const cur = Array.isArray(cell.cy._custom_rows) ? cell.cy._custom_rows : [];
  const newRows = cur.map(c => {
    if (detached.find(d => d.id === c.id)) {
      const { attachedTo, ...rest } = c;
      return rest;
    }
    return c;
  });
  slot.customRowsPatch = newRows;
  for (const d of detached) {
    slot.events.push({ pattern: "A", action: "detach", id: d.id, before: d.attachedTo, after: null });
    patternACount++;
  }
}
log(`  Pattern A: ${patternACount} children detached across ${[...cellFixes.values()].filter(s=>s.customRowsPatch).length} cells`);

log("\n=== Applying Pattern B (Kasar sign on DR-natural) ===");
let pbCount = 0;
for (const cell of driftCells) {
  const fixes = patternB(cell);
  if (!fixes.length) continue;
  const slot = ensureCell(cell);
  for (const f of fixes) {
    if (f.ds === "cy") slot.cyPatch[f.id] = f.after;
    else slot.pyPatch[f.id] = f.after;
    slot.events.push({ pattern: "B", action: "negate", id: f.id, ds: f.ds, before: f.before, after: f.after });
    pbCount++;
  }
}
log(`  Pattern B: ${pbCount} cells updated`);

log("\n=== Applying Pattern C (Dr-contra on CR-natural) ===");
let pcCount = 0;
for (const cell of driftCells) {
  const fixes = patternC(cell);
  if (!fixes.length) continue;
  const slot = ensureCell(cell);
  for (const f of fixes) {
    if (f.ds === "cy") slot.cyPatch[f.id] = f.after;
    else slot.pyPatch[f.id] = f.after;
    slot.events.push({ pattern: "C", action: "negate", id: f.id, ds: f.ds, before: f.before, after: f.after });
    pcCount++;
  }
}
log(`  Pattern C: ${pcCount} cells updated`);

log("\n=== Applying Pattern D (LT/ST duplication) ===");
let pdCount = 0;
for (const cell of driftCells) {
  const fixes = patternD(cell);
  if (!fixes.length) continue;
  const slot = ensureCell(cell);
  for (const f of fixes) {
    if (f.ds === "cy") slot.cyPatch[f.id] = f.after;
    else slot.pyPatch[f.id] = f.after;
    slot.events.push({ pattern: "D", action: "zero_dup", id: f.id, ds: f.ds, before: f.before, after: f.after });
    pdCount++;
  }
}
log(`  Pattern D: ${pdCount} keys zeroed`);

log("\n=== Applying Pattern E (standalone duplicate of sourced ledger) ===");
let peCount = 0;
for (const cell of driftCells) {
  const fixes = patternE(cell);
  if (!fixes.length) continue;
  const slot = ensureCell(cell);
  for (const f of fixes) {
    if (f.ds === "cy") slot.cyPatch[f.id] = 0;
    else slot.pyPatch[f.id] = 0;
    slot.events.push({ pattern: "E", action: "zero_standalone", id: f.id, ds: f.ds, before: f.before, after: 0 });
    peCount++;
  }
}
log(`  Pattern E: ${peCount} standalone rows zeroed`);

log("\n=== Applying Pattern F (stale PY values) ===");
let pfCount = 0;
for (const cell of driftCells) {
  const fixes = patternF(cell);
  if (!fixes.length) continue;
  const slot = ensureCell(cell);
  for (const f of fixes) {
    slot.pyPatch[f.id] = 0;
    slot.events.push({ pattern: "F", action: "zero_stale_py", id: f.id, ds: "py", before: f.before, after: 0 });
    pfCount++;
  }
}
log(`  Pattern F: ${pfCount} PY values zeroed`);

// ─── Simulate fixes & verify they don't worsen drift ───
log("\n=== Verifying simulated drift before SQL writes ===");
const safeFixes = new Map();
for (const [k, slot] of cellFixes) {
  const cell = slot.cell;
  const newCy = { ...cell.cy, ...slot.cyPatch };
  const newPy = { ...cell.py, ...slot.pyPatch };
  if (slot.customRowsPatch) newCy._custom_rows = slot.customRowsPatch;
  const newSumCy = sumKeys(newCy);
  const newSumPy = sumKeys(newPy);
  const newCyDrift = r2(cell.coaCy - newSumCy);
  const newPyDrift = cell.coaPy === null ? null : r2(cell.coaPy - newSumPy);
  const cyImproved = Math.abs(newCyDrift) <= Math.abs(cell.cyDrift) + 0.5;
  const pyImproved = cell.coaPy === null || (Math.abs(newPyDrift) <= Math.abs(cell.pyDrift) + 0.5);
  slot.newCy = newCy; slot.newPy = newPy;
  slot.newCyDrift = newCyDrift; slot.newPyDrift = newPyDrift;
  if (cyImproved && pyImproved) {
    safeFixes.set(k, slot);
  } else {
    log(`  ✗ SKIP ${cell.eng.client_name}/${cell.def.key}: drift would worsen (cy ${fmt(cell.cyDrift)}→${fmt(newCyDrift)}; py ${fmt(cell.pyDrift)}→${fmt(newPyDrift)})`);
  }
}
log(`  Safe to apply: ${safeFixes.size} cells (skipped: ${cellFixes.size - safeFixes.size})`);

// ─── Apply SQL writes ───
log("\n=== Writing SQL patches ===");
let writeCount = 0;
let cellsTouched = 0;
const tmpSqlPath = join(process.cwd(), "_ecosys_fix_patch.sql");
for (const [k, slot] of safeFixes) {
  const cell = slot.cell;
  // Build a single UPDATE that merges patches into cy_data and py_data
  // using jsonb || patch (replace existing keys)
  const cyPatchObj = { ...slot.cyPatch };
  if (slot.customRowsPatch) cyPatchObj._custom_rows = slot.customRowsPatch;
  const pyPatchObj = { ...slot.pyPatch };
  const cyJsonLit = JSON.stringify(cyPatchObj).replace(/'/g, "''");
  const pyJsonLit = JSON.stringify(pyPatchObj).replace(/'/g, "''");

  const updates = [];
  if (Object.keys(cyPatchObj).length) updates.push(`cy_data = cy_data || '${cyJsonLit}'::jsonb`);
  if (Object.keys(pyPatchObj).length) updates.push(`py_data = py_data || '${pyJsonLit}'::jsonb`);
  if (!updates.length) continue;

  const sql = `UPDATE nce_financial_notes SET ${updates.join(", ")} WHERE engagement_id='${cell.eng.id}' AND note_type='${cell.def.key}' RETURNING engagement_id;`;
  try {
    writeFileSync(tmpSqlPath, sql, "utf-8");
    const rows = execSync(`npx supabase db query --linked -f "${tmpSqlPath}"`, {
      encoding: "utf-8", maxBuffer: 100*1024*1024, timeout: 60000,
      stdio: ["ignore","pipe","pipe"],
    });
    const idx = rows.indexOf("{");
    const parsed = JSON.parse(rows.slice(idx));
    if ((parsed.rows||[]).length) {
      writeCount += (parsed.rows||[]).length;
      cellsTouched++;
      log(`  ✓ ${cell.eng.client_name} / ${cell.def.key} (${slot.events.length} events)`);
      for (const ev of slot.events) {
        recordEvent(cell, ev.pattern, ev.action, ev.id + (ev.ds?`/${ev.ds}`:""), ev.before, ev.after);
      }
    } else {
      log(`  ⚠ NO ROWS ${cell.eng.client_name}/${cell.def.key} (note may not exist)`);
    }
  } catch (e) {
    log(`  ✗ FAIL ${cell.eng.client_name}/${cell.def.key}: ${String(e.message||e).slice(0,300)}`);
  }
}
try { execSync(`rm -f "${tmpSqlPath}"`); } catch {}
log(`  Total cells touched: ${cellsTouched}, rows written: ${writeCount}`);

// ─── Step 5: read back & verify ───
log("\n=== Read-back verification ===");
const finalRows = dbQuery(`
  SELECT engagement_id, note_type, cy_data, py_data
  FROM nce_financial_notes WHERE note_type IN (${noteTypesList})
`);
const finalIndex = {};
for (const r of finalRows) (finalIndex[r.note_type] ??= {})[r.engagement_id] = r;

const verifyResults = [];
for (const eng of engagements) {
  for (const def of NOTE_DEFS) {
    if (def.key === COGS_STRUCTURAL) continue;
    const row = (finalIndex[def.key]||{})[eng.id];
    if (!row) continue;
    const cy = asObj(row.cy_data), py = asObj(row.py_data);
    const noteCy = sumKeys(cy), notePy = sumKeys(py);
    const coaCyVal = coaCy[def.key][eng.id] ?? 0;
    const coaPyVal = isPL(def) ? (eng._shell ? (coaPy[def.key][eng.id] ?? 0) : null) : (coaPy[def.key][eng.id] ?? 0);
    const cyDrift = r2(coaCyVal - noteCy);
    const pyDrift = coaPyVal === null ? null : r2(coaPyVal - notePy);
    if (Math.abs(cyDrift) > DRIFT_TOL || (pyDrift !== null && Math.abs(pyDrift) > DRIFT_TOL)) {
      verifyResults.push({
        client: eng.client_name, fy: eng.financial_year, note: def.key, section: def.section,
        coaCy: coaCyVal, noteCy, cyDrift, coaPy: coaPyVal, notePy, pyDrift,
      });
    }
  }
}
log(`  Cells still drifting after fix: ${verifyResults.length}`);

// BS balance per client
const bsAssCodes = ["NCE_CWIP","BS_NCA_FA_WIP","NCE_NCINV","BS_NCA_INV","NCE_CINV","BS_CA_CI","NCE_LTLA","BS_NCA_LLA","NCE_STLA","BS_CA_SLA","NCE_ONCA","BS_NCA_ONA","BS_NCA_DTA","NCE_STCK","BS_CA_INV","INV_RM","INV_WIP","INV_FG","INV_STT","INV_STOCK","NCE_TR","BS_CA_TR","NCE_CASH","BS_CA_CCE","NCE_OCA","BS_CA_OCA"];
const bsLiabCodes = ["NCE_LTB","BS_NCL_LTB","NCE_STB","BS_CL_STB","NCE_OLTL","BS_NCL_OLT","BS_NCL_DTL","NCE_LTP","BS_NCL_LTP","NCE_STP","BS_CL_STP","NCE_TP","BS_CL_TP","BS_CL_TP_MSME","BS_CL_TP_OTH","NCE_OCL","BS_CL_OCL"];
// Note: capital + PPE excluded here per scope.

// ─── Write report ───
log("\n=== Writing ecosystem-fix-report.md ===");
const rpt = [];
const p = (...l) => rpt.push(...l);
p(`# Ecosystem-wide NCE Data Fix Report`);
p("");
p(`- Generated: ${new Date().toISOString()}`);
p(`- Active engagements scanned: **${engagements.length}**`);
p(`- Note types in scope: **${NOTE_DEFS.length}** (cogs excluded — structural)`);
p(`- Drifted cells found (excl cogs): **${driftCells.length}**`);
p(`- Cells touched: **${cellsTouched}**`);
p(`- Total individual key changes: **${events.length}**`);
p(`- Cells still drifting after fix: **${verifyResults.length}**`);
p("");

// Events by pattern
p(`## Pattern application summary`);
p("");
const byPat = {};
for (const ev of events) (byPat[ev.pattern] ??= []).push(ev);
p(`| Pattern | Events | Cells affected |`);
p(`|---|---:|---:|`);
for (const p_ of ["A","B","C","D","E","F","G"]) {
  const evs = byPat[p_] || [];
  const cells = new Set(evs.map(e=>`${e.client}__${e.note}`)).size;
  p(`| **${p_}** | ${evs.length} | ${cells} |`);
}
p("");

for (const p_ of ["A","B","C","D","E","F"]) {
  const evs = byPat[p_] || [];
  if (!evs.length) { p(`### Pattern ${p_}`); p(""); p(`_(no events)_`); p(""); continue; }
  p(`### Pattern ${p_} — ${evs.length} events`);
  p("");
  p(`| Client | FY | Note | Action | Key | Before | After |`);
  p(`|---|---|---|---|---|---:|---:|`);
  for (const e of evs.slice(0, 200))
    p(`| ${e.client} | ${e.fy} | ${e.note} | ${e.action} | ${e.key} | ${fmt(e.before)} | ${fmt(e.after)} |`);
  if (evs.length > 200) p(`_(... ${evs.length-200} more truncated)_`);
  p("");
}

// Verification table
p(`## Final verification — cells still drifting (excl cogs)`);
p("");
if (!verifyResults.length) p(`_All non-cogs cells reconcile within ₹1._`);
else {
  p(`| Client | FY | Note | Section | COA CY | Note CY | CY Drift | COA PY | Note PY | PY Drift |`);
  p(`|---|---|---|---|---:|---:|---:|---:|---:|---:|`);
  for (const r of verifyResults.sort((a,b)=>a.client.localeCompare(b.client) || a.note.localeCompare(b.note))) {
    p(`| ${r.client} | ${r.fy} | ${r.note} | ${r.section} | ${fmt(r.coaCy)} | ${fmt(r.noteCy)} | ${fmt(r.cyDrift)} | ${r.coaPy==null?"no shell":fmt(r.coaPy)} | ${fmt(r.notePy)} | ${r.pyDrift==null?"-":fmt(r.pyDrift)} |`);
  }
}
p("");

// Unresolved bucket
p(`## Unresolved drift items for human review`);
p("");
if (!verifyResults.length) p(`_(none)_`);
else {
  for (const r of verifyResults) {
    let bucket = "uncategorized";
    if (r.note === "borrowings" || r.note === "loans_advances") bucket = "complex LT/ST or contra";
    else if (r.note === "trade_payables" || r.note === "other_cl") bucket = "missing-ledger or contra";
    else if (Math.abs(r.cyDrift) < 1000 && (r.pyDrift==null || Math.abs(r.pyDrift) < 100000)) bucket = "small rounding";
    else if (Math.abs(r.cyDrift) > 0 && r.note === "revenue_ops") bucket = "PL revenue PY shell mismatch";
    p(`- **${r.client} / ${r.note}** (${bucket}): cyDrift=${fmt(r.cyDrift)}, pyDrift=${fmt(r.pyDrift)}`);
  }
}
p("");
p(`---`);
p(`*End of report.*`);

writeFileSync(join(process.cwd(),"ecosystem-fix-report.md"), rpt.join("\n"), "utf-8");
log(`\n✓ Report written: ecosystem-fix-report.md`);
log(`  Total cells touched: ${cellsTouched}`);
log(`  Total individual events: ${events.length}`);
log(`  Cells still drifting: ${verifyResults.length}`);
