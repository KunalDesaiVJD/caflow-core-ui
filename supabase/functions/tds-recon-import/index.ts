/**
 * tds-recon-import
 *
 * Reads a client-supplied TDS file (Excel/CSV rows, or a PDF) and normalises it
 * into canonical deductee rows stored as an import batch (Dataset 2), ready to be
 * compared against the manually-entered Office Data (tds_deductees).
 *
 * The client parses Excel/CSV to raw row objects and posts them here; PDFs are
 * posted as base64 and read by a multimodal model. In both cases an LLM
 * (OpenRouter) maps whatever columns/layout the file uses onto the canonical
 * fields, so any client format works.
 *
 * Input (POST, Bearer auth):
 *   { filing_id, form_type?, file_name?, file_type: "xlsx"|"csv"|"pdf",
 *     rows?: Record<string,unknown>[],   // for xlsx/csv
 *     pdf_base64?: string }              // for pdf
 * Output: { batch_id, row_count, rows }
 *
 * Requires the OPENROUTER_API_KEY secret:
 *   npx supabase secrets set OPENROUTER_API_KEY=<key>
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

interface CanonicalRow {
  deductee_name: string | null;
  pan: string | null;
  section_code: string | null;
  amount_paid: number | null;
  tds_amount: number | null;
  rate: number | null;
  date_of_payment: string | null;
  date_of_deduction: string | null;
  challan_bsr: string | null;
  challan_no: string | null;
}

const CANONICAL_INSTRUCTION = `You normalise a client's TDS statement into canonical rows.
Return STRICT JSON only: {"rows":[{...}]} — no prose, no markdown fences.
Each row object MUST have exactly these keys (use null when a value is absent):
  deductee_name   : string  — the party/deductee the payment was made to
  pan             : string  — 10-char PAN, uppercase, or null
  section_code    : string  — TDS section e.g. "194C","194J","194Q" (strip any prefix words)
  amount_paid     : number  — amount paid/credited (plain number, no commas/₹)
  tds_amount      : number  — TDS deducted (plain number)
  rate            : number  — TDS rate % (plain number, e.g. 0.1, 1, 10)
  date_of_payment : string  — keep the original date text as printed
  date_of_deduction : string
  challan_bsr     : string  — 7-digit BSR/receipt number of the challan, or null
  challan_no      : string  — challan serial number, or null
Rules: never invent rows or values; one object per deductee line item; ignore
totals/header/footer lines; convert Indian-format numbers ("12,34,567.00") to plain numbers.`;

function extractJson(text: string): any {
  if (!text) return null;
  let s = text.trim();
  // Strip ```json ... ``` fences if present
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  // Last resort: grab the outermost {...}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch { /* ignore */ }
  }
  return null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return isFinite(n) ? n : null;
}

function coerceRow(r: any): CanonicalRow {
  return {
    deductee_name: r?.deductee_name != null ? String(r.deductee_name).trim() : null,
    pan: r?.pan != null ? String(r.pan).trim().toUpperCase() : null,
    section_code: r?.section_code != null ? String(r.section_code).trim() : null,
    amount_paid: toNum(r?.amount_paid),
    tds_amount: toNum(r?.tds_amount),
    rate: toNum(r?.rate),
    date_of_payment: r?.date_of_payment != null ? String(r.date_of_payment).trim() : null,
    date_of_deduction: r?.date_of_deduction != null ? String(r.date_of_deduction).trim() : null,
    challan_bsr: r?.challan_bsr != null ? String(r.challan_bsr).trim() : null,
    challan_no: r?.challan_no != null ? String(r.challan_no).trim() : null,
  };
}

