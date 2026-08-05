/**
 * tdsEngine.ts
 *
 * Client-side TypeScript port of all 4 TDS edge functions.
 * Runs in the browser using the user's JWT (passes RLS).
 * Replaces: tds-ai-mapper, tds-recon-engine, tds-missing-scanner, tds-demand-calculator
 */
import { supabase } from "@/integrations/supabase/client";
import { discoverTdsLedgers, extractPartiesFromTdsVouchers } from "./tdsLedgerDiscovery";

// ─── Shared helpers ───────────────────────────────────────────────────────────

// Issue 3 (root-cause fix): the TB Ledger column should ONLY show *party*
// ledgers (Sundry Creditors, party Current Liabilities, etc.) — never income
// or expense ledgers. Earlier we also matched groups containing "expense",
// "indirect", "direct" etc. which pulled in nominal-account ledgers like
// "Depreciation", "Professional Fees Income-18%", "Travelling Expense" and
// presented them as if they were parties. We now restrict the universe to
// genuine party-bearing groups.
//
// "creditor"      → Sundry Creditors / Creditor for Employees / Trade Creditors
// "loan"          → Loans from / Loan accounts (party loans only — see SKIP)
// (Optional later: "current liabilit" — only when individual party rows are
//  identifiable. Today many clients dump CC/credit cards there, so we keep
//  it OFF until we have a per-row party detector.)
const EXPENSE_TOKENS = ["creditor"];

const SKIP_TOKENS = [
  "bank account","cash-in-hand","cash in hand","capital account","reserves",
  "fixed assets","investment","duties & taxes","duties and taxes","sundry debtor",
  "stock-in-hand","stock in hand","current asset","loans (liability)","branch","statutory",
];
// Issue 4: exclude goods/inventory purchase groups (covered only under 194Q which
// is handled separately by section-aware logic).
const GOODS_TOKENS = [
  "goods","material","raw material","inventory","stock item","stores",
  "purchase account","purchase a/c","purchases ",
];
function isGoodsGroup(pg: string | null): boolean {
  if (!pg) return false;
  const lower = pg.toLowerCase();
  return GOODS_TOKENS.some(t => lower.includes(t));
}
function isExpenseGroup(pg: string | null): boolean {
  if (!pg) return false;
  const lower = pg.toLowerCase();
  if (SKIP_TOKENS.some(t => lower.includes(t))) return false;
  // Allow services; exclude goods/inventory unless section context is 194Q (checked downstream)
  if (isGoodsGroup(lower)) return false;
  return EXPENSE_TOKENS.some(t => lower.includes(t));
}

/**
 * Issue 3 (root-cause fix, part 2): the AI mapper writes only party rows now,
 * but existing rows in tds_tb_party_mappings created BEFORE the filter
 * tightened (when EXPENSE_TOKENS still included "expense", "indirect", etc.)
 * remain in the DB. Use this same predicate at READ time to hide stale
 * non-party rows from the UI without destructively deleting them. Auditors
 * can manually Reject any they want gone.
 */
export function isPartyLedgerGroup(parentGroup: string | null | undefined): boolean {
  // Stage-1 hotfix (2026-08-04) — the panel READ path was rejecting parent
  // groups the manual-link picker (P1-A) now accepts. Jayshreeben was
  // linked successfully but her mapping row was hidden because her
  // parent_group is "Unsecured Loans" — outside the old creditor-only
  // filter. Widened to the same rule the picker uses so linked rows
  // become visible.
  const p = String(parentGroup ?? "").toLowerCase();
  if (!p) return false;
  const KEEP = /(creditor|debtor|loan|advance|deposit|payable|receivable|current liabilit|other liabilit|other asset)/;
  const SKIP = /(bank|cash-in-hand|cash in hand|capital|reserve|fixed asset|investment|duties|inventory|stock|purchase|expense|income|indirect|direct|misc|suspense|branch|statutory)/;
  if (SKIP.test(p)) return false;
  return KEEP.test(p);
}

// ─── Section-prescribed TDS rates (Income Tax Act, FY 2025-26) ───────────────
// Used to validate that the TDS amount in the filing is consistent with the
// section. Range = [min %, max %] — e.g. 194C is 1% (individual) or 2% (firm).
// 192/192A are slab-based so we accept any positive deduction.
const SECTION_TDS_RATE: Record<string, [number, number] | "slab"> = {
  "192":   "slab",      // Salary slab
  "192A":  [10, 10],    // PF withdrawal
  "193":   [10, 10],    // Interest on securities
  "194":   [10, 10],    // Dividend
  "194A":  [10, 10],    // Interest other than securities
  "194B":  [30, 30],    // Lottery / crossword
  "194BB": [30, 30],    // Horse races
  "194C":  [1, 2],      // Contractors (1 % indiv / 2 % company)
  "194D":  [5, 5],      // Insurance commission
  "194DA": [5, 5],
  "194E":  [20, 20],
  "194EE": [10, 10],
  "194F":  [20, 20],
  "194G":  [5, 5],
  // 2026-07-24 — 194H reduced from 5% to 2% w.e.f. 1-Oct-2024 (Finance
  // (No.2) Act 2024). Auditor reported the module was still validating
  // at 5%, so every FY 2025-26 194H filing showed a spurious 60% under-
  // deduction gap. Range [2,2] enforces the new statutory rate.
  "194H":  [2, 2],      // Commission / brokerage (FY 2025-26)
  "194I":  [10, 10],    // Rent — land/building
  "194IB": [5, 5],      // Rent by individual/HUF
  "194IC": [10, 10],
  "194J":  [2, 10],     // Professional / technical (2 % technical, 10 % professional)
  "194K":  [10, 10],
  "194LA": [10, 10],
  "194M":  [5, 5],      // Contractor by individual/HUF
  "194N":  [2, 5],      // Cash withdrawal
  "194Q":  [0.1, 0.1],  // Purchase of goods
  "194R":  [10, 10],
  "194S":  [1, 1],
  "195":   [10, 30],
};

/**
 * Issue 1: Validate that the deducted TDS implied rate matches the section's
 * prescribed rate (within ±20 % tolerance to allow surcharge/cess).
 * Returns true ONLY when rate is consistent — used for "Confirmed" gating.
 */
export function tdsRateMatchesSection(
  section: string | null,
  gross: number,
  tds: number,
): boolean {
  if (!section || gross <= 0 || tds <= 0) return false;
  const range = SECTION_TDS_RATE[section];
  if (!range) return tds > 0;            // unknown section → only require >0
  if (range === "slab") return tds > 0;  // slab-based — auditor reviews manually
  const impliedRate = (tds / gross) * 100;
  const [lo, hi] = range;
  // ±20 % tolerance for surcharge / cess and rounding
  return impliedRate >= lo * 0.8 && impliedRate <= hi * 1.25;
}

// ══════════════════════════════════════════════════════════════════════════════
// Part 1 — TDS AI MAPPER
// ══════════════════════════════════════════════════════════════════════════════

const GROUP_SECTION_MAP: Array<{ token: string; sections: string[] }> = [
  { token: "salary",        sections: ["192","192A"] },
  { token: "wages",         sections: ["192","194C"] },
  { token: "contractor",    sections: ["194C"] },
  { token: "freight",       sections: ["194C"] },
  { token: "transport",     sections: ["194C"] },
  { token: "advertisement", sections: ["194C"] },
  { token: "advertising",   sections: ["194C"] },
  { token: "professional",  sections: ["194J"] },
  { token: "technical",     sections: ["194J"] },
  { token: "consulting",    sections: ["194J"] },
  { token: "commission",    sections: ["194H"] },
  { token: "brokerage",     sections: ["194H"] },
  { token: "rent",          sections: ["194I","194IB"] },
  { token: "interest",      sections: ["194A"] },
  { token: "outsource",     sections: ["194C","194J"] },
  { token: "maintenance",   sections: ["194C"] },
  { token: "service",       sections: ["194C","194J"] },
  { token: "creditor",      sections: ["194C","194J","194H"] },
  { token: "indirect",      sections: ["194C","194J","194H","194I"] },
  { token: "direct",        sections: ["194C","194J"] },
  { token: "purchase",      sections: ["194C","194Q"] },
];

function sectionContextScore(pg: string | null, sectionCode: string | null): number {
  if (!pg || !sectionCode) return 50;
  const lower = pg.toLowerCase();
  for (const e of GROUP_SECTION_MAP) {
    if (lower.includes(e.token)) return e.sections.includes(sectionCode) ? 95 : 20;
  }
  return 50;
}

function cleanName(s: string): string {
  return s.toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|corp|co|and|&|the|a|of|by|for)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(t => t.length > 1).sort().join(" ").trim();
}

