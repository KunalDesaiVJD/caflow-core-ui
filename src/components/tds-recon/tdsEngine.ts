/**
 * tdsEngine.ts
 *
 * Client-side TypeScript port of all 4 TDS edge functions.
 * Runs in the browser using the user's JWT (passes RLS).
 * Replaces: tds-ai-mapper, tds-recon-engine, tds-missing-scanner, tds-demand-calculator
 */
import { supabase } from "@/integrations/supabase/client";

// ─── Shared helpers ───────────────────────────────────────────────────────────

const EXPENSE_TOKENS = [
  "expense","indirect","direct","creditor","manufacturing","trading",
  "administrative","selling","salary","wages","rent","commission","professional",
  "maintenance","contractor","service","freight","transport","advertisement",
  "advertising","outsource","miscellaneous","other","general",
];
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
    const key = `${(r.deductee_name || "").trim()}|${r.section_code ?? ""}`;
    if (!map.has(key)) {
      map.set(key, {
        deductee_name:     (r.deductee_name || "").trim(),
        section_code:      r.section_code,
        nature_of_payment: r.nature_of_payment,
        total_amount_paid: 0, total_tds: 0,
        filing_ids: [], deductee_ids: [],
      });
    }
    const agg = map.get(key)!;
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
}

export async function runAiMapper(params: {
  client_id: string; financial_year: string; firm_id: string; force_rematch?: boolean;
}): Promise<MapperResult> {
  const { client_id, financial_year, firm_id, force_rematch = false } = params;

  // 1. Fetch Trial Balance ledgers
  const { data: tbRows, error: tbErr } = await (supabase as any)
    .from("tally_trial_balance")
    .select("ledger_name,parent_group,debit_amount,credit_amount,closing_balance,balance_type")
    .eq("client_id", client_id)
    .eq("financial_year", financial_year);
  if (tbErr) throw new Error(`TB fetch error: ${tbErr.message}`);

  const expenseLedgers = (tbRows || []).filter((l: any) => isExpenseGroup(l.parent_group));
  if (expenseLedgers.length === 0) {
    return { mapped: 0, skipped: 0, confirmed: 0, pending: 0, needs_review: 0,
      message: "No expense/creditor ledgers found in Trial Balance" };
  }

  // 2. Fetch TDS deductees
  const { data: deducteeRows, error: dedErr } = await (supabase as any)
    .from("tds_deductees")
    .select("id,filing_id,deductee_name,section_code,nature_of_payment,amount_paid_credited,tds_amount")
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
    if (alreadyMapped.has(tb.ledger_name)) { skipped++; continue; }
    let best: {
      ded: AggDeductee; confidence: number; nameScore: number; amtScore: number;
      secScore: number; method: string; gstAdjusted: boolean;
    } | null = null;

    for (const ded of aggDeductees) {
      if (!ded.deductee_name) continue;
      const nameScore = tokenSortRatio(tb.ledger_name, ded.deductee_name);
      // Issue 3: Require ≥ 70% name similarity
      if (nameScore < 70) continue;
      const tbActivity = Math.max(tb.debit_amount ?? 0, tb.credit_amount ?? 0);
      // Use GST-normalised gross comparison to avoid spurious mismatches
      const { score: amtScore, gstAdjusted } = grossAmountScore(tbActivity, ded.total_amount_paid);
      const secScore   = sectionContextScore(tb.parent_group, ded.section_code);
      const confidence = Math.round(nameScore * 0.50 + amtScore * 0.30 + secScore * 0.20);
      if (confidence < 40) continue;
      if (!best || confidence > best.confidence) {
        const methods: string[] = [];
        if (nameScore >= 70) methods.push("name_similarity");
        if (amtScore  >= 75) methods.push("amount_ratio");
        if (secScore  >= 80) methods.push("section_context");
        best = { ded, confidence, nameScore, amtScore, secScore, method: methods.join("+") || "ai_partial", gstAdjusted };
      }
    }

    if (!best) { skipped++; continue; }

    const tbActivity = Math.max(tb.debit_amount ?? 0, tb.credit_amount ?? 0);

    // "Confirmed" requires ALL three:
    //   1. Strong name match (≥ 90%)
    //   2. Gross amount match (≥ 75%) — GST-normalised so TB (incl. GST) ÷ 1.18 is also accepted
    //   3. TDS was actually deducted in the filing (total_tds > 0)
    const grossOk  = best.amtScore >= 75;
    const tdsOk    = best.ded.total_tds > 0;
    const bothMatch = best.nameScore >= 90 && grossOk && tdsOk;
    const mapping_status =
      bothMatch                    ? "confirmed"   :
      best.confidence >= 60        ? "pending"     :
                                     "needs_review";

    // Build rich reasoning with difference explanation
    const diffNote = grossDifferenceReason(tbActivity, best.ded.total_amount_paid, best.ded.total_tds);
    const grossLabel = best.gstAdjusted
      ? `TB ₹${tbActivity.toFixed(0)} (incl. GST) ≈ TDS ₹${best.ded.total_amount_paid.toFixed(0)} after ÷1.18`
      : `TB ₹${tbActivity.toFixed(0)} vs TDS ₹${best.ded.total_amount_paid.toFixed(0)}`;
    const reasoning =
      `Name: ${best.nameScore}%, ` +
      `Gross amount: ${best.amtScore}% (${grossLabel}), ` +
      `TDS deducted: ₹${best.ded.total_tds.toFixed(0)}, ` +
      `Section: ${best.secScore}% (group: "${tb.parent_group}", section: ${best.ded.section_code ?? "n/a"}). ` +
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

  // Issue 2: Dedupe rows that map the same deductee from multiple TB ledgers —
  // prefer the row whose parent group looks like a "creditor / sundry creditor"
  // (party ledger), so the same expense doesn't appear twice.
  const byDeductee = new Map<string, any[]>();
  for (const r of upsertRows) {
    const k = `${r.tds_deductee_name}|${r.tds_section_code ?? ""}`;
    if (!byDeductee.has(k)) byDeductee.set(k, []);
    byDeductee.get(k)!.push(r);
  }
  const finalRows: any[] = [];
  for (const rows of byDeductee.values()) {
    if (rows.length === 1) { finalRows.push(rows[0]); continue; }
    const isCreditor = (pg: string | null) => (pg || "").toLowerCase().includes("creditor");
    const creditorRows = rows.filter(r => isCreditor(r.tb_parent_group));
    if (creditorRows.length > 0) {
      // pick highest-confidence creditor row
      creditorRows.sort((a, b) => b.match_confidence - a.match_confidence);
      finalRows.push(creditorRows[0]);
    } else {
      rows.sort((a, b) => b.match_confidence - a.match_confidence);
      finalRows.push(rows[0]);
    }
  }

  if (finalRows.length > 0) {
    const { error: upsertErr } = await (supabase as any)
      .from("tds_tb_party_mappings")
      .upsert(finalRows, { onConflict: "client_id,financial_year,tb_ledger_name,tds_deductee_name" });
    if (upsertErr) throw new Error(`Upsert error: ${upsertErr.message}`);
  }

  return {
    mapped:       finalRows.length,
    skipped,
    confirmed:    finalRows.filter(r => r.mapping_status === "confirmed").length,
    pending:      finalRows.filter(r => r.mapping_status === "pending").length,
    needs_review: finalRows.filter(r => r.mapping_status === "needs_review").length,
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
  "194H":  { nature: "Commission / Brokerage",         threshold_individual:  15000, threshold_company:  15000, rate_individual: 5,   rate_company: 5   },
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

function isCompany(t: string | null): boolean {
  if (!t) return false;
  const lower = t.toLowerCase();
  return lower.includes("company") || lower.includes("co.") || lower.includes("pvt") ||
         lower.includes("limited") || lower.includes("firm") || lower.includes("llp");
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

  // 1. Confirmed mappings
  const { data: mappingRows, error: mapErr } = await (supabase as any)
    .from("tds_tb_party_mappings")
    .select("*")
    .eq("client_id", client_id)
    .eq("financial_year", financial_year)
    .eq("mapping_status", "confirmed");
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

  // 4. Delete pending flags for requested goals
  await (supabase as any).from("tds_recon_flags").delete()
    .eq("client_id", client_id).eq("financial_year", financial_year)
    .eq("flag_status", "pending").in("goal_number", goalNumbers);

  // 5. Count preserved
  const { count: preserved } = await (supabase as any)
    .from("tds_recon_flags")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client_id).eq("financial_year", financial_year)
    .in("goal_number", goalNumbers).neq("flag_status", "pending");

  // 6. Build flags
  const newFlags: any[] = [];

  for (const mapping of mappings) {
    const dedKey = `${mapping.tds_deductee_name.trim().toLowerCase()}|${mapping.tds_section_code ?? ""}`;
    const ded = aggDeductees.get(dedKey);

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
      const rateEntry = getRateEntry(mapping.tds_section_code);
      if (!rateEntry) continue;
      const amtPaid   = ded?.total_amount_paid ?? mapping.tds_total_amount ?? 0;
      const actualTds = ded?.total_tds ?? 0;
      if (amtPaid <= 0) continue;
      const isComp = isCompany(ded?.primary_deductee_type ?? null);
      const rate   = isComp ? rateEntry.rate_company : rateEntry.rate_individual;
      const thresh = isComp ? rateEntry.threshold_company : rateEntry.threshold_individual;
      if (amtPaid <= thresh) continue;
      const expectedTds = amtPaid * rate / 100;
      if (expectedTds <= 0) continue;
      const variance = expectedTds - actualTds; const absVar = Math.abs(variance); const varPct = absVar / expectedTds;
      const actualRate = amtPaid > 0 ? (actualTds / amtPaid) * 100 : 0;
      if (absVar >= G2_TDS_VARIANCE_AMOUNT_MIN && varPct >= G2_TDS_VARIANCE_PCT_MIN) {
        const flag_type = variance > 0 ? "short_deduction" : "over_deduction";
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
  "commission":    { section:"194H", nature:"Commission / Brokerage",     rate:5,    threshold:15000  },
  "brokerage":     { section:"194H", nature:"Brokerage",                  rate:5,    threshold:15000  },
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

  // 1. TB ledgers
  const { data: tbRows, error: tbErr } = await (supabase as any)
    .from("tally_trial_balance")
    .select("ledger_name,parent_group,debit_amount,credit_amount,closing_balance,balance_type")
    .eq("client_id", client_id).eq("financial_year", financial_year);
  if (tbErr) throw new Error(`TB fetch error: ${tbErr.message}`);

  const expenseLedgers = ((tbRows ?? []) as any[]).filter(l => isExpenseGroup(l.parent_group));
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
