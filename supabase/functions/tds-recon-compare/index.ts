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

Compare these fields for every pair: pan, name, date (payment), amount (amount paid), section, rate, challan, tds (tds amount).
Field match rules:
- pan: case-insensitive exact.
- name: same legal entity ignoring case/punctuation/extra spaces and equivalents (PVT=PRIVATE, LTD=LIMITED, &=AND).
- date: same calendar date regardless of format (dd/mm/yyyy vs dd-Mon-yy etc.).
- amount / tds: equal if within ₹1.
- rate: equal if within 0.01.
- section: equal after trimming words (e.g. "194Q - Purchase" == "194Q").
- challan: BSR and challan number both equal (ignore blanks on both sides).
status = "matched" only if every compared field matches; otherwise "mismatched".
Always include one fields[] entry per compared field with the actual office/imported values (as strings). Never invent records.`;

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

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return json({ error: "OPENROUTER_API_KEY is not configured. Run: npx supabase secrets set OPENROUTER_API_KEY=<key>" }, 503);
    }
    const model = Deno.env.get("OPENROUTER_MODEL") || "google/gemini-2.5-flash";

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
        .select("id, deductee_name, deductee_pan, section_code, amount_paid_credited, total_tax_deducted, tds_amount, rate_of_tds, date_of_payment, date_of_deduction, challan_id")
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
      const ch = challanById.get(d.challan_id);
      return {
        ref: h,
        name: d.deductee_name ?? null,
        pan: d.deductee_pan ?? null,
        section: d.section_code ?? null,
        amount: d.amount_paid_credited ?? null,
        tds: d.total_tax_deducted ?? d.tds_amount ?? null,
        rate: d.rate_of_tds ?? null,
        date_payment: d.date_of_payment ?? null,
        date_deduction: d.date_of_deduction ?? null,
        challan_bsr: ch?.bsr_code ?? null,
        challan_no: ch?.challan_serial_no ?? null,
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
        rate: r.rate ?? null,
        date_payment: r.date_of_payment ?? null,
        date_deduction: r.date_of_deduction ?? null,
        challan_bsr: r.challan_bsr ?? null,
        challan_no: r.challan_no ?? null,
      };
    });

    // ── LLM compare ────────────────────────────────────────────────────────────
    const aiRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://caflow.app",
        "X-Title": "CAFlow TDS Recon Compare",
      },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 16000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: COMPARE_INSTRUCTION },
          { role: "user", content: `OFFICE (${officePayload.length}):\n${JSON.stringify(officePayload)}\n\nIMPORTED (${importedPayload.length}):\n${JSON.stringify(importedPayload)}` },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("OpenRouter compare error:", aiRes.status, errText);
      const msg = aiRes.status === 401 ? "OpenRouter authentication failed — check OPENROUTER_API_KEY."
        : aiRes.status === 402 ? "OpenRouter payment required — add credits."
        : aiRes.status === 429 ? "OpenRouter rate limit — try again shortly."
        : `AI compare failed (${aiRes.status})`;
      return json({ error: msg }, aiRes.status >= 500 ? 502 : aiRes.status);
    }

    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(typeof content === "string" ? content : JSON.stringify(content));
    const llmResults: any[] = Array.isArray(parsed?.results) ? parsed.results : [];
    if (llmResults.length === 0) return json({ error: "The comparison returned no results. Try again." }, 502);

    // Preserve prior overrides (keyed by office+imported pairing) across re-runs.
    const { data: prior } = await supabase
      .from("tds_recon_results")
      .select("office_deductee_id, imported_row_id, overridden, overridden_by, overridden_at, override_note")
      .eq("filing_id", filing_id);
    const priorMap = new Map<string, any>();
    for (const p of prior ?? []) priorMap.set(`${p.office_deductee_id ?? ""}|${p.imported_row_id ?? ""}`, p);

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

    // Replace results for this filing (idempotent re-run).
    await supabase.from("tds_recon_results").delete().eq("filing_id", filing_id);
    const { error: insErr } = await supabase.from("tds_recon_results").insert(newRows);
    if (insErr) return json({ error: `Result insert failed: ${insErr.message}` }, 500);

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
