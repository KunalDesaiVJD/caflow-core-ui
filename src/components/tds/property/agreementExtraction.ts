/**
 * Agreement extraction — the client half.
 *
 * Turns what property-agreement-extract read out of a sale deed into a
 * PROPOSED transaction, and decides what a human still has to confirm before
 * any of it is allowed near a filing.
 *
 * Pure and testable on purpose. The edge function is where the model runs;
 * this is where the rules live about which readings are trustworthy enough to
 * pre-fill, how an Indian money amount becomes an integer, and what happens
 * to a question the model could not answer for itself. None of that should
 * need a network call to verify.
 *
 * ── The confidence contract ───────────────────────────────────────────────
 *
 *   high    → pre-filled and accepted.
 *   medium  → pre-filled but flagged; the user must confirm it explicitly.
 *   low     → NOT pre-filled on a figure that drives tax. An empty field a
 *             preparer notices beats a plausible wrong number they don't.
 *
 * That last rule is the one worth defending. A low-confidence guess at the
 * consideration looks exactly like a good one once it is sitting in the box,
 * and the ₹50,00,000 threshold turns a misread digit into the difference
 * between a filing and no filing at all.
 *
 * ── Queries are data, not conversation ────────────────────────────────────
 *
 * The model returns questions it could not resolve — consideration in words
 * disagreeing with figures, a missing Index-II, three names but two PANs.
 * They arrive as structured rows, get rendered as a checklist beside the
 * source page, and an unresolved BLOCKING query is treated exactly like a
 * blocking validation finding. One gate, not two. Every answer is recorded
 * with its question, so the reasoning survives on the transaction long after
 * the session that produced it.
 */

import { parseIndianAmount, parseIndianDate as normaliseDate } from "@/lib/tds/indianAmount";
import type { PropertyDealBundle, PropertyTransactionRow, PropertyPartyRow, PropertyInstalmentRow } from "./propertyDeal";

// ─── Wire format ────────────────────────────────────────────────────────────

export type Confidence = "high" | "medium" | "low";

export interface ExtractedField {
  value: unknown;
  confidence: Confidence;
  page: number | null;
  snippet: string | null;
}

export interface ExtractionQuery {
  field: string;
  question: string;
  why: string;
  options?: string[];
  evidence?: { page: number | null; snippet: string | null };
  blocking: boolean;
}

export interface AgreementExtraction {
  document_kind: "sale_agreement" | "index_ii" | "other" | "unreadable";
  document_kind_confidence: Confidence;
  fields: Record<string, ExtractedField | undefined>;
  queries: ExtractionQuery[];
  extraction_status: "extracted" | "failed" | "not_a_property_document";
  error?: string;
}

/** A query plus whatever the user did about it. Persisted on the document row
 *  so the question and its answer stay together. */
export interface ResolvedQuery extends ExtractionQuery {
  answer: string | null;
  resolvedAt: string | null;
  /**
   * The user declined to answer.
   *
   * A skipped question stops standing in the way — nobody should be locked out
   * of their own file by a question they cannot answer today. It is NOT
   * forgotten: a skipped question that was blocking comes back as a warning on
   * the transaction, so the file still shows what was left unanswered and an
   * officer reading it in three years can see the same thing.
   */
  skipped?: boolean;
}

export type FieldSource = "extracted" | "user_resolved" | "manual";

export interface FieldProvenance {
  source: FieldSource;
  confidence: Confidence;
  page: number | null;
  snippet: string | null;
  /** True when the reading needs an explicit human confirmation before the
   *  transaction can be filed. */
  needsConfirmation: boolean;
}

// ─── Amount and date parsing ────────────────────────────────────────────────
//
// Both live in src/lib/tds/indianAmount.ts, shared with the challan/statement
// parser. A second independently-written copy is exactly how ₹2,56,00,000 gets
// read correctly in one half of the module and wrongly in the other, with
// nothing to compare them against — see that file's own note.
//
// Re-exported here because this module is the extraction surface the rest of
// the property UI imports from, and because both functions are part of what
// its tests pin.
export { parseIndianAmount } from "@/lib/tds/indianAmount";
export { parseIndianDate as normaliseDate } from "@/lib/tds/indianAmount";

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Accept a PAN only if it is actually shaped like one. A near-miss read off
 *  a poor scan is worse than a blank, which correctly triggers the 20% rate
 *  question rather than filing under a PAN that belongs to nobody. */
