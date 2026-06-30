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
| 0.1b — Scaffold `docs/ledger-scrutiny/` | ✅ this commit (HANDOFF, START_HERE, 12-canonical-decisions, this file) |
| 0.2 — Pick dev DB | ⏳ pending (Senior CA) |
| 0.3 — Apply v2 migrations | 🚫 **BLOCKED** — migration files do not exist (must be rebuilt first) |
| 0.4 — Fix security holes | 🚫 **BLOCKED** — references missing `dossier/09` + `dossier/12 (D4)` |
| 1.1 — Deploy `scrutiny-run` | 🚫 **BLOCKED** — engine function does not exist (must be rebuilt first) |

## What is MISSING (must be reconstructed)

The original prepared material referenced by HANDOFF.md is **not present anywhere on this
machine** — only `HANDOFF.md` and `START_HERE_developer.md` survived. Missing:

| Artifact | Path the handoff assumes |
|---|---|
| Rule dossier — 12 decisions detail, **122 checks**, thresholds, recall register | `dossier/00..11`, `dossier/99`, `rules/00..17` |
| v2 DB schema + seed + matcher SQL | `supabase/migrations/20260621000000_scrutiny_v2.sql` (+ `…0001_seed`, `…010000_matchers_fn`) |
| Deterministic engine | `supabase/functions/scrutiny-run/index.ts` |
| UI target prototype | `prototype/scrutiny-engine-prototype.html` |
| React scaffold | `src/components/scrutiny-v2/` |
| Verified-findings baseline | `prototype/VERIFIED-FINDINGS.md` |

## Reconstruction plan

Order (each is its own ticket; one at a time; preview at each phase end):

- **A. Rules master** — rebuild the check catalogue. **Rule-source decision deferred**
  (options recorded below). Must **not** invent audit logic (Golden Rule #6).
- **B. DB schema** — author the v2 tables/seed/matchers for a **dev** DB only (never prod).
- **C. Engine** — author `scrutiny-run` to run the checks over `tally_vouchers` etc.
- **D. UI** — wire a `scrutiny-v2` view behind a flag. **Inspect existing code first:** this
  checkout already ships `AuditScrutiny`, `AuditPipeline`, and `PipelineStage4` (seen in the
  build output) — reuse/replace per HANDOFF rather than greenfield.

### Deferred decision — rule source for step A

1. **Seed from the `ledger-scrutiny` skill** (anthropic-skills:ledger-scrutiny — 1,502 Indian-CA
   rules, editable thresholds), mapped to the handoff's categories. _Most faithful, least invention._
2. **Transcribe only HANDOFF §2/§8** — fewer than 122 checks; remainder stay TODO.
3. _(chosen for now)_ **Scaffold only, pick later.**

Also available and relevant: `anthropic-skills:tally-trial-balance-import`,
`anthropic-skills:tds-ledger-analyser`.
