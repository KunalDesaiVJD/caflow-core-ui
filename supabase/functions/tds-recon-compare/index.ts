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
{"results":[{"office":"o0"|null,"imported":"i0"|null,"record_label":"<party name>","status":"matched"|"mismatched"|"office_only"|"imported_only","fields":[{"field":"pan","matched":true|false,"difference":"<required, short concrete reason, when matched:false>"}]}]}

Note "fields" does NOT include "office"/"imported" values — we already have
those ourselves; only send your matched judgement (+ reason when false) per
field, which keeps your response small.
For a PAIRED result (status "matched" or "mismatched", both office and
imported set): "fields" MUST always contain exactly these 7 entries, in this
order: name, pan, date, amount, tds, interest, section — even when every one
of them matched. Never return an empty or partial fields array for a paired
result; "matched" status is exactly "every one of these 7 entries has
matched:true".
For an UNPAIRED result ("office_only" or "imported_only", one side is null):
return "fields":[] — there is nothing to compare against.

EXHAUSTIVENESS — this is a hard requirement, not a suggestion: every single "ref"
(o0, o1, o2, ... and i0, i1, i2, ...) given to you in OFFICE and IMPORTED below
MUST appear in exactly one result object, as either "office" or "imported" (or
both, if paired together). Never skip, drop, silently merge, or deduplicate
records — even when multiple records share the same deductee name/PAN (a party
with 5 separate transactions in the quarter must produce 5 separate result
objects, one per transaction, never one combined/summed object). If you are
unsure which imported record a specific office record corresponds to among
several similar candidates, still output BOTH as their own entries — pair the
most plausible match and leave any leftover candidates as their own
office_only/imported_only entries — rather than omitting any of them. The
number of result objects must be enough that every input ref is accounted for.

Pairing — PAN + Date + Amount is the PRIMARY KEY. Two records are the SAME
transaction if these three agree (after normalising date/amount as described
below), REGARDLESS of any difference in Name spelling or Section wording —
never leave a record unpaired (office_only/imported_only) just because its
Name or Section text looks different from its counterpart, when PAN+Date+
Amount already identify it as the same transaction:
- Step 1: group candidates by matching PAN (case-insensitive exact).
- Step 2: within a PAN group, pair by closest normalised date, then closest
  amount — this resolves multi-transaction parties (see below).
- Step 3 (PAN missing on one/both sides): fall back to deductee name
  similarity + date + amount together.
- Once paired, compare the REMAINING fields (name, tds, interest, section)
  and flag whichever of those individually differ — a field-level mismatch
  never un-pairs a record that PAN+Date+Amount already identified as a match.
- When a party has MULTIPLE transactions on both sides, pair them 1:1 within
  that PAN group by closest date + amount — do not let one imported record
  "absorb" or represent several office records for the same party, and vice versa.
