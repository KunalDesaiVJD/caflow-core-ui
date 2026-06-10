/**
 * diag_oth_exp.mjs — READ-ONLY diagnostic: Other Expenses note vs COA mapping
 * for EVERY active (non-PY-shell) NCE engagement — BOTH CY and PY.
 *
 * Data access: `npx supabase db query --linked` (SELECT only — no writes anywhere).
 * COA sums are computed server-side with SQL aggregates (no pagination issues).
 *
 * Sign convention (Dr-natural expense head):
 *   DR  -> +abs(closing_balance)
 *   CR  -> -abs(closing_balance)
 *   missing/other -> -abs(closing_balance)
 *
 * PY logic: CY TB opening balances are 0 for P&L ledgers, so COA PY comes from
 * the PY SHELL engagement's TB closing balances, classified with the CY
 * engagement's coa_mapping (fallback: PY shell's own mapping).
 */

import { execSync } from "child_process";

const CODES = "('NCE_OTH_EXP','PL_EXP_OTH','PL_EXP_OEX')";
const NOTE_TYPE = "other_expenses";
const DRIFT_TOL = 1; // rupees

// ─── DB helper (READ-ONLY) ───────────────────────────────────────────────────

function dbQuery(sql) {
  const clean = sql.replace(/\s+/g, " ").trim();
  if (!/^select\b/i.test(clean)) {
    throw new Error("SAFETY: refusing non-SELECT statement: " + clean.slice(0, 80));
  }
  if (clean.includes('"') || clean.includes("%")) {
    throw new Error("SAFETY: SQL contains a character unsafe for cmd quoting: " + clean.slice(0, 80));
  }
  const raw = execSync(`npx supabase db query --linked "${clean}"`, {
    encoding: "utf-8",
    maxBuffer: 200 * 1024 * 1024,
    timeout: 180_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) throw new Error("No JSON in db query output: " + raw.slice(0, 300));
  const parsed = JSON.parse(raw.slice(jsonStart));
  return parsed.rows ?? [];
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) =>
  n === null || n === undefined
    ? "n/a"
    : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// ─── Step 1: active engagements + PY shells ──────────────────────────────────

console.log("=== Step 1: active engagements & PY shells ===");

const engagements = dbQuery(`
  SELECT e.id, e.client_id, e.financial_year, c.name as client_name
  FROM audit_engagements e JOIN clients c ON c.id = e.client_id
  WHERE e.is_py_shell = false
    AND e.coa_mapping IS NOT NULL
    AND jsonb_typeof(e.coa_mapping) = 'object'
    AND e.coa_mapping::text != '{}'
  ORDER BY c.name, e.financial_year
`);
console.log(`  Active engagements with COA mapping: ${engagements.length}`);

const shells = dbQuery(`
  SELECT e.id, e.client_id, e.financial_year,
         (e.coa_mapping IS NOT NULL AND jsonb_typeof(e.coa_mapping)='object'
          AND e.coa_mapping::text != '{}') as has_map
  FROM audit_engagements e
  WHERE e.is_py_shell = true
`);
console.log(`  PY shells: ${shells.length}`);

const shellsByClient = {};
for (const s of shells) (shellsByClient[s.client_id] ??= []).push(s);

function pyFyOf(fy) {
  const m = String(fy || "").match(/(\d{4})\s*-\s*(\d{2,4})/);
  if (!m) return null;
  const a = parseInt(m[1], 10) - 1;
  const bLen = m[2].length;
  const b = parseInt(m[2], 10) - 1;
  return `${a}-${String(b).padStart(bLen, "0")}`;
}

function findShell(eng) {
  const list = shellsByClient[eng.client_id] || [];
  if (list.length === 0) return null;
  const want = pyFyOf(eng.financial_year);
  const exact = list.find((s) => String(s.financial_year).replace(/\s/g, "") === want);
  if (exact) return exact;
  if (list.length === 1) return list[0];
  return null; // ambiguous
}

// ─── Step 2: COA CY (one aggregate query for all engagements) ────────────────

console.log("\n=== Step 2: COA CY / COA PY (server-side aggregates) ===");

const coaCyRows = dbQuery(`
  SELECT e.id,
    round(sum(CASE WHEN upper(t.balance_type)='DR' THEN abs(t.closing_balance)
                   ELSE -abs(t.closing_balance) END)::numeric, 2) as coa
  FROM audit_engagements e
  JOIN tally_trial_balance t ON t.engagement_id = e.id
  WHERE e.is_py_shell = false
    AND jsonb_typeof(e.coa_mapping) = 'object'
    AND (e.coa_mapping->t.ledger_name->>'code') IN ${CODES}
  GROUP BY e.id
`);
const coaCyById = Object.fromEntries(coaCyRows.map((r) => [r.id, Number(r.coa)]));
console.log(`  COA CY computed for ${coaCyRows.length} engagements`);

// COA PY: pair each CY engagement with its PY shell, batch VALUES join.
const pairs = [];
for (const eng of engagements) {
  const sh = findShell(eng);
  eng._shell = sh;
  if (sh) pairs.push([eng.id, sh.id]);
}
const coaPyById = {};
const CHUNK = 15;
for (let i = 0; i < pairs.length; i += CHUNK) {
  const vals = pairs
    .slice(i, i + CHUNK)
    .map(([c, p]) => `('${c}'::uuid,'${p}'::uuid)`)
    .join(",");
  const rows = dbQuery(`
    SELECT p.cy_id,
      round(sum(CASE WHEN upper(t.balance_type)='DR' THEN abs(t.closing_balance)
                     ELSE -abs(t.closing_balance) END)::numeric, 2) as coa
    FROM (VALUES ${vals}) p(cy_id, py_id)
    JOIN audit_engagements cy ON cy.id = p.cy_id
    JOIN audit_engagements py ON py.id = p.py_id
    JOIN tally_trial_balance t ON t.engagement_id = p.py_id
    WHERE coalesce(cy.coa_mapping->t.ledger_name->>'code',
                   py.coa_mapping->t.ledger_name->>'code') IN ${CODES}
    GROUP BY p.cy_id
  `);
  for (const r of rows) coaPyById[r.cy_id] = Number(r.coa);
}
console.log(`  COA PY computed for ${Object.keys(coaPyById).length} engagements (with PY shell TB data)`);

// ─── Step 3: fetch ALL other_expenses notes in full (one query) ──────────────

console.log("\n=== Step 3: fetching other_expenses notes ===");

const noteRows = dbQuery(`
  SELECT engagement_id, cy_data, py_data
  FROM nce_financial_notes
  WHERE note_type = '${NOTE_TYPE}'
`);
const noteById = Object.fromEntries(noteRows.map((r) => [r.engagement_id, r]));
console.log(`  Notes found: ${noteRows.length}`);

function asObj(v) {
  if (v == null) return {};
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return typeof v === "object" ? v : {};
}

/** Raw key sum (matches the SQL jsonb_each_text approach) + caveat info. */
function noteTotals(note) {
  const cy = asObj(note.cy_data);
  const py = asObj(note.py_data);
  const customRows = Array.isArray(cy._custom_rows) ? cy._custom_rows : [];
  const attached = customRows.filter((c) => c.attachedTo);

  const sumKeys = (obj) => {
    let s = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("_")) continue;
      const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null;
      if (n !== null) s += n;
    }
    return r2(s);
  };

  // double-count adjustment: child custom rows attached to a parent whose own
  // key also carries a value get counted twice in the raw key sum
  const dblAdj = (obj) => {
    let adj = 0;
    for (const c of attached) {
      const childVal = Number(obj[c.id]) || 0;
      const parentVal = Number(obj[c.attachedTo]) || 0;
      if (childVal !== 0 && parentVal !== 0) adj += childVal;
    }
    return r2(adj);
  };

  return {
    noteCy: sumKeys(cy),
    notePy: sumKeys(py),
    cyDoubleCount: dblAdj(cy),
    pyDoubleCount: dblAdj(py),
    attachedCount: attached.length,
    cyData: cy,
    pyData: py,
    customRows,
  };
}

