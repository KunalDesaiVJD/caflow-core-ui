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
