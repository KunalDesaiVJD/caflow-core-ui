/**
 * What may go in a party field, and what may not.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every value on a Form 141 statement is eventually typed into the income-tax
 * portal, where the field accepts what it accepts and rejects the rest — after
 * the preparer has re-keyed the whole deal. Worse, some of it is accepted: a
 * name field that swallowed half an address is filed, and the department's
 * records then carry a deductee whose name does not match the PAN.
 *
 * A scanned Gujarati દસ્તાવેજ makes this routine rather than rare. The vision
 * model reads a block of text off the deed and has to decide where the name
 * ends and the address begins; it usually gets it right, and when it does not
 * the result is a party called "Girishbhai Madhavji Barochia, Block No. 12,
 * Survey 389, Hathijan, Ahmedabad". Nothing downstream notices.
 *
 * ── What the rules are ────────────────────────────────────────────────────
 *
 * Two kinds, kept apart because they fail differently:
 *
 *   • LIMITS — length and character set, taken from what the portal's own
 *     fields accept. Exceeding one is a certainty of rejection, so it blocks.
 *   • NOISE — text that is structurally wrong for the field it is in: an
 *     address in a name, a partner's name on a firm, a PAN whose constitution
 *     contradicts the party's. These are heuristics, they can be wrong, and a
 *     preparer who has looked and is satisfied must be able to proceed — so
 *     they warn rather than block, except where the PAN itself disagrees.
 *
 * Pure, and tested without a database or a model: given a party, return
 * findings. The engine and the UI both read them.
 */

import { PAN_4TH_CHAR_MAP, isValidPan } from "./rateEngine";

/** Constitution of a party, as stored in tds_property_parties.entity_type. */
export type EntityType =
  | "individual"
  | "huf"
  | "company"
  | "firm_llp"
  | "aop"
  | "trust"
  | "boi"
  | "local_authority"
  | "ajp"
  | "government";

export const ENTITY_LABEL: Record<EntityType, string> = {
  individual: "Individual",
  huf: "HUF",
  company: "Company",
  firm_llp: "Firm / LLP",
  aop: "AOP",
  trust: "Trust",
  boi: "BOI",
  local_authority: "Local authority",
  ajp: "Artificial juridical person",
  government: "Government",
};

/** The fourth PAN character each constitution must carry. The department
 *  issues the letter FROM the constitution, so this is a fact, not a guess. */
export const ENTITY_PAN_CHAR: Record<EntityType, string> = {
  individual: "P",
  huf: "H",
  company: "C",
  firm_llp: "F",
  aop: "A",
  trust: "T",
  boi: "B",
  local_authority: "L",
  ajp: "J",
  government: "G",
};

/** Reverse of the above, for suggesting a constitution from a PAN. */
export const PAN_CHAR_ENTITY: Record<string, EntityType> = Object.fromEntries(
  Object.entries(ENTITY_PAN_CHAR).map(([k, v]) => [v, k as EntityType]),
) as Record<string, EntityType>;

/**
 * Field limits.
 *
 * Names and addresses on the department's TDS statement schema are bounded,
 * and a value over the bound is rejected at upload rather than truncated. 75
 * for a name and 150 for an address are the working limits this module
 * enforces; both sit at or below every portal field the statement feeds, so a
 * value that passes here passes there.
 */
export const LIMITS = {
  name: 75,
  address: 150,
  email: 75,
  contact: 15,
  certificateNo: 15,
} as const;

export interface FieldFinding {
  code: string;
  severity: "blocking" | "warning";
  field: string;
  message: string;
  /** Which party, for the UI. */
  ref?: string;
}

/**
 * Text that means a name has swallowed an address.
 *
 * Deliberately structural rather than a word list: these are the tokens that
 * only ever appear in an Indian property address, plus a PIN code and the
 * digit-and-slash shapes of a survey or plot number. A person's name contains
 * none of them.
 */
const ADDRESS_IN_NAME = [
  /\b(?:survey|s\.?\s?no|block|plot|flat|khata|gut|khasra|revenue)\b/i,
  /\b(?:village|taluka|tehsil|district|dist\.?|pin|pincode)\b/i,
  /\b(?:road|marg|nagar|society|apartment|tower|wing|floor|opp\.?|near)\b/i,
  /\b\d{6}\b/, // a PIN code
  /\d+\s*\/\s*\d+/, // 12/3 — a survey or plot number
];

/** A firm's own name never contains these; a list of its partners does. */
const PARTNER_LIST_IN_NAME = [
  /\b(?:partner|partners|proprietor|karta|director|trustee|member)\b/i,
  // "A, B and C" or "A & B & C" — three or more names strung together is a
  // list of people, not the registered name of one firm.
  /(?:,|\band\b|&).*(?:,|\band\b|&)/i,
];

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/**
 * What a PAN says the party is.
 *
 * Returns null for a PAN that is absent or malformed — those are reported by
 * the existing PAN checks and must not also be reported here as a mismatch,
 * which would be two findings for one fault.
 */
export function entityFromPan(pan: string | null | undefined): EntityType | null {
  const p = clean(pan).toUpperCase();
  if (!p || !isValidPan(p)) return null;
  return PAN_CHAR_ENTITY[p[3]] ?? null;
}

/**
 * Check one party's fields.
 *
 * `role` only shapes the wording — the rules are the same for a buyer and a
 * seller, because the portal's fields are.
 */
