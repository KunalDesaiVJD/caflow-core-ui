# Threshold Master — editable limits (FY 2025-26)

> The **live** thresholds are the `threshold_value` column on `public.scrutiny_rules`, edited in the
> Rules Master (firm partners/admins only, every edit logged — canonical decision #11). **This file
> is the human-readable register** for the Senior CA to review each year and when the law changes.
> Update both: change the DB value AND note it here. Only rules with a numeric limit appear below;
> presence/keyword rules (e.g. "suspense balance exists") have no editable threshold.

## Cash & income-tax (CASH)
| Rule | Limit | Basis | Note |
|---|---|---|---|
| CASH-001 | ₹2,00,000 | Sec 269ST | day-end cash balance |
| CASH-002 | ₹20,000 | Sec 40A(3) | single cash payment (₹35,000 for transport — §8 default, not yet per-rule) |
| CASH-003 | ₹2,00,000 | Sec 269ST | single cash receipt |
| CASH-004 | ₹10,000 | Sec 40A(3) | cash capital payment |
| CASH-005 | ₹50,000 | — | round-number cash txn |
| CASH-006 | ₹500 | — | book vs physical cash |
| CASH-007 | 5 / week | — | cash-withdrawal frequency |

## TDS
| Rule | Limit | Section |
|---|---|---|
| TDS-001 | ₹30,000 | 194J |
| TDS-002 | ₹30,000 | 194C (single; ₹1,00,000 aggregate not yet modelled) |
| TDS-003 | ₹40,000 | 194A |
| TDS-004 | ₹2,40,000 | 194I |
| TDS-005 | 7 days | 201(1A) — deposit lateness |

## Receivables / Payables (DEBT / CRED)
| Rule | Limit | Basis |
|---|---|---|
| DEBT-001 | 180 days | ageing |
| DEBT-006 | 50% | provision adequacy vs aged debtors |
| DEBT-007 | 10 | round-off count |
| CRED-002 | 365 days | Sec 41(1) |
| CRED-003 | 45 days | MSMED Act Sec 16 |
| CRED-007 | ₹5,00,000 | SA 505 materiality (confirmation) |

## Expenses / Sales (EXP / SALES)
| Rule | Limit | Basis |
|---|---|---|
| EXP-002 | 200% of PY | expense spike |
| EXP-003 | ₹5,00,000 | repairs → capital? |
| EXP-007 | 2% of total | misc expenses |
| SALES-001 | 5% of sales | credit notes |
| SALES-004 | 10% | unbilled revenue |
| SALES-006 | 150% of avg | March revenue spike |

## Fixed assets / Inventory (FA / INV)
| Rule | Limit | Basis |
|---|---|---|
| FA-001 | ₹1,00,000 | capex charged to P&L |
| FA-002 | 5% | depreciation-rate variance (Sch II) |
| FA-005 | 730 days | CWIP ageing |
| INV-002 | 180 days | slow-moving stock |
| INV-003 | 10% | valuation-method variance |
| INV-004 | 2% | physical vs book variance |

## Ratios / Related parties (RAT / RPT)
| Rule | Limit | Basis |
|---|---|---|
| RAT-001 | 5% | GP ratio change |
| RAT-002 | 10% | NP ratio change |
| RAT-003 | 1.0 | current ratio floor (SA 570) |
| RAT-004 / 005 / 006 | 20% | debt-equity / inventory-turnover / debtor-turnover change |
| RPT-001 / 002 | 10% | below/above-market RPT pricing |
| RPT-004 | 11% | director remuneration (Sch V) |

## Payroll / Capital / Provisions / Compliance / Loans / Bookkeeping
| Rule | Limit | Basis |
|---|---|---|
| PAY-001 | ₹15,000 | EPF applicability |
| PAY-002 | ₹21,000 | ESIC applicability |
| LOAN-005 | 8% | below-market loan interest (Sec 56(2)) |
| CAP-007 | 25% | DRR adequacy (Sec 71) |
| PROV-002 | 25% of PBT | tax-provision adequacy |
| PROV-005 | 50% | doubtful-debt provision change |
| COMP-001 | 2% | CSR (Sec 135) |
| COMP-003 | 4 | min board meetings (Sec 173) |
| COMP-005 | 15 days | ADT-1 filing |
| COMP-007 | 30 days | charge registration (Sec 77) |
| JE-002 | ₹5,00,000 | large year-end JE |
| JE-004 | 3 | recurring round JE count |
| BKR-003 | ₹1,000 | bank-recon difference |
| BKR-004 | 180 days | stale cheques |
| BKR-006 | 0.5% of turnover | bank charges |

### Annual-review checklist for the Senior CA
1. Confirm the **269ST / 40A(3)** limits (and the ₹35,000 transport exception — see §8).
2. Re-check **TDS section thresholds** against the current Finance Act.
3. Confirm **EPF/ESIC wage ceilings** (PAY-001/002).
4. Review **materiality** limits (CRED-007 ₹5L) against engagement-specific materiality.
5. Apply changes in the Rules Master (DB) **and** here.
