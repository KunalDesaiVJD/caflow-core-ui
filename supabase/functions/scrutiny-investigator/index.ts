// scrutiny-investigator — Tally-Sync-aware AI Auditor.
//
// ROOT CAUSE FIX: the old flow sent claude-gateway ONLY finding rollups (no financial figures), so
// any question about ledger balances / amounts / TB / party balances got "not available in snapshot"
// even when Tally Sync had the data. This function fetches the LIVE Tally Sync tables
// (tally_trial_balance / tally_vouchers) — the exact source run-scrutiny-v2 uses — falls back to
// trial_balance_snapshots, builds a compact financial context (TB totals, group rollups, top ledgers,
// party balances, voucher stats), merges it with the finding rollups, and delegates the actual LLM
// call to claude-gateway (so all provider/model/fallback logic stays in one place).
//
// Universal by construction: queries by client_id + financial_year (both columns exist on the tally_*
// tables), so it works for every client that has completed Tally Sync — no per-client wiring.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { tbFromTallyTB, tbFromSnapshot, vouchersFromSnapshot } from "../_shared/adapters.ts";
import type { TBRow, VoucherRow } from "../_shared/detectionEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const round = (n: number) => Math.round(n);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { question, client_id, financial_year, engagement_id, base_context } = await req.json();
    if (!question || !client_id || !financial_year) {
      return json({ error: "Missing question, client_id or financial_year" }, 400);
    }

    // ── Firm-ownership gate (service role bypasses RLS, so verify the caller owns this client) ──
    const { data: dbUser } = await supabase.from("users").select("firm_id, role").eq("id", user.id).single();
    const isSuper = dbUser?.role === "superadmin";
    if (!isSuper) {
      const { data: client } = await supabase.from("clients").select("firm_id").eq("id", client_id).single();
      if (!client || !dbUser?.firm_id || client.firm_id !== dbUser.firm_id) {
        return json({ error: "Forbidden: client is not in your firm" }, 403);
      }
    }

    // PostgREST caps a select at 1000 rows — page through so large engagements are complete.
    const fetchAll = async (table: string, limit = 25000): Promise<Record<string, unknown>[]> => {
      const PAGE = 1000;
      const out: Record<string, unknown>[] = [];
      for (let from = 0; from < limit; from += PAGE) {
        let q = supabase.from(table).select("*").eq("client_id", client_id).eq("financial_year", financial_year);
        if (engagement_id) q = q.eq("engagement_id", engagement_id);
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) { console.error(`${table} page@${from}:`, error.message); break; }
        if (!data || data.length === 0) break;
        out.push(...(data as Record<string, unknown>[]));
        if (data.length < PAGE) break;
      }
      return out;
    };

    // ── Trial balance (ledger grain) — Tally Sync first, snapshot fallback ──
    let tb: TBRow[] = [];
    let source: "tally_sync" | "snapshot" | "none" = "none";
    const tallyTB = await fetchAll("tally_trial_balance");
    if (tallyTB.length > 0) {
      tb = tbFromTallyTB(tallyTB as never[]);
      source = "tally_sync";
    } else {
      const { data: snap } = await supabase
        .from("trial_balance_snapshots").select("normalised_data, raw_data")
        .eq("client_id", client_id).eq("financial_year", financial_year).maybeSingle();
      if (snap && Array.isArray(snap.normalised_data)) { tb = tbFromSnapshot(snap.normalised_data as never[]); source = "snapshot"; }
    }

    // ── Vouchers (voucher grain) — Tally Sync first, snapshot fallback ──
    let vouchers: VoucherRow[] = [];
    if (source === "tally_sync") {
      const tv = await fetchAll("tally_vouchers");
      vouchers = vouchersFromSnapshot(tv as never[]);
    } else if (source === "snapshot") {
      const { data: snap } = await supabase
        .from("trial_balance_snapshots").select("raw_data")
        .eq("client_id", client_id).eq("financial_year", financial_year).maybeSingle();
      if (snap && Array.isArray(snap.raw_data)) vouchers = vouchersFromSnapshot(snap.raw_data as never[]);
    }

    // ── Build a compact, token-bounded financial context the LLM can reason over ──
    const financials = buildFinancials(tb, vouchers, source);

    const context = {
      ...(base_context && typeof base_context === "object" ? base_context : {}),
      financials,
    };

    // ── Delegate the LLM call to claude-gateway (keeps provider/model/fallback logic in one place) ──
    const gwRes = await fetch(`${SUPABASE_URL}/functions/v1/claude-gateway`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        request_type: "scrutiny_investigator",
        user_message: JSON.stringify({ question, context }),
      }),
    });
    const gwBody = await gwRes.text();
    return new Response(gwBody, { status: gwRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("scrutiny-investigator error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function buildFinancials(tb: TBRow[], vouchers: VoucherRow[], source: string) {
  // Trial-balance totals + group rollups
  let drTotal = 0, crTotal = 0;
  const groupMap = new Map<string, { group: string; dr: number; cr: number; ledgers: number }>();
  for (const r of tb) {
    const isCr = r.balance_type === "Cr";
    if (isCr) crTotal += r.closing_balance; else drTotal += r.closing_balance;
    const g = (r.parent_group || "Ungrouped").trim();
    const e = groupMap.get(g) ?? { group: g, dr: 0, cr: 0, ledgers: 0 };
    if (isCr) e.cr += r.closing_balance; else e.dr += r.closing_balance;
    e.ledgers++;
    groupMap.set(g, e);
  }
  const groups = [...groupMap.values()]
    .map((e) => ({ group: e.group, net_balance: round(e.dr - e.cr), side: e.dr - e.cr >= 0 ? "Dr" : "Cr", ledgers: e.ledgers }))
    .sort((a, b) => Math.abs(b.net_balance) - Math.abs(a.net_balance))
    .slice(0, 40);

  const top_ledgers = [...tb]
    .sort((a, b) => b.closing_balance - a.closing_balance)
    .slice(0, 80)
    .map((r) => ({ ledger: r.ledger_name, group: r.parent_group ?? null, closing: round(r.closing_balance), side: r.balance_type }));

  // Voucher stats: totals, by type, top parties
  const byType = new Map<string, { type: string; count: number; total: number }>();
  const byParty = new Map<string, { party: string; count: number; total: number }>();
  let vTotal = 0;
  for (const v of vouchers) {
    const amt = Math.abs(v.amount ?? 0);
    vTotal += amt;
    const t = (v.voucher_type || "Unknown").trim();
    const et = byType.get(t) ?? { type: t, count: 0, total: 0 };
    et.count++; et.total += amt; byType.set(t, et);
    const p = (v.party_ledger || v.ledger_name || "").trim();
    if (p) { const ep = byParty.get(p) ?? { party: p, count: 0, total: 0 }; ep.count++; ep.total += amt; byParty.set(p, ep); }
  }
  const by_type = [...byType.values()].sort((a, b) => b.total - a.total).slice(0, 15).map((e) => ({ ...e, total: round(e.total) }));
  const top_parties = [...byParty.values()].sort((a, b) => b.total - a.total).slice(0, 40).map((e) => ({ ...e, total: round(e.total) }));

  return {
    source, // "tally_sync" | "snapshot" | "none"
    available: tb.length > 0 || vouchers.length > 0,
    trial_balance: {
      ledger_count: tb.length,
      dr_closing_total: round(drTotal),
      cr_closing_total: round(crTotal),
      balanced: Math.abs(drTotal - crTotal) < 1,
    },
    groups,
    top_ledgers,
    vouchers: { count: vouchers.length, total_amount: round(vTotal), by_type },
    top_parties,
  };
}
