/**
 * COMPREHENSIVE NCE Notes Audit + Fix — Shri Ram Products & Maharsh Infra
 *
 * Audits ALL notes (BS AND P&L) for two clients, finds every mismatch,
 * and fixes every fixable drift.
 *
 * Usage: node scripts/full-notes-audit-two-clients.mjs
 */

import { execSync } from "child_process";

const CWD = "C:\\Users\\kvdes\\OneDrive\\Desktop\\Audit\\caflow-core-ui-main";

// ── Query helper ────────────────────────────────────────────────────────────
function dbQuery(sql) {
  try {
    const cleaned = sql.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    const escaped = cleaned.replace(/"/g, '\\"');
    const cmd = `npx supabase db query --linked "${escaped}"`;
    const result = execSync(cmd, { cwd: CWD, encoding: "utf8", timeout: 120000 });
    const jsonStart = result.indexOf("{");
    const jsonEnd = result.lastIndexOf("}");
    if (jsonStart === -1) return [];
    const parsed = JSON.parse(result.substring(jsonStart, jsonEnd + 1));
    return parsed.rows || [];
  } catch (e) {
    const out = e.stdout || "";
    try {
      const jsonStart = out.indexOf("{");
      const jsonEnd = out.lastIndexOf("}");
      if (jsonStart === -1) throw new Error("No JSON");
      const parsed = JSON.parse(out.substring(jsonStart, jsonEnd + 1));
      return parsed.rows || [];
    } catch {
      console.error("DB query failed:", (e.message || "").substring(0, 500));
      return null;
    }
  }
}

function dbExec(sql) {
  try {
    const cleaned = sql.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    const escaped = cleaned.replace(/"/g, '\\"');
    const cmd = `npx supabase db query --linked "${escaped}"`;
    const result = execSync(cmd, { cwd: CWD, encoding: "utf8", timeout: 30000 });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e.message || "").substring(0, 500) };
  }
}

// ── Sign convention ─────────────────────────────────────────────────────────
const NOTE_NATURE = {
  // Liabilities + Equity (CR-natural)
  borrowings: "CR", other_lt_liab: "CR", provisions: "CR",
  trade_payables: "CR", other_cl: "CR",
  // Income (CR-natural)
  revenue_ops: "CR", other_income: "CR",
  // Assets (DR-natural)
  cwip: "DR", investments: "DR", loans_advances: "DR",
  other_nc_assets: "DR", inventories: "DR", trade_receivables: "DR",
  cash_bank: "DR", other_ca: "DR",
  // Expenses (DR-natural)
  cogs: "DR", employee_exp: "DR", finance_costs: "DR", other_expenses: "DR",
};

function normSide(s) {
  const v = String(s ?? "").trim().toUpperCase();
  return v === "DR" || v === "CR" ? v : "";
}

function signedClosing(amount, balanceType, nature) {
  const cb = Math.abs(Number(amount ?? 0));
  if (cb === 0) return 0;
  const side = normSide(balanceType);
  if (!side) return nature === "CR" ? +cb : -cb;
  return side === nature ? +cb : -cb;
}

function signedOpening(amount, openingType, nature) {
  const ob = Math.abs(Number(amount ?? 0));
  if (ob === 0) return 0;
  const side = normSide(openingType);
  if (!side) return nature === "CR" ? +ob : -ob;
  return side === nature ? +ob : -ob;
}

// ── ALL FS codes → note mapping (BS + P&L) ─────────────────────────────────
const NCE_CODE_TO_NOTE = {
  // BS Liabilities
  NCE_LTB:  { note: "borrowings",     col: "lt" },
  NCE_STB:  { note: "borrowings",     col: "st" },
  NCE_OLTL: { note: "other_lt_liab" },
  NCE_LTP:  { note: "provisions",     col: "lt" },
  NCE_STP:  { note: "provisions",     col: "st" },
  NCE_TP:   { note: "trade_payables" },
  NCE_OCL:  { note: "other_cl" },
  // BS Assets
  NCE_CWIP: { note: "cwip" },
  NCE_NCINV:{ note: "investments",    col: "lt" },
  NCE_CINV: { note: "investments",    col: "st" },
  NCE_LTLA: { note: "loans_advances", col: "lt" },
  NCE_STLA: { note: "loans_advances", col: "st" },
  NCE_ONCA: { note: "other_nc_assets" },
  NCE_STCK: { note: "inventories" },
  NCE_TR:   { note: "trade_receivables" },
  NCE_CASH: { note: "cash_bank" },
  NCE_OCA:  { note: "other_ca" },
  // P&L
  NCE_REV_OPS:  { note: "revenue_ops" },
  NCE_REV_OTH:  { note: "other_income" },
  NCE_COGS:     { note: "cogs", config: "cogs_a" },
  NCE_CII:      { note: "cogs", config: "cogs_c" },
  NCE_EMP_EXP:  { note: "employee_exp" },
  NCE_FIN_COST: { note: "finance_costs" },
  NCE_OTH_EXP:  { note: "other_expenses" },
};

