/**
 * Form 141 Schedule B — challan receipt and statement reconciliation.
 * ==================================================================
 *
 * After the tax is paid, the department hands back two PDFs: a Challan
 * Receipt and the Form 141 Challan-cum-statement itself. This module reads
 * them and checks what they say against what the engine computed.
 *
 * ── Why this is a parser and not another model call ───────────────────────
 *
 * Unlike a scanned sale deed, both documents are machine-generated PDFs with
 * a clean text layer and a fixed vocabulary. A deterministic parser is
 * therefore strictly better here: it is free, instant, byte-exact, and can be
 * pinned in a unit test against the real filed documents — none of which is
 * true of a vision call. Reserve the model for what genuinely needs judgment.
 *
 * ── Pattern-first, label-second ───────────────────────────────────────────
 *
 * The statement lays several fields out as a COLUMN BLOCK — four headings on
 * consecutive lines, then their four values — and at least one of those
 * values wraps across two lines ("Schedule B :- TDS on payment of Sale of /
 * immovable Property (800)"). Reading such a block positionally is fragile:
 * one wrap and every value shifts a row.
 *
 * So the primary strategy is to match each field by the SHAPE of its own
 * value against the whole document with whitespace collapsed, where wrapping
 * simply disappears:
 *
 *     CIN                    14 digits + a 4-letter bank code
 *     Acknowledgement no.    3 letters + 7 digits
 *     PAN                    5 letters, 4 digits, a letter
 *     Month of Deduction     Mmm-YYYY
 *
 * Label scanning is the fallback, for the genuinely generic values (BSR code,
 * challan number, amounts) where the shape alone would match half the page.
 *
 * ── Extraction failure is never a mismatch ────────────────────────────────
 *
 * The rule ackMismatch.ts already established for the quarterly forms holds
 * here unchanged: every check below fires ONLY on a field that was actually
 * read. An image-only scan, where everything comes back null, must never
 * reject a correct filing — that would make the feature useless for exactly
 * the documents most in need of a second pair of eyes.
 */

import { parseIndianAmount, parseIndianDate } from "./indianAmount";
import { nameCompare } from "./match";
import { MAJOR_HEAD_CODE, MINOR_HEAD_CODE, monthOfDeduction, taxYearForDate } from "./form141";
import type { Form141Finding } from "./form141Validate";
import type { Form141Statement } from "./form141ScheduleB";

// ─── What the documents carry ───────────────────────────────────────────────

export type ChallanDocumentKind = "receipt" | "statement" | "unknown";

export interface ChallanFields {
  documentKind: ChallanDocumentKind;

  /** Identifiers the government assigns — no computation can produce these. */
  acknowledgementNumber: string | null;
  cin: string | null;
  bsrCode: string | null;
  challanNo: string | null;
  bankReferenceNumber: string | null;

  /** Who and when. */
  pan: string | null;
  name: string | null;
  taxYear: string | null;
  monthOfDeduction: string | null;
  dateOfDeposit: string | null;
  tenderDate: string | null;
  dateOfEFiling: string | null;

  /** Which head the money went to. */
  majorHeadCode: string | null;
  minorHeadCode: string | null;

  bankName: string | null;
  modeOfPayment: string | null;

  /** Part C / Tax Deposit Details. */
  amountDeducted: number | null;
  interest: number | null;
  fee: number | null;
  total: number | null;
  /** "Total amount on which tax is required to be deducted". */
  totalAmountLiable: number | null;
}

const EMPTY: ChallanFields = {
  documentKind: "unknown",
  acknowledgementNumber: null, cin: null, bsrCode: null, challanNo: null, bankReferenceNumber: null,
  pan: null, name: null, taxYear: null, monthOfDeduction: null,
  dateOfDeposit: null, tenderDate: null, dateOfEFiling: null,
  majorHeadCode: null, minorHeadCode: null,
  bankName: null, modeOfPayment: null,
  amountDeducted: null, interest: null, fee: null, total: null, totalAmountLiable: null,
};

// ─── Text shaping ───────────────────────────────────────────────────────────

/** Non-empty trimmed lines, for label scanning. */
const toLines = (text: string): string[] =>
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** The whole document as one whitespace-collapsed string, so a value that
 *  wrapped across two lines reads as though it never did. */
const flatten = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Read a labelled value, tolerating both layouts these PDFs use:
 *
 *   "Date of Deposit : 02-Sep-2026"     — one line
 *   "Date of Deposit" / ":" / "02-..."  — label, separator and value split
 *
 * `stopAt` guards the column-block case: when the next non-separator line is
 * itself another known heading, there is no value here and null is the honest
 * answer, rather than silently returning the neighbouring column's title.
 */