function bigramMap(s: string): Map<string, number> {
  const joined = s.replace(/\s/g, "");
  const m = new Map<string, number>();
  for (let i = 0; i < joined.length - 1; i++) {
    const bg = joined.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}

function tokenSortRatio(a: string, b: string): number {
  const ca = cleanName(a); const cb = cleanName(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 100;
  const ta = new Set(ca.split(" ")); const tb = new Set(cb.split(" "));
  const inter = [...ta].filter(t => tb.has(t)).length;
  const tokenJ = inter / (ta.size + tb.size - inter);
  const ba = bigramMap(ca); const bb = bigramMap(cb);
  let biInter = 0;
  for (const [bg, cnt] of ba) biInter += Math.min(cnt, bb.get(bg) ?? 0);
  const sumA = [...ba.values()].reduce((a, v) => a + v, 0);
  const sumB = [...bb.values()].reduce((a, v) => a + v, 0);
  const bigramDice = (2 * biInter) / (sumA + sumB + 0.001);
  return Math.min(100, Math.round((tokenJ * 0.55 + bigramDice * 0.45) * 100));
}

function amountRatioScore(tbActivity: number, tdsAmount: number): number {
  if (tbActivity <= 0 || tdsAmount <= 0) return 40;
  const ratio = tdsAmount / tbActivity;
  if (ratio >= 0.75 && ratio <= 1.35) return 100;
  if (ratio >= 0.50 && ratio <= 2.00) return 75;
  if (ratio >= 0.20 && ratio <= 4.00) return 45;
  if (ratio >= 0.05 && ratio <= 10.0) return 25;
  return 5;
}

// GST_FACTOR: Indian B2B invoices typically carry 18% GST. When the TB ledger
// is an expense/creditor account the debit includes GST, whereas the TDS
// deductee amount_paid_credited in the filing reflects the BASE amount only.
// Dividing by 1.18 normalises the TB figure before comparing.
const GST_FACTOR = 1.18;

/**
 * Returns a tuple [grossScore, gstAdjusted] where gstAdjusted=true means we
 * had to normalise the TB figure by ÷1.18 to get a good score.
 */
function grossAmountScore(tbActivity: number, tdsGross: number): { score: number; gstAdjusted: boolean } {
  const rawScore = amountRatioScore(tbActivity, tdsGross);
  if (rawScore >= 75) return { score: rawScore, gstAdjusted: false };
  // Try GST-normalised comparison: TB (incl. GST) ÷ 1.18 ≈ TDS gross
  const tbNet = tbActivity / GST_FACTOR;
  const netScore = amountRatioScore(tbNet, tdsGross);
  if (netScore > rawScore) return { score: netScore, gstAdjusted: true };
  return { score: rawScore, gstAdjusted: false };
}

/**
 * Produce a human-readable explanation for any gross-amount difference between
 * the TB ledger and the TDS filing.
 */
function grossDifferenceReason(tbActivity: number, tdsGross: number, tdsTds: number): string {
  if (tbActivity <= 0 || tdsGross <= 0) return "";
  const ratio = tdsGross / tbActivity;
  const ratioNet = tdsGross / (tbActivity / GST_FACTOR);
  const diff = tbActivity - tdsGross;

  const lines: string[] = [];

  // Explain gross difference
  if (ratio < 0.75 || ratio > 1.35) {
    if (Math.abs(ratioNet - 1) < 0.05) {
      lines.push(`TB ₹${tbActivity.toFixed(0)} includes GST; net-of-GST ₹${(tbActivity / GST_FACTOR).toFixed(0)} ≈ TDS gross ₹${tdsGross.toFixed(0)} — GST inclusion explains the difference.`);
    } else if (diff > 0 && diff / tbActivity < 0.25) {
      lines.push(`TB exceeds TDS gross by ₹${diff.toFixed(0)} (${(diff / tbActivity * 100).toFixed(1)}%). Possible cause: GST-inclusive booking, advance payment, or timing difference.`);
    } else if (diff < 0) {
      lines.push(`TDS gross ₹${tdsGross.toFixed(0)} exceeds TB ₹${tbActivity.toFixed(0)} by ₹${Math.abs(diff).toFixed(0)}. Possible cause: partial-year TB, multiple TB ledgers, or incorrect party mapping.`);
    } else {
      lines.push(`Gross amount mismatch: TB ₹${tbActivity.toFixed(0)} vs TDS ₹${tdsGross.toFixed(0)} (ratio ${(ratio * 100).toFixed(0)}%). Review for split ledgers or wrong party match.`);
    }
  }

  // Explain TDS amount
  if (tdsTds <= 0) {
    lines.push("No TDS deducted in filing — TDS obligation may be unmet.");
  } else {
    const impliedRate = (tdsTds / tdsGross) * 100;
    lines.push(`TDS deducted per filing: ₹${tdsTds.toFixed(0)} (effective rate ${impliedRate.toFixed(1)}% on ₹${tdsGross.toFixed(0)}).`);
  }

  return lines.join(" ");
}

interface AggDeductee {
  deductee_name: string;
  deductee_pan?: string | null;
  section_code: string | null;
  nature_of_payment: string | null;
  total_amount_paid: number;
  total_tds: number;
  filing_ids: string[];
  deductee_ids: string[];
}

function aggregateDeducteesForMapper(rows: any[]): AggDeductee[] {
  const map = new Map<string, AggDeductee>();
  for (const r of rows) {
    // P2-C (2026-08-04) — dedupe key uses trim+lowercase so 26Q entries
    // typed with different casing ("SHANKARLAL" Q2 vs "Shankarlal" Q3)
    // aggregate into a single deductee. The DISPLAY name still uses
    // the first non-empty original casing.
    const rawName = (r.deductee_name || "").trim();
    const key = `${rawName.toLowerCase()}|${(r.section_code ?? "").toString().toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, {
        deductee_name:     rawName,
        deductee_pan:      r.deductee_pan ?? null,
        section_code:      r.section_code,
        nature_of_payment: r.nature_of_payment,
        total_amount_paid: 0, total_tds: 0,
        filing_ids: [], deductee_ids: [],
      });
    }
    const agg = map.get(key)!;
    if (r.deductee_pan && !agg.deductee_pan) agg.deductee_pan = r.deductee_pan;
    agg.total_amount_paid += r.amount_paid_credited ?? 0;
    agg.total_tds         += r.tds_amount           ?? 0;
    if (r.filing_id && !agg.filing_ids.includes(r.filing_id)) agg.filing_ids.push(r.filing_id);
    if (r.id       && !agg.deductee_ids.includes(r.id))       agg.deductee_ids.push(r.id);
  }
  return [...map.values()];
}

export interface MapperResult {
  mapped: number; skipped: number; confirmed: number; pending: number; needs_review: number;
  message?: string;
  /** 2026-08-04 — diagnostic: how many TDS-payable ledgers Layer 1+2
   *  discovery surfaced on the engagement. If 0 on a client that filed
   *  Form 26Q, we know discovery missed the TDS ledger (likely under a
   *  non-standard parent group). */
  discovered_tds_ledgers?: number;
  /** Voucher-derived party candidates union'd into expenseLedgers this
   *  run. If N here + N in the toast for mapped tell us how many of the
   *  Journal-derived parties actually tied to a Form 26Q deductee. */
  voucher_parties_added?:  number;
  /** P1-F (2026-08-04) — TB ledgers that ended up in the "Books > TDS"
   *  bucket this run (voucher evidence + no matching deductee).
   *  Sulochana Manish Pandey lives here on Ray Wings. */
  books_only_written?:     number;
}

export async function runAiMapper(params: {
  client_id: string; financial_year: string; firm_id: string; force_rematch?: boolean;
}): Promise<MapperResult> {
  const { client_id, financial_year, firm_id, force_rematch = false } = params;

  // 2026-08-04 P1-B / Stage-1 hotfix — kill stale books_only rows whose
  // TB ledger now has a real row (Shanker Furniture manual-link left the
  // older books_only row behind). Also delete books_only rows whose
  // tb_ledger_name matches a discovered TDS payable (the "TDS PAY as
  // a party" bug — surfaced after we started including Provisions-group
  // TDS ledgers in the voucher walk).
  try {
    let discoveredNames = new Set<string>();
    try {
      const discovered = await discoverTdsLedgers({ client_id, financial_year });
      discoveredNames = new Set(discovered.map(t => t.ledger_name.trim().toLowerCase()));
    } catch { /* discovery cleanup best-effort */ }
    const { data: allRows } = await (supabase as any)
      .from("tds_tb_party_mappings")
      .select("id,tb_ledger_name,tds_deductee_name,match_method")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year);
    const rows = (allRows as any[]) || [];
    const claimed = new Set<string>(
      rows
        .filter(r => r.tds_deductee_name && r.tds_deductee_name !== "(not filed)")
        .map(r => String(r.tb_ledger_name || "").trim().toLowerCase()),
    );
    // Stage-2 hotfix (2026-08-04) — a mapping row whose tb_ledger_name is
    // itself a discovered TDS payable (Ray Wings' "TDS PAY") must be
    // deleted regardless of match_method OR mapped_by. Auditors sometimes
    // confirm-then-reject those rows, which leaves mapped_by="auditor"
    // and slips past the books_only-only filter. This is always wrong —
    // TDS PAY is the payable ledger, never a party — so nuke it hard.
    const tdsPayableRowIds = rows
      .filter(r => discoveredNames.has(String(r.tb_ledger_name || "").trim().toLowerCase()))
      .map(r => r.id);
    // Stage-4 hotfix (2026-08-05) — P4-C ("zero_tds") shipped a false-
    // positive-prone heuristic (any creditor with >= ₹1L TB activity, no
    // service-nature check) and was reverted. Any row it already wrote
    // gets deleted on every subsequent mapper run so engagements that hit
    // Re-run All before this fix landed get cleaned up automatically.
    const zeroTdsRowIds = rows
      .filter(r => String(r.match_method || "").includes("zero_tds"))
      .map(r => r.id);
    const staleBooksOnlyIds = [...new Set([
      ...tdsPayableRowIds,
      ...zeroTdsRowIds,
      ...rows
        .filter(r => {
          if (!String(r.match_method || "").includes("books_only")) return false;
          const key = String(r.tb_ledger_name || "").trim().toLowerCase();
          return claimed.has(key);
        })
        .map(r => r.id),
    ])];
    if (staleBooksOnlyIds.length > 0) {
      await (supabase as any)
        .from("tds_recon_flags")
        .delete()
        .in("mapping_id", staleBooksOnlyIds);
      await (supabase as any)
        .from("tds_tb_party_mappings")
        .delete()
        .in("id", staleBooksOnlyIds);
    }
  } catch { /* non-fatal */ }

  // 2026-08-04 Phase 3c/3d — CLEANUP before running the mapper:
  //   • Always: stale "(unmapped: <deductee>)" placeholder rows and any
  //     match_method="deductee_only" left over from the previous seeding
  //     logic. Their synthetic tb_ledger_name broke View Ledger.
  //   • On force_rematch: also delete every AI-generated mapping so the
  //     re-run gives a clean slate. Otherwise stale rows produced by a
  //     looser pre-tightening iteration (e.g. B B Vyas ↔ SHANKARLAL near-
  //     tie at 60% confidence) persist even after the tightening ships,
  //     because upsert never deletes. Auditor-created rows (mapped_by =
  //     "auditor") are preserved — the user explicitly picked them.
  // DELETE fails with FK constraint from tds_recon_flags, so we cascade:
  // find ids → delete flags → delete mappings.
  try {
    const filters = force_rematch
      ? `or(match_method.eq.deductee_only,tb_ledger_name.like.(unmapped:%,mapped_by.eq.ai)`
      : `or(match_method.eq.deductee_only,tb_ledger_name.like.(unmapped:%`;
    const url = new URL("https://x/rest/v1/tds_tb_party_mappings");
    // Use the supabase client's built-in filter builders to avoid manual URL construction.
    const query = (supabase as any)
      .from("tds_tb_party_mappings")
      .select("id")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year);
    if (force_rematch) {
      // Wipe every AI row (and the two placeholder classes) so the run is fresh.
      query.or("match_method.eq.deductee_only,tb_ledger_name.like.(unmapped:%,mapped_by.eq.ai");
    } else {
      query.or("match_method.eq.deductee_only,tb_ledger_name.like.(unmapped:%");
    }
    void url; void filters;
    const { data: staleRows } = await query;
    const staleIds = ((staleRows as any[]) || []).map(r => r.id);
    if (staleIds.length > 0) {
      await (supabase as any)
        .from("tds_recon_flags")
        .delete()
        .in("mapping_id", staleIds);
      await (supabase as any)
        .from("tds_tb_party_mappings")
        .delete()
        .in("id", staleIds);
    }
  } catch { /* non-fatal — cleanup only */ }

  // 1. Fetch Trial Balance ledgers — PAGINATE (PostgREST caps a single response
  // at 1000 rows; un-paginated, expense/creditor ledgers past row 1000 were
  // excluded from TDS mapping).
  const tbRows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: tbErr } = await (supabase as any)
      .from("tally_trial_balance")
      .select("ledger_name,parent_group,debit_amount,credit_amount,closing_balance,balance_type")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .range(from, from + 999);
    if (tbErr) throw new Error(`TB fetch error: ${tbErr.message}`);
    if (!data || !data.length) break;
    tbRows.push(...data);
    if (data.length < 1000) break;
  }

  const expenseLedgers = tbRows.filter((l: any) => isExpenseGroup(l.parent_group));

  // 2026-08-04 — RAY WINGS class of fix: TB-only party discovery misses
  // any deductee whose creditor was cleared within the year (payment
  // vouchers to bank) or whose Journal was booked against a TDS ledger
  // the client named differently ("TDS Payable 194C", "TDS on Prof
  // Fees", "Duties & Taxes / TDS-194J"). We now:
  //
  //   1. Auto-discover the engagement's TDS-payable ledger set via
  //      parent_group and name signals (tdsLedgerDiscovery.ts).
  //   2. Walk tally_vouchers for every discovered TDS ledger and pull
  //      out the counterpart party on each Journal-family voucher.
  //   3. Union those parties into `expenseLedgers` as synthetic TB rows,
  //      so the existing match loop below sees the full universe.
  //
  // Synthetic rows use parent_group = "Sundry Creditors (voucher-
  // derived)" so isExpenseGroup accepts them AND sectionContextScore's
  // "creditor" token still scores 95 for 194C/J/H (the typical business-
  // expense sections). Amount signal is derived from voucher-summed
  // TDS × 10 (10 % 194J-baseline) which is deliberately loose — the
  // AI mapper's final "confirmed" gate requires all four criteria
  // (nameScore 90+, amount, tds>0, rate), so a fuzzy amount just holds
  // the row at "pending" for the auditor to review. Every 26Q deductee
  // now surfaces in the mapping panel — whether they closed the year
  // as an open creditor or were paid in full.
  let discoveredTdsLedgers: Awaited<ReturnType<typeof discoverTdsLedgers>> = [];
  let voucherParties:       Awaited<ReturnType<typeof extractPartiesFromTdsVouchers>> = [];
  try {
    discoveredTdsLedgers = await discoverTdsLedgers({ client_id, financial_year });
    if (discoveredTdsLedgers.length > 0) {
      voucherParties = await extractPartiesFromTdsVouchers({
        client_id, financial_year, tds_ledgers: discoveredTdsLedgers,
      });
    }
  } catch (err) {
    // Non-fatal: fall back to the pre-2026-08-04 TB-only universe. The
    // AI mapper still runs — it just may miss paid-off parties.
    console.warn("[tdsEngine] TDS-ledger discovery failed:", err);
  }

  // Stage-1 hotfix (2026-08-04) — the discovered TDS payable ledgers
  // themselves ("TDS PAY") were leaking into the party candidate set
  // because they sit under parent groups like "Provisions" or "Sundry
  // Creditors" which pass isExpenseGroup. Then the voucher walker's
  // party fallback would name TDS PAY as the "party" of its own
  // journals, and the mapper wrote a "TDS PAY → (not filed)" row.
  // Exclude every discovered TDS ledger by trimmed lowercase name
  // BEFORE the union step.
  const tdsLedgerNamesLower = new Set<string>(
    discoveredTdsLedgers.map(t => t.ledger_name.trim().toLowerCase()),
  );
  const filteredExpenseLedgers = expenseLedgers.filter((l: any) =>
    !tdsLedgerNamesLower.has(String(l.ledger_name ?? "").trim().toLowerCase())
  );
  expenseLedgers.length = 0;
  expenseLedgers.push(...filteredExpenseLedgers);

  // Union in voucher-derived parties that are NOT already represented in TB
  // by name (case-insensitive, trimmed) — same normalisation the FS
  // reconciliation path uses to handle CRLF/whitespace quirks.
  //
  // 2026-08-04 Phase 4b — when a party from the voucher walk DOES already
  // appear in TB (Shanker Furniture under "Creditors Exp.", Vanraj
  // Engineers under "Sundry Creditors"), we don't add a duplicate row —
  // but we ATTACH the voucher_tds_amount + voucher_section to the
  // existing TB row so the amount-tie scorer downstream fires against
  // it. Without this, TB-visible parties whose Tally name doesn't
  // resemble their 26Q deductee name stayed forever unmapped.
  const tbByNameLower = new Map<string, any>();
  for (const l of expenseLedgers) {
    const k = String(l.ledger_name ?? "").trim().toLowerCase();
    if (k) tbByNameLower.set(k, l);
  }
  let voucherPartiesAdded = 0;
  let booksOnlyWritten    = 0;
  for (const p of voucherParties) {
    const key = p.party_ledger.trim().toLowerCase();
    if (!key) continue;
    // Party already visible in TB → decorate that row with voucher evidence.
    const existing = tbByNameLower.get(key);
    if (existing) {
      existing.__voucher_tds_amount = (existing.__voucher_tds_amount ?? 0) + p.tds_amount;
      existing.__voucher_section    = existing.__voucher_section ?? p.section;
      existing.__voucher_count      = (existing.__voucher_count ?? 0) + p.voucher_count;
      // Keep __source unset so the alreadyMapped skip still applies normally
      // (this is a real TB ledger, not a synthetic voucher-only candidate).
      // But mark that the amount tie may fire:
      existing.__voucher_evidence   = true;
      continue;
    }
    tbByNameLower.set(key, null); // reserve the key
    voucherPartiesAdded++;
    expenseLedgers.push({
      ledger_name:     p.party_ledger,
      // Synthetic group carries the "creditor" token so sectionContextScore
      // treats these rows the same as real Sundry Creditors. The parenthetical
      // is preserved for auditor traceability in the mapping panel reasoning.
      parent_group:    "Sundry Creditors (voucher-derived)",
      // No live TB debit/credit; derive an approximate gross from the total
      // TDS deducted assuming 10 % (baseline 194J rate). Undershoots for
      // 194C (1 %) and overshoots for 194A (10 %) — good enough for the
      // AI mapper's amount score which is capped anyway. See long note above.
      debit_amount:    p.tds_amount * 10,
      credit_amount:   0,
      closing_balance: 0,
      balance_type:    "cr",
      // Marker so downstream (and future audit) can tell these apart from TB rows.
      __source:        "voucher",
      __voucher_section: p.section,
      __voucher_count:   p.voucher_count,
      // 2026-08-04 Phase 4 — carry the total TDS deducted against this
      // party through the discovered TDS payable ledger. Used by the
      // amount-tie scorer below to link a Tally trade name to a
      // deductee whose name looks totally different (Shanker Furniture
      // ₹2,790 TDS ↔ SHANKARLAL ₹2,790 TDS).
      __voucher_tds_amount: p.tds_amount,
    });
  }

  if (expenseLedgers.length === 0) {
    return { mapped: 0, skipped: 0, confirmed: 0, pending: 0, needs_review: 0,
      message: "No expense/creditor ledgers found in Trial Balance" };
  }

  // 2. Fetch TDS deductees
  const { data: deducteeRows, error: dedErr } = await (supabase as any)
    .from("tds_deductees")
    // P2-E-lite (2026-08-05) — pull PAN too for the PAN-match short-circuit
    // in the matching loop below.
    .select("id,filing_id,deductee_name,deductee_pan,section_code,nature_of_payment,amount_paid_credited,tds_amount")
    .eq("client_id", client_id)
    .eq("financial_year", financial_year);
  if (dedErr) throw new Error(`TDS deductees fetch error: ${dedErr.message}`);

  if (!deducteeRows || deducteeRows.length === 0) {
    return { mapped: 0, skipped: expenseLedgers.length, confirmed: 0, pending: 0, needs_review: 0,
      message: "No TDS deductees found for this client/FY" };
  }

  const aggDeductees = aggregateDeducteesForMapper(deducteeRows);

  // 3. Already-mapped ledger names
  let alreadyMapped = new Set<string>();
  if (!force_rematch) {
    const { data: existing } = await (supabase as any)
      .from("tds_tb_party_mappings")
      .select("tb_ledger_name")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .not("mapping_status", "eq", "rejected");
    (existing || []).forEach((r: any) => alreadyMapped.add(r.tb_ledger_name));
  }

  // 4. Match — Issue 3: enforce nameScore ≥ 70; Issue 1: tighten "confirmed"
  // to require BOTH name AND amount tie-back; Issue 4: 194Q allowed for goods.
  const upsertRows: any[] = [];
  let skipped = 0;

  for (const tb of expenseLedgers) {
    // 2026-08-04 — voucher-derived candidates ALWAYS bypass the alreadyMapped
    // skip: they represent Journal-vs-TDS evidence the AI mapper may have
    // missed in prior runs (which walked only TB creditors). Skipping them
    // would silently perpetuate the RAY WINGS gap even after this fix.
    const isVoucherDerived   = (tb as any).__source === "voucher";
    // Phase 4b — a TB row can carry voucher evidence too when its Tally
    // name matched a party found during the voucher walk. Amount tie
    // fires for either signal.
    const hasVoucherEvidence = isVoucherDerived || (tb as any).__voucher_evidence === true;
    const voucherTds         = Number((tb as any).__voucher_tds_amount ?? 0);
    if (!isVoucherDerived && alreadyMapped.has(tb.ledger_name)) { skipped++; continue; }
    let best: {
      ded: AggDeductee; confidence: number; nameScore: number; amtScore: number;
      secScore: number; method: string; gstAdjusted: boolean;
      tdsAmtTie?: boolean;
    } | null = null;

    // P2-E-lite (2026-08-05) — extract a PAN token from the TB ledger name
    // (Tally clients sometimes name creditors like "SHANKARLAL - ABCPS1234N"
    // or "Vanraj Engineers ABCPV5678K"). Regex: 5 letters + 4 digits + 1
    // letter. Match against deductee_pan for a definitive short-circuit.
    const PAN_RE = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/i;
    const tbPanMatch = PAN_RE.exec(String(tb.ledger_name ?? ""));
    const tbPan     = tbPanMatch ? tbPanMatch[1].toUpperCase() : null;

    for (const ded of aggDeductees) {
      if (!ded.deductee_name) continue;
      const nameScore = tokenSortRatio(tb.ledger_name, ded.deductee_name);
      // PAN match: hard evidence. Bypasses all other floors.
      const panMatch = !!tbPan && !!ded.deductee_pan
        && tbPan === String(ded.deductee_pan).toUpperCase().trim();
      // Phase 4 — TDS AMOUNT TIE-BACK. Voucher-derived candidates carry the
      // exact TDS amount deducted against the party in Tally. If that number
      // matches a deductee's total_tds within ₹10 OR 2 %, we have a strong
      // link — even if the names look nothing alike (Shanker Furniture
      // ₹2,790 ↔ SHANKARLAL ₹2,790). Section must also agree. This bypasses
      // the nameScore floor entirely.
      // P2-D (2026-08-04) — three-tier TDS-amount tie:
      //   • tdsAmtTie  (exact, ≤ 2 %): confidence 85 → confirmed
      //   • tdsAmtNear (near, ≤ 10 %): confidence 60 → pending, name floor 25
      //   • tdsAmtLoose (loose, ≤ 30 %): confidence 45 → needs_review, name floor 40
      // Below 30 % gap the amount signal alone can't be trusted.
      let tdsAmtTie   = false;
      let tdsAmtNear  = false;
      let tdsAmtLoose = false;
      if (hasVoucherEvidence && voucherTds > 0 && ded.total_tds > 0) {
        const diff    = Math.abs(voucherTds - ded.total_tds);
        const ratio   = diff / Math.max(voucherTds, ded.total_tds);
        const sectionOk = !(tb as any).__voucher_section
          || !ded.section_code
          || String((tb as any).__voucher_section).replace(/[^0-9a-z]/gi, "").toUpperCase()
             === String(ded.section_code).replace(/[^0-9a-z]/gi, "").toUpperCase();
        if      (sectionOk && (diff <= 10 || ratio <= 0.02)) tdsAmtTie   = true;
        else if (sectionOk && ratio <= 0.10)                 tdsAmtNear  = true;
        else if (sectionOk && ratio <= 0.30)                 tdsAmtLoose = true;
      }
      // Issue 3: Require ≥ 70% name similarity — voucher-derived candidates
      // get 60% (hasVoucherEvidence extends to TB rows also seen in vouchers).
      //
      // AMOUNT-TIE OVERRIDES:
      //   • tdsAmtTie (exact, ≤ 2 %): bypass name floor entirely — the
      //     amounts are close enough that names couldn't reasonably matter.
      //   • tdsAmtNear (≤ 30 %): allow a lower floor (25 %) but STILL require
      //     some name kinship. Without this guard, a party with the "wrong"
      //     TDS amount (₹3,000 in vouchers vs SHANKARLAL's ₹3,535 filing)
      //     would beat its real match by having a slightly nearer amount
      //     even when the names have no relation. Requiring ≥ 25 % name
      //     similarity blocks that failure while keeping the intended fix
      //     (Shanker Furniture ↔ SHANKARLAL — both share "SHANKA" tokens
      //     giving them ≥ 25 %).
      // Name floors — P2-D three-tier tolerance:
      //   • no amount signal            → nameFloor (60 voucher / 70 TB)
      //   • tdsAmtTie (≤ 2 %)           → 0 (bypass entirely)
      //   • tdsAmtNear (≤ 10 %)         → 25 (some kinship still required)
      //   • tdsAmtLoose (≤ 30 %)        → 40 (stricter — the amount signal is weak)
      const nameFloor = hasVoucherEvidence ? 60 : 70;
      const nearNameFloor  = 25;
      const looseNameFloor = 40;
      // P2-E-lite — panMatch bypasses every name floor.
      if (!panMatch && !tdsAmtTie && !tdsAmtNear && !tdsAmtLoose && nameScore < nameFloor)  continue;
      if (!panMatch && tdsAmtNear  && !tdsAmtTie && nameScore < nearNameFloor)  continue;
      if (!panMatch && tdsAmtLoose && !tdsAmtTie && nameScore < looseNameFloor) continue;
      const tbActivity = Math.max(tb.debit_amount ?? 0, tb.credit_amount ?? 0);
      // Use GST-normalised gross comparison to avoid spurious mismatches
      const { score: amtScore, gstAdjusted } = grossAmountScore(tbActivity, ded.total_amount_paid);
      const secScore   = sectionContextScore(tb.parent_group, ded.section_code);
      // Base composite; overridden below when the TDS-amount tie fires
      // because it's a much stronger signal than fuzzy name/gross scores.
      let confidence = Math.round(nameScore * 0.50 + amtScore * 0.30 + secScore * 0.20);
      if (tdsAmtTie)   confidence = Math.max(confidence, 85);
      if (tdsAmtNear)  confidence = Math.max(confidence, 60); // pending
      if (tdsAmtLoose) confidence = Math.max(confidence, 45); // needs review
      if (panMatch)    confidence = Math.max(confidence, 95); // hard evidence
      if (confidence < 40) continue;
      if (!best || confidence > best.confidence) {
        const methods: string[] = [];
        if (panMatch)                                    methods.push("pan_match");
        if (nameScore >= (isVoucherDerived ? 60 : 70)) methods.push("name_similarity");
        if (amtScore  >= 75) methods.push("amount_ratio");
        if (secScore  >= 80) methods.push("section_context");
        if (hasVoucherEvidence) methods.push("voucher_evidence");
        if (tdsAmtTie)   methods.push("tds_amount_tie");
        if (tdsAmtNear)  methods.push("tds_amount_near");
        if (tdsAmtLoose) methods.push("tds_amount_loose");
        best = { ded, confidence, nameScore, amtScore, secScore, method: methods.join("+") || "ai_partial", gstAdjusted, tdsAmtTie: tdsAmtTie || panMatch /* PAN match is equivalent to exact-tie for the "confirmed" bothMatch gate */ };
      }
    }

    if (!best) {
      // 2026-08-04 Phase 6 — voucher-only party (RAY WINGS "Sulochana Manish
      // Pandey"): a Tally ledger against which TDS was deducted (₹1,570 in
      // a Journal against TDS PAY) but NO Form 26Q filing was made for
      // that deductee. Instead of silently skipping, write a placeholder
      // "books-only" row so the reconciliation engine surfaces this as a
      // Books > TDS (Books-only) flag. Real tb_ledger_name → View Ledger
      // works; tds_deductee_name carries a sentinel that the recon engine
      // treats as "no filed match".
      if (hasVoucherEvidence && voucherTds > 0) {
        booksOnlyWritten++;
        upsertRows.push({
          client_id, firm_id, financial_year,
          tb_ledger_name:    tb.ledger_name,
          tb_parent_group:   tb.parent_group,
          tb_total_debit:    Math.max(tb.debit_amount ?? 0, tb.credit_amount ?? 0) || null,
          tds_deductee_name: "(not filed)",
          tds_section_code:  (tb as any).__voucher_section ?? null,
          tds_total_amount:  null,
          tds_tds_amount:    null,
          tds_filing_ids:    null,
          match_confidence:  0,
          match_method:      "voucher_evidence+books_only",
          ai_reasoning:      `Tally shows TDS ₹${voucherTds.toFixed(0)} deducted against ${tb.ledger_name} across ${(tb as any).__voucher_count ?? 0} voucher(s), but no matching deductee found in Form 26Q filings. Books > TDS gap — auditor to reconcile.`,
          mapping_status:    "needs_review",
          mapped_by:         "ai",
        });
      }
      // P4-C (2026-08-05) — REMOVED. The original implementation flagged
      // any creditor with >= ₹1,00,000 combined TB activity, with zero
      // check for whether TDS could even apply. This caught goods-trading
      // parties (J N V Healthcare — GST Purchase / Sales vouchers, a pure
      // trading relationship) and any other high-value non-service vendor
      // (capital purchases, loan/deposit ledgers, etc.), producing a wall
      // of false "Books > TDS" flags with no real evidence behind them.
      // "TB activity size" is not a TDS-applicability signal — only a
      // paired service-expense Journal or an explicit 26Q filing is.
      // Re-introduce only when there is a real signal (e.g. the ledger's
      // parent_group or a paired expense leg indicates a services nature
      // AND the amount crosses the section's own threshold) — not before.
      skipped++;
      continue;
    }

    const tbActivity = Math.max(tb.debit_amount ?? 0, tb.credit_amount ?? 0);

    // Issue 1 (root-cause fix): "Confirmed" now requires ALL FOUR criteria —
    //   1. Strong name match (≥ 90 %)
    //   2. Gross amount match (≥ 75 %) — GST-normalised so TB (incl. GST) ÷ 1.18 is also accepted
    //   3. TDS was actually deducted in the filing (total_tds > 0)
    //   4. Implied TDS rate matches the section's prescribed rate
    //      (e.g. 194C ≈ 1-2 %, 194J ≈ 10 %). Without this check, the system
    //      auto-confirms party rows even when the TDS amount in the filing
    //      is for a different invoice/period than the TB ledger balance.
    const grossOk  = best.amtScore >= 75;
    const tdsOk    = best.ded.total_tds > 0;
    const rateOk   = tdsRateMatchesSection(best.ded.section_code, best.ded.total_amount_paid, best.ded.total_tds);
    // P1-D (2026-08-04) — the TDS-amount tie is a strong signal, but when
    // gross amounts diverge by > 40 % AND names don't clearly match, the
    // Tally ledger only PARTIALLY corresponds to that deductee (Vanraj
    // Engineers ₹10.4 L vs HARDIK's 26Q ₹5.8 L — Vanraj also paid other
    // parties). Downgrade to Pending so the recon engine still surfaces
    // the gap for audit review.
    const grossGap   = best.ded.total_amount_paid > 0
      ? Math.abs(tbActivity - best.ded.total_amount_paid) / Math.max(tbActivity, best.ded.total_amount_paid)
      : 0;
    const grossPartialTie = grossGap > 0.40 && best.nameScore < 60;
    // Phase 4 — a confirmed TDS-amount tie stands in for the name-similarity
    // 90 % floor UNLESS grossPartialTie fires (see above).
    const bothMatch = (best.tdsAmtTie && !grossPartialTie
      ? true
      : best.nameScore >= 90) && grossOk && tdsOk && rateOk;
    const mapping_status =
      bothMatch                          ? "confirmed"   :
      grossPartialTie                    ? "pending"     :
      best.confidence >= 60              ? "pending"     :
                                           "needs_review";

    // Build rich reasoning with difference explanation
    const diffNote = grossDifferenceReason(tbActivity, best.ded.total_amount_paid, best.ded.total_tds);
    const grossLabel = best.gstAdjusted
      ? `TB ₹${tbActivity.toFixed(0)} (incl. GST) ≈ TDS ₹${best.ded.total_amount_paid.toFixed(0)} after ÷1.18`
      : `TB ₹${tbActivity.toFixed(0)} vs TDS ₹${best.ded.total_amount_paid.toFixed(0)}`;
    const impliedRate = best.ded.total_amount_paid > 0
      ? ((best.ded.total_tds / best.ded.total_amount_paid) * 100).toFixed(2)
      : "—";
    const reasoning =
      `Name: ${best.nameScore}%, ` +
      `Gross amount: ${best.amtScore}% (${grossLabel}), ` +
      `TDS deducted: ₹${best.ded.total_tds.toFixed(0)} ` +
      `(implied rate ${impliedRate}% — ${rateOk ? "✓ matches" : "✗ does not match"} section ${best.ded.section_code ?? "?"}), ` +
      `Section context: ${best.secScore}% (group: "${tb.parent_group}"). ` +
      `Composite: ${best.confidence}%.` +
      (diffNote ? ` Analysis: ${diffNote}` : "");

    upsertRows.push({
      client_id, firm_id, financial_year,
      tb_ledger_name:    tb.ledger_name,
      tb_parent_group:   tb.parent_group,
      tb_total_debit:    tbActivity || null,
      tds_deductee_name: best.ded.deductee_name,
      tds_section_code:  best.ded.section_code,
      tds_total_amount:  best.ded.total_amount_paid || null,
      tds_tds_amount:    best.ded.total_tds || null,   // TDS deducted per filing
      tds_filing_ids:    best.ded.filing_ids,
      match_confidence:  best.confidence,
      match_method:      best.method,
      ai_reasoning:      reasoning,
      mapping_status,
      mapped_by: "ai",
    });
  }

  // 2026-08-04 Phase 3 — the "(unmapped: <deductee>)" placeholder rows
  // previously seeded here were REMOVED: they used a synthetic
  // tb_ledger_name that broke View Ledger (the drill returns "No
  // vouchers found for this ledger") and made the reconciliation engine
  // flag a phantom TDS>Books variance equal to the deductee's gross.
  // Deductees that have no matching Tally ledger are now surfaced by the
  // panel component as an "Unmapped deductees" section — a computed
  // in-memory list with a manual-link picker — and are only written to
  // tds_tb_party_mappings once the auditor picks the correct Tally
  // creditor (as a normal mapped_by="auditor" row).
  //
  // Real Tally ledgers derived from Journal vouchers against the TDS
  // payable (e.g. "Shanker Furniture" for SHANKARLAL) already flow
  // through the main matching loop above via the voucher-union step.

  // 2026-07-24 — root cause of Issues 9 & 12:
  //   • Auditor needed multiple Tally ledgers → same deductee (parties whose
  //     transactions are recorded under different names in Tally).
  //   • Auditor needed multiple sections → same deductee (a party billed
  //     under both 194C and 194J in the same FY).
  // The earlier "byDeductee|section" dedupe collapsed both cases. Since
  // the DB uniqueness key already covers (client, fy, tb_ledger, deductee)
  // — allowing N ledgers per deductee — we can safely upsert every row
  // the mapper produced. Deduplication now happens only within a single
  // (tb_ledger, deductee) pair (which the unique index handles).
  // P1-B / Stage-1 hotfix (2026-08-04) — dedupe: drop books_only rows for
  // TB ledgers that ALREADY have a real match, either in the current
  // upsert batch (this run auto-matched them) or in the DB (auditor
  // manually linked them earlier). Without the DB read, Shanker Furniture
  // manually linked to SHANKARLAL would still get a fresh books_only row
  // stamped on every mapper run.
  const matchedTbNames = new Set<string>(
    upsertRows
      .filter((r: any) => r.tds_deductee_name && r.tds_deductee_name !== "(not filed)")
      .map((r: any) => String(r.tb_ledger_name || "").trim().toLowerCase()),
  );
  try {
    const { data: existing } = await (supabase as any)
      .from("tds_tb_party_mappings")
      .select("tb_ledger_name,tds_deductee_name,match_method")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year);
    for (const r of (existing as any[]) || []) {
      if (!r.tds_deductee_name || r.tds_deductee_name === "(not filed)") continue;
      matchedTbNames.add(String(r.tb_ledger_name || "").trim().toLowerCase());
    }
  } catch { /* non-fatal */ }
  const finalRows = upsertRows.filter((r: any) => {
    if (!String(r.match_method || "").includes("books_only")) return true;
    const key = String(r.tb_ledger_name || "").trim().toLowerCase();
    return !matchedTbNames.has(key);
  });

  if (finalRows.length > 0) {
    // Try upsert with tds_tds_amount (requires migration 20260501000002 applied).
    // If the column doesn't exist yet, fall back gracefully by stripping it.
    const { error: upsertErr } = await (supabase as any)
      .from("tds_tb_party_mappings")
      .upsert(finalRows, { onConflict: "client_id,financial_year,tb_ledger_name,tds_deductee_name" });
    if (upsertErr) {
      if (upsertErr.message?.includes("tds_tds_amount")) {
        // Column not yet added — upsert without it (migration pending)
        const fallbackRows = finalRows.map(({ tds_tds_amount: _omit, ...r }: any) => r);
        const { error: fallbackErr } = await (supabase as any)
          .from("tds_tb_party_mappings")
          .upsert(fallbackRows, { onConflict: "client_id,financial_year,tb_ledger_name,tds_deductee_name" });
        if (fallbackErr) throw new Error(`Upsert error: ${fallbackErr.message}`);
      } else {
        throw new Error(`Upsert error: ${upsertErr.message}`);
      }
    }
  }

  return {
    mapped:       finalRows.length,
    skipped,
    confirmed:    finalRows.filter(r => r.mapping_status === "confirmed").length,
    pending:      finalRows.filter(r => r.mapping_status === "pending").length,
    needs_review: finalRows.filter(r => r.mapping_status === "needs_review").length,
    discovered_tds_ledgers: discoveredTdsLedgers.length,
    voucher_parties_added:  voucherPartiesAdded,
    books_only_written:     booksOnlyWritten,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Part 2 — TDS RECON ENGINE
// ══════════════════════════════════════════════════════════════════════════════

const G1_VARIANCE_AMOUNT_MIN = 10_000;
// Issue 9: TB activity is GST-inclusive (typical 18%), so allow a 20% tolerance
// before flagging a Goal-1 existence gap to prevent false positives.
const G1_VARIANCE_PCT_MIN    = 0.20;
const G2_TDS_VARIANCE_AMOUNT_MIN = 500;
const G2_TDS_VARIANCE_PCT_MIN    = 0.05;

const FALLBACK_RATE_TABLE: Record<string, { nature: string; threshold_individual: number; threshold_company: number; rate_individual: number; rate_company: number }> = {
  "192":   { nature: "Salary",                         threshold_individual: 250000, threshold_company: 250000, rate_individual: 0,   rate_company: 0   },
  "192A":  { nature: "PF Withdrawal",                  threshold_individual:  50000, threshold_company:  50000, rate_individual: 10,  rate_company: 10  },
  "193":   { nature: "Interest on Securities",         threshold_individual:  10000, threshold_company:  10000, rate_individual: 10,  rate_company: 10  },
  "194":   { nature: "Dividend",                       threshold_individual:   5000, threshold_company:   5000, rate_individual: 10,  rate_company: 10  },
  "194A":  { nature: "Interest (non-bank)",            threshold_individual:  50000, threshold_company:  50000, rate_individual: 10,  rate_company: 10  },
  "194C":  { nature: "Contractors",                    threshold_individual: 100000, threshold_company: 100000, rate_individual: 1,   rate_company: 2   },
  // 194H reduced to 2% w.e.f. 1-Oct-2024 (Finance (No.2) Act 2024).
  "194H":  { nature: "Commission / Brokerage",         threshold_individual:  15000, threshold_company:  15000, rate_individual: 2,   rate_company: 2   },
  "194I":  { nature: "Rent",                           threshold_individual: 240000, threshold_company: 240000, rate_individual: 10,  rate_company: 10  },
  "194IB": { nature: "Rent by Ind / HUF",              threshold_individual:  50000, threshold_company:  50000, rate_individual: 5,   rate_company: 5   },
  "194J":  { nature: "Professional / Technical Fees",  threshold_individual:  30000, threshold_company:  30000, rate_individual: 10,  rate_company: 10  },
  "194M":  { nature: "Commission/Prof by Ind/HUF",     threshold_individual:5000000, threshold_company:5000000, rate_individual: 5,   rate_company: 5   },
  "194Q":  { nature: "Purchase of Goods",              threshold_individual:5000000, threshold_company:5000000, rate_individual: 0.1, rate_company: 0.1 },
  "194R":  { nature: "Benefit / Perquisite",           threshold_individual:  20000, threshold_company:  20000, rate_individual: 10,  rate_company: 10  },
  "195":   { nature: "Non-resident Payments",          threshold_individual:      0, threshold_company:      0, rate_individual: 20,  rate_company: 20  },
};

function aggregateDeducteesForRecon(rows: any[]): Map<string, { deductee_name: string; section_code: string | null; total_amount_paid: number; total_tds: number; weighted_rate: number; primary_deductee_type: string | null; deductee_ids: string[] }> {
  const map = new Map<string, any>();
  for (const r of rows) {
    const key = `${(r.deductee_name || "").trim().toLowerCase()}|${r.section_code ?? ""}`;
    if (!map.has(key)) {
      map.set(key, { deductee_name: (r.deductee_name || "").trim(), section_code: r.section_code,
        total_amount_paid: 0, total_tds: 0, weighted_rate: 0, primary_deductee_type: r.deductee_type, deductee_ids: [] });
    }
    const agg = map.get(key)!;
    agg.total_amount_paid += r.amount_paid_credited ?? 0;
    agg.total_tds         += r.tds_amount           ?? 0;
    if (r.id && !agg.deductee_ids.includes(r.id)) agg.deductee_ids.push(r.id);
    if (r.deductee_type && !agg.primary_deductee_type) agg.primary_deductee_type = r.deductee_type;
  }
  for (const agg of map.values()) {
    agg.weighted_rate = agg.total_amount_paid > 0 ? (agg.total_tds / agg.total_amount_paid) * 100 : 0;
  }
  return map;
}

// Stage-5 hotfix (2026-08-06) — the system genuinely bifurcates several
// sections into (a)/(b) sub-codes (194J(a) Professional 10% / 194J(b)
// Technical 2%; 194C(a) Individual 1% / 194C(b) Others 2% — see migration
// 20260730180000). tds_deductees.section_code and mapping.tds_section_code
// carry these bifurcated forms, but the rate-override lookup, the
// VALID_RATE_MAP actual-rate self-correction, and the refined194JRate
// trigger all compared against the BARE section ("194J", "194C") — an
// exact-string mismatch that silently disabled every rate-correction path
// for any client whose deductees use bifurcated codes (which is the norm
// from FY 2026-27 onward). normalizeSectionBucket() strips the (a)/(b)
// suffix so every rate-lookup site operates on the same bucket key.
function normalizeSectionBucket(code: string | null | undefined): string {
  return String(code ?? "").replace(/\([a-z]\)$/i, "").trim().toUpperCase();
}

function isCompany(t: string | null): boolean {
  if (!t) return false;
  const lower = t.toLowerCase();
  // 2026-07-24 — treat an explicit "individual"/"huf" tag as the source of
  // truth so 194C picks the 1% rate. The earlier version defaulted every
  // unrecognised deductee_type to non-company (1%), but Tally frequently
  // ingests "Company" for every filing → every party got 2% and the
  // reconciliation showed a spurious short-deduction gap. Now we ONLY treat
  // as company when the tag positively matches company-like keywords.
  if (lower.includes("individual") || lower.includes("huf") ||
      lower.includes("prop") /* proprietor */ ||
      lower.includes("aop") || lower.includes("boi")) return false;
  return lower.includes("company") || lower.includes("co.") || lower.includes("pvt") ||
         lower.includes("limited") || lower.includes("firm") || lower.includes("llp");
}

// 2026-07-24 — 194J splits into "professional" (10%) and "technical / call-
// centre / software" (2%). Section code alone is ambiguous; use the
// mapping/deductee nature_of_payment / narrative to pick the sub-rate.
// Any other section falls through to the caller's rate.
const J_TECHNICAL_HINTS = /\b(technical|technical\s+service|call[\s-]?centre|call[\s-]?center|it\s+support|software\s+development|software\s+devt|helpdesk|helpline|maintenance|amc)\b/i;
function refined194JRate(natureOfPayment: string | null | undefined, deducteeName?: string | null, tbLedgerName?: string | null): number {
  const bag = `${natureOfPayment ?? ""} ${deducteeName ?? ""} ${tbLedgerName ?? ""}`;
  return J_TECHNICAL_HINTS.test(bag) ? 2 : 10;
}

function varianceConfidence(pct: number): number {
  if (pct >= 0.80) return 95; if (pct >= 0.50) return 85;
  if (pct >= 0.30) return 75; if (pct >= 0.20) return 65; return 55;
}

export interface ReconResult {
  flags_created: number; flags_preserved: number; goal1_flags: number; goal2_flags: number;
  mappings_analysed: number; message?: string;
}

export async function runReconEngine(params: {
  client_id: string; financial_year: string; firm_id: string; goals?: number[]; rerun?: boolean;
}): Promise<ReconResult> {
  const { client_id, financial_year, firm_id, goals = [1, 2] } = params;
  const goalNumbers = goals.filter(g => g === 1 || g === 2);

  // 1. Mappings — 2026-07-24: recon now considers BOTH "confirmed" and
  // "pending" mappings (auditors were creating manual "pending" mappings
  // and expecting them to reconcile — the old status filter silently
  // excluded them). "rejected" and "needs_review" still short-circuit.
  const { data: mappingRows, error: mapErr } = await (supabase as any)
    .from("tds_tb_party_mappings")
    .select("*")
    .eq("client_id", client_id)
    .eq("financial_year", financial_year)
    .in("mapping_status", ["confirmed", "pending"]);
  if (mapErr) throw new Error(`Mapping fetch: ${mapErr.message}`);

  const mappings = (mappingRows ?? []) as any[];
  if (mappings.length === 0) {
    return { flags_created: 0, flags_preserved: 0, goal1_flags: 0, goal2_flags: 0,
      mappings_analysed: 0, message: "No confirmed party mappings found. Run AI Mapper first and confirm mappings." };
  }

  // 2. TDS deductees
  const { data: deducteeRows, error: dedErr } = await (supabase as any)
    .from("tds_deductees")
    .select("id,deductee_name,section_code,amount_paid_credited,tds_amount,rate_of_tds,deductee_type")
    .eq("client_id", client_id)
    .eq("financial_year", financial_year);
  if (dedErr) throw new Error(`Deductee fetch: ${dedErr.message}`);
  const aggDeductees = aggregateDeducteesForRecon(deducteeRows ?? []);

  // 3. Rate master
  const { data: rateRows } = await (supabase as any)
    .from("tds_rate_master")
    .select("section_code,rate_individual,rate_company,threshold_individual,threshold_company,nature_of_payment")
    .eq("financial_year", financial_year)
    .eq("is_active", true);
  const dbRateMap = new Map<string, any>();
  for (const r of (rateRows ?? []) as any[]) { if (r.section_code) dbRateMap.set(r.section_code, r); }

  function getRateEntry(sec: string) {
    if (dbRateMap.has(sec)) { const r = dbRateMap.get(sec)!; return { nature: r.nature_of_payment ?? "", threshold_individual: r.threshold_individual ?? 0, threshold_company: r.threshold_company ?? 0, rate_individual: r.rate_individual ?? 0, rate_company: r.rate_company ?? 0 }; }
    return FALLBACK_RATE_TABLE[sec] ?? null;
  }

  // Stage 2.5 (2026-08-05) — auditor-confirmed rate overrides for 194C /
  // 194J parties. Consulted BEFORE any auto-detection (deductee_type,
  // refined194JRate, actual-rate self-correction), so the auditor's
  // judgement on Individual vs Company / Professional vs Technical is
  // authoritative. Keyed by tb_ledger_name + tds_deductee_name + section.
  const { data: overrideRows } = await (supabase as any)
    .from("tds_party_rate_overrides")
    .select("tb_ledger_name,tds_deductee_name,section_code,applicable_rate,applicable_nature")
    .eq("client_id",      client_id)
    .eq("financial_year", financial_year);
  const rateOverrideMap = new Map<string, { rate: number; nature: string | null }>();
  for (const r of (overrideRows as any[] | null) ?? []) {
    const key = `${String(r.tb_ledger_name || "").trim().toLowerCase()}|${String(r.tds_deductee_name || "").trim().toLowerCase()}|${r.section_code}`;
    rateOverrideMap.set(key, { rate: Number(r.applicable_rate) || 0, nature: r.applicable_nature ?? null });
  }
  const lookupRateOverride = (tb: string, ded: string, sec: string) =>
    rateOverrideMap.get(`${String(tb || "").trim().toLowerCase()}|${String(ded || "").trim().toLowerCase()}|${sec}`);

  // 4. Delete pending flags for requested goals
  await (supabase as any).from("tds_recon_flags").delete()
    .eq("client_id", client_id).eq("financial_year", financial_year)
    .eq("flag_status", "pending").in("goal_number", goalNumbers);

  // 5. Count preserved AND load their (mapping_id, flag_type, section, ded)
  // fingerprints so we can skip inserting a fresh pending twin for anything
  // the auditor has already disregarded / accepted / raised as a query.
  // 2026-07-24 — this was the root cause of "disregarded queries reappear
  // on every re-run": the delete above stripped only pending rows, and the
  // insert loop never checked for non-pending duplicates.
  const { count: preserved } = await (supabase as any)
    .from("tds_recon_flags")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client_id).eq("financial_year", financial_year)
    .in("goal_number", goalNumbers).neq("flag_status", "pending");
  const { data: closedFlags } = await (supabase as any)
    .from("tds_recon_flags")
    .select("mapping_id, flag_type, section_code, tds_deductee_name")
    .eq("client_id", client_id).eq("financial_year", financial_year)
    .in("goal_number", goalNumbers).neq("flag_status", "pending");
  const closedFingerprints = new Set<string>();
  for (const f of (closedFlags ?? []) as any[]) {
    closedFingerprints.add(`${f.mapping_id ?? ""}|${f.flag_type ?? ""}|${f.section_code ?? ""}|${(f.tds_deductee_name ?? "").toLowerCase()}`);
  }

  // 2026-08-01 — Scenario 1 (voucher-level section override): load the
  // auditor's per-voucher section decisions so books-side aggregation
  // can split a single mapping across multiple sections. The DB table
  // tds_voucher_classification is optional — if the migration hasn't
  // been applied on this environment the query fails silently and we
  // fall back to the mapping-default section for every voucher (i.e.
  // pre-Scenario-1 behaviour).
  const voucherClassByMapping = new Map<string, Array<{
    voucher_id: string;
    section_code_override: string | null;
    is_tds_applicable: boolean;
  }>>();
  try {
    const mappingIds = mappings.map(m => m.id).filter(Boolean);
    if (mappingIds.length > 0) {
      const { data: classRows } = await (supabase as any)
        .from("tds_voucher_classification")
        .select("mapping_id, voucher_id, section_code_override, is_tds_applicable")
        .eq("client_id", client_id).eq("financial_year", financial_year)
        .in("mapping_id", mappingIds);
      for (const c of (classRows ?? []) as any[]) {
        if (!voucherClassByMapping.has(c.mapping_id)) voucherClassByMapping.set(c.mapping_id, []);
        voucherClassByMapping.get(c.mapping_id)!.push({
          voucher_id: c.voucher_id,
          section_code_override: c.section_code_override ?? null,
          is_tds_applicable: c.is_tds_applicable !== false,
        });
      }
    }
  } catch { /* table missing — non-fatal */ }

  // 2026-08-01 — for each mapping that has any classification rows, fetch
  // the underlying vouchers so we can attribute rupees to the right
  // section. Cached by mapping so repeat lookups are avoided.
  const mappingVoucherAmounts = new Map<string, Map<string, number>>();
  const classifiedMappingIds = Array.from(voucherClassByMapping.keys());
  if (classifiedMappingIds.length > 0) {
    // Collate all voucher ids we need to fetch.
    const voucherIdSet = new Set<string>();
    for (const arr of voucherClassByMapping.values()) {
      for (const c of arr) voucherIdSet.add(c.voucher_id);
    }
    if (voucherIdSet.size > 0) {
      try {
        const voucherIds = Array.from(voucherIdSet);
        const amountById = new Map<string, number>();
        // PostgREST limits IN() batches; chunk by 400.
        for (let i = 0; i < voucherIds.length; i += 400) {
          const slice = voucherIds.slice(i, i + 400);
          const { data: vchData } = await (supabase as any)
            .from("tally_vouchers")
            .select("id, amount, line_items, party_ledger")
            .in("id", slice);
          for (const v of (vchData ?? []) as any[]) {
            amountById.set(v.id, Math.abs(Number(v.amount ?? 0)));
          }
        }
        for (const m of mappings) {
          const arr = voucherClassByMapping.get(m.id);
          if (!arr) continue;
          const perM = new Map<string, number>();
          for (const c of arr) perM.set(c.voucher_id, amountById.get(c.voucher_id) ?? 0);
          mappingVoucherAmounts.set(m.id, perM);
        }
      } catch { /* voucher fetch fail — non-fatal */ }
    }
  }

  // 6. Freshen the tb_total_debit snapshot for every confirmed / pending
  // mapping from the LATEST tally_trial_balance before running any goal.
  // Root cause of "Re-Tally-Sync doesn't refresh TDS Analytics": the
  // mapper wrote tb_total_debit once at match time and every subsequent
  // recon read that stale value; a later Tally re-sync updated
  // tally_trial_balance but the mapping snapshot was never re-hydrated,
  // so books-vs-TDS comparisons kept pointing at the old TB numbers.
  {
    const ledgerNames = Array.from(new Set(mappings.map(m => m.tb_ledger_name).filter(Boolean)));
    if (ledgerNames.length > 0) {
      const { data: freshTb } = await (supabase as any)
        .from("tally_trial_balance")
        .select("ledger_name,debit_amount,credit_amount")
        .eq("client_id", client_id).eq("financial_year", financial_year)
        .in("ledger_name", ledgerNames);
      const freshMap = new Map<string, number>();
      for (const r of (freshTb ?? []) as any[]) {
        const activity = Math.max(Number(r.debit_amount ?? 0), Number(r.credit_amount ?? 0));
        freshMap.set(r.ledger_name, activity);
      }
      for (const m of mappings) {
        const activity = freshMap.get(m.tb_ledger_name);
        if (activity != null && Math.abs((m.tb_total_debit ?? 0) - activity) > 0.5) {
          m.tb_total_debit = activity; // update in-memory
          // Best-effort persist so subsequent visits show the fresh number.
          void (supabase as any).from("tds_tb_party_mappings")
            .update({ tb_total_debit: activity })
            .eq("id", m.id);
        }
      }
    }
  }

  // 6. Build flags
  const newFlags: any[] = [];

  for (const mapping of mappings) {
    const dedKey = `${mapping.tds_deductee_name.trim().toLowerCase()}|${mapping.tds_section_code ?? ""}`;
    const ded = aggDeductees.get(dedKey);

    // 2026-08-01 — Scenario 1: pre-compute per-section rupee attribution
    // from any voucher classifications for this mapping. When no rows
    // exist, everything continues to fall to the mapping's default
    // section (backward compatible with pre-Scenario-1 clients).
    const classArr    = voucherClassByMapping.get(mapping.id) ?? [];
    const voucherAmts = mappingVoucherAmounts.get(mapping.id) ?? new Map<string, number>();
    // Sum of all classified vouchers' amounts (whether TDS-applicable or
    // not); used to subtract from the mapping total to derive the residual
    // that still belongs to the default section.
    let classifiedTotal = 0;
    const bookBySection = new Map<string, number>();
    for (const c of classArr) {
      const amt = voucherAmts.get(c.voucher_id) ?? 0;
      classifiedTotal += amt;
      if (!c.is_tds_applicable) continue;
      const sec = c.section_code_override ?? (mapping.tds_section_code ?? "");
      if (!sec) continue;
      bookBySection.set(sec, (bookBySection.get(sec) ?? 0) + amt);
    }
    // Any activity NOT classified stays under the mapping's default
    // section — that's the residual bucket.
    const rawBookForResidual = Math.max(0, (Number(mapping.tb_total_debit ?? 0)) - classifiedTotal);
    if (mapping.tds_section_code && rawBookForResidual > 0) {
      bookBySection.set(
        mapping.tds_section_code,
        (bookBySection.get(mapping.tds_section_code) ?? 0) + rawBookForResidual,
      );
    }
    const isSplit = classArr.length > 0 && bookBySection.size > 1;

    if (goalNumbers.includes(1)) {
      // Issue 9: TB book amount is GST-inclusive; normalise by stripping a typical
      // 18 % GST component so the existence comparison is on like-for-like bases.
      const rawBook = mapping.tb_total_debit ?? 0;
      const bookAmt = rawBook > 0 ? rawBook / 1.18 : 0;
      const tdsAmt  = ded?.total_amount_paid ?? mapping.tds_total_amount ?? 0;
      if (bookAmt > 0 || tdsAmt > 0) {
        const diff = bookAmt - tdsAmt; const absDiff = Math.abs(diff);
        const larger = Math.max(bookAmt, tdsAmt, 1); const pctDiff = absDiff / larger;
        if (absDiff >= G1_VARIANCE_AMOUNT_MIN && pctDiff >= G1_VARIANCE_PCT_MIN) {
          const flag_type = diff > 0 ? "entry_in_books_not_in_tds" : "entry_in_tds_not_in_books";
          const fp = `${mapping.id ?? ""}|${flag_type}|${mapping.tds_section_code ?? ""}|${(mapping.tds_deductee_name ?? "").toLowerCase()}`;
          if (closedFingerprints.has(fp)) { /* auditor already actioned this — skip */ } else
          newFlags.push({
            client_id, firm_id, financial_year, flag_type, goal_number: 1,
            tb_ledger_name: mapping.tb_ledger_name, tds_deductee_name: mapping.tds_deductee_name,
            section_code: mapping.tds_section_code, nature_of_payment: null,
            book_amount: bookAmt||null, tds_amount: tdsAmt||null,
            expected_tds: null, actual_tds: null, variance_amount: diff,
            expected_rate: null, actual_rate: null, threshold_amount: null,
            voucher_ids: [], deductee_ids: ded?.deductee_ids ?? [],
            mapping_id: mapping.id,
            ai_reasoning: diff > 0
              ? `TB ledger "${mapping.tb_ledger_name}" shows ₹${bookAmt.toLocaleString("en-IN")} activity, but TDS filings for "${mapping.tds_deductee_name}" only cover ₹${tdsAmt.toLocaleString("en-IN")} — gap of ₹${absDiff.toLocaleString("en-IN")} (${(pctDiff*100).toFixed(1)}%). Possible unreported payments in Tally.`
              : `TDS filings for "${mapping.tds_deductee_name}" cover ₹${tdsAmt.toLocaleString("en-IN")}, but TB ledger "${mapping.tb_ledger_name}" shows only ₹${bookAmt.toLocaleString("en-IN")} — gap of ₹${absDiff.toLocaleString("en-IN")} (${(pctDiff*100).toFixed(1)}%). Possible double-counting in TDS.`,
            ai_confidence: varianceConfidence(pctDiff),
            sample_narrations: [], flag_status: "pending",
          });
        }
      }
    }

    if (goalNumbers.includes(2) && mapping.tds_section_code) {
      // 2026-08-01 — Scenario 1: when the mapping has voucher-level
      // classifications, run Goal 2 per-section using the deductee's
      // TDS aggregates for THAT section (not the mapping default).
      // Each per-section iteration emits its own flag (or none), so
      // "ABC Pvt Ltd — 194C portion" and "ABC Pvt Ltd — 194J portion"
      // land as separate rows the auditor can action independently.
      if (isSplit) {
        for (const [sec, bookAmtForSec] of bookBySection) {
          if (bookAmtForSec <= 0) continue;
          const rateEntrySec = getRateEntry(sec);
          if (!rateEntrySec) continue;
          const dedKeySec = `${mapping.tds_deductee_name.trim().toLowerCase()}|${sec}`;
          const dedSec = aggDeductees.get(dedKeySec);
          const amtPaidSec   = dedSec?.total_amount_paid ?? 0;
          const actualTdsSec = dedSec?.total_tds ?? 0;
          if (amtPaidSec <= 0) continue;
          const isCompSec = isCompany(dedSec?.primary_deductee_type ?? null);
          let rateSec = isCompSec ? rateEntrySec.rate_company : rateEntrySec.rate_individual;
          const threshSec = isCompSec ? rateEntrySec.threshold_company : rateEntrySec.threshold_individual;
          // Stage-5 hotfix — bucket form so bifurcated codes (194J(b) etc.)
          // actually match the lookup tables below.
          const secBucket = normalizeSectionBucket(sec);
          // Stage 2.5 — auditor override wins first. Overrides are stored
          // under the bucket section, so look up with the same key.
          const overrideSec = lookupRateOverride(mapping.tb_ledger_name, mapping.tds_deductee_name, secBucket);
          if (overrideSec) {
            rateSec = overrideSec.rate;
          }
          // Stage-2 hotfix — same actual-rate self-correction as the
          // non-split path below. If actualRate matches any legit rate
          // for the section, re-align expected `rateSec` to it.
          const actualRateSec_pre = amtPaidSec > 0 ? (actualTdsSec / amtPaidSec) * 100 : 0;
          const VALID_RATE_MAP_S: Record<string, number[]> = {
            "192":   [], "192A": [10], "193": [10], "194":  [10],
            "194A":  [10], "194C": [1, 2], "194H": [2], "194I": [2, 10],
            "194IB": [5], "194J": [2, 10], "194M": [5], "194Q": [0.1],
            "194R":  [10], "195": [20],
          };
          const validForSecS = VALID_RATE_MAP_S[secBucket] ?? [];
          const rateMatchesAnyS = validForSecS.some(r => Math.abs(actualRateSec_pre - r) <= 0.30);
          if (!overrideSec && rateMatchesAnyS) {
            rateSec = validForSecS.reduce((a, b) =>
              Math.abs(actualRateSec_pre - a) < Math.abs(actualRateSec_pre - b) ? a : b
            );
          } else if (!overrideSec && secBucket === "194J") {
            rateSec = refined194JRate(
              (mapping as any).nature_of_payment ?? null,
              mapping.tds_deductee_name, mapping.tb_ledger_name,
            );
          }
          if (amtPaidSec <= threshSec) continue;
          const expectedTdsSec = amtPaidSec * rateSec / 100;
          if (expectedTdsSec <= 0) continue;
          const varianceSec = expectedTdsSec - actualTdsSec;
          const absVarSec = Math.abs(varianceSec);
          const varPctSec = absVarSec / expectedTdsSec;
          const actualRateSec = amtPaidSec > 0 ? (actualTdsSec / amtPaidSec) * 100 : 0;
          if (absVarSec >= G2_TDS_VARIANCE_AMOUNT_MIN && varPctSec >= G2_TDS_VARIANCE_PCT_MIN) {
            const flag_type = varianceSec > 0 ? "short_deduction" : "over_deduction";
            const fp = `${mapping.id ?? ""}|${flag_type}|${sec}|${(mapping.tds_deductee_name ?? "").toLowerCase()}`;
            if (closedFingerprints.has(fp)) continue;
            newFlags.push({
              client_id, firm_id, financial_year, flag_type, goal_number: 2,
              tb_ledger_name: mapping.tb_ledger_name,
              tds_deductee_name: mapping.tds_deductee_name,
              section_code: sec,
              nature_of_payment: rateEntrySec.nature,
              book_amount: amtPaidSec || null, tds_amount: null,
              expected_tds: expectedTdsSec, actual_tds: actualTdsSec || null,
              variance_amount: varianceSec,
              expected_rate: rateSec, actual_rate: actualRateSec || null,
              threshold_amount: threshSec, voucher_ids: [],
              deductee_ids: dedSec?.deductee_ids ?? [],
              mapping_id: mapping.id,
              ai_reasoning:
                `Split mapping — Section ${sec} portion. Deductee TDS filings under ${sec}: ` +
                `paid ₹${amtPaidSec.toLocaleString("en-IN")}, TDS ₹${actualTdsSec.toLocaleString("en-IN",{maximumFractionDigits:0})} ` +
                `(effective ${actualRateSec.toFixed(2)}%). Expected at ${rateSec}% = ₹${expectedTdsSec.toLocaleString("en-IN",{maximumFractionDigits:0})}. ` +
                `${varianceSec > 0 ? "Short" : "Over"}: ₹${absVarSec.toLocaleString("en-IN",{maximumFractionDigits:0})} (${(varPctSec*100).toFixed(1)}%).`,
              ai_confidence: varianceConfidence(varPctSec),
              sample_narrations: [], flag_status: "pending",
            });
          }
        }
        continue; // skip the single-section fall-through below
      }

      const rateEntry = getRateEntry(mapping.tds_section_code);
      if (!rateEntry) continue;
      const amtPaid   = ded?.total_amount_paid ?? mapping.tds_total_amount ?? 0;
      const actualTds = ded?.total_tds ?? 0;
      if (amtPaid <= 0) continue;
      const isComp = isCompany(ded?.primary_deductee_type ?? null);
      let rate     = isComp ? rateEntry.rate_company : rateEntry.rate_individual;
      const thresh = isComp ? rateEntry.threshold_company : rateEntry.threshold_individual;

      // Stage-5 hotfix — bucket form ("194J" from "194J(b)") used for every
      // rate-lookup site below so bifurcated codes actually match.
      const sectionBucket = normalizeSectionBucket(mapping.tds_section_code);

      // Stage 2.5 — auditor override wins. If the auditor confirmed a
      // rate for this party+section, use it directly and skip auto-
      // detection (refined194JRate, actual-rate self-correction). The
      // auditor's judgement is authoritative. Overrides are stored under
      // the bucket section (TdsReconFlagsPanel normalizes before saving),
      // so look up with the same bucket key.
      const override = lookupRateOverride(mapping.tb_ledger_name, mapping.tds_deductee_name, sectionBucket);
      if (override) {
        rate = override.rate;
      }
      // 2026-07-24 — 194J splits into professional (10%) and technical (2%).
      // Section code alone is ambiguous; consult the deductee's nature/name
      // and the TB ledger name for technical/software/call-centre hints so
      // "Professional Fees" isn't wrongly benchmarked at 2% and vice versa.
      if (!override && sectionBucket === "194J") {
        rate = refined194JRate(
          (mapping as any).nature_of_payment ?? null,
          mapping.tds_deductee_name,
          mapping.tb_ledger_name,
        );
      }
      // Stage-2 hotfix (2026-08-04) — the FILED nature/type is often wrong
      // (auditor typed "Technical Services" for a CA firm, or "Company" for
      // an individual). Rate-match against the ACTUAL implied rate as the
      // tie-breaker BEFORE flagging: if actual rate lands ≤ 0.30 pp from a
      // legitimate valid rate at this section, treat that as the intended
      // rate and skip the flag. Only genuine short/over-deduction stays.
      // 194J: {2, 10}. 194C: {1, 2}. 194H: {2}. 194I: {2, 10}. 194A: {10}.
      // 194Q: {0.1}. 195: {20}. Add more as sections come in scope.
      const actualRateForCheck = amtPaid > 0 ? (actualTds / amtPaid) * 100 : 0;
      const VALID_RATE_MAP: Record<string, number[]> = {
        "192":   [], "192A": [10], "193": [10], "194":  [10],
        "194A":  [10], "194C": [1, 2], "194H": [2], "194I": [2, 10],
        "194IB": [5], "194J": [2, 10], "194M": [5], "194Q": [0.1],
        "194R":  [10], "195": [20],
      };
      const validForSec = VALID_RATE_MAP[sectionBucket] ?? [];
      const rateMatchesAny = validForSec.some(r => Math.abs(actualRateForCheck - r) <= 0.30);
      // Skip self-correction when auditor override is set (their choice wins).
      if (!override && rateMatchesAny) {
        // The auditor actually deducted at one of the section's legitimate
        // rates. Re-align `rate` to that actual rate so the "expected"
        // computation below matches — no false variance.
        const closest = validForSec.reduce((a, b) =>
          Math.abs(actualRateForCheck - a) < Math.abs(actualRateForCheck - b) ? a : b
        );
        rate = closest;
      }
      if (amtPaid <= thresh) continue;
      const expectedTds = amtPaid * rate / 100;
      if (expectedTds <= 0) continue;
      const variance = expectedTds - actualTds; const absVar = Math.abs(variance); const varPct = absVar / expectedTds;
      const actualRate = amtPaid > 0 ? (actualTds / amtPaid) * 100 : 0;
      if (absVar >= G2_TDS_VARIANCE_AMOUNT_MIN && varPct >= G2_TDS_VARIANCE_PCT_MIN) {
        const flag_type = variance > 0 ? "short_deduction" : "over_deduction";
        const fp = `${mapping.id ?? ""}|${flag_type}|${mapping.tds_section_code ?? ""}|${(mapping.tds_deductee_name ?? "").toLowerCase()}`;
        if (closedFingerprints.has(fp)) { /* auditor already actioned this — skip */ } else
        newFlags.push({
          client_id, firm_id, financial_year, flag_type, goal_number: 2,
          tb_ledger_name: mapping.tb_ledger_name, tds_deductee_name: mapping.tds_deductee_name,
          section_code: mapping.tds_section_code, nature_of_payment: rateEntry.nature,
          book_amount: amtPaid||null, tds_amount: null,
          expected_tds: expectedTds, actual_tds: actualTds||null,
          variance_amount: variance, expected_rate: rate, actual_rate: actualRate||null,
          threshold_amount: thresh, voucher_ids: [], deductee_ids: ded?.deductee_ids ?? [],
          mapping_id: mapping.id,
          ai_reasoning: variance > 0
            ? `Section ${mapping.tds_section_code} (${rateEntry.nature}): Amount paid ₹${amtPaid.toLocaleString("en-IN")} > threshold ₹${thresh.toLocaleString("en-IN")}. Expected TDS at ${rate}% = ₹${expectedTds.toLocaleString("en-IN",{maximumFractionDigits:0})}. Actual TDS = ₹${actualTds.toLocaleString("en-IN",{maximumFractionDigits:0})} (effective rate ${actualRate.toFixed(2)}%). Short: ₹${absVar.toLocaleString("en-IN",{maximumFractionDigits:0})} (${(varPct*100).toFixed(1)}%).`
            : `Section ${mapping.tds_section_code} (${rateEntry.nature}): Amount paid ₹${amtPaid.toLocaleString("en-IN")}. Expected TDS at ${rate}% = ₹${expectedTds.toLocaleString("en-IN",{maximumFractionDigits:0})}. Actual TDS = ₹${actualTds.toLocaleString("en-IN",{maximumFractionDigits:0})} (effective rate ${actualRate.toFixed(2)}%). Over: ₹${absVar.toLocaleString("en-IN",{maximumFractionDigits:0})} (${(varPct*100).toFixed(1)}%).`,
          ai_confidence: varianceConfidence(varPct),
          sample_narrations: [], flag_status: "pending",
        });
      }

      // 2026-07-24 — Goal 2.b: books-vs-module TDS-ledger comparison.
      // When the TDS-payable line for this section in Tally (approximated
      // from the mapping's tds_tds_amount snapshot the AI mapper stashed
      // at match time) exceeds the actual TDS filed for the deductee by
      // more than the standard tolerance, raise a "books_tds_gt_module"
      // flag. Auditor's word-doc note #11: without this, extra TDS booked
      // in Tally against a deductee (but not filed) is silently swallowed.
      const booksTds = Number((mapping as any).tds_tds_amount ?? 0);
      if (booksTds > 0 && actualTds >= 0) {
        const gap = booksTds - actualTds;
        const gapAbs = Math.abs(gap);
        const gapPct = booksTds > 0 ? gapAbs / booksTds : 0;
        if (gap > 0 && gapAbs >= G2_TDS_VARIANCE_AMOUNT_MIN && gapPct >= G2_TDS_VARIANCE_PCT_MIN) {
          const flag_type = "books_tds_gt_module";
          const fp = `${mapping.id ?? ""}|${flag_type}|${mapping.tds_section_code ?? ""}|${(mapping.tds_deductee_name ?? "").toLowerCase()}`;
          if (!closedFingerprints.has(fp)) {
            newFlags.push({
              client_id, firm_id, financial_year, flag_type, goal_number: 2,
              tb_ledger_name: mapping.tb_ledger_name, tds_deductee_name: mapping.tds_deductee_name,
              section_code: mapping.tds_section_code, nature_of_payment: rateEntry.nature,
              book_amount: booksTds || null, tds_amount: actualTds || null,
              expected_tds: booksTds, actual_tds: actualTds || null,
              variance_amount: gap, expected_rate: null, actual_rate: null,
              threshold_amount: null, voucher_ids: [], deductee_ids: ded?.deductee_ids ?? [],
              mapping_id: mapping.id,
              ai_reasoning: `Section ${mapping.tds_section_code} (${rateEntry.nature}): TDS booked in Tally for "${mapping.tds_deductee_name}" = ₹${booksTds.toLocaleString("en-IN",{maximumFractionDigits:0})}, but TDS filed in the return = ₹${actualTds.toLocaleString("en-IN",{maximumFractionDigits:0})}. Extra ₹${gapAbs.toLocaleString("en-IN",{maximumFractionDigits:0})} deducted in books but not remitted / not reflected in the return.`,
              ai_confidence: varianceConfidence(gapPct),
              sample_narrations: [], flag_status: "pending",
            });
          }
        }
      }
    }
  }

  if (newFlags.length > 0) {
    const { error: insertErr } = await (supabase as any).from("tds_recon_flags").insert(newFlags);
    if (insertErr) throw new Error(`Flag insert error: ${insertErr.message}`);
  }

  return {
    flags_created: newFlags.length, flags_preserved: preserved ?? 0,
    goal1_flags: newFlags.filter(f => f.goal_number === 1).length,
    goal2_flags: newFlags.filter(f => f.goal_number === 2).length,
    mappings_analysed: mappings.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Part 3 — MISSING SCANNER
// ══════════════════════════════════════════════════════════════════════════════

interface HeuristicEntry { section: string; nature: string; rate: number; threshold: number; }
const SECTION_HEURISTICS: Record<string, HeuristicEntry> = {
  "salary":        { section:"192",  nature:"Salary",                     rate:0,    threshold:250000 },
  "wages":         { section:"192",  nature:"Salary / Wages",             rate:0,    threshold:250000 },
  "remuneration":  { section:"192",  nature:"Remuneration",               rate:0,    threshold:250000 },
  "contractor":    { section:"194C", nature:"Contractor Payments",        rate:1,    threshold:100000 },
  "labour":        { section:"194C", nature:"Labour Charges",             rate:1,    threshold:100000 },
  "contract":      { section:"194C", nature:"Contract Charges",           rate:1,    threshold:100000 },
  "freight":       { section:"194C", nature:"Freight / Transport",        rate:1,    threshold:100000 },
  "transport":     { section:"194C", nature:"Transport Charges",          rate:1,    threshold:100000 },
  "advertisement": { section:"194C", nature:"Advertisement",              rate:1,    threshold:100000 },
  "advertising":   { section:"194C", nature:"Advertising",                rate:1,    threshold:100000 },
  "maintenance":   { section:"194C", nature:"Maintenance / Repairs",      rate:1,    threshold:100000 },
  "security":      { section:"194C", nature:"Security Services",          rate:1,    threshold:100000 },
  "housekeeping":  { section:"194C", nature:"Housekeeping",               rate:1,    threshold:100000 },
  "manpower":      { section:"194C", nature:"Manpower Supply",            rate:1,    threshold:100000 },
  "catering":      { section:"194C", nature:"Catering Services",          rate:1,    threshold:100000 },
  "professional":  { section:"194J", nature:"Professional Fees",          rate:10,   threshold:30000  },
  "technical":     { section:"194J", nature:"Technical Services",         rate:2,    threshold:30000  },
  "consultancy":   { section:"194J", nature:"Consultancy",                rate:10,   threshold:30000  },
  "consulting":    { section:"194J", nature:"Consulting Services",        rate:10,   threshold:30000  },
  "legal":         { section:"194J", nature:"Legal / Professional",       rate:10,   threshold:30000  },
  "audit":         { section:"194J", nature:"Audit Fees",                 rate:10,   threshold:30000  },
  "software":      { section:"194J", nature:"Software Development / IT",  rate:2,    threshold:30000  },
  "royalty":       { section:"194J", nature:"Royalty",                    rate:10,   threshold:30000  },
  "outsourc":      { section:"194J", nature:"Outsourcing",                rate:10,   threshold:30000  },
  "commission":    { section:"194H", nature:"Commission / Brokerage",     rate:2,    threshold:15000  },
  "brokerage":     { section:"194H", nature:"Brokerage",                  rate:2,    threshold:15000  },
  "rent":          { section:"194I", nature:"Rent",                       rate:10,   threshold:240000 },
  "lease":         { section:"194I", nature:"Lease Rent",                 rate:10,   threshold:240000 },
  "interest":      { section:"194A", nature:"Interest (non-bank)",        rate:10,   threshold:50000  },
  "gift":          { section:"194R", nature:"Gift / Benefits",            rate:10,   threshold:20000  },
  "incentive":     { section:"194R", nature:"Incentive / Perquisite",     rate:10,   threshold:20000  },
};

const GROUP_SECTION_CONTEXT: Array<{ token: string; sections: string[] }> = [
  { token:"salary",       sections:["192"]  },
  { token:"contractor",   sections:["194C"] },
  { token:"professional", sections:["194J"] },
  { token:"commission",   sections:["194H"] },
  { token:"rent",         sections:["194I"] },
  { token:"interest",     sections:["194A"] },
  { token:"indirect",     sections:["194C","194J","194H","194I"] },
  { token:"direct",       sections:["194C","194J"] },
  { token:"purchase",     sections:["194C"] },
];

function groupBoost(pg: string | null, section: string): number {
  if (!pg) return 0;
  const lower = pg.toLowerCase();
  for (const ctx of GROUP_SECTION_CONTEXT) {
    if (lower.includes(ctx.token) && ctx.sections.includes(section)) return 15;
  }
  return 0;
}

function scoreHeuristics(ledgerName: string, parentGroup: string | null): { section: string; nature: string; rate: number; threshold: number; confidence: number; keywords: string[] } | null {
  const tokens = ledgerName.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length > 2);
  if (tokens.length === 0) return null;
  const bySection = new Map<string, { score: number; entry: HeuristicEntry; keywords: string[] }>();
  for (const token of tokens) {
    for (const [kw, entry] of Object.entries(SECTION_HEURISTICS)) {
      let s = 0;
      if (token === kw) s = 80;
      else if (token.startsWith(kw) || kw.startsWith(token)) s = 65;
      else if (token.includes(kw) || kw.includes(token)) s = 45;
      if (!s) continue;
      const ex = bySection.get(entry.section);
      if (!ex) { bySection.set(entry.section, { score: s, entry, keywords: [kw] }); }
      else { ex.score = Math.min(95, ex.score + s * 0.5); ex.keywords = [...new Set([...ex.keywords, kw])]; }
    }
  }
  if (!bySection.size) return null;
  let best: { section: string; score: number; entry: HeuristicEntry; keywords: string[] } | null = null;
  for (const [sec, acc] of bySection) {
    if (!best || acc.score > best.score) best = { section: sec, ...acc };
  }
  if (!best) return null;
  const boost = groupBoost(parentGroup, best.section);
  return { section: best.section, nature: best.entry.nature, rate: best.entry.rate, threshold: best.entry.threshold, confidence: Math.min(95, Math.round(best.score + boost)), keywords: best.keywords };
}

export interface ScannerResult {
  scanned: number; excluded_mapped: number; flagged: number; estimated_total_tds: number; message?: string;
}

export async function runMissingScanner(params: {
  client_id: string; financial_year: string; firm_id: string;
  confidence_threshold?: number; rescan?: boolean;
}): Promise<ScannerResult> {
  const { client_id, financial_year, firm_id, confidence_threshold = 40 } = params;

  // 1. TB ledgers — PAGINATE (PostgREST caps a single response at 1000 rows;
  // un-paginated, missing-TDS flags were never raised for ledgers past row 1000).
  const tbRows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: tbErr } = await (supabase as any)
      .from("tally_trial_balance")
      .select("ledger_name,parent_group,debit_amount,credit_amount,closing_balance,balance_type")
      .eq("client_id", client_id).eq("financial_year", financial_year)
      .range(from, from + 999);
    if (tbErr) throw new Error(`TB fetch error: ${tbErr.message}`);
    if (!data || !data.length) break;
    tbRows.push(...data);
    if (data.length < 1000) break;
  }

  const expenseLedgers = (tbRows as any[]).filter(l => isExpenseGroup(l.parent_group));
  if (expenseLedgers.length === 0) {
    return { scanned: 0, excluded_mapped: 0, flagged: 0, estimated_total_tds: 0, message: "No expense/creditor ledgers found in Trial Balance." };
  }

  // 2. Already-mapped
  const { data: mappedRows } = await (supabase as any)
    .from("tds_tb_party_mappings")
    .select("tb_ledger_name")
    .eq("client_id", client_id).eq("financial_year", financial_year)
    .in("mapping_status", ["confirmed","pending"]);
  const mappedNames = new Set(((mappedRows ?? []) as any[]).map(r => r.tb_ledger_name));

  // 3. Delete pending Goal 3 flags
  await (supabase as any).from("tds_recon_flags").delete()
    .eq("client_id", client_id).eq("financial_year", financial_year)
    .eq("goal_number", 3).eq("flag_status", "pending");

  // 4. Score each unmapped ledger
  const newFlags: any[] = [];
  let excluded_mapped = 0, scanned = 0;

  for (const tb of expenseLedgers) {
    if (mappedNames.has(tb.ledger_name)) { excluded_mapped++; continue; }
    scanned++;
    const match = scoreHeuristics(tb.ledger_name, tb.parent_group);
    if (!match || match.confidence < confidence_threshold) continue;
    const activity = Math.max(tb.debit_amount ?? 0, tb.credit_amount ?? 0);
    if (activity > 0 && activity <= match.threshold) continue;
    const estimatedTds = match.rate > 0 && activity > match.threshold ? Math.round(activity * match.rate / 100) : 0;
    newFlags.push({
      client_id, firm_id, financial_year,
      flag_type: "missing_tds_obligation", goal_number: 3,
      tb_ledger_name: tb.ledger_name, tds_deductee_name: null,
      section_code: match.section, nature_of_payment: match.nature,
      book_amount: activity||null, tds_amount: null,
      expected_tds: estimatedTds||null, actual_tds: 0,
      variance_amount: estimatedTds||null, expected_rate: match.rate||null, actual_rate: 0,
      threshold_amount: match.threshold||null, voucher_ids: [], deductee_ids: [], mapping_id: null,
      ai_reasoning: `Ledger "${tb.ledger_name}" (group: "${tb.parent_group ?? "—"}") matched keywords [${match.keywords.join(", ")}] → inferred Section ${match.section} (${match.nature}). Annual activity: ₹${activity.toLocaleString("en-IN",{maximumFractionDigits:0})}${match.threshold > 0 ? ` exceeds threshold ₹${match.threshold.toLocaleString("en-IN")}.` : "."}${estimatedTds > 0 ? ` Estimated TDS @ ${match.rate}% = ₹${estimatedTds.toLocaleString("en-IN")}.` : " TDS rate is slab-based."} No TDS filing entry found for this ledger.`,
      ai_confidence: match.confidence, sample_narrations: [], flag_status: "pending",
    });
  }

  if (newFlags.length > 0) {
    const { error: insertErr } = await (supabase as any).from("tds_recon_flags").insert(newFlags);
    if (insertErr) throw new Error(`Insert error: ${insertErr.message}`);
  }

  return { scanned, excluded_mapped, flagged: newFlags.length, estimated_total_tds: newFlags.reduce((s, f) => s + (f.expected_tds || 0), 0) };
}

// ══════════════════════════════════════════════════════════════════════════════
// Part 4 — DEMAND CALCULATOR
// ══════════════════════════════════════════════════════════════════════════════

const INTEREST_RATE_NOT_DEDUCTED = 0.01;
const INTEREST_RATE_LATE_PAYMENT = 0.015;
const LATE_FEE_PER_DAY           = 200;

const QUARTER_DUE = [
  { startMM: 4,  endMM: 6,  dueDay: 31, dueMM: 7,  dueFY: "same" as const },
  { startMM: 7,  endMM: 9,  dueDay: 31, dueMM: 10, dueFY: "same" as const },
  { startMM: 10, endMM: 12, dueDay: 31, dueMM: 1,  dueFY: "next" as const },
  { startMM: 1,  endMM: 3,  dueDay: 31, dueMM: 5,  dueFY: "next" as const },
];

function daysBetween(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / 86_400_000); }
function ceilMonths(days: number): number { return Math.max(1, Math.ceil(days / 30)); }

function parseFY(fy: string): { startYear: number; endYear: number } {
  const parts = fy.split("-");
  const sy = parseInt(parts[0], 10);
  const eyStr = parts[1] ?? String(sy + 1).slice(-2);
  const ey = eyStr.length === 2 ? Math.floor(sy / 100) * 100 + parseInt(eyStr, 10) : parseInt(eyStr, 10);
  return { startYear: sy, endYear: ey };
}

function guessDeductibleDate(fy: string): Date {
  const { startYear } = parseFY(fy);
  return new Date(`${startYear}-10-01`);
}

function quarterlyDueDate(paymentMonth: number, fy: string): Date {
  const { startYear, endYear } = parseFY(fy);
  for (const q of QUARTER_DUE) {
    if (paymentMonth >= q.startMM && paymentMonth <= q.endMM) {
      const dueYear = q.dueFY === "next" ? endYear : startYear;
      return new Date(`${dueYear}-${String(q.dueMM).padStart(2, "0")}-${q.dueDay}`);
    }
  }
  return new Date(`${endYear}-05-31`);
}

function compute201(shortfall: number, deductibleDate: Date, deductionDate: Date | null, paymentDate: Date | null, computationDate: Date): { interestAmt: number; months: number; rate: number; note: string } {
  if (shortfall <= 0) return { interestAmt: 0, months: 0, rate: 0, note: "No shortfall" };
  if (!deductionDate) {
    const days = Math.max(0, daysBetween(deductibleDate, computationDate));
    const months = ceilMonths(days);
    return { interestAmt: Math.round(shortfall * INTEREST_RATE_NOT_DEDUCTED * months), months, rate: INTEREST_RATE_NOT_DEDUCTED * 100, note: `1%/month × ${months} months (not deducted; ${days} days)` };
  }
  if (!paymentDate) {
    const days = Math.max(0, daysBetween(deductionDate, computationDate));
    const months = ceilMonths(days);
    return { interestAmt: Math.round(shortfall * INTEREST_RATE_LATE_PAYMENT * months), months, rate: INTEREST_RATE_LATE_PAYMENT * 100, note: `1.5%/month × ${months} months (deducted not paid; ${days} days)` };
  }
  const days1 = Math.max(0, daysBetween(deductibleDate, deductionDate)); const months1 = ceilMonths(days1);
  const days2 = Math.max(0, daysBetween(deductionDate, paymentDate)); const months2 = days2 > 0 ? ceilMonths(days2) : 0;
  return { interestAmt: Math.round(shortfall * INTEREST_RATE_NOT_DEDUCTED * months1) + Math.round(shortfall * INTEREST_RATE_LATE_PAYMENT * months2), months: months1 + months2, rate: 0, note: `1%×${months1}mo + 1.5%×${months2}mo` };
}

function compute234E(shortfall: number, dueDate: Date, computationDate: Date): number {
  if (computationDate <= dueDate) return 0;
  return Math.round(Math.max(0, Math.min(LATE_FEE_PER_DAY * daysBetween(dueDate, computationDate), shortfall)));
}

export interface DemandCalcResult {
  items_created: number; shortfall_total: number; interest_201_1a_total: number;
  fee_234e_total: number; grand_total_demand: number; computation_date: string;
}

export async function runDemandCalculator(params: {
  client_id: string; financial_year: string; firm_id: string;
  computation_date?: string; assume_not_paid?: boolean;
}): Promise<DemandCalcResult> {
  const { client_id, financial_year, firm_id, computation_date, assume_not_paid = true } = params;
  const compDate = computation_date ? new Date(computation_date) : new Date();

  // 1. Load applicable flags
  // Issue 7: Compute demand ONLY where the short_deduction / missing flag has
  // been explicitly confirmed by the auditor (flag_status = 'accepted').
  const { data: flags, error: flagErr } = await (supabase as any)
    .from("tds_recon_flags")
    .select("*")
    .eq("client_id", client_id)
    .eq("financial_year", financial_year)
    .in("flag_type", ["short_deduction","missing_tds_obligation"])
    .eq("flag_status", "accepted");
  if (flagErr) throw new Error(flagErr.message);

  const sourceFlags = (flags ?? []) as any[];
  if (sourceFlags.length === 0) {
    await (supabase as any).from("tds_demand_items").delete()
      .eq("client_id", client_id).eq("financial_year", financial_year);
    return { items_created: 0, shortfall_total: 0, interest_201_1a_total: 0, fee_234e_total: 0, grand_total_demand: 0, computation_date: compDate.toISOString().slice(0,10) };
  }

  // 2. Compute items
  const items: any[] = [];
  for (const flag of sourceFlags) {
    const isShort   = flag.flag_type === "short_deduction";
    const isMissing = flag.flag_type === "missing_tds_obligation";
    let shortfall = 0;
    if (isShort)   shortfall = Math.max(0, (flag.expected_tds ?? 0) - (flag.actual_tds ?? 0));
    if (isMissing) shortfall = flag.expected_tds ?? 0;
    if (shortfall <= 0) continue;

    const deductibleDate = guessDeductibleDate(financial_year);
    const deductionDate: Date | null = (isShort && !assume_not_paid) ? deductibleDate : null;
    const paymentDate: Date | null = null;

    const interestResult = compute201(shortfall, deductibleDate, deductionDate, paymentDate, compDate);
    const dueDate = quarterlyDueDate(10, financial_year);
    const fee234e = compute234E(shortfall, dueDate, compDate);
    const lateDays = compDate > dueDate ? daysBetween(dueDate, compDate) : 0;

    items.push({
      client_id, firm_id, financial_year,
      flag_id: flag.id, flag_type: flag.flag_type,
      goal_number: flag.goal_number ?? (isMissing ? 3 : 2),
      tb_ledger_name: flag.tb_ledger_name, tds_deductee_name: flag.tds_deductee_name,
      section_code: flag.section_code, nature_of_payment: flag.nature_of_payment,
      tds_shortfall: shortfall, amount_paid: flag.book_amount,
      deductible_date: deductibleDate.toISOString().slice(0,10),
      deduction_date: deductionDate?.toISOString().slice(0,10) ?? null,
      payment_date: paymentDate?.toISOString().slice(0,10) ?? null,
      computation_date: compDate.toISOString().slice(0,10),
      interest_rate_pct: interestResult.rate, interest_months: interestResult.months,
      interest_201_1a: interestResult.interestAmt, late_filing_days: lateDays, fee_234e: fee234e,
      total_demand: shortfall + interestResult.interestAmt + fee234e,
      computation_note: interestResult.note, item_status: "computed",
    });
  }

  // 3. Idempotent save
  await (supabase as any).from("tds_demand_items").delete()
    .eq("client_id", client_id).eq("financial_year", financial_year).eq("item_status", "computed");

  if (items.length > 0) {
    const { error: insErr } = await (supabase as any).from("tds_demand_items").insert(items);
    if (insErr) throw new Error(insErr.message);
  }

  return {
    items_created: items.length,
    shortfall_total: Math.round(items.reduce((s, i) => s + i.tds_shortfall, 0)),
    interest_201_1a_total: Math.round(items.reduce((s, i) => s + i.interest_201_1a, 0)),
    fee_234e_total: Math.round(items.reduce((s, i) => s + i.fee_234e, 0)),
    grand_total_demand: Math.round(items.reduce((s, i) => s + i.total_demand, 0)),
    computation_date: compDate.toISOString().slice(0,10),
  };
}