// ─── Step 4: per-engagement comparison ───────────────────────────────────────

const results = [];
for (const eng of engagements) {
  const note = noteById[eng.id];
  const nt = note ? noteTotals(note) : null;
  const coaCy = coaCyById[eng.id] ?? 0;
  const coaPy = eng._shell ? coaPyById[eng.id] ?? 0 : null;
  const r = {
    eng,
    client: eng.client_name,
    fy: eng.financial_year,
    coaCy,
    coaPy,
    noteCy: nt ? nt.noteCy : null,
    notePy: nt ? nt.notePy : null,
    nt,
    hasNote: !!note,
    shell: eng._shell,
  };
  r.cyDrift = nt ? r2(coaCy - nt.noteCy) : r2(coaCy);
  r.pyDrift = coaPy === null ? null : r2(coaPy - (nt ? nt.notePy : 0));
  const cyBad = Math.abs(r.cyDrift) > DRIFT_TOL;
  const pyBad = r.pyDrift !== null && Math.abs(r.pyDrift) > DRIFT_TOL;
  r.status = !r.hasNote
    ? (Math.abs(coaCy) > DRIFT_TOL || (coaPy !== null && Math.abs(coaPy) > DRIFT_TOL) ? "NO NOTE" : "OK (empty)")
    : cyBad || pyBad
      ? "DRIFT"
      : "OK";
  results.push(r);
}