function labelled(lines: string[], labelRe: RegExp, stopAt?: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(labelRe);
    if (!m) continue;

    // Value on the same line, after the label (and an optional colon).
    const rest = line.slice(m.index! + m[0].length).replace(/^\s*:\s*/, "").trim();
    if (rest) return rest;

    // Otherwise the next line that is not a bare separator.
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const next = lines[j].replace(/^:\s*/, "").trim();
      if (!next || next === ":") continue;
      if (stopAt && stopAt.test(next)) return null;
      return next;
    }
  }
  return null;
}

const money = (lines: string[], labelRe: RegExp): number | null =>
  parseIndianAmount(labelled(lines, labelRe));

// ─── Value shapes ───────────────────────────────────────────────────────────

/** CIN as the e-Pay Tax portal mints it: YYMMDD + an 8-digit serial + the
 *  bank's 4-letter code, e.g. 26090200117177ICIC. */
const CIN_RE = /\b(\d{14}[A-Z]{4})\b/;
/** Acknowledgement number: three letters then seven digits, e.g. BTA0188370. */
const ACK_RE = /\b([A-Z]{3}\d{7})\b/;
const PAN_RE = /\b([A-Z]{5}\d{4}[A-Z])\b/;
const TAX_YEAR_RE = /\b(20\d{2})-(\d{2})\b/g;
const MONTH_RE = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-20\d{2})\b/;
/** "Income Tax (Other than Companies) (0021)" */
const MAJOR_HEAD_RE = /Other\s+than\s+Companies\)\s*\((\d{4})\)/i;
/** "Schedule B :- TDS on payment of Sale of immovable Property (800)" */
const MINOR_HEAD_RE = /immovable\s+Property\s*\((\d{3})\)/i;

const first = (re: RegExp, hay: string): string | null => hay.match(re)?.[1] ?? null;

/**
 * A Tax Year, distinguished from a date that merely looks like one.
 *
 * "2026-27" and "2026-09" match the same shape, so pattern alone would read
 * the month out of an ISO date as a Tax Year. The tell is arithmetic: a Tax
 * Year's second half is always the following year's last two digits. Every
 * candidate is tested against that, and the first that survives wins.
 */
function findTaxYear(flat: string): string | null {
  for (const m of flat.matchAll(TAX_YEAR_RE)) {
    const start = Number(m[1]);
    if (String((start + 1) % 100).padStart(2, "0") === m[2]) return `${m[1]}-${m[2]}`;
  }
  return null;
}

// ─── The parser ─────────────────────────────────────────────────────────────

/**
 * Read either document. One function rather than two because the two PDFs
 * overlap in almost every field, and parsing them separately would mean two
 * places to fix when the portal changes a label.
 */
export function parseForm141Challan(text: string): ChallanFields {
  if (!text || !text.trim()) return { ...EMPTY };

  const lines = toLines(text);
  const flat = flatten(text);

  const documentKind: ChallanDocumentKind =
    /Challan-cum-statement|Form\s*141/i.test(flat) ? "statement"
    : /Challan\s+Receipt/i.test(flat) ? "receipt"
    : "unknown";

  // A heading line, for the stopAt guard on column blocks.
  const HEADING_RE = /^(?:Tax year of transaction|Month of Deduction|Tax Applicable|Type of Payment|Residential Status|Type of Deductee|Payment Mode|Bank Name|Address|Contact Number|Email ID)/i;

  return {
    documentKind,

    acknowledgementNumber: first(ACK_RE, flat),
    cin: first(CIN_RE, flat),
    bsrCode: labelled(lines, /BSR\s*code/i),
    challanNo: labelled(lines, /Challan\s*No\b/i),
    bankReferenceNumber: labelled(lines, /Bank\s*Reference\s*Number/i),

    pan: first(PAN_RE, flat),
    name: labelled(lines, /^Name\b/i, HEADING_RE),
    taxYear: findTaxYear(flat),
    monthOfDeduction: first(MONTH_RE, flat),
    dateOfDeposit: parseIndianDate(labelled(lines, /Date\s*of\s*Deposit/i)),
    tenderDate: parseIndianDate(labelled(lines, /Tender\s*Date/i)),
    dateOfEFiling: parseIndianDate(labelled(lines, /Date\s*of\s*e-?Filing/i)),

    majorHeadCode: first(MAJOR_HEAD_RE, flat),
    minorHeadCode: first(MINOR_HEAD_RE, flat),

    bankName: labelled(lines, /^Bank\s*Name/i, HEADING_RE),
    modeOfPayment: labelled(lines, /Mode\s*of\s*Payment/i, HEADING_RE),

    // The (a)/(b)/(c) breakup appears in BOTH documents, identically.
    amountDeducted: money(lines, /\(a\)\s*Amount\s*deducted/i),
    interest: money(lines, /\(b\)\s*Interest/i),
    fee: money(lines, /\(c\)\s*Fee/i),
    total: money(lines, /Total\s*\(a\s*\+\s*b\s*\+\s*c\)/i),
    totalAmountLiable: money(lines, /Total\s+amount\s+on\s+which\s+tax\s+is\s+required\s+to\s+be\s+deducted/i),
  };
}

