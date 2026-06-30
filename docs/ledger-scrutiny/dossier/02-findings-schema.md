# 02 — `scrutiny_findings` canonical schema (gap G2)

_Draft 2026-06-30. Migration: `supabase/migrations/20260630120000_scrutiny_findings_reconcile.sql`
(authored, NOT applied — apply to a DEV db only)._

## The problem

`scrutiny_findings` was created in the Supabase dashboard — **no `CREATE TABLE` migration exists in
git**, and `types.ts` shows only: `id, rule_id, client_id, financial_year, severity, status,
flag_message, clause_3cd, narration, linked_query_id`. Two consumers drifted:

| Consumer | Keys / columns it expects | State |
|---|---|---|
| `AuditScrutiny` (live) | `client_id` + `financial_year`; `severity` HIGH/MEDIUM/LOW; `status` Open/Resolved/Waived | works (matches the table) |
| `PipelineStage4` (dead) | `engagement_id`, `firm_id`, `account_name`, `amount`, `finding_text`, `actioned_by`, `override_reason` … | **dead** — those columns don't exist, every call cast `as any` |

`run-scrutiny-v2` deliberately writes the **live** shape, so it works with AuditScrutiny today
without any schema change.

## The reconcile (additive, backward-compatible)

The migration **codifies** the table (so fresh dev DBs have it) and **adds** the missing columns as
nullable, so nothing existing breaks:

- **Dual keying:** keep `client_id + financial_year`; add `engagement_id` + `firm_id`. New findings
  can carry both; legacy rows keep working.
- **Richer finding data:** `category`, `account_name`, `amount`, `detection_level`, `advisory`
  (Tier-C "not auto-verified" flag) — these are what the engine already produces.
- **Audit trail / maker-checker:** `actioned_by` + `actioned_at` (maker), `reviewed_by` +
  `reviewed_at` (checker), `override_reason`. The **query-side** maker-checker (decision #7 — second
  person approves before a query is "sent") stays on `audit_client_queries`, reached via
  `linked_query_id`; findings only record who actioned/reviewed the finding itself.
- **Idempotent re-runs:** `finding_hash` (app-computed: rule_id + account + period) so re-running
  scrutiny can dedup instead of duplicating.

## Status taxonomy (to unify in the UI layer, not the DB)

Two vocabularies are in use — `open/accepted/queried/noted/overridden` (Stage4) vs
`Open/Resolved/Waived` (AuditScrutiny). The column stays free-text `text`; the **revived UI** should
normalise to one set. `run-scrutiny-v2` writes `status='open'`.

## Deliberately deferred — RLS

`scrutiny_findings` has **dashboard-created RLS policies not visible in git**. Tightening them
(findings currently lack `firm_id`, so isolation rides on `client_id → clients.firm_id`) is risky to
author blind and belongs with the **security pass (Ticket 0.4)**, done with DB access. This migration
adds `firm_id` (enabling clean firm-scoped RLS later) but changes **no policies**.
