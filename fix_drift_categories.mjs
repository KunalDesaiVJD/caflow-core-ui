/**
 * fix_drift_categories.mjs — surgical drift fixes across 4 categories.
 *
 * Approach:
 *   1. Read note + COA mapping + TB
 *   2. Compute patch (which keys move from old → new value)
 *   3. UPDATE with jsonb concatenation so only changed keys touch the row
 *   4. Read back and verify each cell took effect
 *   5. Log before/after
 *
 * NEVER touches a cell that's already correct.
 *
 * Sign convention (single source of truth, mirrored from src/lib/fsSignConvention.ts):
 *   CR-natural (borrowings, other_lt_liab, provisions, trade_payables, other_cl, revenue_ops, other_income):
 *     Cr=+abs, Dr=-abs.
 *   DR-natural (loans_advances, trade_receivables, other_expenses, ...):
 *     Dr=+abs, Cr=-abs.
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";

// ─── DB helper ────────────────────────────────────────────────────────────────

function dbQuery(sql) {
  const clean = sql.replace(/\s+/g, " ").trim();
  if (clean.includes("%")) {
    throw new Error("SAFETY: SQL contains '%' which is unsafe for cmd quoting: " + clean.slice(0, 120));
  }
  // Escape embedded double quotes for cmd-style quoting on Windows.
  const escaped = clean.replace(/"/g, '\\"');
  const raw = execSync(`npx supabase db query --linked "${escaped}"`, {
    encoding: "utf-8",
    maxBuffer: 200 * 1024 * 1024,
    timeout: 180_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) throw new Error("No JSON in db query output: " + raw.slice(0, 300));
  const parsed = JSON.parse(raw.slice(jsonStart));
  return parsed.rows ?? [];
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) =>
  n === null || n === undefined ? "n/a" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function asObj(v) {
  if (v == null) return {};
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return typeof v === "object" ? v : {};
}

// ─── Sign convention (mirror of src/lib/fsSignConvention.ts) ──────────────────

const NOTE_NATURE = {
  borrowings: "CR", other_lt_liab: "CR", provisions: "CR", trade_payables: "CR",
  other_cl: "CR", revenue_ops: "CR", other_income: "CR",
  cwip: "DR", investments: "DR", loans_advances: "DR", other_nc_assets: "DR",
  inventories: "DR", trade_receivables: "DR", cash_bank: "DR", other_ca: "DR",
  cogs: "DR", employee_exp: "DR", finance_costs: "DR", other_expenses: "DR",
};

function signedAmt(abs, balanceType, noteType) {
  const a = Math.abs(Number(abs) || 0);
  if (a === 0) return 0;
  const nature = NOTE_NATURE[noteType] || "CR";
  const side = String(balanceType || "").trim().toUpperCase();
  if (side !== "DR" && side !== "CR") return nature === "CR" ? +a : -a;
  return side === nature ? +a : -a;
}

// ─── Engagement directory ─────────────────────────────────────────────────────

// CY engagement id → { name, fy, pyShellId }
const ENGAGEMENTS = {
  "de5f2adf-352f-47d8-a754-5c54a1552f93": { name: "REVTI INFRA",        fy: "2025-26", pyShellId: "5fa140f6-62f8-44c3-a916-ab31fe4fe563" },
  "11277a70-eb1b-429b-98bf-b5b5b6dd0559": { name: "SHREEYAM INFRA",     fy: "2025-26", pyShellId: null /* fill below */ },
  "66a33079-de05-4b7f-9df8-0fa5e63a9297": { name: "SUKIRTI DEVELOPERS", fy: "2025-26", pyShellId: "38d07b45-179d-482f-be1d-0585ac51a03d" },
  "e11aebd4-6e1e-481c-90dc-7dff556dc5cb": { name: "MAHIL INFRA",        fy: "2025-26", pyShellId: "a0c07c6a-4a42-45be-9c0a-36dbe7b8b854" },
  "70563956-c474-4b78-b2e6-6c2ead600efd": { name: "MAHARSH INFRA",      fy: "2025-26", pyShellId: "92c7b13c-c7bd-45b1-9f58-b3a2dbe229fa" },
  "b2f5819b-dda9-4743-935b-fd9b8810bb02": { name: "SWASTIK BUILDCON",   fy: "2025-26", pyShellId: "38902a79-6508-4dea-baf1-45ef31a27087" },
  "22495b77-4573-41aa-bbcc-52a187918954": { name: "SKYLARK CORPORATION", fy: "2025-26", pyShellId: "b650730a-04c6-47ff-9a61-1b3bfad66557" },
  "31bd3aca-c3f8-48b4-b876-7b7e2ddbacac": { name: "NIRALI PERFUMERY",    fy: "2025-26", pyShellId: "ef64ab1b-fc76-4243-b8b3-41f058d1dc36" },
  "70b72e50-f35d-4aac-adbb-ed9ac6a49ce0": { name: "SATVA BUILDCON",      fy: "2025-26", pyShellId: "5c1224e9-f0aa-4b47-9d1d-382350871b6b" },
  "9dfac4d8-8e1a-4b7e-b40d-8ee2562d8dac": { name: "BHAKTI INFRA",        fy: "2025-26", pyShellId: "8224b0d9-5618-48b3-a02d-bce9e5b36a9a" },
};

