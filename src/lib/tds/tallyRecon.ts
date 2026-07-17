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
  // The TDS section this row belongs to, taken from ITS OWN sheet/ledger title.
  // Carried PER ROW (not per file) because a client's Tally dataset is normally
  // one ledger PER SECTION — spread across several sheets AND several files — and
  // an office 194A record must only ever be reconciled against 194A ledger rows.
  section: string | null;
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
      row_index: r, date: dateRaw || null, iso: toIso(dateRaw), party, section: null,
      debit, credit, vch_no: vchNoCol >= 0 ? (String(g[vchNoCol] ?? "").trim() || null) : null,
      vch_type: vchTypeCol >= 0 ? (String(g[vchTypeCol] ?? "").trim() || null) : null,
    });
  }

  // section from the sheet name, else the title strip (rows above the header).
  let section = sectionFromLedger(sheetName);
  if (!section) for (let r = 0; r < (hdr >= 0 ? hdr : Math.min(n, 12)); r++) {
    const s = sectionFromLedger(String(grid[r]?.[0] ?? "")); if (s) { section = s; break; }
  }

  // Stamp every row of this sheet with the sheet's own section.
  for (const row of rows) row.section = section;

  const label = (i: number) => (i >= 0 && hdr >= 0 ? String(grid[hdr][i] ?? "").trim() || null : null);
  return { rows, section, creditCount, mapping: { date: label(dateCol), party: label(partyCol), credit: label(creditCol), debit: label(debitCol) } };
}

/**
 * Parse EVERY sheet of a Tally workbook and CONCATENATE the rows, each keeping its
 * own sheet's section. Previously this kept only the single sheet with the most
 * rows and silently discarded the others — so a workbook holding one ledger per
 * section (194C on one tab, 194J on the next) imported only one of them and every
 * office record in the other sections reconciled against nothing.
 *
 * `row_index` is made unique ACROSS sheets (sheet ordinal * 100000 + row) because
 * the reconciler uses it to mark a ledger entry as consumed; two sheets would
 * otherwise collide on the same index and wrongly block each other's rows.
 */
export function parseTallyWorkbook(grids: { name: string; grid: unknown[][] }[]): TallyParse {
  const rows: TallyRow[] = [];
  const sections = new Set<string>();
  let creditCount = 0;
  let mapping: TallyParse["mapping"] = { date: null, party: null, credit: null, debit: null };
  let bestRows = -1;
  grids.forEach(({ name, grid }, i) => {
    const p = parseTallySheet(grid, name);
    if (!p.rows.length) return;
    for (const r of p.rows) rows.push({ ...r, row_index: i * 100_000 + r.row_index });
    creditCount += p.creditCount;
    if (p.section) sections.add(p.section);
    // report the mapping of the richest sheet (they are normally identical)
    if (p.rows.length > bestRows) { bestRows = p.rows.length; mapping = p.mapping; }
  });
  // A single overall section is reported only when the whole workbook is ONE
  // section; the per-row section is what reconciliation actually uses.
  const section = sections.size === 1 ? [...sections][0] : null;
  return { rows, section, creditCount, mapping };
}

