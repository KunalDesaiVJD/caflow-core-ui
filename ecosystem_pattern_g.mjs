/**
 * ecosystem_pattern_g.mjs — Pattern G fixer: synthesize TB-derived customRows
 * for notes that are missing COA-mapped ledgers.
 *
 * Uses the cache from ecosystem_fix.mjs. Run AFTER ecosystem_fix.mjs.
 *
 * Strategy:
 *   For each drifted cell where note has unrepresented TB ledgers:
 *     - For each unrepresented ledger, add a customRow to _custom_rows
 *       with id=`custom_g_<slug>_<i>`, label=ledger name, source="auto",
 *       tbDerived=true
 *     - Add the signed amount to cy_data[id] and py_data[id]
 *     - Add to _cy_sources[id] with the ledger reference
 *
 *   This is a safer Pattern G than "add to catch-all" because it preserves
 *   per-ledger traceability and mirrors what nceAutoPopulate would do in UI.
 *
 *   Skip (eng × note) if the existing note has any data already > 0
 *   AND COA == note total (i.e. no drift). Only fire when note is empty
 *   OR missing a clearly-identifiable set of ledgers totalling > ₹1.
 *
 * Constraints:
 *   - Skip cogs (structural).
 *   - Skip capital/PPE/intangibles (per scope).
 *   - For each fix, validate that adding the rows reduces |drift| in
 *     simulation. If drift would worsen, skip.
 */

import { execSync } from "child_process";
import { writeFileSync, appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const LOG = join(process.cwd(), "ecosystem_pattern_g.log");
try { writeFileSync(LOG, ""); } catch {}
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG, line); } catch {}
}

const CACHE_PATH = join(process.cwd(), "_ecosys_cache.json");
if (!existsSync(CACHE_PATH)) {
  log("ERROR: cache not found. Run ecosystem_fix.mjs first.");
  process.exit(1);
}
const cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
log(`Loaded cache: ${cache.engagements.length} engagements, ${cache.driftKeys.length} drift keys`);

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => n == null ? "-" : Number(n).toLocaleString("en-IN",{maximumFractionDigits:0});
const norm = (s) => String(s||"").toLowerCase().replace(/[^a-z0-9]/g, "");