// Look up SHREEYAM PY shell (227da3e7 client)
const shreeyamShell = dbQuery(`SELECT id FROM audit_engagements WHERE is_py_shell=true AND client_id='227da3e7-a9ac-4869-a3d7-4f145bb46532'`);
if (shreeyamShell.length) ENGAGEMENTS["11277a70-eb1b-429b-98bf-b5b5b6dd0559"].pyShellId = shreeyamShell[0].id;
console.log(`SHREEYAM PY shell: ${ENGAGEMENTS["11277a70-eb1b-429b-98bf-b5b5b6dd0559"].pyShellId}`);

// ─── Helpers: fetch note + COA TB ─────────────────────────────────────────────

function fetchNote(engId, noteType) {
  const rows = dbQuery(`SELECT cy_data, py_data FROM nce_financial_notes WHERE engagement_id='${engId}' AND note_type='${noteType}'`);
  if (!rows.length) return null;
  return { cy: asObj(rows[0].cy_data), py: asObj(rows[0].py_data) };
}

/** Returns [{ ledger_name, balance_type, closing_balance, opening_type, opening_balance, fs_code }] */
function fetchTbByCodes(engId, codes) {
  const codesIn = codes.map((c) => `'${c}'`).join(",");
  return dbQuery(`
    SELECT t.ledger_name, t.balance_type, t.closing_balance, t.opening_type, t.opening_balance,
      e.coa_mapping->t.ledger_name->>'code' as fs_code
    FROM tally_trial_balance t JOIN audit_engagements e ON e.id=t.engagement_id
    WHERE t.engagement_id='${engId}' AND (e.coa_mapping->t.ledger_name->>'code') IN (${codesIn})
  `).map((r) => ({
    ledger: r.ledger_name,
    balance_type: r.balance_type,
    closing: Number(r.closing_balance) || 0,
    opening_type: r.opening_type,
    opening: Number(r.opening_balance) || 0,
    fs_code: r.fs_code,
  }));
}

// ─── Patch builder helpers ────────────────────────────────────────────────────

/** Build the SQL UPDATE for a note. patch keys map to {old, new}. Only writes keys
 *  whose new value differs from current (numeric inequality, two decimals). */
function buildUpdate(engId, noteType, patches) {
  // patches: { cy: { key: { old, new } }, py: { key: { old, new } } }
  const cyChanges = Object.entries(patches.cy || {}).filter(([, v]) => r2(v.old) !== r2(v.new));
  const pyChanges = Object.entries(patches.py || {}).filter(([, v]) => r2(v.old) !== r2(v.new));
  if (!cyChanges.length && !pyChanges.length) return { sql: null, cyChanges, pyChanges };
  const toJson = (changes) => {
    const obj = {};
    for (const [k, v] of changes) obj[k] = r2(v.new);
    return JSON.stringify(obj);
  };
  const setParts = [];
  if (cyChanges.length) setParts.push(`cy_data = cy_data || '${toJson(cyChanges)}'::jsonb`);
  if (pyChanges.length) setParts.push(`py_data = py_data || '${toJson(pyChanges)}'::jsonb`);
  setParts.push(`updated_at = NOW()`);
  const sql = `UPDATE nce_financial_notes SET ${setParts.join(", ")} WHERE engagement_id='${engId}' AND note_type='${noteType}'`;
  return { sql, cyChanges, pyChanges };
}

function execUpdate(sql) {
  // ensure we capture rows affected
  const wrapped = `WITH upd AS (${sql} RETURNING 1) SELECT count(*)::int as updated FROM upd`;
  return dbQuery(wrapped);
}

// ─── Logging ──────────────────────────────────────────────────────────────────

const log = [];
function logFix(client, note, key, side, before, after) {
  log.push({ client, note, key, side, before: r2(before), after: r2(after) });
  console.log(`    [${side}] ${key}: ${fmt(before)} → ${fmt(after)}`);
}

// ─── CATEGORY 1: Pattern A LT/ST duplication ─────────────────────────────────

console.log("\n=================================================================");
console.log("CATEGORY 1 — Pattern A LT/ST duplication");
console.log("=================================================================");

