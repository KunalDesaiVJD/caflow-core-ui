/**
 * BS Notes Audit — Shree Maruti Infra
 *
 * Comprehensive balance-sheet notes reconciliation:
 *   COA (TB signed) vs nce_financial_notes for every BS code.
 *
 * Data model:
 *   - coa_mapping is a JSONB column on audit_engagements: { ledgerName: { code, ... }, ... }
 *   - TB lives in tally_trial_balance
 *   - Notes live in nce_financial_notes
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://hubyywmodekfdzhwiumb.supabase.co";

// Read service key the same way other scripts in this repo do (coa-notes-drift.mjs)
let SUPABASE_KEY;
try {
  const envContent = readFileSync("tally-xml-service/.env", "utf8");
  SUPABASE_KEY = envContent.split("\n").find(l => l.startsWith("SUPABASE_SERVICE_KEY="))?.split("=").slice(1).join("=").trim();
} catch {
  SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
}
if (!SUPABASE_KEY) {
  console.error("Cannot find service key. Set SUPABASE_SERVICE_ROLE_KEY env var or ensure tally-xml-service/.env exists.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Sign convention (from fsSignConvention.ts) ───────────────────────────────
const NOTE_NATURE = {
  borrowings: "CR", other_lt_liab: "CR", provisions: "CR",
  trade_payables: "CR", other_cl: "CR",
  cwip: "DR", investments: "DR", loans_advances: "DR",
  other_nc_assets: "DR", inventories: "DR", trade_receivables: "DR",
  cash_bank: "DR", other_ca: "DR",
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

// ── BS FS codes to audit (excluding NCE_PPE, NCE_CAP) ───────────────────────
const NCE_CODE_TO_NOTE = {
  // Liabilities
  NCE_LTB:  { note: "borrowings",     col: "lt" },
  NCE_STB:  { note: "borrowings",     col: "st" },
  NCE_OLTL: { note: "other_lt_liab" },
  NCE_LTP:  { note: "provisions",     col: "lt" },
  NCE_STP:  { note: "provisions",     col: "st" },
  NCE_TP:   { note: "trade_payables" },
  NCE_OCL:  { note: "other_cl" },
  // Assets
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

const fmt = (n) => {
  if (n == null) return "-";
  if (n === 0) return "0.00";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const parts = abs.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{2})+(\d)(?!\d))/g, ",");
  return sign + parts.join(".");
};

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(90));
  console.log("  BS NOTES AUDIT — SHREE MARUTI INFRA");
  console.log("=".repeat(90));

  // ── Step 1: Find engagement ──────────────────────────────────────────────
  console.log("\n── STEP 1: Finding engagement ──\n");

  // Find client
  const { data: clients, error: clErr } = await sb
    .from("clients")
    .select("id, name")
    .ilike("name", "%maruti%");
  if (clErr) { console.error("Client query error:", clErr); return; }
  if (!clients?.length) { console.error("No client matching 'maruti'"); return; }
  console.log("Matching clients:");
  for (const c of clients) console.log(`  id=${c.id}  name="${c.name}"`);

  // Find engagements for "SHREE MARUTI INFRA"
  const smClient = clients.find(c => c.name.toLowerCase().includes("shree maruti"));
  if (!smClient) { console.error("No 'Shree Maruti' client found"); return; }

  const { data: engRows, error: engErr } = await sb
    .from("audit_engagements")
    .select("id, client_id, financial_year, entity_type, is_py_shell, coa_mapping")
    .eq("client_id", smClient.id);
  if (engErr) { console.error("Engagement query error:", engErr); return; }
  if (!engRows?.length) { console.error("No engagements for client"); return; }

  console.log("\nEngagements:");
  for (const e of engRows) {
    console.log(`  id=${e.id}  FY=${e.financial_year}  type=${e.entity_type}  py_shell=${e.is_py_shell}  coa_entries=${Object.keys(e.coa_mapping || {}).length}`);
  }

  // Pick CY engagement
  const eng = engRows.find(e => !e.is_py_shell) ?? engRows[0];
  const engId = eng.id;
  const coaMapping = eng.coa_mapping || {};
  console.log(`\nUsing engagement: ${engId} (FY ${eng.financial_year})`);
  console.log(`COA mapping entries: ${Object.keys(coaMapping).length}`);

  // ── Step 2: Load TB and Notes ────────────────────────────────────────────
  console.log("\n── STEP 2: Loading TB + Notes ──\n");

  // TB (paginated at 1000)
  let allTb = [];
  let page = 0;
  while (true) {
    const from = page * 1000;
    const to = from + 999;
    const { data: batch, error: tbErr } = await sb
      .from("tally_trial_balance")
      .select("id, ledger_name, closing_balance, balance_type, opening_balance, opening_type, parent_group")
      .eq("engagement_id", engId)
      .range(from, to);
    if (tbErr) { console.error("TB error:", tbErr); return; }
    if (!batch?.length) break;
    allTb = allTb.concat(batch);
    if (batch.length < 1000) break;
    page++;
  }
  console.log(`Trial balance: ${allTb.length} rows (${page + 1} page(s))`);

  // Build TB lookup by ledger_name
  const tbByName = {};
  for (const row of allTb) {
    tbByName[row.ledger_name] = row;
  }

  // NCE financial notes
  const { data: noteRows, error: noteErr } = await sb
    .from("nce_financial_notes")
    .select("id, engagement_id, note_type, cy_data, py_data")
    .eq("engagement_id", engId);
  if (noteErr) { console.error("Notes error:", noteErr); return; }
  console.log(`NCE financial notes: ${noteRows.length} rows`);

  const noteByType = {};
  for (const n of noteRows) {
    noteByType[n.note_type] = n;
  }

  // ── Build FS code → TB ledgers mapping from COA ──────────────────────────
  const codeLedgers = {}; // fsCode → [{ ledgerName, tbRow }]
  for (const [ledgerName, mapping] of Object.entries(coaMapping)) {
    if (!mapping || !mapping.code) continue;
    const code = mapping.code;
    if (!codeLedgers[code]) codeLedgers[code] = [];
    const tb = tbByName[ledgerName];
    codeLedgers[code].push({ ledgerName, mapping, tb });
  }

  // ── Step 3: Audit each BS code ───────────────────────────────────────────
  console.log("\n── STEP 3: BS Notes Audit ──\n");

  const results = [];

  for (const [fsCode, codeInfo] of Object.entries(NCE_CODE_TO_NOTE)) {
    const noteType = codeInfo.note;
    const col = codeInfo.col;
    const nature = NOTE_NATURE[noteType] || "CR";

    // (a) COA CY total: sum signed closing_balance
    const ledgers = codeLedgers[fsCode] || [];
    let coaCy = 0, coaPy = 0;
    for (const { tb } of ledgers) {
      if (!tb) continue;
      coaCy += signedClosing(tb.closing_balance, tb.balance_type, nature);
      coaPy += signedOpening(tb.opening_balance, tb.opening_type, nature);
    }

    // (b) Note totals
    const noteRec = noteByType[noteType];
    let noteCy = 0, notePy = 0;
    let noteDetail = {};
    let customRows = [];

    if (noteRec) {
      const cyData = noteRec.cy_data || {};
      const pyData = noteRec.py_data || {};
      customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];
      const numsCy = extractNumerics(cyData);
      const numsPy = extractNumerics(pyData);

      if (col) {
        // Pattern A: sum _lt or _st suffixed keys
        const suffix = `_${col}`;
        const seenBases = new Set();
        for (const [k, v] of Object.entries(numsCy)) {
          if (k.endsWith("_lt")) { seenBases.add(k.slice(0, -3)); if (col === "lt") { noteCy += v; noteDetail[k] = v; } }
          else if (k.endsWith("_st")) { seenBases.add(k.slice(0, -3)); if (col === "st") { noteCy += v; noteDetail[k] = v; } }
        }
        // Bare keys with no _lt/_st siblings → only count for "lt"
        for (const [k, v] of Object.entries(numsCy)) {
          if (!k.endsWith("_lt") && !k.endsWith("_st") && !seenBases.has(k)) {
            if (col === "lt") { noteCy += v; noteDetail[k] = v; }
          }
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
      } else {
        // Pattern B: sum all numeric leaf keys
        noteCy = Object.values(numsCy).reduce((s, v) => s + v, 0);
        notePy = Object.values(numsPy).reduce((s, v) => s + v, 0);
        noteDetail = { ...numsCy };
      }
    }

    const driftCy = Math.abs(coaCy - noteCy);
    const driftPy = Math.abs(coaPy - notePy);

    results.push({
      fsCode, noteType, col, nature,
      ledgerCount: ledgers.length,
      tbMatchCount: ledgers.filter(l => l.tb).length,
      coaCy, coaPy, noteCy, notePy, driftCy, driftPy,
      customRows, noteDetail, noteRec, ledgers,
    });
  }

  // ── Print summary table ──────────────────────────────────────────────────
  console.log("─".repeat(140));
  console.log(
    "FS Code".padEnd(12) +
    "Note Type".padEnd(20) +
    "Col".padEnd(5) +
    "Nat".padEnd(5) +
    "#COA".padEnd(6) +
    "#TB".padEnd(5) +
    "COA CY".padStart(16) +
    "Note CY".padStart(16) +
    "Drift CY".padStart(14) +
    "COA PY".padStart(16) +
    "Note PY".padStart(16) +
    "Drift PY".padStart(14) +
    " Flag"
  );
  console.log("─".repeat(140));

  for (const r of results) {
    const flag = (r.driftCy > 1 || r.driftPy > 1) ? " <<<" : "";
    console.log(
      r.fsCode.padEnd(12) +
      r.noteType.padEnd(20) +
      (r.col ?? "-").padEnd(5) +
      r.nature.padEnd(5) +
      String(r.ledgerCount).padEnd(6) +
      String(r.tbMatchCount).padEnd(5) +
      fmt(r.coaCy).padStart(16) +
      fmt(r.noteCy).padStart(16) +
      fmt(r.driftCy).padStart(14) +
      fmt(r.coaPy).padStart(16) +
      fmt(r.notePy).padStart(16) +
      fmt(r.driftPy).padStart(14) +
      flag
    );
  }
  console.log("─".repeat(140));

  // ── Drift summary ────────────────────────────────────────────────────────
  console.log("\n── CODES WITH DRIFT > Rs.1 ──\n");
  const drifted = results.filter(r => r.driftCy > 1 || r.driftPy > 1);
  if (!drifted.length) {
    console.log("  None! All BS codes reconcile within Rs.1.");
  } else {
    for (const r of drifted) {
      console.log(`  ${r.fsCode} (${r.noteType}${r.col ? "/" + r.col : ""}): CY drift=${fmt(r.driftCy)}, PY drift=${fmt(r.driftPy)}`);
    }
  }

  // ── Step 4: Detailed OTHER_CL breakdown ──────────────────────────────────
  console.log("\n" + "=".repeat(90));
  console.log("  DETAILED OTHER_CL (NCE_OCL) BREAKDOWN");
  console.log("=".repeat(90));

  const oclResult = results.find(r => r.fsCode === "NCE_OCL");
  if (!oclResult) {
    console.log("NCE_OCL not found in results!");
    return;
  }

  // Also check BS_CL_OCL
  const bsClOclLedgers = codeLedgers["BS_CL_OCL"] ?? [];
  if (bsClOclLedgers.length) {
    console.log(`\nNote: ${bsClOclLedgers.length} ledger(s) also mapped to BS_CL_OCL`);
  }

  // List every TB ledger mapped to NCE_OCL
  console.log("\n── TB Ledgers mapped to NCE_OCL ──\n");
  console.log(
    "Ledger Name".padEnd(50) +
    "Closing".padStart(16) +
    " Type".padStart(6) +
    "Opening".padStart(16) +
    " OType".padStart(6) +
    "Signed CY".padStart(16) +
    "Signed PY".padStart(16)
  );
  console.log("-".repeat(126));

  const oclLedgers = oclResult.ledgers;
  let oclCySumCheck = 0, oclPySumCheck = 0;
  for (const { ledgerName, tb } of oclLedgers) {
    if (!tb) {
      console.log(`${ledgerName.substring(0, 49).padEnd(50)}  ** NO TB MATCH **`);
      continue;
    }
    const sCy = signedClosing(tb.closing_balance, tb.balance_type, "CR");
    const sPy = signedOpening(tb.opening_balance, tb.opening_type, "CR");
    oclCySumCheck += sCy;
    oclPySumCheck += sPy;
    console.log(
      ledgerName.substring(0, 49).padEnd(50) +
      fmt(Number(tb.closing_balance ?? 0)).padStart(16) +
      (" " + (tb.balance_type ?? "-")).padStart(6) +
      fmt(Number(tb.opening_balance ?? 0)).padStart(16) +
      (" " + (tb.opening_type ?? "-")).padStart(6) +
      fmt(sCy).padStart(16) +
      fmt(sPy).padStart(16)
    );
  }
  console.log("-".repeat(126));
  console.log(`COA CY Total: ${fmt(oclResult.coaCy)}  |  COA PY Total: ${fmt(oclResult.coaPy)}`);

  // ── Note cy_data breakdown ─────────────────────────────────────────────
  const oclNote = oclResult.noteRec;
  if (oclNote) {
    console.log("\n── Note CY data (all keys) ──\n");
    const cyData = oclNote.cy_data ?? {};
    const pyData = oclNote.py_data ?? {};
    const numsCy = extractNumerics(cyData);

    for (const [k, v] of Object.entries(numsCy).sort((a, b) => a[0].localeCompare(b[0]))) {
      const pyVal = pyData[k] ?? 0;
      console.log(`  ${k.padEnd(40)} CY=${fmt(Number(v)).padStart(14)}  PY=${fmt(Number(pyVal)).padStart(14)}`);
    }
    console.log(`  ${"(Sum of all numeric keys)".padEnd(40)} CY=${fmt(oclResult.noteCy).padStart(14)}  PY=${fmt(oclResult.notePy).padStart(14)}`);

    // Non-numeric meta data
    for (const [k, v] of Object.entries(cyData)) {
      if (META_KEYS.has(k) && k !== "_custom_rows") {
        console.log(`  [meta] ${k}: ${JSON.stringify(v)}`);
      }
    }

    // Custom rows detail
    const customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];
    console.log(`\n── Custom Rows (${customRows.length}) ──\n`);
    for (const cr of customRows) {
      const srcCount = cr.sources?.length ?? 0;
      const srcCyTotal = (cr.sources ?? []).reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
      const srcPyTotal = (cr.sources ?? []).reduce((s, x) => s + (Number(x?.amountPy) || 0), 0);
      const cyVal = cyData[cr.id] ?? 0;
      const pyVal = pyData[cr.id] ?? 0;
      console.log(`  id: ${cr.id}`);
      console.log(`    label:       ${cr.label ?? "(no label)"}`);
      console.log(`    attachedTo:  ${cr.attachedTo ?? "(none)"}`);
      console.log(`    section:     ${cr.section ?? "(none)"}`);
      console.log(`    source:      ${cr.source ?? "(none)"}`);
      console.log(`    cy_data[id]: ${fmt(Number(cyVal))}  |  py_data[id]: ${fmt(Number(pyVal))}`);
      console.log(`    sources:     ${srcCount} entries, sum CY=${fmt(srcCyTotal)}, sum PY=${fmt(srcPyTotal)}`);

      // Check labour-style bug: has sources with nonzero sum but cy_data = 0
      if (srcCount > 0 && Number(cyVal) === 0 && Math.abs(srcCyTotal) > 0.01) {
        console.log(`    >>> BUG: sources sum CY=${fmt(srcCyTotal)} but cy_data[id]=0 (labour-style bug)`);
      }

      // Check for attachedStaticIds
      if (cr.attachedStaticIds?.length) {
        console.log(`    attachedStaticIds: ${JSON.stringify(cr.attachedStaticIds)}`);
      }

      // List individual sources
      if (srcCount > 0 && srcCount <= 20) {
        for (const src of cr.sources) {
          console.log(`      - ledger: "${src.ledger ?? ""}", CY=${fmt(Number(src.amountCy ?? 0))}, PY=${fmt(Number(src.amountPy ?? 0))}`);
        }
      } else if (srcCount > 20) {
        console.log(`      (${srcCount} sources - showing first 10)`);
        for (const src of cr.sources.slice(0, 10)) {
          console.log(`      - ledger: "${src.ledger ?? ""}", CY=${fmt(Number(src.amountCy ?? 0))}, PY=${fmt(Number(src.amountPy ?? 0))}`);
        }
      }
      console.log();
    }

    // ── Cross-check: which TB ledgers appear in custom rows? ───────────
    console.log("── TB <-> Custom Rows Cross-Check ──\n");

    const crLabels = new Set(customRows.map(cr => (cr.label ?? "").trim().toLowerCase()));
    const crSourceLedgers = new Set();
    for (const cr of customRows) {
      for (const src of cr.sources ?? []) {
        if (src.ledger) crSourceLedgers.add(src.ledger.trim().toLowerCase());
      }
    }

    let missingCount = 0;
    for (const { ledgerName, tb } of oclLedgers) {
      const nameLC = ledgerName.trim().toLowerCase();
      const inLabel = crLabels.has(nameLC);
      const inSource = crSourceLedgers.has(nameLC);

      if (!inLabel && !inSource) {
        const sCy = tb ? signedClosing(tb.closing_balance, tb.balance_type, "CR") : 0;
        console.log(`  MISSING from note: "${ledgerName}" (signed CY=${fmt(sCy)})`);
        missingCount++;
      }
    }
    if (missingCount === 0) {
      console.log("  All TB ledgers appear in custom rows (by label or source match).");
    } else {
      console.log(`\n  ${missingCount} TB ledger(s) not found in note custom rows.`);
    }

    // ── Zero-value custom rows with sources (labour-style bug) ──
    console.log("\n── Zero-Value Custom Rows with Sources (labour-style bug check) ──\n");
    let bugCount = 0;
    for (const cr of customRows) {
      const srcCount = cr.sources?.length ?? 0;
      const srcCyTotal = (cr.sources ?? []).reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
      const cyVal = Number(cyData[cr.id] ?? 0);
      if (srcCount > 0 && cyVal === 0 && Math.abs(srcCyTotal) > 0.01) {
        console.log(`  BUG: "${cr.label ?? cr.id}" - sources CY=${fmt(srcCyTotal)} but cy_data=0`);
        bugCount++;
      }
    }
    if (bugCount === 0) {
      console.log("  No labour-style bugs detected.");
    }

    // ── Smart-match zeroing check ──
    console.log("\n── Smart-Match Zeroing Check ──\n");
    let zeroedCount = 0;
    for (const cr of customRows) {
      if (cr.attachedStaticIds?.length) {
        for (const sid of cr.attachedStaticIds) {
          const staticVal = Number(cyData[sid] ?? 0);
          console.log(`  Custom "${cr.label ?? cr.id}" attached to static "${sid}" (cy_data[${sid}]=${fmt(staticVal)})`);
          zeroedCount++;
        }
      }
    }
    if (zeroedCount === 0) {
      console.log("  No attachedStaticIds found in custom rows.");
    }
  } else {
    console.log("\n  No nce_financial_notes record for note_type='other_cl'");
  }

  // ── Step 5: Detailed breakdown for ALL drifted codes ─────────────────────
  console.log("\n" + "=".repeat(90));
  console.log("  DRIFT DETAIL FOR ALL CODES WITH DRIFT > Rs.1");
  console.log("=".repeat(90));

  for (const r of drifted) {
    if (r.fsCode === "NCE_OCL") continue; // already detailed above
    console.log(`\n--- ${r.fsCode} (${r.noteType}${r.col ? "/" + r.col : ""}) ---`);
    console.log(`  COA: CY=${fmt(r.coaCy)} PY=${fmt(r.coaPy)}  |  Note: CY=${fmt(r.noteCy)} PY=${fmt(r.notePy)}`);
    console.log(`  Drift: CY=${fmt(r.driftCy)} PY=${fmt(r.driftPy)}`);
    console.log(`  COA ledgers: ${r.ledgerCount}, TB matches: ${r.tbMatchCount}`);

    // Show ledgers
    if (r.ledgerCount > 0 && r.ledgerCount <= 30) {
      for (const { ledgerName, tb } of r.ledgers) {
        if (!tb) {
          console.log(`    "${ledgerName}" - NO TB MATCH`);
          continue;
        }
        const sCy = signedClosing(tb.closing_balance, tb.balance_type, r.nature);
        const sPy = signedOpening(tb.opening_balance, tb.opening_type, r.nature);
        console.log(`    "${ledgerName}" CB=${fmt(Number(tb.closing_balance??0))} ${tb.balance_type??"-"} -> ${fmt(sCy)} | OB=${fmt(Number(tb.opening_balance??0))} ${tb.opening_type??"-"} -> ${fmt(sPy)}`);
      }
    }

    // Show note detail
    if (Object.keys(r.noteDetail).length > 0 && Object.keys(r.noteDetail).length <= 30) {
      console.log(`  Note CY keys:`);
      for (const [k, v] of Object.entries(r.noteDetail)) {
        console.log(`    ${k}: ${fmt(v)}`);
      }
    }

    if (r.customRows.length) {
      console.log(`  Custom rows (${r.customRows.length}):`);
      for (const cr of r.customRows) {
        const srcSum = (cr.sources ?? []).reduce((s, x) => s + (Number(x?.amountCy) || 0), 0);
        const cyVal = r.noteRec?.cy_data?.[cr.id] ?? 0;
        console.log(`    - "${cr.label ?? cr.id}" att=${cr.attachedTo ?? "none"} src=${cr.sources?.length ?? 0} srcSum=${fmt(srcSum)} cy_data=${fmt(Number(cyVal))}`);
        if (cr.sources?.length > 0 && Number(cyVal) === 0 && Math.abs(srcSum) > 0.01) {
          console.log(`      >>> LABOUR-STYLE BUG: srcSum=${fmt(srcSum)} but cy_data=0`);
        }
      }
    }
  }

  // ── Final summary ────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(90));
  console.log("  FINAL SUMMARY");
  console.log("=".repeat(90));

  const totalDriftCy = results.reduce((s, r) => s + r.driftCy, 0);
  const totalDriftPy = results.reduce((s, r) => s + r.driftPy, 0);
  console.log(`\n  Total BS codes audited: ${results.length}`);
  console.log(`  Codes with CY drift > Rs.1: ${results.filter(r => r.driftCy > 1).length}`);
  console.log(`  Codes with PY drift > Rs.1: ${results.filter(r => r.driftPy > 1).length}`);
  console.log(`  Aggregate CY drift: Rs.${fmt(totalDriftCy)}`);
  console.log(`  Aggregate PY drift: Rs.${fmt(totalDriftPy)}`);

  console.log("\n" + "=".repeat(90));
  console.log("  AUDIT COMPLETE");
  console.log("=".repeat(90));
}

main().catch(console.error);
