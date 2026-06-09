/**
 * fix-shree-maruti-ocl.mjs
 * ────────────────────────────────────────────────────────────────────────
 * One-shot fix for Shree Maruti Infra's other_cl note (NCE_OCL / BS_CL_OCL).
 *
 * Problem: the double-count guard incorrectly zeroed manual rows for non-B
 * plot ledgers. These manual rows should have their CY values set to the
 * TB closing balance.
 *
 * Also checks and fixes PY side: PY drift of ~₹19,37,638 (note PY
 * over-reports vs COA PY). Manual rows with stale PY values that differ
 * from TB opening_balance are corrected.
 *
 * Uses npx supabase db query --linked for the UPDATE (bypasses RLS).
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { execSync } from "child_process";

// ── Config ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://hubyywmodekfdzhwiumb.supabase.co";
const ENGAGEMENT_ID = "18fcfdb7-791a-426f-922e-3e6d9e0ac0bb";
const NOTE_TYPE = "other_cl";
const NATURE = "CR"; // other_cl is CR-natural

// Read service key from tally-xml-service/.env
let SUPABASE_KEY;
try {
  const envContent = readFileSync("tally-xml-service/.env", "utf8");
  SUPABASE_KEY = envContent
    .split("\n")
    .find((l) => l.startsWith("SUPABASE_SERVICE_KEY="))
    ?.split("=")
    .slice(1)
    .join("=")
    .trim();
} catch {
  SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
}
if (!SUPABASE_KEY) {
  console.error(
    "Cannot find service key. Set SUPABASE_SERVICE_ROLE_KEY env var or ensure tally-xml-service/.env exists."
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── FS codes that map to other_cl ──────────────────────────────────────────
const OCL_CODES = new Set(["NCE_OCL", "BS_CL_OCL"]);

// ── Sign convention helpers (from fsSignConvention.ts) ─────────────────────
function normSide(s) {
  const v = String(s ?? "").trim().toUpperCase();
  return v === "DR" || v === "CR" ? v : "";
}

/** Signed closing balance for CR-natural note */
function signedClosing(amount, balanceType) {
  const cb = Math.abs(Number(amount ?? 0));
  if (cb === 0) return 0;
  const side = normSide(balanceType);
  // Default: when balance_type is missing, treat as CR (natural side)
  if (!side) return +cb;
  return side === NATURE ? +cb : -cb;
}

/** Signed opening balance for CR-natural note */
function signedOpening(amount, openingType) {
  const ob = Math.abs(Number(amount ?? 0));
  if (ob === 0) return 0;
  const side = normSide(openingType);
  if (!side) return +ob;
  return side === NATURE ? +ob : -ob;
}

// ── Indian number formatting ───────────────────────────────────────────────
function fmt(n) {
  if (n == null) return "-";
  if (n === 0) return "0.00";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const parts = abs.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{2})+(\d)(?!\d))/g, ",");
  return sign + parts.join(".");
}