const CAT1_TARGETS = [
  { engId: "de5f2adf-352f-47d8-a754-5c54a1552f93", note: "borrowings" },
  { engId: "de5f2adf-352f-47d8-a754-5c54a1552f93", note: "loans_advances" },
  { engId: "11277a70-eb1b-429b-98bf-b5b5b6dd0559", note: "borrowings" },
  { engId: "66a33079-de05-4b7f-9df8-0fa5e63a9297", note: "borrowings" },
  { engId: "66a33079-de05-4b7f-9df8-0fa5e63a9297", note: "loans_advances" },
  { engId: "e11aebd4-6e1e-481c-90dc-7dff556dc5cb", note: "borrowings", pyOnly: true },
  { engId: "70563956-c474-4b78-b2e6-6c2ead600efd", note: "borrowings", pyOnly: true },
  { engId: "70563956-c474-4b78-b2e6-6c2ead600efd", note: "loans_advances", pyOnly: true },
];

const CODES_FOR_NOTE = {
  borrowings:       { lt: ["NCE_LTB", "BS_NCL_LTB"], st: ["NCE_STB", "BS_CL_STB"] },
  loans_advances:   { lt: ["NCE_LTLA", "BS_NCA_LLA"], st: ["NCE_STLA", "BS_CA_SLA"] },
};

for (const t of CAT1_TARGETS) {
  const eng = ENGAGEMENTS[t.engId];
  console.log(`\n▶ ${eng.name} — ${t.note}${t.pyOnly ? "  (PY-only fix)" : ""}`);

  const note = fetchNote(t.engId, t.note);
  if (!note) { console.log("  ! no note row found, skipping"); continue; }

  const customRows = Array.isArray(note.cy._custom_rows) ? note.cy._custom_rows : [];
  if (!customRows.length) { console.log("  ! no custom rows, skipping"); continue; }

  // Build label → fs_code map from CY TB (active engagement)
  const cy = CODES_FOR_NOTE[t.note];
  const tbCy = fetchTbByCodes(t.engId, [...cy.lt, ...cy.st]);
  const tbPy = fetchTbByCodes(eng.pyShellId, [...cy.lt, ...cy.st]);

  const ledgerSide = new Map(); // normLabel → "lt"|"st"
  for (const r of tbCy) {
    const side = cy.lt.includes(r.fs_code) ? "lt" : cy.st.includes(r.fs_code) ? "st" : null;
    if (side) ledgerSide.set(norm(r.ledger), side);
  }
  // PY shell ledgers (in case some only appear in PY)
  for (const r of tbPy) {
    if (ledgerSide.has(norm(r.ledger))) continue;
    const side = cy.lt.includes(r.fs_code) ? "lt" : cy.st.includes(r.fs_code) ? "st" : null;
    if (side) ledgerSide.set(norm(r.ledger), side);
  }

  const patches = { cy: {}, py: {} };
  for (const cr of customRows) {
    const side = ledgerSide.get(norm(cr.label));
    if (!side) continue; // not TB-matched — leave alone

    const ltKey = `${cr.id}_lt`;
    const stKey = `${cr.id}_st`;
    const cyLt = Number(note.cy[ltKey]) || 0;
    const cyStV = Number(note.cy[stKey]) || 0;
    const pyLt = Number(note.py[ltKey]) || 0;
    const pyStV = Number(note.py[stKey]) || 0;

    const sameSign = (a, b) => r2(a) !== 0 && r2(b) !== 0 && r2(a) === r2(b);

    // Skip if not actually duplicated (only one side has a value)
    const cyDup = sameSign(cyLt, cyStV);
    const pyDup = sameSign(pyLt, pyStV);
    if (!cyDup && !pyDup) continue;

    if (!t.pyOnly && cyDup) {
      const zeroKey = side === "lt" ? stKey : ltKey;
      patches.cy[zeroKey] = { old: note.cy[zeroKey], new: 0 };
    }
    if (pyDup) {
      const zeroKey = side === "lt" ? stKey : ltKey;
      patches.py[zeroKey] = { old: note.py[zeroKey], new: 0 };
    }
  }

  const { sql, cyChanges, pyChanges } = buildUpdate(t.engId, t.note, patches);
  if (!sql) { console.log("  nothing to change"); continue; }

  console.log(`  Patch: CY ${cyChanges.length} keys, PY ${pyChanges.length} keys`);
  for (const [k, v] of cyChanges) logFix(eng.name, t.note, k, "CY", v.old, v.new);
  for (const [k, v] of pyChanges) logFix(eng.name, t.note, k, "PY", v.old, v.new);

  execUpdate(sql);

  // verify
  const after = fetchNote(t.engId, t.note);
  let ok = true;
  for (const [k, v] of cyChanges) {
    const actual = r2(after.cy[k]);
    if (actual !== r2(v.new)) { ok = false; console.log(`  VERIFY FAIL CY.${k}: expected ${v.new} got ${actual}`); }
  }
  for (const [k, v] of pyChanges) {
    const actual = r2(after.py[k]);
    if (actual !== r2(v.new)) { ok = false; console.log(`  VERIFY FAIL PY.${k}: expected ${v.new} got ${actual}`); }
  }
  if (!ok) { console.error("  STOPPING — verify failed"); process.exit(1); }
  console.log("  verified.");
}