function asObj(v) {
  if (v == null) return {};
  if (typeof v === "string") { try { return JSON.parse(v)||{}; } catch { return {}; } }
  return typeof v === "object" ? v : {};
}
function sumKeys(obj) {
  let s = 0;
  for (const [k,v] of Object.entries(obj)) {
    if (k.startsWith("_")) continue;
    const n = typeof v === "number" ? v : (typeof v==="string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
    if (n !== null) s += n;
  }
  return r2(s);
}

const NOTE_DEFS_BY_KEY = {
  borrowings:{nature:"CR",section:"BS-Liab"}, other_lt_liab:{nature:"CR",section:"BS-Liab"},
  provisions:{nature:"CR",section:"BS-Liab"}, trade_payables:{nature:"CR",section:"BS-Liab"},
  other_cl:{nature:"CR",section:"BS-Liab"}, investments:{nature:"DR",section:"BS-Asst"},
  loans_advances:{nature:"DR",section:"BS-Asst"}, other_nc_assets:{nature:"DR",section:"BS-Asst"},
  inventories:{nature:"DR",section:"BS-Asst"}, trade_receivables:{nature:"DR",section:"BS-Asst"},
  cash_bank:{nature:"DR",section:"BS-Asst"}, other_ca:{nature:"DR",section:"BS-Asst"},
  revenue_ops:{nature:"CR",section:"PL-Inc"}, other_income:{nature:"CR",section:"PL-Inc"},
  employee_exp:{nature:"DR",section:"PL-Exp"}, finance_costs:{nature:"DR",section:"PL-Exp"},
  other_expenses:{nature:"DR",section:"PL-Exp"},
};

const noteIndex = {};
for (const r of cache.noteRows) (noteIndex[r.note_type] ??= {})[r.engagement_id] = r;
const engById = {};
for (const e of cache.engagements) engById[e.id] = e;

const tmpSqlPath = join(process.cwd(), "_ecosys_pg_patch.sql");

const events = [];
let cellsTouched = 0;

for (const driftKey of cache.driftKeys) {
  const [engId, noteType] = driftKey.split("__");
  const eng = engById[engId];
  if (!eng) continue;
  const def = NOTE_DEFS_BY_KEY[noteType];
  if (!def) continue;

  const noteRow = (noteIndex[noteType]||{})[engId];
  if (!noteRow) continue;

  const cy = asObj(noteRow.cy_data);
  const py = asObj(noteRow.py_data);
  const customRows = Array.isArray(cy._custom_rows) ? cy._custom_rows : [];

  const detail = cache.ledgerDetail[driftKey];
  if (!detail) continue;

  // Determine which TB ledgers are NOT represented in the note
  const representedNorms = new Set();
  for (const cr of customRows) representedNorms.add(norm(cr.label));
  const srcObj = asObj(cy._cy_sources);
  for (const arr of Object.values(srcObj))
    if (Array.isArray(arr)) for (const s of arr) if (s?.ledger) representedNorms.add(norm(s.ledger));
  // Also represented: static row labels (we can't see them but if a key value is non-zero, it's covered)

  const missingCy = detail.cy.filter(l => l.amt !== 0 && !representedNorms.has(norm(l.ledger)));
  const missingPy = detail.py.filter(l => l.amt !== 0 && !representedNorms.has(norm(l.ledger)));

  // Build a deduped union of missing ledgers (CY ∪ PY)
  const ledgerByName = new Map();
  for (const l of missingCy) ledgerByName.set(norm(l.ledger), { name: l.ledger, cy: l.amt, py: 0 });
  for (const l of missingPy) {
    const k = norm(l.ledger);
    if (ledgerByName.has(k)) ledgerByName.get(k).py = l.amt;
    else ledgerByName.set(k, { name: l.ledger, cy: 0, py: l.amt });
  }

  if (ledgerByName.size === 0) continue;

  // Compute current vs simulated drift
  const coaCyVal = cache.coaCy[noteType]?.[engId] ?? 0;
  const coaPyVal = def.section.startsWith("PL")
    ? (eng._shellId ? (cache.coaPy[noteType]?.[engId] ?? 0) : null)
    : (cache.coaPy[noteType]?.[engId] ?? 0);

  const currentNoteCy = sumKeys(cy);
  const currentNotePy = sumKeys(py);
  const currentCyDrift = r2(coaCyVal - currentNoteCy);
  const currentPyDrift = coaPyVal === null ? null : r2(coaPyVal - currentNotePy);

  // Synthesize new customRows
  const slug = (s) => String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,40);
  const newRows = [...customRows];
  const newCy = { ...cy };
  const newPy = { ...py };
  const newSources = asObj(cy._cy_sources);
  let i = customRows.length;
  const addedRows = [];

  for (const [normLedger, info] of ledgerByName) {
    const rowId = `custom_g_${slug(info.name)}_${i}`;
    i++;
    newRows.push({
      id: rowId, label: info.name, source: "auto", tbDerived: true,
    });
    newCy[rowId] = info.cy;
    newPy[rowId] = info.py;
    // record source for traceability
    newSources[rowId] = [{ ledger: info.name, amountCy: info.cy, amountPy: info.py }];
    addedRows.push({ rowId, name: info.name, cy: info.cy, py: info.py });
  }
  newCy._custom_rows = newRows;
  newCy._cy_sources = newSources;

  const newNoteCy = sumKeys(newCy);
  const newNotePy = sumKeys(newPy);
  const newCyDrift = r2(coaCyVal - newNoteCy);
  const newPyDrift = coaPyVal === null ? null : r2(coaPyVal - newNotePy);

  // Skip if drift would worsen
  const cyImproved = Math.abs(newCyDrift) <= Math.abs(currentCyDrift) + 0.5;
  const pyImproved = coaPyVal === null || Math.abs(newPyDrift) <= Math.abs(currentPyDrift) + 0.5;
  if (!cyImproved || !pyImproved) {
    log(`  ✗ skip ${eng.client_name}/${noteType}: would worsen (cy ${fmt(currentCyDrift)}→${fmt(newCyDrift)}; py ${fmt(currentPyDrift)}→${fmt(newPyDrift)})`);
    continue;
  }
  // Skip if no meaningful improvement
  if (Math.abs(currentCyDrift) < 1 && (currentPyDrift == null || Math.abs(currentPyDrift) < 1)) continue;

  // Build patch SQL
  const cyPatchObj = {};
  for (const [k,v] of Object.entries(newCy)) cyPatchObj[k] = v;
  const pyPatchObj = {};
  for (const [k,v] of Object.entries(newPy)) pyPatchObj[k] = v;
  const cyJsonLit = JSON.stringify(cyPatchObj).replace(/'/g, "''");
  const pyJsonLit = JSON.stringify(pyPatchObj).replace(/'/g, "''");
  const sql = `UPDATE nce_financial_notes SET cy_data = '${cyJsonLit}'::jsonb, py_data = '${pyJsonLit}'::jsonb WHERE engagement_id='${engId}' AND note_type='${noteType}' RETURNING engagement_id;`;

  try {
    writeFileSync(tmpSqlPath, sql, "utf-8");
    const out = execSync(`npx supabase db query --linked -f "${tmpSqlPath}"`, {
      encoding: "utf-8", maxBuffer: 200*1024*1024, timeout: 60000,
      stdio: ["ignore","pipe","pipe"],
    });
    const idx = out.indexOf("{");
    const parsed = JSON.parse(out.slice(idx));
    if ((parsed.rows||[]).length) {
      cellsTouched++;
      log(`  ✓ ${eng.client_name}/${noteType}: +${addedRows.length} ledger rows; drift ${fmt(currentCyDrift)}→${fmt(newCyDrift)} (cy), ${fmt(currentPyDrift)}→${fmt(newPyDrift)} (py)`);
      for (const r of addedRows) {
        events.push({
          client: eng.client_name, fy: eng.financial_year, note: noteType,
          pattern: "G", action: "add_ledger_row", key: r.rowId,
          label: r.name, cy: r.cy, py: r.py,
        });
      }
    }
  } catch (e) {
    log(`  ✗ FAIL ${eng.client_name}/${noteType}: ${String(e.message||e).slice(0,300)}`);
  }
}

try { execSync(`rm -f "${tmpSqlPath}"`); } catch {}
log(`\nPattern G complete: ${cellsTouched} cells touched, ${events.length} ledger rows added`);

writeFileSync(join(process.cwd(),"pattern_g_events.json"), JSON.stringify(events,null,2));
log(`Events saved to pattern_g_events.json`);
