/**
 * CAFlow Telegram Billing Bot — Edge Function
 *
 * Receives Telegram webhook → parses intent via Claude Haiku →
 * queries Supabase billing tables → replies with formatted data.
 *
 * Tables used:
 *   invoices              — INVOICES_TABLE
 *   clients               — CLIENTS_TABLE
 *   client_ledger_entries — LEDGER_TABLE
 *   billing_receipts      — RECEIPTS_TABLE
 *   firms                 — FIRMS_TABLE
 *   notification_log      — log email sends
 *   telegram_link_tokens  — account linking (future use)
 *
 * Secrets required (set via `supabase secrets set KEY=value`):
 *   TELEGRAM_BOT_TOKEN
 *   ANTHROPIC_API_KEY
 *   GRAPH_TENANT_ID        (already set — for email)
 *   GRAPH_CLIENT_ID        (already set)
 *   GRAPH_CLIENT_SECRET    (already set)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { callClaudeCliText, isProviderError } from "../_shared/aiProvider.ts";
import { agentProtocol, chunkMessage, detectStatementRequest, parseAgentAction, parseCommand } from "../_shared/botAgent.ts";
import { createBillingTools, NEW_BILLING_TOOLS } from "./billingTools.ts";
import { buildDigest, runCommand } from "./commands.ts";
import { createReportTools, REPORT_TOOLS } from "./reportTools.ts";
import { buildReportStatementPdf, defaultPeriod } from "./statementPdf.ts";

// ─── Environment ──────────────────────────────────────────────────────────────
const BOT_TOKEN           = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL        = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY   = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GRAPH_TENANT_ID     = Deno.env.get("GRAPH_TENANT_ID");
const GRAPH_CLIENT_ID     = Deno.env.get("GRAPH_CLIENT_ID");
const GRAPH_CLIENT_SECRET = Deno.env.get("GRAPH_CLIENT_SECRET");
const EMAIL_FROM          = "accounts@vjdesai.com";
const FIRM_DISPLAY_NAME   = "V J Desai & Co. LLP";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const billingTools = createBillingTools(supabase);
// Billing → Reports through Telegram: statements (PDF / email / text), the report table, totals, groups.
const reportTools = createReportTools(supabase, {
  sendPdf: (chatId, bytes, filename, caption) => sendTelegramDocumentBytes(chatId, bytes, filename, caption),
  notify: (chatId, text) => sendTelegram(chatId, text),
  supabaseUrl: SUPABASE_URL,
  serviceKey: SUPABASE_SERVICE_KEY,
});

// ─── Claude system prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are CAFlow Billing Agent for V J Desai & Co. LLP (a CA firm) and its \
associate firms. You answer on Telegram for the firm's own staff.

CONTEXT — read EVERY message as a question about the CAFlow Billing module first: clients, client \
groups, firms, invoices, credit notes, quotations / proformas, receipts, TDS / GST TDS, kasar, \
opening balances, outstanding, overdue, ageing, statements of account (ledger / khata), payment \
advice, reminders, billing emails and the Billing → Reports section. A bare name ("Ramani", \
"Nirali group") means that client or group; "balance", "dues", "baki", "pending", "khata", \
"hisab", "account copy", "confirmation" all mean the billing account. Hindi / Gujarati / \
Hinglish words are fine — answer in English unless the user writes otherwise. Only if a \
question truly has nothing to do with billing, say briefly that you handle CAFlow billing.

WHICH TOOL
- Statement / ledger / khata / account copy as a PDF → send_statement (client_name or \
group_name). It is the exact Billing → Reports statement: each client's ledger, then the \
amount payable to each firm with bank details, never a group total. Use only_clients / \
exclude_clients when the user names some clients of a group.
- Email a statement → email_statement: first call without confirm, show the To / CC and the \
amounts, and send (confirm=true) once the user agrees — or straight away if they already \
said "send it now". Group statements go to the group's saved master email (To) + additional \
emails (CC).
- Statement lines as text ("what entries in Ramani's account", "when did X last pay") → get_statement.
- Sundry debtors / top debtors / group-wise or firm-wise receivable / advances / nil balances / \
"report" → get_report (view_by client | group | firm, any period).
- Billed / collected / TDS / kasar totals, month-wise or firm/client/group-wise → get_billing_totals.
- Groups, who is in a group, saved group email / phone, clients not in any group → get_groups.
- One client's balance with each firm → get_client_balance; open / overdue invoices → \
get_outstanding_invoices; ageing → get_ageing; receipts list → get_receipts; reminders → \
get_reminder_status; email log → get_email_log; cancelled documents → get_cancelled_documents; \
firm totals → get_firm_summary; find invoices → search_invoices; client master data → \
get_client_details; invoice PDF → send_pdf_to_telegram (document_type "invoice"); email an \
invoice → send_email_with_attachments.

PERIODS: default is the current financial year (1 April) to today. "last year" / "FY 25-26" → \
financial_year 2025-26; "September" → that month of the current FY; "as on 30 June" → to_date. \
Indian FY runs 1 April – 31 March.

RULES
- All firms together unless the user names a firm (firm_name).
- Never say a PDF or email was sent unless the tool result in THIS turn says so (sent / emailed true); \
earlier messages in the history do not count — call the tool again.
- Always fetch real data with tools — never invent or estimate a figure. Several tool calls \
are fine; combine them to answer compound questions.
- Dr / positive = receivable from the client; Cr / negative = advance from the client.
- If a name matches several clients / groups, list the matches and ask which one.
- Use conversation history for "same client", "that group", "above", "send it", "email it too".
- Answer briefly with ₹ amounts in Indian format (₹1,23,456.00); use short lists, not long tables.
- Never say "I did not understand" — make your best billing interpretation, and ask one short \
question only when you really cannot tell what is wanted.`;

// ─── Claude tool definitions (function calling) ───────────────────────────────
const BILLING_TOOLS = [
  {
    name: "search_invoices",
    description: "Search invoices by client name (partial match), doc number, date range, or status. Returns list of invoices.",
    input_schema: {
      type: "object",
      properties: {
        client_name: { type: "string", description: "Partial client name" },
        doc_no:      { type: "string", description: "Invoice/document number (partial match ok)" },
        date_from:   { type: "string", description: "Start date YYYY-MM-DD" },
        date_to:     { type: "string", description: "End date YYYY-MM-DD" },
        status:      { type: "string", enum: ["draft", "finalized", "sent", "paid", "overdue"] },
        limit:       { type: "number", description: "Max results (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "list_clients",
    description: "List all clients or search by name/PAN. Use for 'give me all client names' type queries.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Partial name or PAN" },
        limit:  { type: "number", description: "Max results (default 50)" },
      },
      required: [],
    },
  },
  {
    name: "get_outstanding_invoices",
    description: "Get all unpaid/overdue invoices across all clients. Set overdue_only=true to show only past-due invoices.",
    input_schema: {
      type: "object",
      properties: {
        client_name:  { type: "string",  description: "Filter to a specific client (optional)" },
        group_name:   { type: "string",  description: "Filter to a client group (optional)" },
        firm_name:    { type: "string",  description: "Filter to one firm (optional)" },
        overdue_only: { type: "boolean", description: "If true, only return invoices past due date (default false)" },
        limit:        { type: "number",  description: "Max results (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "get_billing_summary",
    description: "Dashboard summary: total billed, paid, outstanding, by period.",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          description: "Period filter — one of: this_month, last_month, fy_2026_27 (or any fy_YYYY_YY pattern). Omit for all-time.",
        },
      },
      required: [],
    },
  },
  {
    name: "send_pdf_to_telegram",
    description: `Send INVOICE PDFs to this chat (document_type "invoice"; by invoice_ids, doc_no or client_name). For a client's or group's statement of account / ledger use send_statement instead.`,
    input_schema: {
      type: "object",
      properties: {
        document_type: { type: "string", enum: ["invoice", "ledger"], description: "Type of PDF to generate" },
        ledger_type:   { type: "string", enum: ["client", "group", "firm_revenue"],
                         description: "For ledger PDFs: client | group | firm_revenue" },
        invoice_ids:   { type: "array",  items: { type: "string" }, description: "Specific invoice UUIDs to generate PDFs for" },
        client_name:   { type: "string", description: "Client name — used when no invoice_ids provided" },
        group_name:    { type: "string", description: "Group name for group ledger" },
        doc_no:        { type: "string", description: "Invoice doc number (partial match ok)" },
        financial_year: { type: "string", description: "FY e.g. 2026-27 (optional, defaults to current FY)" },
      },
      required: ["document_type"],
    },
  },
  {
    name: "send_email_with_attachments",
    description: `Email an INVOICE PDF to the client (optionally with the client's Billing → Reports statement of account attached too). For a statement alone, or any group statement, use email_statement.
USAGE RULES:
- User says "mail ledger / send ledger / email khata / account statement bhejo" → set include_invoice=false, include_ledger=true
- User says "mail invoice / send invoice / email bill" → set include_invoice=true, include_ledger=false
- User says "mail everything / send both / invoice aur ledger" → use defaults (both true)
- Always try to resolve client email from DB; use email_to only if user explicitly provides one`,
    input_schema: {
      type: "object",
      properties: {
        client_name:     { type: "string",  description: "Client name to send email to" },
        invoice_doc_no:  { type: "string",  description: "Invoice doc number to attach (partial match ok). Only needed when include_invoice=true." },
        include_invoice: { type: "boolean", description: "Attach invoice PDF. Set false for ledger-only requests. Default true." },
        include_ledger:  { type: "boolean", description: "Attach current-FY ledger PDF. Set false for invoice-only requests. Default true." },
        email_to:        { type: "string",  description: "Override recipient email address (optional — use only when user provides explicit email)" },
      },
      required: ["client_name"],
    },
  },
  {
    name: "get_client_details",
    description: "Get full details of a client including PAN, GSTIN, contact info, and recent invoice summary.",
    input_schema: {
      type: "object",
      properties: {
        client_name: { type: "string", description: "Client name (partial match ok)" },
      },
      required: ["client_name"],
    },
  },
  ...NEW_BILLING_TOOLS,
  ...REPORT_TOOLS,
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface TgFrom { id: number; username?: string; first_name?: string; }
interface TgMessage {
  message_id: number;
  from: TgFrom;
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

interface Intent {
  action:
    | "get_invoice"
    | "get_ledger"
    | "get_outstanding"
    | "get_overdue"
    | "get_summary"
    | "send_email"
    | "send_pdf"
    | "get_receipts"
    | "help"
    | "unknown";
  invoice_no?: string | null;
  client_name?: string | null;
  financial_year?: string | null;
  email_to?: string | null;
  document_type?: string | null;  // "invoice" | "ledger"
  invoice_ids?: string[] | null;  // for send_pdf from context
  limit?: number;
}

interface Invoice {
  id: string;
  invoice_no: string | null;
  client_id: string | null;
  firm_id: string | null;
  document_type: string | null;
  status: string | null;
  invoice_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  sent_at: string | null;
  amount: number | null;
  gst_amount: number | null;
  total_amount: number | null;
  to_name: string | null;
  from_firm_name: string | null;
}

// ─── Telegram API helper ──────────────────────────────────────────────────────
async function tgApiCall(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return r.json();
}

const WEBHOOK_URL = "https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/telegram-bot";

// Telegram's own anti-spoofing mechanism: setWebhook(secret_token=...) makes Telegram send
// this value back on every update via X-Telegram-Bot-Api-Secret-Token, which we verify below.
// Set via `npx supabase secrets set TELEGRAM_WEBHOOK_SECRET=<random-value>`, then hit this
// function with ?setup=1 once to re-register the webhook with the secret attached.
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

// ─── Main Serve ───────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Health check + webhook status/setup
  if (req.method === "GET" || new URL(req.url).searchParams.get("digest") === "1") {
    const url = new URL(req.url);
    // Morning digest (pg_cron): sent only when the caller presents the key kept in
    // telegram_bot_settings, and only to allowed users who receive the digest.
    if (url.searchParams.get("digest") === "1") {
      return new Response(JSON.stringify(await sendDailyDigest(req.headers.get("X-Digest-Key") || "")), { headers: { "Content-Type": "application/json" } });
    }
    const setup = url.searchParams.get("setup");

    // Check current webhook
    const info = await tgApiCall("getWebhookInfo");
    const webhookOk = info?.result?.url === WEBHOOK_URL;

    if (setup === "1" || !webhookOk) {
      // Auto-register or re-register webhook
      await tgApiCall("deleteWebhook", {});
      const setRes = await tgApiCall("setWebhook", {
        url: WEBHOOK_URL,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
        ...(WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : {}),
      });
      return new Response(
        JSON.stringify({
          ok: true,
          bot: "CAFlow Telegram Billing Bot",
          webhook_registered: setRes.ok === true,
          webhook_url: WEBHOOK_URL,
          previous_url: info?.result?.url || "(none)",
          set_webhook_result: setRes,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        bot: "CAFlow Telegram Billing Bot",
        webhook_ok: webhookOk,
        webhook_url: info?.result?.url || "(none)",
        pending_update_count: info?.result?.pending_update_count ?? 0,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Reject forged webhook POSTs that don't carry Telegram's own secret token.
  // (No-op until TELEGRAM_WEBHOOK_SECRET is provisioned — see comment above WEBHOOK_SECRET.)
  if (WEBHOOK_SECRET) {
    const incomingSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (incomingSecret !== WEBHOOK_SECRET) {
      console.warn("[Bot] Rejected webhook POST: missing/invalid X-Telegram-Bot-Api-Secret-Token");
      return new Response("ok"); // 200 so Telegram doesn't retry-storm; request is dropped either way
    }
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response("ok"); }

  const message: TgMessage = body.message || body.edited_message;
  if (!message?.text) return new Response("ok");

  const chatId   = message.chat.id;
  const userId   = message.from.id;
  const text     = message.text.trim();
  const updateId: number = body.update_id ?? 0;

  console.log(`[Bot] Message from ${message.from.first_name ?? "?"} (${userId}): ${text.slice(0, 80)}`);

  // ── Deduplication: skip if Telegram re-sent this webhook ─────────────────
  // Telegram resends a webhook after ~15 s if the bot hasn't responded.
  // Slow PDF generation (Gotenberg) can exceed that threshold, causing the
  // same message to be processed twice and the same PDF sent twice.
  // Fix: claim the update_id in DB before starting heavy work.
  if (updateId) {
    try {
      const { data: ctx } = await (supabase as any)
        .from("telegram_context")
        .select("last_update_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (ctx?.last_update_id && Number(ctx.last_update_id) >= updateId) {
        console.log(`[Bot] Duplicate update_id=${updateId} — skipping`);
        return new Response("ok");
      }

      // Claim immediately so a concurrent duplicate sees it and skips
      await (supabase as any)
        .from("telegram_context")
        .upsert(
          { user_id: userId, last_update_id: updateId, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
    } catch { /* non-fatal — proceed anyway */ }
  }

  const command = parseCommand(text);

  // Anyone may ask for their own Telegram ID (needed to be added as a user).
  if (command?.cmd === "myid") {
    await sendTelegram(chatId, `Your Telegram ID is ${userId}`);
    return new Response("ok");
  }

  // Billing data is confidential: only users added in telegram_allowed_users may use the bot.
  if (!(await isAllowedUser(userId))) {
    console.warn(`[Bot] Refused user ${userId}`);
    await sendTelegram(chatId,
      `This bot is private to V J Desai & Co. LLP.\nYour Telegram ID is ${userId} — ask the administrator to add it in CAFlow.`);
    return new Response("ok");
  }

  // Fresh start: forget the conversation (old replies otherwise steer the AI).
  if (command?.cmd === "reset" || command?.cmd === "new") {
    await (supabase as any).from("telegram_context").upsert(
      { user_id: userId, history: [], updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    await sendTelegram(chatId, "Conversation cleared. Ask away.");
    return new Response("ok");
  }

  // Slash commands answer instantly from the database — no AI needed.
  if (command) {
    try {
      const reply = await runCommand(command.cmd, command.arg, billingTools, { report: reportTools, chatId });
      if (reply !== null) {
        for (const part of chunkMessage(reply)) await sendTelegram(chatId, part);
        return new Response("ok");
      }
    } catch (e) {
      console.error("[Bot] command failed:", e);
      await sendTelegram(chatId, `Could not run /${command.cmd}: ${(e as Error)?.message || e}`);
      return new Response("ok");
    }
  }

  // EVERYTHING ELSE → Claude API (no exceptions, no keyword shortcuts)
  await handleWithClaude(chatId, userId, text);
  return new Response("ok");
});

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── help (dynamic via Claude) ────────────────────────────────────────────────
async function handleHelpDynamic(chatId: number): Promise<void> {
  const helpText = await callClaudeRaw(
    "You are the CAFlow Billing Agent. Respond with a short, friendly summary of what you can do. " +
    "Cover: invoice queries, ledger statements, outstanding/overdue amounts, billing summary, receipts, email/PDF delivery. " +
    "Use simple bullet points. Do not mention slash commands. Keep it under 100 words.",
    "What can you do?",
    200
  );
  await sendTelegram(chatId,
    helpText ??
    "I can help with:\n• Invoice queries\n• Ledger statements\n• Outstanding & overdue amounts\n• Billing summary\n• Receipts\n• Sending invoices by email or PDF\n\nJust ask naturally!"
  );
}

