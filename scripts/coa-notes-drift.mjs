/**
 * COA vs Notes Drift Analysis — read-only investigation script.
 * Compares TB-derived COA totals against nce_financial_notes totals
 * for all 3 NCE engagements, all note types, CY and PY.
 */

const SUPABASE_URL = "https://hubyywmodekfdzhwiumb.supabase.co";
// Read service key from tally-xml-service/.env (bypasses RLS)
import { readFileSync } from "fs";
const envContent = readFileSync("tally-xml-service/.env", "utf8");
const SUPABASE_KEY = envContent.split("\n").find(l => l.startsWith("SUPABASE_SERVICE_KEY="))?.split("=").slice(1).join("=").trim();

const ENGAGEMENTS = [
  { name: "SHIVASHRAY",  id: "dae6984f-a803-4187-8e29-6fa158220da7" },
  { name: "DBS REALTY",  id: "29e6b761-a5e5-4af4-a35f-4bd48ade6a37" },
  { name: "SHRI RAM",    id: "6074f0fb-679a-4b88-98a6-c421cfcf8e0a" },
];

// FS code -> note mapping (from NCE_CODE_TO_NOTE in nceAutoPopulate.ts)
const NCE_CODE_TO_NOTE = {
  NCE_LTB:      { note: "borrowings",       col: "lt" },
  NCE_STB:      { note: "borrowings",       col: "st" },
  NCE_OLTL:     { note: "other_lt_liab" },
  NCE_LTP:      { note: "provisions",       col: "lt" },
  NCE_STP:      { note: "provisions",       col: "st" },
  NCE_TP:       { note: "trade_payables" },
  NCE_OCL:      { note: "other_cl" },
  NCE_CWIP:     { note: "cwip" },
  NCE_NCINV:    { note: "investments",      col: "lt" },
  NCE_CINV:     { note: "investments",      col: "st" },
  NCE_LTLA:     { note: "loans_advances",   col: "lt" },
  NCE_STLA:     { note: "loans_advances",   col: "st" },
  NCE_ONCA:     { note: "other_nc_assets" },
  NCE_STCK:     { note: "inventories" },
  NCE_TR:       { note: "trade_receivables" },
  NCE_CASH:     { note: "cash_bank" },
  NCE_OCA:      { note: "other_ca" },
  NCE_REV_OPS:  { note: "revenue_ops" },
  NCE_REV_OTH:  { note: "other_income" },
  NCE_COGS:     { note: "cogs", config: "cogs_a" },
  NCE_CII:      { note: "cogs", config: "cogs_c" },
  NCE_EMP_EXP:  { note: "employee_exp" },
  NCE_FIN_COST: { note: "finance_costs" },
  NCE_OTH_EXP:  { note: "other_expenses" },
};

// Note natural side (from fsSignConvention.ts)
const NOTE_NATURE = {
  borrowings:       "CR",
  other_lt_liab:    "CR",
  provisions:       "CR",
  trade_payables:   "CR",
  other_cl:         "CR",
  revenue_ops:      "CR",
  other_income:     "CR",
  cwip:             "DR",
  investments:      "DR",
  loans_advances:   "DR",
  other_nc_assets:  "DR",
  inventories:      "DR",
  trade_receivables:"DR",
  cash_bank:        "DR",
  other_ca:         "DR",
  cogs:             "DR",
  employee_exp:     "DR",
  finance_costs:    "DR",
  other_expenses:   "DR",
};

// FS code nature (from fsSignConvention.ts)
const FS_CODE_NATURE = {
  NCE_LTB: "CR", NCE_STB: "CR", NCE_OLTL: "CR", NCE_LTP: "CR", NCE_STP: "CR",
  NCE_TP: "CR", NCE_OCL: "CR",
  NCE_CWIP: "DR", NCE_NCINV: "DR", NCE_CINV: "DR", NCE_LTLA: "DR", NCE_STLA: "DR",
  NCE_ONCA: "DR", NCE_STCK: "DR", NCE_TR: "DR", NCE_CASH: "DR", NCE_OCA: "DR",
  NCE_REV_OPS: "CR", NCE_REV_OTH: "CR",
  NCE_COGS: "DR", NCE_CII: "DR", NCE_EMP_EXP: "DR", NCE_FIN_COST: "DR", NCE_OTH_EXP: "DR",
};

