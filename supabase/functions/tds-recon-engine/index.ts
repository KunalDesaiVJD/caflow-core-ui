/**
 * tds-recon-engine  (Phase TDS-3 — Full Implementation)
 *
 * Runs two independent reconciliation goals against confirmed party mappings.
 *
 * ── Goal 1: Existence Reconciliation ─────────────────────────────────────────
 *   Compares Trial Balance ledger activity with TDS Management amounts.
 *   Flags:
 *     entry_in_books_not_in_tds  — TB amount significantly > TDS module amount
 *     entry_in_tds_not_in_books  — TDS module amount significantly > TB amount
 *
 * ── Goal 2: Rate / Short Deduction Analysis ───────────────────────────────────
 *   For each mapping with a known section, computes expected TDS using either:
 *     (a) tds_rate_master for the FY (if populated), OR
 *     (b) embedded fallback rate table
 *   Flags:
 *     short_deduction  — actual TDS < expected by > 5 % and > ₹500
 *     over_deduction   — actual TDS > expected by > 5 % and > ₹500
 *
 * Input:  { client_id, financial_year, firm_id, goals?: (1|2)[], rerun?: boolean }
 * Output: { flags_created, flags_preserved, goal1_flags, goal2_flags, flags[] }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Constants ────────────────────────────────────────────────────────────────

// Goal 1: minimum variance to raise a flag
const G1_VARIANCE_AMOUNT_MIN = 10_000;   // ₹10,000 absolute difference
const G1_VARIANCE_PCT_MIN    = 0.15;     // 15 % relative difference

// Goal 2: minimum TDS discrepancy to raise a flag
const G2_TDS_VARIANCE_AMOUNT_MIN = 500;  // ₹500 absolute variance
const G2_TDS_VARIANCE_PCT_MIN    = 0.05; // 5 % relative variance

// ─── Embedded fallback rate table (FY 2025-26 standard rates) ─────────────────
interface RateEntry {
  nature: string;
  threshold_individual: number;
  threshold_company:    number;
  rate_individual:      number;
  rate_company:         number;
}

const FALLBACK_RATE_TABLE: Record<string, RateEntry> = {
  "192":   { nature: "Salary",                         threshold_individual: 250000, threshold_company: 250000, rate_individual: 0,    rate_company: 0    },
  "192A":  { nature: "PF Withdrawal",                  threshold_individual:  50000, threshold_company:  50000, rate_individual: 10,   rate_company: 10   },
  "193":   { nature: "Interest on Securities",         threshold_individual:  10000, threshold_company:  10000, rate_individual: 10,   rate_company: 10   },
  "194":   { nature: "Dividend",                       threshold_individual:   5000, threshold_company:   5000, rate_individual: 10,   rate_company: 10   },
  "194A":  { nature: "Interest (non-bank)",            threshold_individual:  50000, threshold_company:  50000, rate_individual: 10,   rate_company: 10   },
  "194B":  { nature: "Lottery Winnings",               threshold_individual:  10000, threshold_company:  10000, rate_individual: 30,   rate_company: 30   },
  "194BB": { nature: "Horse Race Winnings",            threshold_individual:  10000, threshold_company:  10000, rate_individual: 30,   rate_company: 30   },
  "194C":  { nature: "Contractors",                    threshold_individual: 100000, threshold_company: 100000, rate_individual: 1,    rate_company: 2    },
  "194D":  { nature: "Insurance Commission",           threshold_individual:  15000, threshold_company:  15000, rate_individual: 5,    rate_company: 10   },
  "194DA": { nature: "Life Insurance Maturity",        threshold_individual: 100000, threshold_company: 100000, rate_individual: 5,    rate_company: 5    },
  "194G":  { nature: "Commission on Lottery",          threshold_individual:  15000, threshold_company:  15000, rate_individual: 5,    rate_company: 5    },
  "194H":  { nature: "Commission / Brokerage",         threshold_individual:  15000, threshold_company:  15000, rate_individual: 5,    rate_company: 5    },
  "194I":  { nature: "Rent",                           threshold_individual: 240000, threshold_company: 240000, rate_individual: 10,   rate_company: 10   },
  "194IB": { nature: "Rent by Ind / HUF",              threshold_individual:  50000, threshold_company:  50000, rate_individual: 5,    rate_company: 5    },
  "194IC": { nature: "Payment under JDA",              threshold_individual:      0, threshold_company:      0, rate_individual: 10,   rate_company: 10   },
  "194J":  { nature: "Professional / Technical Fees",  threshold_individual:  30000, threshold_company:  30000, rate_individual: 10,   rate_company: 10   },
  "194K":  { nature: "Dividend from MF",               threshold_individual:   5000, threshold_company:   5000, rate_individual: 10,   rate_company: 10   },
  "194LA": { nature: "Compulsory Acquisition",         threshold_individual: 250000, threshold_company: 250000, rate_individual: 10,   rate_company: 10   },
  "194M":  { nature: "Commission/Prof by Ind/HUF",     threshold_individual: 5000000,threshold_company: 5000000,rate_individual: 5,    rate_company: 5    },
  "194N":  { nature: "Cash Withdrawal",                threshold_individual: 2000000,threshold_company: 2000000,rate_individual: 2,    rate_company: 2    },
  "194O":  { nature: "E-commerce Payment",             threshold_individual:  500000,threshold_company:  500000,rate_individual: 1,    rate_company: 1    },
  "194Q":  { nature: "Purchase of Goods",              threshold_individual: 5000000,threshold_company: 5000000,rate_individual: 0.1,  rate_company: 0.1  },
  "194R":  { nature: "Benefit / Perquisite",           threshold_individual:  20000, threshold_company:  20000, rate_individual: 10,   rate_company: 10   },
  "194S":  { nature: "VDA Transfer",                   threshold_individual:  50000, threshold_company:  50000, rate_individual: 1,    rate_company: 1    },
  "195":   { nature: "Non-resident Payments",          threshold_individual:      0, threshold_company:      0, rate_individual: 20,   rate_company: 20   },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Mapping {
  id: string;
  client_id: string;
  firm_id: string;
  financial_year: string;
  tb_ledger_name: string;
  tb_parent_group: string | null;
  tb_total_debit: number | null;
  tds_deductee_name: string;
  tds_section_code: string | null;
  tds_total_amount: number | null;
  tds_filing_ids: string[] | null;
  deductee_ids?: string[];
}

interface DeducteeRow {
  id: string;
  deductee_name: string;
  section_code: string | null;
  amount_paid_credited: number | null;
  tds_amount: number | null;
  rate_of_tds: number | null;
  deductee_type: string | null;
}

interface AggDeductee {
  deductee_name: string;
  section_code: string | null;
  total_amount_paid: number;
  total_tds: number;
  weighted_rate: number; // effective rate = total_tds / total_amount_paid × 100
  primary_deductee_type: string | null;
  deductee_ids: string[];
}

interface FlagRow {
  client_id: string;
  firm_id: string;
  financial_year: string;
  flag_type: string;
  goal_number: number;
  tb_ledger_name: string | null;
  tds_deductee_name: string | null;
  section_code: string | null;
  nature_of_payment: string | null;
  book_amount: number | null;
  tds_amount: number | null;
  expected_tds: number | null;
  actual_tds: number | null;
  variance_amount: number | null;
  expected_rate: number | null;
  actual_rate: number | null;
  threshold_amount: number | null;
  voucher_ids: string[];
  deductee_ids: string[];
  mapping_id: string;
  ai_reasoning: string;
  ai_confidence: number;
  sample_narrations: string[];
  flag_status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function aggregateDeductees(rows: DeducteeRow[]): Map<string, AggDeductee> {
  const map = new Map<string, AggDeductee>();
  for (const r of rows) {
    const key = `${(r.deductee_name || "").trim().toLowerCase()}|${r.section_code ?? ""}`;
    if (!map.has(key)) {
      map.set(key, {
        deductee_name:         (r.deductee_name || "").trim(),
        section_code:          r.section_code,
        total_amount_paid:     0,
        total_tds:             0,
        weighted_rate:         0,
        primary_deductee_type: r.deductee_type,
        deductee_ids:          [],
      });
    }
    const agg = map.get(key)!;
    agg.total_amount_paid += r.amount_paid_credited ?? 0;
    agg.total_tds         += r.tds_amount           ?? 0;
    if (r.id && !agg.deductee_ids.includes(r.id)) agg.deductee_ids.push(r.id);
    // Keep most-specific deductee type
    if (r.deductee_type && !agg.primary_deductee_type) {
      agg.primary_deductee_type = r.deductee_type;
    }
  }
  // Compute effective rate
  for (const agg of map.values()) {
    agg.weighted_rate = agg.total_amount_paid > 0
      ? (agg.total_tds / agg.total_amount_paid) * 100
      : 0;
  }
  return map;
}

function isCompany(deducteeType: string | null): boolean {
  if (!deducteeType) return false;
  const t = deducteeType.toLowerCase();
  return t.includes("company") || t.includes("co.") || t.includes("pvt") ||
         t.includes("limited") || t.includes("firm") || t.includes("llp");
}

function confidenceFromVariance(pctDiff: number): number {
  // Higher variance → higher confidence we have a real discrepancy
  if (pctDiff >= 0.80) return 95;
  if (pctDiff >= 0.50) return 85;
  if (pctDiff >= 0.30) return 75;
  if (pctDiff >= 0.20) return 65;
  return 55;
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
    const { client_id, financial_year, firm_id, goals = [1, 2], rerun = false } = body;

    if (!client_id || !financial_year || !firm_id) {
      return new Response(
        JSON.stringify({ error: "client_id, financial_year and firm_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 1. Load confirmed party mappings ──────────────────────────────────────
    const { data: mappingRows, error: mapErr } = await supabase
      .from("tds_tb_party_mappings")
      .select("*")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .eq("mapping_status", "confirmed");

    if (mapErr) {
      return new Response(
        JSON.stringify({ error: `Mapping fetch error: ${mapErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const mappings = (mappingRows ?? []) as Mapping[];

    if (mappings.length === 0) {
      return new Response(
        JSON.stringify({
          status: "ok",
          flags_created: 0, flags_preserved: 0, goal1_flags: 0, goal2_flags: 0, flags: [],
          message: "No confirmed party mappings found. Run AI Mapper first and confirm mappings.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Load TDS deductees (fresh aggregate for actual TDS amounts) ─────────
    const { data: deducteeRows, error: dedErr } = await supabase
      .from("tds_deductees")
      .select("id,deductee_name,section_code,amount_paid_credited,tds_amount,rate_of_tds,deductee_type")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year);

    if (dedErr) {
      return new Response(
        JSON.stringify({ error: `Deductee fetch error: ${dedErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aggDeductees = aggregateDeductees((deducteeRows ?? []) as DeducteeRow[]);

    // ── 3. Load TDS rate master for the FY (prefer DB over fallback) ──────────
    const { data: rateRows } = await supabase
      .from("tds_rate_master")
      .select("section_code,rate_individual,rate_company,threshold_individual,threshold_company,nature_of_payment")
      .eq("financial_year", financial_year)
      .eq("is_active", true);

    const dbRateMap = new Map<string, {
      rate_individual: number; rate_company: number;
      threshold_individual: number; threshold_company: number;
      nature_of_payment: string | null;
    }>();
    for (const r of (rateRows ?? []) as any[]) {
      if (r.section_code) dbRateMap.set(r.section_code, r);
    }

    // Helper: get rate entry (DB first, fallback second)
    function getRateEntry(sectionCode: string): RateEntry | null {
      if (dbRateMap.has(sectionCode)) {
        const r = dbRateMap.get(sectionCode)!;
        return {
          nature:               r.nature_of_payment ?? "",
          threshold_individual: r.threshold_individual ?? 0,
          threshold_company:    r.threshold_company    ?? 0,
          rate_individual:      r.rate_individual      ?? 0,
          rate_company:         r.rate_company         ?? 0,
        };
      }
      return FALLBACK_RATE_TABLE[sectionCode] ?? null;
    }

    // ── 4. Sample narrations from tally_vouchers ──────────────────────────────
    async function sampleNarrations(ledgerName: string): Promise<string[]> {
      const { data } = await supabase
        .from("tally_vouchers")
        .select("narration,voucher_date,amount,dr_cr")
        .eq("client_id", client_id)
        .eq("financial_year", financial_year)
        .ilike("party_ledger", `%${ledgerName}%`)
        .order("voucher_date", { ascending: false })
        .limit(3);
      return ((data ?? []) as any[]).map(v =>
        `${v.voucher_date ?? ""}: ₹${Math.abs(v.amount ?? 0).toLocaleString("en-IN")} ${v.dr_cr ?? ""} — ${v.narration || "(no narration)"}`
      );
    }

    // ── 5. Clear pending flags for the requested goals (idempotent re-run) ────
    // Actioned flags (query_raised / accepted / disregarded) are preserved.
    const goalNumbers = (goals as number[]).filter(g => g === 1 || g === 2);
    await supabase
      .from("tds_recon_flags")
      .delete()
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .eq("flag_status", "pending")
      .in("goal_number", goalNumbers);

    // ── 6. Count already-actioned flags to report back ─────────────────────────
    const { count: preserved } = await supabase
      .from("tds_recon_flags")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .in("goal_number", goalNumbers)
      .neq("flag_status", "pending");

    // ── 7. Build flags ─────────────────────────────────────────────────────────
    const newFlags: FlagRow[] = [];

    for (const mapping of mappings) {
      const dedKey = `${mapping.tds_deductee_name.trim().toLowerCase()}|${mapping.tds_section_code ?? ""}`;
      const ded = aggDeductees.get(dedKey);

      // Narration sampling (async — run per mapping; skip if ledger not found)
      const narrations = await sampleNarrations(mapping.tb_ledger_name);

      // ── Goal 1: Existence Reconciliation ──────────────────────────────────
      if (goalNumbers.includes(1)) {
        const bookAmt = mapping.tb_total_debit ?? 0;
        const tdsAmt  = ded?.total_amount_paid ?? mapping.tds_total_amount ?? 0;

        if (bookAmt > 0 || tdsAmt > 0) {
          const diff    = bookAmt - tdsAmt;
          const absDiff = Math.abs(diff);
          const larger  = Math.max(bookAmt, tdsAmt, 1);
          const pctDiff = absDiff / larger;

          if (absDiff >= G1_VARIANCE_AMOUNT_MIN && pctDiff >= G1_VARIANCE_PCT_MIN) {
            const flag_type = diff > 0 ? "entry_in_books_not_in_tds" : "entry_in_tds_not_in_books";
            const confidence = confidenceFromVariance(pctDiff);

            const reasoning =
              flag_type === "entry_in_books_not_in_tds"
                ? `TB ledger "${mapping.tb_ledger_name}" shows ₹${bookAmt.toLocaleString("en-IN")} activity, ` +
                  `but TDS filings for "${mapping.tds_deductee_name}" only cover ` +
                  `₹${tdsAmt.toLocaleString("en-IN")} — a gap of ₹${absDiff.toLocaleString("en-IN")} ` +
                  `(${(pctDiff * 100).toFixed(1)}%). Possible unreported payments in Tally.`
                : `TDS filings for "${mapping.tds_deductee_name}" cover ` +
                  `₹${tdsAmt.toLocaleString("en-IN")}, but TB ledger "${mapping.tb_ledger_name}" ` +
                  `shows only ₹${bookAmt.toLocaleString("en-IN")} — gap of ₹${absDiff.toLocaleString("en-IN")} ` +
                  `(${(pctDiff * 100).toFixed(1)}%). Possible double-counting in TDS or TB mismatch.`;

            newFlags.push({
              client_id, firm_id, financial_year,
              flag_type, goal_number: 1,
              tb_ledger_name:    mapping.tb_ledger_name,
              tds_deductee_name: mapping.tds_deductee_name,
              section_code:      mapping.tds_section_code,
              nature_of_payment: ded?.deductee_name ?? null,
              book_amount:       bookAmt || null,
              tds_amount:        tdsAmt  || null,
              expected_tds: null, actual_tds: null,
              variance_amount:   diff,
              expected_rate: null, actual_rate: null, threshold_amount: null,
              voucher_ids:   [],
              deductee_ids:  ded?.deductee_ids ?? (mapping.tds_filing_ids ?? []),
              mapping_id:    mapping.id,
              ai_reasoning:  reasoning,
              ai_confidence: confidence,
              sample_narrations: narrations,
              flag_status: "pending",
            });
          }
        }
      }

      // ── Goal 2: Rate / Short Deduction Analysis ────────────────────────────
      if (goalNumbers.includes(2) && mapping.tds_section_code) {
        const rateEntry = getRateEntry(mapping.tds_section_code);
        if (!rateEntry) continue; // unknown section — skip

        const amtPaid    = ded?.total_amount_paid ?? mapping.tds_total_amount ?? 0;
        const actualTds  = ded?.total_tds ?? 0;

        if (amtPaid <= 0) continue; // no payment data

        const deducteeIsCompany = isCompany(ded?.primary_deductee_type ?? null);
        const applicableRate    = deducteeIsCompany ? rateEntry.rate_company : rateEntry.rate_individual;
        const applicableThresh  = deducteeIsCompany ? rateEntry.threshold_company : rateEntry.threshold_individual;

        // Skip if below threshold (TDS not applicable)
        if (amtPaid <= applicableThresh) continue;

        const expectedTds = amtPaid * applicableRate / 100;
        if (expectedTds <= 0) continue; // zero-rate section (e.g. 192 not applicable)

        const variance   = expectedTds - actualTds;         // + = short, - = over
        const absVar     = Math.abs(variance);
        const varPct     = absVar / expectedTds;
        const actualRate = amtPaid > 0 ? (actualTds / amtPaid) * 100 : 0;

        if (absVar >= G2_TDS_VARIANCE_AMOUNT_MIN && varPct >= G2_TDS_VARIANCE_PCT_MIN) {
          const flag_type  = variance > 0 ? "short_deduction" : "over_deduction";
          const confidence = confidenceFromVariance(varPct);

          const reasoning = variance > 0
            ? `Section ${mapping.tds_section_code} (${rateEntry.nature}): ` +
              `Amount paid ₹${amtPaid.toLocaleString("en-IN")} > threshold ₹${applicableThresh.toLocaleString("en-IN")}. ` +
              `Expected TDS at ${applicableRate}% = ₹${expectedTds.toLocaleString("en-IN", { maximumFractionDigits: 0 })}. ` +
              `Actual TDS deducted = ₹${actualTds.toLocaleString("en-IN", { maximumFractionDigits: 0 })} ` +
              `(effective rate ${actualRate.toFixed(2)}%). ` +
              `Short deduction: ₹${absVar.toLocaleString("en-IN", { maximumFractionDigits: 0 })} (${(varPct * 100).toFixed(1)}%).`
            : `Section ${mapping.tds_section_code} (${rateEntry.nature}): ` +
              `Amount paid ₹${amtPaid.toLocaleString("en-IN")}. ` +
              `Expected TDS at ${applicableRate}% = ₹${expectedTds.toLocaleString("en-IN", { maximumFractionDigits: 0 })}. ` +
              `Actual TDS = ₹${actualTds.toLocaleString("en-IN", { maximumFractionDigits: 0 })} ` +
              `(effective rate ${actualRate.toFixed(2)}%). ` +
              `Over-deduction: ₹${absVar.toLocaleString("en-IN", { maximumFractionDigits: 0 })} (${(varPct * 100).toFixed(1)}%).`;

          newFlags.push({
            client_id, firm_id, financial_year,
            flag_type, goal_number: 2,
            tb_ledger_name:    mapping.tb_ledger_name,
            tds_deductee_name: mapping.tds_deductee_name,
            section_code:      mapping.tds_section_code,
            nature_of_payment: rateEntry.nature,
            book_amount:       amtPaid    || null,
            tds_amount:        null,
            expected_tds:      expectedTds,
            actual_tds:        actualTds  || null,
            variance_amount:   variance,
            expected_rate:     applicableRate,
            actual_rate:       actualRate  || null,
            threshold_amount:  applicableThresh,
            voucher_ids:  [],
            deductee_ids: ded?.deductee_ids ?? [],
            mapping_id:   mapping.id,
            ai_reasoning:      reasoning,
            ai_confidence:     confidence,
            sample_narrations: narrations,
            flag_status: "pending",
          });
        }
      }
    } // end for each mapping

    // ── 8. Insert new flags ───────────────────────────────────────────────────
    let flags_created = 0;
    if (newFlags.length > 0) {
      const { error: insertErr } = await supabase
        .from("tds_recon_flags")
        .insert(newFlags);
      if (insertErr) {
        return new Response(
          JSON.stringify({ error: `Flag insert error: ${insertErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      flags_created = newFlags.length;
    }

    const goal1_flags = newFlags.filter(f => f.goal_number === 1).length;
    const goal2_flags = newFlags.filter(f => f.goal_number === 2).length;

    return new Response(
      JSON.stringify({
        status: "ok",
        flags_created,
        flags_preserved: preserved ?? 0,
        goal1_flags,
        goal2_flags,
        mappings_analysed: mappings.length,
        flags: newFlags.map(f => ({
          flag_type:         f.flag_type,
          goal_number:       f.goal_number,
          tb_ledger_name:    f.tb_ledger_name,
          tds_deductee_name: f.tds_deductee_name,
          section_code:      f.section_code,
          variance_amount:   f.variance_amount,
          ai_confidence:     f.ai_confidence,
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
