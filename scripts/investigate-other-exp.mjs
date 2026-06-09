/**
 * Deep investigation: Other Expenses note mismatch for SHIVASHRAY
 * engagement_id: dae6984f-a803-4187-8e29-6fa158220da7
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://hubyywmodekfdzhwiumb.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc4OTI3OCwiZXhwIjoyMDg4MzY1Mjc4fQ.PmVYktsuUJDweOgP7J_209hlrV_xQl2qUOi7Uc7yeHc";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const ENG_ID = "dae6984f-a803-4187-8e29-6fa158220da7";

// FS codes that map to Other Expenses
const OTHER_EXP_CODES = ["NCE_OTH_EXP", "PL_EXP_OTH", "PL_EXP_OEX"];

function fmt(n) {
  if (n == null) return "null";
  return new Intl.NumberFormat("en-IN").format(Math.round(n));
}

async function main() {
  console.log("=".repeat(80));
  console.log("OTHER EXPENSES GAP ANALYSIS — SHIVASHRAY");
  console.log("=".repeat(80));

  // ────────────────────────────────────────────────────────────────
  // 1. Fetch COA mapping from audit_engagements
  // ────────────────────────────────────────────────────────────────
  console.log("\n── STEP 1: Fetch COA mapping ──");
  const { data: eng, error: engErr } = await supabase
    .from("audit_engagements")
    .select("coa_mapping, entity_type")
    .eq("id", ENG_ID)
    .single();
  if (engErr) { console.error("Error fetching engagement:", engErr); return; }
  console.log("Entity type:", eng.entity_type);

  // COA mapping structure: { ledgerName: { code: "NCE_OTH_EXP", noteRef: 30, confidence: "manual", scheduleRef: "" } }
  const coaMapping = eng.coa_mapping || {};
  const allLedgers = Object.keys(coaMapping);
  console.log(`Total COA mapping entries: ${allLedgers.length}`);

  // ────────────────────────────────────────────────────────────────
  // 2. Get ALL TB ledgers mapped to NCE_OTH_EXP / PL_EXP_OTH / PL_EXP_OEX
  // ────────────────────────────────────────────────────────────────
  console.log("\n── STEP 2: TB ledgers mapped to Other Expenses codes ──");

  const otherExpLedgers = [];
  for (const [ledgerName, mapping] of Object.entries(coaMapping)) {
    const code = mapping?.code || "";
    if (OTHER_EXP_CODES.includes(code)) {
      otherExpLedgers.push({ ledgerName, fsCode: code, noteRef: mapping.noteRef, confidence: mapping.confidence });
    }
  }
  console.log(`Ledgers mapped to Other Expenses codes: ${otherExpLedgers.length}`);

  // ────────────────────────────────────────────────────────────────
  // 2b. Fetch TB data from tally_trial_balance
  // ────────────────────────────────────────────────────────────────
  console.log("\n── STEP 2b: Fetch Trial Balance data ──");

  const { data: tbRows, error: tbErr } = await supabase
    .from("tally_trial_balance")
    .select("ledger_name, closing_balance, balance_type, opening_balance, opening_type, debit_amount, credit_amount, parent_group")
    .eq("engagement_id", ENG_ID);
  if (tbErr) { console.error("Error fetching TB:", tbErr); return; }
  console.log(`Total TB rows: ${tbRows.length}`);

  // Build TB lookup by ledger name
  const tbByName = {};
  for (const row of tbRows) {
    tbByName[row.ledger_name] = row;
  }

  // ────────────────────────────────────────────────────────────────
  // 2c. List each mapped ledger with its TB data
  // ────────────────────────────────────────────────────────────────
  console.log("\n── STEP 2c: All 54 Mapped Other Expenses Ledgers ──");
  console.log("-".repeat(130));
  console.log(`${"#".padStart(3)} | ${"Ledger Name".padEnd(55)} | ${"FS Code".padEnd(14)} | ${"Closing Bal".padStart(15)} | ${"Bal Type".padEnd(4)} | ${"Parent Group".padEnd(25)}`);
  console.log("-".repeat(130));

  let totalMappedAmount = 0;
  const mappedLedgerDetails = [];

  // Sort by closing balance descending for readability
  const sortedLedgers = [...otherExpLedgers].sort((a, b) => {
    const tbA = tbByName[a.ledgerName];
    const tbB = tbByName[b.ledgerName];
    return Math.abs(tbB?.closing_balance || 0) - Math.abs(tbA?.closing_balance || 0);
  });

  for (let i = 0; i < sortedLedgers.length; i++) {
    const l = sortedLedgers[i];
    const tb = tbByName[l.ledgerName];
    const closingBal = tb?.closing_balance ?? 0;
    const balType = tb?.balance_type ?? "?";
    const parentGroup = tb?.parent_group ?? "?";

    totalMappedAmount += closingBal;
    mappedLedgerDetails.push({
      ledgerName: l.ledgerName,
      fsCode: l.fsCode,
      closingBalance: closingBal,
      balanceType: balType,
      parentGroup,
      foundInTB: !!tb
    });

    const notInTB = tb ? "" : " [NOT IN TB!]";
    console.log(`${String(i+1).padStart(3)} | ${(l.ledgerName + notInTB).substring(0, 55).padEnd(55)} | ${l.fsCode.padEnd(14)} | ${fmt(closingBal).padStart(15)} | ${balType.padEnd(4)} | ${(parentGroup||"").substring(0,25)}`);
  }

  console.log("-".repeat(130));
  console.log(`TOTAL mapped to Other Expenses (raw TB closing balances): ${fmt(totalMappedAmount)}`);

  // ────────────────────────────────────────────────────────────────
  // 3. Fetch nce_financial_notes for other_expenses
  // ────────────────────────────────────────────────────────────────
  console.log("\n\n── STEP 3: nce_financial_notes row for other_expenses ──");

  const { data: noteRow, error: noteErr } = await supabase
    .from("nce_financial_notes")
    .select("*")
    .eq("engagement_id", ENG_ID)
    .eq("note_type", "other_expenses")
    .maybeSingle();

  if (noteErr) {
    console.error("Error fetching note:", noteErr);
    return;
  }
  if (!noteRow) {
    console.log("NO note row found for other_expenses! This means the note was never auto-populated.");

    // Check what notes DO exist
    const { data: allNotes } = await supabase
      .from("nce_financial_notes")
      .select("note_type")
      .eq("engagement_id", ENG_ID);
    console.log("Existing note types:", allNotes?.map(n => n.note_type).join(", "));
    return;
  }

  console.log("Note row found!");
  console.log("  id:", noteRow.id);
  console.log("  note_type:", noteRow.note_type);
  console.log("  created_at:", noteRow.created_at);
  console.log("  updated_at:", noteRow.updated_at);

  const cyData = noteRow.cy_data || {};
  const pyData = noteRow.py_data || {};

  console.log("\n  cy_data keys:", Object.keys(cyData).length);
  console.log("  Full cy_data JSON:");
  console.log(JSON.stringify(cyData, null, 2));

  // ────────────────────────────────────────────────────────────────
  // 4. Extract _custom_rows from cy_data
  // ────────────────────────────────────────────────────────────────
  console.log("\n\n── STEP 4: Custom rows in cy_data ──");

  const customRows = cyData._custom_rows || [];
  console.log(`Number of custom rows: ${customRows.length}`);
  console.log("-".repeat(150));
  console.log(`${"#".padStart(3)} | ${"ID".padEnd(22)} | ${"Label".padEnd(50)} | ${"Source".padEnd(8)} | ${"AttachedTo".padEnd(15)} | ${"CY Amount".padStart(15)}`);
  console.log("-".repeat(150));

  let totalCustomRowAmount = 0;
  for (let i = 0; i < customRows.length; i++) {
    const cr = customRows[i];
    const cyAmt = cyData[cr.id] ?? 0;
    totalCustomRowAmount += cyAmt;
    console.log(`${String(i+1).padStart(3)} | ${(cr.id||"").substring(0,22).padEnd(22)} | ${(cr.label||"").substring(0,50).padEnd(50)} | ${(cr.source||"").padEnd(8)} | ${(cr.attachedTo||"").padEnd(15)} | ${fmt(cyAmt).padStart(15)}`);
  }
  console.log("-".repeat(150));
  console.log(`Total custom row amounts: ${fmt(totalCustomRowAmount)}`);

  // Also check static row amounts
  console.log("\n  Non-custom-row cy_data entries (static rows):");
  let staticTotal = 0;
  for (const [key, val] of Object.entries(cyData)) {
    if (key !== "_custom_rows" && !key.startsWith("custom_")) {
      console.log(`    ${key}: ${typeof val === 'number' ? fmt(val) : JSON.stringify(val)}`);
      if (typeof val === 'number') staticTotal += val;
    }
  }
  console.log(`  Static row total: ${fmt(staticTotal)}`);
  console.log(`  Grand total (static + custom): ${fmt(staticTotal + totalCustomRowAmount)}`);

  // ────────────────────────────────────────────────────────────────
  // 5. Compare: which TB ledgers appear in custom rows, which are MISSING
  // ────────────────────────────────────────────────────────────────
  console.log("\n\n── STEP 5: Gap Analysis — TB ledgers vs custom rows ──");

  // Build a set of custom row labels (normalized)
  const customRowLabels = new Set(customRows.map(cr => cr.label?.trim()?.toLowerCase()));
  const customRowLabelMap = {};
  for (const cr of customRows) {
    const key = cr.label?.trim()?.toLowerCase();
    if (key) customRowLabelMap[key] = cr;
  }

  let presentCount = 0, missingCount = 0;
  let presentAmount = 0, missingAmount = 0;

  const presentLedgers = [];
  const missingLedgers = [];

  for (const l of mappedLedgerDetails) {
    const normalizedName = l.ledgerName.trim().toLowerCase();
    const found = customRowLabels.has(normalizedName);

    if (found) {
      presentCount++;
      presentAmount += l.closingBalance;
      const cr = customRowLabelMap[normalizedName];
      const noteAmt = cyData[cr.id] ?? 0;
      presentLedgers.push({ ...l, noteAmount: noteAmt, customRowId: cr.id, source: cr.source });
    } else {
      missingCount++;
      missingAmount += l.closingBalance;
      missingLedgers.push(l);
    }
  }

  console.log(`\nPRESENT in note: ${presentCount} ledgers, total TB amount = ${fmt(presentAmount)}`);
  console.log(`MISSING from note: ${missingCount} ledgers, total TB amount = ${fmt(missingAmount)}`);

  console.log("\n── PRESENT ledgers (in both COA and note) ──");
  console.log("-".repeat(150));
  console.log(`${"#".padStart(3)} | ${"Ledger Name".padEnd(45)} | ${"TB Amount".padStart(15)} | ${"Note Amount".padStart(15)} | ${"Match?".padEnd(25)} | ${"Source".padEnd(8)} | Custom Row ID`);
  console.log("-".repeat(150));
  for (let i = 0; i < presentLedgers.length; i++) {
    const l = presentLedgers[i];
    const diff = l.closingBalance - l.noteAmount;
    const match = Math.abs(diff) < 1 ? "YES" : `NO (diff: ${fmt(diff)})`;
    console.log(`${String(i+1).padStart(3)} | ${l.ledgerName.substring(0, 45).padEnd(45)} | ${fmt(l.closingBalance).padStart(15)} | ${fmt(l.noteAmount).padStart(15)} | ${match.padEnd(25)} | ${(l.source||"").padEnd(8)} | ${l.customRowId}`);
  }

  console.log("\n── MISSING ledgers (in COA but NOT in note) ──");
  console.log("-".repeat(110));
  console.log(`${"#".padStart(3)} | ${"Ledger Name".padEnd(55)} | ${"TB Closing Bal".padStart(15)} | ${"Bal Type".padEnd(4)} | ${"Parent Group".padEnd(25)}`);
  console.log("-".repeat(110));
  for (let i = 0; i < missingLedgers.length; i++) {
    const l = missingLedgers[i];
    console.log(`${String(i+1).padStart(3)} | ${l.ledgerName.substring(0, 55).padEnd(55)} | ${fmt(l.closingBalance).padStart(15)} | ${l.balanceType.padEnd(4)} | ${(l.parentGroup||"").substring(0,25)}`);
  }
  console.log("-".repeat(110));
  console.log(`Missing ledgers total: ${fmt(missingAmount)}`);

  // ────────────────────────────────────────────────────────────────
  // 6. Sum present vs missing amounts
  // ────────────────────────────────────────────────────────────────
  console.log("\n\n── STEP 6: Amount reconciliation ──");
  console.log(`COA-mapped TB total (raw):  ${fmt(totalMappedAmount)}`);
  console.log(`Note custom row total:      ${fmt(totalCustomRowAmount)}`);
  console.log(`Note static row total:      ${fmt(staticTotal)}`);
  console.log(`Note grand total:           ${fmt(staticTotal + totalCustomRowAmount)}`);
  console.log(`Gap (COA TB - Note total):  ${fmt(totalMappedAmount - (staticTotal + totalCustomRowAmount))}`);
  console.log(`Present ledger TB total:    ${fmt(presentAmount)}`);
  console.log(`Missing ledger TB total:    ${fmt(missingAmount)}`);

  // ────────────────────────────────────────────────────────────────
  // 7. Check manual rows with stale amounts
  // ────────────────────────────────────────────────────────────────
  console.log("\n\n── STEP 7: Manual vs Auto rows analysis ──");

  const manualRows = customRows.filter(cr => cr.source === "manual");
  const autoRows = customRows.filter(cr => cr.source === "auto");
  const otherSourceRows = customRows.filter(cr => cr.source !== "manual" && cr.source !== "auto");

  console.log(`Auto rows: ${autoRows.length}`);
  console.log(`Manual rows: ${manualRows.length}`);
  console.log(`Other/unknown source rows: ${otherSourceRows.length}`);

  if (manualRows.length > 0) {
    console.log("\n  Manual rows detail:");
    for (const cr of manualRows) {
      const cyAmt = cyData[cr.id] ?? 0;
      const tbMatch = tbByName[cr.label?.trim()];
      const tbAmt = tbMatch?.closing_balance;
      const tbStr = tbAmt != null ? fmt(tbAmt) : "NO TB MATCH";
      const stale = (tbAmt != null && Math.abs(cyAmt - tbAmt) > 1)
        ? `YES (note: ${fmt(cyAmt)}, TB: ${fmt(tbAmt)}, diff: ${fmt(cyAmt - tbAmt)})`
        : "NO";
      console.log(`    "${cr.label}" → note: ${fmt(cyAmt)}, TB: ${tbStr}, stale? ${stale}`);
    }
  }

  if (autoRows.length > 0) {
    console.log("\n  Auto rows — checking for stale amounts:");
    let staleCount = 0;
    for (const cr of autoRows) {
      const cyAmt = cyData[cr.id] ?? 0;
      const tbMatch = tbByName[cr.label?.trim()];
      const tbAmt = tbMatch?.closing_balance;
      if (tbAmt != null && Math.abs(cyAmt - tbAmt) > 1) {
        staleCount++;
        console.log(`    STALE: "${cr.label}" → note: ${fmt(cyAmt)}, TB: ${fmt(tbAmt)}, diff: ${fmt(cyAmt - tbAmt)}`);
      }
    }
    if (staleCount === 0) console.log("    No stale auto rows found — all auto rows match TB.");
  }

  if (otherSourceRows.length > 0) {
    console.log("\n  Other/unknown source rows:");
    for (const cr of otherSourceRows) {
      const cyAmt = cyData[cr.id] ?? 0;
      console.log(`    "${cr.label}" | source: "${cr.source}" | amount: ${fmt(cyAmt)}`);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 8. Check for custom rows that don't match any COA-mapped ledger
  // ────────────────────────────────────────────────────────────────
  console.log("\n\n── STEP 8: Orphan custom rows (in note but NOT in COA mapping) ──");
  const coaMappedNames = new Set(mappedLedgerDetails.map(l => l.ledgerName.trim().toLowerCase()));
  const orphanRows = customRows.filter(cr => !coaMappedNames.has(cr.label?.trim()?.toLowerCase()));

  if (orphanRows.length > 0) {
    console.log(`Found ${orphanRows.length} orphan custom rows:`);
    for (const cr of orphanRows) {
      const cyAmt = cyData[cr.id] ?? 0;
      console.log(`  "${cr.label}" | source: ${cr.source} | amount: ${fmt(cyAmt)} | attachedTo: ${cr.attachedTo || "none"}`);
    }
  } else {
    console.log("No orphan rows found — all custom rows map to a COA ledger.");
  }

  // ────────────────────────────────────────────────────────────────
  // 9. Check fa_financial_statements for computed Other Expenses total
  // ────────────────────────────────────────────────────────────────
  console.log("\n\n── STEP 9: fa_financial_statements computed amounts ──");
  const { data: fsRow, error: fsErr } = await supabase
    .from("fa_financial_statements")
    .select("*")
    .eq("engagement_id", ENG_ID)
    .maybeSingle();

  if (fsErr) {
    console.log("fa_financial_statements error:", fsErr.message);
  } else if (!fsRow) {
    console.log("No fa_financial_statements row found.");
  } else {
    console.log("fa_financial_statements columns:", Object.keys(fsRow));
    // Look for Other Expenses related keys in JSON columns
    for (const [key, val] of Object.entries(fsRow)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const matches = {};
        for (const [k2, v2] of Object.entries(val)) {
          if (/oth|OTH|EXP|exp|NCE_OTH|PL_EXP/i.test(k2)) {
            matches[k2] = v2;
          }
        }
        if (Object.keys(matches).length > 0) {
          console.log(`\n  ${key} — Other Expenses related keys:`);
          for (const [mk, mv] of Object.entries(matches)) {
            console.log(`    ${mk}: ${typeof mv === 'number' ? fmt(mv) : JSON.stringify(mv)}`);
          }
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 10. Check sign convention — are Dr expense balances being flipped?
  // ────────────────────────────────────────────────────────────────
  console.log("\n\n── STEP 10: Sign Convention Check ──");
  console.log("Per fsSignConvention.ts: Dr on Dr-natural (expense) = POSITIVE");
  console.log("Checking balance types for mapped Other Expense ledgers:");

  let drCount = 0, crCount = 0;
  let drSum = 0, crSum = 0;
  for (const l of mappedLedgerDetails) {
    if (l.balanceType === "Dr") { drCount++; drSum += l.closingBalance; }
    else if (l.balanceType === "Cr") { crCount++; crSum += l.closingBalance; }
  }
  console.log(`  Dr ledgers: ${drCount}, sum = ${fmt(drSum)}`);
  console.log(`  Cr ledgers: ${crCount}, sum = ${fmt(crSum)}`);
  console.log(`  Net (Dr - Cr): ${fmt(drSum - crSum)}`);
  console.log(`  Note: For expenses, Dr = positive contribution, Cr = negative (refund/contra)`);

  // ────────────────────────────────────────────────────────────────
  // FINAL SUMMARY
  // ────────────────────────────────────────────────────────────────
  console.log("\n\n" + "=".repeat(80));
  console.log("FINAL SUMMARY");
  console.log("=".repeat(80));
  console.log(`Entity: SHIVASHRAY (Partnership)`);
  console.log(`COA mapping: ${otherExpLedgers.length} ledgers → Other Expenses codes`);
  console.log(`TB total (raw closing_balance sum): ${fmt(totalMappedAmount)}`);
  console.log(`Note custom rows: ${customRows.length} rows, total = ${fmt(totalCustomRowAmount)}`);
  console.log(`Note static rows total: ${fmt(staticTotal)}`);
  console.log(`Note grand total: ${fmt(staticTotal + totalCustomRowAmount)}`);
  console.log(`Present in note: ${presentCount} of ${mappedLedgerDetails.length} ledgers (${fmt(presentAmount)} of ${fmt(totalMappedAmount)})`);
  console.log(`Missing from note: ${missingCount} ledgers totaling ${fmt(missingAmount)}`);
  console.log(`Gap: ${fmt(totalMappedAmount - (staticTotal + totalCustomRowAmount))}`);
  console.log("=".repeat(80));
}

main().catch(console.error);
