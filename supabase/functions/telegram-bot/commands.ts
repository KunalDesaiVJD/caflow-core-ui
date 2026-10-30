/**
 * Instant slash commands for the Telegram billing bot — answered straight from the
 * database, no AI involved, so they work even when the AI service is down or slow.
 * Plain text (no Markdown) so names with * _ [ ] never break a message.
 */
import { drCr, inr } from "../_shared/botAgent.ts";
import type { createBillingTools } from "./billingTools.ts";
import type { createReportTools } from "./reportTools.ts";

type Tools = ReturnType<typeof createBillingTools>;
type Report = { report: ReturnType<typeof createReportTools>; chatId: number };

export const HELP_TEXT = [
  "CAFlow Billing — commands",
  "",
  "/statement <client or group> — statement of account PDF (as in Billing → Reports)",
  "/report [group | firm] — sundry debtors: top balances by client, group or firm",
  "/summary — receivables by firm, overdue, today's receipts",
  "/outstanding [client] — open invoices (all, or one client)",
  "/overdue [client] — invoices past due date",
  "/balance <client> — client's balance with each firm",
  "/group <name> — group statement: each client, amount payable per firm",
  "/groups — groups ranked by receivable",
  "/ageing — 0-30 / 31-60 / 61-90 / 90+ days",
  "/receipts [client] — receipts in the last 30 days",
  "/reminders — automatic payment-reminder runs",
  "/emails [client] — billing emails sent in the last 7 days",
  "/cancelled — cancelled invoices / credit notes",
  "/reset — start a fresh conversation",
  "/myid — your Telegram ID",
  "",
  "Or just ask in plain words, e.g. \"send me the statement of Nirali group without Nirali Exports\", \"email Ramani group statement\", \"how much did we collect in September?\", \"who has not paid for 90 days?\", \"which clients are not in any group?\"",
].join("\n");

const line = (n: number, s: string) => `${n}. ${s}`;

