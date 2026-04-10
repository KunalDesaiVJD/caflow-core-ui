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

// ─── Environment ──────────────────────────────────────────────────────────────
const BOT_TOKEN           = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL        = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY   = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GRAPH_TENANT_ID     = Deno.env.get("GRAPH_TENANT_ID");
const GRAPH_CLIENT_ID     = Deno.env.get("GRAPH_CLIENT_ID");
const GRAPH_CLIENT_SECRET = Deno.env.get("GRAPH_CLIENT_SECRET");
const EMAIL_FROM          = "accounts@vjdesai.com";
const FIRM_DISPLAY_NAME   = "V J Desai & Co.";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

// ─── Main Serve ───────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Health check
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, bot: "CAFlow Telegram Billing Bot" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response("ok"); }

  const message: TgMessage = body.message || body.edited_message;
  if (!message?.text) return new Response("ok");

  const chatId = message.chat.id;
  const userId = message.from.id;    // kept for logging only, not for auth
  const text   = message.text.trim();

  console.log(`[Bot] Message from ${message.from.first_name ?? "?"} (${userId}): ${text.slice(0, 80)}`);

  try {
    // ── /start command — clean welcome, no auth check ─────────────
    if (text === "/start" || text.startsWith("/start ")) {
      await sendTelegram(chatId,
        `Welcome to CAFlow Billing Agent! 🤖\n\n` +
        `I can help you with:\n` +
        `📄 Invoices — 'Show invoices for [client name]'\n` +
        `📒 Ledger — 'Ledger of [client name]'\n` +
        `📧 Email — 'Email invoice to [client name]'\n` +
        `📎 PDF — 'Send me PDF of invoice 29/2026-27'\n\n` +
        `Just type naturally — I understand!\n` +
        `Type /help for more examples.`
      );
      return new Response("ok");
    }

    // ── /help command directly ────────────────────────────────────
    if (text === "/help") {
      await handleHelp(chatId);
      return new Response("ok");
    }

    // ── Load per-user conversation context ────────────────────────
    const ctx     = await loadContext(userId);
    const ctxHint = buildCtxHint(ctx);

    // ── Parse intent with AI — fully open-ended NLU ───────────────
    // Claude understands any language/phrasing; no pre-checks needed
    const intent = await parseIntent(text, ctxHint);
    console.log(`[Bot] Intent:`, JSON.stringify(intent));

    switch (intent.action) {
      case "get_invoice":    await handleGetInvoice(chatId, intent, userId); break;
      case "get_ledger":     await handleGetLedger(chatId, intent); break;
      case "get_outstanding":await handleOutstanding(chatId, intent.limit ?? 10); break;
      case "get_overdue":    await handleOverdue(chatId, intent.limit ?? 10); break;
      case "get_summary":    await handleSummary(chatId); break;
      case "send_email":     await handleSendEmail(chatId, intent); break;
      case "send_pdf":       await handleSendPdf(chatId, intent, ctx); break;
      case "get_receipts":   await handleReceipts(chatId, intent.limit ?? 10); break;
      case "help":           await handleHelp(chatId); break;
      default:
        // Should rarely reach here since intentFallback returns "help" as last resort
        await handleHelp(chatId);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bot] Unhandled error:", msg);
    await sendMsg(chatId, `❌ An error occurred\\. Please try again\\.\n_Error: ${escMd(msg.slice(0, 100))}_`);
  }

  return new Response("ok");
});

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── /start ───────────────────────────────────────────────────────────────────
async function handleStart(chatId: number, text: string, telegramUserId: number, from: TgFrom) {
  const token = text.replace("/start", "").trim();

  if (token.startsWith("link_")) {
    // Validate link token
    const linkCode = token.slice(5); // remove "link_" prefix
    const { data: linkRow } = await supabase
      .from("telegram_link_tokens")
      .select("*")
      .eq("token", linkCode)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (!linkRow) {
      await sendMsg(chatId,
        "❌ *Invalid or Expired Token*\n\n" +
        "This link has expired or was already used\\.\n" +
        "Please generate a new link token from CAFlow Settings\\."
      );
      return;
    }

    // Link this Telegram account to the firm
    const { error } = await supabase
      .from("telegram_authorized_users")
      .upsert({
        telegram_user_id:    telegramUserId,
        telegram_chat_id:    chatId,
        telegram_username:   from.username ?? null,
        telegram_first_name: from.first_name ?? null,
        firm_id:             linkRow.firm_id,
        user_id:             linkRow.user_id,
        is_active:           true,
        linked_at:           new Date().toISOString(),
        last_used_at:        new Date().toISOString(),
      }, { onConflict: "telegram_user_id" });

    if (error) {
      console.error("[Bot] Link upsert error:", error);
      await sendMsg(chatId, "❌ Failed to link account\\. Please try again\\.");
      return;
    }

    // Mark token as used
    await supabase
      .from("telegram_link_tokens")
      .update({ used: true })
      .eq("id", linkRow.id);

    await sendMsg(chatId,
      "✅ *Account Linked Successfully\\!*\n\n" +
      `Welcome, *${escMd(from.first_name ?? "User")}*\\!\n\n` +
      "Your Telegram is now connected to CAFlow\\.\n\n" +
      "Type /help to see what I can do for you\\."
    );
    return;
  }

  // Generic welcome — not yet linked
  await sendMsg(chatId,
    `👋 *Welcome to ${escMd(FIRM_DISPLAY_NAME)} Billing Bot\\!*\n\n` +
    "I can help you with:\n" +
    "📋 Invoice queries \\& status\n" +
    "📒 Client ledger statements\n" +
    "📊 Billing summary \\& reports\n" +
    "💰 Payment receipts\n" +
    "📧 Send invoices via email\n\n" +
    "━━━━━━━━━━━━━\n" +
    `🔑 *Your Telegram ID:* \`${telegramUserId}\`\n\n` +
    "Share this ID with your firm admin to get access\\.\n\n" +
    "Type /help for the full command list\\."
  );
}

