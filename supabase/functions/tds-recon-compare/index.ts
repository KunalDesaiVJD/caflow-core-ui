/**
 * tds-recon-compare
 *
 * Compares Office Data (manually-entered tds_deductees for a filing) against the
 * latest Imported Client Data batch (tds_imported_rows), record-by-record and
 * field-by-field, using an LLM (OpenRouter). Writes one tds_recon_results row per
 * reconciled record with per-field diffs and an overall match_status.
 *
 * Records are handed to the model as short handles (o0.., i0..) so it never has
 * to echo UUIDs. Existing override decisions are preserved across re-runs.
 *
 * Input (POST, Bearer auth): { filing_id, batch_id? }   (defaults to latest batch)
 * Output: { batch_id, summary: { total, matched, mismatched, office_only, imported_only, overridden, pending } }
 *
 * Requires OPENROUTER_API_KEY (npx supabase secrets set OPENROUTER_API_KEY=<key>).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Reflect the browser's requested headers on the preflight. Newer supabase-js
// (v2.98+) attaches x-supabase-client-* headers to every functions.invoke call;
// a STATIC allow-list that omits them fails the CORS preflight and the browser
// reports "Failed to send a request to the Edge Function" before our code runs.
const corsFor = (req: Request) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    req.headers.get("access-control-request-headers") ??
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const COMPARE_INSTRUCTION = `You reconcile two datasets for one Indian TDS return: OFFICE (entered by our staff)
and IMPORTED (from the client's file). Pair each office record with the imported record for the SAME
deductee/transaction, then compare fields. Return STRICT JSON only (no prose, no fences):
{"results":[{"office":"o0"|null,"imported":"i0"|null,"record_label":"<party name>","status":"matched"|"mismatched"|"office_only"|"imported_only","fields":[{"field":"pan","office":"...","imported":"...","matched":true|false,"difference":"<short note or empty>"}]}]}

Pairing:
- Pair primarily by PAN; if PAN missing/differs, pair by deductee name similarity + amount.
- An office record with no imported counterpart => status "office_only" (office:o#, imported:null).
- An imported record with no office counterpart => status "imported_only" (office:null, imported:i#).

Compare EXACTLY these seven fields for every pair, and NO others: name, pan, date (payment), amount (amount paid), tds (tds amount), interest, section.
Field match rules:
- name: same legal entity ignoring case/punctuation/extra spaces and equivalents (PVT=PRIVATE, LTD=LIMITED, &=AND).
- pan: case-insensitive exact.
- date: same calendar date regardless of format (dd/mm/yyyy vs dd-Mon-yy etc.).
- amount / tds / interest: equal if within ₹1 (treat a missing/blank/null value as 0).
- section: equal after trimming words (e.g. "194Q - Purchase" == "194Q").
Do NOT compare rate, challan, or any field other than the seven listed.
status = "matched" only if every one of the seven compared fields matches; otherwise "mismatched".
For "mismatched", "office_only" and "imported_only": include one fields[] entry per compared field with the actual office/imported values (as strings) and matched true/false. For "matched": return an empty fields array [] (values are equal by definition — this keeps the response compact). Never invent records.`;

function extractJson(text: string): any {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const first = s.indexOf("{"), last = s.lastIndexOf("}");
  if (first >= 0 && last > first) { try { return JSON.parse(s.slice(first, last + 1)); } catch { /* ignore */ } }
  return null;
}

type AIResult = { ok: boolean; status: number; errText: string; content: string; truncated: boolean };

