/**
 * FINAL VERIFICATION — Complete audit table for both clients after all fixes.
 */

import { execSync } from "child_process";

const CWD = "C:\\Users\\kvdes\\OneDrive\\Desktop\\Audit\\caflow-core-ui-main";

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

const NOTE_NATURE = {
  borrowings: "CR", other_lt_liab: "CR", provisions: "CR",
  trade_payables: "CR", other_cl: "CR",
  revenue_ops: "CR", other_income: "CR",
  cwip: "DR", investments: "DR", loans_advances: "DR",
  other_nc_assets: "DR", inventories: "DR", trade_receivables: "DR",
  cash_bank: "DR", other_ca: "DR",
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

function loadTB(engId) {
  let allTb = [];
  let offset = 0;
  while (true) {
    const rows = dbQuery(`SELECT id, ledger_name, closing_balance, balance_type, opening_balance, opening_type FROM tally_trial_balance WHERE engagement_id = '${engId}' ORDER BY id LIMIT 1000 OFFSET ${offset}`);
    if (!rows) return null;
    if (rows.length === 0) break;
    allTb = allTb.concat(rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return allTb;
}

// Compute note total — Pattern B simple sum, Pattern A column extraction, COGS sub-configs
function computeNoteTotal(noteRec, col, config) {
  if (!noteRec) return { cy: 0, py: 0 };
  const cyData = noteRec.cy_data || {};
  const pyData = noteRec.py_data || {};
  const numsCy = extractNumerics(cyData);
  const numsPy = extractNumerics(pyData);
  const customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];

  // COGS sub-configs
  if (config === "cogs_a") {
    // Check if formula rows have data
    const formulaInputs = ["raw_open", "raw_purch", "raw_close", "pack_open", "pack_purch", "pack_close", "other_open", "other_purch", "other_close"];
    const hasFormulaData = formulaInputs.some(id => Math.abs(numsCy[id] ?? 0) > 0.01);

    if (hasFormulaData) {
      const rawCon = (numsCy["raw_open"] ?? 0) + (numsCy["raw_purch"] ?? 0) - (numsCy["raw_close"] ?? 0);
      const packCon = (numsCy["pack_open"] ?? 0) + (numsCy["pack_purch"] ?? 0) - (numsCy["pack_close"] ?? 0);
      const otherCon = (numsCy["other_open"] ?? 0) + (numsCy["other_purch"] ?? 0) - (numsCy["other_close"] ?? 0);
      const rawConPy = (numsPy["raw_open"] ?? 0) + (numsPy["raw_purch"] ?? 0) - (numsPy["raw_close"] ?? 0);
      const packConPy = (numsPy["pack_open"] ?? 0) + (numsPy["pack_purch"] ?? 0) - (numsPy["pack_close"] ?? 0);
      const otherConPy = (numsPy["other_open"] ?? 0) + (numsPy["other_purch"] ?? 0) - (numsPy["other_close"] ?? 0);
      return { cy: round2(rawCon + packCon + otherCon), py: round2(rawConPy + packConPy + otherConPy) };
    }

    // Custom rows ARE the purchase data
    let cy = 0, py = 0;
    for (const cr of customRows) {
      cy += numsCy[cr.id] ?? 0;
      py += numsPy[cr.id] ?? 0;
      if ((cr.sources || []).length > 0 && (numsCy[cr.id] ?? 0) === 0)
        cy += cr.sources.reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
      if ((cr.sources || []).length > 0 && (numsPy[cr.id] ?? 0) === 0)
        py += cr.sources.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0);
    }
    return { cy: round2(cy), py: round2(py) };
  }

  if (config === "cogs_c") {
    const cy = ((numsCy["pc_open_trade"] ?? 0) + (numsCy["pc_open_wip"] ?? 0) + (numsCy["pc_open_fg"] ?? 0))
             - ((numsCy["pc_close_trade"] ?? 0) + (numsCy["pc_close_wip"] ?? 0) + (numsCy["pc_close_fg"] ?? 0));
    const py = ((numsPy["pc_open_trade"] ?? 0) + (numsPy["pc_open_wip"] ?? 0) + (numsPy["pc_open_fg"] ?? 0))
             - ((numsPy["pc_close_trade"] ?? 0) + (numsPy["pc_close_wip"] ?? 0) + (numsPy["pc_close_fg"] ?? 0));
    return { cy: round2(cy), py: round2(py) };
  }

  // Pattern A
  if (col) {
    let noteCy = 0, notePy = 0;
    const seenBases = new Set();
    for (const k of Object.keys(numsCy)) {
      if (k.endsWith("_lt")) seenBases.add(k.slice(0, -3));
      else if (k.endsWith("_st")) seenBases.add(k.slice(0, -3));
    }
    for (const [k, v] of Object.entries(numsCy)) {
      if (k.endsWith("_lt") && col === "lt") noteCy += v;
      else if (k.endsWith("_st") && col === "st") noteCy += v;
      else if (!k.endsWith("_lt") && !k.endsWith("_st") && !seenBases.has(k) && col === "lt") noteCy += v;
    }
    const seenBasesP = new Set();
    for (const k of Object.keys(numsPy)) {
      if (k.endsWith("_lt")) seenBasesP.add(k.slice(0, -3));
      else if (k.endsWith("_st")) seenBasesP.add(k.slice(0, -3));
    }
    for (const [k, v] of Object.entries(numsPy)) {
      if (k.endsWith("_lt") && col === "lt") notePy += v;
      else if (k.endsWith("_st") && col === "st") notePy += v;
      else if (!k.endsWith("_lt") && !k.endsWith("_st") && !seenBasesP.has(k) && col === "lt") notePy += v;
    }
    return { cy: round2(noteCy), py: round2(notePy) };
  }

  // Pattern B
  let noteCy = Object.values(numsCy).reduce((s, v) => s + v, 0);
  let notePy = Object.values(numsPy).reduce((s, v) => s + v, 0);

  for (const cr of customRows) {
    if (!cr.sources || cr.sources.length === 0 || cr.attachedTo) continue;
    const srcCy = cr.sources.reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
    const srcPy = cr.sources.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0);
    if ((numsCy[cr.id] ?? 0) === 0) noteCy += srcCy;
    if ((numsPy[cr.id] ?? 0) === 0) notePy += srcPy;
  }

  return { cy: round2(noteCy), py: round2(notePy) };
}