// ─── CATEGORY 2: Kasar Vatav / Round Off sign errors ─────────────────────────

console.log("\n=================================================================");
console.log("CATEGORY 2 — Sign errors on other_expenses (Kasar/Vatav/RoundOff)");
console.log("=================================================================");

const CAT2_TARGETS = [
  { engId: "70563956-c474-4b78-b2e6-6c2ead600efd", side: "cy" },
  { engId: "b2f5819b-dda9-4743-935b-fd9b8810bb02", side: "both" },
  { engId: "11277a70-eb1b-429b-98bf-b5b5b6dd0559", side: "py" },
  { engId: "22495b77-4573-41aa-bbcc-52a187918954", side: "py" },
];

const PATTERN_NAMES = ["kasar", "vatav", "round off", "roundoff"];

for (const t of CAT2_TARGETS) {
  const eng = ENGAGEMENTS[t.engId];
  console.log(`\n▶ ${eng.name} — other_expenses (side=${t.side})`);
  const note = fetchNote(t.engId, "other_expenses");
  if (!note) { console.log("  ! no note row"); continue; }

  const cyTb = fetchTbByCodes(t.engId, ["NCE_OTH_EXP", "PL_EXP_OTH", "PL_EXP_OEX"]);
  const pyTb = fetchTbByCodes(eng.pyShellId, ["NCE_OTH_EXP", "PL_EXP_OTH", "PL_EXP_OEX"]);

  // Helper: find TB ledger by name (case-insensitive)
  const cyTbByNorm = new Map(cyTb.map((r) => [norm(r.ledger), r]));
  const pyTbByNorm = new Map(pyTb.map((r) => [norm(r.ledger), r]));

  const isPatternLabel = (label) => {
    const n = norm(label);
    return PATTERN_NAMES.some((p) => n.includes(norm(p)));
  };

  const customRows = Array.isArray(note.cy._custom_rows) ? note.cy._custom_rows : [];
  const cySources = asObj(note.cy._cy_sources);

  const patches = { cy: {}, py: {} };

  // 1) Custom rows whose label matches a Kasar/Vatav/RoundOff pattern
  for (const cr of customRows) {
    if (!isPatternLabel(cr.label)) continue;
    const cyTbRow = cyTbByNorm.get(norm(cr.label));
    const pyTbRow = pyTbByNorm.get(norm(cr.label));
    const expectedCy = cyTbRow ? signedAmt(cyTbRow.closing, cyTbRow.balance_type, "other_expenses") : null;
    const expectedPy = pyTbRow ? signedAmt(pyTbRow.closing, pyTbRow.balance_type, "other_expenses") : null;

    if (t.side === "cy" || t.side === "both") {
      const cur = Number(note.cy[cr.id]) || 0;
      if (expectedCy !== null && r2(cur) === r2(Math.abs(expectedCy)) && r2(expectedCy) < 0) {
        patches.cy[cr.id] = { old: cur, new: expectedCy };
      }
    }
    if (t.side === "py" || t.side === "both") {
      const cur = Number(note.py[cr.id]) || 0;
      if (expectedPy !== null && r2(cur) === r2(Math.abs(expectedPy)) && r2(expectedPy) < 0) {
        patches.py[cr.id] = { old: cur, new: expectedPy };
      }
    }
  }

  // 2) Static rows where _cy_sources includes a Kasar/Vatav/RoundOff ledger with wrong sign
  for (const [rowId, sources] of Object.entries(cySources)) {
    if (!Array.isArray(sources)) continue;
    const patternSrc = sources.filter((s) => isPatternLabel(s?.ledger));
    if (!patternSrc.length) continue;
    // Compute the correctly-signed sources-sum (sources already store the signed amountCy/amountPy)
    const correctCy = r2(sources.reduce((s, x) => s + (Number(x?.amountCy ?? x?.amount) || 0), 0));
    const correctPy = r2(sources.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0));
    const currentCy = r2(Number(note.cy[rowId]) || 0);
    const currentPy = r2(Number(note.py[rowId]) || 0);
    if ((t.side === "cy" || t.side === "both") && currentCy !== correctCy) {
      patches.cy[rowId] = { old: currentCy, new: correctCy };
    }
    if ((t.side === "py" || t.side === "both") && currentPy !== correctPy) {
      patches.py[rowId] = { old: currentPy, new: correctPy };
    }
  }

  // 3) SKYLARK PY: double-count detection — static row PY equals custom row PY for same ledger
  if (t.engId === "22495b77-4573-41aa-bbcc-52a187918954") {
    // For each custom row with a label that ALSO matches a static row's _cy_sources ledger,
    // and where note.py[customId] == note.py[staticId] and the static row's source PY value
    // is identical to the custom row PY value, the static is double-counted; zero the static.
    const staticToCustomDup = [];
    for (const [rowId, sources] of Object.entries(cySources)) {
      if (!Array.isArray(sources)) continue;
      const staticPy = r2(Number(note.py[rowId]) || 0);
      if (staticPy === 0) continue;
      // sources sum PY:
      const srcSumPy = r2(sources.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0));
      // For each ledger in sources, check if any custom row has same label and same PY value
      for (const s of sources) {
        const lab = norm(s?.ledger);
        const cr = customRows.find((c) => norm(c.label) === lab || norm(c.label).includes(lab) || lab.includes(norm(c.label)));
        if (!cr) continue;
        const customPy = r2(Number(note.py[cr.id]) || 0);
        if (customPy !== 0 && r2(customPy) === r2(s.amountPy)) {
          staticToCustomDup.push({ rowId, lab: s.ledger, staticPy, customPy, srcSumPy });
        }
      }
    }
    if (staticToCustomDup.length) {
      console.log(`  SKYLARK PY double-counts detected:`);
      for (const d of staticToCustomDup) {
        console.log(`    static '${d.rowId}' PY=${fmt(d.staticPy)}  (sources ledger '${d.lab}' PY=${fmt(d.customPy)} also lives in custom row)`);
      }
      // For each affected static row, zero its PY (assumption: custom row already captures the ledger)
      const affectedRows = [...new Set(staticToCustomDup.map((d) => d.rowId))];
      for (const rowId of affectedRows) {
        const cur = Number(note.py[rowId]) || 0;
        if (cur !== 0) patches.py[rowId] = { old: cur, new: 0 };
      }
    }
  }

  const { sql, cyChanges, pyChanges } = buildUpdate(t.engId, "other_expenses", patches);
  if (!sql) { console.log("  nothing to change"); continue; }
  console.log(`  Patch: CY ${cyChanges.length} keys, PY ${pyChanges.length} keys`);
  for (const [k, v] of cyChanges) logFix(eng.name, "other_expenses", k, "CY", v.old, v.new);
  for (const [k, v] of pyChanges) logFix(eng.name, "other_expenses", k, "PY", v.old, v.new);

  execUpdate(sql);
  const after = fetchNote(t.engId, "other_expenses");
  let ok = true;
  for (const [k, v] of cyChanges) if (r2(after.cy[k]) !== r2(v.new)) { ok = false; console.log(`  VERIFY FAIL CY.${k}`); }
  for (const [k, v] of pyChanges) if (r2(after.py[k]) !== r2(v.new)) { ok = false; console.log(`  VERIFY FAIL PY.${k}`); }
  if (!ok) { console.error("  STOPPING — verify failed"); process.exit(1); }
  console.log("  verified.");
}