// ─── claudeFetch — fetch wrapper with exponential-backoff retry on 529 ───────
// Anthropic returns HTTP 529 ("Overloaded") during peak load.  Without retry the
// bot immediately shows ❌ An error occurred.  Three retries (1 s → 2 s → 4 s)
// cover the typical transient overload window without exceeding Supabase's 10 s
// function timeout on the first attempt, and 26 s total on a worst-case third.
async function claudeFetch(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  let lastRes: Response | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // 529 Overloaded: short backoff (1 s, 2 s, 4 s)
      // 429 Rate-limit:  longer backoff (5 s, 10 s, 20 s)
      const is429  = lastRes?.status === 429;
      const delayMs = is429
        ? Math.pow(2, attempt - 1) * 5000   // 5 s → 10 s → 20 s
        : Math.pow(2, attempt - 1) * 1000;  // 1 s →  2 s →  4 s
      console.log(`[Bot] claudeFetch: ${lastRes?.status} — retry ${attempt}/${maxRetries} in ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
    }
    const res = await fetch(url, init);
    if (res.status !== 529 && res.status !== 429) return res;
    lastRes = res;
  }
  return lastRes!;
}

// ─── handleWithClaude — full Claude tool-use loop ──────────────────────────────
async function handleWithClaude(chatId: number, userId: number, userText: string): Promise<void> {
  const usingCli = (Deno.env.get("CAFLOW_AI_BACKEND") ?? "claude-cli") !== "legacy-api";
  if (!usingCli && !ANTHROPIC_API_KEY) {
    await sendMsg(chatId, "⚠️ AI service unavailable\\. Please try again later\\.");
    return;
  }

  // Load conversation history (last 20 messages = 10 exchanges)
  let history: Array<{ role: string; content: any }> = [];
  try {
    const { data: ctx } = await (supabase as any)
      .from("telegram_context")
      .select("history")
      .eq("user_id", userId)
      .maybeSingle();
    const raw: any[] = ctx?.history ?? [];
    // Defensive clean: keep ONLY pure-text messages.
    // "some text block" is NOT enough — an assistant msg can have BOTH a text block
    // AND a tool_use block; keeping it while dropping the paired tool_result produces
    // the same "unexpected tool_use_id" 400. We need ALL blocks to be text.
    history = raw.filter((m: any) => {
      if (typeof m.content === "string") return true;
      if (!Array.isArray(m.content) || m.content.length === 0) return false;
      return (m.content as any[]).every((b: any) => b.type === "text");
    });
  } catch { /* table may not exist yet — degrade gracefully */ }

  // A plain "ledger / statement of X" goes straight to the Billing → Reports statement — no AI,
  // so it cannot be answered from memory or misread.
  const lastBot = [...history].reverse().find(m => m.role === "assistant" && typeof m.content === "string")?.content as string | undefined;
  const direct = detectStatementRequest(userText, lastBot);
  history.push({ role: "user", content: userText });
  if (direct) {
    const reply = await sendStatementDirect(chatId, direct);
    if (reply) {
      await sendTelegram(chatId, reply);
      history.push({ role: "assistant", content: reply });
      await (supabase as any).from("telegram_context").upsert(
        { user_id: userId, history: history.slice(-20), updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      return;
    }
  }

  if (usingCli) {
    try {
      const reply = await runTextAgent(chatId, history);
      await sendLongTelegram(chatId, reply);
      history.push({ role: "assistant", content: reply });
      await (supabase as any).from("telegram_context").upsert(
        { user_id: userId, history: history.slice(-20), updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    } catch (error) {
      console.error("[Bot] Claude CLI error:", error);
      // The CLI gateway lives on the office computer; fall back to the API when it is unreachable.
      if (ANTHROPIC_API_KEY) {
        console.warn("[Bot] falling back to the Anthropic API");
        return await handleWithClaudeApi(chatId, userId, history);
      }
      await sendTelegram(chatId, `The AI service could not complete that request (${(error as Error)?.message || error}). Slash commands still work — type /help.`);
    }
    return;
  }
  return await handleWithClaudeApi(chatId, userId, history);
}

// ─── Direct statement request ──────────────────────────────────────────────────
/** Sends the statement; returns the chat reply, or null to let the AI handle the message. */
async function sendStatementDirect(chatId: number, req: { name: string; group: boolean }): Promise<string | null> {
  const notFound = (e?: string) => !!e && /^No (client|client group) matches/.test(e);
  try {
    let res: any = await reportTools.sendStatement(chatId, req.group ? { group_name: req.name } : { client_name: req.name });
    // A name can be a client or a group: try the other kind before giving up.
    if (notFound(res.error)) {
      const other: any = await reportTools.sendStatement(chatId, req.group ? { client_name: req.name } : { group_name: req.name });
      if (!notFound(other.error)) res = other;
    }
    if (res.error) {
      if (notFound(res.error)) return null;   // the AI may still work out what was meant
      return res.error.replace(/ Ask which one\.$/, " Which one?");
    }
    const due = (res.payment_advice || []).filter((p: any) => p.closing > 0);
    const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return [
      `Statement of account sent — ${res.name} (${res.period})${res.kind === "group" ? `, ${res.clients_in_pdf} clients` : ""}.`,
      ...(due.length ? ["", "Amount payable:", ...due.slice(0, 25).map((p: any) => `• ${p.client} → ${p.firm}: ${inr(p.closing)}`),
        ...(due.length > 25 ? [`…and ${due.length - 25} more lines in the PDF.`] : [])] : ["", "Nothing is payable."]),
    ].join("\n");
  } catch (e) {
    console.error("[Bot] direct statement failed:", e);
    return `The statement could not be prepared: ${(e as Error)?.message || e}`;
  }
}

// ─── Text-only agent (Claude CLI): tools driven by one JSON action per turn ─────────
async function runTextAgent(chatId: number, history: Array<{ role: string; content: any }>): Promise<string> {
  const toolNames = BILLING_TOOLS.map(t => t.name);
  const system = SYSTEM_PROMPT + "\n" + agentProtocol(BILLING_TOOLS as any);
  let transcript = history.map((m) => `${m.role.toUpperCase()}: ${
    typeof m.content === "string" ? m.content : (m.content as any[]).map((b) => b?.text ?? "").join("\n")
  }`).join("\n\n");
  for (let step = 0; step < 7; step++) {
    const out = await callClaudeCliText(system, transcript, 120_000, "sonnet");
    if (isProviderError(out)) throw new Error(out.error);
    const action = parseAgentAction(out.text, toolNames);
    if (action.type === "reply") return action.text;
    console.log(`[Bot] CLI tool call: ${action.name}`, JSON.stringify(action.input).slice(0, 200));
    let result: any;
    try { result = await executeTool(action.name, action.input, chatId); }
    catch (e) { result = { error: (e as Error)?.message || String(e) }; }
    const json = JSON.stringify(result);
    transcript += `\n\nASSISTANT: ${JSON.stringify({ action: "tool", name: action.name, input: action.input })}` +
      `\n\nTOOL RESULT ${action.name}: ${json.length > 24_000 ? json.slice(0, 24_000) + "…(truncated)" : json}`;
  }
  return "That needed more steps than I can take in one go — please ask a narrower question, or use a command such as /summary or /overdue.";
}

async function sendLongTelegram(chatId: number, text: string) {
  for (const part of chunkMessage(text)) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: part, parse_mode: "Markdown" }),
    });
    if (!res.ok) await sendTelegram(chatId, part);   // Markdown rejected — send as plain text
  }
}

// ─── Access control ─────────────────────────────────────────────────────────
async function isAllowedUser(userId: number): Promise<boolean> {
  const { data, error } = await (supabase as any).from("telegram_allowed_users")
    .select("telegram_user_id").eq("telegram_user_id", userId).eq("active", true).maybeSingle();
  if (error) {
    // Table not created yet (migration pending) — keep the bot usable rather than lock everyone out.
    console.error("[Bot] allow-list check failed:", error.message);
    return true;
  }
  return !!data;
}

// ─── Morning digest ─────────────────────────────────────────────────────────
async function sendDailyDigest(key: string): Promise<Record<string, unknown>> {
  const { data: cfg } = await (supabase as any).from("telegram_bot_settings").select("digest_key").eq("id", 1).maybeSingle();
  if (!cfg?.digest_key || key !== cfg.digest_key) return { ok: false, error: "forbidden" };
  const { data: users } = await (supabase as any).from("telegram_allowed_users")
    .select("telegram_user_id").eq("active", true).eq("receive_digest", true);
  if (!users?.length) return { ok: true, sent: 0 };
  const text = await buildDigest(billingTools);
  for (const u of users) await sendTelegram(Number(u.telegram_user_id), text);
  return { ok: true, sent: users.length };
}

// ─── Anthropic API agent (native tool calling) ──────────────────────────────
async function handleWithClaudeApi(chatId: number, userId: number, history: Array<{ role: string; content: any }>): Promise<void> {
  const CLAUDE_HEADERS = {
    "Content-Type":      "application/json",
    "x-api-key":         ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };

  const makeBody = (msgs: typeof history) => JSON.stringify({
    model:      Deno.env.get("TELEGRAM_BOT_MODEL") || "claude-sonnet-5-5",
    max_tokens: 2000,
    system:     SYSTEM_PROMPT,
    tools:      BILLING_TOOLS,
    messages:   msgs,
  });

  try {
    let res = await claudeFetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: CLAUDE_HEADERS, body: makeBody(history),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    let msg = await res.json();

    // ── Tool use loop ──────────────────────────────────────────────────────────
    let rounds = 0;
    while (msg.stop_reason === "tool_use" && rounds++ < 5) {
      const toolUses    = (msg.content as any[]).filter(b => b.type === "tool_use");
      const toolResults: any[] = [];

      for (const tu of toolUses) {
        console.log(`[Bot] Tool call: ${tu.name}`, JSON.stringify(tu.input).slice(0, 200));
        let result: any;
        try {
          result = await executeTool(tu.name, tu.input as Record<string, any>, chatId);
        } catch (e: unknown) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        toolResults.push({
          type:        "tool_result",
          tool_use_id: tu.id,
          content:     JSON.stringify(result),
        });
      }

      history.push({ role: "assistant", content: msg.content });
      history.push({ role: "user",      content: toolResults });

      res = await claudeFetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: CLAUDE_HEADERS, body: makeBody(history),
      });
      if (!res.ok) throw new Error(`Claude API (round ${rounds + 1}) ${res.status}`);
      msg = await res.json();
    }

    // ── Send Claude's final text reply ─────────────────────────────────────────
    const textBlocks = ((msg.content ?? []) as any[]).filter(b => b.type === "text");
    const finalText  = textBlocks.map((b: any) => b.text).join("\n").trim();
    if (finalText) await sendLongTelegram(chatId, finalText);

    // ── Persist updated history ────────────────────────────────────────────────
    history.push({ role: "assistant", content: msg.content });
    try {
      // Persist ONLY pure-text exchanges — no tool_use, no tool_result blocks at all.
      // Rule: keep a message only if EVERY content block is type "text".
      //
      // Why "every" not "some":
      //   An assistant turn can be [{type:"text",...},{type:"tool_use",...}].
      //   "some" kept it while dropping the matching tool_result user turn,
      //   producing orphaned tool_use_id → 400 on next load.
      //   "every" drops the whole mixed turn, so stored history is always clean
      //   user-text → assistant-text pairs with zero tool internals.
      const cleanHistory = history.filter((m: any) => {
        if (typeof m.content === "string") return true;
        if (!Array.isArray(m.content) || m.content.length === 0) return false;
        return (m.content as any[]).every((b: any) => b.type === "text");
      });
      await (supabase as any)
        .from("telegram_context")
        .upsert(
          { user_id: userId, history: cleanHistory.slice(-20), updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
    } catch { /* non-fatal */ }

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Bot] handleWithClaude error:", errMsg);
    // 529 overloaded — show a friendly retry message instead of a raw API error
    const isOverloaded = errMsg.includes("529") || errMsg.toLowerCase().includes("overloaded");
    if (isOverloaded) {
      await sendMsg(chatId,
        "⏳ The AI service is under high load right now\\. Please send your message again in a moment\\."
      );
    } else {
      await sendMsg(chatId, `❌ An error occurred\\. Please try again\\.\n_${escMd(errMsg.slice(0, 120))}_`);
    }
  }
}

// ─── /summary ─────────────────────────────────────────────────────────────────
async function handleSummary(chatId: number) {
  await sendMsg(chatId, "⏳ Loading billing summary\\.\\.\\.");

  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id,status,amount,total_amount,due_date,invoice_date,paid_at,document_type");

  if (error || !invoices) {
    await sendMsg(chatId, "❌ Could not load billing data\\.");
    return;
  }

  const today     = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

  const paid         = invoices.filter(i => i.status === "paid");
  const outstanding  = invoices.filter(i => ["finalized", "sent"].includes(i.status ?? ""));
  const overdue      = outstanding.filter(i => i.due_date && new Date(i.due_date) < today);
  const draft        = invoices.filter(i => i.status === "draft");
  const paidThisMonth = paid.filter(i => i.paid_at && i.paid_at >= monthStart);

  const totalRev       = sum(paid);
  const totalOut       = sum(outstanding);
  const totalOverdue   = sum(overdue);
  const monthRevenue   = sum(paidThisMonth);

  const monthName = today.toLocaleString("en-IN", { month: "long" });
  const fy = getFY(today);

  const statusCounts: Record<string, number> = {};
  invoices.forEach(i => {
    const s = i.status ?? "draft";
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  });

  let msg =
    `📊 *Billing Summary — ${escMd(fy)}*\n` +
    `_${escMd(monthName)} ${today.getFullYear()}_\n\n` +
    `💰 *Total Revenue:* ₹${escMd(fmtNum(totalRev))}\n` +
    `   \\(${paid.length} paid invoices\\)\n\n` +
    `⏳ *Outstanding:* ₹${escMd(fmtNum(totalOut))}\n` +
    `   \\(${outstanding.length} invoices pending\\)\n\n`;

  if (totalOverdue > 0) {
    msg +=
      `🚨 *Overdue:* ₹${escMd(fmtNum(totalOverdue))}\n` +
      `   \\(${overdue.length} invoices past due date\\)\n\n`;
  } else {
    msg += `✅ *Overdue: None* — all within due date\n\n`;
  }

  msg +=
    `📅 *Collected in ${escMd(monthName)}:* ₹${escMd(fmtNum(monthRevenue))}\n` +
    `   \\(${paidThisMonth.length} payments\\)\n\n` +
    `📄 *Document Counts:*\n`;

  Object.entries(statusCounts).forEach(([status, count]) => {
    msg += `   ${statusIcon(status)} ${escMd(capitalize(status))}: ${count}\n`;
  });

  msg += `   📁 *Total: ${invoices.length}*\n\n`;
  msg += `_/outstanding • /overdue • /receipts for details_`;

  await sendMsg(chatId, msg);
}

// ─── /outstanding ─────────────────────────────────────────────────────────────
async function handleOutstanding(chatId: number, limit: number) {
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id,invoice_no,client_id,to_name,invoice_date,due_date,status,amount,total_amount")
    .in("status", ["finalized", "sent"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (!invoices?.length) {
    await sendMsg(chatId, "✅ *No Outstanding Invoices\\!*\n\nAll invoices are paid or settled\\. 🎉");
    return;
  }

  const clientMap = await fetchClientNames(invoices.map(i => i.client_id));
  const total = sum(invoices);

  let msg =
    `📋 *Outstanding Invoices* \\(${invoices.length}\\)\n` +
    `💰 *Total: ₹${escMd(fmtNum(total))}*\n\n`;

  invoices.forEach((inv, i) => {
    const client = clientMap[inv.client_id ?? ""] ?? inv.to_name ?? "Unknown";
    const od     = isOverdue(inv) ? " 🚨" : "";
    msg += `*${i + 1}\\.* \`${escMd(inv.invoice_no ?? "—")}\`${od}\n`;
    msg += `   👤 ${escMd(trunc(client, 28))}\n`;
    msg += `   ₹${escMd(fmtNum(inv.total_amount ?? inv.amount ?? 0))}`;
    msg += ` • ${statusIcon(inv.status)} ${escMd(capitalize(inv.status ?? ""))}`;
    if (inv.due_date) msg += ` • Due: ${escMd(fmtDate(inv.due_date))}`;
    msg += "\n\n";
  });

  msg += `_Type /invoice \\<no\\> for details or ask me to send via email_`;
  await sendMsg(chatId, msg);
}

