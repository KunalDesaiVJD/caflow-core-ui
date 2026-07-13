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
  interest: number | null;
  rate: number | null;
  date_of_payment: string | null;
  date_of_deduction: string | null;
  challan_bsr: string | null;
  challan_no: string | null;
}

const CANONICAL_INSTRUCTION = `You normalise a client's TDS statement into canonical rows.
Client files use WILDLY different column headers, capitalisation, spacing,
abbreviations, wording and column order — you must identify each field by its
MEANING, not by matching exact header text. Use the header's wording, its
position relative to other recognised columns, AND the data pattern in that
column (e.g. a column of values like "AJKPM0355R" is a PAN regardless of what
its header says; a column of dd/mm/yyyy-style values is a date even under an
unfamiliar header) to decide what each column represents. A file will rarely
use the exact synonym wording below verbatim — that's expected; match by
meaning, don't require an exact string match.

Return STRICT JSON only: {"rows":[{...}]} — no prose, no markdown fences.
Each row object MUST have exactly these keys (use null when a value is genuinely absent):
  deductee_name   : string — the party/deductee/payee the payment was made to.
      Common headers: Deductee Name, Party Name, Vendor Name, Customer Name,
      Beneficiary Name, Payee Name, Name, Party, Vendor.
  pan             : string — 10-char PAN, uppercase, or null.
      Common headers: PAN, PAN No., PAN Number, Permanent Account Number,
      Deductee PAN, Party PAN. Data pattern: 5 letters + 4 digits + 1 letter.
  section_code    : string — TDS section / nature of payment (strip any prefix
      words). Common headers: Section, TDS Section, Section Code, Nature of
      Payment, Payment Section, U/S. PREFERENCE when a file has more than one
      section-like column: a plain-language descriptor (e.g. "TDS - Purchase",
      "TDS - Contract", "TDS - Professional Fees", "Rent", "Commission") is far
      more useful than a bare legal clause citation (e.g. "393(1) 8(ii)",
      "194Q(2)") — prefer the descriptive column when both exist in the same
      file. If only a legal-citation-style column exists, extract it as-is;
      never invent or translate a code you cannot read directly from the file.
  amount_paid     : number — amount paid/credited (plain number, no commas/₹).
      Common headers: Amount, Payment Amount, Gross Amount, Invoice Amount,
      Taxable Amount, Credit Amount, Amount Paid/Credited.
  tds_amount      : number — TDS deducted (plain number).
      Common headers: TDS, TDS Amount, Tax Deducted, Deducted Tax, Tax Amount.
  interest        : number — interest amount (plain number), or null if absent.
      Common headers: Interest, Interest Amount, Late Interest, Int.
  rate            : number — TDS rate % (plain number, e.g. 0.1, 1, 10)
  date_of_payment : string — the date the DEDUCTEE was paid/credited (the
      transaction date), keep the original date text exactly as printed, do
      not reformat it. Common headers: Date of Credit, Date of Payment, Payment
      Date, Credit Date, Voucher Date, Transaction Date, Deduction Date, Date,
      Value Date, Entry Date. IMPORTANT: if the file only has ONE date-like
      column (most client files do), use it here — do not leave this null just
      because the header doesn't literally contain the word "payment".
      DISAMBIGUATION: some files have TWO separate date columns — one for the
      deductee's transaction (e.g. "Date of Credit", populated on every row)
      and a DIFFERENT one that is actually the challan/bank deposit date (even
      if its header also says "Date of Payment"), recognisable because it is
      only populated on rows that ALSO have a Bank Name/BSR Code/Challan
      No./CIN value and is blank elsewhere. When both exist, use the
      always-populated transaction-date column ("Date of Credit" or
      equivalent) for date_of_payment — NEVER the sparse challan-deposit
      column. We have no field for the challan deposit date; leave it unused.
  date_of_deduction : string — same matching rules as date_of_payment. If the
      file has a SEPARATE, distinctly-labelled deduction date column, use that;
      otherwise reuse the same single date column used for date_of_payment.
  challan_bsr     : string — 7-digit BSR/receipt number of the challan, or null
  challan_no      : string — challan serial number, or null

Rules: never invent rows or values; one object per deductee line item; ignore
totals/header/footer/subtotal lines; convert Indian-format numbers
("12,34,567.00") to plain numbers.`;

