/**
 * STAGE-3 · Tally Ledger Reconciliation — pure logic (no I/O, no AI).
 *
 * Office Data is the MASTER. A section-wise Tally ledger (194C / 194J / …) is
 * imported; its CREDIT entries ("By" rows) are the deductions. The credit amount
 * may be the TDS amount (a TDS-liability ledger) OR the principal (an expense
 * ledger) — the engine AUTO-DETECTS which by testing whichever reconciles, so it
 * works for any client's ledger without a fixed assumption.
 *
 * Column IDENTIFICATION, NAME/DATE/AMOUNT normalisation and MATCHING all come from
 * the SHARED engine (columnEngine + match) so a fix there benefits every stage.
 * Only the Tally-specific STRUCTURE (title strip, By/To, Debit/Credit, no PAN) is
 * handled here.
 */

import { toNum, looksLikeDate, looksLikeName, normaliseHeader } from "./columnEngine";
import { nameCompare, amountsMatch, makeDateNormaliser, canonicalSection, normalizeName } from "./match";

export interface TallyRow {
  row_index: number;
  date: string | null;        // raw date text
  iso: string | null;         // normalised yyyy-mm-dd
  party: string | null;       // ledger party name
  debit: number | null;
  credit: number | null;      // the deduction amount (TDS or principal — see amount_basis)
  vch_no: string | null;
  vch_type: string | null;
}

export interface TallyParse {
  rows: TallyRow[];
  section: string | null;     // from the ledger/sheet name ("TDS 194C" → 194C)
  mapping: { date: string | null; party: string | null; credit: string | null; debit: string | null };
  creditCount: number;
}

const SKIP_PARTICULAR = /opening\s*balance|closing\s*balance|grand\s*total|^total\b|carried\s*over|brought\s*forward/i;
const BYTO_RE = /^(by|to|dr|cr)$/i;

/** Section from a ledger/sheet title, e.g. "TDS 194C" / "194J Ledger" → 194C/194J. */
export function sectionFromLedger(title: string | null | undefined): string | null {
  return canonicalSection(title);
}

/**
 * Parse ONE Tally ledger sheet grid → typed rows. Tally-aware: skips the company/
 * address/period title strip, finds the "Date … Debit Credit" header, and admits a
 * row as data when it has a DATE and a Debit or Credit amount (Tally has no PAN).
 * The PARTY name is value-detected (the most name-like cell, ignoring By/To/Vch).
 */
export function parseTallySheet(grid: unknown[][], sheetName: string): TallyParse {
  const n = grid.length;
  const ncol = grid.reduce((m, r) => Math.max(m, (r || []).length), 0);

  // 1) header row = the row (in the first 30) naming a DATE and a DEBIT/CREDIT col.
  let hdr = -1;
  for (let r = 0; r < Math.min(n, 30); r++) {
    const cells = (grid[r] || []).map((c) => normaliseHeader(String(c ?? "")));
    const hasDate = cells.some((h) => h === "date" || h.includes("date"));
    const hasCr = cells.some((h) => h.includes("credit") || h.includes("debit"));
    if (hasDate && hasCr) { hdr = r; break; }
  }
  const header = (hdr >= 0 ? grid[hdr] : []).map((c) => normaliseHeader(String(c ?? "")));
  const findCol = (pred: (h: string) => boolean) => header.findIndex(pred);
  const dateCol = findCol((h) => h === "date" || h.includes("date"));
  const creditCol = findCol((h) => h.includes("credit"));
  const debitCol = findCol((h) => h.includes("debit"));
  const vchNoCol = findCol((h) => h.includes("vchno") || h.includes("voucherno") || h.includes("vchnumber"));
  const vchTypeCol = findCol((h) => h.includes("vchtype") || h.includes("vouchertype"));

  // 2) PARTY column — value-based: the column whose cells read most like names,
  //    excluding the date/credit/debit/vch columns and the By/To marker column.
  const dataStart = hdr >= 0 ? hdr + 1 : 0;
  let partyCol = -1, bestFrac = 0;
  for (let c = 0; c < ncol; c++) {
    if (c === dateCol || c === creditCol || c === debitCol || c === vchNoCol || c === vchTypeCol) continue;
    let ne = 0, hit = 0;
    for (let r = dataStart; r < n; r++) {
      const s = String(grid[r]?.[c] ?? "").trim();
      if (!s || BYTO_RE.test(s)) continue;
      ne++; if (looksLikeName(s)) hit++;
    }
    const frac = ne ? hit / ne : 0;
    if (frac >= 0.4 && frac > bestFrac) { bestFrac = frac; partyCol = c; }
  }

  // 3) date normaliser over the whole date column (auto dd/mm vs mm/dd).
  const dateVals: unknown[] = [];
  for (let r = dataStart; r < n; r++) dateVals.push(grid[r]?.[dateCol]);
  const toIso = makeDateNormaliser(dateVals);

  // 4) admit data rows.
  const rows: TallyRow[] = [];
  let creditCount = 0;
  for (let r = dataStart; r < n; r++) {
    const g = grid[r] || [];
    const dateRaw = dateCol >= 0 ? String(g[dateCol] ?? "").trim() : "";
    const credit = creditCol >= 0 ? toNum(g[creditCol]) : null;
    const debit = debitCol >= 0 ? toNum(g[debitCol]) : null;
    if (!looksLikeDate(dateRaw) && !(credit != null || debit != null)) continue; // not a data row
    const party = partyCol >= 0 ? (String(g[partyCol] ?? "").trim() || null) : null;
    if (party && SKIP_PARTICULAR.test(party)) continue;
    if ((credit == null || credit === 0) && (debit == null || debit === 0)) continue; // amountless
    if (credit != null && credit !== 0) creditCount++;
    rows.push({
      row_index: r, date: dateRaw || null, iso: toIso(dateRaw), party,
      debit, credit, vch_no: vchNoCol >= 0 ? (String(g[vchNoCol] ?? "").trim() || null) : null,
      vch_type: vchTypeCol >= 0 ? (String(g[vchTypeCol] ?? "").trim() || null) : null,
    });
  }

  // section from the sheet name, else the title strip (rows above the header).
  let section = sectionFromLedger(sheetName);
  if (!section) for (let r = 0; r < (hdr >= 0 ? hdr : Math.min(n, 12)); r++) {
    const s = sectionFromLedger(String(grid[r]?.[0] ?? "")); if (s) { section = s; break; }
  }

  const label = (i: number) => (i >= 0 && hdr >= 0 ? String(grid[hdr][i] ?? "").trim() || null : null);
  return { rows, section, creditCount, mapping: { date: label(dateCol), party: label(partyCol), credit: label(creditCol), debit: label(debitCol) } };
}

