/**
 * diag_all_notes.mjs â€” READ-ONLY full-sweep diagnostic for EVERY NCE note type
 * across EVERY active engagement (CY + PY).
 *
 * Data access: `npx supabase db query --linked` (SELECT only).
 * Performance: SQL aggregates run per note-type for ALL engagements at once.
 *
 * Output: detailed Markdown report at diagnosis-report.md
 */

import { execSync } from "child_process";
import { writeFileSync, appendFileSync } from "fs";
import { join } from "path";

// Force unbuffered output: write progress to a side-log too
const PROGRESS_LOG = join(process.cwd(), "diag_progress.log");
try { writeFileSync(PROGRESS_LOG, ""); } catch {}
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(PROGRESS_LOG, line); } catch {}
}

const REPORT_PATH = join(process.cwd(), "diagnosis-report.md");
const DRIFT_TOL = 1; // rupees
const VERBOSE = false;

// â”€â”€â”€ Note configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// nature: "CR" = credit-natural (liab/equity/revenue)  â†’ CR balance = +abs
//         "DR" = debit-natural   (asset/expense)       â†’ DR balance = +abs
// missing balance_type defaults: CR-natural â†’ +abs; DR-natural â†’ -abs

const NOTE_DEFS = [
  // â”€â”€ BS â€” Liabilities (CR-natural) â”€â”€
  { key: "borrowings",       nature: "CR", section: "BS-Liab", codes: ["NCE_LTB","BS_NCL_LTB","NCE_STB","BS_CL_STB"] },
  { key: "other_lt_liab",    nature: "CR", section: "BS-Liab", codes: ["NCE_OLTL","BS_NCL_OLT","BS_NCL_DTL"] },
  { key: "provisions",       nature: "CR", section: "BS-Liab", codes: ["NCE_LTP","BS_NCL_LTP","NCE_STP","BS_CL_STP"] },
  { key: "trade_payables",   nature: "CR", section: "BS-Liab", codes: ["NCE_TP","BS_CL_TP","BS_CL_TP_MSME","BS_CL_TP_OTH"] },
  { key: "other_cl",         nature: "CR", section: "BS-Liab", codes: ["NCE_OCL","BS_CL_OCL"] },

  // â”€â”€ BS â€” Assets (DR-natural) â”€â”€
  { key: "cwip",             nature: "DR", section: "BS-Asst", codes: ["NCE_CWIP","BS_NCA_FA_WIP"] },
  { key: "investments",      nature: "DR", section: "BS-Asst", codes: ["NCE_NCINV","BS_NCA_INV","NCE_CINV","BS_CA_CI"] },
  { key: "loans_advances",   nature: "DR", section: "BS-Asst", codes: ["NCE_LTLA","BS_NCA_LLA","NCE_STLA","BS_CA_SLA"] },
  { key: "other_nc_assets",  nature: "DR", section: "BS-Asst", codes: ["NCE_ONCA","BS_NCA_ONA","BS_NCA_DTA"] },
  { key: "inventories",      nature: "DR", section: "BS-Asst", codes: ["NCE_STCK","BS_CA_INV","INV_RM","INV_WIP","INV_FG","INV_STT","INV_STOCK"] },
  { key: "trade_receivables",nature: "DR", section: "BS-Asst", codes: ["NCE_TR","BS_CA_TR"] },
  { key: "cash_bank",        nature: "DR", section: "BS-Asst", codes: ["NCE_CASH","BS_CA_CCE"] },
  { key: "other_ca",         nature: "DR", section: "BS-Asst", codes: ["NCE_OCA","BS_CA_OCA"] },

  // â”€â”€ PL â€” Income (CR-natural) â”€â”€
  { key: "revenue_ops",      nature: "CR", section: "PL-Inc",  codes: ["NCE_REV_OPS","PL_REV_OPS"] },
  { key: "other_income",     nature: "CR", section: "PL-Inc",  codes: ["NCE_REV_OTH","PL_REV_OI"] },

  // â”€â”€ PL â€” Expense (DR-natural) â”€â”€
  { key: "cogs",             nature: "DR", section: "PL-Exp",  codes: ["NCE_COGS","PL_EXP_MAT","PL_EXP_SIT"] },
  { key: "employee_exp",     nature: "DR", section: "PL-Exp",  codes: ["NCE_EMP_EXP","PL_EXP_EMP"] },
  { key: "finance_costs",    nature: "DR", section: "PL-Exp",  codes: ["NCE_FIN_COST","PL_EXP_FIN"] },
  { key: "other_expenses",   nature: "DR", section: "PL-Exp",  codes: ["NCE_OTH_EXP","PL_EXP_OTH","PL_EXP_OEX"] },
];