// ─── Merging the pair ───────────────────────────────────────────────────────

export interface MergedChallan {
  fields: ChallanFields;
  /** Fields the two documents disagree about. Any entry here means one of the
   *  uploads does not belong to the other. */
  conflicts: { field: keyof ChallanFields; receipt: unknown; statement: unknown }[];
}

const MERGE_KEYS: (keyof ChallanFields)[] = [
  "acknowledgementNumber", "cin", "bsrCode", "challanNo", "bankReferenceNumber",
  "pan", "taxYear", "monthOfDeduction", "dateOfDeposit",
  "majorHeadCode", "minorHeadCode",
  "amountDeducted", "interest", "fee", "total", "totalAmountLiable",
];

/**
 * Combine a receipt and a statement into one view, and report where they
 * disagree.
 *
 * The pair is the strongest evidence available: two independently generated
 * documents that must agree on the CIN, the acknowledgement number and the
 * amount. A conflict means the user has uploaded a receipt from one payment
 * and a statement from another — which is exactly the mix-up worth catching
 * before either is attached to a filing.
 */
export function mergeChallanDocuments(a: ChallanFields, b: ChallanFields): MergedChallan {
  const receipt = a.documentKind === "statement" ? b : a;
  const statement = a.documentKind === "statement" ? a : b;

  const fields: ChallanFields = { ...EMPTY, documentKind: statement.documentKind };
  const conflicts: MergedChallan["conflicts"] = [];

  for (const key of Object.keys(EMPTY) as (keyof ChallanFields)[]) {
    if (key === "documentKind") continue;
    const rv = receipt[key];
    const sv = statement[key];
    const present = rv ?? sv ?? null;
    (fields as Record<string, unknown>)[key] = present;

    if (MERGE_KEYS.includes(key) && rv !== null && sv !== null && rv !== sv) {
      conflicts.push({ field: key, receipt: rv, statement: sv });
    }
  }

  return { fields, conflicts };
}

// ─── Reconciliation ─────────────────────────────────────────────────────────

export interface ChallanReconContext {
  /** PAN the statement should be filed under — the buyer's. */
  filingBuyerPan: string | null;
  /** For the soft name check. */
  clientName?: string | null;
}

const inr = (n: number | null): string => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

/**
 * Check an uploaded challan pair against the statement the engine computed.
 *
 * The severity split follows the money:
 *
 *   • A SHORT payment blocks. If the challan carries less tax, interest or fee
 *     than the transaction requires, the shortfall is a live liability — and
 *     it is precisely what nobody notices, because the challan looks like a
 *     completed payment.
 *   • An OVERPAYMENT warns. It is either a genuine excess or evidence that our
 *     computation is wrong; both need a human, neither is an emergency.
 *   • A wrong PAN, head code, Tax Year or month BLOCKS. Those mean the money
 *     went somewhere other than where this transaction needed it.
 *   • The deductor's NAME only warns, even when it differs. PAN is the legal
 *     identifier; a proprietor's own name legitimately differs from the trade
 *     name on file. Same reasoning ackMismatch.ts applies to TAN.
 */
