import { describe, it, expect } from 'vitest';
import { computeCarryForward } from './carryForward';

const prior = {
  cyLabel: '2024-25', fyLabel: '2025-26',
  totalDisallowedCY: 500000, totalAllowedFY: 300000, totalStillOutstanding: 200000,
};
const current = {
  cyLabel: '2025-26', fyLabel: '2026-27',
  totalDisallowedCY: 400000, totalAllowedFY: 250000, totalStillOutstanding: 150000,
};

describe('year-over-year carry-forward', () => {
  it('recognises prior-year disallowance paid this year as a deduction and nets the impact', () => {
    const cf = computeCarryForward(prior, current);
    expect(cf.broughtForwardDisallowed).toBe(500000);
    expect(cf.allowedThisYearOnPayment).toBe(300000); // prior FY payment == this year
    expect(cf.stillCarriedForward).toBe(200000);
    expect(cf.currentYearDisallowance).toBe(400000);
    // net add-back = 400000 fresh − 300000 now allowed
    expect(cf.netDisallowanceThisYear).toBe(100000);
    expect(cf.yearsAligned).toBe(true);
  });

  it('flags mis-aligned years when prior.FY !== current.CY', () => {
    const cf = computeCarryForward({ ...prior, fyLabel: '2024-25' }, current);
    expect(cf.yearsAligned).toBe(false);
  });

  it('nets to negative (net deduction) when prior payments exceed fresh disallowance', () => {
    const cf = computeCarryForward(
      { ...prior, totalAllowedFY: 450000 },
      { ...current, totalDisallowedCY: 100000 },
    );
    expect(cf.netDisallowanceThisYear).toBe(-350000);
  });
});