const ALL_CODES = {
  NCE_LTB: { note: "borrowings", col: "lt" }, NCE_STB: { note: "borrowings", col: "st" },
  NCE_OLTL: { note: "other_lt_liab" }, NCE_LTP: { note: "provisions", col: "lt" },
  NCE_STP: { note: "provisions", col: "st" }, NCE_TP: { note: "trade_payables" },
  NCE_OCL: { note: "other_cl" }, NCE_CWIP: { note: "cwip" },
  NCE_NCINV: { note: "investments", col: "lt" }, NCE_CINV: { note: "investments", col: "st" },
  NCE_LTLA: { note: "loans_advances", col: "lt" }, NCE_STLA: { note: "loans_advances", col: "st" },
  NCE_ONCA: { note: "other_nc_assets" }, NCE_STCK: { note: "inventories" },
  NCE_TR: { note: "trade_receivables" }, NCE_CASH: { note: "cash_bank" },
  NCE_OCA: { note: "other_ca" },
  NCE_REV_OPS: { note: "revenue_ops" }, NCE_REV_OTH: { note: "other_income" },
  NCE_COGS: { note: "cogs", config: "cogs_a" }, NCE_CII: { note: "cogs", config: "cogs_c" },
  NCE_EMP_EXP: { note: "employee_exp" }, NCE_FIN_COST: { note: "finance_costs" },
  NCE_OTH_EXP: { note: "other_expenses" },
};

const PL_NOTES = new Set(["revenue_ops", "other_income", "cogs", "employee_exp", "finance_costs", "other_expenses"]);