// Graceful multi-provider LLM call (text). Tries each CONFIGURED provider in
// order and FALLS THROUGH on failure — so Anthropic "credit balance too low"
// (400) transparently drops to the Lovable AI gateway. Order: OpenRouter →
// Lovable (the app's provisioned Gemini gateway) → Anthropic. extractJson
// downstream tolerates ```json fences, so we skip response_format for portability.
async function callAI(opts: { system: string; userText: string; maxTokens: number }): Promise<AIResult> {
  const openAICompat = async (url: string, key: string, model: string, extra: Record<string, string>): Promise<AIResult> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra },
      body: JSON.stringify({ model, temperature: 0, max_tokens: opts.maxTokens, messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.userText }] }),
    });
    if (!res.ok) return { ok: false, status: res.status, errText: await res.text(), content: "", truncated: false };
    const j = await res.json();
    return { ok: true, status: 200, errText: "", content: j?.choices?.[0]?.message?.content ?? "", truncated: j?.choices?.[0]?.finish_reason === "length" };
  };

  const anthropic = async (key: string): Promise<AIResult> => {
    const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: opts.maxTokens, system: opts.system, messages: [{ role: "user", content: [{ type: "text", text: opts.userText }] }] }),
    });
    if (!res.ok) return { ok: false, status: res.status, errText: await res.text(), content: "", truncated: false };
    const j = await res.json();
    const text = Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("") : "";
    return { ok: true, status: 200, errText: "", content: text, truncated: j?.stop_reason === "max_tokens" };
  };

  const OPENROUTER = Deno.env.get("OPENROUTER_API_KEY");
  const LOVABLE = Deno.env.get("LOVABLE_API_KEY");
  const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY");
  let last: AIResult = { ok: false, status: 503, errText: "No AI provider configured. Set OPENROUTER_API_KEY, LOVABLE_API_KEY or ANTHROPIC_API_KEY.", content: "", truncated: false };

  if (OPENROUTER) {
    const r = await openAICompat("https://openrouter.ai/api/v1/chat/completions", OPENROUTER, Deno.env.get("OPENROUTER_MODEL") || "google/gemini-2.5-flash", { "HTTP-Referer": "https://caflow.app", "X-Title": "CAFlow TDS Recon" });
    if (r.ok) return r; last = r; console.error("callAI: OpenRouter failed", r.status, r.errText.slice(0, 160));
  }
  if (LOVABLE) {
    const r = await openAICompat("https://ai.gateway.lovable.dev/v1/chat/completions", LOVABLE, Deno.env.get("LOVABLE_MODEL") || "google/gemini-2.5-flash", {});
    if (r.ok) return r; last = r; console.error("callAI: Lovable failed", r.status, r.errText.slice(0, 160));
  }
  if (ANTHROPIC) {
    const r = await anthropic(ANTHROPIC);
    if (r.ok) return r; last = r; console.error("callAI: Anthropic failed", r.status, r.errText.slice(0, 160));
  }
  return last;
}

serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    if (!Deno.env.get("OPENROUTER_API_KEY") && !Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("ANTHROPIC_API_KEY")) {
      return json({ error: "No AI provider configured. Set OPENROUTER_API_KEY, LOVABLE_API_KEY or ANTHROPIC_API_KEY in Supabase secrets." }, 503);
    }

    const { filing_id, batch_id: batchIdIn } = (await req.json()) ?? {};
    if (!filing_id) return json({ error: "filing_id is required" }, 400);

    const { data: filing, error: fErr } = await supabase
      .from("tds_filings").select("id, firm_id").eq("id", filing_id).single();
    if (fErr || !filing) return json({ error: "Filing not found" }, 404);

    // Latest batch unless a specific one is requested.
    let batchId = batchIdIn;
    if (!batchId) {
      const { data: b } = await supabase
        .from("tds_import_batches").select("id")
        .eq("filing_id", filing_id).order("imported_at", { ascending: false }).limit(1).maybeSingle();
      batchId = b?.id;
    }
    if (!batchId) return json({ error: "No imported client data found. Import a client file first." }, 409);

    // ── Office Data: deductees for this filing (via its challans) ───────────────
    const { data: challans } = await supabase
      .from("tds_challans").select("id, bsr_code, challan_serial_no").eq("filing_id", filing_id);
    const challanById = new Map((challans ?? []).map((c: any) => [c.id, c]));
    const challanIds = (challans ?? []).map((c: any) => c.id);

    let office: any[] = [];
    if (challanIds.length) {
      const { data: ded } = await supabase
        .from("tds_deductees")
        .select("id, deductee_name, deductee_pan, section_code, amount_paid_credited, total_tax_deducted, tds_amount, interest_amount, date_of_payment, challan_id")
        .in("challan_id", challanIds);
      office = ded ?? [];
    }

    // ── Imported Data: rows for the chosen batch ───────────────────────────────
    const { data: imported } = await supabase
      .from("tds_imported_rows").select("*").eq("batch_id", batchId).order("row_index", { ascending: true });

    if ((office?.length ?? 0) === 0 && (imported?.length ?? 0) === 0) {
      return json({ error: "Nothing to compare — both office and imported data are empty." }, 409);
    }

    // Short handles → real ids
    const oHandle = new Map<string, string>();  // o# -> deductee id
    const iHandle = new Map<string, string>();  // i# -> imported row id
    const officePayload = office.map((d: any, idx: number) => {
      const h = `o${idx}`; oHandle.set(h, d.id);
      return {
        ref: h,
        name: d.deductee_name ?? null,
        pan: d.deductee_pan ?? null,
        section: d.section_code ?? null,
        amount: d.amount_paid_credited ?? null,
        tds: d.total_tax_deducted ?? d.tds_amount ?? null,
        interest: d.interest_amount ?? null,
        date_payment: d.date_of_payment ?? null,
      };
    });
    const importedPayload = (imported ?? []).map((r: any, idx: number) => {
      const h = `i${idx}`; iHandle.set(h, r.id);
      return {
        ref: h,
        name: r.deductee_name ?? null,
        pan: r.pan ?? null,
        section: r.section_code ?? null,
        amount: r.amount_paid ?? null,
        tds: r.tds_amount ?? null,
        interest: r.interest ?? null,
        date_payment: r.date_of_payment ?? null,
      };
    });

    // ── LLM compare ────────────────────────────────────────────────────────────
    const ai = await callAI({
      system: COMPARE_INSTRUCTION,
      userText: `OFFICE (${officePayload.length}):\n${JSON.stringify(officePayload)}\n\nIMPORTED (${importedPayload.length}):\n${JSON.stringify(importedPayload)}`,
      maxTokens: 8000,
    });

    if (!ai.ok) {
      console.error("AI compare error:", ai.status, ai.errText);
      let detail = "";
      try { const j = JSON.parse(ai.errText); detail = j?.error?.message || j?.error || j?.message || ""; } catch { detail = ai.errText; }
      detail = String(detail || "").slice(0, 240);
      const msg = ai.status === 401 ? "AI provider authentication failed — check the configured API key."
        : ai.status === 402 ? "AI provider payment required — add credits."
        : ai.status === 429 ? "AI provider rate limit — try again shortly."
        : ai.status === 503 ? ai.errText
        : `AI compare failed (${ai.status})${detail ? `: ${detail}` : ""}`;
      return json({ error: msg }, ai.status >= 500 ? 502 : ai.status);
    }

    const finishReason = ai.truncated ? "length" : null;
    const parsed = extractJson(typeof ai.content === "string" ? ai.content : JSON.stringify(ai.content));
    const llmResults: any[] = Array.isArray(parsed?.results) ? parsed.results : [];
    if (llmResults.length === 0) {
      // A truncated response (hit the output cap) can't be parsed — surface the
      // real cause instead of a misleading "no results".
      if (finishReason === "length") {
        return json({ error: "Too many records to compare in a single pass. Reduce the records for this filing or contact support." }, 413);
      }
      return json({ error: "The comparison returned no results. Try again." }, 502);
    }

    // Preserve prior overrides (keyed by office+imported pairing) across re-runs.
    const { data: prior } = await supabase
      .from("tds_recon_results")
      .select("id, office_deductee_id, imported_row_id, overridden, overridden_by, overridden_at, override_note")
      .eq("filing_id", filing_id);
    const priorMap = new Map<string, any>();
    for (const p of prior ?? []) priorMap.set(`${p.office_deductee_id ?? ""}|${p.imported_row_id ?? ""}`, p);
    const priorIds = (prior ?? []).map((p: any) => p.id);

    const validStatus = new Set(["matched", "mismatched", "office_only", "imported_only"]);
    const newRows = llmResults.map((r: any) => {
      const officeId = r?.office ? oHandle.get(String(r.office)) ?? null : null;
      const importedId = r?.imported ? iHandle.get(String(r.imported)) ?? null : null;
      const status = validStatus.has(r?.status) ? r.status : "mismatched";
      const fields = Array.isArray(r?.fields) ? r.fields : [];
      const mismatchFields = fields.filter((f: any) => f?.matched === false).map((f: any) => String(f.field));
      const carry = priorMap.get(`${officeId ?? ""}|${importedId ?? ""}`);
      const keepOverride = !!carry?.overridden;
      return {
        filing_id, batch_id: batchId, firm_id: filing.firm_id,
        office_deductee_id: officeId, imported_row_id: importedId,
        record_label: r?.record_label ? String(r.record_label).slice(0, 200) : null,
        match_status: status,
        mismatch_fields: mismatchFields,
        field_diffs: fields,
        overridden: keepOverride,
        overridden_by: keepOverride ? carry.overridden_by : null,
        overridden_at: keepOverride ? carry.overridden_at : null,
        override_note: keepOverride ? carry.override_note : null,
      };
    });

    // Replace results with a safe ordering: INSERT the new rows first, then delete
    // the superseded ones by id. If the insert fails, the prior rows (and their
    // manual override decisions) stay intact — no data-loss window. A failed
    // cleanup delete only leaves recoverable duplicates, healed on the next run.
    const { error: insErr } = await supabase.from("tds_recon_results").insert(newRows);
    if (insErr) return json({ error: `Result insert failed: ${insErr.message}` }, 500);
    if (priorIds.length) {
      const { error: delErr } = await supabase.from("tds_recon_results").delete().in("id", priorIds);
      if (delErr) console.error("tds-recon-compare: stale result cleanup failed (recoverable):", delErr.message);
    }

    const summary = {
      total: newRows.length,
      matched: newRows.filter(r => r.match_status === "matched").length,
      mismatched: newRows.filter(r => r.match_status !== "matched").length,
      office_only: newRows.filter(r => r.match_status === "office_only").length,
      imported_only: newRows.filter(r => r.match_status === "imported_only").length,
      overridden: newRows.filter(r => r.overridden).length,
      pending: newRows.filter(r => r.match_status !== "matched" && !r.overridden).length,
    };
    return json({ batch_id: batchId, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("tds-recon-compare fatal:", message);
    return json({ error: message }, 500);
  }
});