// ─── Step 5: deep dive for drifted engagements ───────────────────────────────

console.log("\n=== Step 4/5: deep dive on drifted engagements ===");

function ledgerDetailCy(engId) {
  return dbQuery(`
    SELECT t.ledger_name,
      round((CASE WHEN upper(t.balance_type)='DR' THEN abs(t.closing_balance)
                  ELSE -abs(t.closing_balance) END)::numeric, 2) as amt
    FROM tally_trial_balance t, audit_engagements e
    WHERE t.engagement_id = '${engId}' AND e.id = t.engagement_id
      AND (e.coa_mapping->t.ledger_name->>'code') IN ${CODES}
    ORDER BY t.ledger_name
  `).map((x) => ({ ledger: x.ledger_name, amt: Number(x.amt) }));
}

function ledgerDetailPy(cyId, pyId) {
  return dbQuery(`
    SELECT t.ledger_name,
      round((CASE WHEN upper(t.balance_type)='DR' THEN abs(t.closing_balance)
                  ELSE -abs(t.closing_balance) END)::numeric, 2) as amt
    FROM tally_trial_balance t
    JOIN audit_engagements cy ON cy.id = '${cyId}'
    JOIN audit_engagements py ON py.id = '${pyId}'
    WHERE t.engagement_id = '${pyId}'
      AND coalesce(cy.coa_mapping->t.ledger_name->>'code',
                   py.coa_mapping->t.ledger_name->>'code') IN ${CODES}
    ORDER BY t.ledger_name
  `).map((x) => ({ ledger: x.ledger_name, amt: Number(x.amt) }));
}