export function reconcileChallan(
  fields: ChallanFields,
  computed: Form141Statement,
  context: ChallanReconContext,
  conflicts: MergedChallan["conflicts"] = [],
): Form141Finding[] {
  const findings: Form141Finding[] = [];

  for (const c of conflicts) {
    findings.push({
      code: "challan_documents_disagree",
      severity: "blocking",
      field: String(c.field),
      message: `The receipt and the statement disagree on ${String(c.field)} (${String(c.receipt)} vs ${String(c.statement)}). They are not from the same payment — check which files were uploaded.`,
    });
  }

  // ── Identity ─────────────────────────────────────────────────────────────
  if (fields.pan && context.filingBuyerPan && fields.pan !== context.filingBuyerPan) {
    findings.push({
      code: "challan_pan_mismatch",
      severity: "blocking",
      field: "pan",
      ref: fields.pan,
      message: `The challan was paid under PAN ${fields.pan}, but this statement is filed under ${context.filingBuyerPan}. The payment belongs to a different deductor.`,
    });
  }

  if (fields.name && context.clientName) {
    const verdict = nameCompare(fields.name, context.clientName);
    if (verdict === "different" || verdict === "mismatch") {
      findings.push({
        code: "challan_name_differs",
        severity: "warning",
        field: "name",
        ref: fields.name,
        message: `The challan names "${fields.name}" where this client is recorded as "${context.clientName}". PAN settles identity, so this is worth a look rather than a block — a proprietor's own name often differs from the trade name.`,
      });
    }
  }

  // ── Head codes ───────────────────────────────────────────────────────────
  if (fields.majorHeadCode && fields.majorHeadCode !== MAJOR_HEAD_CODE) {
    findings.push({
      code: "challan_major_head_wrong",
      severity: "blocking",
      field: "majorHeadCode",
      ref: fields.majorHeadCode,
      message: `The challan was paid under major head ${fields.majorHeadCode}; Form 141 Schedule B requires ${MAJOR_HEAD_CODE} (Income Tax, other than Companies).`,
    });
  }
  if (fields.minorHeadCode && fields.minorHeadCode !== MINOR_HEAD_CODE) {
    findings.push({
      code: "challan_minor_head_wrong",
      severity: "blocking",
      field: "minorHeadCode",
      ref: fields.minorHeadCode,
      message: `The challan was paid under minor head ${fields.minorHeadCode}; TDS on sale of immovable property requires ${MINOR_HEAD_CODE}. The money has gone to the wrong head and will not settle this liability.`,
    });
  }

  // ── Period ───────────────────────────────────────────────────────────────
  if (fields.taxYear && fields.taxYear !== computed.taxYear) {
    findings.push({
      code: "challan_tax_year_mismatch",
      severity: "blocking",
      field: "taxYear",
      ref: fields.taxYear,
      message: `The challan is for Tax Year ${fields.taxYear}; this payment falls in ${computed.taxYear}.`,
    });
  }
  if (fields.monthOfDeduction && fields.monthOfDeduction !== computed.month) {
    findings.push({
      code: "challan_month_mismatch",
      severity: "blocking",
      field: "monthOfDeduction",
      ref: fields.monthOfDeduction,
      message: `The challan is for ${fields.monthOfDeduction}; tax on this payment was deducted in ${computed.month}.`,
    });
  }

  // ── Amounts ──────────────────────────────────────────────────────────────
  const compare = (
    label: string,
    paid: number | null,
    owed: number,
    field: string,
    shortCode: string,
    overCode: string,
  ) => {
    if (paid === null) return;
    if (paid < owed) {
      findings.push({
        code: shortCode,
        severity: "blocking",
        field,
        message: `The challan carries ${label} of ${inr(paid)} but ${inr(owed)} is due — short by ${inr(owed - paid)}. A completed-looking challan is exactly where a shortfall goes unnoticed.`,
      });
    } else if (paid > owed) {
      findings.push({
        code: overCode,
        severity: "warning",
        field,
        message: `The challan carries ${label} of ${inr(paid)} against ${inr(owed)} computed — ${inr(paid - owed)} more. Either an excess payment, or the transaction as recorded is wrong.`,
      });
    }
  };

  compare("tax", fields.amountDeducted, computed.totalTds, "amountDeducted", "challan_tds_short", "challan_tds_excess");
  compare("interest", fields.interest, computed.interest, "interest", "challan_interest_short", "challan_interest_excess");
  compare("fee", fields.fee, computed.fee, "fee", "challan_fee_short", "challan_fee_excess");

  if (
    fields.totalAmountLiable !== null &&
    fields.totalAmountLiable !== computed.totalAmountLiable
  ) {
    findings.push({
      code: "challan_liable_amount_mismatch",
      severity: "blocking",
      field: "totalAmountLiable",
      message: `The statement says tax was required on ${inr(fields.totalAmountLiable)}; this transaction computes ${inr(computed.totalAmountLiable)}.`,
    });
  }

  // The (a)+(b)+(c) identity, checked on the document's own figures — this is
  // the same class of intra-document arithmetic error that the filed sample
  // already proved the portal will accept.
  if (
    fields.total !== null &&
    fields.amountDeducted !== null && fields.interest !== null && fields.fee !== null
  ) {
    const sum = fields.amountDeducted + fields.interest + fee0(fields.fee);
    if (sum !== fields.total) {
      findings.push({
        code: "challan_breakup_inconsistent",
        severity: "blocking",
        field: "total",
        message: `The challan's own breakup does not add up: ${inr(fields.amountDeducted)} + ${inr(fields.interest)} + ${inr(fields.fee)} is ${inr(sum)}, but it states a total of ${inr(fields.total)}.`,
      });
    }
  }

  // ── Timing ───────────────────────────────────────────────────────────────
  if (fields.dateOfDeposit && fields.dateOfDeposit > computed.dueDate) {
    findings.push({
      code: "challan_deposited_late",
      severity: "warning",
      field: "dateOfDeposit",
      ref: fields.dateOfDeposit,
      message: `Deposited on ${fields.dateOfDeposit}, after the ${computed.dueDate} due date. Interest and fee should be on the challan — check they are.`,
    });
  }

  return findings;
}

