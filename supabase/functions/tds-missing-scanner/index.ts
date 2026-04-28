/**
 * tds-missing-scanner  (Phase TDS-1 stub → full impl in Phase TDS-5)
 *
 * Goal 3: AI scan of ALL unmapped TB ledgers for potential missing TDS
 * obligations that the client has not deducted/reported at all.
 *
 * Strategy:
 *   - Identify TB ledgers in "expense" groups (Indirect Expenses, Direct
 *     Expenses, Purchase Accounts, etc.) that are NOT yet mapped to any
 *     TDS deductee
 *   - Score each against a section heuristic map using ledger name tokens
 *     (e.g. "salary" → 192, "contractor" → 194C, "professional" → 194J)
 *   - For high-confidence hits: write missing_tds_obligation flag with
 *     estimated TDS liability based on turnover and applicable rate
 *   - Low-confidence hits also surfaced for auditor review
 *
 * Input:  { client_id, financial_year, firm_id, confidence_threshold?: number }
 * Output: { scanned: number, flagged: number, flags: ReconFlag[] }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Section heuristic map (used in Phase TDS-5) ───────────────────────────────
// Keys: lowercase token patterns found in ledger names
// Values: { section, nature, rate (%), threshold (₹) }
export const SECTION_HEURISTICS: Record<string, {
  section: string; nature: string; rate: number; threshold: number;
}> = {
  "salary":          { section: "192",  nature: "Salary",                    rate: 0,    threshold: 250000 },
  "contractor":      { section: "194C", nature: "Contractors",               rate: 1,    threshold: 30000  },
  "sub-contractor":  { section: "194C", nature: "Sub-contractors",           rate: 1,    threshold: 30000  },
  "professional":    { section: "194J", nature: "Professional Fees",         rate: 10,   threshold: 30000  },
  "technical":       { section: "194J", nature: "Technical Services",        rate: 2,    threshold: 30000  },
  "consultation":    { section: "194J", nature: "Consultancy Fees",          rate: 10,   threshold: 30000  },
  "commission":      { section: "194H", nature: "Commission/Brokerage",      rate: 5,    threshold: 15000  },
  "brokerage":       { section: "194H", nature: "Commission/Brokerage",      rate: 5,    threshold: 15000  },
  "rent":            { section: "194I", nature: "Rent",                      rate: 10,   threshold: 240000 },
  "interest":        { section: "194A", nature: "Interest (other than bank)",rate: 10,   threshold: 5000   },
  "dividend":        { section: "194",  nature: "Dividend",                  rate: 10,   threshold: 5000   },
  "royalty":         { section: "194J", nature: "Royalty",                   rate: 10,   threshold: 30000  },
  "advertising":     { section: "194C", nature: "Advertising Contracts",     rate: 1,    threshold: 30000  },
  "transport":       { section: "194C", nature: "Transport Contracts",       rate: 0,    threshold: 30000  },
  "labour":          { section: "194C", nature: "Labour Contracts",          rate: 1,    threshold: 30000  },
  "manpower":        { section: "194C", nature: "Manpower Supply",           rate: 1,    threshold: 30000  },
  "software":        { section: "194J", nature: "Software Development",      rate: 2,    threshold: 30000  },
  "maintenance":     { section: "194C", nature: "Maintenance Contracts",     rate: 1,    threshold: 30000  },
  "security":        { section: "194C", nature: "Security Services",         rate: 1,    threshold: 30000  },
  "housekeeping":    { section: "194C", nature: "Housekeeping/Cleaning",     rate: 1,    threshold: 30000  },
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
    const {
      client_id, financial_year, firm_id,
      confidence_threshold = 40
    } = body;

    if (!client_id || !financial_year || !firm_id) {
      return new Response(
        JSON.stringify({ error: "client_id, financial_year and firm_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Phase TDS-5 implementation plan ──
    // 1. Load all TB ledgers (tally_trial_balance) for this engagement
    // 2. Filter to expense parent groups only
    //    (Indirect Expenses, Direct Expenses, Purchase Accounts, etc.)
    // 3. Exclude ledgers already in tds_tb_party_mappings for this client/FY
    // 4. For each unmapped ledger:
    //    a. Tokenise ledger name → lower case words
    //    b. Score against SECTION_HEURISTICS (token overlap count × keyword weight)
    //    c. If confidence ≥ confidence_threshold:
    //       - Compute estimated TDS = closing_debit × rate / 100
    //       - Build missing_tds_obligation flag row
    // 5. Batch-insert tds_recon_flags (goal_number = 3, flag_status = 'pending')
    // 6. Return summary

    return new Response(
      JSON.stringify({
        status: "stub",
        message: "tds-missing-scanner Phase TDS-5 implementation pending",
        client_id,
        financial_year,
        confidence_threshold,
        scanned: 0,
        flagged: 0,
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