// ─── /overdue ─────────────────────────────────────────────────────────────────
async function handleOverdue(chatId: number, limit: number) {
  const today = new Date().toISOString().split("T")[0];

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id,invoice_no,client_id,to_name,invoice_date,due_date,status,amount,total_amount")
    .in("status", ["finalized", "sent"])
    .lt("due_date", today)
    .order("due_date", { ascending: true })
    .limit(limit);

  if (!invoices?.length) {
    await sendMsg(chatId, "✅ *No Overdue Invoices\\!*\n\nAll outstanding invoices are within their due date\\. 🎉");
    return;
  }

  const clientMap = await fetchClientNames(invoices.map(i => i.client_id));
  const total = sum(invoices);

  let msg =
    `🚨 *Overdue Invoices* \\(${invoices.length}\\)\n` +
    `💰 *Total Overdue: ₹${escMd(fmtNum(total))}*\n\n`;

  invoices.forEach((inv, i) => {
    const client  = clientMap[inv.client_id ?? ""] ?? inv.to_name ?? "Unknown";
    const daysOD  = daysDiff(inv.due_date);
    msg += `*${i + 1}\\.* \`${escMd(inv.invoice_no ?? "—")}\` — ⚠️ _${daysOD}d overdue_\n`;
    msg += `   👤 ${escMd(trunc(client, 28))}\n`;
    msg += `   ₹${escMd(fmtNum(inv.total_amount ?? inv.amount ?? 0))}`;
    msg += ` • Due was: ${escMd(fmtDate(inv.due_date))}\n\n`;
  });

  msg += `_Ask me to "send invoice \\<no\\> to email" to send a reminder_`;
  await sendMsg(chatId, msg);
}

// ─── /invoice <no> ────────────────────────────────────────────────────────────
async function handleGetInvoice(chatId: number, intent: Intent, userId?: number) {
  // No firm filter — all firms treated as one unit
  let query = supabase
    .from("invoices")
    .select("id,invoice_no,client_id,to_name,from_firm_name,document_type,status,invoice_date,due_date,paid_at,sent_at,amount,gst_amount,total_amount,tds_amount,subject")
    .order("invoice_date", { ascending: false });

  if (intent.invoice_no) {
    query = query.ilike("invoice_no", `%${intent.invoice_no}%`);
  } else if (intent.client_name) {
    // Fuzzy search by client name on to_name field + client lookup
    const { data: clientRows } = await supabase
      .from("clients")
      .select("id")
      .ilike("name", `%${intent.client_name}%`)
      .eq("is_draft", false)
      .is("deleted_at", null)
      .limit(10);

    if (!clientRows?.length) {
      // Also try to_name directly on invoices
      query = query.ilike("to_name", `%${intent.client_name}%`);
    } else {
      query = query.in("client_id", clientRows.map(c => c.id));
    }
  }

  if (intent.financial_year) {
    // Map FY to date range e.g. "2026-27" → Apr 2026 – Mar 2027
    const [startY] = (intent.financial_year).split("-");
    if (startY) {
      query = query
        .gte("invoice_date", `${startY}-04-01`)
        .lte("invoice_date", `${parseInt(startY) + 1}-03-31`);
    }
  }

  const { data: invoices, error } = await query.limit(10);

  if (error) {
    console.error("[Bot] Invoice query error:", error);
    await sendTelegram(chatId, `❌ Database error fetching invoices.`);
    return;
  }
  if (!invoices?.length) {
    const target = intent.invoice_no ?? intent.client_name ?? "the specified criteria";
    await sendTelegram(chatId, `❌ No invoices found for '${target}'.`);
    return;
  }

  const clientMap = await fetchClientNamesWithEmail(invoices.map(i => i.client_id));

  if (invoices.length === 1) {
    const inv    = invoices[0];
    const client = clientMap[inv.client_id ?? ""] ?? { name: inv.to_name ?? "Unknown", email: null };
    const amt    = inv.total_amount ?? inv.amount ?? 0;

    let msg =
      `📄 *${escMd(docTypeLabel(inv.document_type))} ${escMd(inv.invoice_no ?? "—")}*\n\n` +
      `👤 *Client:* ${escMd(client.name)}\n` +
      `💰 *Amount:* ₹${escMd(fmtNum(amt))}`;

    if (inv.gst_amount && inv.gst_amount > 0)
      msg += ` \\(incl\\. GST ₹${escMd(fmtNum(inv.gst_amount))}\\)`;
    if (inv.tds_amount && inv.tds_amount > 0)
      msg += `, TDS ₹${escMd(fmtNum(inv.tds_amount))}`;
    msg += "\n";
    msg += `${statusIcon(inv.status)} *Status:* ${escMd(capitalize(inv.status ?? "draft"))} | ${escMd(inv.invoice_no ?? "")}\n`;
    msg += `📅 *Date:* ${escMd(fmtDate(inv.invoice_date))}\n`;
    if (inv.due_date) {
      msg += `⏰ *Due:* ${escMd(fmtDate(inv.due_date))}`;
      if (isOverdue(inv)) msg += " 🚨 _OVERDUE_";
      msg += "\n";
    }
    if (inv.paid_at) msg += `✅ *Paid:* ${escMd(fmtDate(inv.paid_at))}\n`;
    if (inv.sent_at) msg += `✉️ *Sent:* ${escMd(fmtDate(inv.sent_at))}\n`;
    if (inv.subject) msg += `📝 *Notes:* ${escMd(trunc(inv.subject, 60))}\n`;
    if (client.email) {
      msg += `\n📧 *Client email:* ${escMd(client.email)}\n`;
      msg += `\n💬 _Reply "send invoice ${escMd(inv.invoice_no ?? "")} to email" to deliver via email_`;
    }

    await sendMsg(chatId, msg);

    // Save context so follow-up messages can reference this invoice
    if (userId) {
      await saveContext(userId, {
        last_intent:      intent,
        last_client_name: intent.client_name ?? inv?.to_name ?? null,
        last_invoice_ids: inv ? [inv.id] : null,
      });
    }
  } else {
    let msg =
      `📄 *${invoices.length} Invoice${invoices.length > 1 ? "s" : ""} Found*\n` +
      `Total: ₹${escMd(fmtNum(sum(invoices)))}\n\n`;

    invoices.forEach((inv, i) => {
      const client = clientMap[inv.client_id ?? ""]?.name ?? inv.to_name ?? "Unknown";
      const od     = isOverdue(inv) ? " 🚨" : "";
      msg += `*${i + 1}\\.* \`${escMd(inv.invoice_no ?? "—")}\`${od}\n`;
      msg += `   ${escMd(trunc(client, 28))}\n`;
      msg += `   ₹${escMd(fmtNum(inv.total_amount ?? inv.amount ?? 0))}`;
      msg += ` • ${statusIcon(inv.status)} ${escMd(capitalize(inv.status ?? ""))}`;
      if (inv.due_date) msg += ` • ${escMd(fmtDate(inv.due_date))}`;
      msg += "\n\n";
    });
    msg += `_Type /invoice \\<no\\> for full details_`;
    await sendMsg(chatId, msg);

    // Save context — remember client + invoice IDs for follow-up
    if (userId) {
      await saveContext(userId, {
        last_intent:      intent,
        last_client_name: intent.client_name ?? null,
        last_invoice_ids: invoices.map(i => i.id),
      });
    }
  }
}