- An office record with no imported counterpart (no PAN+date+amount match found
  even approximately) => status "office_only" (office:o#, imported:null).
- An imported record with no office counterpart => status "imported_only" (office:null, imported:i#).

Compare EXACTLY these seven fields for every pair, and NO others: name, pan, date (payment), amount (amount paid), tds (tds amount), interest, section.
Field match rules:
- name: same legal entity ignoring case/punctuation/extra/multiple spaces and
  equivalents (PVT / PVT. LTD / P LTD = PRIVATE LIMITED, LTD = LIMITED, & =
  AND) — e.g. "ADINATH PROCESSING INDUSTRIES PRIVATE LIMITED" and "Adinath
  Processing Industries Pvt. Ltd." are the SAME name.
- pan: case-insensitive exact.
- date: same calendar date regardless of format or field order — normalise
  before comparing. "2026-05-31", "31/05/2026", "31-05-2026", "05/31/2026"
  and "31 May 2026" are ALL the same date.
- amount / tds / interest: equal if within ₹1 after normalising commas and
  decimals — "5,558,172", "5558172" and "5558172.00" are the SAME amount
  (treat a missing/blank/null value as 0).
- section: equal after trimming words (e.g. "194Q - Purchase" == "194Q"). ALSO
  treat a section code and a plain-language nature-of-payment description as
  matching when they denote the SAME standard category — client files often
  give a descriptive label instead of (or alongside) a code, e.g.:
  Purchase of goods = 194Q · Contract/Sub-contract work = 194C ·
  Professional/Technical fees = 194J · Rent = 194I · Commission/Brokerage =
  194H · Salary = 192 · Interest (other than securities) = 194A ·
  Insurance commission = 194D · Dividend = 194. So "TDS - Purchase" (one
  side) vs "194Q" (other side) is a MATCH, not a mismatch. Only mark section
  mismatched when the two sides genuinely disagree on the nature of payment,
  not merely on code-vs-description phrasing. If one side is an unfamiliar
  raw legal-clause citation you cannot confidently map to a standard section
  (e.g. a bare sub-clause reference with no descriptive text), compare it
  literally rather than guessing.
Do NOT compare rate, challan, or any field other than the seven listed.
status = "matched" only if every one of the seven compared fields matches; otherwise "mismatched".
For every field where matched=false, ALWAYS fill "difference" with a short concrete reason (e.g. "different nature of payment: Purchase vs Contract", "4 days apart", "PAN differs") — this is shown directly to the user as the reason a field failed, so it must never be vague ("differs") or blank. Never invent records.`;

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

// ── Field-level diffs built from CODE, not the LLM's echo ───────────────────
// The LLM only judges matched:true/false (+ a short reason) per field now;
// the actual displayed office/imported VALUES always come from the payloads
// built from the DB below — no risk of the model mistyping a value while
// echoing it back, and (combined with the instruction always requiring all 7
// entries) this is what makes a genuinely matched row show real values with
// green checks instead of an empty fields[] array. PAN/amount/tds/interest
// additionally get a mechanical, unambiguous recomputation in code that
// overrides the LLM if it disagrees — there's no judgement call needed for
// "do these two numbers/strings match", so there's no reason to trust an
// LLM's opinion over a direct comparison for those four fields.
const FIELD_ORDER = ["name", "pan", "date", "amount", "tds", "interest", "section"] as const;
type FieldKey = (typeof FIELD_ORDER)[number];
type Payload = { name: unknown; pan: unknown; section: unknown; amount: unknown; tds: unknown; interest: unknown; date_payment: unknown };

const fieldValue = (p: Payload | undefined, field: FieldKey): unknown =>
  !p ? null : field === "date" ? p.date_payment : (p as any)[field];

const normPan = (v: unknown): string | null => { const s = v == null ? "" : String(v).trim().toUpperCase(); return s || null; };
const normAmount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return isFinite(n) ? n : null;
};

// Permissive date-format matcher: office dates are ALWAYS ISO (an HTML
// <input type=date> in Data Entry), imported dates are free text in
// whatever format the client's file used. Tries both dd/mm and mm/dd
// interpretations of ambiguous numeric formats — used ONLY to CONFIRM a
// match (flips false→true), never to force a mismatch, so an unparseable or
// genuinely ambiguous format safely defers to the LLM's own judgement
// instead of risking a wrong hand-rolled parse overriding a correct one.
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const normYear = (y: string): number => { const n = parseInt(y, 10); return n < 100 ? (n < 70 ? 2000 + n : 1900 + n) : n; };
const isoOf = (y: number, mo: number, d: number): string | null => (!y || mo < 1 || mo > 12 || d < 1 || d > 31) ? null : `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function dateCandidates(raw: string): string[] {
  const s = raw.trim();
  const out: (string | null)[] = [];
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) out.push(isoOf(+m[1], +m[2], +m[3]));
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) { const y = normYear(m[3]); out.push(isoOf(y, +m[2], +m[1]), isoOf(y, +m[1], +m[2])); } // dd/mm and mm/dd
  m = s.match(/^(\d{1,2})[\s\-]([a-zA-Z]{3,9})[\s\-,]+(\d{2,4})$/);
  if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) out.push(isoOf(normYear(m[3]), mo, +m[1])); }
  m = s.match(/^([a-zA-Z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; if (mo) out.push(isoOf(normYear(m[3]), mo, +m[2])); }
  return out.filter((v): v is string => !!v);
}
function datesLikelyMatch(office: unknown, imported: unknown): boolean {
  if (office == null || imported == null) return false;
  const officeIso = String(office).trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!officeIso) return false;
  return dateCandidates(String(imported)).includes(officeIso);
}

/** Builds the full 7-field diff array for a PAIRED result (both office and
 * imported present). Always returns all 7 entries regardless of what the LLM
 * sent, so a fully-matched row still shows real values with checks. */