/** Build note-side ledger->amount maps from _cy_sources + custom row sources. */
function noteLedgerMaps(nt) {
  const cyMap = new Map(); // ledger -> amountCy
  const pyMap = new Map(); // ledger -> amountPy
  const add = (m, l, a) => m.set(l, r2((m.get(l) || 0) + (Number(a) || 0)));
  const srcObj = asObj(nt.cyData._cy_sources);
  for (const arr of Object.values(srcObj)) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      if (!s || !s.ledger) continue;
      add(cyMap, s.ledger, s.amountCy ?? s.amount);
      add(pyMap, s.ledger, s.amountPy);
    }
  }
  for (const cr of nt.customRows) {
    if (!Array.isArray(cr.sources)) continue;
    for (const s of cr.sources) {
      if (!s || !s.ledger) continue;
      add(cyMap, s.ledger, s.amountCy ?? s.amount);
      add(pyMap, s.ledger, s.amountPy);
    }
  }
  return { cyMap, pyMap };
}

function classify(r, cyLedgers, pyLedgers) {
  const out = { patterns: new Set(), evidence: [] };
  const nt = r.nt;

  if (!r.hasNote) {
    out.patterns.add("P6");
    out.evidence.push("Note row does not exist in nce_financial_notes.");
    return out;
  }
  const allZero = r.noteCy === 0 && r.notePy === 0 && (Math.abs(r.coaCy) > DRIFT_TOL || (r.coaPy ?? 0) > DRIFT_TOL);
  if (allZero) {
    out.patterns.add("P6");
    out.evidence.push("Note exists but CY and PY totals are both 0 while COA has balances.");
    return out;
  }

  const { cyMap, pyMap } = noteLedgerMaps(nt);
  const normNoteLedgers = new Set([...cyMap.keys()].map(norm));
  // labels of custom rows without sources can still represent a ledger (smart match)
  const labelNorms = new Set(nt.customRows.map((c) => norm(c.label)));

  const cyBad = Math.abs(r.cyDrift) > DRIFT_TOL;
  const pyBad = r.pyDrift !== null && Math.abs(r.pyDrift) > DRIFT_TOL;

  // ---- CY side ----
  if (cyBad) {
    const missingCy = cyLedgers.filter(
      (l) => l.amt !== 0 && !cyMap.has(l.ledger) && !normNoteLedgers.has(norm(l.ledger)) && !labelNorms.has(norm(l.ledger))
    );
    if (missingCy.length) {
      const tot = r2(missingCy.reduce((s, x) => s + x.amt, 0));
      out.evidence.push(
        `CY: ${missingCy.length} TB ledger(s) not represented in note (sum ${fmt(tot)}): ` +
          missingCy.slice(0, 12).map((x) => `${x.ledger}=${fmt(x.amt)}`).join("; ") +
          (missingCy.length > 12 ? " ..." : "")
      );
      out.patterns.add("P3");
    }
    const tbNames = new Set(cyLedgers.map((l) => norm(l.ledger)));
    const extraCy = [...cyMap.entries()].filter(([l, a]) => a !== 0 && !tbNames.has(norm(l)));
    if (extraCy.length) {
      out.evidence.push(
        `CY: ${extraCy.length} note source ledger(s) not in CY COA-mapped TB: ` +
          extraCy.slice(0, 12).map(([l, a]) => `${l}=${fmt(a)}`).join("; ")
      );
    }
    // static row CY zeroed but sources non-zero
    const srcObj = asObj(nt.cyData._cy_sources);
    for (const [rowId, arr] of Object.entries(srcObj)) {
      if (!Array.isArray(arr)) continue;
      const sCy = r2(arr.reduce((s, x) => s + (Number(x?.amountCy ?? x?.amount) || 0), 0));
      if (sCy !== 0 && (Number(nt.cyData[rowId]) || 0) === 0) {
        out.patterns.add("P1");
        out.evidence.push(`CY: static row '${rowId}' value is 0 but its sources sum to ${fmt(sCy)} (overwritten/zeroed).`);
      }
    }
    // sign error: note value == -tb value
    for (const l of cyLedgers) {
      const nv = cyMap.get(l.ledger);
      if (nv !== undefined && l.amt !== 0 && r2(nv + l.amt) === 0 && r2(nv - l.amt) !== 0) {
        out.patterns.add("P5");
        out.evidence.push(`CY: ledger '${l.ledger}' sign flipped (TB ${fmt(l.amt)} vs note ${fmt(nv)}).`);
      }
    }
    // custom rows zeroed by guard
    for (const cr of nt.customRows) {
      if (!Array.isArray(cr.sources)) continue;
      const sCy = r2(cr.sources.reduce((s, x) => s + (Number(x?.amountCy ?? x?.amount) || 0), 0));
      const v = Number(nt.cyData[cr.id]) || 0;
      if (sCy !== 0 && v === 0 && cr.attachedTo) {
        out.patterns.add("P4");
        out.evidence.push(`CY: custom row '${cr.label}' (attached to '${cr.attachedTo}') is 0 but sources sum to ${fmt(sCy)}.`);
      }
    }
  }

  // ---- PY side ----
  if (pyBad) {
    const missingPy = pyLedgers.filter(
      (l) => l.amt !== 0 && !pyMap.has(l.ledger) && ![...pyMap.keys()].some((k) => norm(k) === norm(l.ledger)) && !labelNorms.has(norm(l.ledger))
    );
    if (missingPy.length) {
      const tot = r2(missingPy.reduce((s, x) => s + x.amt, 0));
      out.evidence.push(
        `PY: ${missingPy.length} PY-shell TB ledger(s) not represented in note (sum ${fmt(tot)}): ` +
          missingPy.slice(0, 12).map((x) => `${x.ledger}=${fmt(x.amt)}`).join("; ") +
          (missingPy.length > 12 ? " ..." : "")
      );
      out.patterns.add("P3");
    }
    const pyTbNames = new Set(pyLedgers.map((l) => norm(l.ledger)));
    const extraPy = [...pyMap.entries()].filter(([l, a]) => a !== 0 && !pyTbNames.has(norm(l)));
    if (extraPy.length) {
      const tot = r2(extraPy.reduce((s, [, a]) => s + a, 0));
      out.patterns.add("P2");
      out.evidence.push(
        `PY: ${extraPy.length} note PY source ledger(s) not in PY-shell COA-mapped TB (sum ${fmt(tot)}): ` +
          extraPy.slice(0, 12).map(([l, a]) => `${l}=${fmt(a)}`).join("; ")
      );
    }
    // static row PY zeroed but PY sources non-zero (Shri Ram pattern)
    const srcObj = asObj(nt.cyData._cy_sources);
    for (const [rowId, arr] of Object.entries(srcObj)) {
      if (!Array.isArray(arr)) continue;
      const sPy = r2(arr.reduce((s, x) => s + (Number(x?.amountPy) || 0), 0));
      if (sPy !== 0 && (Number(nt.pyData[rowId]) || 0) === 0) {
        out.patterns.add("P1");
        out.evidence.push(`PY: static row '${rowId}' PY value is 0 but its sources' amountPy sum to ${fmt(sPy)} (PY overwritten/zeroed by re-save).`);
      }
    }
    if (r.notePy === 0 && (r.coaPy ?? 0) !== 0) {
      out.patterns.add("P6");
      out.evidence.push("PY: note PY column entirely 0 while PY-shell COA has balances.");
    }
  }

  if (out.patterns.size === 0) {
    out.patterns.add("P7");
    out.evidence.push("No known pattern matched — see numbers above.");
  }
  return out;
}