const fee0 = (n: number | null): number => n ?? 0;

/**
 * The values worth writing onto tds_property_filings once a challan is
 * accepted — the government-assigned facts no computation can reproduce.
 */
export function challanFilingUpdate(fields: ChallanFields): Record<string, unknown> {
  return {
    acknowledgement_number: fields.acknowledgementNumber,
    cin: fields.cin,
    bsr_code: fields.bsrCode,
    challan_no: fields.challanNo,
    bank_reference_number: fields.bankReferenceNumber,
    bank_name: fields.bankName,
    payment_mode: fields.modeOfPayment,
    date_of_deposit: fields.dateOfDeposit,
    interest_amount: fields.interest ?? 0,
    fee_amount: fields.fee ?? 0,
    total_tds: fields.amountDeducted,
    total_payable: fields.total,
    total_amount_liable: fields.totalAmountLiable,
    status: "filed",
  };
}

export interface ChallanPeriod {
  taxYear: string | null;
  /** Month of Deduction as the document STATES it. Null when the document
   *  does not state it — never guessed from the deposit date. */
  month: string | null;
  /** True when the tax year had to be derived rather than read. */
  inferred: boolean;
}

/**
 * Derive the period a challan belongs to, for attaching it to the right
 * instalment when several are outstanding.
 *
 * The month is taken from the document or not at all. Tax deducted on 28
 * September and deposited on 3 October belongs to Sep-2026 — the deposit date
 * says nothing about the month of DEDUCTION, and the two fall in different
 * months on a large share of real filings. Deriving one from the other used
 * to look harmless because a wrong month usually matched nothing; the case
 * that is not harmless is a deal with a statement in the deposit month too,
 * where the challan silently attached to the wrong payment and carried its
 * acknowledgement number onto someone else's statement.
 *
 * So an unstated month stays null and the caller resolves it against the
 * statements it actually has — which it can do safely, because it knows how
 * many are outstanding. The tax year is still derived from the deposit date:
 * it is a far coarser bucket, and a deposit is always in the same tax year as
 * its deduction or the one after, which the caller's candidate check catches.
 */
export function challanPeriod(fields: ChallanFields): ChallanPeriod {
  if (fields.taxYear || fields.monthOfDeduction) {
    return { taxYear: fields.taxYear, month: fields.monthOfDeduction, inferred: false };
  }
  if (fields.dateOfDeposit) {
    return { taxYear: taxYearForDate(fields.dateOfDeposit), month: null, inferred: true };
  }
  return { taxYear: null, month: null, inferred: true };
}

/**
 * Which computed statement this challan belongs to.
 *
 * With a stated month it is an exact match and there is nothing to decide.
 * Without one, the only safe answer is "the one candidate, if there is
 * exactly one" — a challan whose period the document does not state, on a
 * deal with several statements in the same tax year, is genuinely ambiguous,
 * and attaching it to a guess would write a government acknowledgement number
 * onto the wrong payment. Returning null makes the UI say so instead.
 */
export function matchChallanToStatement<T extends { taxYear: string; month: string }>(
  statements: T[],
  period: ChallanPeriod | null,
): T | null {
  if (!period?.taxYear) return null;
  if (period.month) {
    return statements.find((s) => s.taxYear === period.taxYear && s.month === period.month) ?? null;
  }
  const candidates = statements.filter((s) => s.taxYear === period.taxYear);
  return candidates.length === 1 ? candidates[0] : null;
}
