/**
 * quick_drift_check.mjs — use cached COA + fresh note data only, to quickly
 * compute current drift without re-running full COA recomputation.
 */
import { execSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

const cache = JSON.parse(readFileSync(join(process.cwd(),"_ecosys_cache.json"),"utf-8"));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => n == null ? "-" : Number(n).toLocaleString("en-IN",{maximumFractionDigits:0});

function dbQuery(sql) {
  const tmp = join(process.cwd(),"_qdc_q.sql");
  writeFileSync(tmp, sql, "utf-8");
  const raw = execSync(`npx supabase db query --linked -f "${tmp}"`, { encoding:"utf-8", maxBuffer:200*1024*1024, timeout:120_000, stdio:["ignore","pipe","pipe"] });
  const i = raw.indexOf("{");
  return JSON.parse(raw.slice(i)).rows ?? [];
}

const NOTE_KEYS = ["borrowings","other_lt_liab","provisions","trade_payables","other_cl","investments","loans_advances","other_nc_assets","inventories","trade_receivables","cash_bank","other_ca","revenue_ops","other_income","employee_exp","finance_costs","other_expenses"];
const noteRows = dbQuery(`SELECT engagement_id, note_type, cy_data, py_data FROM nce_financial_notes WHERE note_type IN (${NOTE_KEYS.map(k=>`'${k}'`).join(",")});`);
const noteIndex = {};
for (const r of noteRows) (noteIndex[r.note_type] ??= {})[r.engagement_id] = r;

function asObj(v) { if (v==null) return {}; if (typeof v==="string") { try { return JSON.parse(v)||{}; } catch { return {}; } } return typeof v==="object"?v:{}; }
function sumKeys(obj) { let s=0; for (const [k,v] of Object.entries(obj)) { if (k.startsWith("_")) continue; const n = typeof v==="number"?v:(typeof v==="string"&&/^-?\d+(\.\d+)?$/.test(v.trim())?Number(v):null); if (n!==null) s += n; } return r2(s); }

const NOTE_SEC = {
  borrowings:"BS-Liab", other_lt_liab:"BS-Liab", provisions:"BS-Liab", trade_payables:"BS-Liab", other_cl:"BS-Liab",
  investments:"BS-Asst", loans_advances:"BS-Asst", other_nc_assets:"BS-Asst", inventories:"BS-Asst", trade_receivables:"BS-Asst", cash_bank:"BS-Asst", other_ca:"BS-Asst",
  revenue_ops:"PL-Inc", other_income:"PL-Inc",
  employee_exp:"PL-Exp", finance_costs:"PL-Exp", other_expenses:"PL-Exp",
};
const isPL = (s) => s.startsWith("PL");

const drifts = [];
for (const eng of cache.engagements) {
  for (const noteType of NOTE_KEYS) {
    const sec = NOTE_SEC[noteType];
    const row = (noteIndex[noteType]||{})[eng.id];
    const cy = asObj(row?.cy_data);
    const py = asObj(row?.py_data);
    const noteCy = sumKeys(cy);
    const notePy = sumKeys(py);
    const coaCy = cache.coaCy[noteType]?.[eng.id] ?? 0;
    const coaPy = isPL(sec) ? (eng._shellId ? (cache.coaPy[noteType]?.[eng.id] ?? 0) : null) : (cache.coaPy[noteType]?.[eng.id] ?? 0);
    const cyDrift = r2(coaCy - noteCy);
    const pyDrift = coaPy === null ? null : r2(coaPy - notePy);
    if (Math.abs(cyDrift) > 1 || (pyDrift !== null && Math.abs(pyDrift) > 1)) {
      drifts.push({ client: eng.client_name, note: noteType, section: sec, coaCy, noteCy, cyDrift, coaPy, notePy, pyDrift });
    }
  }
}

console.log(`Drifted cells: ${drifts.length}`);
for (const d of drifts) {
  console.log(`  ${d.client.padEnd(38)} / ${d.note.padEnd(18)}: cy=${fmt(d.cyDrift).padStart(15)} py=${fmt(d.pyDrift).padStart(15)}`);
}
writeFileSync(join(process.cwd(),"current_drift.json"), JSON.stringify(drifts,null,2));