export async function runCommand(cmd: string, arg: string, tools: Tools, ctx?: Report): Promise<string | null> {
  switch (cmd) {
    case "statement":
    case "ledger": {
      if (!ctx) return null;
      if (!arg) return "Usage: /statement <client name> or /statement <group name> group";
      const asGroup = /\bgroup\b/i.test(arg);
      const name = arg.replace(/\bgroup\b/i, "").trim() || arg;
      // A name can be a client or a group: try the one it says, then the other.
      let res: any = await ctx.report.sendStatement(ctx.chatId, asGroup ? { group_name: name } : { client_name: name });
      if (res.error && /^No (client|client group) matches/.test(res.error)) {
        const other: any = await ctx.report.sendStatement(ctx.chatId, asGroup ? { client_name: name } : { group_name: name });
        if (!other.error || !/^No (client|client group) matches/.test(other.error)) res = other;
      }
      if (res.error) return res.error;
      const due = (res.payment_advice || []).filter((p: any) => p.closing > 0);
      return [`Sent ${res.file}`, ...(res.note ? [res.note] : []), "",
        ...(due.length ? ["Amount payable:", ...due.slice(0, 30).map((p: any) => `  ${p.client} → ${p.firm}: ${inr(p.closing)}`)] : ["Nothing payable."]),
      ].join("\n");
    }

    case "report": {
      if (!ctx) return null;
      const view = /group/i.test(arg) ? "group" : /firm/i.test(arg) ? "firm" : "client";
      const res: any = await ctx.report.getReport({ view_by: view, balance: "receivable", limit: 25 });
      if (res.error) return res.error;
      const out = [`Sundry debtors by ${view} — ${res.period}`, `Receivable ${inr(res.totals.gross_receivable)} · advances ${inr(res.totals.advances)}`, ""];
      res.rows.forEach((r: any, i: number) => out.push(line(i + 1, `${r.name}: ${drCr(r.closing)}${r.clients ? ` (${r.clients} clients)` : ""}`)));
      if (res.rows_matching > res.rows.length) out.push("", `…${res.rows_matching - res.rows.length} more. Ask in plain words for any other period or filter.`);
      return out.join("\n");
    }

    case "help":
    case "start":
      return HELP_TEXT;

    case "summary": {
      const [f, a, r] = await Promise.all([tools.getFirmSummary(), tools.getAgeing({}), tools.getReceipts({ from_date: undefined, limit: 100 })]);
      const today = (f as any).as_on;
      const todays = (r as any).receipts?.filter((x: any) => x.date === today) || [];
      const out = [`Billing summary — ${today}`, "",
        `Total receivable: ${inr(f.total_receivable)}`, `Overdue: ${inr(f.total_overdue)}`, ""];
      f.firms.forEach((x: any, i: number) => out.push(line(i + 1, `${x.firm}: ${inr(x.receivable)} (overdue ${inr(x.overdue)}, ${x.clients_with_balance} clients)`)));
      const b = (a as any).buckets || {};
      out.push("", `Ageing: not due ${inr(b.not_due)} · 0-30 ${inr(b.d0_30)} · 31-60 ${inr(b.d31_60)} · 61-90 ${inr(b.d61_90)} · 90+ ${inr(b.d90_plus)}`);
      out.push(`Receipts today: ${todays.length} · ${inr(todays.reduce((s: number, x: any) => s + x.received + x.tds + x.gst_tds, 0))}`);
      return out.join("\n");
    }

    case "outstanding":
    case "overdue": {
      const res: any = await tools.getOutstanding({ client_name: arg || undefined, overdue_only: cmd === "overdue", limit: 30 });
      if (res.error) return res.error;
      if (!res.count) return cmd === "overdue" ? "No overdue invoices." : "No outstanding invoices.";
      const out = [`${cmd === "overdue" ? "Overdue" : "Outstanding"} invoices${arg ? ` — ${arg}` : ""}: ${res.count}`,
        `Total: ${inr(cmd === "overdue" ? res.overdue_total : res.total_outstanding)}`, ""];
      res.invoices.forEach((i: any, n: number) =>
        out.push(line(n + 1, `${i.invoice_no} · ${i.client} · ${inr(i.amount_due)}${i.days_overdue ? ` · ${i.days_overdue}d overdue` : i.due_date ? ` · due ${i.due_date}` : ""}`)));
      if (res.count > res.showing) out.push("", `…and ${res.count - res.showing} more.`);
      return out.join("\n");
    }

    case "balance": {
      if (!arg) return "Usage: /balance <client name>";
      const res: any = await tools.getClientBalance({ client_name: arg });
      if (res.error) return res.error;
      const out: string[] = [];
      for (const c of res.clients) {
        out.push(`${c.client}${c.groups.length ? ` (group: ${c.groups.join(", ")})` : ""}`);
        if (!c.by_firm.length) out.push("  Nil balance");
        c.by_firm.forEach((b: any) => out.push(`  ${b.firm}: ${drCr(b.closing)}`));
        if (c.by_firm.length > 1) out.push(`  Total: ${drCr(c.total_closing)}`);
        out.push(`  Open invoices: ${c.open_invoices}${c.last_receipt ? ` · last receipt ${c.last_receipt.date} ${inr(c.last_receipt.amount)}` : ""}`, "");
      }
      if (res.more_matches) out.push(`${res.more_matches} more clients match — type more of the name.`);
      return out.join("\n").trim();
    }

    case "group": {
      if (!arg) return "Usage: /group <group name>";
      const res: any = await tools.getGroupBalances({ group_name: arg });
      if (res.error) return res.error;
      const out = [`Group: ${res.group} (${res.clients_in_group} clients)`, "Amount payable — one payment per line:", ""];
      if (!res.clients.length) out.push("No balance outstanding.");
      res.clients.forEach((c: any) => {
        out.push(c.client);
        c.payment_advice.forEach((p: any) => out.push(`  → ${p.firm}: ${p.closing > 0 ? inr(p.closing) : `Nil (advance ${inr(-p.closing)})`}`));
      });
      if (res.other_matches?.length) out.push("", `Other groups matching: ${res.other_matches.join(", ")}`);
      out.push("", "Ask \"send the statement of this group\" for the PDF.");
      return out.join("\n");
    }

    case "groups": {
      const res: any = await tools.getGroupBalances({ limit: 25 });
      const out = [`Groups by receivable (${res.groups_with_balance} with a balance)`, ""];
      res.groups.forEach((g: any, i: number) => out.push(line(i + 1, `${g.group}: ${inr(g.receivable)} (${g.clients} clients)`)));
      out.push("", `Not in any group: ${inr(res.not_in_any_group_receivable)}`);
      return out.join("\n");
    }

    case "ageing":
    case "aging": {
      const res: any = await tools.getAgeing({ firm_name: arg || undefined });
      if (res.error) return res.error;
      const b = res.buckets;
      return [`Ageing of open invoices — ${res.as_on} (${res.open_invoices} invoices)`, "",
        `Not yet due: ${inr(b.not_due)}`, `0-30 days: ${inr(b.d0_30)}`, `31-60 days: ${inr(b.d31_60)}`,
        `61-90 days: ${inr(b.d61_90)}`, `90+ days: ${inr(b.d90_plus)}`, ...(b.no_due_date ? [`No due date: ${inr(b.no_due_date)}`] : [])].join("\n");
    }

    case "receipts": {
      const res: any = await tools.getReceipts({ client_name: arg || undefined, limit: 25 });
      if (res.error) return res.error;
      const out = [`Receipts ${res.from} to ${res.to}: ${res.count}`, `Received ${inr(res.total_received)} · TDS ${inr(res.total_tds)}`, ""];
      res.receipts.forEach((r: any, i: number) =>
        out.push(line(i + 1, `${r.date} · ${r.client} · ${inr(r.received)}${r.tds + r.gst_tds ? ` + TDS ${inr(r.tds + r.gst_tds)}` : ""}${r.mode ? ` · ${r.mode}` : ""}`)));
      return out.join("\n");
    }

    case "reminders": {
      const res: any = await tools.getReminderStatus({ days: 7 });
      const out = [`Payment reminders since ${res.since}: ${res.reminders_sent} sent, ${res.reminders_failed} failed`, ""];
      res.runs.forEach((r: any, i: number) => out.push(line(i + 1, `${String(r.started_at).slice(0, 16).replace("T", " ")} · ${r.trigger} · sent ${r.sent ?? 0} · failed ${r.failed ?? 0}${r.error ? ` · ${r.error}` : ""}`)));
      if (res.note) out.push(res.note);
      return out.join("\n");
    }

    case "emails": {
      const res: any = await tools.getEmailLog({ client_name: arg || undefined, days: 7, limit: 25 });
      if (res.error) return res.error;
      const out = [`Billing emails in the last 7 days: ${res.count} (${res.failed} failed)`, ""];
      res.emails.forEach((e: any, i: number) => out.push(line(i + 1, `${String(e.at).slice(0, 16).replace("T", " ")} · ${e.type.replace(/_/g, " ")} · ${e.to || "—"} · ${e.status}`)));
      return out.join("\n");
    }

    case "cancelled": {
      const res: any = await tools.getCancelled({ days: 90 });
      if (res.error) return res.error;
      const out = [`Cancelled documents (last 90 days): ${res.count}`, ""];
      res.documents.forEach((d: any, i: number) => out.push(line(i + 1, `${d.no} · ${d.client} · ${inr(d.amount)}${d.reason ? ` · ${d.reason}` : ""}`)));
      return out.join("\n");
    }

    default:
      return null;   // not a command — handled by the AI
  }
}

