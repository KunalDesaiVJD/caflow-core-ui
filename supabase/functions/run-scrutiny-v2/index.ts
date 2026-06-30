// run-scrutiny-v2 — deterministic detection_logic interpreter over the seeded scrutiny_rules.
//
// Reuses the UNIT-TESTED engine + adapters from ../_shared/* (kept byte-identical to
// src/lib/scrutiny/* by src/lib/scrutiny/sharedSync.test.ts). This is a NEW function — it does
// NOT touch the live `run-scrutiny`, so it can be wired behind a flag and A/B-tested.
//
// STATUS: authored, NOT yet deployed (no dev DB). Acceptance test = handoff Ticket 1.1
// (non-zero finding_count, no error) once a dev DB exists. AI narration enrichment is
// intentionally out of scope here (Phase 2, senior-owned).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runDetection } from "../_shared/detectionEngine.ts";
import { rulesFromRows, tbFromSnapshot, vouchersFromSnapshot, findingToRow } from "../_shared/adapters.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { client_id, financial_year, firm_id } = await req.json();
    if (!client_id || !financial_year) return json({ error: "Missing client_id or financial_year" }, 400);

    // ── Firm-ownership gate (IDOR fix, handoff Ticket 0.4) ──
    // The service-role client bypasses RLS, so we MUST verify the caller's firm owns this client.
    const { data: dbUser } = await supabase.from("users").select("firm_id, role").eq("id", user.id).single();
    const isSuper = dbUser?.role === "superadmin";
    if (!isSuper) {
      const { data: client } = await supabase.from("clients").select("firm_id").eq("id", client_id).single();
      if (!client || !dbUser?.firm_id || client.firm_id !== dbUser.firm_id) {
        return json({ error: "Forbidden: client is not in your firm" }, 403);
      }
    }

    // ── Clean previous open findings (same contract as v1) ──
    await supabase
      .from("scrutiny_findings")
      .delete()
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .eq("status", "open");

    // ── Current-year trial balance snapshot ──
    const { data: snapshot } = await supabase
      .from("trial_balance_snapshots")
      .select("raw_data, normalised_data")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .single();

    if (!snapshot) return json({ error: "No trial balance found for this client and year" }, 404);

    const normalised: unknown[] = Array.isArray(snapshot.normalised_data) ? snapshot.normalised_data : [];
    const raw: unknown[] = Array.isArray(snapshot.raw_data) ? snapshot.raw_data : [];

    // ── Prior-year TB (enables py_comparison / capital_change) ──
    let tbPY: ReturnType<typeof tbFromSnapshot> | undefined;
    const prevYear = getPreviousYear(financial_year);
    if (prevYear) {
      const { data: prev } = await supabase
        .from("trial_balance_snapshots")
        .select("normalised_data")
        .eq("client_id", client_id)
        .eq("financial_year", prevYear)
        .single();
      if (prev && Array.isArray(prev.normalised_data)) tbPY = tbFromSnapshot(prev.normalised_data as never[]);
    }

    // ── Active rule catalogue (the 119 seeded rules) ──
    const { data: ruleRows } = await supabase
      .from("scrutiny_rules")
      .select("*")
      .eq("is_active", true)
      .order("rule_id");
    const rules = rulesFromRows(ruleRows as never[]);

    // ── Run the interpreter ──
    const result = runDetection(
      rules,
      {
        tb: tbFromSnapshot(normalised as never[]),
        vouchers: vouchersFromSnapshot(raw as never[]),
        tbPY,
      },
      {
        financialYearStart: fyStartDate(financial_year),
        financialYearEnd: fyEndDate(financial_year),
      },
      { emitAdvisoryForUnhandled: false },
    );

    // ── Persist findings (existing scrutiny_findings shape) ──
    const rows = result.findings.map((f) => findingToRow(f, { client_id, financial_year }));
    if (rows.length > 0) {
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: insertErr } = await supabase.from("scrutiny_findings").insert(rows.slice(i, i + CHUNK));
        if (insertErr) console.error("Insert findings error:", insertErr);
      }
    }

    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const r of rows) {
      const s = r.severity.toUpperCase();
      if (s === "HIGH") counts.HIGH++;
      else if (s === "MEDIUM") counts.MEDIUM++;
      else counts.LOW++;
    }
    const total = rows.length;

    // ── Completion notification (best-effort, same as v1) ──
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "scrutiny_complete",
          firm_id,
          data: { client_id, financial_year, findings_created: counts, total },
        }),
      });
    } catch (notifyErr) {
      console.error("Notification error:", notifyErr);
    }

    return json({
      findings_created: counts,
      total,
      coverage: result.coverage, // rulesHandled / executedKinds / unhandled (advisory)
    });
  } catch (e) {
    console.error("run-scrutiny-v2 error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function getPreviousYear(fy: string): string | null {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startYear = parseInt(m[1]) - 1;
  const endYear = parseInt(m[2]) - 1;
  return `${startYear}-${endYear.toString().padStart(2, "0")}`;
}

function fyStartDate(fy: string): string | undefined {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  return m ? `${parseInt(m[1])}-04-01` : undefined;
}

function fyEndDate(fy: string): string | undefined {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  return m ? `${parseInt(m[1]) + 1}-03-31` : undefined;
}
