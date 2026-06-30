# Scrutiny Rules Master — 119 rules (FY 2025-26 seed)

> **Source:** `supabase/migrations/20260311080607_2cf84a88-e030-4d71-a4bd-8152b60b5b96.sql`
> (`-- Seed 119 scrutiny rules`). This is a **faithful catalogue** of what is seeded in git —
> nothing invented. Full `audit_query_template` + raw `detection_logic` JSON live in that
> migration. **Senior CA:** review thresholds/severity here; edits belong in the Rules Master
> (`scrutiny_rules` table, `is_superadmin()` gated) per canonical decision #11.

**Shape:** 17 categories × 7 rules = 119. Columns: ID · Rule · Severity · Threshold · Legal ref · `check` kind.
Threshold "—" = `0`/none (presence check). `lvl` = detection_level (account / voucher / ratio / aggregate).

## BKR — Bookkeeping (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| BKR-001 | Abnormal Balance — Credit in Asset Account | high | — | — | sign_reversal |
| BKR-002 | Suspense Account Balance at Year End | high | nonzero | — | keyword_balance |
| BKR-003 | Unreconciled Bank Balance | medium | ₹1,000 | — | bank_recon_diff |
| BKR-004 | Stale Cheques Not Reversed | medium | 180 days | — | stale_cheques |
| BKR-005 | Contra Entries Without Matching | low | — | — | unmatched_contra |
| BKR-006 | Bank Charges Abnormally High | low | 0.5% turnover | — | ratio_to_turnover |
| BKR-007 | Fixed Deposit Not in Investments | medium | — | — | fd_classification |

## CASH — Cash & 269ST/40A(3) (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| CASH-001 | Cash Balance Exceeds ₹2L at Day End | high | ₹2,00,000 | 269ST | daily_max |
| CASH-002 | Single Cash Payment >₹20,000 | high | ₹20,000 | 40A(3) | single_txn (debit) |
| CASH-003 | Single Cash Receipt >₹2L | high | ₹2,00,000 | 269ST | single_txn (credit) |
| CASH-004 | Cash Payments for Capital Expenditure | medium | ₹10,000 | 40A(3) | cash_capital_payment |
| CASH-005 | Round Number Cash Transactions | low | ₹50,000 | — | round_number |
| CASH-006 | Cash Discrepancy — Book vs Physical | high | ₹500 | — | cash_discrepancy |
| CASH-007 | Frequent Cash Withdrawals | medium | 5 / week | — | frequency |

## SALES — Revenue (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| SALES-001 | Credit Notes >5% of Sales | high | 5% | — | ratio |
| SALES-002 | Sales Without GST Invoice | high | — | CGST Act Sec 31 | missing_field |
| SALES-003 | Revenue Before Delivery | medium | — | Ind AS 115/AS 9 | date_sequence |
| SALES-004 | Unbilled Revenue at Year End | medium | 10% | — | keyword_balance |
| SALES-005 | Sales Returns Not Netted | low | — | — | separate_balance |
| SALES-006 | March Revenue Spike >150% Average | high | 150% | — | month_spike |
| SALES-007 | Inter-Company Sales Without Elimination | medium | — | Ind AS 110 | related_party_sales |

## EXP — Expenses (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| EXP-001 | Purchases Without Creditor Entry | high | — | — | no_corresponding_entry |
| EXP-002 | Expense Spike >200% of PY | medium | 200% | — | py_comparison |
| EXP-003 | Repairs >₹5L — Should Be Capital? | high | ₹5,00,000 | AS 10/Ind AS 16 | single_txn |
| EXP-004 | Personal Expenses in Business | high | — | Sec 37(1) | keyword_narration |
| EXP-005 | Duplicate Invoice Booking | high | — | — | duplicate_amount_date |
| EXP-006 | Expenses After Year End | medium | — | — | post_period_entry |
| EXP-007 | Misc Expenses >2% of Total | medium | 2% | — | ratio |

## DEBT — Trade Receivables (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| DEBT-001 | Debtors >180 Days | high | 180 days | — | ageing |
| DEBT-002 | Debtor Exceeds Credit Limit | medium | — | — | credit_limit_breach |
| DEBT-003 | Bad Debt Write-Off Without Approval | high | — | Sec 36(1)(vii) | keyword_narration |
| DEBT-004 | Revenue Without Debtor Entry | medium | — | — | no_corresponding_entry |
| DEBT-005 | Credit Balance in Debtor | medium | — | — | sign_reversal |
| DEBT-006 | Provision for Doubtful Debts Inadequate | high | 50% | AS 29/Ind AS 37 | provision_adequacy |
| DEBT-007 | Round-Off Adjustments in Debtors | low | 10 | — | keyword_count |

