/**
 * tds-missing-scanner  (Phase TDS-4 — Full Implementation)
 *
 * Goal 3: Scan ALL unmapped Trial Balance expense/creditor ledgers for
 * potential TDS obligations that are entirely absent from TDS filings.
 *
 * Algorithm:
 *   1. Load tally_trial_balance (client_id + financial_year)
 *   2. Filter to expense/party parent groups (EXPENSE_TOKENS filter)
 *   3. Exclude ledgers already confirmed in tds_tb_party_mappings
 *   4. For each unmapped ledger, score against SECTION_HEURISTICS using
 *      multi-token matching with section-level score accumulation
 *   5. Parent-group context provides a 15-point confidence boost when it
 *      aligns with the inferred section (e.g. "Indirect Expenses" + 194C)
 *   6. If confidence ≥ confidence_threshold AND activity > section threshold
 *      → insert missing_tds_obligation flag with estimated TDS liability
 *
 * Input:
 *   { client_id, financial_year, firm_id,
 *     confidence_threshold?: number  (default 40),
 *     rescan?: boolean               (default false — preserve actioned flags) }
 *
 * Output:
 *   { scanned, excluded_mapped, flagged, estimated_total_tds, flags[] }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Expense parent-group filter (same as tds-ai-mapper) ─────────────────────
const EXPENSE_TOKENS = [
  "expense", "indirect", "direct", "purchase", "creditor",
  "manufacturing", "trading", "administrative", "selling",
  "salary", "wages", "rent", "commission", "professional",
  "maintenance", "contractor", "service", "freight", "transport",
  "advertisement", "advertising", "outsource", "miscellaneous",
  "other", "general",
];

const SKIP_TOKENS = [
  "bank account", "cash-in-hand", "cash in hand",
  "capital account", "reserves", "fixed assets", "investment",
  "duties & taxes", "duties and taxes", "sundry debtor",
  "stock-in-hand", "stock in hand", "current asset",
  "loans (liability)", "branch", "statutory",
];

function isExpenseGroup(pg: string | null): boolean {
  if (!pg) return false;
  const lower = pg.toLowerCase();
  if (SKIP_TOKENS.some(t => lower.includes(t))) return false;
  return EXPENSE_TOKENS.some(t => lower.includes(t));
}

// ─── Section heuristics map ───────────────────────────────────────────────────
// Keys are lowercase English keywords found in ledger names.
// Multiple keys can map to the same section — scores accumulate.
interface HeuristicEntry {
  section: string;
  nature: string;
  rate: number;        // % — 0 means slab-based (e.g. 192)
  threshold: number;   // Annual aggregate threshold in ₹
}

const SECTION_HEURISTICS: Record<string, HeuristicEntry> = {
  // Section 192 — Salary
  "salary":           { section: "192",  nature: "Salary",                          rate: 0,    threshold: 250000 },
  "wages":            { section: "192",  nature: "Salary / Wages",                  rate: 0,    threshold: 250000 },
  "remuneration":     { section: "192",  nature: "Remuneration",                    rate: 0,    threshold: 250000 },

  // Section 194C — Contractors
  "contractor":       { section: "194C", nature: "Contractor Payments",             rate: 1,    threshold: 100000 },
  "sub-contractor":   { section: "194C", nature: "Sub-contractor",                  rate: 1,    threshold: 100000 },
  "subcontractor":    { section: "194C", nature: "Sub-contractor",                  rate: 1,    threshold: 100000 },
  "labour":           { section: "194C", nature: "Labour Charges",                  rate: 1,    threshold: 100000 },
  "contract":         { section: "194C", nature: "Contract Charges",                rate: 1,    threshold: 100000 },
  "freight":          { section: "194C", nature: "Freight / Transport",             rate: 1,    threshold: 100000 },
  "transport":        { section: "194C", nature: "Transport Charges",               rate: 1,    threshold: 100000 },
  "advertisement":    { section: "194C", nature: "Advertisement",                   rate: 1,    threshold: 100000 },
  "advertising":      { section: "194C", nature: "Advertising",                     rate: 1,    threshold: 100000 },
  "printing":         { section: "194C", nature: "Printing / Stationery",           rate: 1,    threshold: 100000 },
  "maintenance":      { section: "194C", nature: "Maintenance / Repairs",           rate: 1,    threshold: 100000 },
  "repair":           { section: "194C", nature: "Repairs",                         rate: 1,    threshold: 100000 },
  "security":         { section: "194C", nature: "Security Services",               rate: 1,    threshold: 100000 },
  "housekeeping":     { section: "194C", nature: "Housekeeping",                    rate: 1,    threshold: 100000 },
  "cleaning":         { section: "194C", nature: "Cleaning Services",               rate: 1,    threshold: 100000 },
  "manpower":         { section: "194C", nature: "Manpower Supply",                 rate: 1,    threshold: 100000 },
  "staffing":         { section: "194C", nature: "Staffing / Manpower",             rate: 1,    threshold: 100000 },
  "catering":         { section: "194C", nature: "Catering Services",               rate: 1,    threshold: 100000 },

  // Section 194J — Professional / Technical
  "professional":     { section: "194J", nature: "Professional Fees",               rate: 10,   threshold: 30000  },
  "technical":        { section: "194J", nature: "Technical Services",              rate: 2,    threshold: 30000  },
  "consultation":     { section: "194J", nature: "Consultancy",                     rate: 10,   threshold: 30000  },
  "consultancy":      { section: "194J", nature: "Consultancy",                     rate: 10,   threshold: 30000  },
  "consulting":       { section: "194J", nature: "Consulting Services",             rate: 10,   threshold: 30000  },
  "legal":            { section: "194J", nature: "Legal / Professional",            rate: 10,   threshold: 30000  },
  "audit":            { section: "194J", nature: "Audit Fees",                      rate: 10,   threshold: 30000  },
  "accounting":       { section: "194J", nature: "Accounting / Audit",              rate: 10,   threshold: 30000  },
  "software":         { section: "194J", nature: "Software Development / IT",       rate: 2,    threshold: 30000  },
  "royalty":          { section: "194J", nature: "Royalty",                         rate: 10,   threshold: 30000  },
  "outsourc":         { section: "194J", nature: "Outsourcing",                     rate: 10,   threshold: 30000  },

  // Section 194H — Commission / Brokerage
  "commission":       { section: "194H", nature: "Commission / Brokerage",          rate: 5,    threshold: 15000  },
  "brokerage":        { section: "194H", nature: "Brokerage",                       rate: 5,    threshold: 15000  },
  "agency":           { section: "194H", nature: "Agency Commission",               rate: 5,    threshold: 15000  },

  // Section 194I — Rent
  "rent":             { section: "194I", nature: "Rent",                            rate: 10,   threshold: 240000 },
  "lease":            { section: "194I", nature: "Lease Rent",                      rate: 10,   threshold: 240000 },
  "hire":             { section: "194I", nature: "Hire Charges",                    rate: 10,   threshold: 240000 },

  // Section 194A — Interest
  "interest":         { section: "194A", nature: "Interest (non-bank)",             rate: 10,   threshold: 50000  },

  // Section 194R — Benefit / Perquisite
  "gift":             { section: "194R", nature: "Gift / Benefits",                 rate: 10,   threshold: 20000  },
  "incentive":        { section: "194R", nature: "Incentive / Perquisite",          rate: 10,   threshold: 20000  },
  "perquisite":       { section: "194R", nature: "Perquisite",                      rate: 10,   threshold: 20000  },
};

// ─── Parent-group → section context (for confidence boost) ───────────────────
const GROUP_SECTION_CONTEXT: Array<{ token: string; sections: string[] }> = [
  { token: "salary",      sections: ["192"]  },
  { token: "contractor",  sections: ["194C"] },
  { token: "professional",sections: ["194J"] },
  { token: "consultant",  sections: ["194J"] },
  { token: "commission",  sections: ["194H"] },
  { token: "rent",        sections: ["194I"] },
  { token: "interest",    sections: ["194A"] },
  { token: "indirect",    sections: ["194C", "194J", "194H", "194I"] },
  { token: "direct",      sections: ["194C", "194J"] },
  { token: "purchase",    sections: ["194C"] },
];

function groupContextBoost(parentGroup: string | null, section: string): number {
  if (!parentGroup) return 0;
  const pg = parentGroup.toLowerCase();
  for (const ctx of GROUP_SECTION_CONTEXT) {
    if (pg.includes(ctx.token) && ctx.sections.includes(section)) return 15;
  }
  return 0;
}

// ─── Main scoring function ────────────────────────────────────────────────────
interface SectionMatch {
  section:    string;
  nature:     string;
  rate:       number;
  threshold:  number;
  confidence: number;
  matched_keywords: string[];
}

function scoreAgainstHeuristics(
  ledgerName: string,
  parentGroup: string | null,
): SectionMatch | null {
  const nameTokens = ledgerName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2);

  if (nameTokens.length === 0) return null;

  // Accumulate scores per section
  interface SectionAccum {
    score: number;
    entry: HeuristicEntry;
    keywords: string[];
  }
  const bySection = new Map<string, SectionAccum>();

  for (const token of nameTokens) {
    for (const [keyword, entry] of Object.entries(SECTION_HEURISTICS)) {
      let tokenScore = 0;
      if (token === keyword)                                          tokenScore = 80; // exact
      else if (token.startsWith(keyword) || keyword.startsWith(token)) tokenScore = 65; // prefix
      else if (token.includes(keyword)   || keyword.includes(token))   tokenScore = 45; // substring
      if (tokenScore === 0) continue;

      const existing = bySection.get(entry.section);
      if (!existing) {
        bySection.set(entry.section, { score: tokenScore, entry, keywords: [keyword] });
      } else {
        // Accumulate: second match on same section adds 50% of its score
        existing.score    = Math.min(95, existing.score + tokenScore * 0.5);
        existing.keywords = [...new Set([...existing.keywords, keyword])];
        // If same section has a higher-quality entry (more specific nature), keep it
        if (tokenScore > 60 && existing.entry.nature.length < entry.nature.length) {
          existing.entry = entry;
        }
      }
    }
  }

  if (bySection.size === 0) return null;

  // Pick best section
  let best: SectionAccum & { section: string } | null = null;
  for (const [section, acc] of bySection) {
    if (!best || acc.score > best.score) {
      best = { section, ...acc };
    }
  }
  if (!best) return null;

  // Apply parent-group context boost
  const boost      = groupContextBoost(parentGroup, best.section);
  const confidence = Math.min(95, Math.round(best.score + boost));

  return {
    section:          best.section,
    nature:           best.entry.nature,
    rate:             best.entry.rate,
    threshold:        best.entry.threshold,
    confidence,
    matched_keywords: best.keywords,
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface TBLedger {
  ledger_name:   string;
  parent_group:  string | null;
  debit_amount:  number | null;
  credit_amount: number | null;
  closing_balance: number | null;
  balance_type:  string | null;
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
    const {
      client_id, financial_year, firm_id,
      confidence_threshold = 40,
      rescan = false,
    } = body;

    if (!client_id || !financial_year || !firm_id) {
      return new Response(
        JSON.stringify({ error: "client_id, financial_year and firm_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 1. Load all TB ledgers ─────────────────────────────────────────────────
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

    const expenseLedgers = ((tbRows ?? []) as TBLedger[]).filter(
      l => isExpenseGroup(l.parent_group),
    );

    if (expenseLedgers.length === 0) {
      return new Response(
        JSON.stringify({
          status: "ok", scanned: 0, excluded_mapped: 0, flagged: 0,
          estimated_total_tds: 0, flags: [],
          message: "No expense/creditor ledgers found in Trial Balance.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Load confirmed mapped ledger names (to exclude) ────────────────────
    const { data: mappedRows } = await supabase
      .from("tds_tb_party_mappings")
      .select("tb_ledger_name")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .in("mapping_status", ["confirmed", "pending"]);

    const mappedNames = new Set(
      ((mappedRows ?? []) as { tb_ledger_name: string }[]).map(r => r.tb_ledger_name),
    );

    // ── 3. Clear pending Goal 3 flags (idempotent) ────────────────────────────
    await supabase
      .from("tds_recon_flags")
      .delete()
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .eq("goal_number", 3)
      .eq("flag_status", "pending");

    // ── 4. Score each unmapped ledger ──────────────────────────────────────────
    const newFlags: Record<string, unknown>[] = [];
    let excluded_mapped = 0;
    let scanned = 0;

    for (const tb of expenseLedgers) {
      if (mappedNames.has(tb.ledger_name)) { excluded_mapped++; continue; }
      scanned++;

      const match = scoreAgainstHeuristics(tb.ledger_name, tb.parent_group);
      if (!match || match.confidence < confidence_threshold) continue;

      // Activity proxy: prefer debit_amount (payments made) then credit
      const activity = Math.max(tb.debit_amount ?? 0, tb.credit_amount ?? 0);

      // Skip if activity below threshold (TDS not applicable)
      if (activity > 0 && activity <= match.threshold) continue;

      // Estimated TDS (0 for slab-based sections like 192)
      const estimatedTds = match.rate > 0 && activity > match.threshold
        ? Math.round(activity * match.rate / 100)
        : 0;

      const reasoning =
        `Ledger "${tb.ledger_name}" (group: "${tb.parent_group ?? "—"}") ` +
        `matched keyword${match.matched_keywords.length > 1 ? "s" : ""} ` +
        `[${match.matched_keywords.join(", ")}] → inferred Section ${match.section} ` +
        `(${match.nature}). ` +
        `Annual activity: ₹${activity.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` +
        (match.threshold > 0
          ? ` exceeds threshold ₹${match.threshold.toLocaleString("en-IN")}.`
          : ".") +
        (estimatedTds > 0
          ? ` Estimated TDS @ ${match.rate}% = ₹${estimatedTds.toLocaleString("en-IN")}.`
          : " TDS rate is slab-based — estimated liability not computed.") +
        " No TDS filing entry found for this ledger — verify if deductee is registered.";

      newFlags.push({
        client_id, firm_id, financial_year,
        flag_type:         "missing_tds_obligation",
        goal_number:       3,
        tb_ledger_name:    tb.ledger_name,
        tds_deductee_name: null,            // unknown — to be mapped by auditor
        section_code:      match.section,
        nature_of_payment: match.nature,
        book_amount:       activity || null,
        tds_amount:        null,
        expected_tds:      estimatedTds || null,
        actual_tds:        0,
        variance_amount:   estimatedTds || null,
        expected_rate:     match.rate    || null,
        actual_rate:       0,
        threshold_amount:  match.threshold || null,
        voucher_ids:       [],
        deductee_ids:      [],
        mapping_id:        null,
        ai_reasoning:      reasoning,
        ai_confidence:     match.confidence,
        sample_narrations: [],
        flag_status:       "pending",
      });
    }

    // ── 5. Insert new flags ────────────────────────────────────────────────────
    let flagged = 0;
    if (newFlags.length > 0) {
      const { error: insertErr } = await supabase
        .from("tds_recon_flags")
        .insert(newFlags);
      if (insertErr) {
        return new Response(
          JSON.stringify({ error: `Insert error: ${insertErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      flagged = newFlags.length;
    }

    const estimated_total_tds = newFlags.reduce(
      (sum, f) => sum + ((f.expected_tds as number) || 0), 0,
    );

    return new Response(
      JSON.stringify({
        status: "ok",
        scanned,
        excluded_mapped,
        flagged,
        estimated_total_tds,
        flags: newFlags.map(f => ({
          tb_ledger_name: f.tb_ledger_name,
          section_code:   f.section_code,
          nature_of_payment: f.nature_of_payment,
          book_amount:    f.book_amount,
          expected_tds:   f.expected_tds,
          ai_confidence:  f.ai_confidence,
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