const drifted = results.filter((r) => r.status === "DRIFT" || r.status === "NO NOTE");
for (const r of drifted) {
  process.stdout.write(`  Deep dive: ${r.client} (${r.fy}) ...`);
  const cyLedgers = ledgerDetailCy(r.eng.id);
  const pyLedgers = r.shell ? ledgerDetailPy(r.eng.id, r.shell.id) : [];
  const c = classify(r, cyLedgers, pyLedgers);
  r.patterns = [...c.patterns].sort().join("+");
  r.evidence = c.evidence;
  r.cyLedgerCount = cyLedgers.length;
  r.pyLedgerCount = pyLedgers.length;
  console.log(` ${r.patterns}`);
}

// ─── Step 6: report ──────────────────────────────────────────────────────────

console.log("\n\n================================================================================================================");
console.log("  OTHER EXPENSES — COA mapping vs Note diagnostic (CY + PY)   [READ-ONLY]");
console.log("================================================================================================================\n");

const cols = ["Client", "FY", "COA CY", "Note CY", "CY Drift", "COA PY", "Note PY", "PY Drift", "Status", "Pattern"];
const widths = [34, 9, 14, 14, 12, 14, 14, 12, 11, 9];
const line = (vals) => vals.map((v, i) => (i < 2 || i >= 8 ? String(v).padEnd(widths[i]) : String(v).padStart(widths[i]))).join(" ");
console.log(line(cols));
console.log("-".repeat(widths.reduce((a, b) => a + b + 1, 0)));
for (const r of results) {
  console.log(
    line([
      r.client.slice(0, 33),
      r.fy,
      fmt(r.coaCy),
      r.hasNote ? fmt(r.noteCy) : "-",
      fmt(r.cyDrift),
      r.coaPy === null ? "no shell" : fmt(r.coaPy),
      r.hasNote ? fmt(r.notePy) : "-",
      r.pyDrift === null ? "-" : fmt(r.pyDrift),
      r.status,
      r.patterns || "",
    ])
  );
}

