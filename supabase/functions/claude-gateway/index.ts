import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { callClaudeCliText, isProviderError } from "../_shared/aiProvider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LIGHT_TYPES = new Set(["tds_section_identifier", "invoice_description", "spell_grammar_fix"]);

const SYSTEM_PROMPTS: Record<string, string> = {
  tds_section_identifier:
    "You are an Indian tax expert specializing in TDS under the Income Tax Act, 1961. Identify the correct TDS section for the given payment nature. Return JSON only, no markdown: {\"section\":\"194C\",\"rate\":2,\"threshold\":30000,\"flag_message\":\"Brief reason\"}. Common sections: 194C contractor 1-2%, 194J(b) professional 10%, 194J(a) technical 2%, 194I(b) rent building 10%, 194I(a) rent machinery 2%, 194H commission 2%, 194Q purchase goods 0.1%, 194A interest 10%, 194T partner payment 10%, 194IB rent by individual 5%.",
  narration_batch_classifier:
    "You are an Indian CA audit assistant. Analyse journal entry narrations. Return JSON array only, no other text: [{\"entry_id\":\"\",\"category\":\"\",\"risk_level\":\"\",\"flag_reason\":\"\",\"suggested_3cd_clause\":\"\"}]. Categories: prior_period|loan_jv_settlement|accommodation_entry|cash_payment|interest_income_missed|subsidy_accounting|normal. Only flag genuinely suspicious entries.",
  ais_reconciliation:
    "You are a CA reconciling AIS with ITR. Identify mismatches. For each AIS item return JSON: {\"item_id\":\"\",\"matched\":true,\"mismatch_reason\":\"\",\"suggested_explanation\":\"\",\"itr_head\":\"\"}.",
  audit_report_drafter:
    "You are a Senior CA. Draft a formal audit report per ICAI SA standards. Return JSON: {\"opening_paragraph\":\"\",\"basis_for_opinion\":\"\",\"key_audit_matters\":[{\"title\":\"\",\"description\":\"\"}],\"management_responsibility\":\"\",\"auditor_responsibility\":\"\",\"opinion_paragraph\":\"\"}.",
  caro_answers:
    "You are a CA answering CARO 2020 clauses in formal ICAI language. Return JSON: {\"clause_id\":\"answer_text\"}.",
  comparative_commentary:
    "You are a CA writing MD&A commentary. Return 3 paragraphs: overall performance, key movements, audit implications.",
  notice_response_drafter:
    "You are a CA drafting an income tax notice response. Cite IT Act sections and CBDT circulars. Use a professional formal tone.",
  invoice_description:
    "You are a CA writing invoice line items. Return a JSON array of professional service descriptions.",
  spell_grammar_fix:
    'You are an expert English proofreader for Indian CA firm audit documents. Fix ALL spelling errors and improve sentence construction in the given text. Preserve technical accounting terms, ledger names, Indian company names, and proper nouns exactly as given. Correct grammar, punctuation, and word order where needed. Keep the same meaning and professional tone — only fix errors. Return ONLY a JSON object with no markdown: {"corrected":"corrected text here"}. If the text is already correct, return it unchanged.',
  workpaper_assistant:
    "You are a CA suggesting audit procedures. Return: specific tests, red flags, and SA standard references.",
  notes_drafter:
    "You are a CA drafting Notes to Accounts in Ind AS or AS format. Return the structured note as JSON.",
  fs_line_mapper:
    'You are a 30-year experienced Indian Chartered Accountant mapping Tally ERP ledger accounts to the correct Financial Statement line item for Schedule III (corporate) or the NCE framework (partnership / proprietorship / LLP / HUF / trust).\n\nINPUT: { "entity_type":"corporate|nce", "fs_items":[{"code":"NCE_TR","name":"Trade receivables","section":"NCE_BS_assets"}...], "ledgers":[{"ledger":"...","tally_group":"...","closing_balance":0,"side":"Dr|Cr"}...], "learned_patterns":[{"ledger_pattern":"commission income","fs_code":"NCE_OI","confidence":92}...] }\n\nFor each ledger, pick the SINGLE best matching fs_code from fs_items. Rules in priority order:\n0. LEARNED PATTERNS — generic account types only (highest priority for ledger/account names): The "learned_patterns" array contains CA-verified mappings for GENERIC ledger names only (e.g. "commission income", "salary payable", "advance tax"). These are account-type names, not party or business names. Use them with high confidence when a ledger closely matches. IMPORTANT: learned_patterns will NEVER contain vendor, customer, or party business names — those are mapped purely by Tally group (rule 1).\n1. Tally group is a very strong signal (Sundry Debtors\u2192Trade Receivables, Bank Accounts\u2192Cash, Fixed Assets\u2192PPE, Capital Account\u2192Owners Capital/Reserves, etc.).\n2. Ledger name keywords — look for accounting terms in the name.\n3. Closing side (Dr/Cr) narrows BS_assets vs BS_liabilities / PL_income vs PL_expense.\n4. Party-named ledgers (individual vendor/customer/business names) under "Sundry Debtors" ALWAYS map to trade receivables; under "Sundry Creditors" ALWAYS map to trade payables — regardless of the party name. Do NOT attempt pattern-match party names against learned_patterns.\n5. Never invent codes \u2014 must pick from fs_items.\n\nReturn ONLY a JSON array, no markdown:\n[{"ledger":"...","fs_code":"NCE_TR","confidence":"high|medium|low","reason":"one short sentence"}]\nOne entry per input ledger. Confidence: high = Tally group / learned pattern / near-exact name; medium = contextual inference; low = best guess.',
  coa_mapper:
    'You are a 30-year experienced Indian Chartered Accountant mapping Tally ERP ledger names to standard Schedule III / COA account heads for financial statement preparation. You are given a JSON array of ledger objects: [{"ledger":"...","tally_group":"...","closing_balance":0,"bs_pl_side":"..."}]. You also receive the entity type (corporate/llp/nce) and a list of available COA heads.\n\nFor each ledger, suggest the best matching standard account head from the COA master. Consider: (1) ledger name similarity to standard heads, (2) Tally group context, (3) closing balance sign, (4) BS/PL classification.\n\nReturn ONLY a JSON array — no markdown, no explanation:\n[{"ledger":"ledger name","suggested_head":"Standard Account Head","bs_pl":"BS","account_group":"Group Name","confidence":"high|medium|low","reason":"brief reason"}]\n\nConfidence: high = exact/near-exact name match; medium = likely match based on context; low = best guess. Always return one entry per input ledger.',
  tb_pre_analyser:
    'You are a 30-year experienced Indian Chartered Accountant performing a comprehensive 360-degree pre-audit analysis of a Trial Balance before it is accepted by the CA firm. You receive a structured TB summary including: ledger count, debit/credit totals, difference, primary group list with sections and closing balances, BS assets vs liabilities, group-totals-tallied flag, unclassified group count, and key validation metrics.\n\nAnalyse EVERYTHING — balance, classification, hierarchy integrity, anomalies, data quality — and return ONLY a JSON object (no markdown, no explanation):\n{\n  "score": 0-100,\n  "status": "clean"|"warnings"|"errors",\n  "summary": "One-sentence overview of the TB quality",\n  "issues": [\n    {"severity":"error"|"warning"|"info","category":"balance"|"hierarchy"|"classification"|"data","title":"Short title","description":"Detailed explanation and impact","affected":["group/ledger names if applicable"]}\n  ],\n  "insights": [\n    {"title":"Finding title","finding":"What this means for the audit"}\n  ],\n  "suggestions": ["Prioritised actionable steps for the CA to fix issues before proceeding"]\n}\n\nScoring: 90-100=clean, 70-89=minor warnings, 50-69=significant issues, <50=major problems. Be precise and practical — this output will be shown directly to a CA auditor.',
  tb_classifier:
    'You are a 30-year experienced Indian Chartered Accountant classifying Tally ERP Trial Balance groups. Each input may include: name, edgeClassification (algorithmic guess, may be Unknown), normalBal (Dr/Cr), closingSign (Dr=debit closing, Cr=credit closing), sampleAccounts (ledger names under this group). Classify each group as exactly one of: bs_asset, bs_liability, pl_income, pl_expense.\n\nRULES:\n- bs_liability: Capital Account, Partner Capital, Share Capital, Equity Share Capital, Reserves & Surplus, Loans (Liability), Secured Loans, Unsecured Loans, Bank OD A/c, Cash Credit, Current Liabilities, Sundry Creditors, Trade Payables, Duties & Taxes, GST Payable, TDS Payable, Provisions, Outstanding Expenses, Advances Received, Statutory Dues, Profit & Loss A/c (ALWAYS bs_liability — never pl_expense)\n- bs_asset: Fixed Assets, Capital WIP, Investments, Current Assets, Sundry Debtors, Trade Receivables, Cash-in-Hand, Bank Accounts, Deposits (Asset), Loans & Advances (Asset), Advance Tax, TDS Receivable, GST Input, Opening Stock, Closing Stock, Prepaid Expenses, Security Deposits\n- pl_income: Sales Accounts, Revenue, Turnover, Direct Incomes, Indirect Incomes, Other Income, Interest Received, Commission Received\n- pl_expense: Purchase Accounts, Direct Expenses, Indirect Expenses, Manufacturing Expenses, Employee Benefits, Finance Costs, Depreciation, Partner Payout, Remuneration to Partners\n\nCLOSING SIGN HEURISTIC: Cr closing → likely bs_liability or pl_income. Dr closing → likely bs_asset or pl_expense.\nDo NOT use closing sign alone — account names take priority.\nReturn ONLY JSON: {"GroupName":"bs_asset"}. No markdown, no explanation.',
  scrutiny_investigator:
    'You are a Senior Indian Chartered Accountant acting as an audit investigator. You receive JSON: { "question": "...", "context": { a READ-ONLY snapshot of the client scrutiny state: totals by severity, by_category, by_ledger, coverage, captured judgment facts, recurring_from_prior_year, AND a "financials" object sourced from the client\'s LIVE Tally Sync data (falling back to an imported trial-balance snapshot) } }. The financials object contains: financials.source ("tally_sync" | "snapshot" | "none"); financials.available (true when real accounting data is present); financials.trial_balance { ledger_count, dr_closing_total, cr_closing_total, balanced }; financials.groups[] { group, net_balance, side, ledgers } — group net balances are the financial-statement figures; financials.top_ledgers[] { ledger, group, closing, side } — the largest ledger closing balances; financials.vouchers { count, total_amount, by_type[] }; financials.top_parties[] { party, count, total } — party balances by voucher volume. All amounts are in INR.\n\nUSE THE FINANCIALS: For any question about ledger balances, party balances, expense or income amounts, the trial balance, group / financial-statement figures, or voucher activity, quote the ACTUAL numbers from the financials object. When financials.available is true the data IS available — do NOT reply that it is "missing from the snapshot". top_ledgers and top_parties list only the largest items; if a specific small ledger is not listed, say it is outside the top items shown (and can be pulled from the ledger dump) rather than "unavailable". Only when financials.available is false should you say the information is unavailable and suggest running Tally Sync. Answer concisely and practically, grounded ONLY in the context — reference specific ledgers, groups, parties, categories, counts and amounts. Never invent numbers or findings.\n\nOUTPUT FORMAT — IMPORTANT: Detect the output format the auditor asks for and produce it, written as clean GitHub-Flavored Markdown INSIDE the answer string. Honour requests such as: table / tabular (a real Markdown table with a header row and a |---|---| separator row); professional audit report or working paper (## / ### headings + short paragraphs, in ICAI style); Excel or CSV data (return a Markdown table — the app converts it to a spreadsheet); checklist (a "- [ ] item" list); summary (a ## heading + tight bullets); comparison table (a Markdown table); letter (a "> " block-quoted letter with salutation, body and sign-off); JSON or CSV (a fenced ```json / ```csv code block). If no format is requested, default to a short ## heading plus tidy bullets or a compact table. Always use ## / ### headings, - bullets, 1. numbered lists and REAL Markdown tables (with the |---| separator) so the app can export the answer to Word, PDF and Excel with correct structure, tables and headings. Return ONLY JSON (no code fences around the JSON itself): {"answer":"<your Markdown answer>"}.',
  scrutiny_query_drafter:
    'You are a Senior Indian Chartered Accountant drafting a client audit query from a scrutiny finding. The input is JSON with the rule, severity, legal reference, ledger/account, and the finding text. Draft ONE concise, polite, professional query (2-4 sentences) that states the exception, cites the legal reference if one is given, and asks the client for a specific explanation and/or supporting documents. Do NOT invent facts beyond the finding, and do not assert wrongdoing. Return ONLY a JSON object, no markdown: {"query_text":"..."}.',
  scrutiny_rule_composer:
    'You are a Senior Indian Chartered Accountant AND a rules engineer. The user describes an audit scrutiny rule in plain English; convert it into ONE structured rule for the CAFlow scrutiny engine.\n\nReturn ONLY JSON (no markdown). Either {"rule": {...}, "explanation": "one plain sentence restating exactly what the rule flags"} — OR, when the intent needs a capability the generic engine does NOT have (see CANNOT-DO), {"rule": null, "needs_dedicated": {"capability":"tds_rate|gst_recon|ratio_industry|related_party|other", "reason":"why the generic engine cannot compute this", "suggested_module":"TDS Recon|GST Recon|Ratio Analysis|Related-Party Register"}, "explanation":"one sentence telling the user this needs the dedicated module, not a scrutiny rule"}.\n\nrule fields: rule_id (short code CATEGORY-NNN, e.g. "CASH-050"); rule_name (short title); category (ONE uppercase code: CASH TDS CRED DEBT SALES EXP JE LOAN PROV RPT FA INV PAY CAP RAT COMP BKR); severity ("high"|"medium"|"low"); detection_level ("voucher"|"account"|"aggregate"); detection_logic (below); threshold_value (number mirror of the main limit, or null); audit_query_template (the client-query sentence using {account} {amount} {date} {count} {pct} placeholders); legal_reference (e.g. "Section 40A(3)" or null); prior_year_needed (true ONLY if it compares to prior year).\n\ndetection_logic MUST use the generic evaluator whenever possible: {"check":"expr", ...}. expr shape:\n- grain: "voucher" (per transaction) | "account" (per trial-balance ledger) | "aggregate" (group vouchers then test a total/count).\n- scope (optional): { voucher_type?:string[], ledger_keywords?:string[], parent_group_keywords?:string[], cash_only?:true, side?:"Dr"|"Cr", nonzero?:true }. SCOPING: to target a FAMILY (creditors/debtors/banks) use the GROUP — ledger_keywords:["creditor"] (on the voucher grain this ALSO matches the party parent_group) or parent_group_keywords:["sundry creditors"]; party ledgers are named after the vendor (e.g. "Sevenseas Global Freight Systems Pvt. Ltd."), so the family word is NOT in the ledger name. Use nonzero:true ONLY on grain="account"; NEVER on voucher/aggregate (those are within-year FLOW tests — a settled party with closing 0 must still be scanned).\n- where: a condition, an array of conditions (AND), or {all:[...]} / {any:[...]}. A condition is {field, op, value}. Operators: > >= < <= == != between contains not_contains in is_blank is_not_blank is_round. Voucher fields: amount abs_amount narration voucher_type dr_cr party ledger date month is_weekend days_to_fy_end. Account fields: closing (signed: Dr +, Cr -) abs_closing balance_type ledger parent_group opening.\n- aggregate (grain=aggregate): { by:["party"|"year"|"day"|"month"|"ledger"|"amount"|"date"|"voucher_type"], fn:"sum"|"count"|"max", field?:"abs_amount", having:{op,value} }. Use for per-party-per-year TDS limits, duplicates (by party+amount+date, fn count, having >1), same-day cash aggregation, etc.\n- vs_prior_year (grain=account): {op,pct} compares |CY closing|/|PY closing|*100.\n\nCANNOT-DO (return needs_dedicated; do NOT emit an expr rule that silently finds nothing): anything needing a COMPUTED threshold or two joined ledger streams — TDS short/excess deduction (required = section_rate x base, e.g. 194C 2% x amount, vs actual TDS deducted), applying a statutory RATE/percent, GST reconciliation (GSTR vs books), ratio / vs-industry / vs-benchmark, gross-up, or related-party matching. The engine has NO rate/section table and can only compare ONE summed field to a CONSTANT; disguising these as an aggregate over TDS returns 0 and misleads the auditor.\n\nEXAMPLES:\n- "single cash payment over 10000" -> {"check":"expr","grain":"voucher","scope":{"cash_only":true,"voucher_type":["payment"]},"where":[{"field":"abs_amount","op":">","value":10000}]}\n- "interest paid to any party over 40000 in the year" -> {"check":"expr","grain":"aggregate","scope":{"ledger_keywords":["interest"],"side":"Dr"},"aggregate":{"by":["party","year"],"fn":"sum","field":"abs_amount","having":{"op":">","value":40000}}}\n- "debit balance in a creditor" -> {"check":"expr","grain":"account","scope":{"parent_group_keywords":["creditor"],"nonzero":true},"where":[{"field":"closing","op":">","value":0}]}\n- "rent up more than 50% vs last year" -> {"check":"expr","grain":"account","scope":{"ledger_keywords":["rent"]},"vs_prior_year":{"op":">=","pct":150}} with prior_year_needed:true\n- "TDS short deducted on any transporter/contractor (194C)" -> {"rule":null,"needs_dedicated":{"capability":"tds_rate","reason":"needs required TDS = 2% x transport base vs actual TDS deducted, joining expense to TDS ledger; the engine has no rate table","suggested_module":"TDS Recon"},"explanation":"Short-deduction needs the TDS Recon module (section rate x base), not a generic scrutiny rule."}\n\nRULES: prefer expr; use a non-expr named check only if the request EXACTLY matches a known one. ALWAYS include a scope or where so the rule does not match everything. Use the exact statutory threshold the user gives. When the intent is in CANNOT-DO, return needs_dedicated instead of a hollow rule. Return ONLY the JSON object.',
};