// ── Deterministic header pre-mapper (Excel/CSV only) ────────────────────────
// A synonym-based pass over the RAW column headers, run BEFORE the LLM call.
// This is not a replacement for the LLM's semantic matching — it's a
// reliability floor: common, expected header names (the ones a client's file
// overwhelmingly likely uses) get identified with certainty and handed to the
// model as an explicit hint, so date/name/PAN/etc. detection doesn't depend
// entirely on the model noticing them unprompted. The model can still
// disregard a hint if the actual data in that column contradicts it.
// Order WITHIN each field's list is a priority ranking, not just a membership
// list — guessColumnMapping tries synonyms in order and takes the first one
// that matches an available header, so e.g. date_of_payment's "dateofcredit"
// is deliberately listed before "dateofpayment": a real client file (verified
// against an actual TDS export) can have BOTH a "Date of Credit" column
// (the deductee transaction date we want) and a "Date of Payment" column that
// is actually the challan/bank deposit date, not the deductee's — see the
// DISAMBIGUATION note in CANONICAL_INSTRUCTION. Listing the correct one first
// makes the deterministic pass prefer it regardless of column order.
const HEADER_SYNONYMS: Record<keyof CanonicalRow, string[]> = {
  deductee_name: ["deducteename", "partyname", "vendorname", "customername", "beneficiaryname", "payeename", "name", "party", "vendor", "deductee"],
  pan: ["pan", "panno", "pannumber", "permanentaccountnumber", "deducteepan", "partypan"],
  section_code: ["section", "tdssection", "sectioncode", "natureofpayment", "paymentsection", "us", "u/s"],
  amount_paid: ["amount", "paymentamount", "grossamount", "invoiceamount", "taxableamount", "creditamount", "amountpaidcredited", "amountpaid"],
  // "amountoftds" handles the very common "Amount of TDS" phrasing (word
  // order reversed from "tdsamount") — substring matching is order-sensitive
  // so without this exact token that header would go unmatched (verified
  // against a real client file that uses exactly this header).
  tds_amount: ["tds", "tdsamount", "amountoftds", "taxdeducted", "deductedtax", "taxamount", "tdsdeducted"],
  interest: ["interest", "interestamount", "lateinterest", "int"],
  rate: ["rate", "tdsrate", "rateoftds"],
  date_of_payment: ["dateofcredit", "creditdate", "dateofpaymentcredit", "voucherdate", "transactiondate", "date", "valuedate", "entrydate", "dateofpayment", "paymentdate", "deductiondate"],
  date_of_deduction: ["dateofdeduction", "tdsdeductiondate"],
  challan_bsr: ["bsr", "bsrcode", "challanbsr"],
  challan_no: ["challanno", "challannumber", "challanserialno"],
};

/** lowercase, strip everything but letters/digits, so "Date of Credit" and "date_of_credit " and "DATE-OF-CREDIT" all normalise identically. */
const normaliseHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Best-effort deterministic header→field mapping. Each source column is
 * assigned to at most one canonical field, and each canonical field gets at
 * most one source column (first/best match wins — CanonicalRow's own key
 * order acts as the tie-break priority, so e.g. date_of_payment is resolved
 * before the more specific date_of_deduction only claims a distinct column).
 */
