/**
 * tdsLedgerDiscovery.ts
 *
 * Two helpers that solve the RAY WINGS class of Party-Mapping shortfall:
 * the AI mapper only found ~3 parties even though Form 26Q reported many
 * more. Root cause was that the mapper walked ONLY current-year TB
 * creditors with a non-zero balance and a name that hit an expense-group
 * token — parties who were paid off within the year (creditor = 0 at
 * year-end) or booked via Journal against a differently-named TDS
 * payable ledger silently dropped out.
 *
 * The fix has two parts:
 *
 *   1. `discoverTdsLedgers` — return every TDS-payable ledger on the
 *      engagement, regardless of what the client named it. Larger
 *      clients keep one per section (194J / 194C / 194I / …) and the
 *      whole set must be discovered so we don't miss whole sections.
 *      Uses a layered strategy:
 *
 *        Layer 1 (structural, most reliable) — `parent_group` chain
 *        contains "tds" (case-insensitive). Every well-configured
 *        Tally client rolls TDS payable under "Duties & Taxes → TDS".
 *
 *        Layer 2 (name regex) — `ledger_name` matches /\btds\b/i. Fires
 *        only when the ledger is NOT already caught by Layer 1, so a
 *        client named ledger "TDS Consultancy Fee" (a business ledger,
 *        not a payable) isn't misclassified — it lives under an expense
 *        group, not "Duties & Taxes".
 *
 *        Layer 3 (section inference) — parse /194\s*([a-z]+)/i from the
 *        ledger name to tag each discovered ledger with its section
 *        code (194J, 194C, 194A, 194I, 194Q, …). Ledgers with no
 *        section token in the name get `section = null`; per-party
 *        section is then derived from journal narration or falls back
 *        to TDS Management deductee section by party name.
 *
 *   2. `extractPartiesFromTdsVouchers` — walk `tally_vouchers` for every
 *      discovered TDS ledger, and for each Journal voucher where the
 *      TDS ledger appears on the CREDIT side, return the counterpart
 *      party (using `party_ledger` populated by the Tally-sync writer,
 *      with a debit-leg fallback). Section is inherited from the TDS
 *      ledger the voucher hit — so a Journal against "TDS Payable 194C"
 *      tags the party as 194C without any name inference.
 *
 * Both helpers are pure DB reads (no writes) and return in-memory
 * results. They are called from `runAiMapper` in tdsEngine.ts before
 * Step 1's TB walk, and the resulting party set is UNIONed with the
 * TB-derived party set so both live-creditor and paid-off parties
 * flow through the mapper.
 */
import { supabase } from "@/integrations/supabase/client";

// ─── Public types ────────────────────────────────────────────────────────────

export interface DiscoveredTdsLedger {
  /** Tally ledger name, verbatim (may have CRLF / whitespace quirks — the
   *  voucher walker normalises before matching). */
  ledger_name:  string;
  /** Tally parent-group chain as stored on tally_trial_balance. */
  parent_group: string | null;
  /** Inferred TDS section code — "194J", "194C", "194A", "194I", "194Q",
   *  "194H", "194", etc. `null` when the ledger name carries no section
   *  token (typical of a single combined "TDS Payable" ledger). */
  section:      string | null;
  /** Sum of `credit_amount` from the TB row (= TDS deducted for the year).
   *  Useful downstream to cross-check against tds_challans aggregates. */
  cr_total:     number;
  /** Which layer detected this ledger — helps the panel show provenance
   *  and lets a future confirmation step promote lower-confidence hits. */
  source:       "group" | "name";
}

