// NCE Notes vs COA drift sweep — finds every (engagement, note_type) drift cell.
// Usage: node nce_drift_sweep.mjs  → prints JSON to drift_report.json + console summary.
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const url = process.env.SUPABASE_URL || "https://ahzkkqpiwwpoexcoyzbz.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("Set SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

// Mirror src/lib/nceAutoPopulate.ts NCE_CODE_TO_NOTE
const CODE_TO_NOTE = {
  NCE_LTB: "borrowings",     NCE_STB: "borrowings",
  NCE_OLTL: "other_lt_liab",
  NCE_LTP: "provisions",     NCE_STP: "provisions",
  NCE_TP: "trade_payables",
  NCE_OCL: "other_cl",
  NCE_CWIP: "cwip",
  NCE_NCINV: "investments",  NCE_CINV: "investments",
  NCE_LTLA: "loans_advances", NCE_STLA: "loans_advances",
  NCE_ONCA: "other_nc_assets",
  NCE_STCK: "inventories",
  NCE_TR: "trade_receivables",
  NCE_CASH: "cash_bank",
  NCE_OCA: "other_ca",
  NCE_REV_OPS: "revenue_ops",
  NCE_REV_OTH: "other_income",
  NCE_COGS: "cogs", NCE_CII: "cogs",
  NCE_EMP_EXP: "employee_exp",
  NCE_FIN_COST: "finance_costs",
  NCE_OTH_EXP: "other_expenses",
};
// Mirror src/lib/fsSignConvention.ts FS_CODE_NATURE
const NATURE = {
  NCE_LTB:"CR",NCE_STB:"CR",NCE_OLTL:"CR",NCE_LTP:"CR",NCE_STP:"CR",NCE_TP:"CR",NCE_OCL:"CR",
  NCE_CWIP:"DR",NCE_NCINV:"DR",NCE_CINV:"DR",NCE_LTLA:"DR",NCE_STLA:"DR",NCE_ONCA:"DR",
  NCE_STCK:"DR",NCE_TR:"DR",NCE_CASH:"DR",NCE_OCA:"DR",
  NCE_REV_OPS:"CR",NCE_REV_OTH:"CR",
  NCE_COGS:"DR",NCE_CII:"DR",NCE_EMP_EXP:"DR",NCE_FIN_COST:"DR",NCE_OTH_EXP:"DR",
};
const NCE_ENTITY_TYPES = ["Partnership","Individual","HUF","AOP","Trust","LLP","Proprietorship"];
const META_KEYS = new Set(["_custom_rows","_cy_sources","_user_overrides","_attached","_audit_log","_pl_safety_guard_ran","_notesMismatchSinceLastSync"]);
const META_PREFIX = "!_";

function noteSum(jsonbObj) {
  if (!jsonbObj || typeof jsonbObj !== "object") return 0;
  let s = 0;
  for (const [k, v] of Object.entries(jsonbObj)) {
    if (META_KEYS.has(k)) continue;
    if (k.startsWith("_")) continue;
    if (typeof v === "number" && Number.isFinite(v)) s += v;
    else if (typeof v === "string" && /^-?\d/.test(v)) s += Number(v);
  }
  return Math.round(s * 100) / 100;
}

const sign = (amt, type, nature) => {
  const a = Math.abs(Number(amt ?? 0));
  if (a === 0) return 0;
  const side = String(type ?? "").toUpperCase().trim();
  if (side !== "DR" && side !== "CR") return nature === "CR" ? +a : -a;
  return side === nature ? +a : -a;
};

