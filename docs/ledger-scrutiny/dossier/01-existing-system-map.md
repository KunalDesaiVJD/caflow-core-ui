# 01 — Existing Scrutiny System Map (REVIVE, don't rebuild)

_Produced 2026-06-30 from a 6-agent read-only sweep of the worktree, then directly verified._

## TL;DR

The handoff assumed a **greenfield rebuild** on top of prepared material that was lost.
**That assumption is wrong.** A working **v1 scrutiny stack already exists in this repo** —
including a **119-rule catalogue seeded in git with populated `detection_logic`**. The real
job is to **connect, consolidate, and secure** what's already here, not to invent 122 rules.

➡️ **Golden Rule #6 ("never invent audit logic") is satisfied without any external rule
source** — the 119 rules (with thresholds + legal references) are in git.

## What already exists (verified, with file refs)

| Piece | Location | State |
|---|---|---|
| **Rules catalogue — 119 rules** | `supabase/migrations/20260311080607_2cf84a88….sql` line 68 onward (`-- Seed 119 scrutiny rules`) | ✅ in git, `detection_logic` **populated** per rule |
| `scrutiny_rules` table + RLS | same migration, lines 8–44 (read-all; insert/update/delete = `is_superadmin()`) | ✅ in git |
| `scrutiny_findings` table | dashboard-created (no `CREATE TABLE` migration); `types.ts` is **STALE** | ⚠️ schema drift |
| **Engine** `run-scrutiny` | `supabase/functions/run-scrutiny/index.ts` | ⚠️ runs **9 hardcoded checks** (`P03/P06/P07/P08/O01/C01/C08/T05/T01`) + AI narration `NAR_AI`; **ignores the 119 `detection_logic` rules** |
| `export-scrutiny-xlsx` | `supabase/functions/export-scrutiny-xlsx/index.ts` | ✅ exists |
| AI gateway `claude-gateway` | `supabase/functions/claude-gateway/index.ts` | ✅ exists (used for narration) |
| In-pipeline UI `PipelineStage4` | `src/components/pipeline/PipelineStage4.tsx`, mounted at `AuditPipeline.tsx` `activeStage===4` (≈L1698) | 🚫 **DEAD** — writes columns not in the table, every call cast `as any` |
| Standalone UI `AuditScrutiny` | `src/pages/AuditScrutiny.tsx` at `/audit/scrutiny` (+ sidebar "Scrutiny Engine") | ✅ LIVE dashboard; calls `run-scrutiny` + `export-scrutiny-xlsx` |
| Maker-checker query store | `audit_client_queries` (`source='Scrutiny Finding'`, `source_ref_id`); bridge in `PipelineStage4.raiseQuery`; checker side = `AuditQueryTracker.tsx` | ✅ schema-ready; partially wired |
| COA families (decision #2) | authoritative `audit_engagements.coa_mapping` JSONB (`{ledger:{code,…}}`); taxonomy `src/config/nceLineItems.ts` | ✅ reuse as-is |

## The REAL build backlog (the actual gaps)

- **G1 — Engine ↔ catalogue disconnect (the core gap).** `run-scrutiny` executes ~9 bespoke
  checks; the 119 catalogue rules with `detection_logic` are unused. **Build a `detection_logic`
  interpreter** that executes the catalogue against Tally data.
- **G2 — Findings schema drift.** Two incompatible write shapes: Stage4 (engagement-keyed:
  `account_name/finding_text/auto_query_text/status open|accepted|queried|noted|overridden`) vs
  AuditScrutiny (`client_id`+FY-keyed: `flag_message/clause_3cd/status Open|Resolved|Waived`).
  `types.ts` is stale → **reconcile to one canonical schema; regenerate types.**
- **G3 — Security (Ticket 0.4), CONFIRMED LIVE.** `supabase/migrations/20260421040000_tally_tables_rls_and_insert.sql`
  sets `USING (true)` on `tally_groups/tally_ledgers/tally_trial_balance/tally_vouchers/sync_batches`
  and `GRANT … TO anon, authenticated`. Plus edge fns authenticate the user but use the
  service-role client against caller-supplied `client_id/engagement_id` with **no firm-ownership
  check** (IDOR). → harden RLS to firm-scoped predicates + add a 403 ownership gate in edge fns.
- **G4 — Maker-checker depth.** Today: single-actor status only. Precedent for true two-person
  approval exists in `tds_filings` (`preparer_id/checker_id/approver_id/work_status` + audit log).
- **G5 — COA family granularity.** FS taxonomy is coarser than some thresholds need (40A(3)
  transport, 269SS/T loans all collapse into "Other expenses"). Layer a keyword sub-classifier
  on top of `coa_mapping` for family-specific thresholds.

## `detection_logic` check kinds (sample seen in rows 1–26; full enumeration is part of G1)

`sign_reversal`, `keyword_balance`, `bank_recon_diff`, `stale_cheques`, `unmatched_contra`,
`ratio_to_turnover`, `fd_classification`, `daily_max`, `single_txn` (direction debit/credit),
`cash_capital_payment`, `round_number`, `cash_discrepancy`, `frequency`, `ratio`, `missing_field`,
`date_sequence`, `separate_balance`, `month_spike`, `related_party_sales`, `no_corresponding_entry`,
`py_comparison`, `keyword_narration`, `duplicate_amount_date`, …

The interpreter (G1) must enumerate **all** distinct check kinds across the 119 rules and implement
each against the right grain: account-level → `tally_trial_balance`; voucher-level → `tally_vouchers`.

## Data sources (for the interpreter)

- **`tally_trial_balance`** — the working TB (account grain: `ledger_name`, `parent_group`,
  `closing_balance`, `balance_type`, `debit_amount`, `credit_amount`). Paginate at 1000 (PostgREST cap).
- **`tally_vouchers`** — voucher grain (`amount`, `dr_cr`, `voucher_date`, `party_ledger`,
  `narration`, `line_items` JSON — **often partial**, so the row-level party leg is the reliable one).
- Resolve the **tally** `engagement_id` via `useTallyEngagementId` — it is **not** always equal to
  the audit `engagement_id`.

## Revised reconstruction sequence (supersedes 00-status "reconstruction plan")

| Step | Was | Now |
|---|---|---|
| **A. Rules master** | "rebuild 122 checks" | **mostly DONE** — 119 rules in git. Action: catalogue them into `rules/` docs for the CA + enumerate check-kinds. Optional later enrichment from the `ledger-scrutiny` skill. |
| **B. Schema** | author v2 tables | reconcile `scrutiny_findings` to one canonical shape + add maker-checker cols; regenerate `types.ts` |
| **C. Engine** | build from scratch | **build the `detection_logic` interpreter** so the 119 rules actually run; keep AI narration via `claude-gateway` |
| **D. UI** | greenfield | revive `PipelineStage4` / `AuditScrutiny` against the reconciled schema, behind a flag |
| **0.4 Security** | per missing dossier | harden tally RLS + edge-fn firm-ownership gate (exact file located above) |

⚠️ **Gate:** B / C / D / 0.4 all need a **dev DB** to apply migrations and run the engine
(never prod). **Ticket 0.2 (pick the dev DB) is now the real blocker** for any testable build step.
