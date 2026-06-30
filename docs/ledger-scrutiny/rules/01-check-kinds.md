# `detection_logic` Check Kinds — Interpreter Spec (gap G1)

> Enumerated by extracting every `"check":"…"` from the 119-rule seed
> (`20260311080607_…sql`) — **83 distinct check kinds**. This is the spec the engine must
> implement so the catalogue actually runs (today `run-scrutiny` runs ~9 hardcoded checks and
> ignores all of this).

## Feasibility tiers (first-pass — Senior CA to confirm)

Each check is tiered by whether it is computable from the data we actually have
(`tally_trial_balance` = account grain, `tally_vouchers` = voucher grain) vs needs data that
lives **outside** Tally.

| Tier | Meaning | Kinds | Rules |
|---|---|---|---|
| **A — Automatable now** | Deterministic from TB and/or vouchers alone | 20 | **37** |
| **B — Heuristic / partial** | Needs PY snapshot, COA family, turnover base, narration, or cross-ledger matching; may under-detect | 33 | **50** |
| **C — Fact-gated / manual** | Needs data not in Tally (registers, market rates, filings, physical counts); → Phase-3 fact masters / Phase-5 uploads, else emit **advisory "verify manually"** | 30 | **32** |
| | | **83** | **119** |

➡️ **Build order: A → B → C.** Tier A delivers real findings immediately and is fully testable
against TB/vouchers. Tier C must **never silently pass** — emit an advisory finding so the auditor
knows it wasn't checked.

---

## Tier A — Automatable now (20 kinds, 37 rules)

| check | #rules | grain | logic |
|---|---|---|---|
| `keyword_balance` | 11 | TB | ledger name matches keywords AND balance nonzero |
| `keyword_narration` | 4 | voucher | narration matches keyword list |
| `sign_reversal` | 3 | TB | balance sign opposite to expected (asset Cr / debtor Cr / creditor Dr) |
| `single_txn` | 3 | voucher | amount > threshold, optional dr_cr direction |
| `balance_exceeds` | 1 | TB | abs(closing balance) > threshold |
| `negative_balance` | 1 | TB | balance < 0 (stock/inventory) |
| `daily_max` | 1 | voucher agg | running cash balance per day > threshold |
| `round_number` | 1 | voucher | cash amount is round AND > threshold |
| `frequency` | 1 | voucher agg | count of cash withdrawals/week ≥ threshold |
| `duplicate_amount_date` | 1 | voucher | same amount + date (+party) repeated |
| `post_period_entry` | 1 | voucher | voucher_date > FY end |
| `future_date_entry` | 1 | voucher | voucher_date in the future |
| `weekend_holiday_entry` | 1 | voucher | date is Sat/Sun (holiday list optional) |
| `blank_narration` | 1 | voucher | journal voucher, empty narration |
| `yearend_large_je` | 1 | voucher | journal near FY end, amount > threshold |
| `recurring_round_je` | 1 | voucher agg | identical round JE amount ≥ N times |
| `reversal_entry` | 1 | voucher | entry followed by exact opposite |
| `keyword_count` | 1 | voucher agg | count of keyword-matching entries ≥ threshold |
| `separate_balance` | 1 | TB | "sales return"-type ledger shown separately |
| `month_spike` | 1 | voucher agg | month total vs average × threshold% |

## Tier B — Heuristic / partial (33 kinds, 50 rules)

| check | #rules | needs | logic |
|---|---|---|---|
| `tds_missing` | 5 | TDS ledger cross-check | expense over section threshold without TDS counter-leg |
| `ratio_change` | 5 | PY ratios + classified BS/PL | YoY change in a named ratio > threshold% |
| `missing_provision` | 4 | TB keyword absence | provision ledger absent (bonus/leave/DT/warranty) |
| `no_corresponding_entry` | 3 | cross-ledger | purchase↔creditor / sale↔debtor mismatch |
| `ratio` | 2 | base total | value as % of a base |
| `py_comparison` | 2 | PY snapshot | balance vs prior year |
| `ageing` | 2 | bill-wise / last-txn date | balance older than N days (TB gives balance, not age) |
| `missing_deduction` | 2 | PF/ESI ledger | salary without PF/ESI counter-leg |
| `ratio_to_turnover` | 1 | turnover | value as % of turnover |
| `ratio_below` | 1 | classified BS | ratio (e.g. current ratio) below threshold |
| `negative_ocf` | 1 | derived cash flow | operating cash flow < 0 |
| `unmatched_contra` | 1 | cross-voucher | contra without matching leg |
| `inventory_ageing` | 1 | item age | stock not moved > N days |
| `cwip_ageing` | 1 | CWIP open date | CWIP outstanding > N days |
| `cash_capital_payment` | 1 | COA family | cash payment to a capital-nature ledger |
| `new_account_month` | 1 | ledger creation date | ledger first appears in March |
| `repayment_without_interest` | 1 | voucher heuristic | loan repayment with no interest leg |
| `capital_in_expense` | 1 | COA family | capital-nature item booked to expense |
| `provision_adequacy` | 1 | aged base | provision % of aged debtors |
| `provision_adequacy_keyword` | 1 | TB | gratuity provision present/adequate |
| `dep_rate_variance` | 1 | Sch II rates + asset class | depreciation rate differs from Schedule II |
| `tax_provision_adequacy` | 1 | PBT | tax provision % of PBT |
| `dividend_adequacy` | 1 | distributable profit | dividend vs available profit |
| `drr_adequacy` | 1 | TB | DRR vs required % |
| `csr_adequacy` | 1 | avg net profit | CSR spend vs 2% |
| `capital_change` | 1 | PY | share-capital movement vs PY |
| `capital_reduction` | 1 | TB | capital reduction movement |
| `premium_utilization` | 1 | TB | securities-premium movement |
| `remuneration_limit` | 1 | TB | director remuneration vs Sch V % |
| `partner_remuneration_limit` | 1 | TB | partner remuneration vs Sec 40(b) |
| `interest_rate_below` | 1 | TB | implied loan interest rate < threshold |
| `missing_disclosure` | 1 | TB keyword | contingent-liability ledger absent |
| `missing_field` | 1 | voucher field | sales without GST invoice (if captured) |