export function normalisePan(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase().replace(/\s/g, "");
  return PAN_RE.test(s) ? s : null;
}

// ─── Confidence gating ──────────────────────────────────────────────────────

/**
 * Fields where a low-confidence reading is never pre-filled.
 *
 * Each of these moves money: the two amounts set the taxable base and decide
 * whether the ₹50,00,000 threshold is crossed at all, and the dates set the
 * Tax Year, the Month of Deduction, the due date and therefore any interest
 * and fee. A wrong-but-plausible value in any of them produces a wrong
 * statement that looks entirely reasonable on screen.
 */
export const CRITICAL_FIELDS = new Set([
  "total_sale_consideration",
  "total_stamp_duty_value",
  "date_of_agreement",
]);

export interface AppliedExtraction {
  bundle: PropertyDealBundle;
  /** Per-field provenance, keyed by the transaction field name. */
  provenance: Record<string, FieldProvenance>;
  /** Fields pre-filled at medium confidence — the user must confirm each. */
  needsConfirmation: string[];
  /** Critical fields deliberately left empty because the reading was weak. */
  withheld: string[];
  /**
   * Fields the model DID return but that this code could not parse into
   * anything usable. Distinct from `withheld`, which is a deliberate refusal:
   * this is a failure to understand, and it has to be visible. An empty seller
   * list computes zero tax, which on screen is indistinguishable from a
   * below-threshold deal.
   */
  unreadable: string[];
  /**
   * Rows the model returned that could not be turned into records — a partial
   * loss, distinct from `unreadable`'s total one.
   *
   * A deed with three payments whose middle amount would not parse used to
   * produce two instalments and no word about the third. That understates the
   * consideration paid, and every statement computed from it, while looking
   * exactly like a two-payment deal. Reporting kept-of-total is the only way
   * the user can tell the difference.
   */
  dropped: DroppedRows[];
  queries: ResolvedQuery[];
}

export interface DroppedRows {
  /** Field key, for FIELD_LABEL. */
  field: string;
  kept: number;
  total: number;
}

const field = (ex: AgreementExtraction, key: string): ExtractedField | undefined => ex.fields?.[key];

/**
 * Read a field's payload whichever shape the model chose.
 *
 * The prompt asks for every field as {value, confidence, page, snippet}, and
 * ALSO describes buyers/sellers/instalments as "array of {...}". Those two
 * instructions can be satisfied three different ways, and a model will pick
 * any of them:
 *
 *   1. {value: [ {name, pan} ], confidence: "high", ...}   ← as specified
 *   2. [ {name, pan} ]                                      ← array, no envelope
 *   3. {value: [ {name: {value: "X", confidence: "high"}} ]} ← envelope per leaf
 *
 * Requiring only shape 1 is what made a real deed come back with no parties
 * and no payments, and therefore no tax. The reader accepts all three, because
 * which one arrives is not something this code gets to decide.
 */