/** Merge all sheets of a Tally workbook (pick the section per sheet). */
export function parseTallyWorkbook(grids: { name: string; grid: unknown[][] }[]): TallyParse {
  let best: TallyParse | null = null;
  for (const { name, grid } of grids) {
    const p = parseTallySheet(grid, name);
    if (!best || p.rows.length > best.rows.length) best = p;
  }
  return best ?? { rows: [], section: null, creditCount: 0, mapping: { date: null, party: null, credit: null, debit: null } };
}

// ── Reconciliation ───────────────────────────────────────────────────────────
export interface OfficeTxn {
  deductee_id: string; name: string | null; date_iso: string | null;
  amount: number | null; tds: number | null; section: string | null; pan?: string | null;
}
export type TallyResult =
  | "Matched" | "Date Mismatch" | "Credit Amount Mismatch" | "Party Name Mismatch"
  | "Section Mismatch" | "Ledger Entry Not Found" | "Multiple Possible Matches" | "Duplicate Ledger Entries";

export interface TallyReconRow {
  office_deductee_id: string;
  office_name: string | null; office_date: string | null; office_amount: number | null; office_tds: number | null; office_section: string | null;
  tally_row_index: number | null; tally_party: string | null; tally_date: string | null; tally_credit: number | null;
  result: TallyResult;
  amount_basis: "tds" | "amount" | null;   // which office figure the credit matched
  reason: string;
  confidence: number;                       // 0..100
  suggested_party?: string;                 // for Party Name Mismatch → possible mapping
  mapped?: boolean;                         // a saved party mapping was used
}

/** Saved per-client party mappings: normalised office name → tally party name. */
export type PartyMap = Record<string, string>;

const norm = (s: string | null | undefined) => normalizeName(s);

/**
 * Reconcile every OFFICE record against the imported Tally ledger. The Tally
 * credit is matched against office TDS first, then office amount (auto-detect),
 * so it works whether the ledger's credit is the TDS or the principal.
 */