// ─── /help ────────────────────────────────────────────────────────────────────
async function handleHelp(chatId: number) {
  const msg =
    `🤖 *CAFlow Billing Agent*\n\n` +
    `Here is what I can do:\n\n` +
    `📄 *Invoices*\n` +
    `• 'Show invoices for Gujarat Water Supply'\n` +
    `• 'Get invoice 29/2026-27'\n` +
    `• 'All invoices from April 2026'\n\n` +
    `📒 *Ledger*\n` +
    `• 'Ledger of Accurate PMS'\n` +
    `• 'Show ledger for FY 2026-27'\n\n` +
    `📧 *Email*\n` +
    `• 'Email latest invoice to Gujarat Water'\n` +
    `• 'Send ledger to Accurate PMS client'\n\n` +
    `Just type naturally — I understand!`;
  await sendTelegram(chatId, msg, "Markdown");
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

// ─── /ledger <client> ─────────────────────────────────────────────────────────
async function handleGetLedger(chatId: number, intent: Intent) {
  if (!intent.client_name) {
    await sendTelegram(chatId,
      "❌ Please specify a client name.\nExample: `/ledger Gujarat Water`\nOr: \"ledger statement for NIRALI\""
    );
    return;
  }

  // No firm filter — all firms treated as one unit
  const { data: clients } = await supabase
    .from("clients")
    .select("id,name,email")
    .ilike("name", `%${intent.client_name}%`)
    .eq("is_draft", false)
    .is("deleted_at", null)
    .limit(3);

  if (!clients?.length) {
    await sendTelegram(chatId, `❌ Client '${intent.client_name}' not found.`);
    return;
  }

  const client     = clients[0];
  const clientName = client.name ?? "Unknown";

  let ledgerQuery = supabase
    .from("client_ledger_entries")
    .select("*")
    .eq("client_id", client.id)
    .order("entry_date", { ascending: true });

  if (intent.financial_year) {
    ledgerQuery = ledgerQuery.eq("financial_year", intent.financial_year);
  }

  const { data: entries } = await ledgerQuery;

  if (!entries?.length) {
    await sendTelegram(chatId, `📒 No ledger entries for '${clientName}'.` +
      (intent.financial_year ? ` (FY ${intent.financial_year})` : ""));
    return;
  }

  // Running balance (debit increases, credit decreases balance)
  let runningBalance = 0;
  const shownEntries = entries.slice(-15); // last 15 entries
  const totalDebit   = entries.reduce((s, e) => s + (e.debit_amount ?? 0), 0);
  const totalCredit  = entries.reduce((s, e) => s + (e.credit_amount ?? 0), 0);
  // Use stored balance from last entry if available, else compute
  const closingBal = entries[entries.length - 1].balance
    ?? entries.reduce((s, e) => s + (e.debit_amount ?? 0) - (e.credit_amount ?? 0), 0);

  let msg =
    `📒 *Ledger: ${escMd(clientName)}*\n` +
    (intent.financial_year ? `_FY ${escMd(intent.financial_year)}_\n` : "") +
    `_Showing last ${shownEntries.length} of ${entries.length} entries_\n\n`;

  shownEntries.forEach(e => {
    const debit  = e.debit_amount ?? 0;
    const credit = e.credit_amount ?? 0;
    runningBalance += debit - credit;
    msg += `${escMd(fmtDate(e.entry_date))} | ${escMd(trunc(e.narration ?? e.entry_type ?? "-", 35))} | `;
    msg += `Dr: ₹${escMd(fmtNum(debit))} | Cr: ₹${escMd(fmtNum(credit))}\n`;
  });

  msg +=
    `\n*Running Balance: ₹${escMd(fmtNum(closingBal))}*\n` +
    `_Showing last ${Math.min(15, entries.length)} of ${entries.length}_`;

  if (clients.length > 1) {
    msg += `\n\n_Note: Found ${clients.length} clients matching "${escMd(intent.client_name ?? "")}" — showing first result_`;
  }

  await sendMsg(chatId, msg);

  // ── Also deliver the full ledger as a PDF file ───────────────────────────────
  try {
    await sendTelegram(chatId, "⏳ Generating ledger PDF…");
    const now    = new Date();
    const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyLabel = intent.financial_year ?? `${fyYear}-${String(fyYear + 1).slice(2)}`;
    const firmName = FIRM_DISPLAY_NAME;
    const pdfBytes = await generateLedgerPdf(clientName, firmName, entries, fyLabel);
    const safeClient = clientName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
    const caption = `📒 Account Statement: ${clientName}\nFY ${fyLabel} | ${entries.length} transactions`;
    await sendTelegramDocumentBytes(chatId, pdfBytes, `Ledger_${safeClient}_FY${fyLabel}.pdf`, caption);
  } catch (pdfErr: unknown) {
    const msg2 = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
    console.error("[Bot] Ledger PDF delivery error:", msg2);
    // Text was already sent — PDF failure is non-fatal
    await sendTelegram(chatId, `⚠️ Could not generate PDF: ${msg2.slice(0, 100)}`);
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

// ─── send email ───────────────────────────────────────────────────────────────
async function handleSendEmail(chatId: number, intent: Intent) {
  if (!intent.invoice_no && !intent.client_name) {
    await sendTelegram(chatId,
      "❌ Please specify an invoice number.\nExample: \"send invoice 29/2026-27 to email\""
    );
    return;
  }

  // ── Find client ─────────────────────────────────────────────────────────────
  let clientName = "Client";
  let clientId: string | null = null;
  let recipientEmail: string | null = intent.email_to ?? null;
  // Guard: if email_to looks like an email address use it; if it's a role token ignore it
  if (recipientEmail && !recipientEmail.includes("@")) recipientEmail = null;

  if (intent.client_name) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id,name,email")
      .ilike("name", `%${intent.client_name}%`)
      .limit(1);

    if (!clients?.length || !clients[0].email) {
      await sendTelegram(chatId, `❌ Client not found or no email on file.`);
      return;
    }
    clientId       = clients[0].id;
    clientName     = clients[0].name ?? "Client";
    recipientEmail = recipientEmail ?? clients[0].email;
  }

  // ── Find invoice ─────────────────────────────────────────────────────────────
  const invoiceQuery = supabase
    .from("invoices")
    .select("*")
    .neq("status", "draft")
    .order("invoice_date", { ascending: false })
    .limit(1);

  const { data: invoice, error: invErr } = await (
    intent.invoice_no
      ? invoiceQuery.ilike("invoice_no", `%${intent.invoice_no}%`)
      : invoiceQuery.ilike("to_name", `%${intent.client_name}%`)
  ).maybeSingle();

  if (invErr || !invoice) {
    await sendTelegram(chatId, `❌ Invoice not found or is a draft.`);
    return;
  }

  // Resolve email + name from invoice's client if not yet set
  if ((!recipientEmail || !clientId) && invoice.client_id) {
    const { data: cl } = await supabase
      .from("clients").select("id,name,email").eq("id", invoice.client_id).maybeSingle();
    if (cl) {
      if (!clientId)       clientId       = cl.id;
      if (!clientName || clientName === "Client") clientName = cl.name ?? invoice.to_name ?? "Client";
      if (!recipientEmail) recipientEmail = cl.email;
    }
  }
  if (!recipientEmail) {
    await sendTelegram(chatId,
      `❌ No email address on file for this client.\n` +
      `Please specify: "send invoice ${intent.invoice_no} to client@email.com"`
    );
    return;
  }

  const firmName = invoice.from_firm_name ?? FIRM_DISPLAY_NAME;
  const subject  = `Invoice ${invoice.invoice_no} & Account Statement — ${firmName}`;

  await sendTelegram(chatId, `⏳ Generating PDFs & sending to ${recipientEmail}… please wait.`);

  try {
    // ── Current financial year ───────────────────────────────────────────────
    const now     = new Date();
    const fyYear  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStart = `${fyYear}-04-01`;
    const fyEnd   = `${fyYear + 1}-03-31`;
    const fyLabel = `${fyYear}-${String(fyYear + 1).slice(2)}`;

    // ── Fetch ledger entries for current FY ──────────────────────────────────
    let ledgerEntries: any[] = [];
    if (clientId) {
      const { data: le } = await supabase
        .from("client_ledger_entries")
        .select("*")
        .eq("client_id", clientId)
        .gte("entry_date", fyStart)
        .lte("entry_date", fyEnd)
        .order("entry_date");
      ledgerEntries = le ?? [];
    }

    // ── Generate PDFs in parallel ────────────────────────────────────────────
    const [invPdfBytes, ledgerPdfBytes] = await Promise.all([
      generateInvoicePdf(invoice, firmName, clientName),
      generateLedgerPdf(clientName, firmName, ledgerEntries, fyLabel),
    ]);
    const invB64    = uint8ToBase64(invPdfBytes);
    const ledgerB64 = uint8ToBase64(ledgerPdfBytes);

    const safeInvNo  = (invoice.invoice_no ?? "invoice").replace(/\//g, "-");
    const safeClient = clientName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);

    const attachments = [
      { filename: `Invoice_${safeInvNo}.pdf`,              content: invB64    },
      { filename: `Ledger_${safeClient}_FY${fyLabel}.pdf`, content: ledgerB64 },
    ];

    // ── Build email HTML ─────────────────────────────────────────────────────
    const emailHtml = buildInvoiceEmailHtml({
      firmName,
      clientName,
      invoiceNo:   invoice.invoice_no ?? "",
      amount:      fmtNum(invoice.total_amount ?? invoice.amount ?? 0),
      dueDate:     fmtDate(invoice.due_date),
      invoiceDate: fmtDate(invoice.invoice_date),
      status:      invoice.status ?? "finalized",
      hasLedger:   ledgerEntries.length > 0,
      fyLabel,
    });

    // ── Send via Resend (primary) or Graph (fallback) ────────────────────────
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY) {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from:        `${firmName} <accounts@vjdesai.com>`,
          to:          recipientEmail,
          subject,
          html:        emailHtml,
          attachments,            // Resend: [{ filename, content: base64 }]
        }),
      });
      if (!resendRes.ok) {
        const errText = await resendRes.text();
        throw new Error(`Resend API failed (${resendRes.status}): ${errText.slice(0, 200)}`);
      }
    } else {
      // Graph API: attachments use contentBytes field
      const graphAttachments = attachments.map(a => ({
        "@odata.type": "#microsoft.graph.fileAttachment" as const,
        name:          a.filename,
        contentType:   "application/pdf",
        contentBytes:  a.content,
      }));
      await sendEmailViaGraph(recipientEmail, subject, emailHtml, graphAttachments);
    }

    // ── Update invoice status ────────────────────────────────────────────────
    if (invoice.status === "finalized") {
      await supabase.from("invoices")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", invoice.id);
    }

    // ── Log notification ─────────────────────────────────────────────────────
    await supabase.from("notification_log").insert({
      recipient_id: invoice.client_id,
      channel:      "email",
      type:         "invoice_generated",
      status:       "sent",
      sent_at:      new Date().toISOString(),
      content: {
        subject, to: recipientEmail, invoice_id: invoice.id,
        source: "telegram_bot",
        attachments: attachments.map(a => a.filename),
      },
    });

    await sendTelegram(chatId,
      `✅ Email sent to ${clientName} (${recipientEmail})\n` +
      `📄 Invoice: ${invoice.invoice_no} | Rs.${fmtNum(invoice.total_amount ?? invoice.amount ?? 0)}\n` +
      `📎 2 attachments: Invoice PDF + Ledger FY ${fyLabel}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bot] Email send error:", msg);
    await sendTelegram(chatId, `❌ Email failed. Check logs.\n${msg.slice(0, 120)}`);
  }
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
  if (!ANTHROPIC_API_KEY) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
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

async function parseIntent(text: string, ctxHint?: string): Promise<Intent> {
  if (!ANTHROPIC_API_KEY) {
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

/** Keyword-based fallback when Claude is unavailable or both passes fail */
function intentFallback(text: string): Intent {
  const t = text.toLowerCase();
  if (t.includes("outstanding") || t.includes("unpaid") || t.includes("pending"))
    return { action: "get_outstanding", limit: 10 };
  if (t.includes("overdue") || t.includes("past due"))
    return { action: "get_overdue", limit: 10 };
  if (t.includes("summary") || t.includes("dashboard") || t.includes("report") || t.includes("overview"))
    return { action: "get_summary" };
  if (t.includes("ledger") || t.includes("account statement") || t.includes("statement")) {
    const m = text.match(/(?:ledger|statement)\s+(?:for|of)?\s+(.+)/i);
    return { action: "get_ledger", client_name: m?.[1]?.trim() ?? null };
  }
  if (t.includes("receipt") || (t.includes("payment") && t.includes("received")))
    return { action: "get_receipts", limit: 10 };
  if (t.includes("pdf")) {
    // PDF in this chat
    const invM = text.match(/\d+\/?\d{0,4}-?\d{0,2}/);
    return { action: "send_pdf", invoice_no: invM?.[0] ?? null };
  }
  if (t.includes("send") || t.includes("email")) {
    const invM   = text.match(/\d+\/?\d{0,4}-?\d{0,2}/);
    const emailM = text.match(/[\w.-]+@[\w.-]+\.\w+/);
    return { action: "send_email", invoice_no: invM?.[0] ?? null, email_to: emailM?.[0] ?? null, document_type: "invoice" };
  }
  if (t.includes("help") || t === "/help")
    return { action: "help" };
  const invPat = text.match(/\d+\/\d{4}-\d{2,4}/);
  if (invPat || t.includes("invoice") || t.includes("bill"))
    return { action: "get_invoice", invoice_no: invPat?.[0] ?? null };
  // Last resort: show help rather than "I didn't understand"
  return { action: "help" };
}

// ─── send_pdf ─────────────────────────────────────────────────────────────────
// Generates invoice PDFs and sends them as Telegram documents (file attachments)
async function handleSendPdf(chatId: number, intent: Intent, ctx: TgContext | null) {
  // Resolve invoice list: from explicit IDs (context), client name, or invoice_no
  let invoices: any[] = [];

  const idsToFetch: string[] = intent.invoice_ids?.length
    ? intent.invoice_ids
    : ctx?.last_invoice_ids ?? [];

  if (idsToFetch.length > 0) {
    const { data } = await supabase
      .from("invoices").select("*").in("id", idsToFetch);
    invoices = data ?? [];
  } else if (intent.client_name) {
    const { data: clients } = await supabase
      .from("clients").select("id,name").ilike("name", `%${intent.client_name}%`).limit(5);
    if (clients?.length) {
      const { data } = await supabase
        .from("invoices").select("*")
        .in("client_id", clients.map(c => c.id))
        .neq("status", "draft")
        .order("invoice_date", { ascending: false }).limit(5);
      invoices = data ?? [];
    }
  } else if (intent.invoice_no) {
    const { data } = await supabase
      .from("invoices").select("*")
      .ilike("invoice_no", `%${intent.invoice_no}%`)
      .limit(3);
    invoices = data ?? [];
  }

  if (!invoices.length) {
    await sendTelegram(chatId,
      "❌ No invoices found to send as PDF.\n" +
      "Try: \"Send PDF of invoice 29/2026-27\" or \"Show invoices for [client]\" first."
    );
    return;
  }

  await sendTelegram(chatId, `⏳ Generating ${invoices.length} PDF${invoices.length > 1 ? "s" : ""}…`);

  let sentCount = 0;
  for (const inv of invoices) {
    try {
      // Resolve client name
      let clientName = inv.to_name ?? "Client";
      if (inv.client_id) {
        const { data: cl } = await supabase
          .from("clients").select("name").eq("id", inv.client_id).maybeSingle();
        if (cl?.name) clientName = cl.name;
      }

      const firmName = inv.from_firm_name ?? FIRM_DISPLAY_NAME;

      // Generate PDF bytes directly — no Storage upload needed
      const pdfBytes = await generateInvoicePdf(inv, firmName, clientName);

      const safeInvNo = (inv.invoice_no ?? "invoice").replace(/\//g, "-");
      const caption   =
        `📄 Invoice ${inv.invoice_no ?? "—"} | ${clientName}\n` +
        `Rs.${fmtNum(inv.total_amount ?? inv.amount ?? 0)} | ${fmtDate(inv.invoice_date)}`;

      // Send raw bytes via multipart/form-data — works without any public bucket
      await sendTelegramDocumentBytes(chatId, pdfBytes, `Invoice_${safeInvNo}.pdf`, caption);
      sentCount++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Bot] PDF send error:", msg);
      await sendTelegram(chatId, `⚠️ Failed for invoice ${inv.invoice_no}: ${msg.slice(0, 80)}`);
    }
  }

  if (sentCount > 0) {
    await sendTelegram(chatId, `✅ Sent ${sentCount} PDF${sentCount > 1 ? "s" : ""} to your chat.`);
  }
}

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

/** Simple invoice PDF — firm header, invoice meta, line-items table, totals */
async function generateInvoicePdf(
  invoice: any,
  firmName: string,
  clientName: string,
): Promise<Uint8Array> {
  const pdfDoc   = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595, H = 842, M = 40;
  let page = pdfDoc.addPage([W, H]);
  let y = H - M;

  // ── Dark header bar ──
  page.drawRectangle({ x: 0, y: H - 68, width: W, height: 68, color: rgb(0.1, 0.22, 0.36) });
  page.drawText(firmName.slice(0, 50),
    { x: M, y: H - 36, font: fontBold, size: 15, color: rgb(1, 1, 1) });
  page.drawText("TAX INVOICE",
    { x: W - M - 88, y: H - 36, font: fontBold, size: 12, color: rgb(1, 1, 1) });
  page.drawText("Chartered Accountants",
    { x: M, y: H - 55, font, size: 9, color: rgb(0.75, 0.82, 0.9) });
  y = H - 86;

  // ── Invoice meta ──
  page.drawText(`Invoice No: ${invoice.invoice_no ?? "—"}`, { x: M, y, font: fontBold, size: 10 });
  page.drawText(`Date: ${fmtDate(invoice.invoice_date)}`,   { x: M + 200, y, font, size: 10 });
  page.drawText(`Due:  ${fmtDate(invoice.due_date ?? "")}`, { x: M + 360, y, font, size: 10 });
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4 });
  y -= 14;

  // ── Bill To ──
  page.drawText("Bill To:", { x: M, y, font: fontBold, size: 8, color: rgb(0.45, 0.45, 0.45) });
  y -= 13;
  page.drawText(String(clientName || invoice.to_name || "Client").slice(0, 60),
    { x: M, y, font: fontBold, size: 11 });
  if (invoice.to_address) {
    y -= 13;
    page.drawText(String(invoice.to_address).slice(0, 75), { x: M, y, font, size: 9 });
  }
  if (invoice.to_gstin) {
    y -= 12;
    page.drawText(`GSTIN: ${invoice.to_gstin}`, { x: M, y, font, size: 9, color: rgb(0.4, 0.4, 0.4) });
  }
  y -= 18;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4 });
  y -= 14;

  // ── Line items table ──
  const cDesc = M, cQty = M + 240, cRate = M + 285, cTax = M + 345, cGst = M + 415, cTot = M + 460;

  page.drawRectangle({ x: M, y: y - 2, width: W - 2 * M, height: 16, color: rgb(0.91, 0.95, 1) });
  page.drawText("Description",  { x: cDesc, y: y + 2, font: fontBold, size: 8 });
  page.drawText("Qty",          { x: cQty,  y: y + 2, font: fontBold, size: 8 });
  page.drawText("Rate",         { x: cRate, y: y + 2, font: fontBold, size: 8 });
  page.drawText("Taxable",      { x: cTax,  y: y + 2, font: fontBold, size: 8 });
  page.drawText("GST%",         { x: cGst,  y: y + 2, font: fontBold, size: 8 });
  page.drawText("Total",        { x: cTot,  y: y + 2, font: fontBold, size: 8 });
  y -= 18;

  const items: any[] = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  for (const item of items) {
    if (y < M + 60) { page = pdfDoc.addPage([W, H]); y = H - M; }
    page.drawText(String(item.description ?? "").slice(0, 38), { x: cDesc, y, font, size: 8 });
    page.drawText(String(item.quantity ?? 1),                  { x: cQty,  y, font, size: 8 });
    page.drawText(fmtNum(item.rate ?? 0),                      { x: cRate, y, font, size: 8 });
    page.drawText(fmtNum(item.taxable_value ?? 0),             { x: cTax,  y, font, size: 8 });
    page.drawText(`${item.gst_percent ?? 18}%`,                { x: cGst,  y, font, size: 8 });
    page.drawText(fmtNum(item.total ?? 0),                     { x: cTot,  y, font, size: 8 });
    y -= 14;
  }

  // ── Totals ──
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4 });
  y -= 14;
  const total   = Number(invoice.total_amount ?? invoice.amount ?? 0);
  const gstAmt  = Number(invoice.gst_amount ?? 0);
  const taxable = total - gstAmt;
  page.drawText(`Taxable: Rs.${fmtNum(taxable)}`, { x: cTax - 70, y, font, size: 9 });
  page.drawText(`GST: Rs.${fmtNum(gstAmt)}`,      { x: cGst - 20, y, font, size: 9 });
  y -= 16;
  page.drawText(`TOTAL: Rs.${fmtNum(total)}`,
    { x: cTot - 50, y, font: fontBold, size: 12, color: rgb(0.1, 0.22, 0.36) });

  // ── Footer ──
  page.drawText("Computer-generated document — no signature required.",
    { x: M, y: 28, font, size: 7, color: rgb(0.6, 0.6, 0.6) });

  return pdfDoc.save();
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
