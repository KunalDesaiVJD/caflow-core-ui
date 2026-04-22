/**
 * Shared entity-type helpers.
 * Import from here rather than duplicating the list across components.
 */

/** Returns true for company entities that require CARO + MRL (Private Ltd, Public Ltd, OPC).
 *  Matches case-insensitively on normalised substrings so DB variants like
 *  "Private Limited Company", "pvt. ltd.", "private_ltd", "PVT LTD", "OPC" all resolve correctly.
 */
export function isCompanyEntity(entityType: string | null | undefined): boolean {
  if (!entityType) return false;
  // Collapse separators (spaces, dots, underscores, hyphens) and lower-case to
  // compare against canonical keywords.
  const n = String(entityType).toLowerCase().replace(/[\s._\-]+/g, "");
  // Match any of: company / privateltd / privatelimited / pvtltd / pvtlimited
  //               publicltd / publiclimited / opc
  if (n === "company" || n === "opc") return true;
  if (n.includes("privateltd") || n.includes("privatelimited")) return true;
  if (n.includes("pvtltd")    || n.includes("pvtlimited"))     return true;
  if (n.includes("publicltd") || n.includes("publiclimited"))  return true;
  if (n.includes("onepersoncompany")) return true;
  // Generic "company" keyword check — any entity whose type contains "company"
  // (e.g. "Private Limited Company", "Public Company") is treated as corporate.
  if (n.includes("company")) return true;
  return false;
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
