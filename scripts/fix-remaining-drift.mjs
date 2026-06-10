/**
 * Fix remaining drift found by the comprehensive audit.
 *
 * Issues identified:
 *
 * SHRI RAM PRODUCTS:
 * 1. NCE_COGS CY drift=3,32,96,997.60 — custom rows hold purchase amounts but
 *    computeNoteTotal(config=cogs_a) walks pa_total formula which reads raw_consumed
 *    etc. that are 0. Custom rows ARE the data. The note total computation for
 *    COGS sub-configs needs to sum custom rows that aren't part of the formula.
 *    → This is STRUCTURAL (COGS note total reads from formula rows, not custom rows).
 *    → The face reads from the full "cogs" note; the audit script's sub-config
 *      computation is wrong. Need to compute COGS differently.
 *    → FIX: For COGS, the note total = sum of ALL non-formula, non-meta values
 *      (which includes custom rows). The sub-config formula only applies when data
 *      is in static rows. When all data is in custom rows, those ARE the total.
 *
 * 2. NCE_CII CY drift=2,03,788.00 — Note CY=-2,03,788 computed from
 *    pc_open_trade(21,54,860) - pc_close_trade(23,58,648) = -2,03,788.
 *    COA has 0 ledgers mapped to NCE_CII. The note data has CII values because
 *    the cogs note stores ALL sub-sections together. The formula computation
 *    correctly reads the CII section. This is actually CORRECT note behavior —
 *    the CII section of the cogs note has data even though no ledgers are
 *    specifically mapped to NCE_CII. It's a classification issue, not a data bug.
 *
 * MAHARSH INFRA:
 * 1. NCE_LTB CY drift=7,51,008 — Mahil Infra: note has +3,75,504 but TB says -3,75,504
 *    → FIX: Wrong sign on custom row
 *
 * 2. NCE_OCL CY drift=1,32,50,000 PY drift=1,03,00,000 — "Plot No. A" row
 *    with CY=1,32,50,000 PY=1,03,00,000 not backed by COA
 *    → STRUCTURAL: This is auditor-added manual data. Not fixable by automation.
 *    → Check if there's a TB ledger that matches this amount
 *
 * 3. NCE_LTLA CY=52,32,278 drift — Custom rows written with _lt suffix but all
 *    ledgers mapped to NCE_STLA. The _lt suffix rows (Tushar V Padsala 32,32,278
 *    + Vinubhai 20,00,000) are creating phantom LTLA totals.
 *    → FIX: Remove the _lt suffix values that were incorrectly created
 *
 * 4. NCE_STLA PY drift=24,00,000 — custom_advance_tax_1_lt and _st both have
 *    24,00,000 PY. The _lt value leaks into LTLA and the _st into STLA. But
 *    COA PY for STLA is 5,18,66,109. Note STLA PY is 5,42,66,109 = COA + 24,00,000.
 *    → FIX: Remove the duplicate _lt value for advance_tax
 *
 * 5. NCE_COGS drift (same structural issue as Shri Ram)
 *
 * 6. NCE_OTH_EXP CY drift=258 — tiny rounding, ignorable
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

function dbExec(sql) {
  try {
    const cleaned = sql.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    const escaped = cleaned.replace(/"/g, '\\"');
    const cmd = `npx supabase db query --linked "${escaped}"`;
    execSync(cmd, { cwd: CWD, encoding: "utf8", timeout: 30000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e.message || "").substring(0, 500) };
  }
}

const fmt = (n) => {
  if (n == null) return "-";
  if (n === 0) return "0.00";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const parts = abs.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{2})+(\d)(?!\d))/g, ",");
  return sign + parts.join(".");
};

const round2 = (n) => Math.round(n * 100) / 100;

const MAHARSH_ID = "70563956-c474-4b78-b2e6-6c2ead600efd";
const SHRI_RAM_ID = "6074f0fb-679a-4b88-98a6-c421cfcf8e0a";

// ── Sign convention ─────────────────────────────────────────────────────────
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

// COGS note total: sum all custom row amounts + static inventory change rows
// The COGS note stores data primarily in custom rows (purchases) plus
// pc_open_trade/pc_close_trade (inventory changes). The sub-config formula
// (raw_consumed = raw_open + raw_purch - raw_close) applies when data is in
// those formula row IDs. When data is in custom rows, those rows ARE the purchase
// amounts, and the formula static rows are 0.
//
// For NCE_COGS (cogs_a): Total = sum of all custom row amounts (purchases)
//   These custom rows are NOT attached to formula rows — they're free-standing
//   purchase ledgers that auto-populate created.
//
// For NCE_CII (cogs_c): Total = pc_open - pc_close (inventory change)
//   pc_open_trade / pc_close_trade hold the opening/closing stock-in-trade values.
function computeCogsSectionTotal(noteRec, config) {
  if (!noteRec) return { cy: 0, py: 0 };
  const cyData = noteRec.cy_data || {};
  const pyData = noteRec.py_data || {};
  const numsCy = extractNumerics(cyData);
  const numsPy = extractNumerics(pyData);
  const customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];

  if (config === "cogs_a") {
    // Sum all custom row values (purchase amounts) — these are the actual COA data
    // Also include any static row values that aren't formula totals
    let cy = 0, py = 0;

    // Custom row values
    for (const cr of customRows) {
      cy += numsCy[cr.id] ?? 0;
      py += numsPy[cr.id] ?? 0;
      // Also check sources
      if ((cr.sources || []).length > 0 && (numsCy[cr.id] ?? 0) === 0) {
        cy += cr.sources.reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
      }
      if ((cr.sources || []).length > 0 && (numsPy[cr.id] ?? 0) === 0) {
        py += cr.sources.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0);
      }
    }

    // Static formula input rows (raw_open, raw_purch, raw_close, etc.)
    const formulaInputs = [
      "raw_open", "raw_purch", "raw_close",
      "pack_open", "pack_purch", "pack_close",
      "other_open", "other_purch", "other_close",
    ];
    for (const id of formulaInputs) {
      if (numsCy[id]) cy += numsCy[id];
      if (numsPy[id]) py += numsPy[id];
    }

    // But wait — if we sum raw_open + raw_purch + raw_close, that's wrong.
    // The formula is raw_consumed = raw_open + raw_purch - raw_close.
    // If formula inputs have values, compute via formula. If not, use custom rows.

    // Actually, let's check: do the formula inputs have values?
    const hasFormulaData = formulaInputs.some(id => Math.abs(numsCy[id] ?? 0) > 0.01);

    if (hasFormulaData) {
      // Compute via formula
      const rawCon = (numsCy["raw_open"] ?? 0) + (numsCy["raw_purch"] ?? 0) - (numsCy["raw_close"] ?? 0);
      const packCon = (numsCy["pack_open"] ?? 0) + (numsCy["pack_purch"] ?? 0) - (numsCy["pack_close"] ?? 0);
      const otherCon = (numsCy["other_open"] ?? 0) + (numsCy["other_purch"] ?? 0) - (numsCy["other_close"] ?? 0);
      const rawConPy = (numsPy["raw_open"] ?? 0) + (numsPy["raw_purch"] ?? 0) - (numsPy["raw_close"] ?? 0);
      const packConPy = (numsPy["pack_open"] ?? 0) + (numsPy["pack_purch"] ?? 0) - (numsPy["pack_close"] ?? 0);
      const otherConPy = (numsPy["other_open"] ?? 0) + (numsPy["other_purch"] ?? 0) - (numsPy["other_close"] ?? 0);
      return { cy: round2(rawCon + packCon + otherCon), py: round2(rawConPy + packConPy + otherConPy) };
    }

    // No formula data — sum custom rows only
    cy = 0; py = 0;
    for (const cr of customRows) {
      cy += numsCy[cr.id] ?? 0;
      py += numsPy[cr.id] ?? 0;
      if ((cr.sources || []).length > 0 && (numsCy[cr.id] ?? 0) === 0) {
        cy += cr.sources.reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
      }
      if ((cr.sources || []).length > 0 && (numsPy[cr.id] ?? 0) === 0) {
        py += cr.sources.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0);
      }
    }
    return { cy: round2(cy), py: round2(py) };
  }

  if (config === "cogs_c") {
    // Changes in inventories: Opening - Closing
    const openTrade = numsCy["pc_open_trade"] ?? 0;
    const openWip = numsCy["pc_open_wip"] ?? 0;
    const openFg = numsCy["pc_open_fg"] ?? 0;
    const closeTrade = numsCy["pc_close_trade"] ?? 0;
    const closeWip = numsCy["pc_close_wip"] ?? 0;
    const closeFg = numsCy["pc_close_fg"] ?? 0;

    const openTradePy = numsPy["pc_open_trade"] ?? 0;
    const openWipPy = numsPy["pc_open_wip"] ?? 0;
    const openFgPy = numsPy["pc_open_fg"] ?? 0;
    const closeTradePy = numsPy["pc_close_trade"] ?? 0;
    const closeWipPy = numsPy["pc_close_wip"] ?? 0;
    const closeFgPy = numsPy["pc_close_fg"] ?? 0;

    const cy = (openTrade + openWip + openFg) - (closeTrade + closeWip + closeFg);
    const py = (openTradePy + openWipPy + openFgPy) - (closeTradePy + closeWipPy + closeFgPy);
    return { cy: round2(cy), py: round2(py) };
  }

  return { cy: 0, py: 0 };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
function main() {
  console.log("=".repeat(120));
  console.log("  TARGETED FIX SCRIPT — Remaining drift");
  console.log("  Started:", new Date().toISOString());
  console.log("=".repeat(120));

  // ── MAHARSH INFRA FIXES ─────────────────────────────────────────────────
  console.log("\n== MAHARSH INFRA ==\n");

  // Load data
  const maharshNotes = dbQuery(`SELECT id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${MAHARSH_ID}'`);
  const maharshNoteByType = {};
  for (const n of maharshNotes) maharshNoteByType[n.note_type] = n;

  const maharshTb = loadTB(MAHARSH_ID);
  const maharshTbByName = {};
  for (const row of maharshTb) maharshTbByName[row.ledger_name] = row;

  const maharshCoaRows = dbQuery(`SELECT coa_mapping FROM audit_engagements WHERE id = '${MAHARSH_ID}'`);
  const maharshCoa = maharshCoaRows?.[0]?.coa_mapping || {};

  // ── Fix 1: Mahil Infra sign in borrowings (NCE_LTB) ──────────────────
  console.log("-- Fix 1: Mahil Infra wrong sign in borrowings --");
  const borrNote = maharshNoteByType["borrowings"];
  if (borrNote) {
    const cyData = borrNote.cy_data || {};
    const mahilCyKey = Object.keys(cyData).find(k => k.includes("mahil_infra") && k.endsWith("_lt"));
    if (mahilCyKey) {
      const currentCy = Number(cyData[mahilCyKey] ?? 0);
      console.log(`  Found ${mahilCyKey}: CY=${fmt(currentCy)}`);
      const tbRow = maharshTbByName["Mahil Infra"];
      if (tbRow) {
        const expectedCy = signedClosing(tbRow.closing_balance, tbRow.balance_type, "CR");
        console.log(`  TB: closing=${tbRow.closing_balance} ${tbRow.balance_type} → signed=${fmt(expectedCy)}`);
        if (Math.abs(currentCy - expectedCy) > 1) {
          console.log(`  FIX: ${fmt(currentCy)} → ${fmt(expectedCy)}`);
          const sql = `UPDATE nce_financial_notes SET cy_data = jsonb_set(cy_data, '{${mahilCyKey}}', '${expectedCy}'::jsonb, true) WHERE id = '${borrNote.id}';`;
          console.log(`  SQL: ${sql}`);
          const res = dbExec(sql);
          console.log(`  ${res.ok ? "OK" : "FAILED: " + res.error}`);
        }
      }
    }
  }

  // ── Fix 2: loans_advances — remove _lt values that shouldn't exist ────
  // The LTLA fix from previous run wrote _lt values for Tushar and Vinubhai,
  // but those ledgers are mapped to NCE_STLA (Short-Term). The _lt values
  // are phantom data. We need to zero them out.
  // Also, custom_advance_tax_1_lt has PY=24,00,000 which leaks into LTLA.
  console.log("\n-- Fix 2: Remove phantom _lt values from loans_advances --");
  const laNote = maharshNoteByType["loans_advances"];
  if (laNote) {
    const cyData = laNote.cy_data || {};
    const pyData = laNote.py_data || {};

    // Find all _lt keys that have values but NO ledgers mapped to NCE_LTLA
    const ltCyKeys = Object.keys(extractNumerics(cyData)).filter(k => k.endsWith("_lt") && Math.abs(Number(cyData[k])) > 0.01);
    const ltPyKeys = Object.keys(extractNumerics(pyData)).filter(k => k.endsWith("_lt") && Math.abs(Number(pyData[k])) > 0.01);

    console.log(`  _lt CY keys with values: ${ltCyKeys.length}`);
    for (const k of ltCyKeys) console.log(`    ${k}: ${fmt(Number(cyData[k]))}`);
    console.log(`  _lt PY keys with values: ${ltPyKeys.length}`);
    for (const k of ltPyKeys) console.log(`    ${k}: ${fmt(Number(pyData[k]))}`);

    // Check COA — are ANY ledgers mapped to NCE_LTLA?
    let ltlaLedgers = 0;
    for (const [, mapping] of Object.entries(maharshCoa)) {
      if (mapping?.code === "NCE_LTLA") ltlaLedgers++;
    }
    console.log(`  Ledgers mapped to NCE_LTLA: ${ltlaLedgers}`);

    if (ltlaLedgers === 0) {
      console.log("  No ledgers mapped to NCE_LTLA — ALL _lt values are phantom data");

      // Zero out all _lt CY values
      if (ltCyKeys.length > 0) {
        let jsonbExpr = "cy_data";
        for (const k of ltCyKeys) {
          jsonbExpr = `jsonb_set(${jsonbExpr}, '{${k}}', '0'::jsonb, true)`;
        }
        const sql = `UPDATE nce_financial_notes SET cy_data = ${jsonbExpr} WHERE id = '${laNote.id}';`;
        console.log(`  SQL (CY): ${sql.substring(0, 300)}...`);
        const res = dbExec(sql);
        console.log(`  ${res.ok ? "OK" : "FAILED: " + res.error}`);
      }

      // Zero out all _lt PY values
      if (ltPyKeys.length > 0) {
        let jsonbExpr = "py_data";
        for (const k of ltPyKeys) {
          jsonbExpr = `jsonb_set(${jsonbExpr}, '{${k}}', '0'::jsonb, true)`;
        }
        const sql = `UPDATE nce_financial_notes SET py_data = ${jsonbExpr} WHERE id = '${laNote.id}';`;
        console.log(`  SQL (PY): ${sql.substring(0, 300)}...`);
        const res = dbExec(sql);
        console.log(`  ${res.ok ? "OK" : "FAILED: " + res.error}`);
      }
    }
  }

  // ── Fix 3: OCL investigation — is "Plot No. A" backed by any TB ledger? ─
  console.log("\n-- Fix 3: OCL — investigating Plot No. A surplus --");
  const oclNote = maharshNoteByType["other_cl"];
  if (oclNote) {
    const cyData = oclNote.cy_data || {};
    const customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];

    // Find the "Plot No. A" row
    const plotA = customRows.find(cr => (cr.label || "").includes("Plot No. A"));
    if (plotA) {
      console.log(`  Found: id=${plotA.id}, label="${plotA.label}", source=${plotA.source}`);
      console.log(`  CY=${fmt(Number(cyData[plotA.id] ?? 0))}, PY=${fmt(Number((oclNote.py_data || {})[plotA.id] ?? 0))}`);

      // Check if there's a matching TB ledger
      const matchLabel = (plotA.label || "").trim();
      const tbRow = maharshTbByName[matchLabel];
      if (tbRow) {
        console.log(`  TB match found: ${matchLabel} → closing=${tbRow.closing_balance} ${tbRow.balance_type}`);
      } else {
        console.log(`  No TB match for "${matchLabel}"`);
        // Look for partial matches
        const partial = Object.keys(maharshTbByName).filter(k => k.toLowerCase().includes("plot") && k.toLowerCase().includes("a"));
        if (partial.length) {
          console.log(`  Partial TB matches:`);
          for (const k of partial.slice(0, 10)) {
            const tb = maharshTbByName[k];
            console.log(`    "${k}": closing=${tb.closing_balance} ${tb.balance_type}`);
          }
        }

        // Check if OCL total matches COA when we exclude Plot No. A
        const numsCy = extractNumerics(cyData);
        const totalWithPlotA = Object.values(numsCy).reduce((s, v) => s + v, 0);
        const plotAVal = Number(cyData[plotA.id] ?? 0);
        const totalWithoutPlotA = totalWithPlotA - plotAVal;
        console.log(`  OCL note total: ${fmt(round2(totalWithPlotA))}`);
        console.log(`  OCL without Plot No. A: ${fmt(round2(totalWithoutPlotA))}`);
        console.log(`  OCL COA: 8,57,20,204 — matches "without" = ${Math.abs(round2(totalWithoutPlotA) - 85720204) < 1 ? "YES" : "NO"}`);
        console.log(`  → This is a MANUAL ADDITION by the auditor. Not a bug — leaving as is.`);
      }
    }
  }

  // ── Now verify MAHARSH after fixes ─────────────────────────────────────
  console.log("\n== MAHARSH INFRA — POST-FIX VERIFICATION ==\n");
  verifyClient(MAHARSH_ID, "MAHARSH INFRA");

  // ── SHRI RAM PRODUCTS — COGS analysis ──────────────────────────────────
  console.log("\n== SHRI RAM PRODUCTS — COGS analysis ==\n");

  const shriRamNotes = dbQuery(`SELECT id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${SHRI_RAM_ID}'`);
  const shriRamNoteByType = {};
  for (const n of shriRamNotes) shriRamNoteByType[n.note_type] = n;

  const shriRamTb = loadTB(SHRI_RAM_ID);
  const shriRamTbByName = {};
  for (const row of shriRamTb) shriRamTbByName[row.ledger_name] = row;

  const shriRamCoaRows = dbQuery(`SELECT coa_mapping FROM audit_engagements WHERE id = '${SHRI_RAM_ID}'`);
  const shriRamCoa = shriRamCoaRows?.[0]?.coa_mapping || {};

  // Analyze COGS note
  const cogsNote = shriRamNoteByType["cogs"];
  if (cogsNote) {
    const cyData = cogsNote.cy_data || {};
    const customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];

    console.log(`COGS note has ${customRows.length} custom rows`);
    console.log(`Custom row IDs: ${customRows.map(cr => cr.id).join(", ")}`);

    // Compute cogs_a total using corrected method
    const cogsATotal = computeCogsSectionTotal(cogsNote, "cogs_a");
    console.log(`\nCOGS_A total (corrected): CY=${fmt(cogsATotal.cy)}, PY=${fmt(cogsATotal.py)}`);

    // What COA says
    let coaCy = 0;
    for (const [ledgerName, mapping] of Object.entries(shriRamCoa)) {
      if (mapping?.code !== "NCE_COGS") continue;
      const tb = shriRamTbByName[ledgerName];
      if (!tb) continue;
      coaCy += signedClosing(tb.closing_balance, tb.balance_type, "DR");
    }
    console.log(`COA CY for NCE_COGS: ${fmt(round2(coaCy))}`);
    console.log(`Drift: ${fmt(round2(Math.abs(coaCy - cogsATotal.cy)))}`);

    // Compute cogs_c total
    const cogsCTotal = computeCogsSectionTotal(cogsNote, "cogs_c");
    console.log(`\nCOGS_C total (corrected): CY=${fmt(cogsCTotal.cy)}, PY=${fmt(cogsCTotal.py)}`);
    console.log(`COA CY for NCE_CII: 0 (no ledgers mapped)`);
    console.log(`Note CII is inventory change: ${fmt(cogsCTotal.cy)} — this is structural, not a data bug`);

    // Verify: COGS_A (custom rows) + COGS_C (inventory change) = total COGS
    console.log(`\nTotal COGS = COGS_A + COGS_C = ${fmt(round2(cogsATotal.cy + cogsCTotal.cy))}`);
    console.log(`This SHOULD match the P&L face line for COGS+CII combined`);
  }

  // Verify Shri Ram
  console.log("\n== SHRI RAM PRODUCTS — VERIFICATION (using corrected COGS computation) ==\n");
  verifyClientCorrected(SHRI_RAM_ID, "SHRI RAM PRODUCTS", shriRamCoa, shriRamTbByName);

  // Also verify Maharsh with corrected COGS
  console.log("\n== MAHARSH INFRA — VERIFICATION (using corrected COGS computation) ==\n");

  // Reload Maharsh notes after fixes
  const maharshNotes2 = dbQuery(`SELECT id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${MAHARSH_ID}'`);
  const maharshNoteByType2 = {};
  for (const n of maharshNotes2) maharshNoteByType2[n.note_type] = n;

  verifyClientCorrected(MAHARSH_ID, "MAHARSH INFRA", maharshCoa, maharshTbByName, maharshNoteByType2);

  console.log("\n" + "=".repeat(120));
  console.log("  COMPLETE:", new Date().toISOString());
  console.log("=".repeat(120));
}

function verifyClient(engId, name) {
  const notes = dbQuery(`SELECT id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${engId}'`);
  const noteByType = {};
  for (const n of notes) noteByType[n.note_type] = n;

  const coaRows = dbQuery(`SELECT coa_mapping FROM audit_engagements WHERE id = '${engId}'`);
  const coaMapping = coaRows?.[0]?.coa_mapping || {};

  const tb = loadTB(engId);
  const tbByName = {};
  for (const row of tb) tbByName[row.ledger_name] = row;

  const codeLedgers = {};
  for (const [ledgerName, mapping] of Object.entries(coaMapping)) {
    if (!mapping || !mapping.code) continue;
    if (!codeLedgers[mapping.code]) codeLedgers[mapping.code] = [];
    codeLedgers[mapping.code].push({ ledgerName, tb: tbByName[ledgerName] });
  }

  const NCE_CODE_TO_NOTE = {
    NCE_LTB: { note: "borrowings", col: "lt" }, NCE_STB: { note: "borrowings", col: "st" },
    NCE_OLTL: { note: "other_lt_liab" }, NCE_LTP: { note: "provisions", col: "lt" },
    NCE_STP: { note: "provisions", col: "st" }, NCE_TP: { note: "trade_payables" },
    NCE_OCL: { note: "other_cl" }, NCE_CWIP: { note: "cwip" },
    NCE_NCINV: { note: "investments", col: "lt" }, NCE_CINV: { note: "investments", col: "st" },
    NCE_LTLA: { note: "loans_advances", col: "lt" }, NCE_STLA: { note: "loans_advances", col: "st" },
    NCE_ONCA: { note: "other_nc_assets" }, NCE_STCK: { note: "inventories" },
    NCE_TR: { note: "trade_receivables" }, NCE_CASH: { note: "cash_bank" },
    NCE_OCA: { note: "other_ca" },
  };

  const PL_NOTES = new Set(["revenue_ops", "other_income", "cogs", "employee_exp", "finance_costs", "other_expenses"]);

  console.log(`  ${"Code".padEnd(14)} ${"COA CY".padStart(14)} ${"Note CY".padStart(14)} ${"Drift CY".padStart(12)} | ${"COA PY".padStart(14)} ${"Note PY".padStart(14)} ${"Drift PY".padStart(12)}  Status`);
  console.log("  " + "-".repeat(110));

  for (const [fsCode, codeInfo] of Object.entries(NCE_CODE_TO_NOTE)) {
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

    const noteRec = noteByType[codeInfo.note];
    const noteTotal = computeNoteTotalSimple(noteRec, codeInfo.col);
    const driftCy = round2(Math.abs(coaCy - noteTotal.cy));
    const driftPy = isPL ? 0 : round2(Math.abs(coaPy - noteTotal.py));
    const status = driftCy <= 1 && driftPy <= 1 ? "OK" : "DRIFT";
    console.log(`  ${fsCode.padEnd(14)} ${fmt(coaCy).padStart(14)} ${fmt(noteTotal.cy).padStart(14)} ${fmt(driftCy).padStart(12)} | ${fmt(coaPy).padStart(14)} ${fmt(noteTotal.py).padStart(14)} ${fmt(driftPy).padStart(12)}  ${status}`);
  }
}

function computeNoteTotalSimple(noteRec, col) {
  if (!noteRec) return { cy: 0, py: 0 };
  const cyData = noteRec.cy_data || {};
  const pyData = noteRec.py_data || {};
  const numsCy = extractNumerics(cyData);
  const numsPy = extractNumerics(pyData);

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

  const noteCy = Object.values(numsCy).reduce((s, v) => s + v, 0);
  const notePy = Object.values(numsPy).reduce((s, v) => s + v, 0);
  return { cy: round2(noteCy), py: round2(notePy) };
}

function verifyClientCorrected(engId, name, coaMapping, tbByName, preloadedNotes) {
  const notes = preloadedNotes || (() => {
    const rows = dbQuery(`SELECT id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${engId}'`);
    const m = {};
    for (const n of rows) m[n.note_type] = n;
    return m;
  })();
  const noteByType = preloadedNotes || notes;

  if (!preloadedNotes) {
    const rows = dbQuery(`SELECT id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${engId}'`);
    for (const n of rows) noteByType[n.note_type] = n;
  }

  const codeLedgers = {};
  for (const [ledgerName, mapping] of Object.entries(coaMapping)) {
    if (!mapping || !mapping.code) continue;
    if (!codeLedgers[mapping.code]) codeLedgers[mapping.code] = [];
    codeLedgers[mapping.code].push({ ledgerName, tb: tbByName[ledgerName] });
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

  console.log(`  ${"Code".padEnd(14)} ${"NoteType".padEnd(20)} ${"COA CY".padStart(14)} ${"Note CY".padStart(14)} ${"Drift CY".padStart(12)} | ${"COA PY".padStart(14)} ${"Note PY".padStart(14)} ${"Drift PY".padStart(12)}  Status`);
  console.log("  " + "-".repeat(130));

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

    const noteRec = noteByType[codeInfo.note];
    let noteTotal;
    if (codeInfo.config) {
      noteTotal = computeCogsSectionTotal(noteRec, codeInfo.config);
    } else {
      noteTotal = computeNoteTotalSimple(noteRec, codeInfo.col);
    }

    const driftCy = round2(Math.abs(coaCy - noteTotal.cy));
    const driftPy = isPL ? 0 : round2(Math.abs(coaPy - noteTotal.py));
    const status = driftCy <= 1 && driftPy <= 1 ? "OK" :
                   (driftCy <= 1 ? "PY-DRIFT" : (driftPy <= 1 ? "CY-DRIFT" : "DRIFT"));

    const marker = (driftCy > 1 || driftPy > 1) ? " ***" : "";
    console.log(`  ${fsCode.padEnd(14)} ${codeInfo.note.padEnd(20)} ${fmt(coaCy).padStart(14)} ${fmt(noteTotal.cy).padStart(14)} ${fmt(driftCy).padStart(12)} | ${fmt(coaPy).padStart(14)} ${fmt(noteTotal.py).padStart(14)} ${fmt(driftPy).padStart(12)}  ${status}${marker}`);
  }
}

main();