// ─── CATEGORY 3: Small P2 missing-ledger drifts ──────────────────────────────

console.log("\n=================================================================");
console.log("CATEGORY 3 — Small P2 missing-ledger drifts (PY side)");
console.log("=================================================================");

// Smart-match map: (noteType, ledger-name-keyword) → static row id
const SMART_MAP = {
  provisions: [
    { match: /(audit\s*fee|unpaid\s*audit)/i, rowId: "audit_fees_payable" },
    { match: /(electric|electricity)/i, rowId: "other_provisions" },
    { match: /(professional)/i, rowId: "other_provisions" },
    { match: /(unpaid)/i, rowId: "other_provisions" },
  ],
  trade_receivables: [
    { match: /./i, rowId: null }, // need to inspect note
  ],
  other_cl: [
    { match: /./i, rowId: null },
  ],
};

const CAT3_TARGETS = [
  { engId: "31bd3aca-c3f8-48b4-b876-7b7e2ddbacac", note: "provisions" },
  { engId: "31bd3aca-c3f8-48b4-b876-7b7e2ddbacac", note: "trade_receivables" },
  { engId: "70b72e50-f35d-4aac-adbb-ed9ac6a49ce0", note: "provisions" },
  { engId: "e11aebd4-6e1e-481c-90dc-7dff556dc5cb", note: "other_cl" },
];

const CODES_FOR_NOTE_ALL = {
  provisions:        ["NCE_LTP", "NCE_STP", "BS_NCL_LTP", "BS_CL_STP"],
  trade_receivables: ["NCE_TR", "BS_CA_TR"],
  other_cl:          ["NCE_OCL", "BS_CL_OCL"],
};