function unwrapValue(v: unknown): unknown {
  if (v === null || v === undefined || Array.isArray(v) || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  return "value" in o && ("confidence" in o || "page" in o || "snippet" in o) ? o.value : v;
}

/** A scalar leaf, tolerating a per-leaf envelope. */
const leaf = (v: unknown): unknown => unwrapValue(v);

/** A trimmed string leaf, or null. */
function leafText(v: unknown): string | null {
  const u = unwrapValue(v);
  if (typeof u === "number") return String(u);
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

/** The object rows behind an array-valued field, whichever shape it arrived in. */
function fieldRows(f: unknown): Record<string, unknown>[] {
  const v = unwrapValue(f);
  return Array.isArray(v)
    ? (v.filter((r) => r && typeof r === "object" && !Array.isArray(r)) as Record<string, unknown>[])
    : [];
}

/** True when the model returned SOMETHING for a field, in any shape. */
function fieldHasContent(f: unknown): boolean {
  const v = unwrapValue(f);
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function provenanceOf(f: ExtractedField | undefined): FieldProvenance {
  return {
    source: "extracted",
    confidence: f?.confidence ?? "low",
    page: f?.page ?? null,
    snippet: f?.snippet ?? null,
    needsConfirmation: (f?.confidence ?? "low") !== "high",
  };
}

/**
 * Should this reading be written into the form at all?
 *
 * Critical fields need "high" or "medium"; a "low" reading of one is withheld
 * so the box stays visibly empty. Everything else — an address, a property
 * type, a name — is pre-filled at any confidence, because a wrong address is
 * obvious on sight and costs nothing but a correction, while a wrong
 * consideration is invisible and costs a misfiled return.
 */
function shouldApply(key: string, f: ExtractedField | undefined): boolean {
  if (!fieldHasContent(f)) return false;
  if (CRITICAL_FIELDS.has(key)) return (f?.confidence ?? "low") !== "low";
  return true;
}

/**
 * Fold an extraction into a transaction the editor can open.
 *
 * `base` is the blank (or existing) bundle — extraction never replaces a
 * value the user has already typed, so re-running it on a half-entered
 * transaction is safe.
 */
export function applyExtraction(
  extraction: AgreementExtraction,
  base: PropertyDealBundle,
): AppliedExtraction {
  const provenance: Record<string, FieldProvenance> = {};
  const needsConfirmation: string[] = [];
  const withheld: string[] = [];
  const unreadable: string[] = [];
  const dropped: DroppedRows[] = [];

  const txn: PropertyTransactionRow = { ...base.transaction, source: "agreement_upload" };

  const note = (key: string, f: ExtractedField | undefined, applied: boolean) => {
    provenance[key] = provenanceOf(f);
    if (!applied) {
      if (CRITICAL_FIELDS.has(key) && f?.value !== null && f?.value !== undefined) withheld.push(key);
      return;
    }
    if (provenance[key].needsConfirmation) needsConfirmation.push(key);
  };

  // A document that is not a property transfer instrument yields nothing —
  // returning a half-filled transaction from a rent agreement would be worse
  // than returning none.
  if (extraction.extraction_status !== "extracted") {
    return {
      bundle: base,
      provenance: {},
      needsConfirmation: [],
      withheld: [],
      unreadable: [],
      dropped: [],
      queries: askableQueries(extraction.queries || []).map((q) => ({ ...q, answer: null, resolvedAt: null, skipped: false })),
    };
  }

  const propType = field(extraction, "property_type");
  if (shouldApply("property_type", propType)) txn.property_type = String(leaf(propType!.value ?? propType)).toUpperCase();
  note("property_type", propType, shouldApply("property_type", propType));

  const addr = field(extraction, "property_address");
  if (shouldApply("property_address", addr)) txn.property_address = String(leafText(addr!.value ?? addr) ?? "");
  note("property_address", addr, shouldApply("property_address", addr));

  const agrDate = field(extraction, "date_of_agreement");
  const agrDateVal = normaliseDate(leafText(agrDate?.value ?? agrDate));
  const agrOk = shouldApply("date_of_agreement", agrDate) && agrDateVal !== null;
  if (agrOk) txn.date_of_agreement = agrDateVal!;
  note("date_of_agreement", agrDate, agrOk);

  const cons = field(extraction, "total_sale_consideration");
  const consVal = parseIndianAmount(leaf(cons?.value ?? cons));
  const consOk = shouldApply("total_sale_consideration", cons) && consVal !== null;
  if (consOk) txn.total_sale_consideration = consVal!;
  note("total_sale_consideration", cons, consOk);

  const sdv = field(extraction, "total_stamp_duty_value");
  const sdvVal = parseIndianAmount(leaf(sdv?.value ?? sdv));
  const sdvOk = shouldApply("total_stamp_duty_value", sdv) && sdvVal !== null;
  if (sdvOk) txn.total_stamp_duty_value = sdvVal!;
  note("total_stamp_duty_value", sdv, sdvOk);

  const mode = field(extraction, "payment_mode");
  const modeVal = leafText(mode?.value ?? mode);
  if (shouldApply("payment_mode", mode) && (modeVal === "lumpsum" || modeVal === "instalments")) {
    txn.payment_mode = modeVal;
  }
  note("payment_mode", mode, shouldApply("payment_mode", mode));

  // ── Parties ──────────────────────────────────────────────────────────────
  const readParties = (key: "buyers" | "sellers", role: "buyer" | "seller"): PropertyPartyRow[] => {
    const raw = field(extraction, key);
    note(key, raw, shouldApply(key, raw));
    const rows = fieldRows(raw);
    // The model returned something for this field but nothing survived the
    // read. That must never be silent — an empty party list produces zero tax,
    // which looks exactly like a below-threshold deal.
    if (!rows.length && fieldHasContent(raw)) unreadable.push(key);
    if (!rows.length) return [];
    return rows.map((p, idx) => ({
      id: `new-${role}-${idx + 1}-x`,
      firm_id: base.transaction.firm_id,
      transaction_id: base.transaction.id,
      party_role: role,
      seq: idx + 1,
      pan: normalisePan(leafText(p.pan)),
      name: leafText(p.name) ?? "",
      contact: leafText(p.contact),
      email: leafText(p.email),
      // Shares are taken exactly as read and never re-normalised to 100%.
      // If the deed's shares don't add up, that surfaces as a blocking
      // finding rather than being quietly smoothed over.
      share_pct: Number(leaf(p.share_pct)) || 0,
      residential_status: "resident",
      // Nothing in a sale deed says whether a PAN is operative, and nothing
      // in it mentions a lower-deduction certificate either. Both start
      // unknown/absent and are filled in from the firm's own records or by
      // hand — never inferred from the document.
      pan_status: "unknown",
      section_395_certificate_no: null,
      section_395_rate: null,
      section_395_valid_from: null,
      section_395_valid_to: null,
      section_395_ceiling_amount: null,
    }));
  };

  const buyers = readParties("buyers", "buyer");
  const sellers = readParties("sellers", "seller");

  // ── Instalments ──────────────────────────────────────────────────────────
  // Amounts in the deed are for the WHOLE property; the module records what
  // THIS buyer pays. The buyer's share scales them — and where no share is
  // known yet, the amount is left as read for the user to correct rather than
  // scaled by a number nobody supplied.
  const instRaw = field(extraction, "instalments");
  note("instalments", instRaw, shouldApply("instalments", instRaw));
  const filingBuyer = buyers.find((b) => b.pan === txn.filing_buyer_pan) || buyers[0];
  const buyerShare = filingBuyer && Number(filingBuyer.share_pct) > 0 ? Number(filingBuyer.share_pct) / 100 : 1;

  const instRows = fieldRows(instRaw);
  if (!instRows.length && fieldHasContent(instRaw)) unreadable.push("instalments");

  const instalments: PropertyInstalmentRow[] = instRows
        .map((r, idx) => {
          const amount = parseIndianAmount(leaf(r.amount));
          const date = normaliseDate(leafText(r.date_paid_or_credited));
          if (amount === null || date === null) return null;
          return {
            id: `new-inst-${idx + 1}-x`,
            firm_id: base.transaction.firm_id,
            transaction_id: base.transaction.id,
            seq: idx + 1,
            amount_paid_by_buyer: Math.round(amount * buyerShare),
            date_paid_or_credited: date,
            // The deed states when money moves, never when tax was deducted.
            // Same-day is both the norm and the only interest-free option, so
            // it is the proposal — the user changes it if reality differed.
            date_of_deduction: date,
            date_of_deposit: null,
            date_of_filing: null,
          } as PropertyInstalmentRow;
        })
        .filter((x): x is PropertyInstalmentRow => x !== null);

  // An instalment needs BOTH an amount and a date; a row missing either is
  // unusable. Dropping it is right — inventing the missing half would be
  // worse — but doing it in silence is not, because what reaches the screen
  // is a shorter, cheaper, entirely plausible-looking payment schedule.
  if (instalments.length < instRows.length) {
    dropped.push({ field: "instalments", kept: instalments.length, total: instRows.length });
  }

  if (filingBuyer?.pan && !txn.filing_buyer_pan) txn.filing_buyer_pan = filingBuyer.pan;

  return {
    bundle: {
      transaction: txn,
      parties: [...buyers, ...sellers],
      instalments,
    },
    provenance,
    needsConfirmation,
    withheld,
    unreadable,
    dropped,
    queries: askableQueries(extraction.queries || []).map((q) => ({ ...q, answer: null, resolvedAt: null, skipped: false })),
  };
}

/**
 * Questions never put to the user.
 *
 * The stamp duty value is the government's own jantri/circle rate: it is
 * revised on the government's schedule and printed on the Index-II page of a
 * registered deed. A preparer asked for it can only look it up or guess, and
 * both routes put a stale figure into the one number that can only raise the
 * tax. So the reader takes it off the document when the document carries it,
 * and says nothing when it does not — rather than asking a question whose
 * honest answer is "the government decides that".
 *
 * The engine is untouched: tax is still charged on the HIGHER of consideration
 * and stamp duty value. The consequence of the figure being absent is stated
 * as a warning on the transaction, not as a question.
 */
const NEVER_ASKED = new Set([
  "total_stamp_duty_value",
  "stamp_duty_value_as_on",
]);

/** Drop the questions this module refuses to put to a user. */
export const askableQueries = <T extends { field: string }>(queries: T[]): T[] =>
  queries.filter((q) => !NEVER_ASKED.has(q.field));

// ─── The resolution queue ───────────────────────────────────────────────────

/** Queries still standing in the way of a filing. A skipped one does not:
 *  the user has been asked and has declined, which is an answer of a kind. */
export const blockingQueries = (queries: ResolvedQuery[]): ResolvedQuery[] =>
  queries.filter((q) => q.blocking && !q.resolvedAt && !q.skipped);

/** Everything still awaiting the user, blocking or not. */
export const openQueries = (queries: ResolvedQuery[]): ResolvedQuery[] =>
  queries.filter((q) => !q.resolvedAt && !q.skipped);

/**
 * Blocking questions the user skipped.
 *
 * Surfaced as warnings rather than dropped. Skipping is allowed to unblock a
 * filing, but the reason the question was asked does not stop being true, and
 * the file has to carry the fact that nobody answered it.
 */
export const skippedBlocking = (queries: ResolvedQuery[]): ResolvedQuery[] =>
  queries.filter((q) => q.blocking && q.skipped && !q.resolvedAt);

/** Mark a question as declined. The question and the fact of the refusal both
 *  stay on the record; see ResolvedQuery.skipped. */
export function skipQuery(
  queries: ResolvedQuery[],
  index: number,
): ResolvedQuery[] {
  return queries.map((q, i) => (i === index ? { ...q, skipped: true } : q));
}

// ─── Answers that change the form ───────────────────────────────────────────

/** One field an answer moved, for telling the user what it did. */
export interface Amendment {
  field: string;
  from: string;
  to: string;
}

export interface AnsweredQuery {
  queries: ResolvedQuery[];
  bundle: PropertyDealBundle;
  provenance: Record<string, FieldProvenance>;
  /** Fields the answer CHANGED from a value that was already there. Empty when
   *  the answer merely filled a blank, which needs no announcement. */
  amended: Amendment[];
  /** True when the answer was understood well enough to write somewhere. */
  applied: boolean;
}

/** Fields whose answer is a rupee figure. */
const AMOUNT_FIELDS = new Set(["total_sale_consideration", "total_stamp_duty_value"]);
/** Fields whose answer is a date. */
const DATE_FIELDS = new Set(["date_of_agreement", "date_of_registration", "stamp_duty_value_as_on"]);

const inr = (n: number): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const describe = (field: string, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "(blank)";
  if (AMOUNT_FIELDS.has(field)) return inr(Number(v));
  return String(v);
};

/**
 * Answer a question AND act on the answer.
 *
 * Recording the answer was never the point. The panel used to store the text
 * and tell the user "update the fields below to match", which put the work of
 * applying their own answer back on them and — far worse — left the form
 * showing a figure the user had just contradicted in writing. A transaction
 * could be filed carrying an answer that said one thing and a field that said
 * another.
 *
 * So the answer is parsed against the field the question was ASKED about and
 * written into the transaction, through the same parsers the extractor uses
 * (parseIndianAmount, normaliseDate) — including their Gujarati and Devanagari
 * digit handling, so "૨,૫૬,૦૦,૦૦૦" typed off the deed lands as 25600000.
 *
 * Where the answer contradicts a value already on the form, the answer wins:
 * it is the more recent and more deliberate of the two, and the field it
 * displaced is returned in `amended` so the change is announced rather than
 * slipped in. Provenance moves to "user_resolved", which is what stops the
 * field still being counted as needing confirmation of a reading nobody is
 * relying on any more.
 *
 * Questions about lists — buyers, sellers, payments — are recorded but not
 * applied: a sentence of prose cannot be turned into party rows with shares
 * without guessing, and guessing a seller's share silently mis-splits the tax.
 * `applied: false` says so, and the caller tells the user to edit those rows.
 */
export function applyAnswer(
  queries: ResolvedQuery[],
  index: number,
  answer: string,
  bundle: PropertyDealBundle,
  provenance: Record<string, FieldProvenance> = {},
  now: string = new Date().toISOString(),
): AnsweredQuery {
  const q = queries[index];
  const recorded = resolveQuery(queries, index, answer, now);
  const unchanged: AnsweredQuery = {
    queries: recorded, bundle, provenance, amended: [], applied: false,
  };
  if (!q) return unchanged;

  const txn = { ...bundle.transaction } as Record<string, unknown>;
  const before = txn[q.field];
  let next: unknown;

  if (AMOUNT_FIELDS.has(q.field)) {
    const parsed = parseIndianAmount(answer);
    if (parsed === null) return unchanged;
    next = parsed;
  } else if (DATE_FIELDS.has(q.field)) {
    const parsed = normaliseDate(answer);
    if (parsed === null) return unchanged;
    next = parsed;
  } else if (q.field === "payment_mode") {
    const t = answer.trim().toLowerCase();
    if (/instal/.test(t)) next = "instalments";
    else if (/lump|one|single|full/.test(t)) next = "lumpsum";
    else return unchanged;
  } else if (q.field === "property_type") {
    next = answer.trim().toUpperCase();
  } else if (q.field === "property_address") {
    next = answer.trim();
  } else {
    // buyers / sellers / instalments / document_integrity — recorded only.
    return unchanged;
  }

  txn[q.field] = next;

  const amended: Amendment[] =
    before !== null && before !== undefined && before !== "" && String(before) !== String(next)
      ? [{ field: q.field, from: describe(q.field, before), to: describe(q.field, next) }]
      : [];

  return {
    queries: recorded,
    bundle: { ...bundle, transaction: txn as unknown as PropertyDealBundle["transaction"] },
    provenance: {
      ...provenance,
      [q.field]: {
        source: "user_resolved",
        confidence: "high",
        page: q.evidence?.page ?? null,
        snippet: q.evidence?.snippet ?? null,
        // A figure the user typed in answer to a direct question needs no
        // further confirmation of a reading — they ARE the confirmation.
        needsConfirmation: false,
      },
    },
    amended,
    applied: true,
  };
}

/**
 * Record an answer. The question stays — an answered query is a decision the
 * transaction carries, not a row to delete, and an officer reading the file in
 * three years should be able to see both halves.
 */
export function resolveQuery(
  queries: ResolvedQuery[],
  index: number,
  answer: string,
  now: string = new Date().toISOString(),
): ResolvedQuery[] {
  return queries.map((q, i) => (i === index ? { ...q, answer, resolvedAt: now } : q));
}

/**
 * Confirm a medium-confidence reading, promoting it out of the
 * needs-confirmation set. Confirming does not change the value — it records
 * that a human looked at it, which is the whole difference between a figure
 * the software guessed and one a preparer stands behind.
 */
export function confirmField(
  provenance: Record<string, FieldProvenance>,
  key: string,
): Record<string, FieldProvenance> {
  const p = provenance[key];
  if (!p) return provenance;
  return { ...provenance, [key]: { ...p, needsConfirmation: false, source: "user_resolved" } };
}

/** Fields still awaiting a human's eye. */
export const unconfirmedFields = (provenance: Record<string, FieldProvenance>): string[] =>
  Object.entries(provenance)
    .filter(([, p]) => p.needsConfirmation)
    .map(([k]) => k);

/** Human labels for the provenance and query panels. */
export const FIELD_LABEL: Record<string, string> = {
  property_type: "Type of immovable property",
  property_address: "Address of property",
  date_of_agreement: "Date of agreement",
  total_sale_consideration: "Total sale consideration",
  total_stamp_duty_value: "Total stamp duty value",
  payment_mode: "Payment mode",
  buyers: "Buyers",
  sellers: "Sellers",
  instalments: "Payments",
  document_integrity: "Document integrity",
};