// ─── /receipts ────────────────────────────────────────────────────────────────
async function handleReceipts(chatId: number, limit: number) {
  const { data: receipts, error } = await supabase
    .from("billing_receipts")
    .select("id,client_id,receipt_date,receipt_type,payment_mode,payment_reference,amount_received,tds_amount,invoice_id")
    .order("receipt_date", { ascending: false })
    .limit(limit);

  if (error || !receipts?.length) {
    await sendMsg(chatId, "💰 No receipts found\\.");
    return;
  }

  const clientMap = await fetchClientNames(receipts.map(r => r.client_id));
  const total = receipts.reduce((s, r) => s + (r.amount_received ?? 0), 0);

  let msg =
    `💰 *Recent Receipts* \\(${receipts.length}\\)\n` +
    `*Total Collected: ₹${escMd(fmtNum(total))}*\n\n`;

  receipts.forEach((r, i) => {
    const client = clientMap[r.client_id] ?? "Unknown";
    msg += `*${i + 1}\\.* ${escMd(fmtDate(r.receipt_date))} — ${escMd(trunc(client, 25))}\n`;
    msg += `   ₹${escMd(fmtNum(r.amount_received ?? 0))} via ${escMd(r.payment_mode ?? "—")}`;
    if (r.payment_reference) msg += ` \\(Ref: ${escMd(r.payment_reference)}\\)`;
    if (r.tds_amount && r.tds_amount > 0) msg += `\n   TDS: ₹${escMd(fmtNum(r.tds_amount))}`;
    msg += "\n\n";
  });

  await sendMsg(chatId, msg);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL EXECUTOR — thin dispatcher → named implementation functions
// All functions return structured JSON; no Telegram messages sent (except
// action tools send_pdf_to_telegram / send_email_with_attachments)
// ═══════════════════════════════════════════════════════════════════════════════

async function executeTool(
  name: string,
  input: Record<string, any>,
  chatId: number,
): Promise<any> {
  // Billing-section tools (balances, groups, firms, receipts, ageing, reminders, email log,
  // cancelled documents) — and the corrected outstanding list, which counts "overdue"
  // invoices and part payments (amount_due).
  const fromBillingTools = await billingTools.run(name, input);
  if (fromBillingTools !== undefined) return fromBillingTools;
  // Billing → Reports: every statement is the Report tab's statement of account.
  const fromReport = await reportTools.run(name, input, chatId);
  if (fromReport !== undefined) return fromReport;
  // Older tool names (still in conversation history) go to the Report statement too.
  if (name === "get_ledger") return await reportTools.getStatement({ client_name: input.client_name, from_date: input.date_from, to_date: input.date_to });
  if (name === "send_pdf_to_telegram" && input.document_type === "ledger" && input.ledger_type !== "firm_revenue") {
    return await reportTools.sendStatement(chatId, input.ledger_type === "group"
      ? { group_name: input.group_name ?? input.client_name, financial_year: input.financial_year }
      : { client_name: input.client_name, financial_year: input.financial_year });
  }
  if (name === "send_email_with_attachments" && input.include_invoice === false) {
    return await reportTools.emailStatement(chatId, { client_name: input.client_name, email_to: input.email_to, confirm: true });
  }
  switch (name) {
    case "search_invoices":           return await searchInvoices(input);
    case "list_clients":              return await listClients(input);
    case "get_outstanding_invoices":  return await getOutstanding(input);
    case "get_billing_summary":       return await getSummary(input);
    case "send_pdf_to_telegram":      return await sendPdfToTelegram(chatId, input);
    case "send_email_with_attachments": return await sendEmailWithAttachments(chatId, input);
    case "get_client_details":        return await getClientDetails(input);
    default:                          return { error: `Unknown tool: ${name}` };
  }
}

// ─── searchInvoices ───────────────────────────────────────────────────────────
async function searchInvoices(input: Record<string, any>): Promise<any> {
  let query = supabase
    .from("invoices")
    .select("id,invoice_no,client_id,to_name,document_type,status,invoice_date,due_date,paid_at,amount,gst_amount,total_amount,subject")
    .order("invoice_date", { ascending: false });

  if (input.client_name) {
    const ids = await searchClientIds(input.client_name);
    if (ids.length) query = query.in("client_id", ids);
    else            query = query.ilike("to_name", `%${input.client_name}%`);
  }
  if (input.doc_no)
    query = query.ilike("invoice_no", `%${input.doc_no}%`);

  // status="overdue" is a virtual filter — apply as finalized/sent + date check post-fetch
  const isOverdueFilter = input.status === "overdue";
  if (input.status && !isOverdueFilter)
    query = query.eq("status", input.status);
  else if (isOverdueFilter)
    query = query.in("status", ["finalized", "sent"]);

  if (input.date_from) query = query.gte("invoice_date", input.date_from);
  if (input.date_to)   query = query.lte("invoice_date", input.date_to);

  const { data, error } = await query.limit(input.limit ?? 20);
  if (error) return { error: error.message };

  const today     = new Date();
  const clientMap = await fetchClientNames((data ?? []).map(i => i.client_id));
  let rows = (data ?? []).map(i => ({
    id:            i.id,
    invoice_no:    i.invoice_no,
    client_name:   clientMap[i.client_id ?? ""] ?? i.to_name ?? "Unknown",
    status:        i.status,
    document_type: i.document_type,
    invoice_date:  i.invoice_date,
    due_date:      i.due_date,
    paid_at:       i.paid_at,
    amount:        i.total_amount ?? i.amount ?? 0,
    subject:       i.subject,
    overdue:       i.due_date && ["finalized", "sent"].includes(i.status ?? "")
                     ? new Date(i.due_date) < today : false,
  }));

  if (isOverdueFilter) rows = rows.filter(r => r.overdue);

  return {
    count:        rows.length,
    total_amount: rows.reduce((s, r) => s + r.amount, 0),
    invoices:     rows,
  };
}

// ─── getLedger ────────────────────────────────────────────────────────────────
async function getLedger(input: Record<string, any>): Promise<any> {
  if (!input.client_name) return { error: "client_name is required" };

  const { data: clients } = await supabase
    .from("clients").select("id,name,email")
    .ilike("name", `%${input.client_name}%`)
    .eq("is_draft", false).is("deleted_at", null).limit(3);

  if (!clients?.length) return { error: `Client '${input.client_name}' not found` };

  const client = clients[0];
  let ledgerQ  = supabase
    .from("client_ledger_entries").select("*")
    .eq("client_id", client.id)
    .order("entry_date", { ascending: true });

  if (input.date_from) ledgerQ = ledgerQ.gte("entry_date", input.date_from);
  if (input.date_to)   ledgerQ = ledgerQ.lte("entry_date", input.date_to);

  const { data: entries } = await ledgerQ;
  if (!entries?.length)
    return { client_name: client.name, client_email: client.email, entries: [], closing_balance: 0 };

  const totalDebit  = entries.reduce((s, e) => s + (e.debit_amount  ?? 0), 0);
  const totalCredit = entries.reduce((s, e) => s + (e.credit_amount ?? 0), 0);
  const closingBal  = entries[entries.length - 1].balance ?? (totalDebit - totalCredit);

  return {
    client_name:         client.name,
    client_email:        client.email,
    total_entries:       entries.length,
    total_debit:         totalDebit,
    total_credit:        totalCredit,
    closing_balance:     closingBal,
    recent_entries:      entries.slice(-15).map(e => ({
      date:       e.entry_date,
      narration:  e.narration ?? e.entry_type ?? "—",
      debit:      e.debit_amount  ?? 0,
      credit:     e.credit_amount ?? 0,
      balance:    e.balance,
      entry_type: e.entry_type,
    })),
    other_clients_found: clients.slice(1).map(c => c.name),
  };
}

// ─── listClients ──────────────────────────────────────────────────────────────
async function listClients(input: Record<string, any>): Promise<any> {
  let query = supabase
    .from("clients").select("id,name,email,pan,gstin,mobile")
    .eq("is_draft", false).is("deleted_at", null)
    .order("name", { ascending: true });

  if (input.search)
    query = query.or(`name.ilike.%${input.search}%,pan.ilike.%${input.search}%`);

  const { data, error } = await query.limit(input.limit ?? 50);
  if (error) return { error: error.message };

  return {
    count:   data?.length ?? 0,
    clients: (data ?? []).map(c => ({
      id: c.id, name: c.name, email: c.email, pan: c.pan, gstin: c.gstin, phone: c.mobile,
    })),
  };
}

// ─── getOutstanding ───────────────────────────────────────────────────────────
async function getOutstanding(input: Record<string, any>): Promise<any> {
  const today    = new Date();
  const todayStr = today.toISOString().split("T")[0];

  let query = supabase
    .from("invoices")
    .select("id,invoice_no,client_id,to_name,invoice_date,due_date,status,amount,total_amount")
    .in("status", ["finalized", "sent"])
    .order("due_date", { ascending: true, nullsFirst: false });

  // overdue_only → only invoices past their due date
  if (input.overdue_only)
    query = query.lt("due_date", todayStr);

  // optional client filter
  if (input.client_name) {
    const ids = await searchClientIds(input.client_name);
    if (ids.length) query = query.in("client_id", ids);
    else            query = query.ilike("to_name", `%${input.client_name}%`);
  }

  const { data, error } = await query.limit(input.limit ?? 20);
  if (error) return { error: error.message };

  const clientMap = await fetchClientNames((data ?? []).map(i => i.client_id));
  const rows = (data ?? []).map(i => ({
    invoice_no:   i.invoice_no,
    client_name:  clientMap[i.client_id ?? ""] ?? i.to_name ?? "Unknown",
    amount:       i.total_amount ?? i.amount ?? 0,
    status:       i.status,
    due_date:     i.due_date,
    overdue:      i.due_date ? new Date(i.due_date) < today : false,
    days_overdue: (i.due_date && new Date(i.due_date) < today)
      ? Math.floor((today.getTime() - new Date(i.due_date).getTime()) / 86400000)
      : 0,
  }));

  return {
    count:        rows.length,
    total_amount: rows.reduce((s, r) => s + r.amount, 0),
    overdue_only: !!input.overdue_only,
    invoices:     rows,
  };
}

// ─── getSummary ───────────────────────────────────────────────────────────────
function parsePeriod(period: string | undefined): { dateFrom: string | null; dateTo: string | null; label: string } {
  const now = new Date();
  if (!period) return { dateFrom: null, dateTo: null, label: "all time" };

  if (period === "this_month") {
    const y = now.getFullYear(), m = now.getMonth();
    return {
      dateFrom: new Date(y, m, 1).toISOString().split("T")[0],
      dateTo:   new Date(y, m + 1, 0).toISOString().split("T")[0],
      label:    now.toLocaleString("en-IN", { month: "long", year: "numeric" }),
    };
  }
  if (period === "last_month") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return {
      dateFrom: d.toISOString().split("T")[0],
      dateTo:   new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0],
      label:    d.toLocaleString("en-IN", { month: "long", year: "numeric" }),
    };
  }
  // fy_2026_27 pattern
  const fyM = period.match(/^fy_(\d{4})_(\d{2,4})$/i);
  if (fyM) {
    const startY = parseInt(fyM[1]);
    return {
      dateFrom: `${startY}-04-01`,
      dateTo:   `${startY + 1}-03-31`,
      label:    `FY ${startY}-${fyM[2]}`,
    };
  }
  return { dateFrom: null, dateTo: null, label: period };
}

async function getSummary(input: Record<string, any>): Promise<any> {
  const { dateFrom, dateTo, label } = parsePeriod(input.period);

  let query = supabase
    .from("invoices")
    .select("id,status,amount,total_amount,due_date,invoice_date,paid_at,document_type");
  if (dateFrom) query = query.gte("invoice_date", dateFrom);
  if (dateTo)   query = query.lte("invoice_date", dateTo);

  const { data: invoices, error } = await query;
  if (error) return { error: error.message };

  const today       = new Date();
  // Cancelled (voided) documents are void: never part of billed totals.
  const all         = (invoices ?? []).filter(i => i.status !== "voided");
  const paid        = all.filter(i => i.status === "paid");
  const outstanding = all.filter(i => ["finalized", "sent"].includes(i.status ?? ""));
  const overdue     = outstanding.filter(i => i.due_date && new Date(i.due_date) < today);
  const draft       = all.filter(i => i.status === "draft");
  const sumAmt      = (arr: any[]) => arr.reduce((s, i) => s + (i.total_amount ?? i.amount ?? 0), 0);
  const fyYear      = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;

  return {
    period:          label,
    financial_year:  `${fyYear}-${String(fyYear + 1).slice(2)}`,
    total_billed:    sumAmt(all),
    total_paid:      sumAmt(paid),
    outstanding:     sumAmt(outstanding),
    overdue:         sumAmt(overdue),
    counts: {
      total: all.length, paid: paid.length, outstanding: outstanding.length,
      overdue: overdue.length, draft: draft.length,
    },
  };
}