const isPL = (def) => def.section.startsWith("PL");

/* signed-sum SQL fragment for a given nature, picking the appropriate balance col. */
function signedSumExpr(balCol, nature) {
  if (nature === "DR") {
    // DR balance positive, CR balance negative, missing â†’ negative
    return `CASE WHEN upper(t.${balCol})='DR' THEN abs(t.closing_balance)
                 WHEN upper(t.${balCol})='CR' THEN -abs(t.closing_balance)
                 ELSE -abs(t.closing_balance) END`;
  }
  // CR-natural: CR positive, DR negative, missing â†’ positive
  return `CASE WHEN upper(t.${balCol})='CR' THEN abs(t.closing_balance)
               WHEN upper(t.${balCol})='DR' THEN -abs(t.closing_balance)
               ELSE abs(t.closing_balance) END`;
}

function signedSumExprOpening(nature) {
  // CY TB opening_balance with opening_type sign
  if (nature === "DR") {
    return `CASE WHEN upper(t.opening_type)='DR' THEN abs(t.opening_balance)
                 WHEN upper(t.opening_type)='CR' THEN -abs(t.opening_balance)
                 ELSE -abs(t.opening_balance) END`;
  }
  return `CASE WHEN upper(t.opening_type)='CR' THEN abs(t.opening_balance)
               WHEN upper(t.opening_type)='DR' THEN -abs(t.opening_balance)
               ELSE abs(t.opening_balance) END`;
}

// â”€â”€â”€ DB helper (READ-ONLY) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function dbQuery(sql) {
  const clean = sql.replace(/\s+/g, " ").trim();
  if (!/^select\b/i.test(clean) && !/^with\b/i.test(clean)) {
    throw new Error("SAFETY: refusing non-SELECT statement: " + clean.slice(0, 80));
  }
  if (clean.includes('"') || clean.includes("%")) {
    throw new Error("SAFETY: SQL contains unsafe chars: " + clean.slice(0, 80));
  }
  const raw = execSync(`npx supabase db query --linked "${clean}"`, {
    encoding: "utf-8",
    maxBuffer: 400 * 1024 * 1024,
    timeout: 240_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) throw new Error("No JSON in db query output: " + raw.slice(0, 300));
  const parsed = JSON.parse(raw.slice(jsonStart));
  return parsed.rows ?? [];
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
};
const codeList = (codes) => codes.map((c) => `'${c}'`).join(",");

// â”€â”€â”€ Step 1: active engagements + PY shells â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

log("Step 1: loading engagements & PY shells...");

const engagements = dbQuery(`
  SELECT e.id, e.client_id, e.financial_year, c.name as client_name
  FROM audit_engagements e JOIN clients c ON c.id = e.client_id
  WHERE e.is_py_shell = false
    AND e.coa_mapping IS NOT NULL
    AND jsonb_typeof(e.coa_mapping) = 'object'
    AND e.coa_mapping::text != '{}'
  ORDER BY c.name, e.financial_year
`);
log(`  Active engagements with COA mapping: ${engagements.length}`);

const shells = dbQuery(`
  SELECT e.id, e.client_id, e.financial_year
  FROM audit_engagements e
  WHERE e.is_py_shell = true
`);
log(`  PY shells: ${shells.length}`);

const shellsByClient = {};
for (const s of shells) (shellsByClient[s.client_id] ??= []).push(s);

function pyFyOf(fy) {
  const m = String(fy || "").match(/(\d{4})\s*-\s*(\d{2,4})/);
  if (!m) return null;
  const a = parseInt(m[1], 10) - 1;
  const bLen = m[2].length;
  const b = parseInt(m[2], 10) - 1;
  return `${a}-${String(b).padStart(bLen, "0")}`;
}

function findShell(eng) {
  const list = shellsByClient[eng.client_id] || [];
  if (list.length === 0) return null;
  const want = pyFyOf(eng.financial_year);
  const exact = list.find((s) => String(s.financial_year).replace(/\s/g, "") === want);
  if (exact) return exact;
  if (list.length === 1) return list[0];
  return null;
}

const pairs = [];
for (const eng of engagements) {
  const sh = findShell(eng);
  eng._shell = sh;
  if (sh) pairs.push([eng.id, sh.id]);
}
log(`  CYâ†”PY pairs resolved: ${pairs.length}/${engagements.length}`);