function guessColumnMapping(sampleRows: Record<string, unknown>[]): Partial<Record<keyof CanonicalRow, string>> {
  const headers = new Set<string>();
  for (const row of sampleRows.slice(0, 5)) {
    if (row && typeof row === "object") for (const k of Object.keys(row)) headers.add(k);
  }
  const mapping: Partial<Record<keyof CanonicalRow, string>> = {};
  const claimed = new Set<string>();
  for (const field of Object.keys(HEADER_SYNONYMS) as (keyof CanonicalRow)[]) {
    const synonyms = HEADER_SYNONYMS[field];
    let best: string | null = null;
    // Iterate SYNONYMS first, headers second, so the priority order within
    // each field's list (see comment above) decides the winner when several
    // headers in the same file match different synonyms of the same field —
    // not just whichever header happens to come first in the sheet.
    for (const syn of synonyms) {
      if (best) break;
      for (const header of headers) {
        if (claimed.has(header)) continue;
        if (normaliseHeader(header) === syn) { best = header; break; } // exact normalised match
      }
    }
    if (!best) {
      // Fallback: substring match (e.g. header "TDS Amount (Rs.)" contains "tdsamount").
      // Synonyms under 4 chars (e.g. "tds", "us", "int", "pan", "bsr") are
      // skipped here — verified against a real file that a bare "tds" token
      // substring-matches "TDS Rate" and wrongly claims it for tds_amount
      // before the `rate` field ever gets a chance at its own exact match.
      // Short tokens stay fully valid for the EXACT-match pass above, where
      // there's no collision risk (the whole header must equal them).
      for (const syn of synonyms) {
        if (best) break;
        if (syn.length < 4) continue;
        for (const header of headers) {
          if (claimed.has(header)) continue;
          const norm = normaliseHeader(header);
          if (norm.includes(syn) || syn.includes(norm)) { best = header; break; }
        }
      }
    }
    if (best) { mapping[field] = best; claimed.add(best); }
  }
  return mapping;
}

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
    interest: toNum(r?.interest),
    rate: toNum(r?.rate),
    date_of_payment: r?.date_of_payment != null ? String(r.date_of_payment).trim() : null,
    date_of_deduction: r?.date_of_deduction != null ? String(r.date_of_deduction).trim() : null,
    challan_bsr: r?.challan_bsr != null ? String(r.challan_bsr).trim() : null,
    challan_no: r?.challan_no != null ? String(r.challan_no).trim() : null,
  };
}

type AIResult = { ok: boolean; status: number; errText: string; content: string; truncated: boolean };

