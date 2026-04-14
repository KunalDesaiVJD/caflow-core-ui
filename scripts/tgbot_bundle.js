// supabase/functions/telegram-bot/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
var BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
var SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
var SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
var ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
var GRAPH_TENANT_ID = Deno.env.get("GRAPH_TENANT_ID");
var GRAPH_CLIENT_ID = Deno.env.get("GRAPH_CLIENT_ID");
var GRAPH_CLIENT_SECRET = Deno.env.get("GRAPH_CLIENT_SECRET");
var EMAIL_FROM = "accounts@vjdesai.com";
var FIRM_DISPLAY_NAME = "V J Desai & Co.";
var supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
serve(async (req) => {
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, bot: "CAFlow Telegram Billing Bot" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("ok");
  }
  const message = body.message || body.edited_message;
  if (!message?.text) return new Response("ok");
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text.trim();
  console.log(`[Bot] Message from ${message.from.first_name ?? "?"} (${userId}): ${text.slice(0, 80)}`);
  try {
    if (text === "/start" || text.startsWith("/start ")) {
      await sendTelegram(
        chatId,
        `Welcome to CAFlow Billing Agent! \u{1F916}

I can help you with:
\u{1F4C4} Invoices \u2014 'Show invoices for [client name]'
\u{1F4D2} Ledger \u2014 'Ledger of [client name]'
\u{1F4E7} Email \u2014 'Email invoice to [client name]'

Just type naturally \u2014 I understand!
Type /help for more examples.`
      );
      return new Response("ok");
    }
    if (text === "/help") {
      await handleHelp(chatId);
      return new Response("ok");
    }
    const intent = await parseIntent(text);
    console.log(`[Bot] Intent:`, JSON.stringify(intent));
    switch (intent.action) {
      case "get_invoice":
        await handleGetInvoice(chatId, intent);
        break;
      case "get_ledger":
        await handleGetLedger(chatId, intent);
        break;
      case "get_outstanding":
        await handleOutstanding(chatId, intent.limit ?? 10);
        break;
      case "get_overdue":
        await handleOverdue(chatId, intent.limit ?? 10);
        break;
      case "get_summary":
        await handleSummary(chatId);
        break;
      case "send_email":
        await handleSendEmail(chatId, intent);
        break;
      case "get_receipts":
        await handleReceipts(chatId, intent.limit ?? 10);
        break;
      case "help":
        await handleHelp(chatId);
        break;
      default:
        await sendMsg(
          chatId,
          "\u{1F914} I didn't understand that\\.\n\nTry:\n\u2022 /outstanding \u2014 list unpaid invoices\n\u2022 /overdue \u2014 overdue invoices \u{1F6A8}\n\u2022 /summary \u2014 billing dashboard\n\u2022 /invoice 29/2026\\-27 \u2014 invoice details\n\u2022 /ledger Gujarat Water \u2014 client ledger\n\u2022 /help \u2014 full command list"
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bot] Unhandled error:", msg);
    await sendMsg(chatId, `\u274C An error occurred\\. Please try again\\.
_Error: ${escMd(msg.slice(0, 100))}_`);
  }
  return new Response("ok");
});
async function handleHelp(chatId) {
  const msg = `\u{1F916} *CAFlow Billing Agent*

Here is what I can do:

\u{1F4C4} *Invoices*
\u2022 'Show invoices for Gujarat Water Supply'
\u2022 'Get invoice 29/2026-27'
\u2022 'All invoices from April 2026'

\u{1F4D2} *Ledger*
\u2022 'Ledger of Accurate PMS'
\u2022 'Show ledger for FY 2026-27'

\u{1F4E7} *Email*
\u2022 'Email latest invoice to Gujarat Water'
\u2022 'Send ledger to Accurate PMS client'

Just type naturally \u2014 I understand!`;
  await sendTelegram(chatId, msg, "Markdown");
}
async function handleSummary(chatId) {
  await sendMsg(chatId, "\u23F3 Loading billing summary\\.\\.\\.");
  const { data: invoices, error } = await supabase.from("invoices").select("id,status,amount,total_amount,due_date,invoice_date,paid_at,document_type");
  if (error || !invoices) {
    await sendMsg(chatId, "\u274C Could not load billing data\\.");
    return;
  }
  const today = /* @__PURE__ */ new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  const paid = invoices.filter((i) => i.status === "paid");
  const outstanding = invoices.filter((i) => ["finalized", "sent"].includes(i.status ?? ""));
  const overdue = outstanding.filter((i) => i.due_date && new Date(i.due_date) < today);
  const draft = invoices.filter((i) => i.status === "draft");
  const paidThisMonth = paid.filter((i) => i.paid_at && i.paid_at >= monthStart);
  const totalRev = sum(paid);
  const totalOut = sum(outstanding);
  const totalOverdue = sum(overdue);
  const monthRevenue = sum(paidThisMonth);
  const monthName = today.toLocaleString("en-IN", { month: "long" });
  const fy = getFY(today);
  const statusCounts = {};
  invoices.forEach((i) => {
    const s = i.status ?? "draft";
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  });
  let msg = `\u{1F4CA} *Billing Summary \u2014 ${escMd(fy)}*
_${escMd(monthName)} ${today.getFullYear()}_

\u{1F4B0} *Total Revenue:* \u20B9${escMd(fmtNum(totalRev))}
   \\(${paid.length} paid invoices\\)

\u23F3 *Outstanding:* \u20B9${escMd(fmtNum(totalOut))}
   \\(${outstanding.length} invoices pending\\)

`;
  if (totalOverdue > 0) {
    msg += `\u{1F6A8} *Overdue:* \u20B9${escMd(fmtNum(totalOverdue))}
   \\(${overdue.length} invoices past due date\\)

`;
  } else {
    msg += `\u2705 *Overdue: None* \u2014 all within due date

`;
  }
  msg += `\u{1F4C5} *Collected in ${escMd(monthName)}:* \u20B9${escMd(fmtNum(monthRevenue))}
   \\(${paidThisMonth.length} payments\\)

\u{1F4C4} *Document Counts:*
`;
  Object.entries(statusCounts).forEach(([status, count]) => {
    msg += `   ${statusIcon(status)} ${escMd(capitalize(status))}: ${count}
`;
  });
  msg += `   \u{1F4C1} *Total: ${invoices.length}*

`;
  msg += `_/outstanding \u2022 /overdue \u2022 /receipts for details_`;
  await sendMsg(chatId, msg);
}
async function handleOutstanding(chatId, limit) {
  const { data: invoices } = await supabase.from("invoices").select("id,invoice_no,client_id,to_name,invoice_date,due_date,status,amount,total_amount").in("status", ["finalized", "sent"]).order("due_date", { ascending: true, nullsFirst: false }).limit(limit);
  if (!invoices?.length) {
    await sendMsg(chatId, "\u2705 *No Outstanding Invoices\\!*\n\nAll invoices are paid or settled\\. \u{1F389}");
    return;
  }
  const clientMap = await fetchClientNames(invoices.map((i) => i.client_id));
  const total = sum(invoices);
  let msg = `\u{1F4CB} *Outstanding Invoices* \\(${invoices.length}\\)
\u{1F4B0} *Total: \u20B9${escMd(fmtNum(total))}*

`;
  invoices.forEach((inv, i) => {
    const client = clientMap[inv.client_id ?? ""] ?? inv.to_name ?? "Unknown";
    const od = isOverdue(inv) ? " \u{1F6A8}" : "";
    msg += `*${i + 1}\\.* \`${escMd(inv.invoice_no ?? "\u2014")}\`${od}
`;
    msg += `   \u{1F464} ${escMd(trunc(client, 28))}
`;
    msg += `   \u20B9${escMd(fmtNum(inv.total_amount ?? inv.amount ?? 0))}`;
    msg += ` \u2022 ${statusIcon(inv.status)} ${escMd(capitalize(inv.status ?? ""))}`;
    if (inv.due_date) msg += ` \u2022 Due: ${escMd(fmtDate(inv.due_date))}`;
    msg += "\n\n";
  });
  msg += `_Type /invoice \\<no\\> for details or ask me to send via email_`;
  await sendMsg(chatId, msg);
}
async function handleOverdue(chatId, limit) {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const { data: invoices } = await supabase.from("invoices").select("id,invoice_no,client_id,to_name,invoice_date,due_date,status,amount,total_amount").in("status", ["finalized", "sent"]).lt("due_date", today).order("due_date", { ascending: true }).limit(limit);
  if (!invoices?.length) {
    await sendMsg(chatId, "\u2705 *No Overdue Invoices\\!*\n\nAll outstanding invoices are within their due date\\. \u{1F389}");
    return;
  }
  const clientMap = await fetchClientNames(invoices.map((i) => i.client_id));
  const total = sum(invoices);
  let msg = `\u{1F6A8} *Overdue Invoices* \\(${invoices.length}\\)
\u{1F4B0} *Total Overdue: \u20B9${escMd(fmtNum(total))}*

`;
  invoices.forEach((inv, i) => {
    const client = clientMap[inv.client_id ?? ""] ?? inv.to_name ?? "Unknown";
    const daysOD = daysDiff(inv.due_date);
    msg += `*${i + 1}\\.* \`${escMd(inv.invoice_no ?? "\u2014")}\` \u2014 \u26A0\uFE0F _${daysOD}d overdue_
`;
    msg += `   \u{1F464} ${escMd(trunc(client, 28))}
`;
    msg += `   \u20B9${escMd(fmtNum(inv.total_amount ?? inv.amount ?? 0))}`;
    msg += ` \u2022 Due was: ${escMd(fmtDate(inv.due_date))}

`;
  });
  msg += `_Ask me to "send invoice \\<no\\> to email" to send a reminder_`;
  await sendMsg(chatId, msg);
}
async function handleGetInvoice(chatId, intent) {
  let query = supabase.from("invoices").select("id,invoice_no,client_id,to_name,from_firm_name,document_type,status,invoice_date,due_date,paid_at,sent_at,amount,gst_amount,total_amount,tds_amount,subject,pdf_url").order("invoice_date", { ascending: false });
  if (intent.invoice_no) {
    query = query.ilike("invoice_no", `%${intent.invoice_no}%`);
  } else if (intent.client_name) {
    const { data: clientRows } = await supabase.from("clients").select("id").ilike("name", `%${intent.client_name}%`).eq("is_draft", false).is("deleted_at", null).limit(10);
    if (!clientRows?.length) {
      query = query.ilike("to_name", `%${intent.client_name}%`);
    } else {
      query = query.in("client_id", clientRows.map((c) => c.id));
    }
  }
  if (intent.financial_year) {
    const [startY] = intent.financial_year.split("-");
    if (startY) {
      query = query.gte("invoice_date", `${startY}-04-01`).lte("invoice_date", `${parseInt(startY) + 1}-03-31`);
    }
  }
  const { data: invoices, error } = await query.limit(10);
  if (error) {
    console.error("[Bot] Invoice query error:", error);
    await sendTelegram(chatId, `\u274C Database error fetching invoices.`);
    return;
  }
  if (!invoices?.length) {
    const target = intent.invoice_no ?? intent.client_name ?? "the specified criteria";
    await sendTelegram(chatId, `\u274C No invoices found for '${target}'.`);
    return;
  }
  const clientMap = await fetchClientNamesWithEmail(invoices.map((i) => i.client_id));
  if (invoices.length === 1) {
    const inv = invoices[0];
    const client = clientMap[inv.client_id ?? ""] ?? { name: inv.to_name ?? "Unknown", email: null };
    const amt = inv.total_amount ?? inv.amount ?? 0;
    let msg = `\u{1F4C4} *${escMd(docTypeLabel(inv.document_type))} ${escMd(inv.invoice_no ?? "\u2014")}*

\u{1F464} *Client:* ${escMd(client.name)}
\u{1F4B0} *Amount:* \u20B9${escMd(fmtNum(amt))}`;
    if (inv.gst_amount && inv.gst_amount > 0)
      msg += ` \\(incl\\. GST \u20B9${escMd(fmtNum(inv.gst_amount))}\\)`;
    if (inv.tds_amount && inv.tds_amount > 0)
      msg += `, TDS \u20B9${escMd(fmtNum(inv.tds_amount))}`;
    msg += "\n";
    msg += `${statusIcon(inv.status)} *Status:* ${escMd(capitalize(inv.status ?? "draft"))} | ${escMd(inv.invoice_no ?? "")}
`;
    msg += `\u{1F4C5} *Date:* ${escMd(fmtDate(inv.invoice_date))}
`;
    if (inv.due_date) {
      msg += `\u23F0 *Due:* ${escMd(fmtDate(inv.due_date))}`;
      if (isOverdue(inv)) msg += " \u{1F6A8} _OVERDUE_";
      msg += "\n";
    }
    if (inv.paid_at) msg += `\u2705 *Paid:* ${escMd(fmtDate(inv.paid_at))}
`;
    if (inv.sent_at) msg += `\u2709\uFE0F *Sent:* ${escMd(fmtDate(inv.sent_at))}
`;
    if (inv.subject) msg += `\u{1F4DD} *Notes:* ${escMd(trunc(inv.subject, 60))}
`;
    if (client.email) {
      msg += `
\u{1F4E7} *Client email:* ${escMd(client.email)}
`;
      msg += `
\u{1F4AC} _Reply "send invoice ${escMd(inv.invoice_no ?? "")} to email" to deliver via email_`;
    }
    await sendMsg(chatId, msg);
    if (inv.pdf_url) {
      await sendDocument(chatId, inv.pdf_url, `Invoice_${inv.invoice_no}.pdf`);
    }
  } else {
    let msg = `\u{1F4C4} *${invoices.length} Invoice${invoices.length > 1 ? "s" : ""} Found*
Total: \u20B9${escMd(fmtNum(sum(invoices)))}

`;
    invoices.forEach((inv, i) => {
      const client = clientMap[inv.client_id ?? ""]?.name ?? inv.to_name ?? "Unknown";
      const od = isOverdue(inv) ? " \u{1F6A8}" : "";
      msg += `*${i + 1}\\.* \`${escMd(inv.invoice_no ?? "\u2014")}\`${od}
`;
      msg += `   ${escMd(trunc(client, 28))}
`;
      msg += `   \u20B9${escMd(fmtNum(inv.total_amount ?? inv.amount ?? 0))}`;
      msg += ` \u2022 ${statusIcon(inv.status)} ${escMd(capitalize(inv.status ?? ""))}`;
      if (inv.due_date) msg += ` \u2022 ${escMd(fmtDate(inv.due_date))}`;
      msg += "\n\n";
    });
    msg += `_Type /invoice \\<no\\> for full details_`;
    await sendMsg(chatId, msg);
  }
}
async function handleGetLedger(chatId, intent) {
  if (!intent.client_name) {
    await sendTelegram(
      chatId,
      '\u274C Please specify a client name.\nExample: `/ledger Gujarat Water`\nOr: "ledger statement for NIRALI"'
    );
    return;
  }
  const { data: clients } = await supabase.from("clients").select("id,name,email").ilike("name", `%${intent.client_name}%`).eq("is_draft", false).is("deleted_at", null).limit(3);
  if (!clients?.length) {
    await sendTelegram(chatId, `\u274C Client '${intent.client_name}' not found.`);
    return;
  }
  const client = clients[0];
  const clientName = client.name ?? "Unknown";
  let ledgerQuery = supabase.from("client_ledger_entries").select("*").eq("client_id", client.id).order("entry_date", { ascending: true });
  if (intent.financial_year) {
    ledgerQuery = ledgerQuery.eq("financial_year", intent.financial_year);
  }
  const { data: entries } = await ledgerQuery;
  if (!entries?.length) {
    await sendTelegram(chatId, `\u{1F4D2} No ledger entries for '${clientName}'.` + (intent.financial_year ? ` (FY ${intent.financial_year})` : ""));
    return;
  }
  let runningBalance = 0;
  const shownEntries = entries.slice(-15);
  const totalDebit = entries.reduce((s, e) => s + (e.debit_amount ?? 0), 0);
  const totalCredit = entries.reduce((s, e) => s + (e.credit_amount ?? 0), 0);
  const closingBal = entries[entries.length - 1].balance ?? entries.reduce((s, e) => s + (e.debit_amount ?? 0) - (e.credit_amount ?? 0), 0);
  let msg = `\u{1F4D2} *Ledger: ${escMd(clientName)}*
` + (intent.financial_year ? `_FY ${escMd(intent.financial_year)}_
` : "") + `_Showing last ${shownEntries.length} of ${entries.length} entries_

`;
  shownEntries.forEach((e) => {
    const debit = e.debit_amount ?? 0;
    const credit = e.credit_amount ?? 0;
    runningBalance += debit - credit;
    msg += `${escMd(fmtDate(e.entry_date))} | ${escMd(trunc(e.narration ?? e.entry_type ?? "-", 35))} | `;
    msg += `Dr: \u20B9${escMd(fmtNum(debit))} | Cr: \u20B9${escMd(fmtNum(credit))}
`;
  });
  msg += `
*Running Balance: \u20B9${escMd(fmtNum(closingBal))}*
_Showing last ${Math.min(15, entries.length)} of ${entries.length}_`;
  if (clients.length > 1) {
    msg += `

_Note: Found ${clients.length} clients matching "${escMd(intent.client_name ?? "")}" \u2014 showing first result_`;
  }
  await sendMsg(chatId, msg);
}
async function handleReceipts(chatId, limit) {
  const { data: receipts, error } = await supabase.from("billing_receipts").select("id,client_id,receipt_date,receipt_type,payment_mode,payment_reference,amount_received,tds_amount,invoice_id").order("receipt_date", { ascending: false }).limit(limit);
  if (error || !receipts?.length) {
    await sendMsg(chatId, "\u{1F4B0} No receipts found\\.");
    return;
  }
  const clientMap = await fetchClientNames(receipts.map((r) => r.client_id));
  const total = receipts.reduce((s, r) => s + (r.amount_received ?? 0), 0);
  let msg = `\u{1F4B0} *Recent Receipts* \\(${receipts.length}\\)
*Total Collected: \u20B9${escMd(fmtNum(total))}*

`;
  receipts.forEach((r, i) => {
    const client = clientMap[r.client_id] ?? "Unknown";
    msg += `*${i + 1}\\.* ${escMd(fmtDate(r.receipt_date))} \u2014 ${escMd(trunc(client, 25))}
`;
    msg += `   \u20B9${escMd(fmtNum(r.amount_received ?? 0))} via ${escMd(r.payment_mode ?? "\u2014")}`;
    if (r.payment_reference) msg += ` \\(Ref: ${escMd(r.payment_reference)}\\)`;
    if (r.tds_amount && r.tds_amount > 0) msg += `
   TDS: \u20B9${escMd(fmtNum(r.tds_amount))}`;
    msg += "\n\n";
  });
  await sendMsg(chatId, msg);
}
async function handleSendEmail(chatId, intent) {
  if (!intent.invoice_no && !intent.client_name) {
    await sendTelegram(
      chatId,
      '\u274C Please specify an invoice number.\nExample: "send invoice 29/2026-27 to email"'
    );
    return;
  }
  let clientName = "Client";
  let recipientEmail = intent.email_to ?? null;
  if (intent.client_name) {
    const { data: clients } = await supabase.from("clients").select("id,name,email").ilike("name", `%${intent.client_name}%`).limit(1);
    if (!clients?.length || !clients[0].email) {
      await sendTelegram(chatId, `\u274C Client not found or no email on file.`);
      return;
    }
    clientName = clients[0].name ?? "Client";
    recipientEmail = recipientEmail ?? clients[0].email;
  }
  const invoiceQuery = supabase.from("invoices").select("*").neq("status", "draft").order("invoice_date", { ascending: false }).limit(1);
  const { data: invoice, error: invErr } = await (intent.invoice_no ? invoiceQuery.ilike("invoice_no", `%${intent.invoice_no}%`) : invoiceQuery.ilike("to_name", `%${intent.client_name}%`)).maybeSingle();
  if (invErr || !invoice) {
    await sendTelegram(chatId, `\u274C Invoice not found or is a draft.`);
    return;
  }
  if (!recipientEmail && invoice.client_id) {
    const { data: client } = await supabase.from("clients").select("name,email").eq("id", invoice.client_id).maybeSingle();
    if (client) {
      clientName = client.name ?? invoice.to_name ?? "Client";
      recipientEmail = client.email;
    }
  }
  if (!recipientEmail) {
    await sendTelegram(
      chatId,
      `\u274C No email address on file for this client.
Please specify: "send invoice ${intent.invoice_no} to client@email.com"`
    );
    return;
  }
  const firmName = invoice.from_firm_name ?? FIRM_DISPLAY_NAME;
  const subject = intent.document_type === "ledger" ? `Account Statement from ${firmName}` : `Invoice ${invoice.invoice_no} from ${firmName}`;
  await sendTelegram(chatId, `\u23F3 Sending to ${recipientEmail}... please wait.`);
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const emailHtml = buildInvoiceEmailHtml({
      firmName,
      clientName,
      invoiceNo: invoice.invoice_no ?? "",
      amount: fmtNum(invoice.total_amount ?? invoice.amount ?? 0),
      dueDate: fmtDate(invoice.due_date),
      invoiceDate: fmtDate(invoice.invoice_date),
      status: invoice.status ?? "finalized"
    });
    if (RESEND_API_KEY) {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: `${firmName} <accounts@vjdesai.com>`,
          to: recipientEmail,
          subject,
          html: emailHtml,
          ...invoice.pdf_url ? { attachments: [{ path: invoice.pdf_url }] } : {}
        })
      });
      if (!resendRes.ok) {
        const errText = await resendRes.text();
        throw new Error(`Resend API failed (${resendRes.status}): ${errText.slice(0, 200)}`);
      }
    } else {
      await sendEmailViaGraph(recipientEmail, subject, emailHtml);
    }
    if (invoice.status === "finalized") {
      await supabase.from("invoices").update({ status: "sent", sent_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", invoice.id);
    }
    await supabase.from("notification_log").insert({
      recipient_id: invoice.client_id,
      channel: "email",
      type: "invoice_generated",
      status: "sent",
      sent_at: (/* @__PURE__ */ new Date()).toISOString(),
      content: { subject, to: recipientEmail, invoice_id: invoice.id, source: "telegram_bot" }
    });
    await sendTelegram(
      chatId,
      `\u2705 Email sent to ${clientName} (${recipientEmail})
\u{1F4C4} Invoice: ${invoice.invoice_no} | \u20B9${fmtNum(invoice.total_amount ?? invoice.amount ?? 0)}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bot] Email send error:", msg);
    await sendTelegram(chatId, `\u274C Email failed. Check logs.
${msg.slice(0, 120)}`);
  }
}
async function parseIntent(text) {
  if (!ANTHROPIC_API_KEY) {
    console.warn("[Bot] ANTHROPIC_API_KEY not set \u2014 using keyword fallback");
    return intentFallback(text);
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: `You are a billing assistant for a CA firm. Parse the user message into a JSON intent. Return ONLY valid JSON, no other text.

Possible intents:
1. get_invoice: user wants invoice(s) for a client
   { "action": "get_invoice", "client_name": "...", "doc_no": "..." or null,
     "date_from": "..." or null, "date_to": "..." or null }

2. get_ledger: user wants ledger/statement for a client
   { "action": "get_ledger", "client_name": "...",
     "fy": "2026-27" or null, "date_from": "..." or null, "date_to": "..." or null }

3. send_email: user wants to email invoice/ledger to client or group
   { "action": "send_email", "client_name": "...", "document_type": "invoice" or "ledger",
     "email_to": "client" or "group", "doc_no": "..." or null }

4. get_outstanding: user wants list of unpaid/pending invoices
   { "action": "get_outstanding", "client_name": null or "...", "limit": 10 }

5. get_overdue: user wants invoices past their due date
   { "action": "get_overdue", "client_name": null or "...", "limit": 10 }

6. get_summary: user wants billing overview/dashboard/KPIs/report
   { "action": "get_summary" }

7. get_receipts: user wants list of payments received
   { "action": "get_receipts", "client_name": null or "...", "limit": 10 }

8. help: user wants to know what they can do
   { "action": "help" }

9. unknown: cannot determine intent
   { "action": "unknown" }

Examples:
- "Send me all invoices for Gujarat Water Supply"
  \u2192 { "action": "get_invoice", "client_name": "Gujarat Water Supply", "doc_no": null, "date_from": null, "date_to": null }
- "Show ledger of Accurate PMS for FY 2026-27"
  \u2192 { "action": "get_ledger", "client_name": "Accurate PMS", "fy": "2026-27", "date_from": null, "date_to": null }
- "Email the latest invoice to Gujarat Water client"
  \u2192 { "action": "send_email", "client_name": "Gujarat Water", "document_type": "invoice", "email_to": "client", "doc_no": null }
- "Send ledger to all clients in General group"
  \u2192 { "action": "send_email", "client_name": null, "document_type": "ledger", "email_to": "group", "doc_no": null }

invoice/doc_no format examples: "29/2026-27", "28", "29"
financial_year / fy format: "2026-27"`,
        messages: [{
          role: "user",
          content: `Parse this message:
"${text.replace(/"/g, "'")}"

Return only JSON:`
        }]
      })
    });
    if (!res.ok) {
      console.error("[Bot] Claude API error:", res.status, await res.text());
      return intentFallback(text);
    }
    const data = await res.json();
    const raw = (data.content?.[0]?.text ?? "{}").trim();
    const clean = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(clean);
    const intent = {
      action: parsed.action ?? "unknown",
      invoice_no: parsed.doc_no ?? parsed.invoice_no ?? null,
      client_name: parsed.client_name ?? null,
      financial_year: parsed.fy ?? parsed.financial_year ?? null,
      email_to: parsed.email_to ?? null,
      limit: parsed.limit ?? 10,
      // Keep doc-type hint for email routing
      ...parsed.document_type ? { document_type: parsed.document_type } : {}
    };
    return intent;
  } catch (err) {
    console.error("[Bot] Intent parse error:", err);
    return intentFallback(text);
  }
}
function intentFallback(text) {
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
  if (t.includes("receipt") || t.includes("payment") && t.includes("received"))
    return { action: "get_receipts", limit: 10 };
  if ((t.includes("send") || t.includes("email")) && t.includes("invoice")) {
    const invM = text.match(/\d+\/?\d{0,4}-?\d{0,2}/);
    const emailM = text.match(/[\w.-]+@[\w.-]+\.\w+/);
    return { action: "send_email", invoice_no: invM?.[0] ?? null, email_to: emailM?.[0] ?? null };
  }
  if (t.includes("help") || t === "/help")
    return { action: "help" };
  const invPat = text.match(/\d+\/\d{4}-\d{2,4}/);
  if (invPat || t.includes("invoice"))
    return { action: "get_invoice", invoice_no: invPat?.[0] ?? null };
  return { action: "unknown" };
}
async function getGraphToken() {
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET)
    throw new Error("Graph API credentials not configured");
  const res = await fetch(
    `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: GRAPH_CLIENT_ID,
        client_secret: GRAPH_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default"
      })
    }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description ?? "Failed to get Graph token");
  return data.access_token;
}
async function sendEmailViaGraph(to, subject, html) {
  const token = await getGraphToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${EMAIL_FROM}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
          from: { emailAddress: { address: EMAIL_FROM, name: FIRM_DISPLAY_NAME } }
        },
        saveToSentItems: true
      })
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph sendMail failed (${res.status}): ${err.slice(0, 200)}`);
  }
}
function buildInvoiceEmailHtml(d) {
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
    <p style="margin:0 0 20px;font-size:14px;color:#374151;">Please find below your invoice details from ${d.firmName}:</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 24px;">
      <tr style="background:#f8fafc;"><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:40%;">Invoice Number</td><td style="padding:10px 16px;border:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#111827;">${d.invoiceNo}</td></tr>
      <tr><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;">Invoice Date</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#111827;">${d.invoiceDate}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;">Amount</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:14px;font-weight:700;color:#1a3a5c;">\u20B9${d.amount}</td></tr>
      <tr><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;color:#6b7280;">Due Date</td><td style="padding:10px 16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;font-weight:600;color:#dc2626;">${d.dueDate}</td></tr>
    </table>
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
      <tr><td style="background:#1a3a5c;border-radius:6px;padding:12px 28px;"><a href="#" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">View Invoice \u2192</a></td></tr>
    </table>
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
async function sendMsg(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[Bot] sendMessage failed:", err.slice(0, 300));
    if (err.includes("parse entities") || err.includes("Bad Request")) {
      const plain = text.replace(/[*_`\[\]()~>#+\-=|{}.!\\]/g, "");
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: plain })
      });
    }
  }
}
async function sendTelegram(chatId, text, parseMode = null) {
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[Bot] sendTelegram failed:", err.slice(0, 200));
  }
}
async function sendDocument(chatId, fileUrl, fileName) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, document: fileUrl, caption: fileName })
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[Bot] sendDocument failed:", err.slice(0, 200));
  }
}
async function fetchClientNames(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return {};
  const { data } = await supabase.from("clients").select("id,name").in("id", uniqueIds);
  const map = {};
  data?.forEach((c) => {
    map[c.id] = c.name ?? "Unknown";
  });
  return map;
}
async function fetchClientNamesWithEmail(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return {};
  const { data } = await supabase.from("clients").select("id,name,email").in("id", uniqueIds);
  const map = {};
  data?.forEach((c) => {
    map[c.id] = { name: c.name ?? "Unknown", email: c.email ?? null };
  });
  return map;
}
function escMd(s) {
  if (s == null) return "";
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
function fmtNum(n) {
  return Math.round(n).toLocaleString("en-IN");
}
function fmtDate(d) {
  if (!d) return "\u2014";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  } catch {
    return d;
  }
}
function trunc(s, max) {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function statusIcon(s) {
  switch (s) {
    case "paid":
      return "\u2705";
    case "sent":
      return "\u2709\uFE0F";
    case "finalized":
      return "\u{1F4CB}";
    case "draft":
      return "\u{1F4DD}";
    case "voided":
      return "\u274C";
    default:
      return "\u{1F4C4}";
  }
}
function docTypeLabel(t) {
  switch (t) {
    case "invoice":
      return "Invoice";
    case "quotation":
      return "Quotation";
    case "proforma":
      return "Proforma Invoice";
    case "credit_note":
      return "Credit Note";
    default:
      return "Document";
  }
}
function isOverdue(inv) {
  if (!inv.due_date || inv.status === "paid" || inv.status === "voided") return false;
  return new Date(inv.due_date) < /* @__PURE__ */ new Date();
}
function daysDiff(date) {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 864e5);
}
function sum(items) {
  return items.reduce((s, i) => s + (i.total_amount ?? i.amount ?? 0), 0);
}
function getFY(d) {
  const m = d.getMonth();
  const y = d.getFullYear();
  return m >= 3 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}