// ─── sendPdfToTelegram ────────────────────────────────────────────────────────
// Delivery strategy (Phase 4):
//   Primary  → upload to Supabase Storage "documents" bucket → Telegram URL
//   Fallback → multipart FormData bytes (works without a public bucket)
async function sendPdfToTelegram(chatId: number, input: Record<string, any>): Promise<any> {
  const docType: string = input.document_type ?? "invoice";

  // ── Shared delivery helper ─────────────────────────────────────────────────
  async function deliverPdf(pdfBytes: Uint8Array, filename: string, caption: string): Promise<void> {
    const tempPath = `temp/${filename.replace(/\.pdf$/i, "")}_${Date.now()}.pdf`;

    // ── Primary: Storage bucket → public URL → sendDocument ─────────────────
    try {
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(tempPath, pdfBytes, { contentType: "application/pdf", upsert: true });

      if (!upErr) {
        const { data: urlData } = supabase.storage
          .from("documents")
          .getPublicUrl(tempPath);

        const tgRes = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,
          {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id:  chatId,
              document: urlData.publicUrl,
              caption,
            }),
          },
        );

        // Non-blocking cleanup of temp file
        supabase.storage.from("documents").remove([tempPath]).catch(() => {});

        if (tgRes.ok) return;                         // ✅ delivered via URL
        const tgErr = await tgRes.text();
        console.warn("[Bot] Telegram URL delivery failed:", tgErr.slice(0, 200));
      } else {
        console.warn("[Bot] Storage upload failed:", upErr.message,
          "— bucket may not exist or not be public");
      }
    } catch (e: unknown) {
      console.warn("[Bot] Storage path threw:", e instanceof Error ? e.message : String(e));
    }

    // ── Fallback: send bytes directly via multipart FormData ─────────────────
    console.log("[Bot] Falling back to multipart delivery for:", filename);
    await sendTelegramDocumentBytes(chatId, pdfBytes, filename, caption);
  }

  // ── Ledger PDF ─────────────────────────────────────────────────────────────
  if (docType === "ledger") {
    const now    = new Date();
    const fyYear = (() => {
      if (input.financial_year) {
        const m = String(input.financial_year).match(/^(\d{4})/);
        return m ? parseInt(m[1]) : (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1);
      }
      return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    })();
    const fyLabel  = `${fyYear}-${String(fyYear + 1).slice(2)}`;
    const fyStart  = `${fyYear}-04-01`;
    const fyEnd    = `${fyYear + 1}-03-31`;
    const ledgerType = input.ledger_type ?? "client";

    // Client and group statements are the Billing → Reports statement of account.
    if (ledgerType === "client" || ledgerType === "group") {
      return await reportTools.sendStatement(chatId, ledgerType === "group"
        ? { group_name: input.group_name ?? input.client_name, financial_year: input.financial_year }
        : { client_name: input.client_name, financial_year: input.financial_year });
    }

    // ── FIRM REVENUE LEDGER ─────────────────────────────────────────────────
    if (ledgerType === "firm_revenue") {
      const { data: invoices } = await supabase
        .from("invoices")
        .select("invoice_no,invoice_date,to_name,total_amount,gst_amount,amount,status")
        .not("status", "in", "(draft,voided)")
        .gte("invoice_date", fyStart)
        .lte("invoice_date", fyEnd)
        .order("invoice_date", { ascending: true });

      const invList = invoices ?? [];
      // Build synthetic ledger entries from invoices
      const entries = invList.map((inv: any) => ({
        entry_date:    inv.invoice_date,
        narration:     `Invoice ${inv.invoice_no ?? "—"} — ${inv.to_name ?? "Client"}`,
        debit_amount:  Number(inv.total_amount ?? inv.amount ?? 0),
        credit_amount: 0,
        entry_type:    "invoice",
        balance:       0,
      }));
      let running = 0;
      for (const e of entries) { running += Number(e.debit_amount); (e as any).balance = running; }

      await sendTelegram(chatId, `⏳ Generating Firm Revenue Ledger FY ${fyLabel} (${entries.length} invoices)…`);
      const pdfBytes = await generateLedgerPdf(`Firm Revenue Summary`, FIRM_DISPLAY_NAME, entries, fyLabel);
      const caption  = `📊 Firm Revenue Ledger — FY ${fyLabel}\n${entries.length} invoices | Total: Rs.${fmtNum(running)}`;
      await deliverPdf(pdfBytes, `FirmRevenue_FY${fyLabel}.pdf`, caption);
      return { ok: true, ledger_type: "firm_revenue", fy_label: fyLabel, invoice_count: entries.length, total_revenue: running };
    }

    return { error: "Invalid ledger_type. Use: client | group | firm_revenue" };
  }

  // ── Invoice PDF(s) ─────────────────────────────────────────────────────────
  let invoices: any[] = [];

  if (input.invoice_ids?.length) {
    const { data } = await supabase.from("invoices").select("*").in("id", input.invoice_ids);
    invoices = data ?? [];
  } else if (input.doc_no) {
    const { data } = await supabase.from("invoices").select("*")
      .ilike("invoice_no", `%${input.doc_no}%`).limit(3);
    invoices = data ?? [];
  } else if (input.client_name) {
    const ids = await searchClientIds(input.client_name);
    if (ids.length) {
      const { data } = await supabase.from("invoices").select("*")
        .in("client_id", ids).not("status", "in", "(draft,voided)")
        .order("invoice_date", { ascending: false }).limit(3);
      invoices = data ?? [];
    }
  }

  if (!invoices.length) return { error: "No invoices found matching the criteria." };

  await sendTelegram(chatId, `⏳ Generating ${invoices.length} invoice PDF${invoices.length > 1 ? "s" : ""}…`);

  const sent: string[] = [];
  for (const inv of invoices) {
    let clientName = inv.to_name ?? "Client";
    if (inv.client_id) {
      const { data: cl } = await supabase.from("clients").select("name")
        .eq("id", inv.client_id).maybeSingle();
      if (cl?.name) clientName = cl.name;
    }

    const firmName  = inv.from_firm_name ?? FIRM_DISPLAY_NAME;
    const invFirm   = await fetchFirmForInvoice(inv);
    const pdfBytes  = await generateInvoicePdf(inv, firmName, clientName, invFirm ?? undefined);
    const safeNo    = (inv.invoice_no ?? "invoice").replace(/\//g, "-");
    const caption  = `📄 Invoice ${inv.invoice_no ?? ""} | ${clientName}\n` +
                     `Rs.${fmtNum(inv.total_amount ?? inv.amount ?? 0)} | ${capitalize(inv.status ?? "draft")} | ${fmtDate(inv.invoice_date)}`;

    await deliverPdf(pdfBytes, `Invoice_${safeNo}.pdf`, caption);
    sent.push(inv.invoice_no ?? inv.id);
  }

  return { ok: true, document_type: "invoice", sent_invoices: sent };
}

// ─── sendEmailWithAttachments ─────────────────────────────────────────────────
async function sendEmailWithAttachments(chatId: number, input: Record<string, any>): Promise<any> {
  if (!input.client_name) return { error: "client_name is required" };

  // ── 1. Resolve client ──────────────────────────────────────────────────────
  const { data: clients } = await supabase.from("clients").select("id,name,email")
    .ilike("name", `%${input.client_name}%`).limit(1);
  if (!clients?.length)
    return { error: `Client '${input.client_name}' not found. Please check the name and try again.` };
  if (!clients[0].email && !input.email_to)
    return { error: `No email address on file for '${clients[0].name}'. Please update client details in the portal, or specify an email address.` };

  const clientId       = clients[0].id;
  const clientName     = clients[0].name ?? "Client";
  const recipientEmail = input.email_to ?? clients[0].email;

  const includeInvoice = input.include_invoice !== false;  // default true
  const includeLedger  = input.include_ledger  !== false;  // default true

  // ── 2. Resolve invoice (best-effort — skipped if not found) ───────────────
  let inv: any = null;
  if (includeInvoice) {
    const invQ = supabase.from("invoices").select("*")
      .not("status", "in", "(draft,voided)").order("invoice_date", { ascending: false }).limit(1);
    const { data: invData } = await (input.invoice_doc_no
      ? invQ.ilike("invoice_no", `%${input.invoice_doc_no}%`)
      : invQ.eq("client_id", clientId)
    ).maybeSingle();
    inv = invData ?? null;
    // Not fatal — if invoice not found we still send the ledger
    if (!inv) console.warn(`[Bot] sendEmail: no invoice found for '${clientName}' — skipping invoice attachment`);
  }

  await sendTelegram(chatId, `⏳ Sending email to ${recipientEmail}…`);

  const now     = new Date();
  const fyYear  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyLabel = `${fyYear}-${String(fyYear + 1).slice(2)}`;
  const firmName = inv?.from_firm_name ?? FIRM_DISPLAY_NAME;

  // ── 3. Statement of account — the Billing → Reports statement, current FY to date ─
  let statement: Awaited<ReturnType<typeof buildReportStatementPdf>> = null;
  if (includeLedger) {
    const p = defaultPeriod(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
    statement = await buildReportStatementPdf(supabase, { kind: "client", name: clientName, clientIds: [clientId], fromDate: p.from, toDate: p.to });
  }
  const ledgerEntries: any[] = statement ? [statement] : [];

  // ── 4. Build attachments conditionally ────────────────────────────────────
  const attachments: { filename: string; content: string }[] = [];

  if (includeInvoice && inv) {
    const invFirm   = await fetchFirmForInvoice(inv);
    const pdfBytes  = await generateInvoicePdf(inv, firmName, clientName, invFirm ?? undefined);
    const safeInvNo = (inv.invoice_no ?? "invoice").replace(/\//g, "-");
    attachments.push({ filename: `Invoice_${safeInvNo}.pdf`, content: uint8ToBase64(pdfBytes) });
  }
  if (statement) {
    attachments.push({ filename: statement.filename, content: uint8ToBase64(statement.bytes) });
  }

  if (!attachments.length)
    return { error: "Nothing to send — no invoice found, and the statement of account has no balance or entries this financial year." };

  // ── 5. Build email ─────────────────────────────────────────────────────────
  const subject = inv
    ? `Invoice ${inv.invoice_no} & Account Statement — ${firmName}`
    : `Account Statement — ${firmName}`;

  const emailHtml = buildInvoiceEmailHtml({
    firmName, clientName,
    invoiceNo:   inv?.invoice_no ?? "",
    amount:      inv ? fmtNum(inv.total_amount ?? inv.amount ?? 0) : "—",
    dueDate:     fmtDate(inv?.due_date),
    invoiceDate: fmtDate(inv?.invoice_date),
    status:      inv?.status ?? "finalized",
    hasLedger:   ledgerEntries.length > 0,
    fyLabel,
  });

  // ── 6. Send — Resend primary, Graph API fallback ───────────────────────────
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from:        `${firmName} <${EMAIL_FROM}>`,
          to:          recipientEmail,
          subject,
          html:        emailHtml,
          attachments,
        }),
      });
      if (!r.ok) {
        const errText = await r.text();
        throw new Error(`Email service error (${r.status}): ${errText.slice(0, 120)}`);
      }
    } else {
      const graphAttachments = attachments.map(a => ({
        "@odata.type": "#microsoft.graph.fileAttachment" as const,
        name:          a.filename,
        contentType:   "application/pdf",
        contentBytes:  a.content,
      }));
      await sendEmailViaGraph(recipientEmail, subject, emailHtml, graphAttachments);
    }
  } catch (sendErr: unknown) {
    const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
    await sendTelegram(chatId, `❌ Failed to send email to ${recipientEmail}.\nReason: ${msg.slice(0, 200)}\n\nPlease check email credentials in Supabase env vars (RESEND_API_KEY or Graph API).`);
    return { error: `Email delivery failed: ${msg.slice(0, 150)}` };
  }

  // ── 7. Post-send: confirm to user, update invoice status, log (all non-fatal) ─
  await sendTelegram(chatId,
    `✅ Email sent to *${recipientEmail}*!\n` +
    `📎 Attachments: ${attachments.map(a => a.filename).join(", ")}`
  );

  // Non-fatal post-send operations
  try {
    if (inv?.status === "finalized") {
      await supabase.from("invoices")
        .update({ status: "sent", sent_at: now.toISOString() })
        .eq("id", inv.id);
    }
    await supabase.from("notification_log").insert({
      recipient_id: clientId,
      channel:      "email",
      type:         "invoice_generated",
      status:       "sent",
      sent_at:      now.toISOString(),
      content: {
        subject,
        to:          recipientEmail,
        invoice_id:  inv?.id ?? null,
        source:      "telegram_bot_v5",
        attachments: attachments.map(a => a.filename),
      },
    });
  } catch (logErr) {
    console.warn("[Bot] sendEmail post-send log error (non-fatal):", logErr);
  }

  return {
    success:     true,
    sent_to:     recipientEmail,
    client_name: clientName,
    invoice_no:  inv?.invoice_no ?? null,
    attachments: attachments.length,
    filenames:   attachments.map(a => a.filename),
  };
}