for (const t of CAT3_TARGETS) {
  const eng = ENGAGEMENTS[t.engId];
  console.log(`\n▶ ${eng.name} — ${t.note}`);
  const note = fetchNote(t.engId, t.note);
  if (!note) { console.log("  ! no note row"); continue; }
  if (!eng.pyShellId) { console.log("  ! no PY shell"); continue; }

  const pyTb = fetchTbByCodes(eng.pyShellId, CODES_FOR_NOTE_ALL[t.note]);

  // Build set of already-represented ledgers (from _cy_sources and custom row sources, plus labels)
  const cySources = asObj(note.cy._cy_sources);
  const customRows = Array.isArray(note.cy._custom_rows) ? note.cy._custom_rows : [];
  const present = new Set();
  for (const arr of Object.values(cySources)) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) if (s?.ledger) present.add(norm(s.ledger));
  }
  for (const cr of customRows) {
    present.add(norm(cr.label));
    if (Array.isArray(cr.sources)) for (const s of cr.sources) if (s?.ledger) present.add(norm(s.ledger));
  }

  const missing = pyTb.filter((r) => Math.abs(r.closing) > 0 && !present.has(norm(r.ledger)));
  if (!missing.length) { console.log("  no missing ledgers"); continue; }

  console.log(`  ${missing.length} missing PY ledger(s):`);
  for (const m of missing) console.log(`    ${m.ledger}  closing=${fmt(m.closing)} ${m.balance_type}`);

  // For each missing ledger, decide static row to add it to.
  // For provisions+ small cases: try smart-match map, else use "other_provisions" fallback.
  const patches = { cy: {}, py: {} };
  const fallbackRow = {
    provisions: "other_provisions",
    other_cl: "other_payables",
    trade_receivables: "other_debtors_unsec_cons_good",
  };

  // Inspect note for valid static row ids by probing existing keys
  const probeKeys = (data) => Object.keys(data).filter((k) => !k.startsWith("_"));
  const validStaticIds = new Set([...probeKeys(note.cy), ...probeKeys(note.py)]);

  for (const m of missing) {
    const signed = signedAmt(m.closing, m.balance_type, t.note);
    let target = null;
    const candidates = SMART_MAP[t.note] || [];
    for (const c of candidates) {
      if (c.rowId && validStaticIds.has(c.rowId) && c.match.test(m.ledger)) { target = c.rowId; break; }
    }
    if (!target) {
      const fb = fallbackRow[t.note];
      if (fb && validStaticIds.has(fb)) target = fb;
    }
    if (!target) {
      // pick the first existing key as a last resort (with PY value > 0 implies "real"), else skip
      const firstReal = [...validStaticIds].find((k) => (Number(note.py[k]) || 0) !== 0);
      target = firstReal;
    }
    if (!target) {
      console.log(`    ! no target row for '${m.ledger}', skipping`);
      continue;
    }
    const cur = Number(note.py[target]) || 0;
    const newVal = r2(cur + signed);
    if (!patches.py[target]) patches.py[target] = { old: cur, new: newVal };
    else patches.py[target] = { old: patches.py[target].old, new: r2(patches.py[target].new + signed) };
    console.log(`    → add ${fmt(signed)} to PY '${target}' (was ${fmt(cur)})`);
  }

  const { sql, cyChanges, pyChanges } = buildUpdate(t.engId, t.note, patches);
  if (!sql) { console.log("  nothing to change"); continue; }
  for (const [k, v] of cyChanges) logFix(eng.name, t.note, k, "CY", v.old, v.new);
  for (const [k, v] of pyChanges) logFix(eng.name, t.note, k, "PY", v.old, v.new);
  execUpdate(sql);
  const after = fetchNote(t.engId, t.note);
  let ok = true;
  for (const [k, v] of cyChanges) if (r2(after.cy[k]) !== r2(v.new)) { ok = false; console.log(`  VERIFY FAIL CY.${k}`); }
  for (const [k, v] of pyChanges) if (r2(after.py[k]) !== r2(v.new)) { ok = false; console.log(`  VERIFY FAIL PY.${k}`); }
  if (!ok) { console.error("  STOPPING — verify failed"); process.exit(1); }
  console.log("  verified.");
}

// ─── Verification summary ─────────────────────────────────────────────────────

console.log("\n=================================================================");
console.log("FINAL VERIFICATION — recompute COA vs Note totals");
console.log("=================================================================");

const verification = [];

function noteTotal(noteCy, key) {
  // Sum top-level numeric keys (matches the canonical noteTotals raw approach)
  let s = 0;
  for (const [k, v] of Object.entries(noteCy)) {
    if (k.startsWith("_")) continue;
    const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null;
    if (n !== null) s += n;
  }
  return r2(s);
}

const TOUCHED = [
  ...CAT1_TARGETS.map((t) => ({ engId: t.engId, note: t.note })),
  ...CAT2_TARGETS.map((t) => ({ engId: t.engId, note: "other_expenses" })),
  ...CAT3_TARGETS.map((t) => ({ engId: t.engId, note: t.note })),
];

const NOTE_CODES = {
  borrowings: ["NCE_LTB", "NCE_STB", "BS_NCL_LTB", "BS_CL_STB"],
  loans_advances: ["NCE_LTLA", "NCE_STLA", "BS_NCA_LLA", "BS_CA_SLA"],
  other_expenses: ["NCE_OTH_EXP", "PL_EXP_OTH", "PL_EXP_OEX"],
  provisions: ["NCE_LTP", "NCE_STP", "BS_NCL_LTP", "BS_CL_STP"],
  trade_receivables: ["NCE_TR", "BS_CA_TR"],
  other_cl: ["NCE_OCL", "BS_CL_OCL"],
};