// â”€â”€â”€ Step 2: COA CY / COA PY per note (server-side aggregates) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

log("\nStep 2: computing COA totals per note type...");

// coaCy: by note â†’ { engId â†’ number }
const coaCy = {};
const coaPyBS = {};
const coaPyPL = {};

for (const def of NOTE_DEFS) {
  const codes = codeList(def.codes);

  // â”€â”€ COA CY â”€â”€
  const cyExpr = signedSumExpr("balance_type", def.nature);
  const cyRows = dbQuery(`
    SELECT e.id,
      round(sum(${cyExpr})::numeric, 2) as coa
    FROM audit_engagements e
    JOIN tally_trial_balance t ON t.engagement_id = e.id
    WHERE e.is_py_shell = false
      AND jsonb_typeof(e.coa_mapping) = 'object'
      AND (e.coa_mapping->t.ledger_name->>'code') IN (${codes})
    GROUP BY e.id
  `);
  coaCy[def.key] = Object.fromEntries(cyRows.map((r) => [r.id, Number(r.coa)]));

  // â”€â”€ COA PY â”€â”€
  if (isPL(def)) {
    // PL: opening of CY TB is 0; pull from PY-shell TB closing
    const pyExpr = signedSumExpr("balance_type", def.nature);
    const map = {};
    const CHUNK = 12;
    for (let i = 0; i < pairs.length; i += CHUNK) {
      const slice = pairs.slice(i, i + CHUNK);
      const vals = slice.map(([c, p]) => `('${c}'::uuid,'${p}'::uuid)`).join(",");
      const rows = dbQuery(`
        SELECT p.cy_id,
          round(sum(${pyExpr})::numeric, 2) as coa
        FROM (VALUES ${vals}) p(cy_id, py_id)
        JOIN audit_engagements cy ON cy.id = p.cy_id
        JOIN audit_engagements py ON py.id = p.py_id
        JOIN tally_trial_balance t ON t.engagement_id = p.py_id
        WHERE coalesce(cy.coa_mapping->t.ledger_name->>'code',
                       py.coa_mapping->t.ledger_name->>'code') IN (${codes})
        GROUP BY p.cy_id
      `);
      for (const r of rows) map[r.cy_id] = Number(r.coa);
    }
    coaPyPL[def.key] = map;
  } else {
    // BS: pull from CY TB opening_balance using opening_type
    const opExpr = signedSumExprOpening(def.nature);
    const rows = dbQuery(`
      SELECT e.id,
        round(sum(${opExpr})::numeric, 2) as coa
      FROM audit_engagements e
      JOIN tally_trial_balance t ON t.engagement_id = e.id
      WHERE e.is_py_shell = false
        AND jsonb_typeof(e.coa_mapping) = 'object'
        AND (e.coa_mapping->t.ledger_name->>'code') IN (${codes})
      GROUP BY e.id
    `);
    coaPyBS[def.key] = Object.fromEntries(rows.map((r) => [r.id, Number(r.coa)]));
  }
  log(`  âœ“ ${def.key}  (CY rows: ${cyRows.length})`);
}

// â”€â”€â”€ Step 3: note totals (raw key-sum from cy_data / py_data) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

log("\nStep 3: fetching note totals...");

const noteTypesList = NOTE_DEFS.map((d) => `'${d.key}'`).join(",");

// Pull cy_data and py_data; compute totals client-side (we also want _custom_rows).
const noteRows = dbQuery(`
  SELECT engagement_id, note_type, cy_data, py_data
  FROM nce_financial_notes
  WHERE note_type IN (${noteTypesList})
`);
log(`  Notes fetched: ${noteRows.length}`);

function asObj(v) {
  if (v == null) return {};
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return typeof v === "object" ? v : {};
}

function sumKeys(obj) {
  let s = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_")) continue;
    const n = typeof v === "number"
      ? v
      : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())
        ? Number(v)
        : null;
    if (n !== null) s += n;
  }
  return r2(s);
}

// nest by note_type â†’ engagement_id
const noteIndex = {};
for (const row of noteRows) {
  (noteIndex[row.note_type] ??= {})[row.engagement_id] = row;
}