// ─── getClientDetails ─────────────────────────────────────────────────────────
async function getClientDetails(input: Record<string, any>): Promise<any> {
  if (!input.client_name) return { error: "client_name is required" };

  const { data: clients } = await supabase
    .from("clients")
    .select("*")   // only existing columns — a missing one makes PostgREST return nothing
    .ilike("name", `%${input.client_name}%`)
    .eq("is_draft", false).is("deleted_at", null).limit(3);

  if (!clients?.length) return { error: `Client '${input.client_name}' not found` };

  const client = clients[0];

  // Recent invoice summary for this client
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id,invoice_no,status,amount,total_amount,invoice_date,due_date,paid_at")
    .eq("client_id", client.id)
    .order("invoice_date", { ascending: false })
    .limit(5);

  const today       = new Date();
  // Cancelled (voided) documents are void: never part of billed totals.
  const all         = (invoices ?? []).filter(i => i.status !== "voided");
  const outstanding = all.filter(i => ["finalized", "sent"].includes(i.status ?? ""));
  const overdue     = outstanding.filter(i => i.due_date && new Date(i.due_date) < today);
  const sumAmt      = (arr: any[]) => arr.reduce((s, i) => s + (i.total_amount ?? i.amount ?? 0), 0);

  return {
    id:             client.id,
    name:           client.name,
    email:          client.email,
    phone:          client.mobile ?? client.phone ?? null,
    pan:            client.pan,
    gstin:          client.gstin,
    address:        [client.address, client.city, client.state, client.pincode].filter(Boolean).join(", "),
    contact_person: client.contact_person,
    notes:          client.notes,
    client_since:   client.created_at?.split("T")[0] ?? null,
    invoice_summary: {
      recent:            all.length,
      outstanding_count: outstanding.length,
      outstanding_amount: sumAmt(outstanding),
      overdue_count:     overdue.length,
      overdue_amount:    sumAmt(overdue),
      recent_invoices:   all.map(i => ({
        invoice_no: i.invoice_no, status: i.status,
        amount: i.total_amount ?? i.amount ?? 0,
        date: i.invoice_date, due_date: i.due_date,
      })),
    },
    other_matches: clients.slice(1).map(c => ({ id: c.id, name: c.name })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION CONTEXT — per-user memory in telegram_context table
// ═══════════════════════════════════════════════════════════════════════════════

interface TgContext {
  user_id:           number;
  last_intent:       Intent | null;
  last_client_name:  string | null;
  last_invoice_ids:  string[] | null;
  updated_at:        string;
}

async function loadContext(userId: number): Promise<TgContext | null> {
  try {
    const { data } = await (supabase as any)
      .from("telegram_context")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;  // Table may not exist yet — degrade gracefully
  }
}

async function saveContext(
  userId: number,
  update: Partial<Omit<TgContext, "user_id" | "updated_at">>,
): Promise<void> {
  try {
    await (supabase as any)
      .from("telegram_context")
      .upsert(
        { user_id: userId, ...update, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
  } catch {
    /* non-fatal — context persistence is best-effort */
  }
}

function buildCtxHint(ctx: TgContext | null): string | undefined {
  if (!ctx) return undefined;
  const parts: string[] = [];
  if (ctx.last_client_name) parts.push(`Last client discussed: "${ctx.last_client_name}"`);
  if (ctx.last_invoice_ids?.length)
    parts.push(`Last invoice IDs shown: ${ctx.last_invoice_ids.slice(0, 5).join(", ")}`);
  if (ctx.last_intent?.action) parts.push(`Last action performed: ${ctx.last_intent.action}`);
  return parts.length ? parts.join("; ") : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT PARSER — Claude Haiku with context + two-pass retry
// ═══════════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(ctxHint?: string): string {
  const contextBlock = ctxHint
    ? `\nCONVERSATION CONTEXT (from previous message): ${ctxHint}\nIf user says "same", "wahi", "uske liye", "those", "above", "that client" — fill from context.`
    : "No prior context.";

  return `You are an intelligent billing assistant for an Indian Chartered Accountant firm. Your task is to understand what the user wants — in ANY language or phrasing — and return a structured JSON intent.

CORE PRINCIPLE: Understand the MEANING, not exact words. Users may write in English, Hindi, Hinglish, or a casual mix. Typos, abbreviations, and informal phrasing are all fine — figure out what they mean.

AVAILABLE ACTIONS:
- get_invoice     → user wants to VIEW/LIST invoice details or look up a specific invoice
- get_ledger      → user wants a ledger, khata, account statement, hisaab, passbook for a client
- send_email      → user wants to EMAIL document(s) to someone's email inbox (not receive here)
- send_pdf        → user wants a PDF FILE delivered right here in this chat
- get_outstanding → user wants to see unpaid/pending/baaki invoices
- get_overdue     → user wants invoices past their due date / late payments
- get_summary     → user wants an overview, total, dashboard, report, summary
- get_receipts    → user wants payment receipts, collections, payments received
- help            → user is asking what the bot can do or needs guidance
- unknown         → ONLY use this for messages completely unrelated to billing (cricket scores, weather, jokes, etc.)

HOW TO DISTINGUISH ACTIONS:
- Wants PDF in THIS chat → send_pdf (e.g. "pdf bhejo", "pdf chahiye", "send me pdf", "pdf do", "pdf file", "invoice ka pdf", "give me pdf for 25/2026-27", "invoice in .pdf", ".pdf chahiye")
- Wants EMAIL sent to client → send_email (e.g. "email karo", "mail bhejo", "send to email", "email invoice")
- Wants to SEE invoice data → get_invoice (e.g. "show invoice", "invoice dikhao", "invoice details")
- Wants LEDGER/KHATA → get_ledger (e.g. "ledger do", "khata dikhao", "account statement", "ledger of Gujarat Water", "statement chahiye")
- Context references ("same client", "wahi", "upar wala", "those", "above") → use CONTEXT to fill client_name

EXTRACT THESE FIELDS:
- client_name: any company or person name (null if not mentioned)
- doc_no: invoice/document number pattern like "29/2026-27" or "25/2026-27" (null if not mentioned)
- fy: financial year like "2026-27" or "2025-26" (null if not mentioned)
- document_type: "invoice" or "ledger" (null if unclear)
- email_to: "client" or "group" (for send_email only, else null)
- limit: number of records (default 10)

CONTEXT:
${contextBlock}

Return ONLY this JSON — no explanation, no markdown, no extra text:
{ "action": "...", "client_name": "..." or null, "doc_no": "..." or null, "fy": "..." or null, "document_type": "invoice" or "ledger" or null, "email_to": "client" or null, "limit": 10 }

NEVER return "unknown" for any billing-related query, no matter how casually or informally phrased.`;
}

function normaliseIntent(parsed: any): Intent {
  return {
    action:         parsed.action         ?? "unknown",
    invoice_no:     parsed.doc_no         ?? parsed.invoice_no     ?? null,
    client_name:    parsed.client_name    ?? null,
    financial_year: parsed.fy             ?? parsed.financial_year ?? null,
    email_to:       parsed.email_to       ?? null,
    limit:          parsed.limit          ?? 10,
    ...(parsed.document_type ? { document_type: parsed.document_type } : {}),
  };
}

async function callClaude(systemPrompt: string, userText: string, maxTokens = 300): Promise<any | null> {
  if ((Deno.env.get("CAFLOW_AI_BACKEND") ?? "claude-cli") !== "legacy-api") {
    const reply = await callClaudeCliText(
      systemPrompt,
      `Parse this message:\n"${userText.replace(/"/g, "'")}"\n\nReturn only JSON:`,
      120_000,
      "haiku",
    );
    if (isProviderError(reply)) return null;
    const clean = reply.text.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(clean);
  }
  if (!ANTHROPIC_API_KEY) return null;
  const res = await claudeFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-20250514",
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages: [{
        role:    "user",
        content: `Parse this message:\n"${userText.replace(/"/g, "'")}"\n\nReturn only JSON:`,
      }],
    }),
  });
  if (!res.ok) {
    console.error("[Bot] Claude API error:", res.status);
    return null;
  }
  const data  = await res.json();
  const raw   = (data.content?.[0]?.text ?? "{}").trim();
  const clean = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(clean);
}

async function callClaudeRaw(systemPrompt: string, userText: string, maxTokens = 200): Promise<string | null> {
  if ((Deno.env.get("CAFLOW_AI_BACKEND") ?? "claude-cli") !== "legacy-api") {
    const reply = await callClaudeCliText(systemPrompt, userText, 120_000, "haiku");
    return isProviderError(reply) ? null : reply.text.trim() || null;
  }
  if (!ANTHROPIC_API_KEY) return null;
  const res = await claudeFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-20250514",
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.content?.[0]?.text ?? "").trim() || null;
}

async function parseIntent(text: string, ctxHint?: string): Promise<Intent> {
  if ((Deno.env.get("CAFLOW_AI_BACKEND") ?? "claude-cli") === "legacy-api" && !ANTHROPIC_API_KEY) {
    console.warn("[Bot] ANTHROPIC_API_KEY not set — using keyword fallback");
    return intentFallback(text);
  }

  try {
    // ── Pass 1: primary parse with full context ──────────────────────────────
    const parsed1 = await callClaude(buildSystemPrompt(ctxHint), text, 300);
    if (!parsed1) return intentFallback(text);

    const intent1 = normaliseIntent(parsed1);

    // ── Pass 2: creative retry if pass 1 returned unknown ────────────────────
    if (intent1.action === "unknown") {
      console.log("[Bot] Pass 1 unknown — retrying with creative prompt");
      try {
        const creativeSystem = `You are a billing chatbot. The user's message is unclear. Make your BEST GUESS at what billing action they want.${ctxHint ? ` Context: ${ctxHint}` : ""}
NEVER return "unknown" — always pick the closest billing action.
Actions: get_invoice, get_ledger, send_email, get_outstanding, get_overdue, get_summary, get_receipts, help.
Return ONLY JSON: { "action": "...", "client_name": "..." or null, "document_type": "invoice" or "ledger", "email_to": "client" }`;
        const parsed2 = await callClaude(creativeSystem, text, 200);
        if (parsed2 && parsed2.action && parsed2.action !== "unknown") {
          console.log("[Bot] Pass 2 resolved to:", parsed2.action);
          return normaliseIntent(parsed2);
        }
      } catch {
        /* fall through to intentFallback */
      }
      // Both passes failed → helpful fallback (NOT bare "unknown")
      return intentFallback(text);
    }

    return intent1;
  } catch (err) {
    console.error("[Bot] Intent parse error:", err);
    return intentFallback(text);
  }
}

/** Fallback when Claude API is unavailable */
function intentFallback(_text: string): Intent {
  return { action: "help" };
}

