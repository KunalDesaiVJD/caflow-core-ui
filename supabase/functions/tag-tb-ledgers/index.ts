import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Ledger Name Normaliser ───
function normaliseLedgerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/@\s*\d+(\.\d+)?%?/g, "")
    .replace(/(a\/c|ac|account|accounts)/gi, "")
    .replace(/(exp|expence|expences|expense|expenses)/gi, "")
    .replace(/(pvt|ltd|llp|co|private|limited|and|&)/gi, "")
    .replace(/(cgst|sgst|igst|gst|tds|tcs)/gi, "")
    .replace(/\d{4,}/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Special Account Detection ───
const SPECIAL_ACCOUNTS: Record<string, string[]> = {
  suspense: ["suspense", "suspense account", "clearing account"],
  cash: ["cash in hand", "petty cash", "cash"],
  bank: ["bank", "bank account", "current account", "savings account", "cash credit", "overdraft", "od account"],
  tds_payable: ["tds payable", "194c", "194j", "194a", "192b", "194q", "194h"],
  gst_payable: ["gst payable", "cgst payable", "sgst payable", "igst payable"],
  gst_input: ["input gst", "input cgst", "input sgst", "input igst", "cgst receivable", "sgst receivable", "igst receivable"],
  debtors: ["sundry debtors", "trade debtors", "accounts receivable", "customer outstanding"],
  creditors: ["sundry creditors", "trade creditors", "accounts payable", "vendor outstanding"],
  salary: ["salary", "wages", "payroll", "director salary", "staff salary"],
  depreciation_reserve: ["depreciation reserve", "reserve fund", "accumulated depreciation"],
};

function detectAccountType(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [type, keywords] of Object.entries(SPECIAL_ACCOUNTS)) {
    if (keywords.some(kw => lower.includes(kw))) return type;
  }
  return null;
}

// ─── Sign Convention ───
function computeSignedClosing(
  opening: number, txnDebit: number, txnCredit: number, closing: number,
  normalBalance: string, bsPlSide: string
): number {
  // If closing is populated, use it with sign based on normal balance
  if (closing !== 0) {
    // For Cr-normal accounts (liabilities, income), positive closing = Cr
    // For Dr-normal accounts (assets, expenses), positive closing = Dr
    return normalBalance === "Cr" ? -closing : closing;
  }
  // If only txn data, compute net
  if (txnDebit !== 0 || txnCredit !== 0) {
    return txnDebit - txnCredit;
  }
  // Opening only
  return normalBalance === "Cr" ? -opening : opening;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { engagementId } = await req.json();
    if (!engagementId) {
      return new Response(JSON.stringify({ error: "Missing engagementId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Firm-ownership gate (IDOR fix) ──
    // The service-role client bypasses RLS, so we MUST verify the caller's firm owns this engagement.
    const { data: dbUser } = await supabase.from("users").select("firm_id, role").eq("id", user.id).single();
    const isSuper = dbUser?.role === "superadmin";
    if (!isSuper) {
      const { data: engagement } = await supabase.from("audit_engagements").select("firm_id").eq("id", engagementId).single();
      if (!engagement || !dbUser?.firm_id || String(engagement.firm_id) !== String(dbUser.firm_id)) {
        return new Response(JSON.stringify({ error: "Forbidden: engagement is not in your firm" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 1. Fetch all leaf ledgers for this engagement
    const { data: ledgers, error: ledgerErr } = await supabase
      .from("trial_balance_snapshots")
      .select("id, ledger_name, opening_balance, txn_debit, txn_credit, closing_balance, normal_balance, bs_pl_side, primary_group")
      .eq("engagement_id", engagementId)
      .not("ledger_name", "is", null);

    if (ledgerErr) throw new Error(`Fetch ledgers: ${ledgerErr.message}`);
    if (!ledgers || ledgers.length === 0) {
      return new Response(JSON.stringify({ success: true, tagged: 0, unmatched: 0, categoryBreakdown: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch active scrutiny rules with keywords
    const { data: rules } = await supabase
      .from("scrutiny_rules")
      .select("rule_id, category, keywords_ledger_synonyms, severity, detection_level")
      .eq("is_active", true);

    const activeRules = rules || [];

    // 3. Tag each ledger
    const categoryBreakdown: Record<string, number> = {};
    let matchedCount = 0;
    let unmatchedCount = 0;
    const unmatchedLedgers: { id: string; name: string }[] = [];

    for (const ledger of ledgers) {
      const normName = normaliseLedgerName(ledger.ledger_name || "");
      const rawName = (ledger.ledger_name || "").toLowerCase();

      const matchedCategories = new Set<string>();
      const matchedKeywords: string[] = [];

      // Match against scrutiny rules
      for (const rule of activeRules) {
        if (!rule.keywords_ledger_synonyms) continue;
        const keywords = rule.keywords_ledger_synonyms
          .split(",")
          .map((k: string) => k.trim().toLowerCase())
          .filter((k: string) => k.length > 1);

        const matched = keywords.some((kw: string) => normName.includes(kw) || rawName.includes(kw));
        if (matched) {
          matchedCategories.add(rule.category);
          matchedKeywords.push(...keywords.filter((kw: string) => normName.includes(kw) || rawName.includes(kw)));
        }
      }

      // Detect special account type
      const accountType = detectAccountType(ledger.ledger_name || "");

      // Compute signed closing balance
      const closingSigned = computeSignedClosing(
        ledger.opening_balance || 0,
        ledger.txn_debit || 0,
        ledger.txn_credit || 0,
        ledger.closing_balance || 0,
        ledger.normal_balance || "Unknown",
        ledger.bs_pl_side || "Unknown"
      );

      const catCodes = [...matchedCategories];
      const updatePayload: Record<string, any> = {
        closing_balance_signed: closingSigned,
        account_type: accountType,
      };

      // Only update matched fields if we found matches (preserve manual overrides)
      if (catCodes.length > 0) {
        updatePayload.matched_category_code = catCodes.join(",");
        updatePayload.matched_keywords = [...new Set(matchedKeywords)];
        matchedCount++;
        for (const cat of catCodes) {
          categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
        }
      } else {
        // Check if already manually tagged
        unmatchedCount++;
        unmatchedLedgers.push({ id: ledger.id, name: ledger.ledger_name || "" });
      }

      await supabase
        .from("trial_balance_snapshots")
        .update(updatePayload)
        .eq("id", ledger.id);
    }

    return new Response(JSON.stringify({
      success: true,
      totalLedgers: ledgers.length,
      tagged: matchedCount,
      unmatched: unmatchedCount,
      categoryBreakdown,
      unmatchedLedgers: unmatchedLedgers.slice(0, 200),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("tag-tb-ledgers error:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
