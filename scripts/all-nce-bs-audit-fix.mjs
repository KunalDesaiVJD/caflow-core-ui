/**
 * ALL NCE BS Audit + Fix
 *
 * Comprehensive balance-sheet notes reconciliation for EVERY NCE engagement.
 * Finds and fixes three bug patterns:
 *   BUG 1 (Shree Maruti): Manual rows with 0 sources zeroed by double-count guard
 *   BUG 2 (Shivashray):   Static row zeroed despite having smart-matched sources
 *   BUG 3 (PY mismatch):  Note PY doesn't match COA PY
 *
 * Usage: node scripts/all-nce-bs-audit-fix.mjs
 * Uses `npx supabase db query --linked` for ALL queries (RLS bypass).
 */

import { execSync } from "child_process";

const CWD = "C:\\Users\\kvdes\\OneDrive\\Desktop\\Audit\\caflow-core-ui-main";

// ── Query helper via supabase CLI ───────────────────────────────────────────
function dbQuery(sql) {
  try {
    // Collapse newlines to spaces and escape double quotes
    const cleaned = sql.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    const escaped = cleaned.replace(/"/g, '\\"');
    const cmd = `npx supabase db query --linked "${escaped}"`;
    const result = execSync(cmd, { cwd: CWD, encoding: "utf8", timeout: 60000 });
    // Parse JSON output - find the first { and last } to handle any prefix text
    const jsonStart = result.indexOf("{");
    const jsonEnd = result.lastIndexOf("}");
    if (jsonStart === -1) return [];
    const jsonStr = result.substring(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);
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
      console.error("DB query failed:", (e.message || "").substring(0, 300));
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
    return { ok: false, error: (e.message || "").substring(0, 300) };
  }
}

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

// ── BS FS codes (excluding NCE_PPE, NCE_CAP) ────────────────────────────────
const NCE_CODE_TO_NOTE = {
  NCE_LTB:  { note: "borrowings",     col: "lt" },
  NCE_STB:  { note: "borrowings",     col: "st" },
  NCE_OLTL: { note: "other_lt_liab" },
  NCE_LTP:  { note: "provisions",     col: "lt" },
  NCE_STP:  { note: "provisions",     col: "st" },
  NCE_TP:   { note: "trade_payables" },
  NCE_OCL:  { note: "other_cl" },
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

const round2 = (n) => Math.round(n * 100) / 100;

// ── Compute note total from cy_data/py_data for a given FS code column ──────
function computeNoteTotal(noteRec, col) {
  if (!noteRec) return { cy: 0, py: 0 };
  const cyData = noteRec.cy_data || {};
  const pyData = noteRec.py_data || {};
  const numsCy = extractNumerics(cyData);
  const numsPy = extractNumerics(pyData);
  let noteCy = 0, notePy = 0;

  if (col) {
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
  } else {
    noteCy = Object.values(numsCy).reduce((s, v) => s + v, 0);
    notePy = Object.values(numsPy).reduce((s, v) => s + v, 0);
  }

  return { cy: round2(noteCy), py: round2(notePy) };
}

// ── Paginated TB loader via CLI ─────────────────────────────────────────────
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
  console.log("=".repeat(100));
  console.log("  ALL NCE BS AUDIT + FIX");
  console.log("  Started:", new Date().toISOString());
  console.log("=".repeat(100));

  // ── Step 1: Find ALL NCE engagements ────────────────────────────────────
  console.log("\n── STEP 1: Finding NCE engagements ──\n");

  // Don't fetch coa_mapping here — it's huge JSONB. Fetch per-engagement later.
  const allEng = dbQuery("SELECT e.id, e.client_id, e.financial_year, e.entity_type, e.is_py_shell, c.name as client_name FROM audit_engagements e JOIN clients c ON c.id = e.client_id WHERE e.entity_type IN ('Partnership','Individual','Trust','firm','HUF','AOP','BOI') AND (e.is_py_shell IS NULL OR e.is_py_shell = false) ORDER BY c.name");

  if (!allEng) { console.error("Failed to query engagements"); return; }
  console.log(`Found ${allEng.length} NCE CY engagements`);

  if (!allEng.length) {
    console.log("No engagements to audit.");
    return;
  }

  // List all
  for (const e of allEng) {
    console.log(`  ${(e.client_name || "?").padEnd(40)} FY=${e.financial_year}  type=${e.entity_type}`);
  }

  // ── Prioritize: Shree Hari Infra first ──────────────────────────────────
  const shreeHariIdx = allEng.findIndex(e =>
    (e.client_name || "").toLowerCase().includes("shree hari") ||
    (e.client_name || "").toLowerCase().includes("hari infra")
  );
  if (shreeHariIdx > 0) {
    const [shreeHari] = allEng.splice(shreeHariIdx, 1);
    allEng.unshift(shreeHari);
    console.log(`\nPrioritized: "${shreeHari.client_name}" moved to first position`);
  } else if (shreeHariIdx === 0) {
    console.log(`\n"${allEng[0].client_name}" is already first`);
  } else {
    console.log(`\nNote: No "Shree Hari Infra" found among NCE engagements`);
  }

  // ── Step 2: Audit + Fix each engagement ─────────────────────────────────
  const globalReport = [];

  for (const eng of allEng) {
    const clientName = eng.client_name || "Unknown";
    console.log("\n" + "=".repeat(100));
    console.log(`  AUDITING: ${clientName} (FY ${eng.financial_year})`);
    console.log(`  Engagement ID: ${eng.id}`);
    console.log("=".repeat(100));

    // Fetch COA mapping for this engagement
    const coaRows = dbQuery(`SELECT coa_mapping FROM audit_engagements WHERE id = '${eng.id}'`);
    const coaMapping = coaRows?.[0]?.coa_mapping || {};
    if (Object.keys(coaMapping).length === 0) {
      console.log("  SKIP: No COA mapping");
      globalReport.push({ client: clientName, fy: eng.financial_year, skipped: "No COA mapping", fixes: [] });
      continue;
    }
    console.log(`  COA mapping: ${Object.keys(coaMapping).length} entries`);

    // Load TB
    const allTb = loadTB(eng.id);
    if (!allTb) {
      console.log("  SKIP: TB load failed");
      globalReport.push({ client: clientName, fy: eng.financial_year, skipped: "TB load failed", fixes: [] });
      continue;
    }
    if (allTb.length === 0) {
      console.log("  SKIP: Empty TB");
      globalReport.push({ client: clientName, fy: eng.financial_year, skipped: "Empty TB", fixes: [] });
      continue;
    }
    console.log(`  TB: ${allTb.length} rows`);

    const tbByName = {};
    for (const row of allTb) tbByName[row.ledger_name] = row;

    // Load NCE financial notes
    const noteRows = dbQuery(`SELECT id, engagement_id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${eng.id}'`);
    if (!noteRows) {
      console.log("  SKIP: Notes load failed");
      globalReport.push({ client: clientName, fy: eng.financial_year, skipped: "Notes load failed", fixes: [] });
      continue;
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

    // ── Audit each BS code ───────────────────────────────────────────────
    const fixes = []; // { noteType, noteId, field, key, oldVal, newVal, reason }
    const codeResults = [];

    for (const [fsCode, codeInfo] of Object.entries(NCE_CODE_TO_NOTE)) {
      const noteType = codeInfo.note;
      const col = codeInfo.col;
      const nature = NOTE_NATURE[noteType] || "CR";
      const ledgers = codeLedgers[fsCode] || [];

      // COA totals
      let coaCy = 0, coaPy = 0;
      for (const { tb } of ledgers) {
        if (!tb) continue;
        coaCy += signedClosing(tb.closing_balance, tb.balance_type, nature);
        coaPy += signedOpening(tb.opening_balance, tb.opening_type, nature);
      }
      coaCy = round2(coaCy);
      coaPy = round2(coaPy);

      // Note totals
      const noteRec = noteByType[noteType];
      const noteTotal = computeNoteTotal(noteRec, col);

      const driftCy = round2(Math.abs(coaCy - noteTotal.cy));
      const driftPy = round2(Math.abs(coaPy - noteTotal.py));

      codeResults.push({
        fsCode, noteType, col, nature,
        ledgerCount: ledgers.length,
        coaCy, coaPy,
        noteCy: noteTotal.cy, notePy: noteTotal.py,
        driftCy, driftPy,
      });

      if (!noteRec) continue;

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
        const expectedPy = signedOpening(tbRow.opening_balance, tbRow.opening_type, nature);

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
        if (Math.abs(pyVal) < 0.01 && Math.abs(expectedPy) > 0.01) {
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

      // ── BUG 3: PY mismatch ────────────────────────────────────────────
      if (Math.abs(driftPy) > 1) {
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
    }

    // ── Print code results ────────────────────────────────────────────────
    const drifted = codeResults.filter(r => r.driftCy > 1 || r.driftPy > 1);
    if (drifted.length) {
      console.log("\n  Codes with drift > Rs.1:");
      for (const r of drifted) {
        console.log(`    ${r.fsCode.padEnd(12)} ${r.noteType.padEnd(20)} COA CY=${fmt(r.coaCy).padStart(14)} Note CY=${fmt(r.noteCy).padStart(14)} drift=${fmt(r.driftCy).padStart(12)} | COA PY=${fmt(r.coaPy).padStart(14)} Note PY=${fmt(r.notePy).padStart(14)} drift=${fmt(r.driftPy).padStart(12)}`);
      }
    } else {
      console.log("\n  All BS codes reconcile within Rs.1 - no drift detected.");
    }

    // ── Deduplicate fixes ─────────────────────────────────────────────────
    const fixMap = new Map();
    for (const f of fixes) {
      const fKey = `${f.noteId}|${f.field}|${f.key}`;
      fixMap.set(fKey, f);
    }
    const dedupedFixes = [...fixMap.values()];

    // ── Apply fixes ───────────────────────────────────────────────────────
    if (dedupedFixes.length > 0) {
      console.log(`\n  Fixes to apply: ${dedupedFixes.length}`);
      for (const f of dedupedFixes) {
        console.log(`    ${f.noteType}.${f.field}.${f.key}: ${fmt(f.oldVal)} -> ${fmt(f.newVal)} (${f.reason})`);
      }

      // Group fixes by noteId + field
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
        console.log(`\n  Executing: ${sql.substring(0, 200)}${sql.length > 200 ? "..." : ""}`);

        const res = dbExec(sql);
        if (res.ok) {
          console.log(`    OK`);
        } else {
          console.log(`    FAILED: ${(res.error || "").substring(0, 200)}`);
        }
      }

      // ── Verify after fix ──────────────────────────────────────────────
      console.log("\n  Verifying after fix...");
      const newNotes = dbQuery(`SELECT id, note_type, cy_data, py_data FROM nce_financial_notes WHERE engagement_id = '${eng.id}'`);

      const newNoteByType = {};
      for (const n of (newNotes || [])) newNoteByType[n.note_type] = n;

      let afterDriftCy = 0, afterDriftPy = 0;
      for (const [fsCode, codeInfo] of Object.entries(NCE_CODE_TO_NOTE)) {
        const noteType = codeInfo.note;
        const col = codeInfo.col;
        const nature = NOTE_NATURE[noteType] || "CR";
        const lgrs = codeLedgers[fsCode] || [];

        let coaCy = 0, coaPy = 0;
        for (const { tb } of lgrs) {
          if (!tb) continue;
          coaCy += signedClosing(tb.closing_balance, tb.balance_type, nature);
          coaPy += signedOpening(tb.opening_balance, tb.opening_type, nature);
        }

        const noteTotal = computeNoteTotal(newNoteByType[noteType], col);
        afterDriftCy += Math.abs(round2(coaCy) - noteTotal.cy);
        afterDriftPy += Math.abs(round2(coaPy) - noteTotal.py);
      }

      const beforeDriftCy = round2(codeResults.reduce((s, r) => s + r.driftCy, 0));
      const beforeDriftPy = round2(codeResults.reduce((s, r) => s + r.driftPy, 0));
      afterDriftCy = round2(afterDriftCy);
      afterDriftPy = round2(afterDriftPy);

      console.log(`  BEFORE: Total CY drift=${fmt(beforeDriftCy)}, PY drift=${fmt(beforeDriftPy)}`);
      console.log(`  AFTER:  Total CY drift=${fmt(afterDriftCy)}, PY drift=${fmt(afterDriftPy)}`);

      globalReport.push({
        client: clientName, fy: eng.financial_year,
        fixCount: dedupedFixes.length,
        fixes: dedupedFixes.map(f => f.reason),
        beforeCy: beforeDriftCy, beforePy: beforeDriftPy,
        afterCy: afterDriftCy, afterPy: afterDriftPy,
      });
    } else {
      const totalDriftCy = round2(codeResults.reduce((s, r) => s + r.driftCy, 0));
      const totalDriftPy = round2(codeResults.reduce((s, r) => s + r.driftPy, 0));

      console.log("\n  No fixes needed for this engagement.");
      globalReport.push({
        client: clientName, fy: eng.financial_year,
        fixCount: 0, fixes: [],
        beforeCy: totalDriftCy, beforePy: totalDriftPy,
        afterCy: totalDriftCy, afterPy: totalDriftPy,
      });
    }
  }

  // ── Step 3: Global Report ───────────────────────────────────────────────
  console.log("\n" + "=".repeat(100));
  console.log("  GLOBAL REPORT");
  console.log("=".repeat(100));

  console.log("\n" + "-".repeat(140));
  console.log(
    "Client".padEnd(40) +
    "FY".padEnd(12) +
    "#Fixes".padStart(8) +
    "Before CY".padStart(14) +
    "After CY".padStart(14) +
    "Before PY".padStart(14) +
    "After PY".padStart(14) +
    " Status"
  );
  console.log("-".repeat(140));

  for (const r of globalReport) {
    if (r.skipped) {
      console.log(`${r.client.padEnd(40)}${(r.fy || "-").padEnd(12)}${"SKIP".padStart(8)}  ${r.skipped}`);
      continue;
    }
    const status = (r.afterCy <= 1 && r.afterPy <= 1) ? " OK" :
                   (r.fixCount > 0 ? " IMPROVED" : " DRIFT");
    console.log(
      r.client.substring(0, 39).padEnd(40) +
      (r.fy || "-").padEnd(12) +
      String(r.fixCount).padStart(8) +
      fmt(r.beforeCy).padStart(14) +
      fmt(r.afterCy).padStart(14) +
      fmt(r.beforePy).padStart(14) +
      fmt(r.afterPy).padStart(14) +
      status
    );

    if (r.fixes.length > 0 && r.fixes.length <= 10) {
      for (const desc of r.fixes) {
        console.log(`    -> ${desc}`);
      }
    } else if (r.fixes.length > 10) {
      for (const desc of r.fixes.slice(0, 5)) {
        console.log(`    -> ${desc}`);
      }
      console.log(`    ... and ${r.fixes.length - 5} more fixes`);
    }
  }
  console.log("-".repeat(140));

  const totalFixes = globalReport.reduce((s, r) => s + (r.fixCount || 0), 0);
  const okCount = globalReport.filter(r => !r.skipped && r.afterCy <= 1 && r.afterPy <= 1).length;
  const driftCount = globalReport.filter(r => !r.skipped && (r.afterCy > 1 || r.afterPy > 1)).length;
  const skipCount = globalReport.filter(r => r.skipped).length;

  console.log(`\n  Total engagements: ${globalReport.length}`);
  console.log(`  OK (drift <= Rs.1): ${okCount}`);
  console.log(`  Remaining drift: ${driftCount}`);
  console.log(`  Skipped: ${skipCount}`);
  console.log(`  Total fixes applied: ${totalFixes}`);

  console.log("\n" + "=".repeat(100));
  console.log("  AUDIT + FIX COMPLETE");
  console.log("  Finished:", new Date().toISOString());
  console.log("=".repeat(100));
}

main();
