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

// (the Excel/CSV ledger parser that needed columnEngine's value sniffers is gone —
//  Stage-3 reads Tally ledger PDFs only; see ./tallyPdf.ts)
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
  // Each ledger entry may be claimed by at most ONE office record, tracked here.
  //
  // The key is the entry's POSITION IN THIS ARRAY, never its row_index. row_index
  // is only unique within the file it came from — every imported ledger numbers its
  // own rows from 0 — so keying on it made the first 194A entry and the first 194C
  // entry the same key. The 194A record would consume "0" and thereby block a
  // completely unrelated 194C entry, reporting a byte-exact record as "Ledger Entry
  // Not Found". Position is unique across the whole union by construction, so no
  // caller can reintroduce that.
  const credits = tally
    .map((t, i) => ({ t, k: i }))
    .filter((c) => c.t.credit != null && c.t.credit !== 0);
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
    const cand = credits.filter(({ t, k }) => {
      if (usedTally.has(k) || !inSection(t)) return false;
      const dateOk = !!o.date_iso && !!t.iso && o.date_iso === t.iso;
      if (!dateOk) return false;
      return amountsMatch(t.credit, o.tds) || amountsMatch(t.credit, o.amount);
    });

    if (cand.length === 0) {
      // relax the date to find a near-miss for a precise reason.
      const near = credits.find(({ t, k }) => !usedTally.has(k) && inSection(t) && (amountsMatch(t.credit, o.tds) || amountsMatch(t.credit, o.amount)));
      if (near) {
        const byAmount = near.t;
        usedTally.add(near.k);
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
    const scored = cand.map(({ t, k }) => {
      const basis: "tds" | "amount" = amountsMatch(t.credit, o.tds) ? "tds" : "amount";
      const saved = partyMap[norm(o.name)];
      const savedHit = saved && norm(saved) === norm(t.party);
      const cmp = nameCompare(o.name, t.party);
      const nameScore = savedHit ? 1 : cmp === "match" ? 0.95 : cmp === "mismatch" ? 0.5 : cmp === "unknown" ? 0.6 : 0.1;
      const amountExact = amountsMatch(t.credit, basis === "tds" ? o.tds : o.amount) ? 1 : 0.5;
      return { t, k, basis, savedHit, cmp, score: nameScore * 0.6 + amountExact * 0.4 };
    }).sort((a, b) => b.score - a.score);

    // Duplicate ledger entries: 2+ candidates whose party ALSO matches.
    const partyMatches = scored.filter((s) => s.savedHit || s.cmp === "match");
    if (partyMatches.length >= 2) {
      const top = partyMatches[0]; usedTally.add(top.k);
      out.push({ ...base, tally_row_index: top.t.row_index, tally_party: top.t.party, tally_date: top.t.date, tally_credit: top.t.credit,
        result: "Duplicate Ledger Entries", amount_basis: top.basis, mapped: !!top.savedHit,
        reason: `${partyMatches.length} ledger entries match this office record (same date, amount and party) — confirm which is correct.`, confidence: 60 });
      continue;
    }

    const top = scored[0];
    usedTally.add(top.k);
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
