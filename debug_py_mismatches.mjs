/**
 * DEEP PY BS NOTE MISMATCH INVESTIGATION — SHRI RAM PRODUCTS
 * ============================================================
 * For each of the 5 mismatched notes, traces the exact discrepancy between:
 *   (A) COA PY — sum of signed opening_balance from CY TB ledgers mapped to the FS code
 *   (B) PY Shell — sum of signed closing_balance from PY shell TB
 *   (C) Note PY — py_data stored in nce_financial_notes
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://hubyywmodekfdzhwiumb.supabase.co";

// Resolve Supabase key: CLI arg > env var > tally-xml-service/.env > anon key
let SUPABASE_KEY = process.argv[2] || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) {
  try {
    const envContent = readFileSync("tally-xml-service/.env", "utf8");
    SUPABASE_KEY = envContent.split("\n").find(l => l.startsWith("SUPABASE_SERVICE_KEY="))?.split("=").slice(1).join("=").trim();
  } catch { /* ignore */ }
}
if (!SUPABASE_KEY) {
  // Fallback to anon key (will only work if RLS allows)
  SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODkyNzgsImV4cCI6MjA4ODM2NTI3OH0.M6UQcpMLCCFja9TdeJpxawUvKhso38BmMGFJi6lLbrc";
  console.log("WARNING: Using anon key. If RLS blocks queries, pass service role key as first CLI argument.");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ENGAGEMENT_ID = "6074f0fb-679a-4b88-98a6-c421cfcf8e0a";

// ── The 5 mismatched notes ──────────────────────────────────────────────────
const MISMATCHES = [
  {
    label: "Long-term borrowings",
    fsCode: "NCE_LTB",
    noteType: "borrowings",
    splitSide: "lt",
    nature: "CR",
    expectedCoaPy: 3259867,
    expectedNotePy: 3917324,
  },
  {
    label: "Other current liabilities",
    fsCode: "NCE_OCL",
    noteType: "other_cl",
    splitSide: null,
    nature: "CR",
    expectedCoaPy: 61982,
    expectedNotePy: 11443,
  },
  {
    label: "Trade receivables",
    fsCode: "NCE_TR",
    noteType: "trade_receivables",
    splitSide: null,
    nature: "DR",
    expectedCoaPy: 14041722,
    expectedNotePy: 15897230,
  },
  {
    label: "Short-term loans & advances",
    fsCode: "NCE_STLA",
    noteType: "loans_advances",
    splitSide: "st",
    nature: "DR",
    expectedCoaPy: 2350770,
    expectedNotePy: 2440770,
  },
  {
    label: "Other current assets",
    fsCode: "NCE_OCA",
    noteType: "other_ca",
    splitSide: null,
    nature: "DR",
    expectedCoaPy: 199317,
    expectedNotePy: 513269,
  },
];

// ── FS code to note mapping ─────────────────────────────────────────────────
const NCE_NOTE_FS_MAP = {
  borrowings:        { lt: ["NCE_LTB", "BS_NCL_LTB"], st: ["NCE_STB", "BS_CL_STB"] },
  other_cl:          { all: ["NCE_OCL", "BS_CL_OCL"] },
  trade_receivables: { all: ["NCE_TR", "BS_CA_TR"] },
  loans_advances:    { lt: ["NCE_LTLA", "BS_NCA_LLA"], st: ["NCE_STLA", "BS_CA_SLA"] },
  other_ca:          { all: ["NCE_OCA", "BS_CA_OCA"] },
};

// ── Helper: paginated fetch ─────────────────────────────────────────────────
async function fetchAllTb(engagementId) {
  const PAGE = 1000;
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("tally_trial_balance")
      .select("ledger_name, closing_balance, balance_type, opening_balance, opening_type, parent_group")
      .eq("engagement_id", engagementId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAllTb: ${error.message}`);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
  }
  return all;
}

// ── Sign convention ─────────────────────────────────────────────────────────
function signedOpening(openingBalance, openingType, nature) {
  const ob = Math.abs(Number(openingBalance ?? 0));
  if (ob === 0) return 0;
  const side = String(openingType ?? "").trim().toUpperCase();
  if (!side || (side !== "DR" && side !== "CR")) {
    return nature === "CR" ? +ob : -ob;
  }
  return side === nature ? +ob : -ob;
}

function signedClosing(closingBalance, balanceType, nature) {
  const cb = Math.abs(Number(closingBalance ?? 0));
  if (cb === 0) return 0;
  const side = String(balanceType ?? "").trim().toUpperCase();
  if (!side || (side !== "DR" && side !== "CR")) {
    return nature === "CR" ? +cb : -cb;
  }
  return side === nature ? +cb : -cb;
}

// ── Indian number formatting ────────────────────────────────────────────────
function fmt(n) {
  if (n === null || n === undefined) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n * 100) / 100);
  const [intPart, decPart] = abs.toString().split(".");
  let result = "";
  const len = intPart.length;
  if (len <= 3) {
    result = intPart;
  } else {
    result = intPart.slice(-3);
    let rest = intPart.slice(0, -3);
    while (rest.length > 2) {
      result = rest.slice(-2) + "," + result;
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) result = rest + "," + result;
  }
  return sign + result + (decPart ? "." + decPart : "");
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(78));
  console.log("  DEEP PY BS NOTE MISMATCH INVESTIGATION -- SHRI RAM PRODUCTS");
  console.log("=".repeat(78) + "\n");

  // ── Step 1: Load CY engagement ────────────────────────────────────────────
  const { data: eng, error: engErr } = await supabase
    .from("audit_engagements")
    .select("id, client_id, financial_year, is_py_shell, coa_mapping, entity_type")
    .eq("id", ENGAGEMENT_ID)
    .maybeSingle();
  if (engErr) throw new Error(`Engagement fetch: ${engErr.message}`);
  if (!eng) throw new Error("Engagement not found");
  console.log(`CY Engagement: ${eng.id}`);
  console.log(`  Client ID:      ${eng.client_id}`);
  console.log(`  Financial Year:  ${eng.financial_year}`);
  console.log(`  Entity Type:     ${eng.entity_type}`);
  console.log(`  Is PY Shell:     ${eng.is_py_shell}`);

  const coaMapping = eng.coa_mapping || {};
  const coaEntries = Object.entries(coaMapping);
  console.log(`  COA Mapping:     ${coaEntries.length} entries\n`);

  // ── Step 2: Find PY Shell engagement ──────────────────────────────────────
  console.log("--- Looking for PY Shell engagement ---");
  const parts = String(eng.financial_year).split("-");
  const startYr = parseInt(parts[0], 10);
  const prevFy = `${startYr - 1}-${String(startYr).slice(-2)}`;
  console.log(`Previous FY: ${prevFy}`);

  const { data: prevEngList } = await supabase
    .from("audit_engagements")
    .select("id, financial_year, is_py_shell, entity_type, coa_mapping")
    .eq("client_id", eng.client_id)
    .eq("financial_year", prevFy);

  let pyShellEng = null;
  let pyRegularEng = null;
  if (prevEngList && prevEngList.length > 0) {
    console.log(`Found ${prevEngList.length} previous-year engagement(s):`);
    for (const ps of prevEngList) {
      const coaCount = ps.coa_mapping ? Object.keys(ps.coa_mapping).length : 0;
      console.log(`  - ${ps.id} (FY: ${ps.financial_year}, is_py_shell: ${ps.is_py_shell}, type: ${ps.entity_type}, COA: ${coaCount} entries)`);
      if (ps.is_py_shell) pyShellEng = ps;
      else pyRegularEng = ps;
    }
  } else {
    console.log("No previous-year engagements found.");
  }

  // ── Step 3: Load CY Trial Balance (paginated) ────────────────────────────
  console.log("\n--- Loading CY Trial Balance (paginated) ---");
  const cyTb = await fetchAllTb(ENGAGEMENT_ID);
  console.log(`Loaded ${cyTb.length} CY TB rows.`);

  const cyTbByName = {};
  for (const row of cyTb) {
    const name = (row.ledger_name || "").trim();
    if (!cyTbByName[name]) cyTbByName[name] = [];
    cyTbByName[name].push(row);
  }

  // ── Step 4: Load PY Shell Trial Balance ───────────────────────────────────
  let pyShellTb = [];
  let pyShellCoaMapping = {};
  if (pyShellEng) {
    console.log("\n--- Loading PY Shell Trial Balance ---");
    pyShellTb = await fetchAllTb(pyShellEng.id);
    console.log(`Loaded ${pyShellTb.length} PY shell TB rows.`);
    pyShellCoaMapping = pyShellEng.coa_mapping || {};
    console.log(`PY Shell COA Mapping: ${Object.keys(pyShellCoaMapping).length} entries`);
  }

  // Also load PY regular engagement TB if it exists
  let pyRegularTb = [];
  if (pyRegularEng) {
    console.log("\n--- Loading PY Regular engagement TB ---");
    pyRegularTb = await fetchAllTb(pyRegularEng.id);
    console.log(`Loaded ${pyRegularTb.length} PY regular TB rows.`);
  }

  const pyShellTbByName = {};
  for (const row of pyShellTb) {
    const name = (row.ledger_name || "").trim();
    if (!pyShellTbByName[name]) pyShellTbByName[name] = [];
    pyShellTbByName[name].push(row);
  }

  // ── Step 5: Load NCE Financial Notes ──────────────────────────────────────
  console.log("\n--- Loading NCE Financial Notes ---");
  const { data: noteRows, error: noteErr } = await supabase
    .from("nce_financial_notes")
    .select("*")
    .eq("engagement_id", ENGAGEMENT_ID);
  if (noteErr) throw new Error(`Notes fetch: ${noteErr.message}`);
  console.log(`Loaded ${(noteRows || []).length} note rows.`);

  const noteByType = {};
  for (const n of (noteRows || [])) {
    noteByType[n.note_type] = n;
  }
  console.log(`Note types: ${Object.keys(noteByType).join(", ")}`);

  // Also load PY regular engagement's notes (to see if note PY came from there)
  let pyRegularNotes = {};
  if (pyRegularEng) {
    console.log("\n--- Loading PY Regular engagement notes ---");
    const { data: pyNoteRows } = await supabase
      .from("nce_financial_notes")
      .select("*")
      .eq("engagement_id", pyRegularEng.id);
    for (const n of (pyNoteRows || [])) {
      pyRegularNotes[n.note_type] = n;
    }
    console.log(`PY regular note types: ${Object.keys(pyRegularNotes).join(", ")}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INVESTIGATE EACH MISMATCH
  // ══════════════════════════════════════════════════════════════════════════

  for (const m of MISMATCHES) {
    console.log("\n\n" + "=".repeat(78));
    console.log(`  ${m.label.toUpperCase()} (${m.fsCode}) -- noteType: "${m.noteType}" splitSide: ${m.splitSide || "none"}`);
    console.log("=".repeat(78));

    // ── A. Find COA-mapped ledgers for this FS code ─────────────────────
    const noteMapping = NCE_NOTE_FS_MAP[m.noteType];
    let relevantFsCodes;
    if (m.splitSide === "lt") {
      relevantFsCodes = noteMapping.lt || [];
    } else if (m.splitSide === "st") {
      relevantFsCodes = noteMapping.st || [];
    } else {
      relevantFsCodes = noteMapping.all || [];
    }

    // All codes for the note (both sides for Pattern A)
    let allFsCodesForNote = [];
    if (noteMapping.lt) allFsCodesForNote.push(...noteMapping.lt);
    if (noteMapping.st) allFsCodesForNote.push(...noteMapping.st);
    if (noteMapping.all) allFsCodesForNote.push(...noteMapping.all);
    allFsCodesForNote = [...new Set(allFsCodesForNote)];

    console.log(`\n  Relevant FS codes (this side): ${relevantFsCodes.join(", ")}`);
    console.log(`  All FS codes for note:         ${allFsCodesForNote.join(", ")}`);

    // Find CY COA-mapped ledgers assigned to these codes
    const mappedLedgers = [];
    for (const [ledgerName, mapping] of coaEntries) {
      const code = mapping?.code || mapping;
      if (relevantFsCodes.includes(code)) {
        mappedLedgers.push({ ledger_name: ledgerName, fs_code: code });
      }
    }
    console.log(`  CY COA-mapped ledger count (this side): ${mappedLedgers.length}`);

    // Find PY Shell COA-mapped ledgers
    const pyShellMapped = [];
    for (const [ledgerName, mapping] of Object.entries(pyShellCoaMapping)) {
      const code = mapping?.code || mapping;
      if (relevantFsCodes.includes(code)) {
        pyShellMapped.push({ ledger_name: ledgerName, fs_code: code });
      }
    }
    console.log(`  PY Shell COA-mapped ledger count (this side): ${pyShellMapped.length}`);

    // ── B. Compute COA PY from CY TB opening balances ───────────────────
    console.log(`\n  --- [A] COA PY (from CY TB opening_balance, CY COA mapping) ---`);
    let coaPyTotal = 0;
    const coaPyDetails = [];

    for (const ledger of mappedLedgers) {
      const ledgerName = ledger.ledger_name.trim();
      const tbRows = cyTbByName[ledgerName] || [];
      if (tbRows.length === 0) {
        coaPyDetails.push({
          name: ledgerName, fsCode: ledger.fs_code,
          openingBalance: null, openingType: null, signedValue: 0,
          note: "NOT IN CY TB",
        });
        continue;
      }
      for (const tb of tbRows) {
        const signed = signedOpening(tb.opening_balance, tb.opening_type, m.nature);
        coaPyTotal += signed;
        coaPyDetails.push({
          name: ledgerName, fsCode: ledger.fs_code,
          openingBalance: tb.opening_balance, openingType: tb.opening_type,
          signedValue: signed, note: "",
        });
      }
    }

    // Sort by absolute value descending
    coaPyDetails.sort((a, b) => Math.abs(b.signedValue) - Math.abs(a.signedValue));
    for (const d of coaPyDetails) {
      const balStr = d.openingBalance !== null ? fmt(d.openingBalance) : "--";
      const typeStr = d.openingType || "--";
      console.log(`    ${d.name}`);
      console.log(`      FS: ${d.fsCode} | Opening: ${balStr} ${typeStr} | Signed: ${fmt(d.signedValue)} ${d.note}`);
    }
    console.log(`  ----------------------------------------`);
    console.log(`  COA PY TOTAL       = ${fmt(coaPyTotal)}`);
    console.log(`  Expected COA PY    = ${fmt(m.expectedCoaPy)}`);
    const coaPyMatch = Math.abs(coaPyTotal - m.expectedCoaPy) < 1;
    console.log(`  Match: ${coaPyMatch ? "YES" : `NO (diff = ${fmt(coaPyTotal - m.expectedCoaPy)})`}`);

    // ── C. PY Shell — compute from PY shell closing balances ────────────
    console.log(`\n  --- [B] PY Shell (from PY shell TB closing_balance, PY Shell COA) ---`);
    let pyShellTotal = 0;
    const pyShellDetails = [];

    for (const ledger of pyShellMapped) {
      const ledgerName = ledger.ledger_name.trim();
      const tbRows = pyShellTbByName[ledgerName] || [];
      if (tbRows.length === 0) {
        pyShellDetails.push({
          name: ledgerName, fsCode: ledger.fs_code,
          closingBalance: null, balanceType: null, signedValue: 0,
          note: "NOT IN PY SHELL TB",
        });
        continue;
      }
      for (const tb of tbRows) {
        const signed = signedClosing(tb.closing_balance, tb.balance_type, m.nature);
        pyShellTotal += signed;
        pyShellDetails.push({
          name: ledgerName, fsCode: ledger.fs_code,
          closingBalance: tb.closing_balance, balanceType: tb.balance_type,
          signedValue: signed, note: "",
        });
      }
    }

    pyShellDetails.sort((a, b) => Math.abs(b.signedValue) - Math.abs(a.signedValue));
    for (const d of pyShellDetails) {
      const balStr = d.closingBalance !== null ? fmt(d.closingBalance) : "--";
      const typeStr = d.balanceType || "--";
      console.log(`    ${d.name}`);
      console.log(`      FS: ${d.fsCode} | Closing: ${balStr} ${typeStr} | Signed: ${fmt(d.signedValue)} ${d.note}`);
    }
    console.log(`  ----------------------------------------`);
    console.log(`  PY SHELL TOTAL     = ${fmt(pyShellTotal)}`);

    // ── D. Cross-compare CY TB openings vs PY Shell closings ────────────
    console.log(`\n  --- [C] Per-ledger CY Opening vs PY Shell Closing DIFFERENCES ---`);
    const allLedgerNames = new Set([
      ...coaPyDetails.map(d => d.name),
      ...pyShellDetails.map(d => d.name),
    ]);

    let diffCount = 0;
    const cyOnlyLedgers = [];
    const pyOnlyLedgers = [];

    for (const name of [...allLedgerNames].sort()) {
      const cyEntry = coaPyDetails.find(d => d.name === name);
      const pyEntry = pyShellDetails.find(d => d.name === name);

      const cyVal = cyEntry ? cyEntry.signedValue : 0;
      const pyVal = pyEntry ? pyEntry.signedValue : 0;
      const diff = cyVal - pyVal;

      if (!cyEntry && pyEntry) {
        pyOnlyLedgers.push({ name, pyVal });
      } else if (cyEntry && !pyEntry) {
        cyOnlyLedgers.push({ name, cyVal });
      }

      if (Math.abs(diff) > 0.5) {
        diffCount++;
        const cyBal = cyEntry && cyEntry.openingBalance !== null
          ? `${fmt(cyEntry.openingBalance)} ${cyEntry.openingType || "--"}`
          : "(not present)";
        const pyBal = pyEntry && pyEntry.closingBalance !== null
          ? `${fmt(pyEntry.closingBalance)} ${pyEntry.balanceType || "--"}`
          : "(not present)";
        console.log(`    DIFF: ${name}`);
        console.log(`      CY Opening: ${cyBal} -> signed ${fmt(cyVal)}`);
        console.log(`      PY Closing: ${pyBal} -> signed ${fmt(pyVal)}`);
        console.log(`      Difference: ${fmt(diff)}`);
      }
    }

    if (pyOnlyLedgers.length > 0) {
      console.log(`\n  ** PY-Shell-only ledgers (in PY Shell COA but NOT in CY COA for ${relevantFsCodes.join("/")}): **`);
      for (const l of pyOnlyLedgers) {
        console.log(`    ${l.name} -> PY Shell signed = ${fmt(l.pyVal)}`);
      }
    }
    if (cyOnlyLedgers.length > 0) {
      console.log(`\n  ** CY-only ledgers (in CY COA but NOT in PY Shell COA for ${relevantFsCodes.join("/")}): **`);
      for (const l of cyOnlyLedgers) {
        console.log(`    ${l.name} -> CY Opening signed = ${fmt(l.cyVal)}`);
      }
    }
    if (diffCount === 0 && pyOnlyLedgers.length === 0 && cyOnlyLedgers.length === 0) {
      console.log(`    (All ledgers match)`);
    }

    // ── E. Note PY data ─────────────────────────────────────────────────
    const dbNoteType = m.noteType;
    const noteRow = noteByType[dbNoteType];

    console.log(`\n  --- [D] Note PY Data (nce_financial_notes note_type="${dbNoteType}") ---`);

    if (!noteRow) {
      console.log(`    *** NOTE ROW NOT FOUND ***`);
      console.log(`    Available: ${Object.keys(noteByType).join(", ")}`);
    } else {
      const pyData = noteRow.py_data || {};
      const cyData = noteRow.cy_data || {};
      const suffix = m.splitSide ? `_${m.splitSide}` : null;

      console.log(`  Note DB ID: ${noteRow.id}`);
      console.log(`  Pattern: ${suffix ? `A (looking at ${suffix} keys)` : "B"}`);

      // Sum all numeric PY values
      let notePyTotal = 0;
      const pyEntries = [];
      const metaKeys = new Set(["_custom_rows", "_meta", "_version"]);

      for (const [key, val] of Object.entries(pyData)) {
        if (metaKeys.has(key)) continue;
        if (typeof val !== "number") continue;

        if (suffix) {
          if (key.endsWith(suffix)) {
            pyEntries.push({ key, baseKey: key.slice(0, -suffix.length), value: val });
            notePyTotal += val;
          }
        } else {
          pyEntries.push({ key, baseKey: key, value: val });
          notePyTotal += val;
        }
      }

      console.log(`\n  PY data entries (numeric ${suffix || "all"} keys):`);
      pyEntries.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      for (const e of pyEntries) {
        if (Math.abs(e.value) > 0.005) {
          console.log(`    ${e.key} = ${fmt(e.value)}`);
        }
      }
      const zeroEntries = pyEntries.filter(e => Math.abs(e.value) <= 0.005);
      if (zeroEntries.length > 0) {
        console.log(`    (${zeroEntries.length} more entries with value 0)`);
      }

      // Custom rows
      const customRows = cyData._custom_rows || [];
      if (Array.isArray(customRows) && customRows.length > 0) {
        console.log(`\n  Custom rows (${customRows.length}):`);
        for (const cr of customRows) {
          const crId = cr.id;
          const crLabel = cr.label || cr.ledger || cr.name || crId;
          const crSection = cr.section || "--";
          const crAttachedTo = cr.attachedTo || "--";

          let crPyVal;
          if (suffix) {
            crPyVal = pyData[crId + suffix];
          } else {
            crPyVal = pyData[crId];
          }

          // Sources PY
          let sourcesPy = 0;
          if (cr.sources && Array.isArray(cr.sources)) {
            for (const src of cr.sources) {
              if (suffix === "_st" && src.column === "st") sourcesPy += Number(src.amountPy || 0);
              else if (suffix === "_lt" && (src.column === "lt" || !src.column)) sourcesPy += Number(src.amountPy || 0);
              else if (!suffix) sourcesPy += Number(src.amountPy || 0);
            }
          }

          // Only print if there's something interesting
          if (Math.abs(crPyVal || 0) > 0.5 || Math.abs(sourcesPy) > 0.5) {
            console.log(`    CR: "${crLabel}" [id=${crId}]`);
            console.log(`      section=${crSection} attachedTo=${crAttachedTo}`);
            console.log(`      PY value in py_data: ${crPyVal !== undefined ? fmt(crPyVal) : "--"}`);
            console.log(`      Sources PY sum:      ${fmt(sourcesPy)}`);

            if (cr.sources && cr.sources.length > 0) {
              for (const src of cr.sources) {
                if (suffix === "_st" && src.column !== "st") continue;
                if (suffix === "_lt" && src.column === "st") continue;
                if (Math.abs(Number(src.amountPy || 0)) > 0.5 || Math.abs(Number(src.amountCy || 0)) > 0.5) {
                  console.log(`        Src: "${src.ledger}" CY=${fmt(src.amountCy)} PY=${fmt(src.amountPy)} col=${src.column || "lt"}`);
                }
              }
            }
          }
        }
      }

      console.log(`\n  ----------------------------------------`);
      console.log(`  NOTE PY TOTAL (sum of ${suffix || "all"} numeric keys) = ${fmt(notePyTotal)}`);
      console.log(`  Expected Note PY = ${fmt(m.expectedNotePy)}`);
      console.log(`  Match: ${Math.abs(notePyTotal - m.expectedNotePy) < 1 ? "YES" : `NO (diff = ${fmt(notePyTotal - m.expectedNotePy)})`}`);

      // ── F. Trace each source to CY Opening vs PY Shell Closing ────────
      console.log(`\n  --- [E] Source-level tracing: where did the note PY values come from? ---`);

      const allSources = [];
      if (Array.isArray(customRows)) {
        for (const cr of customRows) {
          if (!cr.sources) continue;
          for (const src of cr.sources) {
            if (!src.ledger) continue;
            if (suffix === "_st" && src.column !== "st") continue;
            if (suffix === "_lt" && src.column === "st") continue;
            allSources.push({ crId: cr.id, crLabel: cr.label || cr.ledger || cr.id, ...src });
          }
        }
      }

      let matchesCyOpening = 0, matchesPyClosing = 0, matchesNeither = 0, zeros = 0;
      for (const src of allSources) {
        const srcPy = Number(src.amountPy || 0);
        const ledgerName = src.ledger;

        const cyTbRow = (cyTbByName[ledgerName] || [])[0];
        const pyTbRow = (pyShellTbByName[ledgerName] || [])[0];

        const cyOpening = cyTbRow ? signedOpening(cyTbRow.opening_balance, cyTbRow.opening_type, m.nature) : null;
        const pyClosing = pyTbRow ? signedClosing(pyTbRow.closing_balance, pyTbRow.balance_type, m.nature) : null;

        let matchesWhat = "UNKNOWN";
        if (Math.abs(srcPy) < 0.5) { matchesWhat = "ZERO"; zeros++; }
        else if (cyOpening !== null && Math.abs(srcPy - cyOpening) < 1) { matchesWhat = "CY_OPENING"; matchesCyOpening++; }
        else if (pyClosing !== null && Math.abs(srcPy - pyClosing) < 1) { matchesWhat = "PY_SHELL_CLOSING"; matchesPyClosing++; }
        else { matchesWhat = "NEITHER"; matchesNeither++; }

        if (Math.abs(srcPy) > 0.5) {
          console.log(`    "${ledgerName}"`);
          console.log(`      Source PY:     ${fmt(srcPy)}`);
          console.log(`      CY Opening:    ${cyOpening !== null ? fmt(cyOpening) : "NOT IN CY TB"}`);
          console.log(`      PY Closing:    ${pyClosing !== null ? fmt(pyClosing) : "NOT IN PY SHELL"}`);
          console.log(`      -> MATCHES:    ${matchesWhat}`);
        }
      }

      console.log(`\n  Source match summary:`);
      console.log(`    Matches CY Opening:      ${matchesCyOpening}`);
      console.log(`    Matches PY Shell Closing: ${matchesPyClosing}`);
      console.log(`    Matches NEITHER:          ${matchesNeither}`);
      console.log(`    Zero values:              ${zeros}`);

      // ── G. Check for missing/extra ledgers ────────────────────────────
      const sourceLedgerNames = new Set(allSources.map(s => s.ledger));
      const cyMappedNames = mappedLedgers.map(l => l.ledger_name.trim());
      const missingFromNote = cyMappedNames.filter(n => !sourceLedgerNames.has(n));
      const cyTbNames = new Set(cyTb.map(r => (r.ledger_name || "").trim()));
      const notInCyTb = [...sourceLedgerNames].filter(n => !cyTbNames.has(n));

      if (missingFromNote.length > 0) {
        console.log(`\n  CY TB ledgers mapped to ${relevantFsCodes.join("/")} but NOT in note custom row sources:`);
        for (const name of missingFromNote) {
          const tbRows = cyTbByName[name] || [];
          for (const tb of tbRows) {
            const signed = signedOpening(tb.opening_balance, tb.opening_type, m.nature);
            if (Math.abs(signed) > 0.5)
              console.log(`    "${name}": opening=${fmt(tb.opening_balance)} ${tb.opening_type || "--"} -> signed=${fmt(signed)}`);
          }
        }
      }

      if (notInCyTb.length > 0) {
        console.log(`\n  Note source ledgers NOT in CY TB (stale/closed accounts?):`);
        for (const name of notInCyTb) {
          const pyRows = pyShellTbByName[name] || [];
          if (pyRows.length > 0) {
            for (const tb of pyRows) {
              const signed = signedClosing(tb.closing_balance, tb.balance_type, m.nature);
              console.log(`    "${name}": PY closing=${fmt(tb.closing_balance)} ${tb.balance_type} -> signed=${fmt(signed)}`);
            }
          } else {
            console.log(`    "${name}": NOT in PY shell TB either`);
          }
        }
      }

      // ── H. Check PY regular engagement notes (FY-1 note cy_data as PY source) ──
      if (pyRegularNotes[dbNoteType]) {
        const prevNote = pyRegularNotes[dbNoteType];
        const prevCy = prevNote.cy_data || {};
        console.log(`\n  --- [F] PY Regular engagement note (FY-1's cy_data becomes this CY's py_data) ---`);
        console.log(`  PY Regular note_type="${dbNoteType}" cy_data keys:`);
        let prevTotal = 0;
        const prevEntries = [];
        for (const [key, val] of Object.entries(prevCy)) {
          if (metaKeys.has(key)) continue;
          if (typeof val !== "number") continue;
          if (suffix) {
            if (key.endsWith(suffix)) {
              prevEntries.push({ key, value: val });
              prevTotal += val;
            }
          } else {
            prevEntries.push({ key, value: val });
            prevTotal += val;
          }
        }
        prevEntries.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
        for (const e of prevEntries) {
          if (Math.abs(e.value) > 0.5) console.log(`    ${e.key} = ${fmt(e.value)}`);
        }
        console.log(`  PY Regular engagement note CY total = ${fmt(prevTotal)}`);
      }
    }

    // ── SUMMARY ──────────────────────────────────────────────────────────
    const notePyForSummary = (() => {
      if (!noteRow) return 0;
      const pyData = noteRow.py_data || {};
      const suffix = m.splitSide ? `_${m.splitSide}` : null;
      const metaKeys = new Set(["_custom_rows", "_meta", "_version"]);
      let total = 0;
      for (const [key, val] of Object.entries(pyData)) {
        if (metaKeys.has(key)) continue;
        if (typeof val !== "number") continue;
        if (suffix) { if (key.endsWith(suffix)) total += val; }
        else total += val;
      }
      return total;
    })();

    console.log(`\n  +================================================+`);
    console.log(`  | SUMMARY: ${m.label.padEnd(37)} |`);
    console.log(`  +================================================+`);
    console.log(`  | COA PY (CY openings):  ${fmt(coaPyTotal).padStart(20)} |`);
    console.log(`  | PY Shell (closings):   ${fmt(pyShellTotal).padStart(20)} |`);
    console.log(`  | Note PY (py_data):     ${fmt(notePyForSummary).padStart(20)} |`);
    console.log(`  +------------------------------------------------+`);
    console.log(`  | User-reported COA PY:  ${fmt(m.expectedCoaPy).padStart(20)} |`);
    console.log(`  | User-reported Note PY: ${fmt(m.expectedNotePy).padStart(20)} |`);
    console.log(`  | Discrepancy:           ${fmt(m.expectedNotePy - m.expectedCoaPy).padStart(20)} |`);
    console.log(`  +------------------------------------------------+`);
    console.log(`  | Note PY matches COA PY?   ${(Math.abs(notePyForSummary - coaPyTotal) < 1 ? "YES" : "NO").padStart(17)} |`);
    console.log(`  | Note PY matches PY Shell? ${(Math.abs(notePyForSummary - pyShellTotal) < 1 ? "YES" : "NO").padStart(17)} |`);
    console.log(`  +================================================+`);
  }

  // ── GLOBAL: Dump ALL py_data for the 5 note types ─────────────────────────
  console.log("\n\n" + "=".repeat(78));
  console.log("  RAW py_data DUMP FOR ALL 5 NOTE TYPES");
  console.log("=".repeat(78));

  for (const m of MISMATCHES) {
    const noteRow = noteByType[m.noteType];
    if (!noteRow) {
      console.log(`\n  ${m.noteType}: NOT FOUND`);
      continue;
    }
    console.log(`\n  --- ${m.noteType} (${m.label}) ---`);
    const pyData = noteRow.py_data || {};
    // Print JSON but truncate custom rows for readability
    const pyDataForDisplay = { ...pyData };
    if (pyDataForDisplay._custom_rows) {
      pyDataForDisplay._custom_rows = `[${pyDataForDisplay._custom_rows.length} rows - see cy_data._custom_rows]`;
    }
    console.log(`  py_data = ${JSON.stringify(pyDataForDisplay, null, 2)}`);

    // Dump cy_data._custom_rows summary
    const cyData = noteRow.cy_data || {};
    if (cyData._custom_rows && Array.isArray(cyData._custom_rows)) {
      console.log(`\n  cy_data._custom_rows (${cyData._custom_rows.length} rows):`);
      for (const cr of cyData._custom_rows) {
        const label = cr.label || cr.ledger || cr.name || cr.id;
        const srcCount = cr.sources ? cr.sources.length : 0;
        console.log(`    [${cr.id}] "${label}" section=${cr.section||"--"} attachedTo=${cr.attachedTo||"--"} sources=${srcCount}`);
      }
    }
  }

  console.log("\n\nDone.");
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