// ─── send_pdf ─────────────────────────────────────────────────────────────────
// Generates invoice PDFs and sends them as Telegram documents (file attachments)
// ─── sendTelegramDocumentBytes — sends PDF via multipart (no Storage needed) ──
// Uses raw bytes + FormData so Telegram receives the file directly.
// This works regardless of whether any Supabase Storage bucket exists or is public.
async function sendTelegramDocumentBytes(
  chatId: number,
  pdfBytes: Uint8Array,
  fileName: string,
  caption: string,
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append(
    "document",
    new Blob([pdfBytes], { type: "application/pdf" }),
    fileName,
  );
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`sendDocument failed (${res.status}): ${err.slice(0, 200)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF GENERATION — pdf-lib (runs in Deno)
// ═══════════════════════════════════════════════════════════════════════════════

/** Convert Uint8Array → base64 string (chunked to avoid call-stack overflow) */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Fetch firm details for PDF generation */
async function fetchFirmForInvoice(invoice: any): Promise<any> {
  const firmId = invoice?.firm_id ?? null;
  if (!firmId) return null;
  const { data } = await supabase.from("firms")
    .select("*")   // firms has no city / registration_no columns; "*" keeps the lookup working
    .eq("id", firmId).maybeSingle();
  return data ?? null;
}

/**
 * CAFlow-standard Tax Invoice PDF — matches portal invoice format.
 * Includes: firm GSTIN/PAN/address, From/To sections, SAC codes,
 * GST breakup (CGST+SGST or IGST), bank details, CAFlow footer.
 */
// ── PDF helpers ───────────────────────────────────────────────────────────────

/** Format a number with 2 decimal places in Indian locale (e.g. 25,000.00) */
function fmtAmt(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format date as DD/MM/YYYY to match app invoice format */
function fmtDateDMY(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    const dd   = String(dt.getDate()).padStart(2, "0");
    const mm   = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch { return d ?? "—"; }
}

/** Wrap a string into lines of ≤ maxChars characters on word boundaries */
function wrapText(text: string, maxChars: number): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length <= maxChars) { cur = candidate; }
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Convert a rupee amount to English words (Indian system) */
function numberToWords(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
                "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
                "Seventeen", "Eighteen", "Nineteen"];
  const tensW = ["", "", "Twenty", "Thirty", "Forty", "Fifty",
                 "Sixty", "Seventy", "Eighty", "Ninety"];
  function cvt(n: number): string {
    if (n === 0) return "";
    if (n < 20)  return ones[n] + " ";
    if (n < 100) return tensW[Math.floor(n / 10)] + " " + (n % 10 ? ones[n % 10] + " " : "");
    return ones[Math.floor(n / 100)] + " Hundred " + cvt(n % 100);
  }
  const rounded = Math.round(amount);
  if (rounded === 0) return "Zero";
  let result = "";
  let num = rounded;
  if (num >= 10000000) { result += cvt(Math.floor(num / 10000000)) + "Crore "; num %= 10000000; }
  if (num >= 100000)   { result += cvt(Math.floor(num / 100000))   + "Lakh ";  num %= 100000;   }
  if (num >= 1000)     { result += cvt(Math.floor(num / 1000))     + "Thousand "; num %= 1000;  }
  result += cvt(num);
  return result.trim().replace(/\s{2,}/g, " ");
}

// ─── buildInvoiceHtml — ported verbatim from src/lib/invoicePdfGenerator.ts ──
// (Pure TypeScript, no browser APIs — same HTML the billing module renders)

const DOC_HEADINGS_MAP: Record<string, string> = {
  invoice:     "TAX INVOICE",
  credit_note: "CREDIT NOTE",
  quotation:   "QUOTATION",
  proforma:    "PROFORMA INVOICE",
};

const fmtINR = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function normAddrSegs(addr: string): string[] {
  return addr
    .replace(/<br\s*\/?/gi, ",").replace(/[\n\r]+/g, ",")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .filter((s, i, a) => i === 0 || s.toLowerCase() !== a[i - 1].toLowerCase());
}

function fmtFirmAddrHtml(address: string): string {
  const segs = normAddrSegs(address);
  if (!segs.length) return "";
  let lines: string[];
  if (segs.length >= 5) {
    lines = [
      segs.slice(0, 2).join(", "),
      segs.slice(2, 4).join(", "),
      segs.slice(4).join(", "),
    ].filter(Boolean);
  } else {
    lines = [segs.join(", ")];
  }
  return lines
    .map((ln, i) => {
      const clean = escHtml(ln.replace(/\s+,/g, ",").replace(/,{2,}/g, ",").trim());
      const suf = i < lines.length - 1 && !clean.endsWith(",") ? "," : "";
      return `<span>${clean}${suf}</span>`;
    })
    .join("<br/>");
}

function numToWords(num: number): string {
  if (num === 0) return "Zero Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const scales = ["", "Thousand", "Lakh", "Crore"];
  function cvtGroup(n: number): string {
    if (n === 0) return "";
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + cvtGroup(n % 100) : "");
  }
  const groups: number[] = [];
  let tmp = num;
  groups.push(tmp % 1000); tmp = Math.floor(tmp / 1000);
  while (tmp > 0) { groups.push(tmp % 100); tmp = Math.floor(tmp / 100); }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] > 0) parts.push(cvtGroup(groups[i]) + (scales[i] ? " " + scales[i] : ""));
  }
  return (parts.join(" ") + " Only").replace(/\s+/g, " ").trim();
}

function buildInvoiceHtml(inv: any): string {
  const docType   = inv.document_type || "invoice";
  const heading   = DOC_HEADINGS_MAP[docType] || "TAX INVOICE";
  const firmName  = inv.from_firm_name || "Firm";
  const firmGstin = inv.from_gstin     || "";
  const firmPan   = inv.from_pan       || "";
  const firmAddr  = inv.from_address   || "";
  const firmEmail = inv.from_email     || "";
  const firmPhone = inv.from_phone     || "";
  const toName    = inv.to_name        || "";
  const toGstin   = inv.to_gstin       || "";
  const toAddress = inv.to_address     || "";
  const invoiceNo = inv.invoice_no     || "";
  const invoiceDate = inv.invoice_date;
  const referenceNo = inv.reference_no || "";
  const isIntraState = inv.is_intra_state !== false;
  const remarksConditions = inv.remarks_conditions || "";
  const bankDetails = inv.bank_details_snapshot || {};
  const firmAddressHtml = fmtFirmAddrHtml(firmAddr);
  const items: any[] = Array.isArray(inv.line_items) ? inv.line_items : [];
  const hasGst = !!firmGstin;

  const totalTaxable = inv.subtotal || inv.amount ||
    items.reduce((s: number, li: any) => s + (li.taxable_value || li.rate || 0), 0);
  const totalGst   = inv.gst_amount   || 0;
  const grandTotal = inv.total_amount || totalTaxable + totalGst;

  const thGst = hasGst
    ? `<th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">GST %</th>`
    : "";

  const identityMarkup =
    `<p style="font-weight:800;font-size:14px;margin:0 0 2px">${firmName.toUpperCase()}</p>`;

  const itemRows = items.map((item: any, i: number) => {
    const gstCol = hasGst
      ? `<td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${item.gst_percent || 0}%</td>`
      : "";
    const itemTotal = hasGst
      ? (item.total || item.taxable_value || 0)
      : (item.taxable_value || item.rate || 0);
    return `<tr>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${i + 1}.</td>
      <td style="border:1px solid #bbb;padding:0;vertical-align:middle;font-size:11px">
        <div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;min-height:38px;padding:8px;line-height:1.4">
          <div>${item.description || ""}</div>
          ${item.description_details ? `<div style="font-size:10px;color:#555;white-space:pre-line">${item.description_details}</div>` : ""}
        </div>
      </td>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:center;vertical-align:middle;font-size:11px">${item.hsn_sac_code || ""}</td>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">${Number(item.quantity || 1).toFixed(2)}</td>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">${fmtINR(item.rate || 0)}</td>
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px">${fmtINR(item.taxable_value || 0)}</td>
      ${gstCol}
      <td style="border:1px solid #bbb;padding:6px 8px;text-align:right;vertical-align:middle;font-size:11px;font-weight:600">${fmtINR(itemTotal)}</td>
    </tr>`;
  }).join("");

  const colSpan = hasGst ? 5 : 4;
  const totalRow = `<tr style="background:#f0f0f0;font-weight:700">
    <td style="border:1px solid #bbb;padding:8px;vertical-align:middle" colspan="${colSpan}">Total</td>
    <td style="border:1px solid #bbb;padding:8px;text-align:right;vertical-align:middle;font-size:11px">${fmtINR(totalTaxable)}</td>
    ${hasGst ? `<td style="border:1px solid #bbb;padding:8px;vertical-align:middle"></td>` : ""}
    <td style="border:1px solid #bbb;padding:8px;text-align:right;vertical-align:middle;font-size:12px">${fmtINR(grandTotal)}</td>
  </tr>`;

  const halfGst = totalGst / 2;
  let totalsSummary = `<tr><td style="padding:3px 8px;vertical-align:middle">Taxable Amount</td><td style="padding:3px 8px;text-align:right;font-weight:600;vertical-align:middle">&#8377;${fmtINR(totalTaxable)}</td></tr>`;
  if (hasGst) {
    if (isIntraState) {
      totalsSummary += `
        <tr><td style="padding:3px 8px;vertical-align:middle">CGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">&#8377;${fmtINR(halfGst)}</td></tr>
        <tr><td style="padding:3px 8px;vertical-align:middle">SGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">&#8377;${fmtINR(halfGst)}</td></tr>`;
    } else {
      totalsSummary += `<tr><td style="padding:3px 8px;vertical-align:middle">IGST</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">&#8377;${fmtINR(totalGst)}</td></tr>`;
    }
    const roundOffVal = Math.round(grandTotal) - grandTotal;
    const roundOffStr = (roundOffVal >= 0 ? "+" : "") + "&#8377;" + roundOffVal.toFixed(2);
    totalsSummary += `<tr><td style="padding:3px 8px;vertical-align:middle">Round Off</td><td style="padding:3px 8px;text-align:right;vertical-align:middle">${roundOffStr}</td></tr>`;
  }
  totalsSummary += `<tr style="font-weight:700;font-size:13px;border-top:2px solid #333"><td style="padding:6px 8px;vertical-align:middle">Grand Total</td><td style="padding:6px 8px;text-align:right;vertical-align:middle">&#8377;${Math.round(grandTotal).toLocaleString("en-IN")}</td></tr>`;

  const docLabel = heading === "TAX INVOICE"
    ? "Invoice"
    : heading.charAt(0) + heading.slice(1).toLowerCase();

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${heading} ${invoiceNo}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; font-size: 12px; background: #ffffff; }
      table { width: 100%; border-collapse: collapse; }
      td, th { vertical-align: middle !important; }
      @page { size: A4; margin: 20mm 15mm 20mm 15mm; }
      body { padding: 10mm 12mm; }
    </style></head><body>
      <div style="border:1px solid #bbb;padding:12px 14px">

    <div style="text-align:center;margin-bottom:16px;padding:6px 0;line-height:1.2">
      <h1 style="font-size:20px;font-weight:700;color:#8B4513;letter-spacing:1.5px;margin:0;padding:0;display:inline">${heading}</h1>
    </div>

    <div style="display:flex;justify-content:space-between;margin-bottom:14px">
      <div style="flex:1;max-width:55%">
        ${identityMarkup}
        ${firmAddressHtml ? `<p style="margin:1px 0;font-size:11px;line-height:1.5;max-width:340px">${firmAddressHtml}</p>` : ""}
      </div>
      <div style="text-align:right;font-size:11px;min-width:280px">
        <div style="display:flex;justify-content:space-between;gap:20px">
          <div style="text-align:left">
            ${firmGstin ? `<p style="margin:2px 0"><strong>GSTIN:</strong> ${firmGstin}</p>` : ""}
            ${firmPan   ? `<p style="margin:2px 0"><strong>PAN:</strong> ${firmPan}</p>`     : ""}
            ${firmEmail ? `<p style="margin:2px 0"><strong>Email:</strong> ${firmEmail}</p>` : ""}
            ${firmPhone ? `<p style="margin:2px 0"><strong>Contact No:</strong> ${firmPhone}</p>` : ""}
          </div>
          <div style="text-align:right">
            <p style="margin:2px 0"><strong>${docLabel} Date:</strong> ${invoiceDate ? fmtDateDMY(invoiceDate) : "&#8212;"}</p>
            <p style="margin:2px 0"><strong>${docLabel} No:</strong> ${invoiceNo}</p>
            ${referenceNo ? `<p style="margin:2px 0"><strong>Ref No:</strong> ${referenceNo}</p>` : ""}
          </div>
        </div>
      </div>
    </div>

    <div style="border:1px solid #bbb;margin-bottom:12px;padding:10px">
      <p style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;margin:0 0 4px">Bill To</p>
      <p style="font-weight:600;margin:0;font-size:13px">${toName}</p>
      ${toAddress ? `<p style="margin:2px 0;font-size:11px">${toAddress}</p>` : ""}
      ${toGstin   ? `<p style="margin:4px 0;font-size:11px"><strong>GSTIN:</strong> ${toGstin}</p>` : ""}
    </div>

    <table>
      <thead>
        <tr style="background:#e2e8f0">
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;width:30px;vertical-align:middle">#</th>
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;text-align:left;vertical-align:middle">Item</th>
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">HSN/SAC</th>
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Quantity</th>
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Rate / Item (&#8377;)</th>
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Taxable Value (&#8377;)</th>
          ${thGst}
          <th style="border:1px solid #bbb;padding:7px;font-size:10px;vertical-align:middle">Total (&#8377;)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        ${totalRow}
      </tbody>
    </table>

    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <table style="width:320px;font-size:12px">${totalsSummary}</table>
    </div>

    <div style="margin:8px 0;padding:6px 8px;background:#f9f9f9;border:1px solid #ddd;font-size:11px">
      <strong>Amount in words:</strong> ${numToWords(Math.round(grandTotal))}
    </div>

    ${remarksConditions ? `<div style="margin:8px 0;padding:6px 8px;font-size:11px;border:1px solid #ddd">
      <strong>Remarks / Terms &amp; Conditions:</strong><br/>
      <span style="white-space:pre-line;word-wrap:break-word">${remarksConditions}</span>
    </div>` : ""}

    <div style="display:flex;justify-content:space-between;margin-top:16px">
      <div style="border:1px solid #bbb;padding:10px;font-size:11px;min-width:300px">
        <p style="font-weight:700;margin:0 0 4px;font-size:12px">Bank Details:</p>
        ${bankDetails?.account_number || bankDetails?.account_no
          ? `<p style="margin:2px 0"><strong>Account No:</strong> ${bankDetails.account_number || bankDetails.account_no}</p>`
          : ""}
        ${bankDetails?.ifsc      ? `<p style="margin:2px 0"><strong>IFSC:</strong> ${bankDetails.ifsc}</p>`         : ""}
        ${bankDetails?.bank_name ? `<p style="margin:2px 0"><strong>Bank:</strong> ${bankDetails.bank_name}</p>`    : ""}
        ${bankDetails?.branch    ? `<p style="margin:2px 0"><strong>Branch:</strong> ${bankDetails.branch}</p>`     : ""}
      </div>
      <div style="text-align:right;padding-top:8px">
        <p style="margin:0;font-size:12px;font-weight:600">For ${firmName.toUpperCase()}</p>
        <div style="height:50px"></div>
        <p style="margin:0;font-size:11px;border-top:1px solid #333;padding-top:4px">Authorised Signatory</p>
      </div>
    </div>

    <div style="margin-top:16px;padding-top:8px;padding-bottom:10px;border-top:1px solid #ddd;font-size:10px;color:#555">
      <p style="font-weight:700;margin:0 0 4px">Terms &amp; Conditions:</p>
      <p style="margin:0;font-weight:700;letter-spacing:0.5px">PAYMENT TERMS: PAYMENT IS DUE WITHIN 45 DAYS FROM THE INVOICE DATE</p>
    </div>

    </div>
  </body></html>`;
}

/**
 * Convert HTML string → PDF bytes.
 *
 * Uses Gotenberg (open-source Chrome-based PDF service) via multipart/form-data.
 * Default endpoint: https://demo.gotenberg.dev  (free public demo — low volume)
 * Override with env var GOTENBERG_URL for self-hosted / production instance.
 */
async function htmlToPdfBytes(html: string): Promise<Uint8Array> {
  const base = (Deno.env.get("GOTENBERG_URL") ?? "https://demo.gotenberg.dev")
    .replace(/\/$/, "");
  const endpoint = `${base}/forms/chromium/convert/html`;

  // Gotenberg expects multipart/form-data with the HTML as a file named "index.html"
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");

  // Optional page properties
  form.append("paperWidth",   "8.27");   // A4 width in inches
  form.append("paperHeight",  "11.69");  // A4 height in inches
  form.append("marginTop",    "0.79");   // 20 mm
  form.append("marginBottom", "0.79");
  form.append("marginLeft",   "0.59");   // 15 mm
  form.append("marginRight",  "0.59");
  form.append("printBackground", "true");

  const resp = await fetch(endpoint, { method: "POST", body: form });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Gotenberg PDF error ${resp.status}: ${errText.slice(0, 200)}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

// ─── generateInvoicePdf — now uses buildInvoiceHtml + htmlToPdfBytes ──────────
async function generateInvoicePdf(
  invoice: any,
  firmName: string,
  clientName: string,
  firm?: any,
): Promise<Uint8Array> {
  // Merge firm DB record into the invoice's from_* fields so buildInvoiceHtml
  // picks up GSTIN/PAN/address even when the invoice row itself lacks them.
  const inv = {
    ...invoice,
    from_firm_name: invoice.from_firm_name || firmName,
    from_gstin:     invoice.from_gstin  || firm?.gstin  || "",
    from_pan:       invoice.from_pan    || firm?.pan     || "",
    from_address:   invoice.from_address ||
      [firm?.address, firm?.city, firm?.state, firm?.pincode ? `- ${firm.pincode}` : ""]
        .filter(Boolean).join(", "),
    from_email:     invoice.from_email  || firm?.email   || "",
    from_phone:     invoice.from_phone  || firm?.phone   || "",
  };

  const html = buildInvoiceHtml(inv);
  return htmlToPdfBytes(html);
}

/** Ledger statement PDF — firm header, entry rows with running balance */
async function generateLedgerPdf(
  clientName: string,
  firmName: string,
  entries: any[],
  fyLabel: string,
): Promise<Uint8Array> {
  const pdfDoc   = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595, H = 842, M = 40, ROW = 14;
  const DARK = rgb(0.1, 0.22, 0.36);

  let page    = pdfDoc.addPage([W, H]);
  let y       = H - M;
  let pageNum = 1;

  // Column x positions
  const cDate = M, cNar = M + 65, cDr = M + 335, cCr = M + 400, cBal = M + 465;

  function drawColumnHeaders(pg: ReturnType<typeof pdfDoc.addPage>, topY: number) {
    pg.drawRectangle({ x: M, y: topY - 2, width: W - 2 * M, height: 15, color: rgb(0.92, 0.95, 1) });
    pg.drawText("Date",      { x: cDate, y: topY + 2, font: fontBold, size: 8 });
    pg.drawText("Narration", { x: cNar,  y: topY + 2, font: fontBold, size: 8 });
    pg.drawText("Debit",     { x: cDr,   y: topY + 2, font: fontBold, size: 8 });
    pg.drawText("Credit",    { x: cCr,   y: topY + 2, font: fontBold, size: 8 });
    pg.drawText("Balance",   { x: cBal,  y: topY + 2, font: fontBold, size: 8 });
  }

  // ── Header (first page) ──
  page.drawRectangle({ x: 0, y: H - 66, width: W, height: 66, color: DARK });
  page.drawText(firmName.slice(0, 50),
    { x: M, y: H - 34, font: fontBold, size: 15, color: rgb(1, 1, 1) });
  page.drawText("Account Statement",
    { x: W - M - 110, y: H - 34, font: fontBold, size: 12, color: rgb(1, 1, 1) });
  page.drawText("Chartered Accountants",
    { x: M, y: H - 52, font, size: 9, color: rgb(0.75, 0.82, 0.9) });
  y = H - 82;

  page.drawText(`Client: ${clientName}`, { x: M, y, font: fontBold, size: 10 });
  page.drawText(`FY ${fyLabel}  |  ${entries.length} transactions`,
    { x: M + 270, y, font, size: 9, color: rgb(0.4, 0.4, 0.4) });
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: DARK });
  y -= 14;

  drawColumnHeaders(page, y);
  y -= 18;

  // ── Data rows ──
  let running = 0;
  for (const e of entries) {
    if (y < M + 30) {
      pageNum++;
      page = pdfDoc.addPage([W, H]);
      // Continuation header
      page.drawText(`${firmName} — ${clientName} — FY ${fyLabel} (continued, page ${pageNum})`,
        { x: M, y: H - 22, font, size: 7, color: rgb(0.55, 0.55, 0.55) });
      y = H - 40;
      drawColumnHeaders(page, y);
      y -= 18;
    }

    const dr = Number(e.debit_amount ?? 0);
    const cr = Number(e.credit_amount ?? 0);
    running += dr - cr;
    const balStr = `${fmtNum(Math.abs(running))} ${running >= 0 ? "Dr" : "Cr"}`;
    const nar    = String(e.narration ?? e.entry_type ?? "").slice(0, 44);

    page.drawText(fmtDate(e.entry_date),  { x: cDate, y, font, size: 8 });
    page.drawText(nar,                    { x: cNar,  y, font, size: 8 });
    if (dr > 0) page.drawText(fmtNum(dr), { x: cDr,   y, font, size: 8 });
    if (cr > 0) page.drawText(fmtNum(cr), { x: cCr,   y, font, size: 8 });
    page.drawText(balStr,                 { x: cBal,  y, font, size: 8 });
    y -= ROW;
  }

  // ── Closing balance ──
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5 });
  y -= 14;
  const closingDir = running >= 0 ? "Dr" : "Cr";
  page.drawText(`Closing Balance: Rs.${fmtNum(Math.abs(running))} ${closingDir}`,
    { x: cBal - 100, y, font: fontBold, size: 9, color: DARK });

  page.drawText("Generated by CAFlow Practice Management System",
    { x: M, y: 28, font, size: 7, color: rgb(0.6, 0.6, 0.6) });

  return pdfDoc.save();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL — Microsoft Graph API
// ═══════════════════════════════════════════════════════════════════════════════
async function getGraphToken(): Promise<string> {
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET)
    throw new Error("Graph API credentials not configured");

  const res = await fetch(
    `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     GRAPH_CLIENT_ID,
        client_secret: GRAPH_CLIENT_SECRET,
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description ?? "Failed to get Graph token");
  return data.access_token;
}

type GraphAttachment = {
  "@odata.type": "#microsoft.graph.fileAttachment";
  name: string;
  contentType: string;
  contentBytes: string;
};

async function sendEmailViaGraph(
  to: string,
  subject: string,
  html: string,
  attachments: GraphAttachment[] = [],
): Promise<void> {
  const token = await getGraphToken();
  const message: Record<string, unknown> = {
    subject,
    body:         { contentType: "HTML", content: html },
    toRecipients: [{ emailAddress: { address: to } }],
    from:         { emailAddress: { address: EMAIL_FROM, name: FIRM_DISPLAY_NAME } },
  };
  if (attachments.length > 0) message.attachments = attachments;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${EMAIL_FROM}/sendMail`,
    {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: true }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph sendMail failed (${res.status}): ${err.slice(0, 200)}`);
  }
}

