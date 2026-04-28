/**
 * tds-demand-calculator  (Phase TDS-6)
 *
 * Computes TDS demand (shortfall + interest + late fees) from reconciliation flags.
 *
 * ── Sources ────────────────────────────────────────────────────────────────────
 *   Goal 2 flags: short_deduction   → TDS shortfall = expected_tds - actual_tds
 *   Goal 3 flags: missing_tds_obligation → TDS shortfall = expected_tds
 *
 * ── Computations ────────────────────────────────────────────────────────────────
 *   201(1A) Interest:
 *     Case A — TDS deducted but not paid to Govt:
 *       Rate = 1.5% per month, from deduction date to payment date
 *     Case B — TDS not deducted at all (missing or short):
 *       Rate = 1.0% per month, from date TDS was deductible to computation date
 *     Months = ceiling of calendar days / 30 (minimum 1 month)
 *     Interest = shortfall × rate × months
 *
 *   234E Late Filing Fee (per quarter):
 *     Fee = min(₹200 × late_days, TDS shortfall)
 *     Assumed: if flag_status = pending/disregarded, filing is overdue
 *     late_days = days from quarterly due date to computation_date
 *
 *   TDS Quarter Due Dates (for 234E):
 *     Q1: Apr-Jun → 31 Jul
 *     Q2: Jul-Sep → 31 Oct
 *     Q3: Oct-Dec → 31 Jan
 *     Q4: Jan-Mar → 31 May
 *
 * Input:  { client_id, financial_year, firm_id, computation_date?, assumptions? }
 * Output: { items_created, grand_total_demand, interest_201_1a_total, fee_234e_total }
 */
import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Constants ────────────────────────────────────────────────────────────────

const INTEREST_RATE_NOT_DEDUCTED = 0.01;    // 1.0% per month u/s 201(1A)
const INTEREST_RATE_LATE_PAYMENT = 0.015;   // 1.5% per month u/s 201(1A)
const LATE_FEE_PER_DAY           = 200;     // ₹200/day u/s 234E

