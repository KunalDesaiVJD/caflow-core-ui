// Default TDS filing quarter/FY based on the current calendar month.
//
// Always resolves to the quarter whose transaction period most recently
// ended, since that's the one users are actively filing/reviewing right
// after quarter-end (return due dates fall in the month(s) following each
// quarter's close):
//   Apr, May, Jun → Q4 (of the FY that just ended — FY rolls back one year)
//   Jul, Aug, Sep → Q1
//   Oct, Nov, Dec → Q2
//   Jan, Feb, Mar → Q3
//
// This is only ever used as an initial default — once a user picks a
// different quarter, that selection is normal component state and this
// function is not consulted again.
export function getDefaultTdsQuarter(): { fy: string; quarter: string } {
  const today = new Date();
  const month = today.getMonth(); // 0-indexed: 0 = Jan ... 11 = Dec
  const currentFYStart = month >= 3 ? today.getFullYear() : today.getFullYear() - 1;

  let quarter: string;
  let fyStart = currentFYStart;
  if (month >= 3 && month <= 5) { quarter = "Q4"; fyStart = currentFYStart - 1; }
  else if (month >= 6 && month <= 8) { quarter = "Q1"; }
  else if (month >= 9 && month <= 11) { quarter = "Q2"; }
  else { quarter = "Q3"; }

  return { fy: `${fyStart}-${String(fyStart + 1).slice(2)}`, quarter };
}

// Default Start Quarter for existing/newly-activated TDS clients that haven't
// picked one yet — Q1 of FY 2025-26, per the migration backfill baseline.
export const DEFAULT_TDS_START_FY = "2025-26";
export const DEFAULT_TDS_START_QUARTER = "Q1";

/** Assessment Year = Financial Year + 1, per Indian tax convention: income
 *  earned in FY 2024-25 is ASSESSED in AY 2025-26. Both directions live here
 *  as the ONE conversion — a Genius file states its period as an Assessment
 *  Year, never a Financial Year, and every screen that lets a user pick "the
 *  FY" needs the same round-trip. A second, independently-written copy of
 *  this ±1 is exactly how a Genius import for FY 2024-25 ends up silently
 *  filed under FY 2025-26: the file's own "A.Y. 2025-26" reads, at a glance,
 *  like it already says "2025-26" — the offset is invisible unless it's
 *  applied consistently everywhere by one function. */
export function financialYearToAssessmentYear(financialYear: string): string {
  const start = parseInt(financialYear.split("-")[0], 10) + 1;
  return `${start}-${String(start + 1).slice(2)}`;
}
export function assessmentYearToFinancialYear(assessmentYear: string): string {
  const start = parseInt(assessmentYear.split("-")[0], 10) - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

const QUARTER_ORDER = ["Q1", "Q2", "Q3", "Q4"];

// Monotonically increasing period number for an FY+quarter pair, so ranges
// across FY boundaries can be compared with plain <=/>=. FY string is
// "YYYY-YY" (e.g. "2026-27"); only the starting year is used.
export function getQuarterPeriodNumber(fy: string, quarter: string): number {
  const fyStart = parseInt(fy.slice(0, 4), 10);
  const qIndex = QUARTER_ORDER.indexOf(quarter);
  return fyStart * 4 + (qIndex >= 0 ? qIndex : 0);
}

// True if (fy, quarter) falls within [startFy, startQuarter] .. [endFy, endQuarter],
// inclusive on both ends. A blank end (null/undefined/"") means "active indefinitely".
export function isQuarterInTdsRange(
  fy: string,
  quarter: string,
  startFy: string,
  startQuarter: string,
  endFy?: string | null,
  endQuarter?: string | null,
): boolean {
  const period = getQuarterPeriodNumber(fy, quarter);
  const startPeriod = getQuarterPeriodNumber(startFy, startQuarter);
  if (period < startPeriod) return false;
  if (endFy && endQuarter) {
    const endPeriod = getQuarterPeriodNumber(endFy, endQuarter);
    if (period > endPeriod) return false;
  }
  return true;
}

// Is this client currently within the TDS module at all, for the given
// FY+quarter? TDS Compliance (Start/End Quarter, set via Edit Client →
// Service Specific → TDS Compliance) is the single source of truth — a
// client with no Start Quarter configured has no real TDS Compliance row
// and must be excluded from every dashboard card and count, not just
// range-restricted quarters. This intentionally fails CLOSED (unlike the
// old per-file "no config = show everywhere" default), since a legacy
// client matched only via a TAN/name fallback (no real client_services row)
// is not actually TDS-compliance-configured.
export function isClientTdsEligible(
  startFy: string | null | undefined,
  startQuarter: string | null | undefined,
  fy: string,
  quarter: string,
  endFy?: string | null,
  endQuarter?: string | null,
): boolean {
  if (!startFy) return false;
  return isQuarterInTdsRange(fy, quarter, startFy, startQuarter || "Q1", endFy, endQuarter);
}

// Client Bifurcation — is this client currently configured (in TDS Compliance
// → TDS Forms Applicable) for the given form? Unlike the quarter-range check
// above, this is deliberately "fail closed": a client with no configured
// forms at all (tds_forms_applicable null/empty — typically one matched into
// the TDS module only via a legacy TAN/name fallback, never actually
// configured) does NOT count toward any specific form. It still shows up
// under an "All Forms" view — callers should skip this check entirely when
// the active form filter is "all".
export function clientHasTdsForm(formsApplicable: string[] | null | undefined, form: string): boolean {
  if (!formsApplicable || formsApplicable.length === 0) return false;
  return formsApplicable.includes(form);
}

/** Minimal shape of a tds_filings row needed to check TDS Compliance membership. */
export interface TdsFilingLike {
  client_id: string;
  financial_year: string;
  quarter: string;
  tds_forms: string[] | null;
}

/** Minimal shape of a client's TDS Compliance config needed to check membership. */
export interface TdsClientConfigLike {
  id?: string;
  tds_start_fy?: string | null;
  tds_start_quarter?: string | null;
  tds_end_fy?: string | null;
  tds_end_quarter?: string | null;
  tds_forms_applicable?: string[] | null;
}

// THE single source of truth for whether a tds_filings row belongs anywhere
// in the TDS module — Dashboard, Filing Summary, Reports, Checklist,
// everywhere. A row only qualifies when its client currently has TDS
// Compliance configured, the row's (FY, quarter) falls in that client's
// configured Start/End Quarter range, AND at least one of the row's own
// tds_forms is still one of the client's current TDS Forms Applicable.
//
// This must be applied UNCONDITIONALLY — not only when a user has picked a
// specific form tab/filter. A stale row left over from before a client's
// forms were reconfigured (e.g. a 27EQ row for a client now configured for
// 26Q only) must never surface, including under "All Forms"/"All" views.
// The currently-selected form tab is a SEPARATE, additional narrowing layered
// on top of this check, never a substitute for it.
export function isFilingTdsCompliant(
  filing: TdsFilingLike,
  client: TdsClientConfigLike | undefined,
): boolean {
  if (!client?.tds_start_fy) return false;
  if (!isQuarterInTdsRange(
    filing.financial_year, filing.quarter,
    client.tds_start_fy, client.tds_start_quarter || "Q1",
    client.tds_end_fy, client.tds_end_quarter,
  )) return false;
  const configuredForms = client.tds_forms_applicable;
  if (!configuredForms || configuredForms.length === 0) return false;
  const rowForms = filing.tds_forms || [];
  return rowForms.some(f => configuredForms.includes(f));
}
