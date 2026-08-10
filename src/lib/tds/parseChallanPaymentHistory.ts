/**
 * parseChallanPaymentHistory — reads the ITD portal's own Payment History
 * export (e-File → e-Pay Tax → Income Tax Act, 2025 → Payment History →
 * Actions → Download) into per-challan rows: serial number, deposit date,
 * amount. Replaces the old CSI flow (see TdsChallanCsiValidation's removed
 * header doc) — a CSI file is hash-lines only and was never actually
 * checkable per-challan; this PDF is a genuine report.
 *
 * NOTE — first pass, not yet verified against a real export: no sample
 * Payment History PDF was available while building this, so the column
 * extraction below is a best-effort reconstruction of OLTAS's own CIN
 * convention (BSR Code [7 digits] + Date of Deposit + Challan Serial No
 * [≤5 digits]), not something confirmed against the live portal's actual
 * layout. Expect to adjust the regexes in `extractRow` once a real export
 * is uploaded — everything else (row grouping, the public parse function's
 * shape) should not need to change.
 *
 * Reuses pdfToTextPages (src/lib/tds/pdfText.ts) — the same positioned-text
 * extraction already powering the Stage-3 Tally PDF import — so no new PDF
 * dependency, and rows are grouped from positioned text runs the same way
 * tallyPdf.ts's toBands() groups Tally ledger entries: text runs whose y
 * (baseline) falls within a small tolerance band belong to the same table
 * row, then sorted left-to-right by x.
 */
import type { PdfTextItem } from "./tallyPdf";
import { pdfToTextPages } from "./pdfText";

export interface PortalChallanRow {
  serialNo: string;
  depositDate: string; // normalized to yyyy-mm-dd, matching tds_challans.deposit_date's own format
  amount: number;
  // null when the row's BSR code couldn't be isolated (the digit-token
  // fallback path below doesn't determine one) — never treated as a
  // mismatch by matchChallanDownload.ts in that case, only compared when
  // actually present. See this file's own top-of-file "first pass" note:
  // whether the real PDF exposes BSR as its own reliably-extractable token
  // (vs. folded into a combined CIN) is not yet confirmed against a real
  // downloaded export.
  bsrCode: string | null;
}

const ROW_BAND_TOL = 3;

const DATE_RE = /\b(\d{1,2})[-/](\d{1,2}|[A-Za-z]{3})[-/](\d{2,4})\b/;
const AMOUNT_RE = /(?:₹|Rs\.?\s*)?([\d,]+\.\d{2})\b/g;
const BSR_RE = /\b(\d{7})\b/;
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function normalizeDate(d: string, m: string, y: string): string {
  const mm = /^[A-Za-z]{3}$/.test(m) ? (MONTHS[m.toLowerCase()] ?? "01") : m.padStart(2, "0");
  const yyyy = y.length === 2 ? `20${y}` : y;
  return `${yyyy}-${mm}-${d.padStart(2, "0")}`;
}

/** Group text runs into table rows — same banding technique as tallyPdf.ts's
 *  toBands(), generalized here since Payment History isn't a Tally ledger. */
function toRows(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const rows: PdfTextItem[][] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= ROW_BAND_TOL) last.push(it);
    else rows.push([it]);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

/** Extracts a challan row from one table row's text runs, or null if this
 *  row doesn't look like a challan line (header/footer/blank rows). */
function extractRow(row: PdfTextItem[]): PortalChallanRow | null {
  const tokens = row.map((i) => i.str.trim()).filter(Boolean);
  const line = tokens.join(" ");

  const dateMatch = line.match(DATE_RE);
  if (!dateMatch) return null;
  const depositDate = normalizeDate(dateMatch[1], dateMatch[2], dateMatch[3]);

  const amounts = [...line.matchAll(AMOUNT_RE)];
  if (!amounts.length) return null;
  // Amount is conventionally the rightmost money-shaped figure on the row.
  const amount = parseFloat(amounts[amounts.length - 1][1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;

  // CIN convention: BSR Code (7 digits) immediately followed by the Challan
  // Serial No (≤5 digits) as separate tokens. Fall back to the last bare
  // digit-only token on the row that isn't the BSR code, a date component,
  // or part of an amount — whatever's left is treated as the serial no.
  const bsrIdx = tokens.findIndex((t) => BSR_RE.test(t) && t.length === 7);
  let serialNo: string | null = null;
  let bsrCode: string | null = null;
  if (bsrIdx !== -1 && tokens[bsrIdx + 1] && /^\d{1,5}$/.test(tokens[bsrIdx + 1])) {
    serialNo = tokens[bsrIdx + 1];
    bsrCode = tokens[bsrIdx];
  } else {
    const amountStrs = new Set(amounts.map((m) => m[1]));
    const digitTokens = tokens.filter(
      (t) => /^\d{1,5}$/.test(t) && !amountStrs.has(t) && t !== dateMatch[1] && t !== dateMatch[3],
    );
    serialNo = digitTokens.length ? digitTokens[digitTokens.length - 1] : null;
    // No BSR determined on this fallback path — the row didn't contain a
    // recognisable standalone 7-digit BSR token, so bsrCode stays null
    // rather than guessing.
  }
  if (!serialNo) return null;

  return { serialNo, depositDate, amount, bsrCode };
}

/** Pure page-level parse — takes pdfjs's own positioned text runs directly,
 *  so tests can construct fixture pages the same way tallyPdf.test.ts does
 *  (see PdfTextItem there) without needing a real PDF file. */
export function parseChallanPaymentHistoryPages(pages: PdfTextItem[][]): PortalChallanRow[] {
  const rows: PortalChallanRow[] = [];
  for (const page of pages) {
    for (const row of toRows(page)) {
      const parsed = extractRow(row);
      if (parsed) rows.push(parsed);
    }
  }
  return rows;
}

/** Parses every page of a downloaded Payment History PDF into challan rows.
 *  Returns [] (never throws) if nothing challan-shaped is found — callers
 *  should treat an empty result as "doesn't look like a Payment History
 *  export" and surface that to the user, same fail-loud posture the old
 *  CSI parser used for a file that wasn't CSI-shaped. */
export async function parseChallanPaymentHistory(file: File): Promise<PortalChallanRow[]> {
  const pages = await pdfToTextPages(file);
  return parseChallanPaymentHistoryPages(pages);
}
