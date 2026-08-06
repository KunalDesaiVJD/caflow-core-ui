// ─────────────────────────────────────────────────────────────────────────
// entityType.ts — single canonical entity-type classifier.
//
// WHY THIS EXISTS (2026-08-06 fix, LALJIBHAI VADIWALA bug)
// `audit_engagements.entity_type` / `clients.entity_type` gets written in TWO
// INCOMPATIBLE VOCABULARIES depending on which screen created the record:
//   - Clients.tsx / StepBasicInfo.tsx (client creation) write the
//     human-readable full word: "Proprietorship", "Partnership", "LLP",
//     "Private Ltd", "Public Ltd", "HUF", "Trust", "AOP", "BOI".
//   - AuditPipeline.tsx's "New Engagement" wizard writes a short lowercase
//     code instead: "individual", "firm", "llp", "company", "trust", "huf",
//     "aop" (see its own ENTITY_TYPES const).
// Every consumer that gated on entity type re-implemented its own ad-hoc
// match list/exact-string check against ONLY the full-word vocabulary — the
// exact same "hand-rolled matcher with no shared normalisation" pattern that
// caused the RC-21 ledger-matching bug class (see tallyText.ts /
// buildLedgerMapMatcher). Two confirmed breakages from this:
//   - NCECapitalAccount.tsx's `isProprietorship` only matched the literal
//     string "proprietorship" — an engagement created via the wizard with
//     entity_type "individual" (Proprietorship, short-code form) showed the
//     WRONG (Partnership: Share %/Remuneration/Interest) UI.
//   - nceFinancialsDocx.ts's exported Capital Account note had the identical
//     narrow check, fed the same unnormalised value — the DOCX export had
//     the same defect.
//   - isNonCorporate (PipelineFinancialStatements.tsx) / getEngagementIsNon
//     Corporate (notesAutoPopulate.ts) both recognise "Individual" (matches
//     "individual" case-insensitively — fine) but do NOT recognise "firm"
//     (the wizard's Partnership code) — a Partnership engagement created via
//     the wizard would silently route to the CORPORATE FS engine entirely.
// Fix: one canonical normalizer, used everywhere. New synonyms should be
// added HERE, not re-invented at each call site.
// ─────────────────────────────────────────────────────────────────────────

export type CanonicalEntityType =
  | "proprietorship"
  | "partnership"
  | "llp"
  | "private_limited"
  | "public_limited"
  | "huf"
  | "trust"
  | "aop"
  | "unknown";

/** Non-corporate (NCE) constitutions — the entity types this firm's NCE
 *  financial-statement engine (vs. the Schedule III corporate engine) covers. */
export const NCE_CONSTITUTIONS: ReadonlySet<CanonicalEntityType> = new Set([
  "proprietorship", "partnership", "llp", "huf", "trust", "aop",
]);

/** Normalize any entity_type string — either vocabulary — to a canonical form. */
export function normalizeEntityType(raw: string | null | undefined): CanonicalEntityType {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return "unknown";
  // Order matters: check the most specific/short-code forms before the
  // broader substring checks so e.g. "llp" doesn't fall through to unknown.
  if (s === "individual" || s.includes("proprietor") || s.includes("sole")) return "proprietorship";
  if (s === "llp" || s.includes("limited liability partnership")) return "llp";
  if (s === "firm" || s.includes("partnership")) return "partnership";
  if (s.includes("private") || s.includes("pvt")) return "private_limited";
  if (s.includes("public")) return "public_limited";
  // Generic "company" (AuditPipeline's wizard doesn't distinguish Pvt/Public
  // at creation time) — doesn't matter which corporate bucket it lands in
  // here since both are excluded from NCE_CONSTITUTIONS.
  if (s === "company") return "private_limited";
  if (s === "huf" || s.includes("hindu")) return "huf";
  if (s.includes("trust") || s.includes("society") || s.includes("ngo")) return "trust";
  if (s === "aop" || s.includes("association of persons") || s.includes("boi") || s.includes("body of individuals")) return "aop";
  return "unknown";
}

/** True when the engagement/client's entity type is Non-Corporate (NCE). */
export function isNonCorporateEntityType(raw: string | null | undefined): boolean {
  return NCE_CONSTITUTIONS.has(normalizeEntityType(raw));
}

/** True specifically for a sole Proprietorship (no partners — hides the
 *  Share %/Remuneration/Interest columns in the Capital Account note). */
export function isProprietorshipEntityType(raw: string | null | undefined): boolean {
  return normalizeEntityType(raw) === "proprietorship";
}