// ── Reconciliation ───────────────────────────────────────────────────────────
export interface OfficeTxn {
  deductee_id: string; name: string | null; date_iso: string | null;
  amount: number | null; tds: number | null; section: string | null; pan?: string | null;
}
export type TallyResult =
  | "Matched" | "Date Mismatch" | "Credit Amount Mismatch" | "Party Name Mismatch"
  | "Section Mismatch" | "Ledger Entry Not Found" | "Multiple Possible Matches" | "Duplicate Ledger Entries"
  // No ledger for this office record's section was imported AT ALL. Distinct from
  // "Ledger Entry Not Found" (which means: we have that section's ledger, and the
  // entry isn't in it). Without this, importing only the 194C ledger reported every
  // 194A/194T office record as a missing entry — sending the user hunting for rows
  // that were never in scope, when the real action is "import the 194A ledger too".
  | "No Ledger for Section";

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

  // Which sections the imported ledgers actually cover. A row with no section of
  // its own falls back to `ledgerSection` (a single-section file whose title said
  // so). If NOTHING carries a section we can't scope by section at all, so every
  // row stays eligible (old behaviour) rather than wrongly excluding everything.
  const sectionOf = (t: TallyRow) => canonicalSection(t.section) ?? canonicalSection(ledgerSection);
  const covered = new Set<string>();
  for (const t of credits) { const s = sectionOf(t); if (s) covered.add(s); }
  const sectionScoped = covered.size > 0;

  for (const o of office) {
    const base = {
      office_deductee_id: o.deductee_id, office_name: o.name, office_date: o.date_iso,
      office_amount: o.amount, office_tds: o.tds, office_section: o.section,
    };
    const oSec = canonicalSection(o.section);

    // 0) Is this office record's section represented in the imported ledgers at
    //    all? If not, say so precisely instead of blaming a missing entry.
    if (sectionScoped && oSec && !covered.has(oSec)) {
      out.push({ ...base, tally_row_index: null, tally_party: null, tally_date: null, tally_credit: null,
        result: "No Ledger for Section", amount_basis: null,
        reason: `No Tally ledger for section ${oSec} has been imported (imported: ${[...covered].sort().join(", ")}). Import that section's ledger to reconcile this record.`,
        confidence: 0 });
      continue;
    }

    // Only ever reconcile against rows of this record's OWN section.
    const inSection = (t: TallyRow) => {
      if (!sectionScoped || !oSec) return true;
      const s = sectionOf(t);
      return !s || s === oSec;
    };

    // 1+2) candidates: same section, same DATE, and credit ≈ office TDS or amount.
    const cand = credits.filter((t) => {
      if (usedTally.has(t.row_index) || !inSection(t)) return false;
      const dateOk = !!o.date_iso && !!t.iso && o.date_iso === t.iso;
      if (!dateOk) return false;
      return amountsMatch(t.credit, o.tds) || amountsMatch(t.credit, o.amount);
    });

    if (cand.length === 0) {
      // relax the date to find a near-miss for a precise reason.
      const byAmount = credits.find((t) => !usedTally.has(t.row_index) && inSection(t) && (amountsMatch(t.credit, o.tds) || amountsMatch(t.credit, o.amount)));
      if (byAmount) {
        usedTally.add(byAmount.row_index);
        // The party may ALSO differ here — offer the mapping, don't hide it behind
        // a date-only reason (this is the common real case: the ledger books the
        // entry a few days out AND under the proprietor's personal name).
        const cmp = nameCompare(o.name, byAmount.party);
        const savedHit = !!partyMap[norm(o.name)] && norm(partyMap[norm(o.name)]) === norm(byAmount.party);
        const partyDiffers = !savedHit && cmp !== "match" && cmp !== "unknown";
        out.push({ ...base, tally_row_index: byAmount.row_index, tally_party: byAmount.party, tally_date: byAmount.date, tally_credit: byAmount.credit,
          result: "Date Mismatch", amount_basis: amountsMatch(byAmount.credit, o.tds) ? "tds" : "amount",
          mapped: savedHit || undefined,
          suggested_party: partyDiffers ? (byAmount.party ?? undefined) : undefined,
          reason: partyDiffers
            ? `Amount matches, but the ledger date (${byAmount.date ?? "—"}) differs from the office date (${o.date_iso ?? "—"}) and the party differs — office "${o.name ?? "—"}" vs ledger "${byAmount.party ?? "—"}".`
            : `Amount and party found, but the ledger date (${byAmount.date ?? "—"}) differs from the office date (${o.date_iso ?? "—"}).`,
          confidence: 55 });
      } else {
        out.push({ ...base, tally_row_index: null, tally_party: null, tally_date: null, tally_credit: null,
          result: "Ledger Entry Not Found", amount_basis: null,
          reason: oSec
            ? `No entry in the ${oSec} ledger matches this office record's date and amount.`
            : `No ledger entry found matching this office record's date and amount.`,
          confidence: 0 });
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
    const topSec = sectionOf(top.t);
    const secOk = sectionEq(o.section, topSec);
    if (top.savedHit || top.cmp === "match") {
      if (!secOk) {
        out.push({ ...base, tally_row_index: top.t.row_index, tally_party: top.t.party, tally_date: top.t.date, tally_credit: top.t.credit,
          result: "Section Mismatch", amount_basis: top.basis, mapped: !!top.savedHit,
          reason: `Date, amount and party match, but the office section (${o.section ?? "—"}) differs from the ledger section (${topSec ?? "—"}).`, confidence: 70 });
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
