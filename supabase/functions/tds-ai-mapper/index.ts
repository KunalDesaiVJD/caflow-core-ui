/**
 * tds-ai-mapper  (Phase TDS-1 stub → full impl in Phase TDS-2)
 *
 * Goal: Match Trial Balance party ledgers to TDS Management deductees using
 * multi-signal AI heuristics (name similarity, amount ratio, section context,
 * narration keywords).
 *
 * Input:  { client_id, financial_year, firm_id, force_rematch? }
 * Output: { mapped: number, skipped: number, mappings: TbPartyMapping[] }
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
    const { client_id, financial_year, firm_id, force_rematch = false } = body;

    if (!client_id || !financial_year || !firm_id) {
      return new Response(
        JSON.stringify({ error: "client_id, financial_year and firm_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Phase TDS-2 will implement the full AI mapping logic here ──
    // Steps planned:
    //   1. Fetch all tally_trial_balance rows for the engagement
    //   2. Fetch all tds_deductees + tds_filings for the client/FY
    //   3. Run name-similarity (token sort ratio ≥ 60)
    //   4. Cross-check amount ratio (TB debit vs TDS-liable amount within ±20%)
    //   5. Section-context scoring from parent_group → section heuristic map
    //   6. Narration keyword scan (voucher narrations vs deductee name tokens)
    //   7. Write confirmed/pending rows to tds_tb_party_mappings
    //   8. Return summary

    return new Response(
      JSON.stringify({
        status: "stub",
        message: "tds-ai-mapper Phase TDS-2 implementation pending",
        client_id,
        financial_year,
        force_rematch,
        mapped: 0,
        skipped: 0,
        mappings: [],
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