// NCE_NOTE_FS_MAP — which FS codes belong to each note (from nceAutoPopulate.ts)
const NCE_NOTE_FS_MAP = {
  borrowings:        { lt: ["NCE_LTB", "BS_NCL_LTB"], st: ["NCE_STB", "BS_CL_STB"] },
  other_lt_liab:     { all: ["NCE_OLTL", "BS_NCL_OLT", "BS_NCL_DTL"] },
  provisions:        { lt: ["NCE_LTP", "BS_NCL_LTP"], st: ["NCE_STP", "BS_CL_STP"] },
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

// Meta keys to skip in note data
const META_KEYS = new Set([
  "_custom_rows", "_hidden_rows", "_label_overrides",
  "_cy_sources", "_ejected_ledgers", "_source_label_overrides",
]);

// ── Supabase REST helpers ──

async function sbGet(table, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const resp = await fetch(url.toString(), {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase ${table}: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function sbGetPaginated(table, params = {}, pageSize = 1000) {
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams({
      ...params,
      offset: String(offset),
      limit: String(pageSize),
    })}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Supabase ${table}: ${resp.status} ${text}`);
    }
    const data = await resp.json();
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

// ── Sign convention ──

function signedBalance(amount, balanceType, noteTypeOrFsCode) {
  const cb = Math.abs(Number(amount ?? 0));
  if (cb === 0) return 0;
  // Resolve nature from noteType first, then fsCode
  const nature = NOTE_NATURE[noteTypeOrFsCode] || FS_CODE_NATURE[noteTypeOrFsCode] || "CR";
  const side = String(balanceType ?? "").trim().toUpperCase();
  if (side !== "DR" && side !== "CR") return nature === "CR" ? +cb : -cb;
  return side === nature ? +cb : -cb;
}

function signedOpening(openingBalance, openingType, noteTypeOrFsCode) {
  const ob = Math.abs(Number(openingBalance ?? 0));
  if (ob === 0) return 0;
  const nature = NOTE_NATURE[noteTypeOrFsCode] || FS_CODE_NATURE[noteTypeOrFsCode] || "CR";
  const side = String(openingType ?? "").trim().toUpperCase();
  if (side !== "DR" && side !== "CR") return nature === "CR" ? +ob : -ob;
  return side === nature ? +ob : -ob;
}

// ── Note total extraction from raw cy_data / py_data ──

/** Extract numeric values from a note's data blob, skipping meta keys. */
function extractNumerics(data) {
  if (!data || typeof data !== "object") return {};
  const nums = {};
  for (const [k, v] of Object.entries(data)) {
    if (META_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) nums[k] = v;
  }
  return nums;
}

/** Compute a simple sum of all numeric values in note data for Pattern B. */
function simpleNoteSumB(data) {
  if (!data || typeof data !== "object") return 0;
  const nums = extractNumerics(data);
  // To get the note grand total, we sum ALL numeric keys. However, this
  // double-counts because formula-total rows like "total", "pa_total" etc.
  // are already sums of leaf rows. For a more correct approach, we need the
  // actual note config. But as a reasonable approximation for drift analysis,
  // we'll just sum non-total keys.
  //
  // Actually, the simplest approach: look for keys that are clearly "total" rows
  // and skip them, summing only leaf rows. But this is fragile.
  //
  // Better approach: we'll compute the COA total from TB, and get the "Note Total"
  // from the note config's grand total formula. For now, let's just sum custom rows
  // sources + static row values, being careful about the structure.
  return Object.values(nums).reduce((s, v) => s + v, 0);
}

/**
 * For a Pattern A note, sum values with _lt or _st suffix.
 * Returns { lt: number, st: number }
 */
function sumPatternA(data) {
  if (!data || typeof data !== "object") return { lt: 0, st: 0 };
  const nums = extractNumerics(data);
  let lt = 0, st = 0;
  for (const [k, v] of Object.entries(nums)) {
    if (k.endsWith("_lt")) lt += v;
    else if (k.endsWith("_st")) st += v;
    // bare keys (no suffix) — legacy; skip to avoid double-count if _lt/_st exist
  }
  return { lt, st };
}

// ── Format helpers ──

function fmt(n) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function pad(s, len, align = "right") {
  s = String(s);
  if (align === "right") return s.padStart(len);
  return s.padEnd(len);
}

// ── Main analysis ──

async function analyseEngagement(eng) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`  ENGAGEMENT: ${eng.name}  (${eng.id})`);
  console.log(`${"=".repeat(80)}\n`);

  // 1. Load engagement
  const engRows = await sbGet("audit_engagements", {
    select: "coa_mapping,financial_year,client_id",
    id: `eq.${eng.id}`,
  });
  if (!engRows || engRows.length === 0) {
    console.log("  [ERROR] Engagement not found");
    return;
  }
  const engData = engRows[0];
  const coaMapping = engData.coa_mapping || {};
  const coaCount = Object.keys(coaMapping).length;
  console.log(`  COA mapping entries: ${coaCount}`);

  // 2. Load TB rows (paginated)
  const tbRows = await sbGetPaginated("tally_trial_balance", {
    select: "ledger_name,closing_balance,balance_type,opening_balance,opening_type,parent_group",
    engagement_id: `eq.${eng.id}`,
  });
  console.log(`  TB rows loaded: ${tbRows.length}`);

  // 3. Load nce_financial_notes
  const noteRows = await sbGet("nce_financial_notes", {
    select: "note_type,cy_data,py_data",
    engagement_id: `eq.${eng.id}`,
  });
  console.log(`  NCE notes loaded: ${noteRows.length}`);

  // Index notes by type
  const notesByType = {};
  for (const nr of noteRows) {
    notesByType[nr.note_type] = nr;
  }

  // 4. Build FS code -> ledgers mapping from COA
  //    For each ledger in coaMapping, get its FS code, then group by code.
  const codeLedgers = {}; // fsCode -> [{ ledger_name, closing_balance, balance_type, opening_balance, opening_type }]
  for (const row of tbRows) {
    const mapping = coaMapping[row.ledger_name];
    if (!mapping || !mapping.code) continue;
    const code = mapping.code;
    if (!codeLedgers[code]) codeLedgers[code] = [];
    codeLedgers[code].push(row);
  }

  // 5. For each FS code in NCE_CODE_TO_NOTE, compute COA total and compare with note total
  const results = [];

  for (const [fsCode, noteInfo] of Object.entries(NCE_CODE_TO_NOTE)) {
    const noteType = noteInfo.note;
    const col = noteInfo.col; // "lt" | "st" | undefined
    const configKey = noteInfo.config; // e.g. "cogs_a", "cogs_c"

    // Get note nature for sign convention
    const nature = NOTE_NATURE[noteType] || "CR";

    // ── COA CY total: sum signed closing_balance for all TB ledgers mapped to this FS code
    const ledgers = codeLedgers[fsCode] || [];
    let coaCy = 0;
    for (const row of ledgers) {
      coaCy += signedBalance(row.closing_balance, row.balance_type, noteType);
    }

    // ── COA PY total: sum signed opening_balance for same ledgers
    let coaPy = 0;
    for (const row of ledgers) {
      coaPy += signedOpening(row.opening_balance, row.opening_type, noteType);
    }

    // ── Note total from nce_financial_notes
    const noteRow = notesByType[noteType];
    let noteCy = null;
    let notePy = null;
    let noteMethod = "N/A (no note)";

    if (noteRow) {
      const cyData = noteRow.cy_data || {};
      const pyData = noteRow.py_data || {};
      const customRows = Array.isArray(cyData._custom_rows) ? cyData._custom_rows : [];

      // For Pattern A notes (borrowings, provisions, investments, loans_advances with col)
      // we need to sum the _lt or _st suffixed keys.
      // For Pattern B notes (everything else), we need to determine the grand total.

      // The most accurate way: replicate what getNCENoteFaceTotal does.
      // For simplicity, we compute:
      //   - For Pattern B (no col): sum all numeric keys (this IS the note's raw data sum,
      //     which includes formula-total keys — we'll note this caveat)
      //   - For Pattern A (with col): sum all keys ending in _lt or _st

      // BETTER APPROACH: For each FS code, the note stores individual ledger amounts
      // as either static-row keys or custom-row keys. The sum of all non-meta numeric
      // keys in cy_data IS the "raw stored total" — but it double-counts because
      // formula rows (like "total_secured", "grand_total") are persisted too.
      //
      // The CORRECT total is what computeNoteTotals returns. Since we can't run that
      // here (it needs the NoteConfig), we'll use a different approach:
      //
      // Sum ONLY the custom row amounts (from _custom_rows sources) + static row
      // amounts (numeric keys that are NOT formula/total keys).
      //
      // Actually, the simplest reliable method: the notes store per-ledger amounts
      // and the auto-populate writes these as individual keys. The "note total"
      // visible to the user is computed by the formula DAG from config. For this
      // drift analysis, what matters is whether ALL TB ledgers mapped to this FS code
      // are represented in the note. So COA total vs Note total comparison should work
      // even with raw sums, as long as we're consistent.
      //
      // Let's do it pragmatically: compute note total as the sum of amounts from
      // custom rows (sources) that belong to this note. For Pattern A, split by col.

      // Approach: sum all non-meta, non-total numeric keys. The auto-populate stores:
      //   - static row keys: e.g. "salaries", "pf", "gratuity"
      //   - custom row keys: e.g. "custom_loan_from_abc_0"
      // Both are numeric entries in cy_data. Formula rows like "total" are ALSO stored
      // but should be excluded.

      // Actually let's check: does the auto-populate actually persist formula-total
      // values in cy_data? Looking at the code, computeDisplayData does NOT persist
      // formula rows — only leaf rows are stored. The formula rows are computed on
      // the fly. So summing all numeric keys SHOULD give us the correct leaf total.
      //
      // BUT: Pattern A stores values with _lt/_st suffixes AND the bare key might
      // also exist. Need to handle that.

      if (col) {
        // Pattern A: sum all keys ending in _lt or _st
        const nums = extractNumerics(cyData);
        const numsP = extractNumerics(pyData);

        let sumLt = 0, sumSt = 0, sumLtP = 0, sumStP = 0;
        const seenBases = new Set();

        for (const [k, v] of Object.entries(nums)) {
          if (k.endsWith("_lt")) { sumLt += v; seenBases.add(k.slice(0, -3)); }
          else if (k.endsWith("_st")) { sumSt += v; seenBases.add(k.slice(0, -3)); }
        }
        // Bare keys that DON'T have _lt/_st siblings: add to lt (legacy)
        for (const [k, v] of Object.entries(nums)) {
          if (!k.endsWith("_lt") && !k.endsWith("_st") && !seenBases.has(k)) {
            sumLt += v; // legacy bare key → lt only
          }
        }

        for (const [k, v] of Object.entries(numsP)) {
          if (k.endsWith("_lt")) { sumLtP += v; }
          else if (k.endsWith("_st")) { sumStP += v; }
        }
        // Legacy bare PY keys
        const seenBasesP = new Set();
        for (const k of Object.keys(numsP)) {
          if (k.endsWith("_lt")) seenBasesP.add(k.slice(0, -3));
          else if (k.endsWith("_st")) seenBasesP.add(k.slice(0, -3));
        }
        for (const [k, v] of Object.entries(numsP)) {
          if (!k.endsWith("_lt") && !k.endsWith("_st") && !seenBasesP.has(k)) {
            sumLtP += v;
          }
        }

        if (col === "lt") {
          noteCy = sumLt;
          notePy = sumLtP;
        } else {
          noteCy = sumSt;
          notePy = sumStP;
        }
        noteMethod = `Pattern A (${col})`;
      } else if (configKey) {
        // COGS sub-sections: cogs_a (materials consumed), cogs_c (changes in inventories)
        // The cogs note stores all sub-sections in one row. We can't easily separate
        // the sub-totals without the config formula. Just report the total note sum.
        const nums = extractNumerics(cyData);
        const numsP = extractNumerics(pyData);
        noteCy = Object.values(nums).reduce((s, v) => s + v, 0);
        notePy = Object.values(numsP).reduce((s, v) => s + v, 0);
        noteMethod = `COGS combined (${configKey}) — see note`;
      } else {
        // Pattern B: sum all numeric keys
        const nums = extractNumerics(cyData);
        const numsP = extractNumerics(pyData);
        noteCy = Object.values(nums).reduce((s, v) => s + v, 0);
        notePy = Object.values(numsP).reduce((s, v) => s + v, 0);
        noteMethod = "Pattern B (sum all leaf keys)";
      }
    }

    const driftCy = noteCy !== null ? Math.round(coaCy - noteCy) : null;
    const driftPy = notePy !== null ? Math.round(coaPy - notePy) : null;
    const flagCy = driftCy !== null && Math.abs(driftCy) > 100;
    const flagPy = driftPy !== null && Math.abs(driftPy) > 100;

    results.push({
      fsCode,
      noteType,
      col: col || "-",
      ledgerCount: ledgers.length,
      coaCy: Math.round(coaCy),
      noteCy: noteCy !== null ? Math.round(noteCy) : null,
      driftCy,
      flagCy,
      coaPy: Math.round(coaPy),
      notePy: notePy !== null ? Math.round(notePy) : null,
      driftPy,
      flagPy,
      noteMethod,
    });
  }

  // ── Print results table ──
  const H = {
    fsCode: 14,
    noteType: 18,
    col: 4,
    lc: 4,
    amt: 14,
    flag: 2,
  };

  const hdr = [
    pad("FS Code", H.fsCode, "left"),
    pad("Note Type", H.noteType, "left"),
    pad("Col", H.col, "left"),
    pad("#Ldg", H.lc),
    pad("COA CY", H.amt),
    pad("Note CY", H.amt),
    pad("Drift CY", H.amt),
    pad("!", H.flag),
    pad("COA PY", H.amt),
    pad("Note PY", H.amt),
    pad("Drift PY", H.amt),
    pad("!", H.flag),
  ].join(" | ");

  const sep = "-".repeat(hdr.length);
  console.log(sep);
  console.log(hdr);
  console.log(sep);

  for (const r of results) {
    const row = [
      pad(r.fsCode, H.fsCode, "left"),
      pad(r.noteType, H.noteType, "left"),
      pad(r.col, H.col, "left"),
      pad(String(r.ledgerCount), H.lc),
      pad(fmt(r.coaCy), H.amt),
      pad(r.noteCy !== null ? fmt(r.noteCy) : "NO NOTE", H.amt),
      pad(r.driftCy !== null ? fmt(r.driftCy) : "-", H.amt),
      pad(r.flagCy ? "!!" : "", H.flag),
      pad(fmt(r.coaPy), H.amt),
      pad(r.notePy !== null ? fmt(r.notePy) : "NO NOTE", H.amt),
      pad(r.driftPy !== null ? fmt(r.driftPy) : "-", H.amt),
      pad(r.flagPy ? "!!" : "", H.flag),
    ].join(" | ");
    console.log(row);
  }
  console.log(sep);

  // ── Flagged drifts summary ──
  const flagged = results.filter(r => r.flagCy || r.flagPy);
  if (flagged.length === 0) {
    console.log("\n  [OK] No drift > Rs.100 detected.");
  } else {
    console.log(`\n  [ALERT] ${flagged.length} row(s) with |drift| > Rs.100:`);
    for (const r of flagged) {
      const parts = [];
      if (r.flagCy) parts.push(`CY drift=${fmt(r.driftCy)}`);
      if (r.flagPy) parts.push(`PY drift=${fmt(r.driftPy)}`);
      console.log(`    ${r.fsCode} (${r.noteType}${r.col !== "-" ? "/" + r.col : ""}): ${parts.join(", ")}`);
    }
  }

  // ── ADDITIONAL: Note-level totals (aggregate all FS codes per note) ──
  console.log(`\n  --- AGGREGATED BY NOTE TYPE ---`);
  const byNote = {};
  for (const r of results) {
    const key = r.noteType;
    if (!byNote[key]) byNote[key] = { coaCy: 0, noteCy: 0, coaPy: 0, notePy: 0, hasNote: false, fsCodes: [] };
    byNote[key].coaCy += r.coaCy;
    byNote[key].coaPy += r.coaPy;
    if (r.noteCy !== null) { byNote[key].noteCy += r.noteCy; byNote[key].hasNote = true; }
    if (r.notePy !== null) { byNote[key].notePy += r.notePy; }
    byNote[key].fsCodes.push(r.fsCode);
  }

  const hdr2 = [
    pad("Note Type", 20, "left"),
    pad("FS Codes", 30, "left"),
    pad("COA CY", H.amt),
    pad("Note CY", H.amt),
    pad("Drift CY", H.amt),
    pad("COA PY", H.amt),
    pad("Note PY", H.amt),
    pad("Drift PY", H.amt),
  ].join(" | ");
  const sep2 = "-".repeat(hdr2.length);
  console.log(sep2);
  console.log(hdr2);
  console.log(sep2);

  for (const [nt, d] of Object.entries(byNote)) {
    const dCy = d.hasNote ? Math.round(d.coaCy - d.noteCy) : null;
    const dPy = d.hasNote ? Math.round(d.coaPy - d.notePy) : null;
    const flag = (dCy !== null && Math.abs(dCy) > 100) || (dPy !== null && Math.abs(dPy) > 100);
    const row = [
      pad(nt, 20, "left"),
      pad(d.fsCodes.join("+"), 30, "left"),
      pad(fmt(d.coaCy), H.amt),
      pad(d.hasNote ? fmt(Math.round(d.noteCy)) : "NO NOTE", H.amt),
      pad(dCy !== null ? fmt(dCy) : "-", H.amt),
      pad(fmt(d.coaPy), H.amt),
      pad(d.hasNote ? fmt(Math.round(d.notePy)) : "NO NOTE", H.amt),
      pad(dPy !== null ? fmt(dPy) : "-", H.amt),
    ].join(" | ");
    console.log(`${flag ? ">> " : "   "}${row}`);
  }
  console.log(sep2);

  // ── COA UNMAPPED ANALYSIS: ledgers mapped to codes NOT in NCE_CODE_TO_NOTE ──
  const knownCodes = new Set(Object.keys(NCE_CODE_TO_NOTE));
  const unmappedCodes = {};
  for (const [ledger, mapping] of Object.entries(coaMapping)) {
    if (!mapping || !mapping.code) continue;
    if (!knownCodes.has(mapping.code) && mapping.code.startsWith("NCE_")) {
      if (!unmappedCodes[mapping.code]) unmappedCodes[mapping.code] = [];
      unmappedCodes[mapping.code].push(ledger);
    }
  }
  if (Object.keys(unmappedCodes).length > 0) {
    console.log(`\n  --- NCE CODES NOT IN NCE_CODE_TO_NOTE (no note linkage) ---`);
    for (const [code, ledgers] of Object.entries(unmappedCodes)) {
      // compute total for these
      const rows = codeLedgers[code] || [];
      const total = rows.reduce((s, r) => s + Math.abs(r.closing_balance || 0), 0);
      console.log(`    ${code}: ${ledgers.length} ledger(s), abs total=${fmt(total)}`);
      for (const l of ledgers.slice(0, 5)) {
        const tbRow = tbRows.find(r => r.ledger_name === l);
        console.log(`      - "${l}" (${tbRow ? fmt(Math.abs(tbRow.closing_balance || 0)) : "not in TB"})`);
      }
      if (ledgers.length > 5) console.log(`      ... and ${ledgers.length - 5} more`);
    }
  }

  return results;
}

// ── Main ──

async function main() {
  console.log("COA vs Notes Drift Analysis");
  console.log("===========================\n");
  console.log("Sign convention: uses fsSignConvention rules (Dr-natural heads show +ve for Dr balances)");
  console.log("COA CY = signed sum of TB closing_balance for ledgers mapped to FS code");
  console.log("COA PY = signed sum of TB opening_balance for same ledgers");
  console.log("Note CY/PY = sum of all numeric leaf keys in note cy_data/py_data");
  console.log("Drift = COA total - Note total (positive = COA has more)");
  console.log("Flag !! when |drift| > Rs.100\n");
  console.log("CAVEAT for COGS: NCE_COGS and NCE_CII both map to the 'cogs' note.");
  console.log("  The note stores all sub-sections together. The 'Note CY/PY' column");
  console.log("  shows the FULL cogs note sum, NOT the sub-section. Compare the");
  console.log("  AGGREGATED BY NOTE TYPE section for the combined COGS total.\n");
  console.log("CAVEAT for Pattern A: COA total is per-FS-code (e.g. NCE_LTB for LT borrowings).");
  console.log("  Note total is sum of all _lt or _st suffixed keys. These should match if the");
  console.log("  note is correctly auto-populated from TB.\n");

  const allResults = {};
  for (const eng of ENGAGEMENTS) {
    allResults[eng.name] = await analyseEngagement(eng);
  }

  // ── Cross-engagement summary ──
  console.log(`\n\n${"=".repeat(80)}`);
  console.log("  CROSS-ENGAGEMENT DRIFT SUMMARY");
  console.log(`${"=".repeat(80)}\n`);

  for (const eng of ENGAGEMENTS) {
    const results = allResults[eng.name];
    if (!results) continue;
    const flagged = results.filter(r => r.flagCy || r.flagPy);
    if (flagged.length === 0) {
      console.log(`  ${eng.name}: ALL CLEAR — no drift > Rs.100`);
    } else {
      console.log(`  ${eng.name}: ${flagged.length} DRIFTING row(s):`);
      for (const r of flagged) {
        const parts = [];
        if (r.flagCy) parts.push(`CY: COA=${fmt(r.coaCy)} Note=${fmt(r.noteCy)} drift=${fmt(r.driftCy)}`);
        if (r.flagPy) parts.push(`PY: COA=${fmt(r.coaPy)} Note=${fmt(r.notePy)} drift=${fmt(r.driftPy)}`);
        console.log(`    ${r.fsCode} → ${r.noteType}${r.col !== "-" ? "/" + r.col : ""}: ${parts.join(" | ")}`);
      }
    }
    console.log();
  }
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