function buildPairedFieldDiffs(llmFields: any[], officeP: Payload | undefined, importedP: Payload | undefined) {
  const byField = new Map<string, any>();
  for (const f of llmFields) if (f?.field) byField.set(String(f.field), f);

  return FIELD_ORDER.map(field => {
    const officeVal = fieldValue(officeP, field);
    const importedVal = fieldValue(importedP, field);

    if (field === "pan") {
      const a = normPan(officeVal), b = normPan(importedVal);
      const matched = a !== null && b !== null && a === b;
      return { field, office: officeVal, imported: importedVal, matched, difference: matched ? "" : `Office ${a ?? "—"} vs Imported ${b ?? "—"} — PAN differs` };
    }
    if (field === "amount" || field === "tds" || field === "interest") {
      const a = normAmount(officeVal) ?? 0, b = normAmount(importedVal) ?? 0;
      const matched = Math.abs(a - b) <= 1;
      return { field, office: officeVal, imported: importedVal, matched, difference: matched ? "" : `Office ${a} vs Imported ${b}` };
    }

    // name / date / section — no unambiguous mechanical check; trust the
    // LLM's semantic judgement, with a permissive date-format confirmation
    // pass and a literal-string fallback if the LLM omitted the field.
    const llm = byField.get(field);
    let matched: boolean;
    let difference: string;
    if (llm) {
      matched = llm.matched !== false;
      difference = matched ? "" : (llm.difference ? String(llm.difference) : "AI flagged this field as different.");
      if (field === "date" && !matched && datesLikelyMatch(officeVal, importedVal)) { matched = true; difference = ""; }
    } else {
      const a = officeVal == null ? "" : String(officeVal).trim().toLowerCase();
      const b = importedVal == null ? "" : String(importedVal).trim().toLowerCase();
      matched = a !== "" && a === b;
      difference = matched ? "" : "Not returned by AI comparison — compared literally as a fallback.";
    }
    return { field, office: officeVal, imported: importedVal, matched, difference };
  });
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
    const oPayloadByHandle = new Map(officePayload.map(p => [p.ref, p]));
    const iPayloadByHandle = new Map(importedPayload.map(p => [p.ref, p]));

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
      const llmStatus = validStatus.has(r?.status) ? r.status : "mismatched";
      const llmFields = Array.isArray(r?.fields) ? r.fields : [];

      // Paired result: always build the FULL 7-field diff from code (values
      // never come from the LLM's echo), and re-derive the overall status
      // from the FINAL (code-corrected) per-field matches — the LLM's own
      // "status" can otherwise drift out of sync with a field we mechanically
      // overrode (e.g. it says "mismatched" but every field actually matches
      // once PAN/amount are checked directly).
      let fields: ReturnType<typeof buildPairedFieldDiffs>;
      let status: string;
      if (officeId && importedId) {
        fields = buildPairedFieldDiffs(llmFields, oPayloadByHandle.get(String(r.office)), iPayloadByHandle.get(String(r.imported)));
        status = fields.every(f => f.matched) ? "matched" : "mismatched";
      } else {
        fields = [];
        status = llmStatus === "office_only" || llmStatus === "imported_only" ? llmStatus : (officeId ? "office_only" : "imported_only");
      }

      const mismatchFields = fields.filter(f => f.matched === false).map(f => f.field);
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

    // ── Exhaustiveness safety net ───────────────────────────────────────────────
    // The prompt REQUIRES every o#/i# handle to appear somewhere in the response,
    // but an LLM can still drop or silently merge one (especially with many
    // near-duplicate same-party transactions). Rather than trust that entirely,
    // verify it in code: any handle the model was given but never referenced in
    // ANY result gets a synthesised office_only/imported_only row of its own, so
    // "all N entries validated individually" is a guarantee, not a hope.
    const coveredHandles = new Set<string>();
    for (const r of llmResults) {
      if (r?.office) coveredHandles.add(String(r.office));
      if (r?.imported) coveredHandles.add(String(r.imported));
    }
    const singleSidedDiffs = (p: { name: unknown; pan: unknown; section: unknown; amount: unknown; tds: unknown; interest: unknown; date_payment: unknown }, side: "office" | "imported") => {
      const values: Record<(typeof FIELD_ORDER)[number], unknown> = {
        name: p.name, pan: p.pan, date: p.date_payment, amount: p.amount, tds: p.tds, interest: p.interest, section: p.section,
      };
      return FIELD_ORDER.map(field => ({
        field,
        office: side === "office" ? values[field] : null,
        imported: side === "imported" ? values[field] : null,
        matched: false,
        difference: "Not returned by AI comparison — auto-flagged so no record is silently dropped.",
      }));
    };
    let recovered = 0;
    for (const [handle, deducteeId] of oHandle) {
      if (coveredHandles.has(handle)) continue;
      const p = oPayloadByHandle.get(handle);
      recovered++;
      newRows.push({
        filing_id, batch_id: batchId, firm_id: filing.firm_id,
        office_deductee_id: deducteeId, imported_row_id: null,
        record_label: p?.name ? String(p.name).slice(0, 200) : null,
        match_status: "office_only",
        mismatch_fields: FIELD_ORDER.slice(),
        field_diffs: p ? singleSidedDiffs(p, "office") : [],
        overridden: false, overridden_by: null, overridden_at: null, override_note: null,
      });
    }
    for (const [handle, rowId] of iHandle) {
      if (coveredHandles.has(handle)) continue;
      const p = iPayloadByHandle.get(handle);
      recovered++;
      newRows.push({
        filing_id, batch_id: batchId, firm_id: filing.firm_id,
        office_deductee_id: null, imported_row_id: rowId,
        record_label: p?.name ? String(p.name).slice(0, 200) : null,
        match_status: "imported_only",
        mismatch_fields: FIELD_ORDER.slice(),
        field_diffs: p ? singleSidedDiffs(p, "imported") : [],
        overridden: false, overridden_by: null, overridden_at: null, override_note: null,
      });
    }
    if (recovered > 0) {
      console.warn(`tds-recon-compare: AI response omitted ${recovered} record(s) — auto-recovered as unpaired rows so every input record still gets validated.`);
    }

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