## CRED — Trade Payables (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| CRED-001 | Creditor Debit Balance | medium | — | — | sign_reversal |
| CRED-002 | Creditors >365 Days | high | 365 days | Sec 41(1) | ageing |
| CRED-003 | MSME Payment Beyond 45 Days | high | 45 days | MSMED Act Sec 16 | msme_payment_delay |
| CRED-004 | Creditor Without Purchase Entry | medium | — | — | no_corresponding_entry |
| CRED-005 | New Creditors at Year End | medium | March | — | new_account_month |
| CRED-006 | Related Party Creditor Undisclosed | high | — | AS 18/Ind AS 24 | related_party_creditor |
| CRED-007 | Creditor Confirmation Not Obtained | medium | ₹5,00,000 | SA 505 | balance_exceeds |

## LOAN — Borrowings (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| LOAN-001 | Loans from Directors — Sec 73 | high | — | CA Sec 73 | keyword_balance |
| LOAN-002 | Unsecured Loans Without Resolution | high | — | CA Sec 179/180 | keyword_balance |
| LOAN-003 | Loan Repayment Without Interest | high | — | Sec 194A | repayment_without_interest |
| LOAN-004 | Inter-Corporate Deposits — Sec 186 | high | — | CA Sec 186 | keyword_balance |
| LOAN-005 | Loan Interest Below Market Rate | medium | 8% | Sec 56(2) | interest_rate_below |
| LOAN-006 | Personal Guarantee for Company Loan | medium | — | CA Sec 185 | guarantee_disclosure |
| LOAN-007 | Employee Loans Without Recovery | low | — | — | keyword_balance |

## FA — Fixed Assets (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| FA-001 | Capital Expenditure Charged to P&L | high | ₹1,00,000 | AS 10/Ind AS 16 | capital_in_expense |
| FA-002 | Depreciation Rate Mismatch | medium | 5% | CA Sch II | dep_rate_variance |
| FA-003 | Asset Disposed Without Approval | medium | — | — | keyword_narration |
| FA-004 | Impairment Not Assessed | medium | — | AS 28/Ind AS 36 | impairment_indicator |
| FA-005 | Capital WIP >2 Years | high | 730 days | — | cwip_ageing |
| FA-006 | Fully Depreciated Assets in Use | low | — | Ind AS 16.51 | fully_depreciated_in_use |
| FA-007 | Assets Not Physically Verified | medium | — | SA 501 | physical_verification |

## INV — Inventory (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| INV-001 | Negative Stock Balance | high | — | — | negative_balance |
| INV-002 | Slow Moving Inventory >180 Days | medium | 180 days | AS 2/Ind AS 2 | inventory_ageing |
| INV-003 | Inventory Valuation Inconsistency | high | 10% | AS 2/Ind AS 2 | valuation_method_change |
| INV-004 | Physical vs Book Stock Variance | high | 2% | — | stock_variance |
| INV-005 | Goods in Transit at Year End | medium | — | — | keyword_balance |
| INV-006 | Obsolete Stock Not Written Down | medium | — | AS 2/Ind AS 2 | obsolete_stock |
| INV-007 | Excise/GST Not in Valuation | low | — | AS 2 Para 11 | duty_inclusion |

## TDS — Tax Deducted at Source (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| TDS-001 | 194J Without TDS | high | ₹30,000 | Sec 194J | tds_missing |
| TDS-002 | 194C Without TDS | high | ₹30,000 | Sec 194C | tds_missing |
| TDS-003 | 194A Interest Without TDS | high | ₹40,000 | Sec 194A | tds_missing |
| TDS-004 | 194I Rent Without TDS | high | ₹2,40,000 | Sec 194I | tds_missing |
| TDS-005 | TDS Deposited Late | high | 7 days | Sec 201(1A) | tds_late_deposit |
| TDS-006 | Lower Deduction Certificate Invalid | medium | — | Sec 197 | lower_tds_cert_validity |
| TDS-007 | TDS Return Filing Delayed | medium | — | Sec 234E | tds_return_delay |

## RPT — Related Parties (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| RPT-001 | Related Party Sales Below Market | high | 10% | Sec 40A(2)/Ind AS 24 | below_market_rate |
| RPT-002 | Related Party Purchases Above Market | high | 10% | Sec 40A(2) | above_market_rate |
| RPT-003 | RPT Without Disclosure | high | — | AS 18/Ind AS 24 | rpt_disclosure_missing |
| RPT-004 | Director Remuneration Exceeds Limits | high | 11% | CA Sec 197/Sch V | remuneration_limit |
| RPT-005 | Loans to Directors Without Approval | high | — | CA Sec 185 | keyword_balance |
| RPT-006 | Guarantee for Related Party | medium | — | CA Sec 186 | guarantee_related_party |
| RPT-007 | Investment in Related Party | medium | — | CA Sec 186 | investment_related_party |