function noteTotals(def, row) {
  if (!row) return null;
  const cy = asObj(row.cy_data);
  const py = asObj(row.py_data);
  const customRows = Array.isArray(cy._custom_rows) ? cy._custom_rows : [];
  const attached = customRows.filter((c) => c.attachedTo);

  let noteCy = sumKeys(cy);
  let notePy = sumKeys(py);

  // cogs note holds only cogs_a-style keys (raw_purch / raw_purch_lt / raw_purch_st
  // / custom_* rows). cogs_c (changes-in-stock) is stored differently and is
  // not part of the NCE_COGS comparison per spec.

  return {
    noteCy,
    notePy,
    customRows,
    attachedCount: attached.length,
    cyData: cy,
    pyData: py,
  };
}

// â”€â”€â”€ Step 4: per (engagement Ã— note) cell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

log("\nStep 4: cross-tabulating drift...");

const cells = []; // { eng, def, coaCy, noteCy, cyDrift, coaPy, notePy, pyDrift, attachedFlag, status }

for (const eng of engagements) {
  for (const def of NOTE_DEFS) {
    const noteRow = (noteIndex[def.key] || {})[eng.id];
    const totals = noteTotals(def, noteRow);
    const coaCyVal = coaCy[def.key][eng.id] ?? 0;
    const coaPyVal = isPL(def)
      ? (eng._shell ? (coaPyPL[def.key][eng.id] ?? 0) : null)
      : (coaPyBS[def.key][eng.id] ?? 0);
    const noteCy = totals ? totals.noteCy : null;
    const notePy = totals ? totals.notePy : null;
    const cyDrift = totals ? r2(coaCyVal - noteCy) : r2(coaCyVal);
    const pyDrift = coaPyVal === null ? null : (totals ? r2(coaPyVal - notePy) : r2(coaPyVal));

    const coaIsZero = Math.abs(coaCyVal) < DRIFT_TOL && (coaPyVal === null || Math.abs(coaPyVal) < DRIFT_TOL);
    const cyBad = Math.abs(cyDrift) > DRIFT_TOL;
    const pyBad = pyDrift !== null && Math.abs(pyDrift) > DRIFT_TOL;

    let status;
    if (!noteRow) {
      status = coaIsZero ? "no_note_no_data" : "no_note";
    } else {
      status = (cyBad || pyBad) ? "DRIFT" : "OK";
    }

    cells.push({
      eng, def,
      coaCy: coaCyVal,
      noteCy,
      cyDrift,
      coaPy: coaPyVal,
      notePy,
      pyDrift,
      attachedFlag: totals && totals.attachedCount > 0,
      attachedCount: totals ? totals.attachedCount : 0,
      hasNote: !!noteRow,
      status,
      totals,
    });
  }
}

const drifted = cells.filter((c) => c.status === "DRIFT" || c.status === "no_note");
log(`  Total cells: ${cells.length}`);
log(`  Drifted/missing: ${drifted.length}`);

// â”€â”€â”€ Step 5: pattern classification for drifted cells â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

log("\nStep 5: classifying drift patterns...");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function ledgerDetailCy(eng, def) {
  const codes = codeList(def.codes);
  const expr = signedSumExpr("balance_type", def.nature);
  return dbQuery(`
    SELECT t.ledger_name,
      upper(t.balance_type) as bt,
      round(abs(t.closing_balance)::numeric, 2) as abs_bal,
      round((${expr})::numeric, 2) as amt
    FROM tally_trial_balance t, audit_engagements e
    WHERE t.engagement_id = '${eng.id}' AND e.id = t.engagement_id
      AND (e.coa_mapping->t.ledger_name->>'code') IN (${codes})
    ORDER BY t.ledger_name
  `).map((x) => ({ ledger: x.ledger_name, bt: x.bt, abs: Number(x.abs_bal), amt: Number(x.amt) }));
}

function ledgerDetailPy(eng, def) {
  if (!eng._shell) return [];
  const codes = codeList(def.codes);
  if (isPL(def)) {
    const expr = signedSumExpr("balance_type", def.nature);
    return dbQuery(`
      SELECT t.ledger_name,
        upper(t.balance_type) as bt,
        round(abs(t.closing_balance)::numeric, 2) as abs_bal,
        round((${expr})::numeric, 2) as amt
      FROM tally_trial_balance t
      JOIN audit_engagements cy ON cy.id = '${eng.id}'
      JOIN audit_engagements py ON py.id = '${eng._shell.id}'
      WHERE t.engagement_id = '${eng._shell.id}'
        AND coalesce(cy.coa_mapping->t.ledger_name->>'code',
                     py.coa_mapping->t.ledger_name->>'code') IN (${codes})
      ORDER BY t.ledger_name
    `).map((x) => ({ ledger: x.ledger_name, bt: x.bt, abs: Number(x.abs_bal), amt: Number(x.amt) }));
  }
  // BS PY: comes from CY TB opening
  const expr = signedSumExprOpening(def.nature);
  return dbQuery(`
    SELECT t.ledger_name,
      upper(t.opening_type) as bt,
      round(abs(t.opening_balance)::numeric, 2) as abs_bal,
      round((${expr})::numeric, 2) as amt
    FROM tally_trial_balance t, audit_engagements e
    WHERE t.engagement_id = '${eng.id}' AND e.id = t.engagement_id
      AND (e.coa_mapping->t.ledger_name->>'code') IN (${codes})
    ORDER BY t.ledger_name
  `).map((x) => ({ ledger: x.ledger_name, bt: x.bt, abs: Number(x.abs_bal), amt: Number(x.amt) }));
}

