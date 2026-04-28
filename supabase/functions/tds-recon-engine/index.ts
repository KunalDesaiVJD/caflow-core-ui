/**
 * tds-recon-engine  (Phase TDS-1 stub → full impl in Phase TDS-3/4)
 *
 * Goal 1: Reconcile TB journal entries ↔ TDS Management module entries
 *   → Flags: entry_in_books_not_in_tds | entry_in_tds_not_in_books
 *
 * Goal 2: Short/over deduction analysis per Income Tax Act sections
 *   → Flags: short_deduction | over_deduction
 *   → Uses section threshold table + applicable rates (194C/194J/194H/…)
 *
 * Input:  { client_id, financial_year, firm_id, goals?: (1|2)[], rerun? }
 * Output: { flags_created: number, flags_updated: number, flags: ReconFlag[] }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { client_id, financial_year, firm_id, goals = [1, 2], rerun = false } = body;

    if (!client_id || !financial_year || !firm_id) {
      return new Response(
        JSON.stringify({ error: "client_id, financial_year and firm_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Phase TDS-3 (Goal 1) implementation plan ──
    // 1. Load confirmed tds_tb_party_mappings for this client/FY
    // 2. For each mapping, aggregate:
    //    a. TB debit entries from tally_vouchers (by ledger name)
    //    b. TDS module amounts from tds_deductees + tds_filings
    // 3. Diff: entries in books not in TDS → flag entry_in_books_not_in_tds
    // 4. Diff: entries in TDS not in books → flag entry_in_tds_not_in_books
    // 5. Upsert tds_recon_flags (goal_number = 1)

    // ── Phase TDS-4 (Goal 2) implementation plan ──
    // 1. Load TDS section rate/threshold table (embedded or from DB)
    // 2. For each mapping + section_code, compute:
    //    expected_tds = book_amount > threshold ? book_amount × rate : 0
    //    variance = expected_tds - actual_tds
    // 3. variance > 0 → short_deduction flag
    // 4. variance < 0 → over_deduction flag
    // 5. Include sample narrations from tally_vouchers for auditor context
    // 6. Upsert tds_recon_flags (goal_number = 2)

    return new Response(
      JSON.stringify({
        status: "stub",
        message: "tds-recon-engine Phase TDS-3/4 implementation pending",
        client_id,
        financial_year,
        goals,
        rerun,
        flags_created: 0,
        flags_updated: 0,
        flags: [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