## JE — Journal-Entry Red Flags (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| JE-001 | Journal Entries on Weekends/Holidays | medium | — | — | weekend_holiday_entry |
| JE-002 | Large JEs Near Year End | high | ₹5,00,000 | — | yearend_large_je |
| JE-003 | JE Without Narration | medium | — | — | blank_narration |
| JE-004 | Recurring Round Number JEs | medium | 3× | — | recurring_round_je |
| JE-005 | Reversing Entries Without Explanation | medium | — | — | reversal_entry |
| JE-006 | Entries by Unauthorized Users | high | — | — | unauthorized_user |
| JE-007 | Post-Dated Entries | medium | — | — | future_date_entry |

## RAT — Ratios (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| RAT-001 | GP Ratio Change >5% from PY | medium | 5% | — | ratio_change |
| RAT-002 | NP Ratio Significant Change | medium | 10% | — | ratio_change |
| RAT-003 | Current Ratio Below 1 | high | 1.0 | SA 570 | ratio_below |
| RAT-004 | Debt-Equity Ratio Deterioration | medium | 20% | — | ratio_change |
| RAT-005 | Inventory Turnover Decline | medium | 20% | — | ratio_change |
| RAT-006 | Debtor Turnover Decline | medium | 20% | — | ratio_change |
| RAT-007 | Operating Cash Flow Negative | high | — | SA 570 | negative_ocf |

## PAY — Payroll (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| PAY-001 | Salary Without PF Deduction | high | ₹15,000 | EPF Act | missing_deduction (PF) |
| PAY-002 | Salary Without ESI | high | ₹21,000 | ESIC Act | missing_deduction (ESI) |
| PAY-003 | Bonus Not Paid | medium | — | Payment of Bonus Act | missing_provision |
| PAY-004 | Gratuity Provision Inadequate | medium | — | AS 15/Ind AS 19 | provision_adequacy_keyword |
| PAY-005 | Leave Encashment Not Provided | medium | — | AS 15 | missing_provision |
| PAY-006 | Directors Sitting Fee Without TDS | high | — | Sec 194J | tds_missing |
| PAY-007 | Excess Partner Remuneration | high | — | Sec 40(b) | partner_remuneration_limit |

## CAP — Capital & Reserves (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| CAP-001 | Share Capital Change Without Filing | high | — | CA Sec 39/64 | capital_change |
| CAP-002 | Dividend Without Adequate Profit | high | — | CA Sec 123 | dividend_adequacy |
| CAP-003 | Securities Premium Misused | medium | — | CA Sec 52 | premium_utilization |
| CAP-004 | Revaluation Without Valuer | medium | — | CA Sec 247 | keyword_balance |
| CAP-005 | Capital Reduction Without Tribunal | high | — | CA Sec 66 | capital_reduction |
| CAP-006 | Buy-Back Not Per Sec 68 | high | — | CA Sec 68 | keyword_narration |
| CAP-007 | DRR Inadequate | high | 25% | CA Sec 71 | drr_adequacy |

## PROV — Provisions & Contingencies (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| PROV-001 | Contingent Liability Undisclosed | high | — | AS 29/Ind AS 37 | missing_disclosure |
| PROV-002 | Tax Provision Inadequate | high | 25% | — | tax_provision_adequacy |
| PROV-003 | Warranty Provision Missing | medium | — | AS 29/Ind AS 37 | missing_provision |
| PROV-004 | Litigation Not Provided | high | — | AS 29/Ind AS 37 | keyword_balance |
| PROV-005 | Doubtful Debt Provision Change >50% | medium | 50% | — | py_comparison |
| PROV-006 | Deferred Tax Not Computed | high | — | AS 22/Ind AS 12 | missing_provision |
| PROV-007 | Restructuring Without Plan | medium | — | Ind AS 37 | keyword_balance |

## COMP — Companies-Act Compliance (7)
| ID | Rule | Sev | Threshold | Legal | check |
|---|---|---|---|---|---|
| COMP-001 | CSR Below 2% of Net Profit | high | 2% | CA Sec 135 | csr_adequacy |
| COMP-002 | Annual Return Not Filed | high | — | CA Sec 92 | filing_compliance (MGT-7) |
| COMP-003 | Board Meeting Frequency | medium | 4 | CA Sec 173 | meeting_frequency |
| COMP-004 | Statutory Registers Not Maintained | medium | — | CA Sec 88 | register_maintenance |
| COMP-005 | ADT-1 Not Filed | medium | 15 days | CA Sec 139(1) | filing_compliance (ADT-1) |
| COMP-006 | RPT Register Not Updated | medium | — | CA Sec 189 | register_maintenance (MBP-4) |
| COMP-007 | Charge Not Registered | high | 30 days | CA Sec 77 | charge_registration |

---

### Severity distribution
high = 58 · medium = 53 · low = 8 (counted from the seed). The Senior CA may re-tier in the Rules Master.

### `applicable_to` (all rules, per seed default)
`["company","llp","individual","firm","trust","huf","aop"]` — entity-applicability filtering
(e.g. COMP-*/CAP-* really only apply to companies) is **not yet encoded per-rule** and is a
Rules-Master refinement for the Senior CA.