// FS codes that map to each note type (for COA lookup)
const NCE_NOTE_FS_MAP = {
  borrowings:        { lt: ["NCE_LTB"], st: ["NCE_STB"] },
  other_lt_liab:     { all: ["NCE_OLTL"] },
  provisions:        { lt: ["NCE_LTP"], st: ["NCE_STP"] },
  trade_payables:    { all: ["NCE_TP", "BS_CL_TP", "BS_CL_TP_MSME", "BS_CL_TP_OTH"] },
  other_cl:          { all: ["NCE_OCL", "BS_CL_OCL"] },
  cwip:              { all: ["NCE_CWIP", "BS_NCA_FA_WIP"] },
  investments:       { lt: ["NCE_NCINV", "BS_NCA_INV"], st: ["NCE_CINV", "BS_CA_CI"] },
  loans_advances:    { lt: ["NCE_LTLA", "BS_NCA_LLA"], st: ["NCE_STLA", "BS_CA_SLA"] },
  other_nc_assets:   { all: ["NCE_ONCA", "BS_NCA_ONA", "BS_NCA_DTA"] },
  inventories:       { all: ["NCE_STCK", "BS_CA_INV", "INV_RM", "INV_WIP", "INV_FG", "INV_STT", "INV_STOCK"] },
  trade_receivables: { all: ["NCE_TR", "BS_CA_TR"] },
  cash_bank:         { all: ["NCE_CASH", "BS_CA_CCE"] },
  other_ca:          { all: ["NCE_OCA", "BS_CA_OCA"] },
  revenue_ops:       { all: ["NCE_REV_OPS", "PL_REV_OPS"] },
  other_income:      { all: ["NCE_REV_OTH", "PL_REV_OI"] },
  cogs:              { all: ["NCE_COGS", "NCE_CII", "PL_EXP_MAT", "PL_EXP_SIT", "PL_EXP_CII"] },
  employee_exp:      { all: ["NCE_EMP_EXP", "PL_EXP_EMP"] },
  finance_costs:     { all: ["NCE_FIN_COST", "PL_EXP_FIN"] },
  other_expenses:    { all: ["NCE_OTH_EXP", "PL_EXP_OTH", "PL_EXP_OEX"] },
};

// P&L note types — important for PY handling
const PL_NOTE_TYPES = new Set(["revenue_ops", "other_income", "cogs", "employee_exp", "finance_costs", "other_expenses"]);

// COGS sub-config row definitions
const COGS_SUB_CONFIGS = {
  cogs_a: {
    rows: [
      { id: "raw_open" }, { id: "raw_purch" }, { id: "raw_close" },
      { id: "raw_consumed", isTotal: true, formulaAdd: ["raw_open", "raw_purch"], formulaSub: ["raw_close"] },
      { id: "pack_open" }, { id: "pack_purch" }, { id: "pack_close" },
      { id: "pack_consumed", isTotal: true, formulaAdd: ["pack_open", "pack_purch"], formulaSub: ["pack_close"] },
      { id: "other_open" }, { id: "other_purch" }, { id: "other_close" },
      { id: "other_consumed", isTotal: true, formulaAdd: ["other_open", "other_purch"], formulaSub: ["other_close"] },
      { id: "pa_total", isTotal: true, formulaAdd: ["raw_consumed", "pack_consumed", "other_consumed"] },
    ],
    grandTotalId: "pa_total",
  },
  cogs_c: {
    rows: [
      { id: "pc_open_trade" }, { id: "pc_open_wip" }, { id: "pc_open_fg" },
      { id: "pc_i_total", isTotal: true, formulaAdd: ["pc_open_trade", "pc_open_wip", "pc_open_fg"] },
      { id: "pc_close_trade" }, { id: "pc_close_wip" }, { id: "pc_close_fg" },
      { id: "pc_ii_total", isTotal: true, formulaAdd: ["pc_close_trade", "pc_close_wip", "pc_close_fg"] },
      { id: "pc_total", isTotal: true, formulaAdd: ["pc_i_total"], formulaSub: ["pc_ii_total"] },
    ],
    grandTotalId: "pc_total",
  },
};

const META_KEYS = new Set([
  "_custom_rows", "_hidden_rows", "_label_overrides",
  "_cy_sources", "_ejected_ledgers", "_source_label_overrides", "_version",
]);

function extractNumerics(data) {
  if (!data || typeof data !== "object") return {};
  const nums = {};
  for (const [k, v] of Object.entries(data)) {
    if (META_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) nums[k] = v;
  }
  return nums;
}

const round2 = (n) => Math.round(n * 100) / 100;

const fmt = (n) => {
  if (n == null) return "-";
  if (n === 0) return "0.00";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const parts = abs.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{2})+(\d)(?!\d))/g, ",");
  return sign + parts.join(".");
};

