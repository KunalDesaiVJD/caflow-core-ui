/**
 * Telegram billing bot — pure helpers (no Deno / network), unit-tested from src/lib.
 *
 * The bot's AI runs either on the Anthropic API (native tool calling) or through the
 * Claude CLI gateway, which only takes and returns text. For the text path the model is
 * shown the tool catalogue and must answer with ONE JSON object per turn — either a tool
 * call or the final reply — which `parseAgentAction` reads back. That keeps real billing
 * data behind the tools on both backends instead of letting the model answer from memory.
 */

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, any>; required?: string[] };
}

export type AgentAction =
  | { type: "tool"; name: string; input: Record<string, any> }
  | { type: "reply"; text: string };

/** Tool list as plain text, for a model that cannot take native tool definitions. */
export function toolCatalogText(tools: ToolDef[]): string {
  return tools.map(t => {
    const props = Object.entries(t.input_schema.properties || {})
      .map(([k, v]: [string, any]) => `    - ${k}${t.input_schema.required?.includes(k) ? " (required)" : ""}: ${v.type || "any"} — ${v.description || ""}`)
      .join("\n");
    return `• ${t.name}: ${t.description}${props ? `\n  input:\n${props}` : ""}`;
  }).join("\n");
}

/** Instructions that make a text-only model drive the tools one JSON object at a time. */
export function agentProtocol(tools: ToolDef[]): string {
  return `
TOOLS — you have no direct database access; call these to get real data:
${toolCatalogText(tools)}

RESPONSE FORMAT — reply with exactly ONE JSON object and nothing else:
  {"action":"tool","name":"<tool name>","input":{...}}   to call a tool, or
  {"action":"reply","text":"<final answer for the user>"}  when you are done.
After a tool call you will receive "TOOL RESULT <name>: <json>". Call tools as many times as
needed (max 6), then reply. Never invent figures — every amount must come from a tool result.
The reply text may use Telegram Markdown (*bold*, _italic_, \`code\`).`;
}

/** First JSON object in a model reply (tolerates ```json fences and surrounding prose). */
function firstJsonObject(text: string): any | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

/** Reads the model's turn. Anything that is not a valid tool call is treated as the final reply. */
export function parseAgentAction(text: string, toolNames: string[]): AgentAction {
  const obj = firstJsonObject(text || "");
  if (obj && obj.action === "tool" && typeof obj.name === "string" && toolNames.includes(obj.name)) {
    return { type: "tool", name: obj.name, input: obj.input && typeof obj.input === "object" ? obj.input : {} };
  }
  if (obj && obj.action === "reply" && typeof obj.text === "string") return { type: "reply", text: obj.text };
  return { type: "reply", text: (text || "").trim() || "Sorry, I could not work that out. Please rephrase." };
}

// ─── Formatting / maths shared by commands and tools ──────────────────────────

