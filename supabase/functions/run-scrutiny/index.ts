import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const { client_id, financial_year, firm_id } = await req.json();
    if (!client_id || !financial_year) {
      return new Response(JSON.stringify({ error: "Missing client_id or financial_year" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, AI: 0 };
    const findings: any[] = [];

    function addFinding(f: any) {
      findings.push({
        client_id,
        financial_year,
        status: "open",
        ...f,
      });
      const sev = (f.severity || "LOW").toUpperCase();
      if (sev === "HIGH") counts.HIGH++;
      else if (sev === "MEDIUM") counts.MEDIUM++;
      else counts.LOW++;
    }

    // ── STEP 1: Clean previous open findings ──
    await supabase
      .from("scrutiny_findings")
      .delete()
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .eq("status", "open");

    // ── STEP 2: Fetch trial balance ──
    const { data: snapshot } = await supabase
      .from("trial_balance_snapshots")
      .select("raw_data, normalised_data")
      .eq("client_id", client_id)
      .eq("financial_year", financial_year)
      .single();

    if (!snapshot) {
      return new Response(JSON.stringify({ error: "No trial balance found for this client and year" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalised: any[] = Array.isArray(snapshot.normalised_data) ? snapshot.normalised_data : [];
    const rawData: any[] = Array.isArray(snapshot.raw_data) ? snapshot.raw_data : [];

    // Helper
    const like = (str: string | null | undefined, pattern: string) =>
      str ? str.toLowerCase().includes(pattern.toLowerCase()) : false;

    // ── STEP 3: Arithmetic Checks ──

    // P03 — Odd minor balances
    for (const ledger of normalised) {
      const group = ledger.account_group || "";
      if (like(group, "creditor") || like(group, "debtor")) {
        const dr = Number(ledger.debit || ledger.closing_dr || 0);
        const cr = Number(ledger.credit || ledger.closing_cr || 0);
        const diff = Math.abs(dr - cr);
        if (diff >= 1 && diff <= 999) {
          addFinding({
            rule_id: "P03",
            severity: "LOW",
            flag_message: `Minor balance Rs ${diff.toFixed(0)} — possible write-off or data entry error`,
            narration: ledger.account_name || ledger.ledger_name || "",
          });
        }
      }
    }

    // P06 — Debit balance in creditor
    for (const ledger of normalised) {
      if (like(ledger.account_group, "creditor")) {
        const dr = Number(ledger.debit || ledger.closing_dr || 0);
        const cr = Number(ledger.credit || ledger.closing_cr || 0);
        if (dr > cr) {
          addFinding({
            rule_id: "P06",
            severity: "MEDIUM",
            flag_message: `Debit balance in creditor ledger "${ledger.account_name || ledger.ledger_name}" — advance not adjusted?`,
            narration: ledger.account_name || ledger.ledger_name || "",
          });
        }
      }
    }

    // P07 — Credit balance in debtor
    for (const ledger of normalised) {
      if (like(ledger.account_group, "debtor")) {
        const dr = Number(ledger.debit || ledger.closing_dr || 0);
        const cr = Number(ledger.credit || ledger.closing_cr || 0);
        if (cr > dr) {
          addFinding({
            rule_id: "P07",
            severity: "MEDIUM",
            flag_message: `Credit balance in debtor "${ledger.account_name || ledger.ledger_name}" — advance received not adjusted?`,
            narration: ledger.account_name || ledger.ledger_name || "",
          });
        }
      }
    }

    // P08 — Monthly expense spike (if raw_data has monthly breakdowns)
    if (rawData.length > 0 && rawData[0]?.month) {
      const ledgerMonths: Record<string, { months: Record<string, number>; total: number; count: number }> = {};
      for (const entry of rawData) {
        const name = entry.ledger_name || entry.account_name || "";
        const month = entry.month;
        const amt = Math.abs(Number(entry.amount || 0));
        if (!name || !month) continue;
        if (!ledgerMonths[name]) ledgerMonths[name] = { months: {}, total: 0, count: 0 };
        ledgerMonths[name].months[month] = (ledgerMonths[name].months[month] || 0) + amt;
        ledgerMonths[name].total += amt;
        ledgerMonths[name].count++;
      }
      for (const [name, data] of Object.entries(ledgerMonths)) {
        const monthCount = Object.keys(data.months).length;
        if (monthCount < 3) continue;
        const avg = data.total / monthCount;
        for (const [month, amt] of Object.entries(data.months)) {
          if (amt > avg * 2.5 && avg > 0) {
            addFinding({
              rule_id: "P08",
              severity: "MEDIUM",
              flag_message: `Expense spike in ${month} — Rs ${amt.toFixed(0)} vs average Rs ${avg.toFixed(0)} for "${name}"`,
              narration: name,
            });
          }
        }
      }
    }

    // O01 — Opening balance mismatch (compare with previous year)
    const prevYear = getPreviousYear(financial_year);
    if (prevYear) {
      const { data: prevSnapshot } = await supabase
        .from("trial_balance_snapshots")
        .select("normalised_data")
        .eq("client_id", client_id)
        .eq("financial_year", prevYear)
        .single();

      if (prevSnapshot && Array.isArray(prevSnapshot.normalised_data)) {
        const prevLedgers: Record<string, number> = {};
        for (const l of prevSnapshot.normalised_data as any[]) {
          const name = (l.account_name || l.ledger_name || "").toLowerCase();
          const balance = Number(l.debit || l.closing_dr || 0) - Number(l.credit || l.closing_cr || 0);
          if (name) prevLedgers[name] = balance;
        }
        for (const ledger of normalised) {
          const name = (ledger.account_name || ledger.ledger_name || "").toLowerCase();
          const opening = Number(ledger.opening_dr || 0) - Number(ledger.opening_cr || 0);
          if (name in prevLedgers) {
            const diff = Math.abs(prevLedgers[name] - opening);
            if (diff > 1) {
              addFinding({
                rule_id: "O01",
                severity: "HIGH",
                flag_message: `Opening balance mismatch: expected Rs ${prevLedgers[name].toFixed(0)}, found Rs ${opening.toFixed(0)} (difference Rs ${diff.toFixed(0)})`,
                narration: ledger.account_name || ledger.ledger_name || "",
              });
            }
          }
        }
      }
    }

    // C01 — Cash payment > Rs 10,000 (Sec 40A(3))
    for (const entry of rawData) {
      const ledger = (entry.ledger_name || entry.account_name || "").toLowerCase();
      if ((ledger.includes("cash") || ledger.includes("petty cash")) && entry.amount) {
        const amt = Math.abs(Number(entry.amount));
        if (amt > 10000) {
          addFinding({
            rule_id: "C01",
            severity: "HIGH",
            clause_3cd: "Clause 21(c)",
            flag_message: `Cash payment of Rs ${amt.toFixed(0)} on ${entry.date || "unknown date"} — Sec 40A(3) disallowance risk`,
            narration: entry.narration || ledger,
          });
        }
      }
    }

    // C08 — No interest on unsecured loan
    const unsecuredLedgers = normalised.filter(
      (l: any) => like(l.account_group, "unsecured loan") && (Number(l.credit || l.closing_cr || 0) - Number(l.debit || l.closing_dr || 0)) > 0
    );
    if (unsecuredLedgers.length > 0) {
      const interestLedgers = normalised
        .filter((l: any) => like(l.account_name || l.ledger_name, "interest") && like(l.account_group, "expense"))
        .map((l: any) => (l.account_name || l.ledger_name || "").toLowerCase());

      for (const loan of unsecuredLedgers) {
        const loanName = (loan.account_name || loan.ledger_name || "").toLowerCase();
        const hasInterest = interestLedgers.some((i: string) => {
          const words = loanName.split(/\s+/).filter((w: string) => w.length > 3);
          return words.some((w: string) => i.includes(w));
        });
        if (!hasInterest) {
          addFinding({
            rule_id: "C08",
            severity: "HIGH",
            flag_message: `No interest booked on unsecured loan from "${loan.account_name || loan.ledger_name}" — AS-9 and IT Act accrual required`,
            narration: loan.account_name || loan.ledger_name || "",
          });
        }
      }
    }

    // T05 — 206AA: Missing PAN, TDS not at 20%
    const { data: tdsEntries } = await supabase
      .from("tds_entries")
      .select("*")
      .eq("client_id", client_id);

    if (tdsEntries) {
      for (const tds of tdsEntries) {
        if ((!tds.pan || tds.pan.trim() === "") && tds.tds_rate !== 20) {
          addFinding({
            rule_id: "T05",
            severity: "HIGH",
            clause_3cd: "Clause 31",
            flag_message: `TDS deducted at ${tds.tds_rate}% but PAN is missing — 206AA requires 20%`,
            narration: tds.party_name || "",
          });
        }
      }
    }

    // ── STEP 3b: Narration AI Layer ──
    const voucherEntries = rawData.filter((e: any) => e.narration && typeof e.narration === "string" && e.narration.trim().length > 0);

    if (voucherEntries.length > 0) {
      // Fetch narration rules
      const { data: narrationRules } = await supabase
        .from("narration_rules")
        .select("*")
        .eq("is_active", true)
        .order("firm_id", { ascending: false, nullsFirst: false });

      const rules = narrationRules || [];
      const aiBatch: any[] = [];

      // Layer 1 — Keyword matching
      for (const entry of voucherEntries) {
        const narLower = entry.narration.toLowerCase();
        let matched = false;

        for (const rule of rules) {
          const keywords: string[] = Array.isArray(rule.keywords) ? rule.keywords : [];
          const hit = keywords.some((kw: string) => narLower.includes(kw.toLowerCase()));
          if (!hit) continue;

          if (rule.action === "flag") {
            addFinding({
              rule_id: rule.id?.substring(0, 8) || "NAR",
              severity: rule.severity || "MEDIUM",
              clause_3cd: null,
              flag_message: rule.message || `Narration rule triggered: ${rule.category}`,
              narration: entry.narration,
            });
          } else if (rule.action === "send_ai") {
            aiBatch.push(entry);
          }
          matched = true;
          break;
        }

        // T01 — TDS check for large payments
        if (!matched && tdsEntries) {
          const amt = Math.abs(Number(entry.amount || 0));
          if (amt > 30000) {
            const entryDate = entry.date ? new Date(entry.date) : null;
            const hasTds = tdsEntries.some((tds: any) => {
              const tdsAmt = Math.abs(Number(tds.amount || 0));
              const tolerance = tdsAmt * 0.1;
              if (Math.abs(amt - tdsAmt) > tolerance) return false;
              if (!entryDate || !tds.date) return false;
              const tdsDate = new Date(tds.date);
              const dayDiff = Math.abs(entryDate.getTime() - tdsDate.getTime()) / 86400000;
              return dayDiff <= 3;
            });
            if (!hasTds) {
              addFinding({
                rule_id: "T01",
                severity: "HIGH",
                clause_3cd: "Clause 21(a)",
                flag_message: `Payment of Rs ${amt.toFixed(0)} to "${entry.ledger_name || "unknown"}" on ${entry.date || "unknown"} may require TDS — no deduction found`,
                narration: entry.narration,
              });
            }
          }
        }
      }

      // Layer 2 — AI classification (batch of 50)
      if (aiBatch.length > 0) {
        const BATCH_SIZE = 50;
        for (let i = 0; i < aiBatch.length; i += BATCH_SIZE) {
          const batch = aiBatch.slice(i, i + BATCH_SIZE);
          const payload = batch.map((e: any, idx: number) => ({
            entry_id: `${i + idx}`,
            date: e.date || "",
            narration: e.narration,
            amount: e.amount || 0,
            ledger_name: e.ledger_name || e.account_name || "",
            debit_credit: e.debit_credit || "",
          }));

          try {
            const gatewayUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/claude-gateway`;
            const res = await fetch(gatewayUrl, {
              method: "POST",
              headers: {
                Authorization: authHeader,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                request_type: "narration_batch_classifier",
                user_message: JSON.stringify(payload),
              }),
            });

            if (res.ok) {
              const aiResult = await res.json();
              const items = Array.isArray(aiResult) ? aiResult : aiResult?.raw ? [] : [aiResult];

              for (const item of items) {
                if (item.category && item.category !== "normal") {
                  const sev = (item.risk_level || "MEDIUM").toUpperCase();
                  addFinding({
                    rule_id: "NAR_AI",
                    severity: sev,
                    clause_3cd: item.suggested_3cd_clause || null,
                    flag_message: item.flag_reason || `AI flagged: ${item.category}`,
                    narration: batch[Number(item.entry_id) - i]?.narration || "",
                  });
                  counts.AI++;
                }
              }
            } else {
              console.error("AI batch classification failed:", await res.text());
            }
          } catch (aiErr) {
            console.error("AI narration batch error:", aiErr);
          }
        }
      }
    }

    // ── STEP 4: Insert all findings ──
    if (findings.length > 0) {
      const CHUNK = 100;
      for (let i = 0; i < findings.length; i += CHUNK) {
        const { error: insertErr } = await supabase
          .from("scrutiny_findings")
          .insert(findings.slice(i, i + CHUNK));
        if (insertErr) console.error("Insert findings error:", insertErr);
      }
    }

    const total = counts.HIGH + counts.MEDIUM + counts.LOW;

    // ── Notification ──
    try {
      const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`;
      await fetch(notifyUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "scrutiny_complete",
          firm_id: firm_id,
          data: { client_id, financial_year, findings_created: counts, total },
        }),
      });
    } catch (notifyErr) {
      console.error("Notification error:", notifyErr);
    }

    return new Response(
      JSON.stringify({ findings_created: counts, total }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("run-scrutiny error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function getPreviousYear(fy: string): string | null {
  const match = fy.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const startYear = parseInt(match[1]) - 1;
  const endYear = parseInt(match[2]) - 1;
  return `${startYear}-${endYear.toString().padStart(2, "0")}`;
}