export interface TdsVoucherParty {
  /** Party ledger name (raw — dedupe/normalise at the consumer). */
  party_ledger: string;
  /** Section inherited from the TDS ledger this voucher hit. `null` when
   *  the TDS ledger itself had no section token. */
  section:      string | null;
  /** Sum of TDS credited on the TDS ledger across all vouchers for this
   *  party — i.e. total tax deducted at source from this party in the FY. */
  tds_amount:   number;
  /** Number of Journal vouchers where this party appeared alongside a
   *  discovered TDS ledger. Used to sort the panel by activity. */
  voucher_count: number;
  /** Earliest voucher date the pairing was seen on. */
  first_date:   string | null;
  /** Latest voucher date the pairing was seen on. */
  last_date:    string | null;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Case-insensitive "does the parent group chain look like TDS?". Matches
 *  the raw name "TDS" plus common sub-names ("TDS Payable", "TDS-194J",
 *  "TDS Deducted"). Deliberately NOT the same as "Duties & Taxes" root —
 *  we want the leaf group that specifically holds TDS. */
function isTdsParentGroup(pg: string | null | undefined): boolean {
  if (!pg) return false;
  const lower = pg.toLowerCase();
  // Must literally contain "tds" as a token — avoids matching "TCS" or
  // "duties" alone (a bare "Duties & Taxes" root holds GST/CGST too).
  return /\btds\b/.test(lower);
}

/** Case-insensitive TDS token in the ledger name. Same guardrail: word
 *  boundary so a business ledger named "TDS Consultancy" doesn't slip
 *  through unless its parent group also says TDS (handled by Layer 1). */
function ledgerNameLooksLikeTds(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\btds\b/i.test(name);
}

/** 2026-08-04 Phase 1 — hard exclusions applied AFTER Layer 1/2 caught the
 *  name. These weed out ledgers that read like "TDS" but are NOT the
 *  section-194 payable we want to walk:
 *
 *    • "TDS Receivable A/c." — income-tax REFUND we expect back, not
 *      what we deducted from vendors.
 *    • "CGST/SGST/IGST TDS RECEIVABLE" / "TDS CGST" etc. — GST-side TDS
 *      u/s 51 CGST Act. Different regime; the vendors on those journals
 *      are our CUSTOMERS (they deducted from us), NOT deductees WE paid.
 *    • "INTEREST ON LATE PAYMENT OF TDS" — a P&L expense (Indirect
 *      Expenses), not a payable. Its journals credit the P/L, not our
 *      deductees.
 *
 *  The predicate returns TRUE when the ledger should be EXCLUDED. */
function isNotSection194Payable(name: string, parentGroup: string | null | undefined): boolean {
  const n = name.toLowerCase();
  const pg = String(parentGroup ?? "").toLowerCase();
  // "Receivable" — an income-tax refund / GST TDS receivable
  if (/\breceivable\b|receivables?/.test(n)) return true;
  // GST-side TDS ledgers (u/s 51 GST Act) — separate regime
  if (/\bcgst\b|\bsgst\b|\bigst\b/.test(n))  return true;
  // Late-payment interest expense — under Indirect Expenses / P&L
  if (/interest/.test(n) && /(indirect|direct)\s+expenses?/.test(pg)) return true;
  // Bare "TDS on <goods/services>" ledgers under expense groups — those
  // are the expense account (Dr side of the entry), not the payable.
  if (/(indirect|direct)\s+expenses?/.test(pg)) return true;
  return false;
}

/** Extract a section code like "194J" / "194C" / "194A" from a Tally
 *  ledger name. Tolerates common variants:
 *    "TDS Payable 194J"          → 194J
 *    "TDS - 194 C"               → 194C
 *    "TDS on Contract u/s 194C"  → 194C
 *    "TDS Payable"               → null (combined / not sectionised)
 *  The captured suffix is uppercased and stripped of whitespace. Sections
 *  without a letter suffix (bare "194") also return null so the mapper
 *  doesn't guess. */
function inferSectionFromName(name: string): string | null {
  const m = /\b194\s*([a-z]{1,3})\b/i.exec(name);
  if (!m) return null;
  return `194${m[1].toUpperCase().replace(/\s+/g, "")}`;
}

// ─── Layer 1 + 2 + 3 discovery ───────────────────────────────────────────────

/**
 * Return the set of TDS-payable ledgers on this client + FY. Union of
 * Layer 1 (parent-group signal) and Layer 2 (name regex fallback),
 * deduped by trimmed lowercased ledger name. Each entry carries the
 * layer that surfaced it in `source`, plus the section inferred by
 * Layer 3 from the name.
 */
export async function discoverTdsLedgers(params: {
  client_id:       string;
  financial_year:  string;
}): Promise<DiscoveredTdsLedger[]> {
  const { client_id, financial_year } = params;

  // Same pagination style as runAiMapper's TB walk — PostgREST caps at
  // 1000 rows per response and we've seen large-client TBs blow past that.
  const rows: Array<{
    ledger_name:   string;
    parent_group:  string | null;
    credit_amount: number | null;
  }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (supabase as any)
      .from("tally_trial_balance")
      .select("ledger_name,parent_group,credit_amount")
      .eq("client_id",      client_id)
      .eq("financial_year", financial_year)
      .range(from, from + 999);
    if (error)               throw new Error(`TDS discovery TB fetch: ${error.message}`);
    if (!data || !data.length) break;
    rows.push(...(data as any[]));
    if (data.length < 1000)   break;
  }

