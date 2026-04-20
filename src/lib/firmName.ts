// ─────────────────────────────────────────────────────────────────────────────
// Firm name resolver — handles legal-name transitions (e.g. "& Co." → "& Co. LLP")
//
// Usage:
//   import { resolveFirmNameForDate } from "@/lib/firmName";
//   const firmName = resolveFirmNameForDate(firm, invoice.invoice_date);
//
// Data shape (from firms.legal_name_changes):
//   [
//     { effective_date: "2026-04-16", previous_name: "V J Desai & Co." },
//     ...
//   ]
// firms.name is always the current (post-change) name.
//
// Rule:
//   - If docDate < earliest effective_date → use that entry's previous_name
//   - If docDate falls between two effective_dates → use the previous_name of
//     the next upcoming change (walk sorted array, pick first entry with
//     effective_date > docDate; its previous_name is the name in force)
//   - If docDate >= the most recent effective_date → use firm.name
// ─────────────────────────────────────────────────────────────────────────────

export interface LegalNameChange {
  effective_date: string;  // ISO "YYYY-MM-DD"
  previous_name:  string;
}

export interface FirmLike {
  name?:                 string | null;
  display_name?:         string | null;
  legal_name_changes?:   LegalNameChange[] | null | unknown;
}

/**
 * Return the firm name that was in force on the given document date.
 * Falls back to firm.name (then display_name) if no history is recorded.
 */
export function resolveFirmNameForDate(
  firm: FirmLike | null | undefined,
  docDate: string | Date | null | undefined
): string {
  const currentName = (firm?.name || firm?.display_name || "").trim();
  if (!firm) return currentName;

  // Normalise date to "YYYY-MM-DD"
  let d = "";
  if (docDate instanceof Date) d = docDate.toISOString().slice(0, 10);
  else if (typeof docDate === "string" && docDate.length >= 10) d = docDate.slice(0, 10);
  if (!d) return currentName;

  const raw = firm.legal_name_changes;
  const history: LegalNameChange[] = Array.isArray(raw)
    ? (raw as LegalNameChange[]).filter(e => e && e.effective_date && e.previous_name)
    : [];
  if (history.length === 0) return currentName;

  // Sort ascending by effective_date
  const sorted = history.slice().sort((a, b) => a.effective_date.localeCompare(b.effective_date));

  // Pick first entry whose effective_date is strictly AFTER docDate.
  // That entry's previous_name is what was in force on docDate.
  for (const ch of sorted) {
    if (d < ch.effective_date) return ch.previous_name;
  }
  // Past all changes → current name
  return currentName;
}

/**
 * Display-name variant: prefers display_name over name, same date logic.
 * Use where the UI currently reads firm.display_name || firm.name.
 */
export function resolveFirmDisplayNameForDate(
  firm: FirmLike | null | undefined,
  docDate: string | Date | null | undefined
): string {
  // When the document predates a change, the stored previous_name is considered
  // the display name for that era too — firms don't typically track a separate
  // display-name history.
  return resolveFirmNameForDate(firm, docDate) || firm?.display_name || "";
}
