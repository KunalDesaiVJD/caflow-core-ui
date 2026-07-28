// MSME 43B(h) — year-over-year carry-forward.
//
// The section works on a rolling basis: an amount disallowed in year N (added
// back to income) is allowed as a deduction in the year it is ACTUALLY PAID.
// When auditing year N (current run, CY=N, FY=N+1), the relevant prior run is
// the one for year N-1 (CY=N-1, FY=N) — its FY equals the current CY. That prior
// run already told us how much of its N-1 disallowance was paid during year N;
// that amount is now an allowable deduction in the current year.
//
//   Net s.43B(h) P&L impact for the current year
//     = current-year disallowance (add-back)
//       − prior-year disallowance now paid this year (deduction)

export interface CarryForwardInput {
  cyLabel: string;
  fyLabel: string;
  totalDisallowedCY: number;
  totalAllowedFY: number;
  totalStillOutstanding: number;
}

export interface CarryForward {
  priorCyLabel: string;
  priorFyLabel: string;
  currentCyLabel: string;
  /** amount disallowed (added back) in the prior year */
  broughtForwardDisallowed: number;
  /** of the b/f disallowance, the part paid during the current year → deductible now */
  allowedThisYearOnPayment: number;
  /** of the b/f disallowance, the part still unpaid → continues to carry forward */
  stillCarriedForward: number;
  /** fresh disallowance computed for the current year */
  currentYearDisallowance: number;
  /** net add-back for the current year = current disallowance − b/f now allowed */
  netDisallowanceThisYear: number;
  /** true when prior.fyLabel === current.cyLabel (correctly chained years) */
  yearsAligned: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeCarryForward(
  prior: CarryForwardInput,
  current: CarryForwardInput,
): CarryForward {
  const allowedThisYearOnPayment = r2(prior.totalAllowedFY);
  return {
    priorCyLabel: prior.cyLabel,
    priorFyLabel: prior.fyLabel,
    currentCyLabel: current.cyLabel,
    broughtForwardDisallowed: r2(prior.totalDisallowedCY),
    allowedThisYearOnPayment,
    stillCarriedForward: r2(prior.totalStillOutstanding),
    currentYearDisallowance: r2(current.totalDisallowedCY),
    netDisallowanceThisYear: r2(current.totalDisallowedCY - allowedThisYearOnPayment),
    yearsAligned: prior.fyLabel === current.cyLabel,
  };
}