  const dedupe = new Map<string, DiscoveredTdsLedger>();
  for (const r of rows) {
    const name = String(r.ledger_name ?? "").trim();
    if (!name) continue;
    const l1 = isTdsParentGroup(r.parent_group);
    const l2 = !l1 && ledgerNameLooksLikeTds(name);
    if (!l1 && !l2) continue;
    // Phase 1 hard exclusion — receivables, GST-TDS, expense-side ledgers.
    if (isNotSection194Payable(name, r.parent_group)) continue;
    // Phase 1 amount gate — a genuine section-194 payable will accumulate
    // credit-side transactions across the year as TDS is deducted. Skip
    // ledgers with zero credit_amount (never used) so downstream doesn't
    // walk empty vouchers.
    if (!(Number(r.credit_amount ?? 0) > 0)) continue;
    const key = name.toLowerCase();
    // Prefer Layer-1 provenance if the same ledger is caught by both.
    if (dedupe.has(key) && dedupe.get(key)!.source === "group") continue;
    dedupe.set(key, {
      ledger_name:  name,
      parent_group: r.parent_group,
      section:      inferSectionFromName(name),
      cr_total:     Number(r.credit_amount ?? 0),
      source:       l1 ? "group" : "name",
    });
  }
  return [...dedupe.values()];
}

// ─── Voucher walk → party extraction ─────────────────────────────────────────

/** Ledgers that are NEVER a party even if they land on the debit side of
 *  a TDS-carrying Journal (banks / cash / other statutory ledgers). The
 *  filter mirrors `isLikelyExpenseLedger` in usePartyExpenseLedgers but
 *  is inverted — we're looking for a party, so we reject only the
 *  obvious non-parties. Expense ledgers ARE allowed through here because
 *  when a client books TDS at expense-entry time, the Dr leg is often the
 *  expense (party is on Cr side, and party_ledger is filled by the
 *  Tally-sync writer). We prefer party_ledger; the debit-leg fallback
 *  simply avoids returning "Bank" as the party. */
function isNonPartyLeg(name: string): boolean {
  if (!name) return true;
  const n = name.toLowerCase();
  if (/\bbank\b|\bcash\b|\bcredit card\b|\boverdraft\b/.test(n)) return true;
  if (/\bgst\b|\bcgst\b|\bsgst\b|\bigst\b|\btcs\b/.test(n))     return true;
  // Deliberately NOT matching /tds/ here — the CALLER (extractPartiesFromTdsVouchers)
  // knows which ledger IS the discovered TDS ledger and skips it explicitly.
  return false;
}

/** Phase 2 — expense/nominal ledgers must not be misclassified as a party
 *  when scanning Dr-side legs for the counterparty. In a booking-at-bill-
 *  entry Journal:
 *    Dr Labour Charges     1,42,000   ← EXPENSE (Dr), not the party
 *    Cr Shanker Furniture  1,40,000   ← party
 *    Cr TDS PAY                2,000
 *  we want Shanker Furniture. Excluding expense-side names here so the
 *  Dr-leg fallback doesn't return "Labour Charges" as the party. */
function looksLikeExpenseOrNominal(name: string): boolean {
  const n = name.toLowerCase();
  return /(charges|fees|expense|salary|wages|professional|consulting|rent|freight|transport|advertisement|advertising|maintenance|commission|brokerage|interest|discount|purchase|round\s*off|rounding)/i.test(n);
}

/**
 * Walk every voucher that references a discovered TDS ledger and extract
 * the party. Only Journal-style vouchers are considered — Payment /
 * Receipt vouchers hitting TDS are usually challan payments to the govt,
 * not deductions, and their counterpart is Bank (already filtered).
 *
 * The section on the returned row is inherited from WHICH discovered TDS
 * ledger the voucher hit — a Journal against "TDS Payable 194C" tags the
 * party as 194C, without any name inference on the party ledger itself.
 */
