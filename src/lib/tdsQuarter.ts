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
