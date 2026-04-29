/**
 * tds-ai-mapper  (Phase TDS-2 — Full Implementation)
 *
 * Matches Trial Balance party ledgers to TDS Management deductees using
 * three weighted signals:
 *   Signal 1 — Name similarity   (weight 50 %)
 *   Signal 2 — Amount ratio      (weight 30 %)
 *   Signal 3 — Section context   (weight 20 %)
 *
 * Confidence bands:
 *   ≥ 80  →  mapping_status = "confirmed"   (auto-accepted)
 *   60–79 →  mapping_status = "pending"     (needs auditor review)
 *   40–59 →  mapping_status = "needs_review"
 *   < 40  →  not stored
 *
 * Input:  { client_id, financial_year, firm_id, force_rematch? }
 * Output: { mapped, skipped, confirmed, pending, needs_review, mappings[] }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface TBLedger {
  ledger_name: string;
  parent_group: string | null;
  debit_amount: number | null;
  credit_amount: number | null;
  closing_balance: number | null;
  balance_type: string | null;
}

interface TDSDeducteeRow {
  id: string;
  filing_id: string;
  deductee_name: string;
  section_code: string | null;
  nature_of_payment: string | null;
  amount_paid_credited: number | null;
  tds_amount: number | null;
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

interface MatchResult {
  confidence: number;
  name_score: number;
  amount_score: number;
  section_score: number;
  match_method: string;
}

// ─── Expense / party parent groups (include in matching) ─────────────────────
// Any parent group whose lowercase representation contains one of these tokens
// is treated as a potential TDS-liable party ledger.
const EXPENSE_TOKENS = [
  "expense", "indirect", "direct", "creditor",
  "manufacturing", "trading", "administrative", "selling",
  "salary", "wages", "rent", "commission", "professional",
  "maintenance", "contractor", "service", "freight", "transport",
  "advertisement", "advertising", "outsource", "miscellaneous",
  "other", "general",
];

// Skip these groups entirely — they are not party/expense accounts
const SKIP_TOKENS = [
  "bank account", "cash-in-hand", "cash in hand",
  "capital account", "reserves", "fixed assets", "investment",
  "duties & taxes", "duties and taxes", "sundry debtor",
  "stock-in-hand", "stock in hand", "current asset",
  "loans (liability)", "branch", "statutory",
];

// Issue 4: exclude goods/inventory purchase groups (handled by 194Q section logic)
const GOODS_TOKENS = [
  "goods", "material", "raw material", "inventory", "stock item", "stores",
  "purchase account", "purchase a/c", "purchases ",
];

function isExpenseGroup(pg: string | null): boolean {
  if (!pg) return false;
  const lower = pg.toLowerCase();
  if (SKIP_TOKENS.some(t => lower.includes(t))) return false;
  if (GOODS_TOKENS.some(t => lower.includes(t))) return false;
  return EXPENSE_TOKENS.some(t => lower.includes(t));
}

// ─── Section context map ──────────────────────────────────────────────────────
const GROUP_SECTION_MAP: Array<{ token: string; sections: string[] }> = [
  { token: "salary",        sections: ["192", "192A"] },
  { token: "wages",         sections: ["192", "194C"] },
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
  { token: "rent",          sections: ["194I", "194IB"] },
  { token: "interest",      sections: ["194A"] },
  { token: "outsource",     sections: ["194C", "194J"] },
  { token: "maintenance",   sections: ["194C"] },
  { token: "service",       sections: ["194C", "194J"] },
  { token: "creditor",      sections: ["194C", "194J", "194H"] },
  { token: "indirect",      sections: ["194C", "194J", "194H", "194I"] },
  { token: "direct",        sections: ["194C", "194J"] },
  { token: "purchase",      sections: ["194C", "194Q"] },
];

function sectionContextScore(parentGroup: string | null, sectionCode: string | null): number {
  if (!parentGroup || !sectionCode) return 50; // neutral
  const pg = parentGroup.toLowerCase();
  for (const entry of GROUP_SECTION_MAP) {
    if (pg.includes(entry.token)) {
      return entry.sections.includes(sectionCode) ? 95 : 20;
    }
  }
  return 50;
}

// ─── Name similarity (Token Sort Ratio + Bigram Dice) ────────────────────────
function cleanName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|corp|co|and|&|the|a|of|by|for)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1)
    .sort()
    .join(" ")
    .trim();
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
  const ca = cleanName(a);
  const cb = cleanName(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 100;

  // Token Jaccard
  const ta = new Set(ca.split(" "));
  const tb = new Set(cb.split(" "));
  const inter = [...ta].filter(t => tb.has(t)).length;
  const tokenJ = inter / (ta.size + tb.size - inter);

  // Bigram Dice on joined form
  const ba = bigramMap(ca);
  const bb = bigramMap(cb);
  let biInter = 0;
  for (const [bg, cnt] of ba) biInter += Math.min(cnt, bb.get(bg) ?? 0);
  const sumA = [...ba.values()].reduce((acc, v) => acc + v, 0);
  const sumB = [...bb.values()].reduce((acc, v) => acc + v, 0);
  const bigramDice = (2 * biInter) / (sumA + sumB + 0.001);

  return Math.min(100, Math.round((tokenJ * 0.55 + bigramDice * 0.45) * 100));
}

// ─── Amount ratio score ───────────────────────────────────────────────────────
// TB ledger "activity" ≈ TDS deductee amount_paid_credited
function amountRatioScore(tbActivity: number, tdsAmount: number): number {
  if (tbActivity <= 0 || tdsAmount <= 0) return 40; // neutral — missing data
  const ratio = tdsAmount / tbActivity;
  if (ratio >= 0.75 && ratio <= 1.35) return 100;
  if (ratio >= 0.50 && ratio <= 2.00) return 75;
  if (ratio >= 0.20 && ratio <= 4.00) return 45;
  if (ratio >= 0.05 && ratio <= 10.0) return 25;
  return 5;
}

// ─── Compute composite confidence ────────────────────────────────────────────
function computeConfidence(
  tb: TBLedger,
  ded: AggDeductee,
): MatchResult {
  const nameScore   = tokenSortRatio(tb.ledger_name, ded.deductee_name);
  const tbActivity  = Math.max(tb.debit_amount ?? 0, tb.credit_amount ?? 0);
  const amtScore    = amountRatioScore(tbActivity, ded.total_amount_paid);
  const secScore    = sectionContextScore(tb.parent_group, ded.section_code);

  // Weighted composite
  const confidence  = Math.round(nameScore * 0.50 + amtScore * 0.30 + secScore * 0.20);

  // Determine primary match method for transparency
  const methods: string[] = [];
  if (nameScore >= 70) methods.push("name_similarity");
  if (amtScore >= 75)  methods.push("amount_ratio");
  if (secScore >= 80)  methods.push("section_context");
  const match_method = methods.length > 0
    ? methods.join("+")
    : "ai_partial";

  return { confidence, name_score: nameScore, amount_score: amtScore, section_score: secScore, match_method };
}

// ─── Aggregate TDS deductees by (deductee_name, section_code) ────────────────
function aggregateDeductees(rows: TDSDeducteeRow[]): AggDeductee[] {
  const map = new Map<string, AggDeductee>();
  for (const r of rows) {
    const key = `${(r.deductee_name || "").trim()}|${r.section_code ?? ""}`;
    if (!map.has(key)) {
      map.set(key, {
        deductee_name:     (r.deductee_name || "").trim(),
        section_code:      r.section_code,
        nature_of_payment: r.nature_of_payment,
        total_amount_paid: 0,
        total_tds:         0,
        filing_ids:        [],
        deductee_ids:      [],
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

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { client_id, financial_year, firm_id, force_rematch = false } = body;

    if (!client_id || !financial_year || !firm_id) {
      return new Response(
        JSON.stringify({ error: "client_id, financial_year and firm_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 1. Fetch Trial Balance ledgers ──────────────────────────────────────
    const { data: tbRows, error: tbErr } = await supabase
      .from("tally_trial_balance")
      .select("ledger_name,parent_group,debit_amount,credit_amount,closing_balance,balance_type")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year);

    if (tbErr) {
      return new Response(
        JSON.stringify({ error: `TB fetch error: ${tbErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Filter to expense/creditor groups only
    const expenseLedgers = (tbRows as TBLedger[] || []).filter(
      l => isExpenseGroup(l.parent_group),
    );

    if (expenseLedgers.length === 0) {
      return new Response(
        JSON.stringify({
          status: "ok", mapped: 0, skipped: 0,
          confirmed: 0, pending: 0, needs_review: 0, mappings: [],
          message: "No expense/creditor ledgers found in Trial Balance",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Fetch TDS deductees ───────────────────────────────────────────────
    const { data: deducteeRows, error: dedErr } = await supabase
      .from("tds_deductees")
      .select("id,filing_id,deductee_name,section_code,nature_of_payment,amount_paid_credited,tds_amount")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year);

    if (dedErr) {
      return new Response(
        JSON.stringify({ error: `TDS deductees fetch error: ${dedErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!deducteeRows || deducteeRows.length === 0) {
      return new Response(
        JSON.stringify({
          status: "ok", mapped: 0, skipped: expenseLedgers.length,
          confirmed: 0, pending: 0, needs_review: 0, mappings: [],
          message: "No TDS deductees found for this client/FY",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 3. Aggregate deductees ───────────────────────────────────────────────
    const aggDeductees = aggregateDeductees(deducteeRows as TDSDeducteeRow[]);

    // ── 4. If not force_rematch, skip already-mapped ledgers ─────────────────
    let alreadyMapped = new Set<string>();
    if (!force_rematch) {
      const { data: existing } = await supabase
        .from("tds_tb_party_mappings")
        .select("tb_ledger_name")
        .eq("client_id", client_id)
        .eq("financial_year", financial_year)
        .not("mapping_status", "eq", "rejected"); // re-run for rejected is fine
      (existing || []).forEach((r: any) => alreadyMapped.add(r.tb_ledger_name));
    }

    // ── 5. Match each expense ledger against all deductees ───────────────────
    type UpsertRow = {
      client_id: string; firm_id: string; financial_year: string;
      tb_ledger_name: string; tb_parent_group: string | null; tb_total_debit: number | null;
      tds_deductee_name: string; tds_section_code: string | null;
      tds_total_amount: number | null; tds_filing_ids: string[];
      match_confidence: number; match_method: string;
      ai_reasoning: string; mapping_status: string; mapped_by: string;
    };

    const upsertRows: UpsertRow[] = [];
    let skipped = 0;

    for (const tb of expenseLedgers) {
      if (alreadyMapped.has(tb.ledger_name)) { skipped++; continue; }

      let best: { ded: AggDeductee; result: MatchResult } | null = null;

      for (const ded of aggDeductees) {
        if (!ded.deductee_name) continue;
        const result = computeConfidence(tb, ded);
        // Issue 3: Require ≥ 70 % name similarity
        if (result.name_score < 70) continue;
        if (result.confidence < 40) continue;
        if (!best || result.confidence > best.result.confidence) {
          best = { ded, result };
        }
      }

      if (!best) { skipped++; continue; }

      const { ded, result } = best;
      const tbActivity = Math.max(tb.debit_amount ?? 0, tb.credit_amount ?? 0);

      // Issue 1: "confirmed" only when BOTH name AND amount tie back strongly
      const bothMatch = result.name_score >= 90 && result.amount_score >= 75;
      const mapping_status =
        bothMatch                 ? "confirmed" :
        result.confidence >= 60   ? "pending"   :
                                    "needs_review";

      const reasoning =
        `Name match: ${result.name_score}%, ` +
        `Amount match: ${result.amount_score}% ` +
        `(TB ₹${tbActivity.toFixed(0)} vs TDS ₹${ded.total_amount_paid.toFixed(0)}), ` +
        `Section context: ${result.section_score}% ` +
        `(group: "${tb.parent_group}", section: ${ded.section_code ?? "n/a"}). ` +
        `Composite: ${result.confidence}%.`;

      upsertRows.push({
        client_id, firm_id, financial_year,
        tb_ledger_name:   tb.ledger_name,
        tb_parent_group:  tb.parent_group,
        tb_total_debit:   tbActivity || null,
        tds_deductee_name: ded.deductee_name,
        tds_section_code:  ded.section_code,
        tds_total_amount:  ded.total_amount_paid || null,
        tds_filing_ids:    ded.filing_ids,
        match_confidence:  result.confidence,
        match_method:      result.match_method,
        ai_reasoning:      reasoning,
        mapping_status,
        mapped_by: "ai",
      });
    }

    // ── 6. Upsert to tds_tb_party_mappings ───────────────────────────────────
    let mapped = 0;
    if (upsertRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from("tds_tb_party_mappings")
        .upsert(upsertRows, {
          onConflict: "client_id,financial_year,tb_ledger_name,tds_deductee_name",
        });
      if (upsertErr) {
        return new Response(
          JSON.stringify({ error: `Upsert error: ${upsertErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      mapped = upsertRows.length;
    }

    const confirmed    = upsertRows.filter(r => r.mapping_status === "confirmed").length;
    const pending      = upsertRows.filter(r => r.mapping_status === "pending").length;
    const needs_review = upsertRows.filter(r => r.mapping_status === "needs_review").length;

    return new Response(
      JSON.stringify({
        status: "ok",
        mapped, skipped, confirmed, pending, needs_review,
        mappings: upsertRows.map(r => ({
          tb_ledger_name:    r.tb_ledger_name,
          tds_deductee_name: r.tds_deductee_name,
          tds_section_code:  r.tds_section_code,
          match_confidence:  r.match_confidence,
          match_method:      r.match_method,
          mapping_status:    r.mapping_status,
        })),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