// Provider-agnostic LLM call. Prefers OpenRouter when OPENROUTER_API_KEY is set,
// otherwise falls back to the firm's already-configured ANTHROPIC_API_KEY so the
// feature works with no extra setup. Both providers read PDFs natively. Returns
// the text content + a `truncated` flag (output hit the token cap) so the caller
// can report the real cause instead of silently dropping rows.
async function callAI(opts: {
  system: string; userText: string; maxTokens: number;
  pdf?: { base64: string; filename: string };
}): Promise<{ ok: boolean; status: number; errText: string; content: string; truncated: boolean }> {
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

  if (OPENROUTER_API_KEY) {
    const model = Deno.env.get("OPENROUTER_MODEL") || "google/gemini-2.5-flash";
    const pdfEngine = Deno.env.get("OPENROUTER_PDF_ENGINE") || "pdf-text"; // "mistral-ocr" for scanned PDFs
    const userContent: any = opts.pdf
      ? [{ type: "text", text: opts.userText }, { type: "file", file: { filename: opts.pdf.filename, file_data: `data:application/pdf;base64,${opts.pdf.base64}` } }]
      : opts.userText;
    const body: any = {
      model, temperature: 0, max_tokens: opts.maxTokens,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: opts.system }, { role: "user", content: userContent }],
    };
    if (opts.pdf) body.plugins = [{ id: "file-parser", pdf: { engine: pdfEngine } }];
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": "https://caflow.app", "X-Title": "CAFlow TDS Recon" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status, errText: await res.text(), content: "", truncated: false };
    const j = await res.json();
    return { ok: true, status: 200, errText: "", content: j?.choices?.[0]?.message?.content ?? "", truncated: j?.choices?.[0]?.finish_reason === "length" };
  }

  if (ANTHROPIC_API_KEY) {
    const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514";
    const userContent: any = opts.pdf
      ? [{ type: "text", text: opts.userText }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.pdf.base64 } }]
      : [{ type: "text", text: opts.userText }];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: opts.maxTokens, system: opts.system, messages: [{ role: "user", content: userContent }] }),
    });
    if (!res.ok) return { ok: false, status: res.status, errText: await res.text(), content: "", truncated: false };
    const j = await res.json();
    const text = Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("") : "";
    return { ok: true, status: 200, errText: "", content: text, truncated: j?.stop_reason === "max_tokens" };
  }

  return { ok: false, status: 503, errText: "No AI provider configured. Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY in Supabase secrets.", content: "", truncated: false };
}

serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    if (!Deno.env.get("OPENROUTER_API_KEY") && !Deno.env.get("ANTHROPIC_API_KEY")) {
      return json({ error: "No AI provider configured. Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY in Supabase secrets." }, 503);
    }

    const body = await req.json();
    const { filing_id, form_type, file_name, file_type, rows, pdf_base64 } = body ?? {};
    if (!filing_id) return json({ error: "filing_id is required" }, 400);
    if (file_type === "pdf" ? !pdf_base64 : !Array.isArray(rows)) {
      return json({ error: "Provide `rows` for xlsx/csv or `pdf_base64` for pdf" }, 400);
    }

    // Resolve filing scope (firm/client/period) — the batch inherits it.
    const { data: filing, error: fErr } = await supabase
      .from("tds_filings")
      .select("id, client_id, firm_id, financial_year, quarter, tds_forms")
      .eq("id", filing_id)
      .single();
    if (fErr || !filing) return json({ error: "Filing not found" }, 404);

    const resolvedForm = form_type || (Array.isArray(filing.tds_forms) ? filing.tds_forms[0] : null) || "26Q";

    // ── Normalise via the LLM ───────────────────────────────────────────────────
    // Excel/CSV: normalise in row batches so a large client file never overruns
    // the model's output budget (which would truncate the JSON and silently drop
    // deductees). PDF: single pass with a large budget + explicit truncation check.
    const IMPORT_MAX_TOKENS = 32000;
    const collected: CanonicalRow[] = [];

    const httpErr = (status: number, errText: string) => {
      console.error("AI import error:", status, errText);
      const msg = status === 401 ? "AI provider authentication failed — check the configured API key."
        : status === 402 ? "AI provider payment required — add credits."
        : status === 429 ? "AI provider rate limit — try again shortly."
        : `AI import failed (${status})`;
      return json({ error: msg }, status >= 500 ? 502 : status);
    };

    if (file_type === "pdf") {
      const r = await callAI({
        system: CANONICAL_INSTRUCTION,
        userText: `Extract every deductee line item from this ${resolvedForm} TDS statement PDF into the canonical rows.`,
        pdf: { base64: pdf_base64, filename: file_name || "client.pdf" },
        maxTokens: IMPORT_MAX_TOKENS,
      });
      if (!r.ok) return httpErr(r.status, r.errText);
      if (r.truncated) {
        return json({ error: "This PDF has more rows than can be read in one pass. Split it into smaller PDFs, or import the data as Excel/CSV." }, 422);
      }
      const parsed = extractJson(typeof r.content === "string" ? r.content : JSON.stringify(r.content));
      const raw: any[] = Array.isArray(parsed?.rows) ? parsed.rows : Array.isArray(parsed) ? parsed : [];
      collected.push(...raw.map(coerceRow));
    } else {
      // Excel/CSV — chunked so each call's JSON output stays well within budget.
      const BATCH = 100;
      const allRows = (rows as any[]).slice(0, 5000);
      for (let i = 0; i < allRows.length; i += BATCH) {
        const batch = allRows.slice(i, i + BATCH);
        const r = await callAI({
          system: CANONICAL_INSTRUCTION,
          userText: `Client ${resolvedForm} file rows ${i + 1}-${i + batch.length} (JSON):\n${JSON.stringify(batch)}`,
          maxTokens: IMPORT_MAX_TOKENS,
        });
        if (!r.ok) return httpErr(r.status, r.errText);
        if (r.truncated) {
          return json({ error: "A batch of client rows exceeded the model output limit. Try a smaller file." }, 422);
        }
        const parsed = extractJson(typeof r.content === "string" ? r.content : JSON.stringify(r.content));
        const raw: any[] = Array.isArray(parsed?.rows) ? parsed.rows : Array.isArray(parsed) ? parsed : [];
        collected.push(...raw.map(coerceRow));
      }
    }

    // drop wholly-empty rows the model may echo
    const canonical = collected.filter(r => r.deductee_name || r.pan || r.amount_paid != null || r.tds_amount != null);

    if (canonical.length === 0) {
      return json({ error: "No deductee rows could be read from the file. Check the file has recognisable columns/section." }, 422);
    }

    // ── Persist batch + rows ───────────────────────────────────────────────────
    const { data: batch, error: bErr } = await supabase
      .from("tds_import_batches")
      .insert({
        filing_id, client_id: filing.client_id, firm_id: filing.firm_id,
        financial_year: filing.financial_year, quarter: filing.quarter, form_type: resolvedForm,
        file_name: file_name ?? null, file_type: file_type ?? null,
        row_count: canonical.length, status: "imported", imported_by: user.id,
      })
      .select("id")
      .single();
    if (bErr || !batch) return json({ error: `Batch insert failed: ${bErr?.message}` }, 500);

    const rowRecords = canonical.map((r, i) => ({
      batch_id: batch.id, filing_id, firm_id: filing.firm_id, row_index: i,
      deductee_name: r.deductee_name, pan: r.pan, section_code: r.section_code,
      amount_paid: r.amount_paid, tds_amount: r.tds_amount, rate: r.rate,
      date_of_payment: r.date_of_payment, date_of_deduction: r.date_of_deduction,
      challan_bsr: r.challan_bsr, challan_no: r.challan_no, raw: r,
    }));
    const { error: rErr } = await supabase.from("tds_imported_rows").insert(rowRecords);
    if (rErr) return json({ error: `Row insert failed: ${rErr.message}` }, 500);

    return json({ batch_id: batch.id, row_count: canonical.length, rows: canonical });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("tds-recon-import fatal:", message);
    return json({ error: message }, 500);
  }
});