export const inr = (n: number) =>
  `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "₹1,000.00 Dr" / "₹500.00 Cr" / "Nil". */
export const drCr = (n: number) => (Math.abs(n) < 0.005 ? "Nil" : `${inr(Math.abs(n))} ${n > 0 ? "Dr" : "Cr"}`);

/** Due date: stored, or invoice date + payment terms (invoices saved before due dates were stored). */
export function dueDateOf(inv: { due_date?: string | null; invoice_date?: string | null; payment_due_days?: number | null }): string | null {
  if (inv.due_date) return String(inv.due_date).slice(0, 10);
  if (!inv.invoice_date || inv.payment_due_days == null) return null;
  const d = new Date(String(inv.invoice_date).slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.floor(Number(inv.payment_due_days)));
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((new Date(toIso + "T00:00:00Z").getTime() - new Date(fromIso + "T00:00:00Z").getTime()) / 86400000);

/** Ageing of open invoices by days past due: Not due, 0–30, 31–60, 61–90, 90+. */
export function ageingBuckets(invoices: { due: string | null; amount_due: number }[], todayIso: string) {
  const b = { not_due: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, no_due_date: 0 };
  for (const i of invoices) {
    const amt = Number(i.amount_due) || 0;
    if (amt <= 0) continue;
    if (!i.due) { b.no_due_date += amt; continue; }
    const days = daysBetween(i.due, todayIso);
    if (days <= 0) b.not_due += amt;
    else if (days <= 30) b.d0_30 += amt;
    else if (days <= 60) b.d31_60 += amt;
    else if (days <= 90) b.d61_90 += amt;
    else b.d90_plus += amt;
  }
  return b;
}

/** Splits a long Telegram message on line breaks so each part stays under the 4,096-char limit. */
export function chunkMessage(text: string, max = 3800): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + "\n" + line).length > max && cur) { out.push(cur); cur = line; }
    else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) out.push(cur);
  return out;
}

/** "/cmd rest of text" → { cmd, arg }; also accepts "/cmd@BotName". */
export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec((text || "").trim());
  return m ? { cmd: m[1].toLowerCase(), arg: (m[2] || "").trim() } : null;
}

// ─── Direct statement requests (no AI needed) ─────────────────────────────────

const STATEMENT_WORDS = /\b(ledger|ledgers|statement|statements|soa|khata|hisab|hisaab|account\s+copy|account\s+statement)\b/i;
// Anything that needs the AI's judgement: emailing / WhatsApp, a period, a firm, or picking clients.
const NEEDS_AI = /\b(mail|email|e-mail|whatsapp|wa|to\s+\S+@|fy|financial\s+year|from|till|upto|up\s+to|as\s+on|last\s+year|previous|month|quarter|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|20\d\d|without|except|excluding|only|firm|vjd|kda)\b/i;
const FILLER = /\b(please|pls|plz|kindly|give|send|share|get|need|want|show|me|my|us|the|a|an|of|for|whole|full|complete|entire|pdf|copy|in|on|this|chat|here|ledger|ledgers|statement|statements|soa|khata|hisab|hisaab|account|client|party|and|bhejo|bhej|do|de|dena|chahiye|ka|ki|ke|nu|no|ni)\b/gi;

/**
 * "send ledger of Ramani group" → { name: "Ramani", group: true }. Null when the message is not
 * a plain statement request (then the AI handles it). After the bot asked which group, a short
 * reply like "Ramani group" counts too.
 */
export function detectStatementRequest(text: string, lastBotMessage?: string): { name: string; group: boolean } | null {
  const t = (text || "").trim();
  if (!t || t.startsWith("/") || t.length > 120) return null;
  const askedForGroup = !!lastBotMessage && /which group|group name|name of the group/i.test(lastBotMessage);
  const askedForClient = !!lastBotMessage && /which client|client name|name of the client/i.test(lastBotMessage);
  if (!STATEMENT_WORDS.test(t) && !(askedForGroup || askedForClient)) return null;
  if (NEEDS_AI.test(t)) return null;
  // Several things asked at once ("ledger & last 2 invoices") — let the AI do all of it.
  if (/\b(invoice|invoices|bill|bills|receipt|receipts|outstanding|balance|due|dues|and|&)\b/i.test(t.replace(/\b(and co|& co)\b/gi, ""))) return null;
  const group = /\bgroup\b/i.test(t) || (askedForGroup && !askedForClient);
  const name = t.replace(/\bgroup\b/gi, " ").replace(FILLER, " ").replace(/[^\p{L}\p{N}.&'\- ]/gu, " ").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.split(" ").length > 6) return null;
  return { name, group };
}

// ─── Forgiving name matching ("Satve Realty" → SATVED REALTY) ─────────────────

const NAME_NOISE = new Set(["group", "pvt", "private", "ltd", "limited", "llp", "the", "and", "co", "m", "s", "ms", "prop"]);
/** Words of a name worth matching on (lower case, no punctuation or company suffixes). */
export const nameTokens = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length >= 2 && !NAME_NOISE.has(w));

/** Share of the query's words found at the start of (or containing) a word of the name, 0–1. */
export function nameScore(query: string, name: string): number {
  const q = nameTokens(query), n = nameTokens(name);
  if (!q.length) return 0;
  const hit = q.filter(w => n.some(x => x.startsWith(w) || w.startsWith(x) && x.length >= 3 || (w.length >= 4 && x.includes(w)))).length;
  return hit / q.length;
}

/** Rows whose name matches every word of the query, best first; empty when none does. */
export function bestNameMatches<T extends { name: string }>(query: string, rows: T[]): T[] {
  const scored = rows.map(r => ({ r, s: nameScore(query, r.name) })).filter(x => x.s >= 1);
  // Fewer extra words in the name = closer match.
  return scored.sort((a, b) => nameTokens(a.r.name).length - nameTokens(b.r.name).length).map(x => x.r);
}