export function checkPartyFields(party: {
  name: string | null;
  pan: string | null;
  entityType: EntityType | null;
  contact?: string | null;
  email?: string | null;
  role: "buyer" | "seller";
  seq: number;
}): FieldFinding[] {
  const out: FieldFinding[] = [];
  const name = clean(party.name);
  const who = name || `${party.role === "buyer" ? "Buyer" : "Seller"} ${party.seq}`;
  const ref = clean(party.pan) || who;
  const add = (code: string, severity: FieldFinding["severity"], field: string, message: string) =>
    out.push({ code, severity, field, message, ref });

  // ── Limits ───────────────────────────────────────────────────────────────
  if (name.length > LIMITS.name) {
    add(
      "party_name_too_long",
      "blocking",
      "name",
      `${who}'s name is ${name.length} characters. The statement accepts ${LIMITS.name}, so this is rejected at upload. Usually it means part of the address has been read into the name.`,
    );
  }
  const email = clean(party.email);
  if (email && email.length > LIMITS.email) {
    add("party_email_too_long", "blocking", "email", `${who}'s email is longer than ${LIMITS.email} characters.`);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    add("party_email_invalid", "warning", "email", `"${email}" does not look like an email address.`);
  }
  const contact = clean(party.contact);
  if (contact && !/^[+]?[\d\s-]{6,15}$/.test(contact)) {
    add(
      "party_contact_invalid",
      "warning",
      "contact",
      `"${contact}" does not look like a phone number. The statement takes digits, and optionally a leading +.`,
    );
  }

  // ── Noise in the name ────────────────────────────────────────────────────
  if (name && ADDRESS_IN_NAME.some((re) => re.test(name))) {
    add(
      "address_in_name",
      "warning",
      "name",
      `${who}'s name reads like it contains an address ("${name}"). The name field takes the party's name only — the property address has its own field. Filing a name that does not match the PAN puts the deduction against the wrong record.`,
    );
  }

  // ── Constitution vs PAN ──────────────────────────────────────────────────
  const fromPan = entityFromPan(party.pan);

  if (party.entityType && fromPan && party.entityType !== fromPan) {
    // The department issues the fourth character FROM the constitution, so
    // these two disagreeing means one of them is wrong — most often an HUF
    // recorded against the karta's personal PAN, which credits the tax to the
    // karta and leaves the HUF with none.
    add(
      "pan_entity_mismatch",
      "blocking",
      "pan",
      `${who} is recorded as ${ENTITY_LABEL[party.entityType]}, but PAN ${clean(party.pan)} is a ${ENTITY_LABEL[fromPan]} PAN (4th character "${ENTITY_PAN_CHAR[fromPan]}"). A ${ENTITY_LABEL[party.entityType]} must be filed under its own ${ENTITY_PAN_CHAR[party.entityType]}-series PAN. Using a member's or karta's personal PAN credits the tax to them and leaves the ${ENTITY_LABEL[party.entityType]} with none.`,
    );
  }

  if (!party.entityType && fromPan) {
    add(
      "entity_type_unconfirmed",
      "warning",
      "entityType",
      `${who}'s constitution has not been recorded. PAN ${clean(party.pan)} suggests ${ENTITY_LABEL[fromPan]} — confirm it, so the name and PAN can be checked against each other.`,
    );
  }

  if (!party.entityType && !fromPan && name) {
    add(
      "entity_type_missing",
      "warning",
      "entityType",
      `${who}'s constitution has not been recorded and there is no valid PAN to infer it from.`,
    );
  }

  // ── Constitution-specific naming ─────────────────────────────────────────
  const entity = party.entityType ?? fromPan;

  if (entity === "huf" && name && !/\bhuf\b/i.test(name)) {
    add(
      "huf_name_missing_huf",
      "warning",
      "name",
      `${who} is an HUF but the name does not say so. The department's records carry an HUF under a name ending "HUF" (e.g. "Girishbhai Madhavji Barochia HUF"); filing the karta's personal name against an HUF PAN is the commonest cause of a name-PAN mismatch.`,
    );
  }

  if ((entity === "firm_llp" || entity === "company") && name && PARTNER_LIST_IN_NAME.some((re) => re.test(name))) {
    add(
      "partner_names_in_entity_name",
      "warning",
      "name",
      `${who} is a ${ENTITY_LABEL[entity]}, but the name reads like a list of people rather than the registered name of the ${ENTITY_LABEL[entity]} ("${name}"). A firm is the deductee, not its partners — the statement carries the firm's registered name and its own PAN.`,
    );
  }

  if (entity === "individual" && name && /\b(?:pvt|private|limited|ltd|llp|& co|and co|associates|enterprises|huf|trust)\b/i.test(name)) {
    add(
      "individual_name_reads_as_entity",
      "warning",
      "name",
      `${who} is recorded as an Individual but the name reads like an entity ("${name}"). Check the constitution and the PAN.`,
    );
  }

  return out;
}

/** Address checks, which belong to the transaction rather than a party. */
export function checkAddressField(address: string | null | undefined): FieldFinding[] {
  const a = clean(address);
  if (!a) return [];
  const out: FieldFinding[] = [];
  if (a.length > LIMITS.address) {
    out.push({
      code: "property_address_too_long",
      severity: "warning",
      field: "propertyAddress",
      message: `The property address is ${a.length} characters. The statement accepts ${LIMITS.address}, so it will need shortening before filing — keep the survey/khata number, village, taluka, district and PIN, and drop the rest.`,
    });
  }
  return out;
}
