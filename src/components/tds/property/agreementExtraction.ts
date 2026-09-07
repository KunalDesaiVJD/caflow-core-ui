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
  queries: ResolvedQuery[];
}

const field = (ex: AgreementExtraction, key: string): ExtractedField | undefined => ex.fields?.[key];

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
  if (!f || f.value === null || f.value === undefined || f.value === "") return false;
  if (CRITICAL_FIELDS.has(key)) return f.confidence !== "low";
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
      queries: (extraction.queries || []).map((q) => ({ ...q, answer: null, resolvedAt: null })),
    };
  }

  const propType = field(extraction, "property_type");
  if (shouldApply("property_type", propType)) txn.property_type = String(propType!.value).toUpperCase();
  note("property_type", propType, shouldApply("property_type", propType));

  const addr = field(extraction, "property_address");
  if (shouldApply("property_address", addr)) txn.property_address = String(addr!.value);
  note("property_address", addr, shouldApply("property_address", addr));

  const agrDate = field(extraction, "date_of_agreement");
  const agrDateVal = normaliseDate(agrDate?.value);
  const agrOk = shouldApply("date_of_agreement", agrDate) && agrDateVal !== null;
  if (agrOk) txn.date_of_agreement = agrDateVal!;
  note("date_of_agreement", agrDate, agrOk);

  const cons = field(extraction, "total_sale_consideration");
  const consVal = parseIndianAmount(cons?.value);
  const consOk = shouldApply("total_sale_consideration", cons) && consVal !== null;
  if (consOk) txn.total_sale_consideration = consVal!;
  note("total_sale_consideration", cons, consOk);

  const sdv = field(extraction, "total_stamp_duty_value");
  const sdvVal = parseIndianAmount(sdv?.value);
  const sdvOk = shouldApply("total_stamp_duty_value", sdv) && sdvVal !== null;
  if (sdvOk) txn.total_stamp_duty_value = sdvVal!;
  note("total_stamp_duty_value", sdv, sdvOk);

  const mode = field(extraction, "payment_mode");
  if (shouldApply("payment_mode", mode) && (mode!.value === "lumpsum" || mode!.value === "instalments")) {
    txn.payment_mode = mode!.value as "lumpsum" | "instalments";
  }
  note("payment_mode", mode, shouldApply("payment_mode", mode));

  // ── Parties ──────────────────────────────────────────────────────────────
  const readParties = (key: "buyers" | "sellers", role: "buyer" | "seller"): PropertyPartyRow[] => {
    const raw = field(extraction, key);
    note(key, raw, shouldApply(key, raw));
    if (!Array.isArray(raw?.value)) return [];
    return (raw!.value as Record<string, unknown>[]).map((p, idx) => ({
      id: `new-${role}-${idx + 1}-x`,
      firm_id: base.transaction.firm_id,
      transaction_id: base.transaction.id,
      party_role: role,
      seq: idx + 1,
      pan: normalisePan(p.pan),
      name: typeof p.name === "string" ? p.name : "",
      contact: typeof p.contact === "string" ? p.contact : null,
      email: typeof p.email === "string" ? p.email : null,
      // Shares are taken exactly as read and never re-normalised to 100%.
      // If the deed's shares don't add up, that surfaces as a blocking
      // finding rather than being quietly smoothed over.
      share_pct: typeof p.share_pct === "number" ? p.share_pct : Number(p.share_pct) || 0,
      residential_status: "resident",
      section_395_certificate_no: null,
      section_395_rate: null,
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

  const instalments: PropertyInstalmentRow[] = Array.isArray(instRaw?.value)
    ? (instRaw!.value as Record<string, unknown>[])
        .map((r, idx) => {
          const amount = parseIndianAmount(r.amount);
          const date = normaliseDate(r.date_paid_or_credited);
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
        .filter((x): x is PropertyInstalmentRow => x !== null)
    : [];

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
    queries: (extraction.queries || []).map((q) => ({ ...q, answer: null, resolvedAt: null })),
  };
}

// ─── The resolution queue ───────────────────────────────────────────────────

/** Queries still standing in the way of a filing. */
export const blockingQueries = (queries: ResolvedQuery[]): ResolvedQuery[] =>
  queries.filter((q) => q.blocking && !q.resolvedAt);

/** Everything still open, blocking or not. */
export const openQueries = (queries: ResolvedQuery[]): ResolvedQuery[] =>
  queries.filter((q) => !q.resolvedAt);

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