export function reconcileTally(office: OfficeTxn[], tally: TallyRow[], ledgerSection: string | null, partyMap: PartyMap = {}): TallyReconRow[] {
  const credits = tally.filter((t) => t.credit != null && t.credit !== 0);
  const usedTally = new Set<number>();
  const out: TallyReconRow[] = [];

  for (const o of office) {
    const base = {
      office_deductee_id: o.deductee_id, office_name: o.name, office_date: o.date_iso,
      office_amount: o.amount, office_tds: o.tds, office_section: o.section,
    };
    // 1+2) candidates: same DATE and credit ≈ office TDS or office amount.
    const cand = credits.filter((t) => {
      if (usedTally.has(t.row_index)) return false;
      const dateOk = !!o.date_iso && !!t.iso && o.date_iso === t.iso;
      if (!dateOk) return false;
      return amountsMatch(t.credit, o.tds) || amountsMatch(t.credit, o.amount);
    });

    if (cand.length === 0) {
      // relax the date to find a near-miss for a precise reason.
      const byAmount = credits.find((t) => !usedTally.has(t.row_index) && (amountsMatch(t.credit, o.tds) || amountsMatch(t.credit, o.amount)));
      if (byAmount) {
        usedTally.add(byAmount.row_index);
        out.push({ ...base, tally_row_index: byAmount.row_index, tally_party: byAmount.party, tally_date: byAmount.date, tally_credit: byAmount.credit,
          result: "Date Mismatch", amount_basis: amountsMatch(byAmount.credit, o.tds) ? "tds" : "amount",
          reason: `Amount and party found, but the ledger date (${byAmount.date ?? "—"}) differs from the office date (${o.date_iso ?? "—"}).`, confidence: 55 });
      } else {
        out.push({ ...base, tally_row_index: null, tally_party: null, tally_date: null, tally_credit: null,
          result: "Ledger Entry Not Found", amount_basis: null,
          reason: `No ledger entry found matching this office record's date and amount.`, confidence: 0 });
      }
      continue;
    }

    // 4) resolve the party among the date+amount candidates.
    const scored = cand.map((t) => {
      const basis: "tds" | "amount" = amountsMatch(t.credit, o.tds) ? "tds" : "amount";
      const saved = partyMap[norm(o.name)];
      const savedHit = saved && norm(saved) === norm(t.party);
      const cmp = nameCompare(o.name, t.party);
      const nameScore = savedHit ? 1 : cmp === "match" ? 0.95 : cmp === "mismatch" ? 0.5 : cmp === "unknown" ? 0.6 : 0.1;
      const amountExact = amountsMatch(t.credit, basis === "tds" ? o.tds : o.amount) ? 1 : 0.5;
      return { t, basis, savedHit, cmp, score: nameScore * 0.6 + amountExact * 0.4 };
    }).sort((a, b) => b.score - a.score);

    // Duplicate ledger entries: 2+ candidates whose party ALSO matches.
    const partyMatches = scored.filter((s) => s.savedHit || s.cmp === "match");
    if (partyMatches.length >= 2) {
      const top = partyMatches[0]; usedTally.add(top.t.row_index);
      out.push({ ...base, tally_row_index: top.t.row_index, tally_party: top.t.party, tally_date: top.t.date, tally_credit: top.t.credit,
        result: "Duplicate Ledger Entries", amount_basis: top.basis, mapped: !!top.savedHit,
        reason: `${partyMatches.length} ledger entries match this office record (same date, amount and party) — confirm which is correct.`, confidence: 60 });
      continue;
    }

    const top = scored[0];
    usedTally.add(top.t.row_index);
    const secOk = sectionEq(o.section, ledgerSection);
    if (top.savedHit || top.cmp === "match") {
      if (!secOk) {
        out.push({ ...base, tally_row_index: top.t.row_index, tally_party: top.t.party, tally_date: top.t.date, tally_credit: top.t.credit,
          result: "Section Mismatch", amount_basis: top.basis, mapped: !!top.savedHit,
          reason: `Date, amount and party match, but the office section (${o.section ?? "—"}) differs from the ledger section (${ledgerSection ?? "—"}).`, confidence: 70 });
      } else {
        out.push({ ...base, tally_row_index: top.t.row_index, tally_party: top.t.party, tally_date: top.t.date, tally_credit: top.t.credit,
          result: "Matched", amount_basis: top.basis, mapped: !!top.savedHit,
          reason: top.savedHit ? `Matched via a saved party mapping.` : `Date, amount, party${secOk ? " and section" : ""} all match.`, confidence: top.savedHit ? 96 : 92 });
      }
    } else if (top.cmp === "unknown") {
      out.push({ ...base, tally_row_index: top.t.row_index, tally_party: top.t.party, tally_date: top.t.date, tally_credit: top.t.credit,
        result: "Matched", amount_basis: top.basis,
        reason: `Date and amount match; party name could not be compared (missing on one side).`, confidence: 75 });
    } else {
      // date + amount match, party differs → suggest a mapping.
      out.push({ ...base, tally_row_index: top.t.row_index, tally_party: top.t.party, tally_date: top.t.date, tally_credit: top.t.credit,
        result: "Party Name Mismatch", amount_basis: top.basis, suggested_party: top.t.party ?? undefined,
        reason: `Date and amount match, but the party differs — office "${o.name ?? "—"}" vs ledger "${top.t.party ?? "—"}". Confirm the mapping to match automatically in future.`, confidence: 65 });
    }
  }
  return out;
}

function sectionEq(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalSection(a), cb = canonicalSection(b);
  if (ca && cb) return ca === cb;
  return true;
}