function noteLedgerMaps(totals) {
  const cyMap = new Map();
  const pyMap = new Map();
  const add = (m, l, a) => m.set(l, r2((m.get(l) || 0) + (Number(a) || 0)));
  const srcObj = asObj(totals.cyData._cy_sources);
  for (const arr of Object.values(srcObj)) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      if (!s || !s.ledger) continue;
      add(cyMap, s.ledger, s.amountCy ?? s.amount);
      add(pyMap, s.ledger, s.amountPy);
    }
  }
  for (const cr of totals.customRows) {
    if (!Array.isArray(cr.sources)) continue;
    for (const s of cr.sources) {
      if (!s || !s.ledger) continue;
      add(cyMap, s.ledger, s.amountCy ?? s.amount);
      add(pyMap, s.ledger, s.amountPy);
    }
  }
  return { cyMap, pyMap };
}

function classify(cell, cyLedgers, pyLedgers) {
  const patterns = new Set();
  const evidence = [];

  if (!cell.hasNote) {
    patterns.add("P5");
    evidence.push("Note row absent from nce_financial_notes despite COA balances.");
    return { patterns: [...patterns], evidence };
  }

  if (
    cell.noteCy === 0 && (cell.notePy ?? 0) === 0 &&
    (Math.abs(cell.coaCy) > DRIFT_TOL || (cell.coaPy ?? 0) > DRIFT_TOL)
  ) {
    patterns.add("P5");
    evidence.push("Note exists but every numeric key is 0 / missing while COA has balances.");
  }

  const { cyMap, pyMap } = noteLedgerMaps(cell.totals);
  const noteSrcCyNorms = new Set([...cyMap.keys()].map(norm));
  const noteSrcPyNorms = new Set([...pyMap.keys()].map(norm));
  const customLabelNorms = new Set(cell.totals.customRows.map((c) => norm(c.label)));

  const cyBad = Math.abs(cell.cyDrift) > DRIFT_TOL;
  const pyBad = cell.pyDrift !== null && Math.abs(cell.pyDrift) > DRIFT_TOL;

  // â”€â”€ Sign error detection (P1) â”€â”€
  // For DR-natural notes: a CR-balance ledger contributes negative; if note
  // captured it as positive, sign error.  For CR-natural notes: opposite.
  if (cyBad) {
    for (const l of cyLedgers) {
      const nv = cyMap.get(l.ledger);
      if (nv === undefined || nv === 0) continue;
      // Sign-error: note value = +abs but COA value = -abs (or vice-versa)
      if (l.amt !== 0 && Math.sign(nv) !== Math.sign(l.amt) && Math.abs(Math.abs(nv) - Math.abs(l.amt)) < 1) {
        patterns.add("P1");
        evidence.push(`CY sign-flip: '${l.ledger}' COA ${fmt(l.amt)} vs note ${fmt(nv)}`);
      }
    }
  }
  if (pyBad) {
    for (const l of pyLedgers) {
      const nv = pyMap.get(l.ledger);
      if (nv === undefined || nv === 0) continue;
      if (l.amt !== 0 && Math.sign(nv) !== Math.sign(l.amt) && Math.abs(Math.abs(nv) - Math.abs(l.amt)) < 1) {
        patterns.add("P1");
        evidence.push(`PY sign-flip: '${l.ledger}' COA ${fmt(l.amt)} vs note ${fmt(nv)}`);
      }
    }
  }

  // â”€â”€ Missing ledgers (P2) â”€â”€
  if (cyBad) {
    const missing = cyLedgers.filter(
      (l) => l.amt !== 0 &&
        !cyMap.has(l.ledger) &&
        !noteSrcCyNorms.has(norm(l.ledger)) &&
        !customLabelNorms.has(norm(l.ledger))
    );
    if (missing.length) {
      const tot = r2(missing.reduce((s, x) => s + x.amt, 0));
      patterns.add("P2");
      evidence.push(
        `CY missing ${missing.length} ledger(s) sum ${fmt(tot)}: ` +
          missing.slice(0, 8).map((x) => `${x.ledger}=${fmt(x.amt)}`).join("; ") +
          (missing.length > 8 ? " ..." : "")
      );
    }
  }
  if (pyBad) {
    const missing = pyLedgers.filter(
      (l) => l.amt !== 0 &&
        !pyMap.has(l.ledger) &&
        !noteSrcPyNorms.has(norm(l.ledger)) &&
        !customLabelNorms.has(norm(l.ledger))
    );
    if (missing.length) {
      const tot = r2(missing.reduce((s, x) => s + x.amt, 0));
      patterns.add("P2");
      evidence.push(
        `PY missing ${missing.length} ledger(s) sum ${fmt(tot)}: ` +
          missing.slice(0, 8).map((x) => `${x.ledger}=${fmt(x.amt)}`).join("; ") +
          (missing.length > 8 ? " ..." : "")
      );
    }
  }

  // â”€â”€ Stale ledger references (P3) â”€â”€
  if (cyBad) {
    const tbNames = new Set(cyLedgers.map((l) => norm(l.ledger)));
    const extra = [...cyMap.entries()].filter(([l, a]) => a !== 0 && !tbNames.has(norm(l)));
    if (extra.length) {
      const tot = r2(extra.reduce((s, [, a]) => s + a, 0));
      patterns.add("P3");
      evidence.push(
        `CY stale note source ${extra.length} (sum ${fmt(tot)}): ` +
          extra.slice(0, 8).map(([l, a]) => `${l}=${fmt(a)}`).join("; ")
      );
    }
  }

  // â”€â”€ PY-shell-only ledgers (P4) â”€â”€
  // Ledger present in PY note source set but absent from CY TB â†’ P4
  if (cell.pyDrift !== null && cell.totals.customRows.length === 0) {
    // crude heuristic: skip if also classified as P3
  }
  if (pyBad) {
    const pyTbNames = new Set(pyLedgers.map((l) => norm(l.ledger)));
    const extra = [...pyMap.entries()].filter(([l, a]) => a !== 0 && !pyTbNames.has(norm(l)));
    if (extra.length) {
      const tot = r2(extra.reduce((s, [, a]) => s + a, 0));
      patterns.add("P4");
      evidence.push(
        `PY note has ${extra.length} source ledger(s) not in PY TB (sum ${fmt(tot)}): ` +
          extra.slice(0, 8).map(([l, a]) => `${l}=${fmt(a)}`).join("; ")
      );
    }
  }

  // â”€â”€ Pre-fix double-count (P6) â”€â”€
  // static row value = 0 but its sources sum non-zero â†’ previously double-counted
  // and zeroed-out by the smart-match guard
  const srcObj = asObj(cell.totals.cyData._cy_sources);
  for (const [rowId, arr] of Object.entries(srcObj)) {
    if (!Array.isArray(arr)) continue;
    const sCy = r2(arr.reduce((s, x) => s + (Number(x?.amountCy ?? x?.amount) || 0), 0));
    const sPy = r2(arr.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0));
    const vCy = Number(cell.totals.cyData[rowId]) || 0;
    const vPy = Number(cell.totals.pyData[rowId]) || 0;
    if (sCy !== 0 && vCy === 0) {
      patterns.add("P6");
      evidence.push(`CY: row '${rowId}' value 0 but sources sum ${fmt(sCy)} (zeroed by guard).`);
    }
    if (sPy !== 0 && vPy === 0) {
      patterns.add("P6");
      evidence.push(`PY: row '${rowId}' value 0 but sources sum ${fmt(sPy)} (zeroed by guard).`);
    }
  }

  // â”€â”€ Other (P7) catch-all if nothing else matched â”€â”€
  if (patterns.size === 0) {
    patterns.add("P7");
    evidence.push("No known pattern matched; manual review needed.");
  }

  return { patterns: [...patterns].sort(), evidence };
}

