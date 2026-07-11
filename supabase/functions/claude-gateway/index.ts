import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
    'You are a Senior Indian Chartered Accountant acting as an audit investigator. You receive JSON: { "question": "...", "context": { a READ-ONLY snapshot of the client scrutiny state: totals by severity, by_category, by_ledger, coverage, captured judgment facts, recurring_from_prior_year } }. Answer the auditor\'s question concisely and practically, grounded ONLY in the snapshot — reference specific ledgers, categories, counts and missing facts. If the snapshot lacks the information, say so and suggest what to check next. Never invent numbers or findings. Return ONLY JSON, no markdown fences: {"answer":"your answer as short paragraphs or bullet points"}.',
  scrutiny_query_drafter:
    'You are a Senior Indian Chartered Accountant drafting a client audit query from a scrutiny finding. The input is JSON with the rule, severity, legal reference, ledger/account, and the finding text. Draft ONE concise, polite, professional query (2-4 sentences) that states the exception, cites the legal reference if one is given, and asks the client for a specific explanation and/or supporting documents. Do NOT invent facts beyond the finding, and do not assert wrongdoing. Return ONLY a JSON object, no markdown: {"query_text":"..."}.',
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
    const isScrutinyHeavy = request_type === "scrutiny_investigator" || request_type === "scrutiny_query_drafter";
    const anthropicModel = isLightRequest ? "claude-haiku-4-5-20251001" : isScrutinyHeavy ? "claude-sonnet-4-20250514" : "claude-sonnet-4-20250514";
    const lovableModel = isLightRequest ? "google/gemini-2.5-flash-lite" : "google/gemini-3-flash-preview";
    const useStream = wantStream === true;

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
