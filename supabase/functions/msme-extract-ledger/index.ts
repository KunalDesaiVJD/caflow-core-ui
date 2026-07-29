// msme-extract-ledger — read a vendor ledger PDF of ANY accounting-software
// format and return a canonical JSON ledger, using Claude (via the Anthropic
// Messages API with native PDF document input).
//
// WHY A DEDICATED FUNCTION: the deterministic Tally/Expert parsers in
// src/lib/msme43b handle those two formats exactly (balance reconciles to the
// printed closing). This function is the fallback for OTHER formats the parser
// can't read. The API key never leaves the server; whatever Claude returns is
// re-checked client-side against the printed closing balance (the reconciliation
// oracle) before any figure is trusted — a wrong extraction is flagged, not used.
//
// AUTH + KEY: mirrors claude-gateway (Supabase JWT). ANTHROPIC_API_KEY is the
// same secret claude-gateway already uses — no new secret to provision.
//
// MODEL: claude-sonnet-4-20250514 — the model the firm's key is proven to serve
// in production (see the note in claude-gateway/index.ts; newer models 400 on
// this key). It supports PDF document input. Bump when the key is upgraded.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT =
  'You are a precise data-extraction engine for an Indian CA firm. You are given ' +
  'a single vendor/supplier LEDGER exported as a PDF from an accounting software ' +
  '(Tally, Busy, Marg, Expert, Zoho, or any other). Extract it into strict JSON. ' +
  'This is a CREDITOR (accounts-payable) ledger: a CREDIT to the party increases ' +
  'what we owe (a purchase/bill); a DEBIT reduces it (a payment/settlement).\n\n' +
  'Return ONLY this JSON object (no markdown, no commentary):\n' +
  '{"ledgers":[{' +
  '"vendorName":string,' +
  '"financialYear":string,          // e.g. "2025-26" if determinable, else ""\n' +
  '"periodFrom":string,             // ISO yyyy-mm-dd if shown, else ""\n' +
  '"periodTo":string,               // ISO yyyy-mm-dd if shown, else ""\n' +
  '"openingBalance":number,         // signed: +ve = credit/payable, -ve = debit balance\n' +
  '"closingBalance":number,         // signed the same way, exactly as printed\n' +
  '"txns":[{' +
  '"date":string,                   // ISO yyyy-mm-dd\n' +
  '"particulars":string,            // narration / contra ledger name as printed\n' +
  '"vchType":string,                // Purchase/Payment/Journal/Credit Note/etc, or ""\n' +
  '"vchNo":string,                  // voucher/bill no, or ""\n' +
  '"debit":number,                  // amount debited to the party (0 if none)\n' +
  '"credit":number,                 // amount credited to the party (0 if none)\n' +
  '"taxableValue":number|null,      // invoice value EXCLUDING GST, only if the document shows it\n' +
  '"gstAmount":number|null,         // total GST on the invoice (CGST+SGST+IGST+cess), only if shown\n' +
  '"gstRate":number|null            // GST rate as a percentage, e.g. 18, only if shown\n' +
  '}]}]}\n\n' +
  'RULES:\n' +
  '- Extract EVERY transaction line, top to bottom, in order. Do not summarise, ' +
  'sample, or skip rows.\n' +
  '- GST FIELDS ARE CRITICAL AND MUST NEVER BE GUESSED. Only fill taxableValue, ' +
  'gstAmount or gstRate when the document ACTUALLY SHOWS them — for example a tax ' +
  'column, a CGST/SGST/IGST breakup, a rate in the narration, or a voucher detail ' +
  'line naming a GST ledger. If the ledger shows only a single gross amount per ' +
  'row, set ALL THREE to null. A wrong tax split produces a wrong disallowance, ' +
  'whereas null is handled safely downstream. Never infer a rate from the amount, ' +
  'from the vendor\'s trade, or from what is typical.\n' +
  '- taxableValue + gstAmount must equal the credit amount when both are given.\n' +
  '- Each transaction has EITHER a debit OR a credit (the other is 0). Never put ' +
  'the same amount in both.\n' +
  '- Copy amounts EXACTLY (strip currency symbols and thousands separators; keep ' +
  'paise). Never round or invent figures.\n' +
  '- Do NOT include opening/closing/"carried forward"/"brought forward"/grand-total ' +
  'rows as transactions — capture opening and closing in their own fields only.\n' +
  '- If the file contains multiple vendor ledgers, return one object per vendor in ' +
  '"ledgers".\n' +
  '- If a value is unknown, use "" for strings and 0 for numbers. Output valid JSON only.';