// To stay within reasonable runtime, deep-classify ONLY drifted/no_note cells.
let processed = 0;
for (const cell of drifted) {
  processed++;
  const cyLedgers = ledgerDetailCy(cell.eng, cell.def);
  const pyLedgers = cell.eng._shell ? ledgerDetailPy(cell.eng, cell.def) : [];
  if (!cell.hasNote) {
    cell.patterns = ["P5"];
    cell.evidence = ["Note row absent from nce_financial_notes."];
    cell.cyLedgerCount = cyLedgers.length;
    cell.pyLedgerCount = pyLedgers.length;
    continue;
  }
  const c = classify(cell, cyLedgers, pyLedgers);
  cell.patterns = c.patterns;
  cell.evidence = c.evidence;
  cell.cyLedgerCount = cyLedgers.length;
  cell.pyLedgerCount = pyLedgers.length;
  if (processed % 25 === 0) log(`  classified ${processed}/${drifted.length}`);
}
log(`  classified ${processed}/${drifted.length}`);

// â”€â”€â”€ Step 6: build Markdown report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

log("\nStep 6: writing report...");

const lines = [];
const push = (...l) => lines.push(...l);

const driftedCells = cells.filter((c) => c.status === "DRIFT" || c.status === "no_note");
const okCells = cells.filter((c) => c.status === "OK").length;
const nodataCells = cells.filter((c) => c.status === "no_note_no_data").length;