// ── Compute note total from cy_data/py_data ─────────────────────────────────
// For standard Pattern B: sum all numeric values
// For Pattern A (col = lt/st): sum only _lt or _st suffixed values
// For COGS sub-configs: compute the formula DAG for that section
function computeNoteTotal(noteRec, col, config) {
  if (!noteRec) return { cy: 0, py: 0 };
  const cyData = noteRec.cy_data || {};
  const pyData = noteRec.py_data || {};
  const numsCy = extractNumerics(cyData);
  const numsPy = extractNumerics(pyData);
  const customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];

  // COGS sub-config: compute section-specific totals via formula DAG
  if (config && COGS_SUB_CONFIGS[config]) {
    const subConf = COGS_SUB_CONFIGS[config];
    const computed_cy = { ...numsCy };
    const computed_py = { ...numsPy };

    // Add sources from custom rows
    for (const cr of customRows) {
      if (!cr.sources || cr.sources.length === 0) continue;
      const srcCy = cr.sources.reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
      const srcPy = cr.sources.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0);
      if ((computed_cy[cr.id] ?? 0) === 0) computed_cy[cr.id] = (computed_cy[cr.id] ?? 0) + srcCy;
      if ((computed_py[cr.id] ?? 0) === 0) computed_py[cr.id] = (computed_py[cr.id] ?? 0) + srcPy;
    }

    // Walk the formula DAG
    for (const row of subConf.rows) {
      if (!row.isTotal) continue;
      let cy = 0, py = 0;
      for (const id of (row.formulaAdd || [])) {
        cy += computed_cy[id] ?? 0;
        py += computed_py[id] ?? 0;
      }
      for (const id of (row.formulaSub || [])) {
        cy -= computed_cy[id] ?? 0;
        py -= computed_py[id] ?? 0;
      }
      computed_cy[row.id] = round2(cy);
      computed_py[row.id] = round2(py);
    }

    // Add unattached custom rows that belong to this sub-config's row IDs
    const subRowIds = new Set(subConf.rows.map(r => r.id));
    let extraCy = 0, extraPy = 0;
    for (const cr of customRows) {
      if (cr.attachedTo && subRowIds.has(cr.attachedTo)) {
        // Already included via parent walk
      } else if (!cr.attachedTo && !cr.section) {
        // Unattached custom row — check if it contributes here
        // For COGS, custom rows without explicit attachment don't contribute to sub-configs
      }
    }

    return {
      cy: round2(computed_cy[subConf.grandTotalId] ?? 0),
      py: round2(computed_py[subConf.grandTotalId] ?? 0),
    };
  }

  // Pattern A column extraction
  if (col) {
    let noteCy = 0, notePy = 0;
    const seenBasesCy = new Set();
    for (const k of Object.keys(numsCy)) {
      if (k.endsWith("_lt")) seenBasesCy.add(k.slice(0, -3));
      else if (k.endsWith("_st")) seenBasesCy.add(k.slice(0, -3));
    }
    for (const [k, v] of Object.entries(numsCy)) {
      if (k.endsWith("_lt") && col === "lt") noteCy += v;
      else if (k.endsWith("_st") && col === "st") noteCy += v;
      else if (!k.endsWith("_lt") && !k.endsWith("_st") && !seenBasesCy.has(k) && col === "lt") noteCy += v;
    }
    const seenBasesPy = new Set();
    for (const k of Object.keys(numsPy)) {
      if (k.endsWith("_lt")) seenBasesPy.add(k.slice(0, -3));
      else if (k.endsWith("_st")) seenBasesPy.add(k.slice(0, -3));
    }
    for (const [k, v] of Object.entries(numsPy)) {
      if (k.endsWith("_lt") && col === "lt") notePy += v;
      else if (k.endsWith("_st") && col === "st") notePy += v;
      else if (!k.endsWith("_lt") && !k.endsWith("_st") && !seenBasesPy.has(k) && col === "lt") notePy += v;
    }

    // Custom row sources for Pattern A
    for (const cr of customRows) {
      if (cr.attachedTo) continue; // already counted via parent
      if (!cr.sources || cr.sources.length === 0) continue;
      for (const src of cr.sources) {
        const srcCol = src.column || "lt";
        if (srcCol === col) {
          const key = `${cr.id}_${col}`;
          if ((numsCy[key] ?? 0) === 0) noteCy += (Number(src.amountCy) || 0);
          if ((numsPy[key] ?? 0) === 0) notePy += (Number(src.amountPy) || 0);
        }
      }
    }

    return { cy: round2(noteCy), py: round2(notePy) };
  }

  // Pattern B: sum all numeric values + sources from custom rows
  let noteCy = Object.values(numsCy).reduce((s, v) => s + v, 0);
  let notePy = Object.values(numsPy).reduce((s, v) => s + v, 0);

  // Custom rows with sources (heading-style): add sources when raw is 0
  for (const cr of customRows) {
    if (!cr.sources || cr.sources.length === 0) continue;
    if (cr.attachedTo) continue;
    const srcCy = cr.sources.reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
    const srcPy = cr.sources.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0);
    if ((numsCy[cr.id] ?? 0) === 0) noteCy += srcCy;
    if ((numsPy[cr.id] ?? 0) === 0) notePy += srcPy;
  }

  return { cy: round2(noteCy), py: round2(notePy) };
}