for (const t of TOUCHED) {
  const eng = ENGAGEMENTS[t.engId];
  const codes = NOTE_CODES[t.note];
  const note = fetchNote(t.engId, t.note);
  const cyTb = fetchTbByCodes(t.engId, codes);
  const coaCy = r2(cyTb.reduce((s, r) => s + signedAmt(r.closing, r.balance_type, t.note), 0));
  let coaPy = null;
  if (eng.pyShellId) {
    const pyTb = fetchTbByCodes(eng.pyShellId, codes);
    coaPy = r2(pyTb.reduce((s, r) => s + signedAmt(r.closing, r.balance_type, t.note), 0));
  }
  const nCy = noteTotal(note.cy);
  const nPy = noteTotal(note.py);
  const cyDrift = r2(coaCy - nCy);
  const pyDrift = coaPy === null ? null : r2(coaPy - nPy);
  verification.push({ client: eng.name, note: t.note, coaCy, nCy, cyDrift, coaPy, nPy, pyDrift });
  console.log(`  ${eng.name} — ${t.note}: COA CY ${fmt(coaCy)} | Note CY ${fmt(nCy)} | Drift ${fmt(cyDrift)} || COA PY ${fmt(coaPy)} | Note PY ${fmt(nPy)} | Drift ${fmt(pyDrift)}`);
}

// ─── CATEGORY 4 INVESTIGATION REPORT ──────────────────────────────────────────

console.log("\n=================================================================");
console.log("CATEGORY 4 — Investigation report (no fix applied)");
console.log("=================================================================");

const CAT4_TARGETS = [
  { engId: "22495b77-4573-41aa-bbcc-52a187918954", note: "other_cl",        title: "SKYLARK CORPORATION other_cl (CY 13.43cr / PY 25.3cr drift)" },
  { engId: "22495b77-4573-41aa-bbcc-52a187918954", note: "trade_payables",  title: "SKYLARK CORPORATION trade_payables CY (-1.1cr drift)" },
  { engId: "9dfac4d8-8e1a-4b7e-b40d-8ee2562d8dac", note: "borrowings",       title: "BHAKTI INFRA borrowings (-3.02cr drift)" },
  { engId: "70563956-c474-4b78-b2e6-6c2ead600efd", note: "borrowings",       title: "MAHARSH INFRA borrowings PY (-3.64cr)" },
  { engId: "e11aebd4-6e1e-481c-90dc-7dff556dc5cb", note: "borrowings",       title: "MAHIL INFRA borrowings PY (-40.5L)" },
  { engId: "66a33079-de05-4b7f-9df8-0fa5e63a9297", note: "loans_advances",   title: "SUKIRTI DEVELOPERS loans_advances (CY/PY -15.85L)" },
  { engId: "11277a70-eb1b-429b-98bf-b5b5b6dd0559", note: "revenue_ops",      title: "SHREEYAM revenue_ops PY (-14.67cr)" },
];

const cat4Lines = ["# Category 4 — Investigation Report (No fix applied)\n",
  "Generated: " + new Date().toISOString() + "\n",
  "These drifts are too complex for surgical fixing and need manual review.\n"];