push(`# NCE Notes vs COA Mapping â€” Comprehensive Diagnosis (READ-ONLY)`);
push("");
push(`- Generated: ${new Date().toISOString()}`);
push(`- Engagements (CY active, with COA mapping): **${engagements.length}**`);
push(`- Note types analysed: **${NOTE_DEFS.length}**`);
push(`- Total cells: **${cells.length}** (= engagements Ã— note types)`);
push(`- OK cells: **${okCells}**`);
push(`- Drift cells (>â‚¹${DRIFT_TOL}): **${cells.filter((c) => c.status === "DRIFT").length}**`);
push(`- Missing-note cells (with COA balances): **${cells.filter((c) => c.status === "no_note").length}**`);
push(`- Missing-note cells (no COA balances either â€” benign): ${nodataCells}`);
push("");
push(`## Pattern legend`);
push("");
push(`| Pattern | Meaning |`);
push(`|---|---|`);
push(`| **P1** | Sign error (Cr-balance contra on DR-natural / Dr-balance contra on CR-natural) |`);
push(`| **P2** | Missing ledger â€” TB has it, note doesn't represent it |`);
push(`| **P3** | Stale ledger â€” note has a row whose source ledger doesn't match any TB ledger |`);
push(`| **P4** | PY-shell-only â€” PY note has a value for a ledger absent from CY TB or PY TB |`);
push(`| **P5** | Note empty / absent â€” row missing or all zeros despite COA having values |`);
push(`| **P6** | Pre-fix double-count â€” parent-child source overlap, row zeroed by guard |`);
push(`| **P7** | Other â€” manual review |`);
push("");

// â”€â”€ Per-client summary â”€â”€
push(`## Per-client summary`);
push("");
push(`Counts only DRIFT and no_note cells. Total absolute drift = Î£(|CY drift| + |PY drift|).`);
push("");
push(`| Client | FY | Drift cells | Î£ \|drift\| |`);
push(`|---|---|---:|---:|`);
const byClient = new Map();
for (const c of cells) {
  if (c.status !== "DRIFT" && c.status !== "no_note") continue;
  const key = `${c.eng.client_name}__${c.eng.financial_year}`;
  const cur = byClient.get(key) || { client: c.eng.client_name, fy: c.eng.financial_year, count: 0, drift: 0 };
  cur.count++;
  cur.drift += Math.abs(c.cyDrift || 0) + Math.abs(c.pyDrift || 0);
  byClient.set(key, cur);
}
const clientRows = [...byClient.values()].sort((a, b) => b.drift - a.drift);
for (const r of clientRows) {
  push(`| ${r.client} | ${r.fy} | ${r.count} | ${fmt(r2(r.drift))} |`);
}
push("");
push(`Engagements with **0** drift cells: ${engagements.length - byClient.size}`);
push("");

