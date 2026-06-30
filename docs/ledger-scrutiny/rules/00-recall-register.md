# Recall Register — what the engine can't (yet) catch

> "Recall" = the share of true issues a check would miss. This register is deliberately honest so the
> Senior CA knows where **manual work is still required** and doesn't over-trust the automation
> (coverage is advisory only — decision #8). Cross-ref the tiers in
> [01-check-kinds.md](01-check-kinds.md).

## Structural limits (affect many rules)

- **Voucher `line_items` are frequently partial/empty.** Only the row-level party leg
  (`party_ledger` + `amount` + `dr_cr`) is reliable. → any rule needing *both* legs
  (contra matching, journal reversals, the TDS counter-leg) **under-detects**. Confirm manually.
- **69 of 119 rules are "advisory"** — they need data Tally doesn't hold (related-party list, market
  rates, MSME registration, ROC/MCA filings, statutory registers, physical verification, bank
  statements, TDS challan/return dates). The engine flags them "not auto-verified" rather than
  passing them — the auditor must still perform these. They become automatic only when the fact
  masters (Phase 3) and file-upload connectors (Phase 5) land.
- **Two TB sources exist** (`trial_balance_snapshots` vs `tally_*`). The engine runs on
  `trial_balance_snapshots`; if a client's snapshot is stale, findings are stale.
- **Entity applicability is not yet enforced per rule** (`applicable_to` defaults to all types). So
  company-only rules (CAP-*, COMP-*) can raise **false positives** for proprietorships / firms until
  per-rule applicability is wired. The CA should disregard those for non-companies.

## Per-check recalls (the automated 50)

| Check (rules) | What it misses |
|---|---|
| `single_txn` — 269ST/40A(3) (CASH-002/003) | flags each cash txn over the limit; **aggregate per party/day** is only caught where the counterparty is resolvable from narration — structured splitting below the limit is missed. |
| `daily_max` (CASH-001) | running cash balance is reconstructed from cash vouchers; if opening cash isn't seeded, the day-end figure can be off. |
| `keyword_balance` / `keyword_narration` / `separate_balance` | depend on **ledger/narration wording**. Non-standard names (e.g. a suspense account not named "suspense") are missed. |
| `sign_reversal` (BKR-001/DEBT-005/CRED-001) | account nature is inferred from `parent_group` keywords; mis-grouped or oddly-named ledgers fall out of scope. |
| `ageing` (DEBT-001, CRED-002, INV-002, FA-005) | TB gives a balance, **not an age** — true bill-wise ageing needs detail not in the snapshot; currently advisory. |
| `tds_missing` (TDS-001..004, PAY-006) | needs the TDS counter-leg; partial `line_items` → under-detect; section mapping is by keyword. |
| `py_comparison` / `capital_change` | matches ledgers across years by **normalised name** — a renamed or merged ledger breaks the match. Needs a prior-year snapshot. |
| `capital_in_expense` / `cash_capital_payment` | keyword heuristic on asset words (machinery, building…); a capital item under a custom name is missed (and a genuinely revenue "repair" can false-positive). |
| `missing_provision` / `missing_deduction` / `missing_disclosure` | absence checks — they flag when a ledger is **not present**; an entity that legitimately has no such liability gets a (harmless, advisory) flag to confirm. |
| `duplicate_amount_date` | same amount+date+party; genuine repeat transactions (e.g. daily identical rent) can false-positive. |
| `month_spike` / `frequency` / `recurring_round_je` | aggregate heuristics — seasonal businesses (real March spike) and legitimate recurring entries can false-positive. |

## How to read a scrutiny run

1. **Automated findings (50 rules)** — review, then Accept / raise Query / Note / Override.
2. **Advisory findings (69 rules)** — these are reminders that an item was **not auto-checked**; do
   the manual procedure and record the conclusion.
3. **Coverage never blocks Sign-off / UDIN** (decision #8). A clean automated run is *not* assurance
   on the advisory items.
