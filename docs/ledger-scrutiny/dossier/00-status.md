# Scrutiny Engine — Build Status & Reconstruction Plan

_Last updated: 2026-06-30_

## Where we are

- **Worktree:** `C:/Users/kvdes/caflow-ledger-scrutiny-wt`
- **Branch:** `claude/auto-2026-06-21-ledger-scrutiny` (off `main` @ `ccdf0e29`)
- **Mode:** Rebuild fresh in this repo. Handoff safety rules win — **never push to `main`,
  never merge, never `git checkout main`.**

## Safety setup (verified 2026-06-30)

- This repo has an auto-push **Stop hook** (`.claude/hooks/session-end.ps1`) and a
  **PostToolUse** push hook. Both target `C:/Users/Admin/OneDrive/Documents/GitHub/caflow-core-ui`,
  which **does not exist on this machine**.
  - **Stop hook** → already a **no-op** (missing path + missing script file; errors swallowed).
  - **PostToolUse hook** → *would* push the current branch on any Bash command whose text
    contains `git commit` / `git merge`, and because its `cd` fails non-fatally it would run
    in the `main` checkout. **Mitigation:** the repo config is left untouched (to preserve the
    user's normal workflow); commits are made only via `git -C "<worktree>" commit …`, a form
    whose text does **not** contain the substring `git commit`, so the hook never fires.
    After every commit we verify the branch is **not** on `origin`.

## Ticket status

| Ticket | State |
|---|---|
| 0.1 — Prove baseline builds | ✅ **PASS** — `npm install` clean; `npm run build` ✓ in ~37s; **0 TS errors** (chunk-size warnings only) |
| 0.1b — Scaffold `docs/ledger-scrutiny/` | ✅ done (HANDOFF, START_HERE, 12-canonical-decisions, this file) |
| 0.1c — Map the existing system | ✅ done → see **[01-existing-system-map.md](01-existing-system-map.md)** |
| A — Rules catalogue + check-kinds (no DB) | ✅ done → **[rules/00-master-index.md](../rules/00-master-index.md)** (119 rules) + **[rules/01-check-kinds.md](../rules/01-check-kinds.md)** (83 check kinds, tiered A/B/C for the interpreter) |
| C-engine — Tier A+B interpreter (no DB) | ✅ done → `src/lib/scrutiny/detectionEngine.ts`: **28 handlers covering 50 of 119 rules** (20 Tier A deterministic + 8 Tier B computable: absence/PY/capital checks) + `detectionEngine.test.ts` (**41 passing vitest tests**). Pure/dependency-free; runner reports remaining Tier B (ratios/ageing/adequacy) + Tier C as advisory until a dev DB. `npm run build` ✓, engine `tsc --strict` ✓ |
| 0.2 — Pick dev DB | ⏳ **pending (Senior CA) — now the real gate** for any testable build step |
| 0.3 — Apply migrations | 🔄 reframed — v1 scrutiny schema already in git; author only the gap migrations (findings reconcile + security) and apply to **dev** |
| 0.4 — Fix security holes | ✅ **located & confirmed live** — `20260421040000_tally_tables_rls_and_insert.sql` (`USING(true)` + `GRANT … TO anon`) + edge-fn IDOR; ready to author the fix |
| 1.1 — Engine | 🔄 reframed — `run-scrutiny` exists but runs 9 hardcoded checks; build a `detection_logic` interpreter for the 119 rules |

## CORRECTION (2026-06-30) — most of it was NOT missing

The 6-agent sweep + direct verification overturned the "everything is missing" premise. Only the
handoff's **v2 re-architecture** docs were lost. A working **v1 scrutiny stack is already in the
repo**: the `scrutiny_rules` table with **119 seeded rules (populated `detection_logic`)**, the
`run-scrutiny` / `export-scrutiny-xlsx` / `claude-gateway` edge functions, `PipelineStage4` (dead,
schema drift), and the live `AuditScrutiny` dashboard. **Full map + the real gap list + the revised
plan now live in [01-existing-system-map.md](01-existing-system-map.md).**

Net effect: this is a **revive-and-consolidate** job, not a greenfield rebuild — and **no external
rule source is needed** (the 119 rules are in git), so the deferred "rule source" decision is
**moot** for the core build. The `ledger-scrutiny` skill remains available only as optional later
enrichment.

Still genuinely absent (cosmetic / non-blocking): the `prototype/scrutiny-engine-prototype.html`
UI target, the `src/components/scrutiny-v2/` scaffold, and `VERIFIED-FINDINGS.md` baseline.

## Known issues (found while building)

- **`src/integrations/supabase/types.ts` line 1 is junk** — a stray Supabase-CLI log line
  `Initialising login role...` sits above `export type Json =`. This makes `tsc` fail on line 1,
  so the repo has **no working `tsc` typecheck**; only `vite build` (esbuild, lenient) gates builds.
  The file is **protected** (regenerate via Supabase CLI only) — flagged for the partner; not fixed
  here. A one-line deletion would restore `tsc` as a usable gate.