const META_KEYS = new Set([
  "_custom_rows",
  "_hidden_rows",
  "_label_overrides",
  "_cy_sources",
  "_ejected_ledgers",
  "_source_label_overrides",
  "_version",
]);

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(90));
  console.log("  FIX: Shree Maruti Infra — other_cl note data");
  console.log("=".repeat(90));

  // ── Step 1: Fetch the note row ──────────────────────────────────────────
  console.log("\n── STEP 1: Fetching nce_financial_notes for other_cl ──\n");

  const { data: noteRow, error: noteErr } = await sb
    .from("nce_financial_notes")
    .select("id, engagement_id, note_type, cy_data, py_data, financial_year")
    .eq("engagement_id", ENGAGEMENT_ID)
    .eq("note_type", NOTE_TYPE)
    .single();

  if (noteErr) {
    console.error("Note query error:", noteErr);
    return;
  }
  console.log(
    `Note row found: id=${noteRow.id}, FY=${noteRow.financial_year}`
  );

  const cyData = noteRow.cy_data || {};
  const pyData = noteRow.py_data || {};
  const customRows = Array.isArray(cyData._custom_rows)
    ? cyData._custom_rows
    : [];
  console.log(`Custom rows: ${customRows.length}`);

  // ── Step 2: Fetch ALL TB rows (paginated at 1000) ───────────────────────
  console.log("\n── STEP 2: Fetching trial balance ──\n");

  let allTb = [];
  let page = 0;
  while (true) {
    const from = page * 1000;
    const to = from + 999;
    const { data: batch, error: tbErr } = await sb
      .from("tally_trial_balance")
      .select(
        "id, ledger_name, closing_balance, balance_type, opening_balance, opening_type, parent_group"
      )
      .eq("engagement_id", ENGAGEMENT_ID)
      .range(from, to);
    if (tbErr) {
      console.error("TB error:", tbErr);
      return;
    }
    if (!batch?.length) break;
    allTb = allTb.concat(batch);
    if (batch.length < 1000) break;
    page++;
  }
  console.log(`Trial balance: ${allTb.length} rows (${page + 1} page(s))`);

  // Build TB lookup by ledger_name (case-sensitive, as stored)
  const tbByName = {};
  for (const row of allTb) {
    tbByName[row.ledger_name] = row;
  }
  // Also build lowercase lookup for fuzzy matching
  const tbByNameLower = {};
  for (const row of allTb) {
    tbByNameLower[row.ledger_name.toLowerCase()] = row;
  }

  // ── Step 3: Get COA mapping ─────────────────────────────────────────────
  console.log("\n── STEP 3: Fetching COA mapping ──\n");

  const { data: eng, error: engErr } = await sb
    .from("audit_engagements")
    .select("coa_mapping")
    .eq("id", ENGAGEMENT_ID)
    .single();

  if (engErr) {
    console.error("Engagement query error:", engErr);
    return;
  }

  const coaMapping = eng.coa_mapping || {};
  console.log(`COA mapping entries: ${Object.keys(coaMapping).length}`);

  // ── Step 4: Build map of NCE_OCL-mapped TB ledgers ──────────────────────
  console.log("\n── STEP 4: Building OCL ledger map ──\n");

  // ledger_name → { signedCy, signedPy, tbRow, fsCode }
  const oclLedgers = {};
  let coaCyTotal = 0;
  let coaPyTotal = 0;

  for (const [ledgerName, mapping] of Object.entries(coaMapping)) {
    if (!mapping || !mapping.code) continue;
    if (!OCL_CODES.has(mapping.code)) continue;

    const tb = tbByName[ledgerName];
    if (!tb) {
      console.log(`  WARN: COA maps "${ledgerName}" to ${mapping.code} but no TB row found`);
      continue;
    }

    const signedCy = signedClosing(tb.closing_balance, tb.balance_type);
    const signedPy = signedOpening(tb.opening_balance, tb.opening_type);

    oclLedgers[ledgerName] = {
      signedCy,
      signedPy,
      tbRow: tb,
      fsCode: mapping.code,
    };
    coaCyTotal += signedCy;
    coaPyTotal += signedPy;
  }

  console.log(`OCL-mapped ledgers: ${Object.keys(oclLedgers).length}`);
  console.log(`COA CY total: ${fmt(coaCyTotal)}`);
  console.log(`COA PY total: ${fmt(coaPyTotal)}`);

  // ── Step 5: Analyze and fix CY custom rows ─────────────────────────────
  console.log("\n── STEP 5: Analyzing CY custom rows ──\n");

  const cyUpdates = []; // { rowId, label, oldVal, newVal }
  const pyUpdates = []; // { rowId, label, oldVal, newVal }

  // Build a lowercase map of OCL ledgers for matching
  const oclByLower = {};
  for (const [name, info] of Object.entries(oclLedgers)) {
    oclByLower[name.toLowerCase()] = { name, ...info };
  }

  // Track which OCL ledgers are represented by custom rows
  const representedLedgers = new Set();

  for (const cr of customRows) {
    const lbl = (cr.label || "").trim();
    const lblLower = lbl.toLowerCase();
    const isManual = cr.source === "manual";
    const hasSources = (cr.sources ?? []).length > 0;
    const currentCy = Number(cyData[cr.id] ?? 0);
    const currentPy = Number(pyData[cr.id] ?? 0);

    // Check if this custom row matches an OCL-mapped TB ledger
    const oclMatch = oclByLower[lblLower];

    if (oclMatch) {
      representedLedgers.add(oclMatch.name);
    }

    // ── CY FIX: manual row with 0 sources, matches OCL TB ledger ──────
    if (isManual && !hasSources && oclMatch) {
      if (currentCy === 0 && oclMatch.signedCy !== 0) {
        cyUpdates.push({
          rowId: cr.id,
          label: lbl,
          oldVal: currentCy,
          newVal: oclMatch.signedCy,
        });
        console.log(
          `  CY FIX: "${lbl}" (${cr.id})  ${fmt(currentCy)} → ${fmt(oclMatch.signedCy)}`
        );
      } else if (currentCy !== 0 && currentCy !== oclMatch.signedCy) {
        console.log(
          `  CY NOTE: "${lbl}" (${cr.id}) has CY=${fmt(currentCy)} but TB says ${fmt(oclMatch.signedCy)} — MISMATCH (not zeroed, so not fixing)`
        );
      } else if (currentCy === oclMatch.signedCy) {
        console.log(
          `  CY OK: "${lbl}" (${cr.id}) = ${fmt(currentCy)} (matches TB)`
        );
      }
    }

    // ── PY CHECK: manual rows with stale PY values ────────────────────
    if (isManual && !hasSources && oclMatch) {
      if (currentPy !== oclMatch.signedPy) {
        pyUpdates.push({
          rowId: cr.id,
          label: lbl,
          oldVal: currentPy,
          newVal: oclMatch.signedPy,
        });
        console.log(
          `  PY FIX: "${lbl}" (${cr.id})  ${fmt(currentPy)} → ${fmt(oclMatch.signedPy)}`
        );
      } else {
        console.log(
          `  PY OK: "${lbl}" (${cr.id}) = ${fmt(currentPy)} (matches TB opening)`
        );
      }
    }

    // Also track source-ledgers inside grouped rows
    if (hasSources) {
      for (const src of cr.sources) {
        const srcName = (src.ledger || "").trim();
        if (oclByLower[srcName.toLowerCase()]) {
          representedLedgers.add(oclByLower[srcName.toLowerCase()].name);
        }
      }
    }
  }

  // Also check bare static rows that have numeric values
  for (const [key, val] of Object.entries(cyData)) {
    if (META_KEYS.has(key)) continue;
    if (typeof val !== "number") continue;
    // Check if any custom row has this ID (already processed above)
    const isCustomRow = customRows.some((cr) => cr.id === key);
    if (!isCustomRow) {
      // Static row — check if its label might match an OCL ledger
      // (static rows typically have predefined labels, not TB names)
    }
  }

  // ── Step 6: Check for unrepresented TB ledgers ─────────────────────────
  console.log("\n── STEP 6: Unrepresented OCL TB ledgers ──\n");

  const unrepresented = [];
  for (const [name, info] of Object.entries(oclLedgers)) {
    if (!representedLedgers.has(name)) {
      unrepresented.push({ name, ...info });
      console.log(
        `  MISSING: "${name}" → CY=${fmt(info.signedCy)}, PY=${fmt(info.signedPy)}, code=${info.fsCode}`
      );
    }
  }
  if (unrepresented.length === 0) {
    console.log("  All OCL ledgers are represented by custom rows.");
  } else {
    console.log(
      `\n  ${unrepresented.length} ledger(s) not represented. Code fix + re-sync will handle them.`
    );
  }

  // ── Compute totals before/after ────────────────────────────────────────
  console.log("\n── STEP 7: Summary ──\n");

  // Current note CY/PY totals
  let currentCyTotal = 0;
  let currentPyTotal = 0;
  for (const [k, v] of Object.entries(cyData)) {
    if (META_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) currentCyTotal += v;
  }
  for (const [k, v] of Object.entries(pyData)) {
    if (META_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) currentPyTotal += v;
  }

  // Projected totals after fix
  let newCyTotal = currentCyTotal;
  for (const u of cyUpdates) {
    newCyTotal += u.newVal - u.oldVal;
  }
  let newPyTotal = currentPyTotal;
  for (const u of pyUpdates) {
    newPyTotal += u.newVal - u.oldVal;
  }

  console.log(`Current note CY total: ${fmt(currentCyTotal)}`);
  console.log(`COA CY total:          ${fmt(coaCyTotal)}`);
  console.log(`CY drift (before):     ${fmt(Math.abs(currentCyTotal - coaCyTotal))}`);
  console.log(`CY updates to apply:   ${cyUpdates.length}`);
  console.log(`New note CY total:     ${fmt(newCyTotal)}`);
  console.log(`CY drift (after):      ${fmt(Math.abs(newCyTotal - coaCyTotal))}`);
  console.log();
  console.log(`Current note PY total: ${fmt(currentPyTotal)}`);
  console.log(`COA PY total:          ${fmt(coaPyTotal)}`);
  console.log(`PY drift (before):     ${fmt(Math.abs(currentPyTotal - coaPyTotal))}`);
  console.log(`PY updates to apply:   ${pyUpdates.length}`);
  console.log(`New note PY total:     ${fmt(newPyTotal)}`);
  console.log(`PY drift (after):      ${fmt(Math.abs(newPyTotal - coaPyTotal))}`);

  if (cyUpdates.length === 0 && pyUpdates.length === 0) {
    console.log("\nNo updates needed. Exiting.");
    return;
  }

  // ── Step 8: Build and execute SQL UPDATE ───────────────────────────────
  console.log("\n── STEP 8: Applying fixes via SQL ──\n");

  // Build JSONB merge objects for cy_data and py_data
  const cyPairs = [];
  for (const u of cyUpdates) {
    // Escape single quotes in key name for SQL safety
    const safeKey = u.rowId.replace(/'/g, "''");
    cyPairs.push(`'${safeKey}', '${u.newVal}'::jsonb`);
  }

  const pyPairs = [];
  for (const u of pyUpdates) {
    const safeKey = u.rowId.replace(/'/g, "''");
    pyPairs.push(`'${safeKey}', '${u.newVal}'::jsonb`);
  }

  let sql = `-- Fix Shree Maruti other_cl note: restore zeroed CY values + fix stale PY values\n`;
  sql += `-- Generated by fix-shree-maruti-ocl.mjs on ${new Date().toISOString()}\n`;
  sql += `-- CY updates: ${cyUpdates.length}, PY updates: ${pyUpdates.length}\n\n`;

  // Build the UPDATE statement
  const setClauses = [];

  if (cyPairs.length > 0) {
    setClauses.push(`cy_data = cy_data || jsonb_build_object(${cyPairs.join(", ")})`);
  }
  if (pyPairs.length > 0) {
    setClauses.push(`py_data = py_data || jsonb_build_object(${pyPairs.join(", ")})`);
  }
  setClauses.push(`updated_at = now()`);

  sql += `UPDATE nce_financial_notes\n`;
  sql += `SET ${setClauses.join(",\n    ")}\n`;
  sql += `WHERE id = '${noteRow.id}'\n`;
  sql += `  AND engagement_id = '${ENGAGEMENT_ID}'\n`;
  sql += `  AND note_type = '${NOTE_TYPE}';\n`;

  console.log("SQL to execute:");
  console.log("─".repeat(80));
  console.log(sql);
  console.log("─".repeat(80));

  // Execute via npx supabase db query --linked
  try {
    const result = execSync(`npx supabase db query --linked "${sql.replace(/"/g, '\\"')}"`, {
      encoding: "utf8",
      cwd: process.cwd(),
      timeout: 30000,
    });
    console.log("SQL result:", result);
  } catch (err) {
    console.error("SQL execution error:", err.message);
    if (err.stdout) console.log("stdout:", err.stdout);
    if (err.stderr) console.log("stderr:", err.stderr);

    // Fallback: write SQL to file and execute from file
    console.log("\nFallback: writing SQL to file and executing...");
    const sqlFile = "scripts/fix-shree-maruti-ocl.sql";
    const { writeFileSync } = await import("fs");
    writeFileSync(sqlFile, sql);
    console.log(`SQL written to ${sqlFile}`);

    try {
      const result2 = execSync(
        `npx supabase db query --linked --file ${sqlFile}`,
        { encoding: "utf8", cwd: process.cwd(), timeout: 30000 }
      );
      console.log("SQL result:", result2);
    } catch (err2) {
      console.error("File-based SQL execution also failed:", err2.message);
      if (err2.stdout) console.log("stdout:", err2.stdout);
      if (err2.stderr) console.log("stderr:", err2.stderr);
      return;
    }
  }

  // ── Verify: re-fetch the note and compute new totals ──────────────────
  console.log("\n── VERIFICATION ──\n");

  const { data: verifyRow, error: verifyErr } = await sb
    .from("nce_financial_notes")
    .select("cy_data, py_data")
    .eq("id", noteRow.id)
    .single();

  if (verifyErr) {
    console.error("Verification query error:", verifyErr);
    return;
  }

  const vCy = verifyRow.cy_data || {};
  const vPy = verifyRow.py_data || {};

  let verifyCyTotal = 0;
  let verifyPyTotal = 0;
  for (const [k, v] of Object.entries(vCy)) {
    if (META_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) verifyCyTotal += v;
  }
  for (const [k, v] of Object.entries(vPy)) {
    if (META_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) verifyPyTotal += v;
  }

  console.log(`Verified note CY total: ${fmt(verifyCyTotal)}`);
  console.log(`Verified note PY total: ${fmt(verifyPyTotal)}`);
  console.log(`COA CY total:           ${fmt(coaCyTotal)}`);
  console.log(`COA PY total:           ${fmt(coaPyTotal)}`);
  console.log(`CY drift (after fix):   ${fmt(Math.abs(verifyCyTotal - coaCyTotal))}`);
  console.log(`PY drift (after fix):   ${fmt(Math.abs(verifyPyTotal - coaPyTotal))}`);

  // Print individual updated rows' new values
  console.log("\nUpdated CY values:");
  for (const u of cyUpdates) {
    const actual = vCy[u.rowId];
    console.log(`  "${u.label}" (${u.rowId}): ${fmt(u.oldVal)} → ${fmt(actual)} (expected ${fmt(u.newVal)})`);
  }
  console.log("\nUpdated PY values:");
  for (const u of pyUpdates) {
    const actual = vPy[u.rowId];
    console.log(`  "${u.label}" (${u.rowId}): ${fmt(u.oldVal)} → ${fmt(actual)} (expected ${fmt(u.newVal)})`);
  }

  console.log("\n" + "=".repeat(90));
  console.log("  DONE");
  console.log("=".repeat(90));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