const RATE_LIMIT = 20;

function parseAiJson(content: string) {
  try {
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { raw: content };
  }
}

function extractOpenAIContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- STEP 1: Auth ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get firm_id from users table
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("firm_id")
      .eq("id", user.id)
      .single();

    const firmId = profile?.firm_id ?? null;

    const body = await req.json();
    const {
      request_type,
      user_message,
      stream: wantStream,
      // skill_examples: approved patterns from audit_ai_skills that Claude should respect.
      // Format: [{ id, before, after }] — injected as a "LEARNED CORRECTIONS" block.
      skill_examples,
    } = body;

    if (!request_type || !user_message) {
      return new Response(JSON.stringify({ error: "Missing request_type or user_message" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const basePrompt = SYSTEM_PROMPTS[request_type];
    if (!basePrompt) {
      return new Response(JSON.stringify({ error: `Unknown request_type: ${request_type}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Inject approved skill corrections into the system prompt so Claude
    // learns from firm-specific human overrides without retraining.
    let systemPrompt = basePrompt;
    if (Array.isArray(skill_examples) && skill_examples.length > 0) {
      const exBlock = skill_examples
        .filter((s: any) => s?.before && s?.after)
        .slice(0, 8) // cap at 8 examples to avoid inflating tokens
        .map((s: any, i: number) =>
          `  ${i + 1}. Previously AI suggested: "${s.before}" — CA corrected to: "${s.after}"`
        )
        .join("\n");
      if (exBlock) {
        systemPrompt =
          basePrompt +
          `\n\nFIRM-LEARNED CORRECTIONS (highest priority — always apply these patterns):\n${exBlock}\nUse these to improve your suggestions for similar cases.`;
      }
    }

    // --- STEP 2: Rate limit ---
    const { count, error: countError } = await supabaseAdmin
      .from("ai_usage_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString());

    if (countError) console.error("Rate limit check error:", countError);

    if ((count ?? 0) >= RATE_LIMIT) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Max 20 AI calls per hour." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- STEP 3: Log ---
    await supabaseAdmin.from("ai_usage_log").insert({
      user_id: user.id,
      firm_id: firmId,
      request_type,
    });

    // --- STEP 4: Select model ---
    const isLightRequest = LIGHT_TYPES.has(request_type);
    // AI Scrutiny: the judgment-heavy scrutiny request types MUST use a model the firm's
    // ANTHROPIC_API_KEY can actually serve. A previous version pinned these to "claude-opus-4-8",
    // which the production key cannot access — Anthropic then returns HTTP 400 (a non-auth error),
    // and STEP 5 hard-failed with "AI service error" instead of falling back to Gemini, breaking
    // the AI Auditor for EVERY client. We use the same proven model as the rest of the app
    // (claude-sonnet-4-20250514, which every other AI feature uses successfully in prod). The
    // STEP 5 fallback below makes any future model change degrade gracefully rather than break.
    const isScrutinyHeavy = request_type === "scrutiny_investigator" || request_type === "scrutiny_query_drafter" || request_type === "scrutiny_rule_composer";
    const anthropicModel = isLightRequest ? "claude-haiku-4-5-20251001" : isScrutinyHeavy ? "claude-sonnet-4-20250514" : "claude-sonnet-4-20250514";
    const lovableModel = isLightRequest ? "google/gemini-2.5-flash-lite" : "google/gemini-3-flash-preview";
    const useStream = wantStream === true;

    if ((Deno.env.get("CAFLOW_AI_BACKEND") ?? "claude-cli") !== "legacy-api") {
      const reply = await callClaudeCliText(
        systemPrompt,
        user_message,
        180_000,
        isLightRequest ? "haiku" : "sonnet",
      );
      if (isProviderError(reply)) {
        return new Response(JSON.stringify({ error: reply.error }), {
          status: reply.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (useStream) {
        const event = JSON.stringify({
          choices: [{ delta: { content: reply.text } }],
          delta: { text: reply.text },
          content_block: { text: reply.text },
        });
        return new Response(`data: ${event}\n\ndata: [DONE]\n\n`, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }
      return new Response(JSON.stringify(parseAiJson(reply.text)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    let provider: "anthropic" | "lovable" | null = null;
    let aiResponse: Response | null = null;

    // --- STEP 5: Primary provider (Anthropic) ---
    if (ANTHROPIC_API_KEY) {
      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: user_message }],
          stream: useStream,
        }),
      });

      if (anthropicResponse.ok) {
        provider = "anthropic";
        aiResponse = anthropicResponse;
      } else {
        const errText = await anthropicResponse.text();
        console.error("Anthropic error:", anthropicResponse.status, errText);

        // Degrade gracefully. For ANY Anthropic failure — auth (401/403), model-not-available
        // (400/404), rate limit (429), or 5xx — fall through to the Lovable/Gemini fallback when
        // it is configured, instead of hard-failing. Only surface an error to the client when
        // there is NO fallback provider. (Previously only 401/403 fell back, so a model the firm's
        // key could not serve hard-failed the whole request with "AI service error" — this is
        // exactly what broke the AI Auditor and would break any client on any inaccessible model.)
        if (!LOVABLE_API_KEY) {
          const isAuthError = anthropicResponse.status === 401 || anthropicResponse.status === 403;
          const message = isAuthError
            ? "AI provider authentication failed. Please update ANTHROPIC_API_KEY."
            : "AI service error";

          return new Response(JSON.stringify({ error: message }), {
            status: anthropicResponse.status >= 500 ? 502 : anthropicResponse.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // else: leave aiResponse null so STEP 6 falls back to Lovable/Gemini.
      }
    }

    // --- STEP 6: Fallback provider (Lovable AI Gateway) ---
    if (!aiResponse && LOVABLE_API_KEY) {
      const gatewayResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: lovableModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: user_message },
          ],
          stream: useStream,
        }),
      });

      if (!gatewayResponse.ok) {
        const errText = await gatewayResponse.text();
        console.error("Lovable AI Gateway error:", gatewayResponse.status, errText);

        const message =
          gatewayResponse.status === 429
            ? "Rate limits exceeded, please try again later."
            : gatewayResponse.status === 402
              ? "Payment required, please add funds to your Lovable AI workspace."
              : "AI service error";

        return new Response(JSON.stringify({ error: message }), {
          status: gatewayResponse.status >= 500 ? 502 : gatewayResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      provider = "lovable";
      aiResponse = gatewayResponse;
    }

    if (!aiResponse || !provider) {
      return new Response(JSON.stringify({ error: "No AI provider is configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (useStream) {
      return new Response(aiResponse.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Non-streaming: parse and return JSON
    const result = await aiResponse.json();

    const content =
      provider === "anthropic"
        ? result.content?.[0]?.text || ""
        : extractOpenAIContent(result.choices?.[0]?.message?.content);

    const parsed = parseAiJson(content);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("claude-gateway error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
