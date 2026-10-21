# Parked migrations

These files were committed to `supabase/migrations/` but **never applied to
production**, or their state could not be confirmed (checked 21-Oct-2026).
They were moved here so the automatic deploy (`supabase db push --include-all`
in `.github/workflows/deploy-supabase.yml`) does not apply them by accident.

Nothing in this folder runs automatically. To apply one: test it, give it a
fresh timestamp, move it back into `supabase/migrations/`, and deploy.

| File | Why parked |
|------|------------|
| `20260807020000_tenant_rls_hardening.sql` | 42 RLS policy changes, never applied. Its own header warns it can break the Tally sync agent (anon key) and superadmin inserts on `itr_profiles`. Test as superadmin and as firm staff before applying. |
| `20260713190000_scrutiny_entity_split_and_practical_rules.sql` | Scrutiny rule updates. Not applied (`RAT-001` is still active in production). |
| `20260713200000_scrutiny_wire_handlerless_rules.sql` | `detection_logic` updates. Applied state unknown. |
| `20260713210000_scrutiny_noise_reduction.sql` | Same. |
| `20260719140000_scrutiny_fix_keyword_false_positives.sql` | Same. |
| `20260720100000_scrutiny_rollup_flooding_rules.sql` | Same. |
| `20260720140000_scrutiny_materiality_thresholds.sql` | Same. |
| `20260721090000_scrutiny_fix_cred004_bkrdup01.sql` | Same. |
| `20260721100000_scrutiny_fix_debt_rules.sql` | Same. |

The July scrutiny files overwrite `scrutiny_rules.detection_logic` with fixed
values. Re-running one could undo a later edit to the same rule, so compare the
current production values with each file before applying.