// Graceful multi-provider LLM call. Tries each CONFIGURED provider in order and
// FALLS THROUGH on failure — so e.g. Anthropic returning "credit balance too low"
// (400) transparently drops to the Lovable AI gateway. Order: OpenRouter (if the
// firm set their own key) → Lovable (the app's provisioned Gemini gateway) →
// Anthropic (last resort). Mirrors claude-gateway's fallback philosophy. All
// paths read PDFs. Returns text content + a `truncated` flag.
async function callAI(opts: {
  system: string; userText: string; maxTokens: number;
  pdf?: { base64: string; filename: string };
}): Promise<AIResult> {
  const dataUrl = opts.pdf ? `data:application/pdf;base64,${opts.pdf.base64}` : "";

  // OpenAI-compatible providers (OpenRouter, Lovable). extractJson downstream
  // tolerates ```json fences, so we skip response_format for portability.
  const openAICompat = async (url: string, key: string, model: string, pdfMode: "file" | "image_url", extra: Record<string, string>): Promise<AIResult> => {
    let userContent: any = opts.userText;
    if (opts.pdf) {
      userContent = pdfMode === "file"
        ? [{ type: "text", text: opts.userText }, { type: "file", file: { filename: opts.pdf.filename, file_data: dataUrl } }]
        : [{ type: "text", text: opts.userText }, { type: "image_url", image_url: { url: dataUrl } }];
    }
    const body: any = { model, temperature: 0, max_tokens: opts.maxTokens, messages: [{ role: "system", content: opts.system }, { role: "user", content: userContent }] };
    if (opts.pdf && pdfMode === "file") body.plugins = [{ id: "file-parser", pdf: { engine: Deno.env.get("OPENROUTER_PDF_ENGINE") || "pdf-text" } }];
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, status: res.status, errText: await res.text(), content: "", truncated: false };
    const j = await res.json();
    return { ok: true, status: 200, errText: "", content: j?.choices?.[0]?.message?.content ?? "", truncated: j?.choices?.[0]?.finish_reason === "length" };
  };

  const anthropic = async (key: string): Promise<AIResult> => {
    const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514";
    const userContent: any = opts.pdf
      ? [{ type: "text", text: opts.userText }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.pdf.base64 } }]
      : [{ type: "text", text: opts.userText }];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(opts.pdf ? { "anthropic-beta": "pdfs-2024-09-25" } : {}) },
      body: JSON.stringify({ model, max_tokens: opts.maxTokens, system: opts.system, messages: [{ role: "user", content: userContent }] }),
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
    const r = await openAICompat("https://openrouter.ai/api/v1/chat/completions", OPENROUTER, Deno.env.get("OPENROUTER_MODEL") || "google/gemini-2.5-flash", "file", { "HTTP-Referer": "https://caflow.app", "X-Title": "CAFlow TDS Recon" });
    if (r.ok) return r; last = r; console.error("callAI: OpenRouter failed", r.status, r.errText.slice(0, 160));
  }
  if (LOVABLE) {
    const r = await openAICompat("https://ai.gateway.lovable.dev/v1/chat/completions", LOVABLE, Deno.env.get("LOVABLE_MODEL") || "google/gemini-2.5-flash", "image_url", {});
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

    if (!Deno.env.get("OPENROUTER_API_KEY") && !Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("ANTHROPIC_API_KEY")) {
      return json({ error: "No AI provider configured. Set OPENROUTER_API_KEY, LOVABLE_API_KEY or ANTHROPIC_API_KEY in Supabase secrets." }, 503);
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
    // 8000 stays under every Claude model's output ceiling (some tiers cap at
    // 8192), so the AI provider never 400s on max_tokens. Import is batched, so a
    // small per-call budget is plenty.
    const IMPORT_MAX_TOKENS = 8000;
    const collected: CanonicalRow[] = [];

    const httpErr = (status: number, errText: string) => {
      console.error("AI import error:", status, errText);
      // Surface the provider's real reason (trimmed) instead of a bare code, so
      // an unsupported/invalid file gives an actionable message.
      let detail = "";
      try { const j = JSON.parse(errText); detail = j?.error?.message || j?.error || j?.message || ""; } catch { detail = errText; }
      detail = String(detail || "").slice(0, 240);
      const msg = status === 401 ? "AI provider authentication failed — check the configured API key."
        : status === 402 ? "AI provider payment required — add credits."
        : status === 429 ? "AI provider rate limit — try again shortly."
        : `AI import failed (${status})${detail ? `: ${detail}` : ""}`;
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
      // Excel/CSV — chunked small so each call's JSON output stays well within
      // the 8000-token budget (≈50 canonical rows ≈ 3-4k output tokens).
      const BATCH = 50;
      const allRows = (rows as any[]).slice(0, 5000);

      // Deterministic header pass (see guessColumnMapping) — computed ONCE
      // against the whole file's headers, then handed to every batch as a
      // hint. Falls back gracefully (empty mapping → no hint line) if the
      // headers don't match any known synonym at all, in which case the
      // model relies purely on the strengthened system prompt + data pattern.
      const mapping = guessColumnMapping(allRows);
      const mappingEntries = Object.entries(mapping);
      const mappingHint = mappingEntries.length
        ? `\n\nAutomatic header analysis detected these likely column mappings — use them unless the actual data in that column clearly contradicts it: ${mappingEntries.map(([field, header]) => `${field} ← "${header}"`).join("; ")}.`
        : "";

      for (let i = 0; i < allRows.length; i += BATCH) {
        const batch = allRows.slice(i, i + BATCH);
        const r = await callAI({
          system: CANONICAL_INSTRUCTION,
          userText: `Client ${resolvedForm} file rows ${i + 1}-${i + batch.length} (JSON):\n${JSON.stringify(batch)}${mappingHint}`,
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
      amount_paid: r.amount_paid, tds_amount: r.tds_amount, interest: r.interest, rate: r.rate,
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