function parseJson(content: string) {
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth (Supabase JWT) ---
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) {
      return json({ error: "Unauthorized" }, 401);
    }
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // --- Input ---
    // Either the PDF itself (best fidelity, and the only way to read a scan), or
    // the TEXT of a page range. A merged export holding every vendor's ledger is
    // far too large for one reply, so the client splits it by pages and sends the
    // text of each chunk. See src/lib/msme43b/aiExtract.ts.
    const { pdf_base64, text_content, filename, page_range } = await req.json();
    if (!pdf_base64 && !text_content) {
      return json({ error: "Missing pdf_base64 or text_content" }, 400);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return json({ error: "AI extraction is not configured (no ANTHROPIC_API_KEY)." }, 503);
    }

    // --- Claude call: PDF document block + extraction instruction ---
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        // A ledger year can run to hundreds of rows. 8192 truncated real files
        // mid-JSON, which the parser then discarded entirely — the whole reply
        // lost for want of headroom. Sonnet 4 supports far more.
        max_tokens: 32000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: pdf_base64
            ? [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf_base64 } },
                { type: "text", text: `Extract the ledger${filename ? ` from "${filename}"` : ""} into the JSON schema. Output JSON only.` },
              ]
            : [
                {
                  type: "text",
                  text:
                    `Ledger text${filename ? ` from "${filename}"` : ""}` +
                    `${page_range ? `, pages ${page_range}` : ""}:\n\n${String(text_content).slice(0, 600_000)}`,
                },
                {
                  type: "text",
                  text:
                    "Extract it into the JSON schema. This may be one PAGE RANGE of a longer export " +
                    "containing several vendors' ledgers, so: return one entry in \"ledgers\" per vendor " +
                    "appearing in this text; a ledger may start or end mid-range, in which case return the " +
                    "rows you can see and leave openingBalance/closingBalance as 0 unless the range actually " +
                    "shows them. Output JSON only.",
                },
              ],
        }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic error:", anthropicResponse.status, errText);
      const isAuth = anthropicResponse.status === 401 || anthropicResponse.status === 403;
      return json(
        { error: isAuth ? "AI provider authentication failed. Update ANTHROPIC_API_KEY." : "AI extraction failed." },
        anthropicResponse.status >= 500 ? 502 : anthropicResponse.status,
      );
    }

    const result = await anthropicResponse.json();
    const content: string = result.content?.[0]?.text || "";
    // stop_reason "max_tokens" means the ledger was too large to fit one response.
    const truncated = result.stop_reason === "max_tokens";

    let parsed: unknown;
    try {
      parsed = parseJson(content);
    } catch (_e) {
      // Truncation is the usual cause and has a specific remedy, so say which it
      // is rather than reporting a generic parse failure.
      return json({
        error: truncated
          ? "The ledger was too large to read in one pass — the reply was cut off. " +
            "Split the PDF into smaller files (one vendor, or a few pages each) and try again."
          : "The ledger-reading service returned output that could not be parsed.",
        truncated,
        raw: content.slice(0, 2000),
      }, 502);
    }

    return json({ ...(parsed as object), truncated, model: MODEL });
  } catch (e) {
    console.error("msme-extract-ledger error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