export async function extractPartiesFromTdsVouchers(params: {
  client_id:       string;
  financial_year:  string;
  tds_ledgers:     DiscoveredTdsLedger[];
}): Promise<TdsVoucherParty[]> {
  const { client_id, financial_year, tds_ledgers } = params;
  if (tds_ledgers.length === 0) return [];

  // Case-insensitive index: normalised TDS ledger name → discovered row.
  // Used to (a) identify which line inside a voucher IS the TDS ledger,
  // and (b) inherit the section for the party we return.
  const tdsIndex = new Map<string, DiscoveredTdsLedger>();
  for (const t of tds_ledgers) tdsIndex.set(t.ledger_name.trim().toLowerCase(), t);

  // Pull all vouchers for the engagement — cheaper than one query per TDS
  // ledger, and lets us reuse the same fetch across multi-ledger clients.
  // Vouchers with no `line_items` (older syncs) are skipped in-memory.
  interface Row {
    voucher_date:  string | null;
    voucher_type:  string | null;
    party_ledger:  string | null;
    line_items:    Array<{ ledger_name?: string; amount?: number; dr_cr?: string }> | null;
  }
  const vouchers: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (supabase as any)
      .from("tally_vouchers")
      .select("voucher_date,voucher_type,party_ledger,line_items")
      .eq("client_id",      client_id)
      .eq("financial_year", financial_year)
      .range(from, from + 999);
    if (error) throw new Error(`TDS voucher fetch: ${error.message}`);
    if (!data || !data.length) break;
    vouchers.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const agg = new Map<string, TdsVoucherParty>();

  for (const v of vouchers) {
    const items = Array.isArray(v.line_items) ? v.line_items : [];
    if (items.length === 0) continue;

    // Filter to Journal-family vouchers. Different Tally installs use
    // "Journal", "Purchase" (booking a bill with TDS deducted at bill-
    // entry time), "Debit Note", "Credit Note". Payment/Receipt are
    // excluded — those settle the TDS payable via bank, not deduct it.
    const vtype = (v.voucher_type ?? "").toLowerCase();
    if (/payment|receipt|contra/.test(vtype)) continue;

    // Find EVERY TDS line in this voucher (some Journals credit two TDS
    // ledgers if the client splits Payable and Late Fee — we account for
    // the sum). Section is picked from the first-hit discovered ledger
    // so a compound Journal still tags the party under a single section.
    let tdsCrTotal = 0;
    let sectionHit: string | null = null;
    for (const li of items) {
      const nm  = String(li?.ledger_name ?? "").trim();
      if (!nm) continue;
      const dsc = tdsIndex.get(nm.toLowerCase());
      if (!dsc) continue;
      const isCr = String(li?.dr_cr ?? "").toLowerCase().startsWith("cr");
      if (!isCr) continue;
      const amt = Math.abs(Number(li?.amount ?? 0));
      if (!Number.isFinite(amt) || amt <= 0) continue;
      tdsCrTotal += amt;
      if (sectionHit == null && dsc.section) sectionHit = dsc.section;
    }
    if (tdsCrTotal <= 0) continue; // no TDS deduction leg → not a deduction voucher

    // Prefer the Tally-sync writer's `party_ledger` — it already resolves
    // which line is the party, based on Tally's own metadata. Fall back
    // to walking BOTH Cr and Dr legs — the party can be on either side
    // depending on when TDS is booked:
    //
    //   Booking at bill entry (party gets Cr, TDS gets Cr, expense Dr):
    //     Dr Labour Charges     1,42,000
    //     Cr Shanker Furniture  1,40,000  ← party on Cr
    //     Cr TDS PAY               2,000
    //
    //   Booking a standalone TDS deduction against an existing creditor
    //   (party on Dr, TDS on Cr):
    //     Dr Shanker Furniture     2,090  ← party on Dr (RAY WINGS case)
    //     Cr TDS PAY               2,090
    //
    //   Booking at payment time (party gets Dr, TDS Cr, bank Cr):
    //     Dr Vendor                100
    //     Cr TDS PAY                10
    //     Cr Bank                   90
    //
    // We scan Cr FIRST (the more common bill-entry pattern) then Dr, so
    // if a voucher genuinely has both a Cr party and a Dr party we take
    // the Cr one (bill entry — the payable being created).
    let party = String(v.party_ledger ?? "").trim();
    if (!party) {
      const scanForParty = (side: "cr" | "dr"): string => {
        const legs = items.filter(li =>
          String(li?.dr_cr ?? "").toLowerCase().startsWith(side));
        for (const li of legs) {
          const nm = String(li?.ledger_name ?? "").trim();
          if (!nm) continue;
          if (tdsIndex.has(nm.toLowerCase())) continue;
          if (isNonPartyLeg(nm)) continue;
          if (looksLikeExpenseOrNominal(nm)) continue;
          return nm;
        }
        return "";
      };
      party = scanForParty("cr") || scanForParty("dr");
    }
    if (!party) continue;

    const key = party.trim().toLowerCase() + "|" + (sectionHit ?? "_");
    const cur = agg.get(key) ?? {
      party_ledger:  party,
      section:       sectionHit,
      tds_amount:    0,
      voucher_count: 0,
      first_date:    null,
      last_date:     null,
    };
    cur.tds_amount    += tdsCrTotal;
    cur.voucher_count += 1;
    if (v.voucher_date) {
      if (!cur.first_date || v.voucher_date < cur.first_date) cur.first_date = v.voucher_date;
      if (!cur.last_date  || v.voucher_date > cur.last_date)  cur.last_date  = v.voucher_date;
    }
    agg.set(key, cur);
  }

  return [...agg.values()].sort((a, b) => b.tds_amount - a.tds_amount);
}
