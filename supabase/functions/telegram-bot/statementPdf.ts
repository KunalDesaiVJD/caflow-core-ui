/**
 * The Billing → Reports statement of account, built on the server for the Telegram bot.
 * Same data rules (_shared/statement/report.ts) and the same PDF layout
 * (_shared/statement/pdf.ts) as the Report tab's Download / Email / WhatsApp buttons.
 */
import { jsPDF } from "npm:jspdf@4.2.1";
import autoTable from "npm:jspdf-autotable@5.0.7";
import { fontBinary, type PdfFontFiles } from "../_shared/statement/font.ts";
import { firmBankDetailsOf } from "../_shared/statement/layout.ts";
import { renderStatementPdf } from "../_shared/statement/pdf.ts";
import { loadReportStatement } from "../_shared/statement/report.ts";

const APP_URL = (Deno.env.get("APP_URL") || "https://app.vjdesai.com").replace(/\/$/, "");

let fonts: Promise<PdfFontFiles> | null = null;
function loadFonts(): Promise<PdfFontFiles> {
  const get = async (file: string) => {
    const r = await fetch(`${APP_URL}/fonts/${file}`);
    if (!r.ok) throw new Error(`PDF font ${file} could not be loaded (${r.status})`);
    return fontBinary(await r.arrayBuffer());
  };
  fonts ??= Promise.all([get("NotoSans-Regular.ttf"), get("NotoSans-Bold.ttf")])
    .then(([normal, bold]) => ({ normal, bold }))
    .catch(e => { fonts = null; throw e; });
  return fonts;
}

async function logoDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "image/png";
    return `data:${type};base64,${btoa(fontBinary(await r.arrayBuffer()))}`;
  } catch { return null; }
}

/** "2026-27" for a date in that Indian financial year. */
export function fyOf(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
/** Default period: start of the current financial year → today (India). */
export function defaultPeriod(todayIso: string): { from: string; to: string } {
  return { from: `${fyOf(todayIso).slice(0, 4)}-04-01`, to: todayIso };
}

export interface StatementResult {
  bytes: Uint8Array;
  filename: string;
  name: string;
  clients: number;
  /** Each client's closing with each firm (for the chat message). */
  payments: { client: string; firm: string; closing: number }[];
}

/**
 * Build the statement PDF for one client or for a group's clients (optionally only some of them).
 * Returns null when there is nothing in the period.
 */
export async function buildReportStatementPdf(db: any, o: {
  kind: "client" | "group"; name: string; clientIds: string[];
  fromDate: string; toDate: string; firmIds?: string[];
}): Promise<StatementResult | null> {
  const { data: firmRows } = await db.from("firms").select("id, name, settings, bank_details").order("name");
  const firmNames: Record<string, string> = {};
  for (const f of firmRows || []) firmNames[f.id] = f.name || "—";
  const clientNames: Record<string, string> = {};
  for (let i = 0; i < o.clientIds.length; i += 150) {
    const { data } = await db.from("clients").select("id, name").in("id", o.clientIds.slice(i, i + 150));
    for (const c of data || []) clientNames[c.id] = c.name || "—";
  }

  const single = o.kind === "client";
  const st = await loadReportStatement(db, {
    clientIds: o.clientIds, fromDate: o.fromDate, toDate: o.toDate,
    firmIds: o.firmIds, firmNames, clientNames, single,
  });
  if (st.perClient.length === 0) return null;

  const firms = (firmRows || []).filter((f: any) => st.firmIds.includes(f.id));
  const onlyFirm = firms.length === 1 ? firms[0] : null;
  const doc = renderStatementPdf({ jsPDF, autoTable, fonts: await loadFonts() }, {
    groupName: o.name,
    firmLabel: firms.map((f: any) => f.name).filter(Boolean).join(", "),
    logoDataUrl: await logoDataUrl(onlyFirm?.settings?.logo_url),
    fromDate: o.fromDate, toDate: o.toDate, perClient: st.perClient,
    bankDetails: firms.map(firmBankDetailsOf).filter(Boolean) as any,
    payments: st.payments,
    single,
  });
  const safe = single ? o.name.replace(/\s+/g, "_") : o.name.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    filename: single ? `Statement_of_Account_${safe}_${o.toDate}.pdf` : `Statement_of_Account_${safe}_${o.fromDate}_${o.toDate}.pdf`,
    name: o.name,
    clients: st.perClient.length,
    payments: st.payments.filter(p => Math.abs(p.closing) >= 0.5)
      .map(p => ({ client: p.clientName, firm: p.firmName, closing: p.closing })),
  };
}