/** Morning digest pushed to every allowed user. */
export async function buildDigest(tools: Tools): Promise<string> {
  const [f, a, rem, mails] = await Promise.all([
    tools.getFirmSummary(), tools.getAgeing({}), tools.getReminderStatus({ days: 1 }), tools.getEmailLog({ days: 1, limit: 100 }),
  ]);
  const rc: any = await tools.getReceipts({ limit: 100 });
  const yesterday = (() => { const d = new Date((f as any).as_on + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  const yRec = (rc.receipts || []).filter((r: any) => r.date === yesterday);
  const b = (a as any).buckets || {};
  return [
    `Good morning — CAFlow billing, ${(f as any).as_on}`, "",
    `Receivable: ${inr(f.total_receivable)}  ·  Overdue: ${inr(f.total_overdue)}`,
    `90+ days: ${inr(b.d90_plus)}  ·  61-90: ${inr(b.d61_90)}`,
    `Receipts yesterday: ${yRec.length} · ${inr(yRec.reduce((s: number, r: any) => s + r.received + r.tds + r.gst_tds, 0))}`,
    `Reminders (24h): ${(rem as any).reminders_sent} sent, ${(rem as any).reminders_failed} failed`,
    `Billing emails (24h): ${(mails as any).count}${(mails as any).failed ? ` (${(mails as any).failed} failed)` : ""}`,
    "", "Type /summary, /overdue or /groups for details.",
  ].join("\n");
}