// ── Paginated TB loader ─────────────────────────────────────────────────────
function loadTB(engId) {
  let allTb = [];
  let offset = 0;
  while (true) {
    const rows = dbQuery(`SELECT id, ledger_name, closing_balance, balance_type, opening_balance, opening_type, parent_group FROM tally_trial_balance WHERE engagement_id = '${engId}' ORDER BY id LIMIT 1000 OFFSET ${offset}`);
    if (!rows) return null;
    if (rows.length === 0) break;
    allTb = allTb.concat(rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return allTb;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════
function main() {
  console.log("=".repeat(120));
  console.log("  COMPREHENSIVE NCE NOTES AUDIT + FIX (BS + P&L)");
  console.log("  Clients: Shri Ram Products & Maharsh Infra");
  console.log("  Started:", new Date().toISOString());
  console.log("=".repeat(120));

  // ── Step 0: Find engagement IDs ───────────────────────────────────────────
  console.log("\n== STEP 0: Finding engagement IDs ==\n");

  const SHRI_RAM_ID = "6074f0fb-679a-4b88-98a6-c421cfcf8e0a";

  // Find Maharsh Infra
  const maharshRows = dbQuery("SELECT e.id, e.client_id, e.financial_year, e.entity_type, e.is_py_shell, c.name as client_name FROM audit_engagements e JOIN clients c ON c.id = e.client_id WHERE LOWER(c.name) LIKE '%maharsh%' AND (e.is_py_shell IS NULL OR e.is_py_shell = false)");
  if (!maharshRows || maharshRows.length === 0) {
    console.error("FATAL: Could not find Maharsh Infra engagement");
    return;
  }
  const maharshEng = maharshRows[0];
  const MAHARSH_ID = maharshEng.id;
  console.log(`Shri Ram Products: ${SHRI_RAM_ID}`);
  console.log(`Maharsh Infra:     ${MAHARSH_ID} (${maharshEng.client_name}, FY ${maharshEng.financial_year})`);

  // Also get Shri Ram metadata
  const shriRamRows = dbQuery(`SELECT e.id, c.name as client_name, e.financial_year FROM audit_engagements e JOIN clients c ON c.id = e.client_id WHERE e.id = '${SHRI_RAM_ID}'`);
  const shriRamName = shriRamRows?.[0]?.client_name || "Shri Ram Products";
  const shriRamFY = shriRamRows?.[0]?.financial_year || "?";

  const clients = [
    { id: SHRI_RAM_ID, name: shriRamName, fy: shriRamFY },
    { id: MAHARSH_ID, name: maharshEng.client_name, fy: maharshEng.financial_year },
  ];

  // ── Step 1-7: Audit + Fix each client ──────────────────────────────────────
  const globalReport = [];

  for (const client of clients) {
    console.log("\n" + "=".repeat(120));
    console.log(`  AUDITING: ${client.name} (FY ${client.fy})`);
    console.log(`  Engagement ID: ${client.id}`);
    console.log("=".repeat(120));

    const report = auditAndFixClient(client);
    globalReport.push(report);
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(120));
  console.log("  FINAL SUMMARY");
  console.log("=".repeat(120));

  for (const r of globalReport) {
    console.log(`\n  ${r.clientName} (FY ${r.fy}):`);
    console.log(`    Fixes applied: ${r.fixCount}`);
    console.log(`    Before: CY drift=${fmt(r.beforeTotalDriftCy)}, PY drift=${fmt(r.beforeTotalDriftPy)}`);
    console.log(`    After:  CY drift=${fmt(r.afterTotalDriftCy)}, PY drift=${fmt(r.afterTotalDriftPy)}`);

    // Print complete table
    console.log(`\n    ${"Code".padEnd(14)} ${"NoteType".padEnd(20)} ${"COA CY".padStart(14)} ${"Note CY".padStart(14)} ${"Drift CY".padStart(12)} | ${"COA PY".padStart(14)} ${"Note PY".padStart(14)} ${"Drift PY".padStart(12)}  Status`);
    console.log("    " + "-".repeat(130));
    for (const cr of r.afterResults) {
      const status = cr.driftCy <= 1 && cr.driftPy <= 1 ? "OK" :
                     (cr.driftCy <= 1 ? "PY-DRIFT" : (cr.driftPy <= 1 ? "CY-DRIFT" : "DRIFT"));
      console.log(`    ${cr.fsCode.padEnd(14)} ${cr.noteType.padEnd(20)} ${fmt(cr.coaCy).padStart(14)} ${fmt(cr.noteCy).padStart(14)} ${fmt(cr.driftCy).padStart(12)} | ${fmt(cr.coaPy).padStart(14)} ${fmt(cr.notePy).padStart(14)} ${fmt(cr.driftPy).padStart(12)}  ${status}`);
    }
  }

  console.log("\n" + "=".repeat(120));
  console.log("  COMPLETE:", new Date().toISOString());
  console.log("=".repeat(120));
}

function auditAndFixClient(client) {
  // ── Step 1: Load all data ─────────────────────────────────────────────────
  console.log("\n  -- Step 1: Loading data --");

  const coaRows = dbQuery(`SELECT coa_mapping FROM audit_engagements WHERE id = '${client.id}'`);
  const coaMapping = coaRows?.[0]?.coa_mapping || {};
  console.log(`  COA mapping: ${Object.keys(coaMapping).length} entries`);

  const allTb = loadTB(client.id);
  if (!allTb || allTb.length === 0) {
    console.log("  SKIP: No TB data");
    return { clientName: client.name, fy: client.fy, fixCount: 0, beforeTotalDriftCy: 0, beforeTotalDriftPy: 0, afterTotalDriftCy: 0, afterTotalDriftPy: 0, afterResults: [] };
  }
  console.log(`  TB: ${allTb.length} rows (paginated)`);

  const tbByName = {};
  for (const row of allTb) tbByName[row.ledger_name] = row;

  const noteRows = dbQuery(`SELECT id, engagement_id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${client.id}'`);
  if (!noteRows) {
    console.log("  SKIP: Notes load failed");
    return { clientName: client.name, fy: client.fy, fixCount: 0, beforeTotalDriftCy: 0, beforeTotalDriftPy: 0, afterTotalDriftCy: 0, afterTotalDriftPy: 0, afterResults: [] };
  }
  console.log(`  Notes: ${noteRows.length} rows`);

  const noteByType = {};
  for (const n of noteRows) noteByType[n.note_type] = n;

  // Build FS code -> TB ledgers mapping from COA
  const codeLedgers = {};
  for (const [ledgerName, mapping] of Object.entries(coaMapping)) {
    if (!mapping || !mapping.code) continue;
    const code = mapping.code;
    if (!codeLedgers[code]) codeLedgers[code] = [];
    const tb = tbByName[ledgerName];
    codeLedgers[code].push({ ledgerName, mapping, tb });
  }

  // ── Step 2: Audit every FS code ──────────────────────────────────────────
  console.log("\n  -- Step 2: Auditing all FS codes (BS + P&L) --\n");

  const codeResults = [];
  const fixes = [];

  for (const [fsCode, codeInfo] of Object.entries(NCE_CODE_TO_NOTE)) {
    const noteType = codeInfo.note;
    const col = codeInfo.col;
    const config = codeInfo.config;
    const nature = NOTE_NATURE[noteType] || "CR";
    const isPL = PL_NOTE_TYPES.has(noteType);

    // Find ALL ledgers mapped to codes that feed this note
    const noteFs = NCE_NOTE_FS_MAP[noteType];
    let relevantCodes;
    if (col === "lt" && noteFs?.lt) {
      relevantCodes = noteFs.lt;
    } else if (col === "st" && noteFs?.st) {
      relevantCodes = noteFs.st;
    } else if (noteFs?.all) {
      relevantCodes = noteFs.all;
    } else {
      relevantCodes = [fsCode];
    }

    // But for the specific NCE_CODE (e.g. NCE_COGS vs NCE_CII), we only count
    // ledgers mapped to THIS specific code, not all codes feeding the note
    const ledgersThisCode = codeLedgers[fsCode] || [];

    // COA CY = signed TB closing for ledgers mapped to THIS code
    let coaCy = 0, coaPy = 0;
    for (const { tb } of ledgersThisCode) {
      if (!tb) continue;
      coaCy += signedClosing(tb.closing_balance, tb.balance_type, nature);
      // For P&L: PY from TB opening_balance = 0 (P&L resets each year)
      // For BS: PY from TB opening_balance = prior year
      if (!isPL) {
        coaPy += signedOpening(tb.opening_balance, tb.opening_type, nature);
      }
      // P&L PY comes from PY shell, not CY openings — so coaPy stays 0 for P&L
    }
    coaCy = round2(coaCy);
    coaPy = round2(coaPy);

    // Note total
    const noteRec = noteByType[noteType];
    const noteTotal = computeNoteTotal(noteRec, col, config);

    const driftCy = round2(Math.abs(coaCy - noteTotal.cy));
    // For P&L, skip PY drift vs COA (COA PY = 0 since P&L openings are 0)
    const driftPy = isPL ? 0 : round2(Math.abs(coaPy - noteTotal.py));

    codeResults.push({
      fsCode, noteType, col, config, nature, isPL,
      ledgerCount: ledgersThisCode.length,
      coaCy, coaPy,
      noteCy: noteTotal.cy, notePy: noteTotal.py,
      driftCy, driftPy,
    });

    // ── Step 3: Diagnose mismatches ────────────────────────────────────────
    if (driftCy > 1 || driftPy > 1) {
      console.log(`  DRIFT: ${fsCode} (${noteType}${col ? "/" + col : ""}${config ? " config=" + config : ""})`);
      console.log(`    COA:  CY=${fmt(coaCy)}  PY=${fmt(coaPy)}`);
      console.log(`    Note: CY=${fmt(noteTotal.cy)}  PY=${fmt(noteTotal.py)}`);
      console.log(`    Drift: CY=${fmt(driftCy)}  PY=${fmt(driftPy)}`);
      console.log(`    Ledgers mapped: ${ledgersThisCode.length}`);

      // Show individual ledger contributions
      if (ledgersThisCode.length <= 30) {
        for (const { ledgerName, tb } of ledgersThisCode) {
          if (!tb) { console.log(`      [NO TB] ${ledgerName}`); continue; }
          const sc = signedClosing(tb.closing_balance, tb.balance_type, nature);
          const so = isPL ? 0 : signedOpening(tb.opening_balance, tb.opening_type, nature);
          if (sc !== 0 || so !== 0) {
            console.log(`      ${ledgerName}: CY=${fmt(sc)} PY=${fmt(so)} (raw cb=${tb.closing_balance} ${tb.balance_type}, ob=${tb.opening_balance} ${tb.opening_type})`);
          }
        }
      }

      // Diagnose note data
      if (noteRec) {
        const cyData = noteRec.cy_data || {};
        const pyData = noteRec.py_data || {};
        const numsCy = extractNumerics(cyData);
        const numsPy = extractNumerics(pyData);
        const customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];
        const cySources = cyData._cy_sources || {};

        console.log(`    Note data: ${Object.keys(numsCy).length} CY keys, ${Object.keys(numsPy).length} PY keys, ${customRows.length} custom rows`);

        // Show non-zero note values
        for (const [k, v] of Object.entries(numsCy)) {
          if (Math.abs(v) > 0.01) {
            const pyV = numsPy[k] ?? 0;
            console.log(`      note.cy[${k}]=${fmt(v)}  note.py[${k}]=${fmt(pyV)}`);
          }
        }
        for (const [k, v] of Object.entries(numsPy)) {
          if (Math.abs(v) > 0.01 && !(k in numsCy && Math.abs(numsCy[k]) > 0.01)) {
            console.log(`      note.py[${k}]=${fmt(v)}  (CY=0)`);
          }
        }
      }
    }

    // ── Step 4: Fix every fixable drift ──────────────────────────────────
    if (!noteRec) continue;
    if (driftCy <= 1 && driftPy <= 1) continue;

    const cyData = noteRec.cy_data || {};
    const pyData = noteRec.py_data || {};
    const customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];
    const cySources = cyData._cy_sources || {};

    // ── BUG 1: Manual rows with 0 sources zeroed by double-count guard ──
    for (const cr of customRows) {
      if (cr.source !== "manual") continue;
      if ((cr.sources || []).length > 0) continue;

      const crId = cr.id;
      const suffix = col ? `_${col}` : "";
      const cyKey = col ? `${crId}${suffix}` : crId;
      const pyKey = col ? `${crId}${suffix}` : crId;
      const cyVal = Number(cyData[cyKey] ?? 0);
      const pyVal = Number(pyData[pyKey] ?? 0);

      const label = (cr.label ?? "").trim();
      if (!label) continue;

      const tbRow = tbByName[label];
      if (!tbRow) continue;

      const expectedCy = signedClosing(tbRow.closing_balance, tbRow.balance_type, nature);
      const expectedPy = isPL ? 0 : signedOpening(tbRow.opening_balance, tbRow.opening_type, nature);

      // Check if this ledger is already a source elsewhere
      let isSourceElsewhere = false;
      for (const cr2 of customRows) {
        if (cr2.id === crId) continue;
        for (const src of (cr2.sources || [])) {
          if ((src.ledger ?? "").trim().toLowerCase() === label.toLowerCase()) {
            isSourceElsewhere = true;
            break;
          }
        }
        if (isSourceElsewhere) break;
      }
      for (const [srcKey, srcArr] of Object.entries(cySources)) {
        if (!Array.isArray(srcArr)) continue;
        for (const src of srcArr) {
          if ((src.ledger ?? "").trim().toLowerCase() === label.toLowerCase()) {
            isSourceElsewhere = true;
            break;
          }
        }
        if (isSourceElsewhere) break;
      }
      if (isSourceElsewhere) continue;

      if (Math.abs(cyVal) < 0.01 && Math.abs(expectedCy) > 0.01) {
        fixes.push({
          noteType, noteId: noteRec.id, field: "cy_data", key: cyKey,
          oldVal: cyVal, newVal: round2(expectedCy),
          reason: `BUG1: Manual row "${label}" CY zeroed, TB closing=${fmt(expectedCy)}`,
        });
      }
      if (!isPL && Math.abs(pyVal) < 0.01 && Math.abs(expectedPy) > 0.01) {
        fixes.push({
          noteType, noteId: noteRec.id, field: "py_data", key: pyKey,
          oldVal: pyVal, newVal: round2(expectedPy),
          reason: `BUG1: Manual row "${label}" PY zeroed, TB opening=${fmt(expectedPy)}`,
        });
      }
    }

    // ── BUG 2: Static row zeroed despite having smart-matched sources ──
    for (const [srcKey, srcArr] of Object.entries(cySources)) {
      if (!Array.isArray(srcArr) || srcArr.length === 0) continue;

      const srcCySum = round2(srcArr.reduce((s, x) => s + (Number(x?.amountCy) || 0), 0));
      if (Math.abs(srcCySum) < 0.01) continue;

      let dataKey = srcKey;
      if (col) {
        const suffixedKey = `${srcKey}_${col}`;
        if (suffixedKey in cyData) dataKey = suffixedKey;
        else if (srcKey in cyData) dataKey = srcKey;
        else dataKey = suffixedKey;
      }

      const currentVal = Number(cyData[dataKey] ?? 0);
      if (Math.abs(currentVal) < 0.01) {
        const isCustomRow = customRows.some(cr => cr.id === srcKey);
        if (!isCustomRow) {
          fixes.push({
            noteType, noteId: noteRec.id, field: "cy_data", key: dataKey,
            oldVal: currentVal, newVal: srcCySum,
            reason: `BUG2: Static "${srcKey}" zeroed, _cy_sources sum=${fmt(srcCySum)}`,
          });
        }
      }
    }

    // ── BUG 3: PY mismatch (BS only — P&L PY comes from PY shell) ──────
    if (!isPL && driftPy > 1) {
      // Custom rows PY check
      for (const cr of customRows) {
        const label = (cr.label ?? "").trim();
        if (!label) continue;

        const crId = cr.id;
        const pyKey = col ? `${crId}_${col}` : crId;
        const pyVal = Number(pyData[pyKey] ?? 0);

        const tbRow = tbByName[label];
        if (!tbRow) continue;

        const expectedPy = signedOpening(tbRow.opening_balance, tbRow.opening_type, nature);

        let isSourceElsewhere = false;
        for (const cr2 of customRows) {
          if (cr2.id === crId) continue;
          for (const src of (cr2.sources || [])) {
            if ((src.ledger ?? "").trim().toLowerCase() === label.toLowerCase()) {
              isSourceElsewhere = true;
              break;
            }
          }
          if (isSourceElsewhere) break;
        }
        for (const [, srcArr] of Object.entries(cySources)) {
          if (!Array.isArray(srcArr)) continue;
          for (const src of srcArr) {
            if ((src.ledger ?? "").trim().toLowerCase() === label.toLowerCase()) {
              isSourceElsewhere = true;
              break;
            }
          }
          if (isSourceElsewhere) break;
        }
        if (isSourceElsewhere) continue;

        if (Math.abs(pyVal - expectedPy) > 1) {
          fixes.push({
            noteType, noteId: noteRec.id, field: "py_data", key: pyKey,
            oldVal: pyVal, newVal: round2(expectedPy),
            reason: `BUG3: Custom row "${label}" PY=${fmt(pyVal)} vs TB opening=${fmt(expectedPy)}`,
          });
        }
      }

      // Smart-mapped static rows PY
      for (const [srcKey, srcArr] of Object.entries(cySources)) {
        if (!Array.isArray(srcArr) || srcArr.length === 0) continue;
        const isCustomRow = customRows.some(cr => cr.id === srcKey);
        if (isCustomRow) continue;

        const pyKey = col ? `${srcKey}_${col}` : srcKey;
        const pyVal = Number(pyData[pyKey] ?? 0);

        let expectedPy = 0;
        for (const src of srcArr) {
          const ledger = (src.ledger ?? "").trim();
          if (!ledger) continue;
          const tbRow = tbByName[ledger];
          if (!tbRow) continue;
          expectedPy += signedOpening(tbRow.opening_balance, tbRow.opening_type, nature);
        }
        expectedPy = round2(expectedPy);

        if (Math.abs(pyVal - expectedPy) > 1) {
          fixes.push({
            noteType, noteId: noteRec.id, field: "py_data", key: pyKey,
            oldVal: pyVal, newVal: expectedPy,
            reason: `BUG3: Static "${srcKey}" PY=${fmt(pyVal)} vs TB sources opening=${fmt(expectedPy)}`,
          });
        }
      }
    }

    // ── BUG 4: CY mismatch for non-COGS P&L or BS — check if sum of
    //     individual row amounts doesn't match what COA expects ──────────
    if (driftCy > 1 && !config) {
      // Check if the note total simply equals sum of raw values but COA disagrees
      // This means some TB ledgers aren't reflected in note rows
      const numsCy = extractNumerics(cyData);

      // Find ledgers that are in COA but missing from note
      for (const { ledgerName, tb } of ledgersThisCode) {
        if (!tb) continue;
        const expectedCy = signedClosing(tb.closing_balance, tb.balance_type, nature);
        if (Math.abs(expectedCy) < 0.01) continue;

        // Check if this ledger appears anywhere in note data
        let foundInNote = false;

        // Check custom rows
        for (const cr of customRows) {
          if ((cr.label ?? "").trim().toLowerCase() === ledgerName.toLowerCase()) {
            foundInNote = true;
            break;
          }
          for (const src of (cr.sources || [])) {
            if ((src.ledger ?? "").trim().toLowerCase() === ledgerName.toLowerCase()) {
              foundInNote = true;
              break;
            }
          }
          if (foundInNote) break;
        }

        // Check _cy_sources
        if (!foundInNote) {
          for (const [, srcArr] of Object.entries(cySources)) {
            if (!Array.isArray(srcArr)) continue;
            for (const src of srcArr) {
              if ((src.ledger ?? "").trim().toLowerCase() === ledgerName.toLowerCase()) {
                foundInNote = true;
                break;
              }
            }
            if (foundInNote) break;
          }
        }

        if (!foundInNote) {
          console.log(`    MISSING: Ledger "${ledgerName}" (CY=${fmt(expectedCy)}) not found in note ${noteType}`);
        }
      }
    }
  }

  // ── Step 5: Apply fixes ─────────────────────────────────────────────────
  console.log(`\n  -- Step 5: Applying fixes --`);

  // Deduplicate
  const fixMap = new Map();
  for (const f of fixes) {
    const fKey = `${f.noteId}|${f.field}|${f.key}`;
    fixMap.set(fKey, f);
  }
  const dedupedFixes = [...fixMap.values()];

  if (dedupedFixes.length === 0) {
    console.log("  No fixes needed.");
  } else {
    console.log(`  ${dedupedFixes.length} fixes to apply:`);
    for (const f of dedupedFixes) {
      console.log(`    ${f.noteType}.${f.field}.${f.key}: ${fmt(f.oldVal)} -> ${fmt(f.newVal)} (${f.reason})`);
    }

    // Group by noteId + field
    const grouped = {};
    for (const f of dedupedFixes) {
      const gKey = `${f.noteId}|${f.field}`;
      if (!grouped[gKey]) grouped[gKey] = { noteId: f.noteId, field: f.field, patches: [] };
      grouped[gKey].patches.push({ key: f.key, newVal: f.newVal });
    }

    for (const [gKey, g] of Object.entries(grouped)) {
      let jsonbExpr = g.field;
      for (const patch of g.patches) {
        const valStr = Number.isFinite(patch.newVal) ? String(patch.newVal) : "0";
        jsonbExpr = `jsonb_set(${jsonbExpr}, '{${patch.key}}', '${valStr}'::jsonb, true)`;
      }

      const sql = `UPDATE nce_financial_notes SET ${g.field} = ${jsonbExpr} WHERE id = '${g.noteId}';`;
      console.log(`\n  SQL: ${sql.substring(0, 250)}${sql.length > 250 ? "..." : ""}`);

      const res = dbExec(sql);
      if (res.ok) {
        console.log(`    OK`);
      } else {
        console.log(`    FAILED: ${(res.error || "").substring(0, 300)}`);
      }
    }
  }

  // ── Step 6: Re-verify ─────────────────────────────────────────────────
  console.log(`\n  -- Step 6: Re-verification --`);

  const newNotes = dbQuery(`SELECT id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${client.id}'`);
  const newNoteByType = {};
  for (const n of (newNotes || [])) newNoteByType[n.note_type] = n;

  const afterResults = [];
  let afterTotalDriftCy = 0, afterTotalDriftPy = 0;

  for (const [fsCode, codeInfo] of Object.entries(NCE_CODE_TO_NOTE)) {
    const noteType = codeInfo.note;
    const col = codeInfo.col;
    const config = codeInfo.config;
    const nature = NOTE_NATURE[noteType] || "CR";
    const isPL = PL_NOTE_TYPES.has(noteType);
    const ledgersThisCode = codeLedgers[fsCode] || [];

    let coaCy = 0, coaPy = 0;
    for (const { tb } of ledgersThisCode) {
      if (!tb) continue;
      coaCy += signedClosing(tb.closing_balance, tb.balance_type, nature);
      if (!isPL) {
        coaPy += signedOpening(tb.opening_balance, tb.opening_type, nature);
      }
    }
    coaCy = round2(coaCy);
    coaPy = round2(coaPy);

    const noteTotal = computeNoteTotal(newNoteByType[noteType], col, config);
    const driftCy = round2(Math.abs(coaCy - noteTotal.cy));
    const driftPy = isPL ? 0 : round2(Math.abs(coaPy - noteTotal.py));

    afterTotalDriftCy += driftCy;
    afterTotalDriftPy += driftPy;

    afterResults.push({
      fsCode, noteType, col, config,
      coaCy, coaPy,
      noteCy: noteTotal.cy, notePy: noteTotal.py,
      driftCy, driftPy,
    });

    if (driftCy > 1 || driftPy > 1) {
      console.log(`  STILL DRIFTING: ${fsCode} (${noteType}${col ? "/" + col : ""}) CY drift=${fmt(driftCy)} PY drift=${fmt(driftPy)}`);
    }
  }

  const beforeTotalDriftCy = round2(codeResults.reduce((s, r) => s + r.driftCy, 0));
  const beforeTotalDriftPy = round2(codeResults.reduce((s, r) => s + r.driftPy, 0));
  afterTotalDriftCy = round2(afterTotalDriftCy);
  afterTotalDriftPy = round2(afterTotalDriftPy);

  console.log(`\n  BEFORE: Total CY drift=${fmt(beforeTotalDriftCy)}, PY drift=${fmt(beforeTotalDriftPy)}`);
  console.log(`  AFTER:  Total CY drift=${fmt(afterTotalDriftCy)}, PY drift=${fmt(afterTotalDriftPy)}`);

  // ── Step 7: Complete table ──────────────────────────────────────────────
  console.log(`\n  -- Step 7: Complete table for ${client.name} --\n`);

  console.log(`  ${"Code".padEnd(14)} ${"NoteType".padEnd(20)} ${"COA CY".padStart(14)} ${"Note CY".padStart(14)} ${"Drift CY".padStart(12)} | ${"COA PY".padStart(14)} ${"Note PY".padStart(14)} ${"Drift PY".padStart(12)}  Status`);
  console.log("  " + "-".repeat(130));

  for (const cr of afterResults) {
    const status = cr.driftCy <= 1 && cr.driftPy <= 1 ? "OK" :
                   (cr.driftCy <= 1 ? "PY-DRIFT" : (cr.driftPy <= 1 ? "CY-DRIFT" : "DRIFT"));
    console.log(`  ${cr.fsCode.padEnd(14)} ${cr.noteType.padEnd(20)} ${fmt(cr.coaCy).padStart(14)} ${fmt(cr.noteCy).padStart(14)} ${fmt(cr.driftCy).padStart(12)} | ${fmt(cr.coaPy).padStart(14)} ${fmt(cr.notePy).padStart(14)} ${fmt(cr.driftPy).padStart(12)}  ${status}`);
  }

  return {
    clientName: client.name,
    fy: client.fy,
    fixCount: dedupedFixes.length,
    beforeTotalDriftCy,
    beforeTotalDriftPy,
    afterTotalDriftCy,
    afterTotalDriftPy,
    afterResults,
  };
}

main();