// â”€â”€ Per-note summary â”€â”€
push(`## Per-note summary`);
push("");
push(`| Note | Drift cells | Î£ \|drift\| | Dominant patterns |`);
push(`|---|---:|---:|---|`);
for (const def of NOTE_DEFS) {
  const noteCells = cells.filter((c) => c.def.key === def.key && (c.status === "DRIFT" || c.status === "no_note"));
  if (noteCells.length === 0) {
    push(`| ${def.key} | 0 | 0 | â€” |`);
    continue;
  }
  const drift = noteCells.reduce((s, c) => s + Math.abs(c.cyDrift || 0) + Math.abs(c.pyDrift || 0), 0);
  const pcount = {};
  for (const c of noteCells) for (const p of c.patterns || []) pcount[p] = (pcount[p] || 0) + 1;
  const pats = Object.entries(pcount).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}(${n})`).join(", ");
  push(`| ${def.key} | ${noteCells.length} | ${fmt(r2(drift))} | ${pats} |`);
}
push("");

// â”€â”€ Detail table â”€â”€
push(`## Detail: every drift / missing-note cell`);
push("");
push(`Sorted by client, then note. Empty rows (OK or no-data) are omitted. ` +
     `Drifted cells where COA-PY is "â€”" mean the CY engagement has no resolvable PY shell.`);
push("");
push(`| Client | FY | Note | Section | COA CY | Note CY | CY Drift | COA PY | Note PY | PY Drift | Attach | Status | Patterns |`);
push(`|---|---|---|---|---:|---:|---:|---:|---:|---:|:---:|---|---|`);
const sortedDrifted = [...driftedCells].sort((a, b) => {
  const ac = a.eng.client_name.localeCompare(b.eng.client_name);
  if (ac) return ac;
  const af = String(a.eng.financial_year).localeCompare(String(b.eng.financial_year));
  if (af) return af;
  return a.def.key.localeCompare(b.def.key);
});
for (const c of sortedDrifted) {
  push(
    `| ${c.eng.client_name} | ${c.eng.financial_year} | ${c.def.key} | ${c.def.section} ` +
    `| ${fmt(c.coaCy)} | ${c.hasNote ? fmt(c.noteCy) : "â€”"} | ${fmt(c.cyDrift)} ` +
    `| ${c.coaPy === null ? "no shell" : fmt(c.coaPy)} | ${c.hasNote ? fmt(c.notePy) : "â€”"} | ${c.pyDrift === null ? "â€”" : fmt(c.pyDrift)} ` +
    `| ${c.attachedFlag ? `y(${c.attachedCount})` : "n"} | ${c.status} | ${(c.patterns || []).join("+")} |`
  );
}
push("");

// â”€â”€ Caveats: attached custom rows â”€â”€
const caveats = cells.filter((c) => c.attachedFlag);
if (caveats.length) {
  push(`## Caveat: notes with custom rows attached to a parent (attachedTo)`);
  push("");
  push(`Raw key-sum may double-count when both parent value and child custom row hold the same source.`);
  push("");
  push(`| Client | FY | Note | # attached |`);
  push(`|---|---|---|---:|`);
  for (const c of caveats) {
    push(`| ${c.eng.client_name} | ${c.eng.financial_year} | ${c.def.key} | ${c.attachedCount} |`);
  }
  push("");
}

// â”€â”€ Deep dive (evidence) for drifted cells â”€â”€
push(`## Deep dive (evidence per drifted cell)`);
push("");
push(`For each drifted / missing-note cell, pattern classifications and supporting evidence are below.`);
push("");
for (const c of sortedDrifted) {
  push(`### ${c.eng.client_name} (${c.eng.financial_year}) â€” ${c.def.key} [${c.def.section}]`);
  push(``);
  push(`- COA CY: **${fmt(c.coaCy)}**  | Note CY: **${c.hasNote ? fmt(c.noteCy) : "â€”"}**  | CY Drift: **${fmt(c.cyDrift)}**`);
  push(`- COA PY: **${c.coaPy === null ? "no shell" : fmt(c.coaPy)}**  | Note PY: **${c.hasNote ? fmt(c.notePy) : "â€”"}**  | PY Drift: **${c.pyDrift === null ? "â€”" : fmt(c.pyDrift)}**`);
  push(`- Patterns: **${(c.patterns || []).join("+") || "â€”"}**  ${c.attachedFlag ? `| attachedTo flag: y (${c.attachedCount})` : ""}`);
  if (c.evidence && c.evidence.length) {
    push("");
    for (const e of c.evidence) push(`  - ${e}`);
  }
  push("");
}

push(`---`);
push(`*End of report â€” READ-ONLY, no data modified.*`);

writeFileSync(REPORT_PATH, lines.join("\n"), "utf-8");
log(`\nâœ“ Report written: ${REPORT_PATH}`);
log(`  Lines: ${lines.length}`);
log(`  Drifted cells classified: ${drifted.length}`);
