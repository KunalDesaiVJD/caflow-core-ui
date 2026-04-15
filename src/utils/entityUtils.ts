/**
 * Shared entity-type helpers.
 * Import from here rather than duplicating the list across components.
 */

/** Returns true for company entities that require CARO + MRL (Private Ltd, Public Ltd, OPC). */
export function isCompanyEntity(entityType: string | null | undefined): boolean {
  if (!entityType) return false;
  return [
    "company",
    "Company",
    "Private Ltd",
    "pvt_ltd",
    "Public Ltd",
    "public_ltd",
    "OPC",
    "opc",
  ].includes(entityType);
}

/** Derives the balance-sheet date from a financial year string.
 *  "2024-25" → "31.03.2025"
 */
export function getBSDate(financialYear: string | null | undefined): string {
  if (!financialYear) return "[BS_DATE]";
  const parts = financialYear.split("-");
  if (parts.length < 2) return "[BS_DATE]";
  const raw = parts[1]; // "25" or "2025"
  const fullYear = raw.length === 2 ? "20" + raw : raw;
  return `31.03.${fullYear}`;
}

/** Derives the audit year (end year) from a financial year string.
 *  "2024-25" → "2025"
 */
export function getAuditYear(financialYear: string | null | undefined): string {
  if (!financialYear) return "[YEAR]";
  const parts = financialYear.split("-");
  if (parts.length < 2) return "[YEAR]";
  const raw = parts[1];
  return raw.length === 2 ? "20" + raw : raw;
}