function verifyClient(engId, name) {
  console.log(`\n${"=".repeat(120)}`);
  console.log(`  ${name}`);
  console.log(`${"=".repeat(120)}`);

  const coaRows = dbQuery(`SELECT coa_mapping FROM audit_engagements WHERE id = '${engId}'`);
  const coaMapping = coaRows?.[0]?.coa_mapping || {};

  const tb = loadTB(engId);
  const tbByName = {};
  for (const row of tb) tbByName[row.ledger_name] = row;

  const noteRows = dbQuery(`SELECT id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${engId}'`);
  const noteByType = {};
  for (const n of noteRows) noteByType[n.note_type] = n;

  const codeLedgers = {};
  for (const [ledgerName, mapping] of Object.entries(coaMapping)) {
    if (!mapping || !mapping.code) continue;
    if (!codeLedgers[mapping.code]) codeLedgers[mapping.code] = [];
    codeLedgers[mapping.code].push({ ledgerName, tb: tbByName[ledgerName] });
  }

  console.log(`\n  ${"Code".padEnd(14)} ${"NoteType".padEnd(20)} ${"Type".padEnd(5)} ${"COA CY".padStart(14)} ${"Note CY".padStart(14)} ${"Drift CY".padStart(12)} | ${"COA PY".padStart(14)} ${"Note PY".padStart(14)} ${"Drift PY".padStart(12)}  Status`);
  console.log("  " + "-".repeat(140));

  let totalDriftCy = 0, totalDriftPy = 0;
  let okCount = 0, driftCount = 0, manualCount = 0, structuralCount = 0;

  for (const [fsCode, codeInfo] of Object.entries(ALL_CODES)) {
    const nature = NOTE_NATURE[codeInfo.note] || "CR";
    const isPL = PL_NOTES.has(codeInfo.note);
    const ledgers = codeLedgers[fsCode] || [];

    let coaCy = 0, coaPy = 0;
    for (const { tb: t } of ledgers) {
      if (!t) continue;
      coaCy += signedClosing(t.closing_balance, t.balance_type, nature);
      if (!isPL) coaPy += signedOpening(t.opening_balance, t.opening_type, nature);
    }
    coaCy = round2(coaCy);
    coaPy = round2(coaPy);

    const noteTotal = computeNoteTotal(noteByType[codeInfo.note], codeInfo.col, codeInfo.config);
    const driftCy = round2(Math.abs(coaCy - noteTotal.cy));
    const driftPy = isPL ? 0 : round2(Math.abs(coaPy - noteTotal.py));

    totalDriftCy += driftCy;
    totalDriftPy += driftPy;

    let status;
    if (driftCy <= 1 && driftPy <= 1) {
      status = "OK";
      okCount++;
    } else if (fsCode === "NCE_CII" && ledgers.length === 0) {
      status = "STRUCTURAL (no COA mapping for inventory change)";
      structuralCount++;
    } else if (fsCode === "NCE_OCL" && driftCy > 100000) {
      status = "MANUAL (auditor addition)";
      manualCount++;
    } else if (driftCy <= 1000 && driftPy <= 1000) {
      status = "MINOR (<1K)";
      driftCount++;
    } else {
      status = "DRIFT";
      driftCount++;
    }

    const type = isPL ? "P&L" : "BS";
    console.log(`  ${fsCode.padEnd(14)} ${codeInfo.note.padEnd(20)} ${type.padEnd(5)} ${fmt(coaCy).padStart(14)} ${fmt(noteTotal.cy).padStart(14)} ${fmt(driftCy).padStart(12)} | ${fmt(coaPy).padStart(14)} ${fmt(noteTotal.py).padStart(14)} ${fmt(driftPy).padStart(12)}  ${status}`);
  }

  console.log("  " + "-".repeat(140));
  console.log(`  TOTALS: CY drift=${fmt(round2(totalDriftCy))}, PY drift=${fmt(round2(totalDriftPy))}`);
  console.log(`  OK: ${okCount}, Structural: ${structuralCount}, Manual: ${manualCount}, Drift: ${driftCount}`);

  return { totalDriftCy: round2(totalDriftCy), totalDriftPy: round2(totalDriftPy) };
}

console.log("=".repeat(120));
console.log("  FINAL VERIFICATION — ALL NOTES (BS + P&L) — POST-FIX");
console.log("  Time:", new Date().toISOString());
console.log("=".repeat(120));

const shriRam = verifyClient("6074f0fb-679a-4b88-98a6-c421cfcf8e0a", "SHRI RAM PRODUCTS (FY 2025-26)");
const maharsh = verifyClient("70563956-c474-4b78-b2e6-6c2ead600efd", "MAHARSH INFRA (FY 2025-26)");

console.log("\n" + "=".repeat(120));
console.log("  SUMMARY");
console.log("=".repeat(120));
console.log(`  Shri Ram Products: CY drift=${fmt(shriRam.totalDriftCy)}, PY drift=${fmt(shriRam.totalDriftPy)}`);
console.log(`  Maharsh Infra:     CY drift=${fmt(maharsh.totalDriftCy)}, PY drift=${fmt(maharsh.totalDriftPy)}`);
console.log("=".repeat(120));