async function fetchAll(table, select, filters) {
  const rows = [];
  let from = 0, page = 1000;
  while (true) {
    let q = sb.from(table).select(select).range(from, from + page - 1);
    if (filters) q = filters(q);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

async function main() {
  console.log("Loading NCE engagements...");
  const { data: clients, error: cerr } = await sb.from("clients").select("id,name,entity_type").in("entity_type", NCE_ENTITY_TYPES);
  if (cerr) throw cerr;
  const nceClientIds = new Set(clients.map(c => c.id));
  const clientById = Object.fromEntries(clients.map(c => [c.id, c]));

  const engs = await fetchAll("audit_engagements", "id,client_id,financial_year,coa_mapping");
  const nceEngs = engs.filter(e => nceClientIds.has(e.client_id) && e.financial_year === "2025-26");
  console.log(`Found ${nceEngs.length} NCE engagements FY 2025-26`);

  // Build prior-FY lookup: 2024-25 audit_engagements per client.
  const prevByClient = {};
  for (const e of engs) if (e.financial_year === "2024-25") prevByClient[e.client_id] = e;

  const allNotes = await fetchAll("nce_financial_notes", "engagement_id,note_type,cy_data,py_data");
  const notesByEng = {};
  for (const n of allNotes) (notesByEng[n.engagement_id] ||= []).push(n);

  const driftCells = [];

  for (const eng of nceEngs) {
    const clientName = clientById[eng.client_id]?.name ?? "?";
    const coa = eng.coa_mapping ?? {};
    const prev = prevByClient[eng.client_id];

    // Build code → ledger names map for this engagement
    const codeToLedgers = {};
    for (const [ledgerName, info] of Object.entries(coa)) {
      const code = info?.code;
      if (!CODE_TO_NOTE[code]) continue;
      (codeToLedgers[code] ||= []).push(ledgerName);
    }
    const usedCodes = Object.keys(codeToLedgers);
    if (usedCodes.length === 0) continue;

    // Fetch tally_ledgers for CY + PY engagement once
    const allLedgerNames = [...new Set(Object.values(codeToLedgers).flat().map(s => s.toLowerCase()))];
    if (allLedgerNames.length === 0) continue;

    const tbCy = await fetchAll("tally_ledgers", "ledger_name,closing_balance,closing_type",
      q => q.eq("engagement_id", eng.id));
    const tbPy = prev ? await fetchAll("tally_ledgers", "ledger_name,closing_balance,closing_type",
      q => q.eq("engagement_id", prev.id)) : [];

    const cyMap = {}, pyMap = {};
    for (const r of tbCy) cyMap[String(r.ledger_name).toLowerCase()] = r;
    for (const r of tbPy) pyMap[String(r.ledger_name).toLowerCase()] = r;

    // Build COA totals per noteType
    const coaCyByNote = {}, coaPyByNote = {};
    for (const [code, ledgers] of Object.entries(codeToLedgers)) {
      const note = CODE_TO_NOTE[code];
      const nature = NATURE[code];
      let cy = 0, py = 0;
      for (const lname of ledgers) {
        const lk = lname.toLowerCase();
        const c = cyMap[lk]; if (c) cy += sign(c.closing_balance, c.closing_type, nature);
        const p = pyMap[lk]; if (p) py += sign(p.closing_balance, p.closing_type, nature);
      }
      coaCyByNote[note] = (coaCyByNote[note] || 0) + cy;
      coaPyByNote[note] = (coaPyByNote[note] || 0) + py;
    }

    const noteRows = notesByEng[eng.id] ?? [];
    const noteByType = Object.fromEntries(noteRows.map(n => [n.note_type, n]));

    const allNoteTypes = new Set([...Object.keys(coaCyByNote), ...Object.keys(coaPyByNote), ...noteRows.map(n => n.note_type)]);
    for (const nt of allNoteTypes) {
      const coaCy = Math.round((coaCyByNote[nt] || 0) * 100) / 100;
      const coaPy = Math.round((coaPyByNote[nt] || 0) * 100) / 100;
      const noteRow = noteByType[nt];
      const noteCy = noteRow ? noteSum(noteRow.cy_data) : 0;
      const notePy = noteRow ? noteSum(noteRow.py_data) : 0;
      const driftCy = Math.round((coaCy - noteCy) * 100) / 100;
      const driftPy = Math.round((coaPy - notePy) * 100) / 100;
      if (Math.abs(driftCy) > 1 || Math.abs(driftPy) > 1) {
        driftCells.push({
          engagement_id: eng.id, client: clientName, note_type: nt,
          coa_cy: coaCy, note_cy: noteCy, drift_cy: driftCy,
          coa_py: coaPy, note_py: notePy, drift_py: driftPy,
        });
      }
    }
    process.stdout.write(".");
  }
  console.log("");

  console.log(`\n=== DRIFT CELLS: ${driftCells.length} ===`);
  driftCells.sort((a,b) => (Math.abs(b.drift_cy)+Math.abs(b.drift_py)) - (Math.abs(a.drift_cy)+Math.abs(a.drift_py)));
  for (const c of driftCells.slice(0, 50)) {
    console.log(`${c.client.padEnd(34)} | ${c.note_type.padEnd(20)} | CY drift=${String(c.drift_cy).padStart(15)} | PY drift=${String(c.drift_py).padStart(15)}`);
  }
  fs.writeFileSync("drift_report.json", JSON.stringify(driftCells, null, 2));
  console.log(`\nWrote drift_report.json (${driftCells.length} cells)`);
}

main().catch(e => { console.error(e); process.exit(1); });