// Quarter due dates map: "MMDD" → day/month of due date in same FY
const QUARTER_DUE: { startMM: number; endMM: number; dueDay: number; dueMM: number; dueFY: "same" | "next" }[] = [
  { startMM: 4,  endMM: 6,  dueDay: 31, dueMM: 7,  dueFY: "same" },   // Q1 → Jul 31
  { startMM: 7,  endMM: 9,  dueDay: 31, dueMM: 10, dueFY: "same" },   // Q2 → Oct 31
  { startMM: 10, endMM: 12, dueDay: 31, dueMM: 1,  dueFY: "next" },   // Q3 → Jan 31 next yr
  { startMM: 1,  endMM: 3,  dueDay: 31, dueMM: 5,  dueFY: "next" },   // Q4 → May 31 next yr
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function ceilMonths(days: number): number {
  return Math.max(1, Math.ceil(days / 30));
}

/** Parse FY string "2024-25" → { startYear: 2024, endYear: 2025 } */
function parseFY(fy: string): { startYear: number; endYear: number } {
  const parts = fy.split("-");
  const sy = parseInt(parts[0], 10);
  const eyStr = parts[1] ?? String(sy + 1).slice(-2);
  const ey = eyStr.length === 2
    ? Math.floor(sy / 100) * 100 + parseInt(eyStr, 10)
    : parseInt(eyStr, 10);
  return { startYear: sy, endYear: ey };
}

/**
 * Best-guess "deductible date" for a flag — mid-year (Oct 1) as a conservative
 * default when we don't have a specific transaction date.
 */
function guessDeductibleDate(fy: string): Date {
  const { startYear } = parseFY(fy);
  return new Date(`${startYear}-10-01`);
}

/**
 * Quarterly due date for a given payment month within FY.
 * paymentMonth: 1-12
 */
function quarterlyDueDate(paymentMonth: number, fy: string): Date {
  const { startYear, endYear } = parseFY(fy);
  for (const q of QUARTER_DUE) {
    if (paymentMonth >= q.startMM && paymentMonth <= q.endMM) {
      const dueYear = q.dueFY === "next" ? endYear : startYear;
      return new Date(`${dueYear}-${String(q.dueMM).padStart(2, "0")}-${q.dueDay}`);
    }
  }
  // Fallback: May 31 of end year (Q4 default)
  return new Date(`${endYear}-05-31`);
}

/** Compute 201(1A) interest */
function compute201(
  shortfall: number,
  deductibleDate: Date,
  deductionDate: Date | null,
  paymentDate: Date | null,
  computationDate: Date,
): { interestAmt: number; months: number; rate: number; note: string } {
  if (shortfall <= 0) return { interestAmt: 0, months: 0, rate: 0, note: "No shortfall" };

  if (!deductionDate) {
    // Case B: TDS not deducted at all — 1% from deductible date to computation date
    const days  = Math.max(0, daysBetween(deductibleDate, computationDate));
    const months = ceilMonths(days);
    return {
      interestAmt: Math.round(shortfall * INTEREST_RATE_NOT_DEDUCTED * months),
      months,
      rate: INTEREST_RATE_NOT_DEDUCTED * 100,
      note: `1%/month × ${months} months (not deducted; ${days} days)`,
    };
  }

  if (!paymentDate) {
    // Case A: Deducted but not paid — 1.5% from deduction date to computation date
    const days  = Math.max(0, daysBetween(deductionDate, computationDate));
    const months = ceilMonths(days);
    return {
      interestAmt: Math.round(shortfall * INTEREST_RATE_LATE_PAYMENT * months),
      months,
      rate: INTEREST_RATE_LATE_PAYMENT * 100,
      note: `1.5%/month × ${months} months (deducted not paid; ${days} days)`,
    };
  }

  // Both dates known — combined interest
  // Period 1: deductible to deduction date @ 1%
  const days1   = Math.max(0, daysBetween(deductibleDate, deductionDate));
  const months1 = ceilMonths(days1);
  const int1    = Math.round(shortfall * INTEREST_RATE_NOT_DEDUCTED * months1);

  // Period 2: deduction to payment @ 1.5% (only if late payment)
  const days2   = Math.max(0, daysBetween(deductionDate, paymentDate));
  const months2 = days2 > 0 ? ceilMonths(days2) : 0;
  const int2    = Math.round(shortfall * INTEREST_RATE_LATE_PAYMENT * months2);

  return {
    interestAmt: int1 + int2,
    months: months1 + months2,
    rate: 0,   // mixed
    note: `1%×${months1}mo (non-dedn) + 1.5%×${months2}mo (late pmt)`,
  };
}

/** Compute 234E late filing fee */
function compute234E(shortfall: number, dueDate: Date, computationDate: Date): number {
  if (computationDate <= dueDate) return 0;
  const days = daysBetween(dueDate, computationDate);
  const fee  = Math.min(LATE_FEE_PER_DAY * days, shortfall);
  return Math.round(Math.max(0, fee));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const {
      client_id,
      financial_year,
      firm_id,
      computation_date,   // ISO date string, default today
      assumptions = {},   // optional overrides
    } = await req.json() as {
      client_id:       string;
      financial_year:  string;
      firm_id:         string;
      computation_date?: string;
      assumptions?: {
        default_deductible_month?: number;   // 1-12, default mid-year (Oct=10)
        assume_not_paid?: boolean;           // default true (conservative)
      };
    };

    if (!client_id || !financial_year || !firm_id) {
      return new Response(
        JSON.stringify({ error: "client_id, financial_year and firm_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const compDate = computation_date
      ? new Date(computation_date)
      : new Date();

    const assumeNotPaid = assumptions.assume_not_paid !== false;   // default true

    // ── 1. Load applicable flags ──────────────────────────────────────────────

    const { data: flags, error: flagErr } = await sb
      .from("tds_recon_flags")
      .select("*")
      .eq("client_id",      client_id)
      .eq("financial_year", financial_year)
      .in("flag_type", ["short_deduction", "missing_tds_obligation"])
      .neq("flag_status", "disregarded");

    if (flagErr) throw new Error(flagErr.message);

    const sourceFlags = (flags ?? []) as any[];

    if (sourceFlags.length === 0) {
      // Delete any stale rows and return
      await sb
        .from("tds_demand_items")
        .delete()
        .eq("client_id",     client_id)
        .eq("financial_year", financial_year);

      return new Response(
        JSON.stringify({ items_created: 0, grand_total_demand: 0,
          interest_201_1a_total: 0, fee_234e_total: 0, message: "No applicable flags found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Compute demand items ───────────────────────────────────────────────

    const items: any[] = [];

    for (const flag of sourceFlags) {
      const isShort   = flag.flag_type === "short_deduction";
      const isMissing = flag.flag_type === "missing_tds_obligation";

      // Shortfall amount
      let shortfall = 0;
      if (isShort) {
        shortfall = Math.max(0,
          (flag.expected_tds ?? 0) - (flag.actual_tds ?? 0),
        );
      } else if (isMissing) {
        shortfall = flag.expected_tds ?? 0;
      }

      if (shortfall <= 0) continue;

      // Deductible date: use mid-year default
      const deductibleDate = guessDeductibleDate(financial_year);

      // For short_deduction: TDS was partially deducted — treat shortfall as not paid
      // For missing_tds_obligation: TDS not deducted at all
      const deductionDate: Date | null = (isShort && !assumeNotPaid) ? deductibleDate : null;
      const paymentDate:   Date | null = null;   // conservative: not yet paid

      // 201(1A)
      const interestResult = compute201(
        shortfall,
        deductibleDate,
        deductionDate,
        paymentDate,
        compDate,
      );

      // 234E — use Q3 mid-year due date as conservative default
      // (Oct–Dec quarter → Jan 31 of next year)
      const dueDate = quarterlyDueDate(10, financial_year);   // Q3 default
      const fee234e = compute234E(shortfall, dueDate, compDate);
      const lateDays = compDate > dueDate ? daysBetween(dueDate, compDate) : 0;

      const totalDemand = shortfall + interestResult.interestAmt + fee234e;

      items.push({
        client_id,
        firm_id,
        financial_year,
        flag_id:           flag.id,
        flag_type:         flag.flag_type,
        goal_number:       flag.goal_number ?? (isMissing ? 3 : 2),
        tb_ledger_name:    flag.tb_ledger_name,
        tds_deductee_name: flag.tds_deductee_name,
        section_code:      flag.section_code,
        nature_of_payment: flag.nature_of_payment,
        tds_shortfall:     shortfall,
        amount_paid:       flag.book_amount,
        deductible_date:   deductibleDate.toISOString().slice(0, 10),
        deduction_date:    deductionDate?.toISOString().slice(0, 10) ?? null,
        payment_date:      paymentDate?.toISOString().slice(0, 10) ?? null,
        computation_date:  compDate.toISOString().slice(0, 10),
        interest_rate_pct: interestResult.rate,
        interest_months:   interestResult.months,
        interest_201_1a:   interestResult.interestAmt,
        late_filing_days:  lateDays,
        fee_234e,
        total_demand:      totalDemand,
        computation_note:  interestResult.note,
        item_status:       "computed",
      });
    }

    // ── 3. Idempotent save ────────────────────────────────────────────────────

    // Delete previous computed items (preserve disputed/settled)
    await sb
      .from("tds_demand_items")
      .delete()
      .eq("client_id",     client_id)
      .eq("financial_year", financial_year)
      .eq("item_status",   "computed");

    let insertedCount = 0;
    if (items.length > 0) {
      const { error: insErr } = await sb
        .from("tds_demand_items")
        .insert(items);
      if (insErr) throw new Error(insErr.message);
      insertedCount = items.length;
    }

    // ── 4. Aggregate totals ───────────────────────────────────────────────────

    const grandTotal    = items.reduce((s, i) => s + i.total_demand,    0);
    const interestTotal = items.reduce((s, i) => s + i.interest_201_1a, 0);
    const feeTotal      = items.reduce((s, i) => s + i.fee_234e,        0);
    const shortfallTotal= items.reduce((s, i) => s + i.tds_shortfall,   0);

    return new Response(
      JSON.stringify({
        items_created:         insertedCount,
        shortfall_total:       Math.round(shortfallTotal),
        interest_201_1a_total: Math.round(interestTotal),
        fee_234e_total:        Math.round(feeTotal),
        grand_total_demand:    Math.round(grandTotal),
        computation_date:      compDate.toISOString().slice(0, 10),
        items,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