## Tier C — Fact-gated / manual (30 kinds, 32 rules)

These cannot be derived from Tally. Until the **fact masters (Phase 3)** and **manual uploads
(Phase 5: GST-2B / 26AS / bank / registers)** exist, the engine should emit them as **advisory
findings** ("not auto-verified — confirm manually") rather than skip them.

| check (rules) | external data needed |
|---|---|
| `bank_recon_diff` (BKR-003) | bank statement |
| `stale_cheques` (BKR-004) | cheque register |
| `fd_classification` (BKR-007) | FD schedule |
| `cash_discrepancy` (CASH-006) | physical cash count |
| `date_sequence` (SALES-003) | dispatch/delivery dates |
| `related_party_sales` (SALES-007), `below_market_rate` (RPT-001), `above_market_rate` (RPT-002) | RP list + market price |
| `related_party_creditor` (CRED-006), `rpt_disclosure_missing` (RPT-003) | RP nomination + disclosures |
| `guarantee_disclosure` (LOAN-006), `guarantee_related_party` (RPT-006), `investment_related_party` (RPT-007) | guarantee/investment register + RP list |
| `credit_limit_breach` (DEBT-002) | credit-limit master |
| `msme_payment_delay` (CRED-003) | MSME registration status of vendor |
| `impairment_indicator` (FA-004), `fully_depreciated_in_use` (FA-006), `physical_verification` (FA-007) | fixed-asset register + PV records |
| `valuation_method_change` (INV-003), `stock_variance` (INV-004), `obsolete_stock` (INV-006), `duty_inclusion` (INV-007) | physical stock + valuation working |
| `tds_late_deposit` (TDS-005), `tds_return_delay` (TDS-007), `lower_tds_cert_validity` (TDS-006) | challan/return dates + 197 certificate |
| `unauthorized_user` (JE-006) | Tally user/access log |
| `filing_compliance` (COMP-002, COMP-005), `register_maintenance` (COMP-004, COMP-006), `meeting_frequency` (COMP-003), `charge_registration` (COMP-007) | MCA/ROC filings + board minutes + statutory registers |

---

## Interpreter design implications

1. **Registry pattern.** One handler per check kind, keyed by `detection_logic.check`; the engine
   loops the 119 active rules, dispatches to the handler, passes `detection_logic` params +
   `threshold_value`. Unknown check → log + emit advisory (never silently drop).
2. **Two data passes.** Load `tally_trial_balance` once (account grain) and `tally_vouchers` once
   (voucher grain), each paginated at 1000 (PostgREST cap); resolve the **tally** engagement id via
   `useTallyEngagementId` first. Account-grain handlers read the TB pass; voucher/aggregate handlers
   read the voucher pass. This avoids the current O(rules × accounts) per-rule re-query.
3. **COA family hook (gap G5).** Tier B handlers needing a family (`cash_capital_payment`,
   `capital_in_expense`, sign-by-nature) call the `coaClassifier` over
   `audit_engagements.coa_mapping` (see [01-existing-system-map.md](../dossier/01-existing-system-map.md)),
   with a keyword fallback for sub-families (transport/freight for 40A(3)).
4. **PY snapshot dependency.** Tier B `ratio_change`/`py_comparison`/`capital_change` need prior-year
   balances — wire to the existing prior-year snapshot mechanism or gate as advisory if absent.
5. **Server-side.** Implement in the `run-scrutiny` edge function (replacing its 9 hardcoded checks),
   not client-side, so it scales to 119 rules and writes findings in bulk. Keep the existing
   `claude-gateway` AI-narration enrichment as a layer on top.
6. **Write target.** Findings go to the reconciled `scrutiny_findings` schema (gap G2 must land
   first) with rule_id, severity, the rendered `audit_query_template`, and the maker-checker fields.
7. **Coverage honesty (decision #8).** Report Tier-A/B/C coverage per engagement so the CA sees what
   was auto-checked vs advisory — but coverage is **advisory only, never blocks sign-off/UDIN**.