function buildInvoiceEmailHtml(d: {
  firmName: string; clientName: string; invoiceNo: string;
  amount: string; dueDate: string; invoiceDate: string; status: string;
  hasLedger?: boolean; fyLabel?: string;
}): string {
  const ledgerNote = d.hasLedger
    ? `<p style="margin:0 0 16px;font-size:14px;color:#374151;">
        We have also attached your <strong>Account Statement for FY ${d.fyLabel ?? ""}</strong>
        for your records.
       </p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Invoice ${d.invoiceNo}</title></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f4f8">
<tr><td align="center" style="padding:24px 16px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
  <tr><td style="background:#1a3a5c;border-radius:8px 8px 0 0;padding:28px 32px;">
    <div style="font-size:22px;font-weight:800;color:#fff;">${d.firmName}</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px;">Chartered Accountants</div>
  </td></tr>
  <tr><td style="background:#1a3a5c;height:4px;"></td></tr>
  <tr><td style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;">
    <p style="margin:0 0 16px;font-size:15px;color:#111827;">Dear ${d.clientName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">
      Please find <strong>attached</strong> your invoice from ${d.firmName}:
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 24px;">
      <tr style="background:#f8fafc;"><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:40%;">Invoice Number</td><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#111827;">${d.invoiceNo}</td></tr>
      <tr><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;">Invoice Date</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#111827;">${d.invoiceDate}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;">Amount</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:14px;font-weight:700;color:#1a3a5c;">Rs.${d.amount}</td></tr>
      <tr><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;">Due Date</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;font-weight:600;color:#dc2626;">${d.dueDate}</td></tr>
    </table>
    ${ledgerNote}
    <p style="margin:0 0 8px;font-size:14px;color:#374151;">Please ensure payment is made by the due date to avoid any late charges.</p>
    <p style="margin:20px 0 0;font-size:14px;color:#374151;">Warm regards,<br><strong style="color:#111827;">${d.firmName}</strong><br><span style="font-size:12px;color:#6b7280;">Chartered Accountants</span></p>
  </td></tr>
  <tr><td style="background:#1a3a5c;border-radius:0 0 8px 8px;padding:16px 32px;text-align:center;">
    <p style="margin:0;color:rgba(255,255,255,0.7);font-size:11px;">Sent via CAFlow Practice Management System</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TELEGRAM API
// ═══════════════════════════════════════════════════════════════════════════════
async function sendMsg(chatId: number, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id:                  chatId,
    text,
    parse_mode:               "MarkdownV2",
    disable_web_page_preview: true,
  });

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[Bot] sendMessage failed:", err.slice(0, 300));

    // If MarkdownV2 parse error, retry as plain text
    if (err.includes("parse entities") || err.includes("Bad Request")) {
      const plain = text.replace(/[*_`\[\]()~>#+\-=|{}.!\\]/g, "");
      await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: plain }),
      });
    }
  }
}

// ─── sendTelegram — plain Markdown or plain text (no MarkdownV2 escaping) ─────
async function sendTelegram(chatId: number, text: string, parseMode: string | null = null): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[Bot] sendTelegram failed:", err.slice(0, 200));
  }
}

// ─── sendDocument — sends a file/PDF via URL ───────────────────────────────────
async function sendDocument(chatId: number, fileUrl: string, fileName: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, document: fileUrl, caption: fileName }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[Bot] sendDocument failed:", err.slice(0, 200));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPABASE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchClientNames(ids: (string | null)[]): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))] as string[];
  if (!uniqueIds.length) return {};
  const { data } = await supabase.from("clients").select("id,name").in("id", uniqueIds);
  const map: Record<string, string> = {};
  data?.forEach(c => { map[c.id] = c.name ?? "Unknown"; });
  return map;
}

async function fetchClientNamesWithEmail(
  ids: (string | null)[]
): Promise<Record<string, { name: string; email: string | null }>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))] as string[];
  if (!uniqueIds.length) return {};
  const { data } = await supabase.from("clients").select("id,name,email").in("id", uniqueIds);
  const map: Record<string, { name: string; email: string | null }> = {};
  data?.forEach(c => { map[c.id] = { name: c.name ?? "Unknown", email: c.email ?? null }; });
  return map;
}

async function searchClientIds(name: string): Promise<string[]> {
  const { data } = await supabase
    .from("clients")
    .select("id")
    .ilike("name", `%${name}%`)
    .eq("is_draft", false)
    .is("deleted_at", null)
    .limit(5);
  return data?.map(c => c.id) ?? [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Escape all MarkdownV2 special chars */
function escMd(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return d; }
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function statusIcon(s: string | null): string {
  switch (s) {
    case "paid":      return "✅";
    case "sent":      return "✉️";
    case "finalized": return "📋";
    case "draft":     return "📝";
    case "voided":    return "❌";
    default:          return "📄";
  }
}

function docTypeLabel(t: string | null): string {
  switch (t) {
    case "invoice":     return "Invoice";
    case "quotation":   return "Quotation";
    case "proforma":    return "Proforma Invoice";
    case "credit_note": return "Credit Note";
    default:            return "Document";
  }
}

function isOverdue(inv: { status: string | null; due_date: string | null }): boolean {
  if (!inv.due_date || inv.status === "paid" || inv.status === "voided") return false;
  return new Date(inv.due_date) < new Date();
}

function daysDiff(date: string | null | undefined): number {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
}

function sum(items: Array<{ amount?: number | null; total_amount?: number | null }>): number {
  return items.reduce((s, i) => s + (i.total_amount ?? i.amount ?? 0), 0);
}

function getFY(d: Date): string {
  const m = d.getMonth(); // 0=Jan, 3=Apr
  const y = d.getFullYear();
  return m >= 3 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}