for (const t of CAT4_TARGETS) {
  const eng = ENGAGEMENTS[t.engId];
  cat4Lines.push(`\n## ${t.title}`);
  cat4Lines.push(`Engagement: ${eng.name} (id=${t.engId})  PY shell: ${eng.pyShellId}\n`);

  const note = fetchNote(t.engId, t.note);
  const codes = NOTE_CODES[t.note] || [];
  let cyTb = [];
  let pyTb = [];
  if (codes.length) {
    cyTb = fetchTbByCodes(t.engId, codes);
    if (eng.pyShellId) pyTb = fetchTbByCodes(eng.pyShellId, codes);
  } else if (t.note === "revenue_ops") {
    cyTb = fetchTbByCodes(t.engId, ["NCE_REV_OPS", "PL_REV_OPS"]);
    if (eng.pyShellId) pyTb = fetchTbByCodes(eng.pyShellId, ["NCE_REV_OPS", "PL_REV_OPS"]);
  }

  cat4Lines.push(`### TB ledgers — CY (${cyTb.length})`);
  cat4Lines.push("| Ledger | Type | Closing | Signed | FS code |");
  cat4Lines.push("|--------|------|---------|--------|---------|");
  for (const r of cyTb) {
    const signed = signedAmt(r.closing, r.balance_type, t.note);
    cat4Lines.push(`| ${r.ledger} | ${r.balance_type} | ${fmt(r.closing)} | ${fmt(signed)} | ${r.fs_code} |`);
  }
  cat4Lines.push(`\n### TB ledgers — PY shell (${pyTb.length})`);
  cat4Lines.push("| Ledger | Type | Closing | Signed | FS code |");
  cat4Lines.push("|--------|------|---------|--------|---------|");
  for (const r of pyTb) {
    const signed = signedAmt(r.closing, r.balance_type, t.note);
    cat4Lines.push(`| ${r.ledger} | ${r.balance_type} | ${fmt(r.closing)} | ${fmt(signed)} | ${r.fs_code} |`);
  }

  if (note) {
    const cy = note.cy;
    const customRows = Array.isArray(cy._custom_rows) ? cy._custom_rows : [];
    cat4Lines.push(`\n### Note custom rows (${customRows.length})`);
    cat4Lines.push("| ID | Label | Attached | CY value | PY value |");
    cat4Lines.push("|----|-------|----------|----------|----------|");
    for (const cr of customRows) {
      const cyV = note.cy[cr.id] ?? note.cy[`${cr.id}_lt`] ?? note.cy[`${cr.id}_st`] ?? null;
      const pyV = note.py[cr.id] ?? note.py[`${cr.id}_lt`] ?? note.py[`${cr.id}_st`] ?? null;
      const cyLt = note.cy[`${cr.id}_lt`] ?? "";
      const cyStV = note.cy[`${cr.id}_st`] ?? "";
      const pyLt = note.py[`${cr.id}_lt`] ?? "";
      const pyStV = note.py[`${cr.id}_st`] ?? "";
      const cyStr = cyLt || cyStV ? `lt=${fmt(cyLt)} st=${fmt(cyStV)}` : fmt(cyV);
      const pyStr = pyLt || pyStV ? `lt=${fmt(pyLt)} st=${fmt(pyStV)}` : fmt(pyV);
      cat4Lines.push(`| ${cr.id} | ${cr.label || ""} | ${cr.attachedTo || ""} | ${cyStr} | ${pyStr} |`);
    }
    // Static-row keys with values
    const staticKeys = Object.keys(cy).filter((k) => !k.startsWith("_") && !customRows.some((c) => k === c.id || k === c.id+"_lt" || k === c.id+"_st"));
    if (staticKeys.length) {
      cat4Lines.push(`\n### Static row values`);
      cat4Lines.push("| Key | CY | PY |");
      cat4Lines.push("|-----|----|----|");
      for (const k of staticKeys) cat4Lines.push(`| ${k} | ${fmt(note.cy[k])} | ${fmt(note.py[k])} |`);
    }
    // Note totals
    cat4Lines.push(`\n**Note total CY = ${fmt(noteTotal(note.cy))}, PY = ${fmt(noteTotal(note.py))}**`);
    const coaCyT = r2(cyTb.reduce((s, r) => s + signedAmt(r.closing, r.balance_type, t.note), 0));
    const coaPyT = r2(pyTb.reduce((s, r) => s + signedAmt(r.closing, r.balance_type, t.note), 0));
    cat4Lines.push(`**COA total CY = ${fmt(coaCyT)}, PY = ${fmt(coaPyT)}**`);
    cat4Lines.push(`**Drift CY = ${fmt(r2(coaCyT - noteTotal(note.cy)))}, PY = ${fmt(r2(coaPyT - noteTotal(note.py)))}**`);
  } else {
    cat4Lines.push("\n_No note row found in nce_financial_notes._");
  }
}

writeFileSync("category4-investigation.md", cat4Lines.join("\n"));
console.log("  Wrote category4-investigation.md");

// ─── Summary file ─────────────────────────────────────────────────────────────

const sumLines = ["# Fix Summary\n", "Generated: " + new Date().toISOString() + "\n"];

sumLines.push("\n## Per-cell changes\n");
sumLines.push("| Client | Note | Key | Side | Before | After |");
sumLines.push("|--------|------|-----|------|--------|-------|");
for (const l of log) {
  sumLines.push(`| ${l.client} | ${l.note} | ${l.key} | ${l.side} | ${fmt(l.before)} | ${fmt(l.after)} |`);
}

sumLines.push("\n## Final verification (COA vs Note total)\n");
sumLines.push("| Client | Note | COA CY | Note CY | Drift CY | COA PY | Note PY | Drift PY |");
sumLines.push("|--------|------|--------|---------|----------|--------|---------|----------|");
for (const v of verification) {
  sumLines.push(`| ${v.client} | ${v.note} | ${fmt(v.coaCy)} | ${fmt(v.nCy)} | ${fmt(v.cyDrift)} | ${fmt(v.coaPy)} | ${fmt(v.nPy)} | ${fmt(v.pyDrift)} |`);
}

sumLines.push("\n## Category 4 — deferred (see category4-investigation.md)\n");
for (const t of CAT4_TARGETS) sumLines.push(`- ${t.title}`);

sumLines.push("\n## Total fixes applied: " + log.length + " cell changes");

writeFileSync("fix-summary.md", sumLines.join("\n"));
console.log("\nDONE. Wrote fix-summary.md and category4-investigation.md");