// caveats: attached custom rows
const caveats = results.filter((r) => r.nt && r.nt.attachedCount > 0);
if (caveats.length) {
  console.log("\nCAVEAT — notes containing custom rows with attachedTo (raw key sum may double-count parent+child):");
  for (const r of caveats) {
    console.log(
      `  ${r.client} (${r.fy}): ${r.nt.attachedCount} attached custom row(s); ` +
        `double-counted in raw sum: CY ${fmt(r.nt.cyDoubleCount)}, PY ${fmt(r.nt.pyDoubleCount)}`
    );
  }
}

if (drifted.length) {
  console.log("\n\n──────────────────────────── DETAIL: engagements with drift > 1 ────────────────────────────");
  for (const r of drifted) {
    console.log(`\n■ ${r.client} (${r.fy})  [${r.status}]  pattern: ${r.patterns}`);
    console.log(`  COA CY ${fmt(r.coaCy)} vs Note CY ${r.hasNote ? fmt(r.noteCy) : "-"}  (drift ${fmt(r.cyDrift)})`);
    console.log(`  COA PY ${r.coaPy === null ? "no shell" : fmt(r.coaPy)} vs Note PY ${r.hasNote ? fmt(r.notePy) : "-"}  (drift ${r.pyDrift === null ? "-" : fmt(r.pyDrift)})`);
    if (r.shell) console.log(`  PY shell: ${r.shell.id} (${r.shell.financial_year})  CY oth-exp ledgers: ${r.cyLedgerCount}, PY: ${r.pyLedgerCount}`);
    else console.log("  PY shell: NOT FOUND (no/ambiguous PY shell for this client)");
    for (const e of r.evidence || []) console.log(`   - ${e}`);
  }
}

const okCount = results.filter((r) => r.status.startsWith("OK")).length;
console.log("\n=== SUMMARY ===");
console.log(`Engagements scanned: ${results.length}`);
console.log(`OK:                  ${okCount}`);
console.log(`DRIFT:               ${results.filter((r) => r.status === "DRIFT").length}`);
console.log(`NO NOTE:             ${results.filter((r) => r.status === "NO NOTE").length}`);
console.log("\nPatterns: P1 static row PY overwritten/zeroed | P2 PY-shell-only ledgers in note | P3 smart-matched ledgers missing");
console.log("          P4 custom rows zeroed by double-count guard | P5 sign error | P6 note not populated | P7 other");
console.log("DONE — READ-ONLY, no data modified.");
