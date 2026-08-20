// run-scrutiny-v2 — deterministic detection_logic interpreter over the seeded scrutiny_rules.
//
// Reuses the UNIT-TESTED engine + adapters from ../_shared/* (kept byte-identical to
// src/lib/scrutiny/* by src/lib/scrutiny/sharedSync.test.ts).
//
// STATUS: the only scrutiny engine. The legacy `run-scrutiny` (v1) only read file-import
// snapshots and failed for Tally-synced clients; every caller now routes here via
// src/lib/scrutiny/flags.ts, and v1's function has been deleted. Its narration_rules
// (keyword + AI classification, Settings → Narration Rules) layer is ported below as a
// best-effort routing step, same shape as the TDS routing it sits next to.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runDetection } from "../_shared/detectionEngine.ts";
import { rulesFromRows, tbFromSnapshot, tbFromTallyTB, vouchersFromSnapshot, findingToRow, faFromRows, ruleAppliesToEntity } from "../_shared/adapters.ts";

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

    // PostgREST caps a single select at 1000 rows; large engagements (RAY WINGS: 3.2k vouchers)
    // must be paged or the engine analyses only a partial dataset. Reads ALL rows for a table.
    const fetchAllByEngagement = async (table: string, engId: string): Promise<unknown[]> => {
      const PAGE = 1000;
      const out: unknown[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from(table).select("*").eq("engagement_id", engId).range(from, from + PAGE - 1);
        if (error) { console.error(`${table} page@${from} error:`, error.message); break; }
        if (!data || data.length === 0) break;
        out.push(...data);
        if (data.length < PAGE) break;
      }
      return out;
    };

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { client_id, financial_year, firm_id, engagement_id, preview_rule } = await req.json();
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

    // ── Entity-type bucket (corporate vs non-corporate) ──
    // Companies-Act rules (dividend/DRR/buy-back/CSR/Sec73-186/director remuneration/inter-co) must
    // never hit an LLP/firm/individual, and partnership rules never hit a Company. Rules carry
    // applicable_to = ["corporate"] | ["non_corporate"] | both; we filter by the client's bucket.
    const { data: clientMeta } = await supabase.from("clients").select("entity_type").eq("id", client_id).single();
    const entityBucket = /private ltd|public ltd|pvt\.? ?ltd|\bcompany\b|corporate/i.test(String(clientMeta?.entity_type ?? ""))
      ? "corporate"
      : "non_corporate";

    // ── Resolve the engagement ──
    // Tally Sync (the Team Package — the SAME integration main uses) writes tally_trial_balance /
    // tally_vouchers keyed by engagement_id, NOT client_id. The frontend passes the selected
    // engagement; fall back to resolving it from (client_id, financial_year) for older callers.
    let engId: string | null = engagement_id ?? null;
    if (!engId) {
      const { data: eng } = await supabase
        .from("audit_engagements")
        .select("id")
        .eq("client_id", client_id)
        .eq("financial_year", financial_year)
        .maybeSingle();
      engId = eng?.id ?? null;
    }

    // ── Current-year TB + vouchers ──
    // Prefer the live Tally Sync tables. Fall back to trial_balance_snapshots (file import).
    let tbCur: ReturnType<typeof tbFromSnapshot> = [];
    let vouchersCur: ReturnType<typeof vouchersFromSnapshot> = [];
    let source: "tally_sync" | "snapshot" | null = null;

    if (engId) {
      const tallyTB = await fetchAllByEngagement("tally_trial_balance", engId);
      if (tallyTB.length > 0) {
        const tallyVch = await fetchAllByEngagement("tally_vouchers", engId);
        tbCur = tbFromTallyTB(tallyTB as never[]);
        vouchersCur = vouchersFromSnapshot(tallyVch as never[]);
        source = "tally_sync";
      }
    }

    if (!source) {
      const { data: snapshot } = await supabase
        .from("trial_balance_snapshots")
        .select("raw_data, normalised_data")
        .eq("client_id", client_id)
        .eq("financial_year", financial_year)
        .single();
      if (!snapshot) {
        return json({
          error: "No trial balance found for this client and year. Run Tally Sync (or import a trial balance) first.",
        }, 404);
      }
      tbCur = tbFromSnapshot((Array.isArray(snapshot.normalised_data) ? snapshot.normalised_data : []) as never[]);
      vouchersCur = vouchersFromSnapshot((Array.isArray(snapshot.raw_data) ? snapshot.raw_data : []) as never[]);
      source = "snapshot";
    }

    // ── Prior-year TB (enables py_comparison / capital_change) ──
    // Prior year is a SEPARATE engagement, so resolve its id before reading its tally_* rows.
    let tbPY: ReturnType<typeof tbFromSnapshot> | undefined;
    const prevYear = getPreviousYear(financial_year);
    if (prevYear) {
      const { data: prevEng } = await supabase
        .from("audit_engagements")
        .select("id")
        .eq("client_id", client_id)
        .eq("financial_year", prevYear)
        .maybeSingle();
      if (prevEng?.id) {
        const tallyPY = await fetchAllByEngagement("tally_trial_balance", prevEng.id);
        if (tallyPY.length > 0) tbPY = tbFromTallyTB(tallyPY as never[]);
      }
      if (!tbPY) {
        const { data: prev } = await supabase
          .from("trial_balance_snapshots")
          .select("normalised_data")
          .eq("client_id", client_id)
          .eq("financial_year", prevYear)
          .single();
        if (prev && Array.isArray(prev.normalised_data)) tbPY = tbFromSnapshot(prev.normalised_data as never[]);
      }
    }

    // ── Fixed-asset register (fa_assets, keyed by client_id + fy) — enables depreciation checks. ──
    let fa: ReturnType<typeof faFromRows> | undefined;
    {
      const { data: faRows } = await supabase
        .from("fa_assets")
        .select("asset_name, gross_block_closing, wdv_closing, accumulated_dep_closing, depreciation_for_year, is_fully_depreciated, disposals_during_year, disposal_date")
        .eq("client_id", client_id)
        .eq("fy", financial_year);
      if (faRows && faRows.length > 0) fa = faFromRows(faRows as never[]);
    }

    // ── Related-party master (related_parties.party_name) — enables the RPT checks. When empty the
    // RPT handlers emit an honest "related-party list not captured" advisory instead of nothing. ──
    let rp: string[] | undefined;
    {
      const { data: rpRows } = await supabase.from("related_parties").select("party_name").eq("client_id", client_id);
      const names = (rpRows ?? []).map((r: { party_name?: string | null }) => String(r.party_name ?? "").trim()).filter(Boolean);
      if (names.length > 0) rp = names;
    }

    // ── DRY-RUN (preview) — run ONE draft rule against this engagement's data and return the
    // findings WITHOUT persisting or deleting anything. Powers the AI Rule Composer preview so the
    // user sees exactly what a rule would flag before applying it.
    if (preview_rule) {
      const previewRules = rulesFromRows([preview_rule] as never[]);
      const pv = runDetection(
        previewRules,
        { tb: tbCur, vouchers: vouchersCur, tbPY, fa, rp },
        { financialYearStart: fyStartDate(financial_year), financialYearEnd: fyEndDate(financial_year) },
        { emitAdvisoryForUnhandled: true },
      );
      return json({
        preview: true,
        source,
        input: { ledgers: tbCur.length, vouchers: vouchersCur.length, priorYearLedgers: tbPY?.length ?? 0 },
        total: pv.findings.filter((f) => !f.advisory).length,
        findings: pv.findings.slice(0, 200), // sample cap for the preview
        ledger: pv.ledger,
      });
    }

    // ── Active rule catalogue (the 119 seeded rules) ──
    const { data: ruleRows } = await supabase
      .from("scrutiny_rules")
      .select("*")
      .eq("is_active", true)
      .order("rule_id");
    // Filter to rules applicable to this entity type (corporate vs non-corporate never mix).
    const rules = rulesFromRows(ruleRows as never[]).filter((r) => ruleAppliesToEntity(r, entityBucket));

    // ── Approved materiality for this engagement ──
    // Rules that opt in via detection_logic.materiality have their thresholds rescaled to it, so a
    // Rs.1,000 balance is not raised at a Rs.100cr company. Only an APPROVED judgment counts: a
    // proposal nobody has signed off must not affect a run, and with none approved every rule falls
    // back to its literal threshold rather than going silent.
    const { data: matRow } = await supabase
      .from("scrutiny_judgments")
      .select("decided")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .eq("kind", "materiality")
      .eq("status", "approved")
      .not("decided", "is", null)
      .maybeSingle();
    const materiality = (matRow?.decided ?? null) as
      | { materiality: number; performance: number; trivial: number }
      | null;

    // ── Run the interpreter ──
    const result = runDetection(
      rules,
      {
        tb: tbCur,
        vouchers: vouchersCur,
        tbPY,
        fa,
        rp,
      },
      {
        financialYearStart: fyStartDate(financial_year),
        financialYearEnd: fyEndDate(financial_year),
        materiality,
      },
      // Two-tier output: a capped, ranked shortlist plus review notes. Without this the auditor
      // faces ~95 undifferentiated items per engagement, which is why none have ever been actioned.
      { emitAdvisoryForUnhandled: false, triage: { maxQueries: 25, maxPerRule: 3 } },
    );

    // ── Persist findings (existing scrutiny_findings shape) ──
    // Stamp firm_id (the RLS scope — findings are firm-scoped) + engagement_id so the app can
    // read them back and key them per engagement. Resolve firm from the client, not the caller.
    const { data: clientRow } = await supabase.from("clients").select("firm_id").eq("id", client_id).single();
    const findingFirmId = clientRow?.firm_id ?? firm_id ?? null;
    // Persist only real exceptions. Advisory / needs-data / no-handler items are NOT written as
    // findings — they are accounted for in the run ledger below (the completeness report), so the
    // findings list stays clean while nothing is ever silently dropped.
    const rows = result.findings.filter((f) => !f.advisory).map((f) => ({
      ...findingToRow(f, { client_id, financial_year }),
      firm_id: findingFirmId,
      engagement_id: engId,
    }));

    // ── TDS routing (Phase 2) ──
    // The scrutiny engine has NO section/rate table, so TDS obligations (short / missing deduction)
    // are delegated to the dedicated tds-missing-scanner, which scores every expense/creditor ledger
    // against the 194C/194J/194I/194H/194A section+rate+threshold tables straight off the TB (no
    // human mapping needed). We mirror its flags into scrutiny_findings so TDS defaults surface in
    // the same unified list. Best-effort: a scanner failure never blocks the deterministic run.
    const fmtINR = (v: unknown) => (v == null ? "?" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`);
    let tdsRows: Record<string, unknown>[] = [];
    if (findingFirmId) {
      try {
        const scanRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/tds-missing-scanner`, {
          method: "POST",
          headers: {
            Authorization: req.headers.get("Authorization") ?? `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ client_id, financial_year, firm_id: findingFirmId }),
        });
        if (scanRes.ok) {
          const scan = await scanRes.json();
          const flags = Array.isArray(scan?.flags) ? scan.flags : [];
          tdsRows = flags.slice(0, 200).map((f: Record<string, unknown>) => ({
            client_id,
            financial_year,
            status: "open",
            rule_id: `TDS-SCAN-${f.section_code ?? "NA"}`,
            category: "TDS",
            severity: "HIGH",
            flag_message: `Possible TDS default u/s ${f.section_code ?? "?"} on ${f.tb_ledger_name ?? "ledger"} (${f.nature_of_payment ?? "payment"}): book amount ${fmtINR(f.book_amount)}, expected TDS ~${fmtINR(f.expected_tds)} but no TDS filing entry found — verify the deduction / section applied.`,
            account_name: (f.tb_ledger_name ?? null) as string | null,
            amount: (f.expected_tds ?? null) as number | null,
            detection_level: "account",
            clause_3cd: null,
            narration: (f.tb_ledger_name ?? null) as string | null,
            firm_id: findingFirmId,
            engagement_id: engId,
          }));
        } else {
          console.error("tds-missing-scanner returned", scanRes.status);
        }
      } catch (tdsErr) {
        console.error("tds-missing-scanner routing error:", tdsErr);
      }
    }

    // ── Narration routing (ported from the retired v1 `run-scrutiny`) ──
    // v1 read every active narration_rules row (Settings → Narration Rules) and, for each voucher
    // narration: matched it against a rule's keywords in order; a "flag" rule raised a finding
    // directly, a "send_ai" rule queued the entry for AI classification via claude-gateway. Neither
    // path has a v2 equivalent, so a firm's custom narration rules would go silently dead the moment
    // v1 is removed — ported here in the same best-effort, never-blocks-the-run shape as the TDS
    // routing above.
    //
    // Fixed while porting: v1 fetched narration_rules with NO firm_id filter at all (only an
    // ORDER BY firm_id, presumably meant to make this firm's custom rows sort first) — every firm's
    // custom keyword rules silently applied to every OTHER firm's runs. Scoped here to this firm's
    // rows plus firm-less (global default) rows only.
    let narrationRows: Record<string, unknown>[] = [];
    if (findingFirmId) {
      try {
        const { data: narrationRules } = await supabase
          .from("narration_rules")
          .select("*")
          .eq("is_active", true)
          .or(`firm_id.is.null,firm_id.eq.${findingFirmId}`)
          .order("firm_id", { ascending: false, nullsFirst: false });
        const nRules = (narrationRules ?? []) as { id: string; keywords: string[] | null; action: string | null; category: string | null; severity: string | null; message: string | null }[];

        const voucherEntries = vouchersCur.filter((v) => typeof v.narration === "string" && v.narration.trim().length > 0);
        const aiBatch: { entry_id: string; date: string; narration: string; amount: number; ledger_name: string; debit_credit: string }[] = [];

        voucherEntries.forEach((entry, idx) => {
          const narLower = String(entry.narration).toLowerCase();
          const rule = nRules.find((r) => (r.keywords ?? []).some((kw) => narLower.includes(String(kw).toLowerCase())));
          if (!rule) return;
          if (rule.action === "flag") {
            narrationRows.push({
              client_id, financial_year, status: "open",
              rule_id: `NAR-${String(rule.id).slice(0, 8)}`,
              category: rule.category ?? "NAR",
              severity: (rule.severity ?? "MEDIUM").toUpperCase(),
              flag_message: rule.message || `Narration rule triggered: ${rule.category ?? ""}`,
              amount: Number(entry.amount) || null,
              detection_level: "voucher",
              clause_3cd: null,
              narration: entry.narration,
              firm_id: findingFirmId,
              engagement_id: engId,
            });
          } else if (rule.action === "send_ai") {
            aiBatch.push({
              entry_id: String(idx),
              date: entry.voucher_date,
              narration: String(entry.narration),
              amount: Number(entry.amount) || 0,
              ledger_name: entry.ledger_name ?? entry.party_ledger ?? "",
              debit_credit: entry.dr_cr ?? "",
            });
          }
        });

        const AI_BATCH_SIZE = 50;
        for (let i = 0; i < aiBatch.length; i += AI_BATCH_SIZE) {
          const batch = aiBatch.slice(i, i + AI_BATCH_SIZE);
          try {
            const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/claude-gateway`, {
              method: "POST",
              headers: {
                Authorization: req.headers.get("Authorization") ?? `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ request_type: "narration_batch_classifier", user_message: JSON.stringify(batch) }),
            });
            if (res.ok) {
              const aiResult = await res.json();
              const items = Array.isArray(aiResult) ? aiResult : aiResult?.raw ? [] : [aiResult];
              for (const item of items) {
                if (item?.category && item.category !== "normal") {
                  const src = batch.find((b) => b.entry_id === String(item.entry_id));
                  narrationRows.push({
                    client_id, financial_year, status: "open",
                    rule_id: "NAR-AI",
                    category: "NAR",
                    severity: String(item.risk_level ?? "MEDIUM").toUpperCase(),
                    flag_message: item.flag_reason || `AI flagged: ${item.category}`,
                    amount: src?.amount ?? null,
                    detection_level: "voucher",
                    clause_3cd: item.suggested_3cd_clause ?? null,
                    narration: src?.narration ?? "",
                    firm_id: findingFirmId,
                    engagement_id: engId,
                  });
                }
              }
            } else {
              console.error("claude-gateway narration batch failed:", res.status);
            }
          } catch (aiErr) {
            console.error("Narration AI batch error:", aiErr);
          }
        }
      } catch (narrErr) {
        console.error("Narration routing error:", narrErr);
      }
    }

    // Delete previous OPEN findings only NOW — after reads + detection + TDS/narration routing have
    // succeeded. A run that fails or times out before this point leaves existing findings intact.
    await supabase.from("scrutiny_findings").delete()
      .eq("client_id", client_id).eq("financial_year", financial_year).eq("status", "open");
    // Insert deterministic + TDS + narration rows in SEPARATE batches — their column sets differ,
    // and PostgREST requires a uniform key set per bulk insert.
    const insertChunked = async (batch: Record<string, unknown>[]) => {
      const CHUNK = 100;
      for (let i = 0; i < batch.length; i += CHUNK) {
        const { error: insertErr } = await supabase.from("scrutiny_findings").insert(batch.slice(i, i + CHUNK));
        if (insertErr) console.error("Insert findings error:", insertErr);
      }
    };
    if (rows.length > 0) await insertChunked(rows);
    if (tdsRows.length > 0) await insertChunked(tdsRows);
    if (narrationRows.length > 0) await insertChunked(narrationRows);

    const allRows = [...rows, ...tdsRows, ...narrationRows];
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const r of allRows) {
      const s = String(r.severity).toUpperCase();
      if (s === "HIGH") counts.HIGH++;
      else if (s === "MEDIUM") counts.MEDIUM++;
      else counts.LOW++;
    }
    const total = allRows.length;

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

    // ── Completeness accounting — the stringent "no rule left behind" control ──
    // Every active rule gets a status; accountedFor MUST equal activeRules. Rules that cannot run
    // (needs prior-year / no evaluator / error) are itemised in `ledger` with a reason — never
    // silently skipped.
    const led = result.ledger;
    const completeness = {
      activeRules: rules.length,
      accountedFor: led.length,
      executed: led.filter((l) => l.status === "executed").length,
      needsData: led.filter((l) => l.status === "needs_data").length,
      noHandler: led.filter((l) => l.status === "skipped_no_handler").length,
      errored: led.filter((l) => l.status === "error").length,
    };

    return json({
      findings_created: counts,
      total,
      tds_flagged: tdsRows.length,         // TDS obligations routed in from tds-missing-scanner (Phase 2)
      narration_flagged: narrationRows.length, // ported from retired v1: narration_rules keyword + AI hits
      source,                              // "tally_sync" | "snapshot" — which data path fed the engine
      input: { ledgers: tbCur.length, vouchers: vouchersCur.length, priorYearLedgers: tbPY?.length ?? 0 },
      coverage: result.coverage,           // rulesHandled / executedKinds / unhandled
      completeness,                        // summary — every active rule accounted for
      ledger: led,                         // per-rule status (executed / needs_data / skipped_no_handler / error + reason)
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
