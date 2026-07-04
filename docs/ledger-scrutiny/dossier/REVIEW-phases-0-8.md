# CAFlow Scrutiny Engine — Phases 0–8 Review Package

**Branch:** `claude/auto-2026-06-21-ledger-scrutiny` · **Base (merge-base with `main`):** `ccdf0e29`
**As of:** 2026-07-04 · **Status:** Phases 0–8 complete on the branch · **Pushed to main:** none

> Read this alongside [`00-status.md`](00-status.md) (the ticket-by-ticket ledger). This document is the consolidated review view: scope, inventory, decisions, debt, and the deploy/rollback plan.

---

## 1. Executive summary

The Scrutiny Engine is a **v2 rebuild** of ledger scrutiny for the CA firm, delivered entirely behind the feature flag **`VITE_SCRUTINY_V2`** (default **OFF**). With the flag off the existing v1 flat findings table is untouched; with it on, `AuditScrutiny` becomes a templates-first workspace with eight sub-tabs (Overview · Templates · Ledger · Facts & Judgment · Forensics · Connectors · Deliverables · Portfolio).

- **What runs today, no deploy:** the 119-rule deterministic interpreter, maker-checker queries, coverage/workpaper, knowledge-facts model, forensics (Benford + duplicates), money-flow, manual connectors, the command-centre, 3CD clause mapping, deliverables, portfolio + precision + benchmarking, and all of Phase 8 (evidence pack, SLA nudges, rollover, review queue, partner MIS, portal loop).
- **What needs a dev-only deploy:** the AI-assisted enrichers (narration classification, TDS-section, query drafting, NL investigator) — all **degrade gracefully** to deterministic behaviour when the gateway/key is absent — and the `scrutiny_facts` table for fact persistence.

**Headline numbers:** 61 commits · 99 files changed (+12,228 / −19) · **213 unit tests across 29 files, all green** · `npm run build` clean (0 TS errors).

---

## 2. Delivery by phase

| Phase | Theme | Tickets | Deploy needed? |
|-------|-------|---------|----------------|
| **0** | Foundations, dev DB, security | 0.1–0.4, G1, G2 | Dev DB + 2 migrations (applied+verified in dev) |
| **1** | Deterministic engine + UI shell | 1.1–1.4 | Engine smoke-tested in dev (1.1 PASS) |
| **2** | AI gateway + enrichers | 2.1–2.5 | Gateway deploy + `ANTHROPIC_API_KEY` (graceful without) |
| **3** | Knowledge & judgment facts | 3.1–3.4 | `scrutiny_facts` migration (graceful without) |
| **4** | NL investigator | 4.1–4.2 | Uses gateway (graceful without) |
| **5** | Forensics + connectors | 5.1–5.3 | None (deterministic) |
| **6** | Command centre + deliverables | 6.1–6.3 | None |
| **7** | Portfolio + learning | 7.1–7.3 | None (RLS-scoped reads) |
| **8** | Workflow & operationalisation | 8.1–8.6 | None |

---

## 3. Git history (61 commits)

Feature/fix commits (docs commits omitted for brevity — see `git log main..HEAD`):

```
Phase 0  34ee3e07 scaffold docs foundations · 82eb1d0f correct the map (v1 stack found)
         a8f9773d check-kind interpreter spec · da9ac89d Tier A interpreter (G1)
         00833710 Tier B handlers · e2e32565 DB<->engine adapters + pipeline test
         2c0f30a6 run-scrutiny-v2 edge fn · e56cbbc5 G2 findings reconcile migration
         f764882b flag-gated UI routing (default off) · 15ec625f supabase CLI devDep
         baffd0b1 1.1 engine runs end-to-end on dev · 87a037f8 0.4 tally RLS firm-scope
         fe305b60 G2 applied + verified in dev
Phase 1  cf55b40e 1.2 templates-first screen · 8ca6cb27 1.3 maker-checker queries
         69bb7e7f 1.4 per-ledger workpaper + coverage
Phase 2  c8e321f1 2.1 gateway model-map modernise · 3b9cc17b 2.4 AI query drafting
         d0536fa7 2.2 AI narration classification · 96a22964 2.3 AI TDS-section
         395f012a 2.5 exclusion learning
Phase 3  06c106df 3.1-3.3 facts/RP/MSME panel · e2c9ff91 3.4 Gate-4 fact-gating
Phase 4  5067ed11 4.1 NL investigator · ad7f8c5f 4.2 quick prompts
Phase 5  89f9df37 5.1 forensics (Benford + dupes) · 80182e14 5.2 money-flow
         f404c5b6 5.3 manual connectors (GST-2B/26AS/bank)
Phase 6  d1926ea2 6.1 command-centre Overview · 822068f8 6.2 3CD clause-fill
         a4175aff 6.3 auto-drafted deliverables
Phase 7  4c0bcf4c 7.1 rule precision · 194faf7f 7.2 cross-engagement · 65605c8c 7.3 benchmarking
Phase 8  acae8ffd 8.1 evidence pack · d1cabd63 8.2 SLA nudges · e6dd7ff4 8.3 rollover
         09dd0775 8.4 review queue · 421d0122 8.5 partner MIS · 21311f58 8.6 portal loop
```

---

## 4. Change inventory (99 files, +12,228 / −19)

| Area | Count | Notes |
|------|------:|-------|
| `src/lib/scrutiny/**` | 58 | 28 pure helpers + co-located vitest specs + shared types |
| `src/components/scrutiny-v2/**` | 10 | one panel per sub-tab (presentational, inputs from the page) |
| `docs/ledger-scrutiny/previews/**` | 10 | 8 phase previews (+ gitkeep + one superseded phase-1 draft) |
| `supabase/migrations/**` | 3 | findings reconcile · tally RLS · scrutiny_facts |
| `supabase/functions/_shared/**` | 2 | engine mirrored server-side (adapters, detectionEngine) |
| `supabase/functions/{claude-gateway,run-scrutiny-v2}` | 2 | gateway model-map; the v2 engine fn |
| `docs/ledger-scrutiny/{dossier,rules,*}` | 10 | status ledger, rules master, thresholds, specs |
| `src/pages/**` | 2 | `AuditScrutiny.tsx` (orchestrator, heavy) · `PortalQueries.tsx` (client-hidden-status filter) |
| `package.json` / lock | 2 | `supabase` CLI as devDependency only |

**The −19 deletions** are confined to the flag-routing change in `AuditScrutiny` and the PortalQueries status filter — no existing feature was removed.

### 4a. Pure helpers (`src/lib/scrutiny/`) — one line each

| File | Role |
|------|------|
| `detectionEngine.ts` | The 119-rule Tier-A/B `detection_logic` interpreter (engine core) |
| `adapters.ts` | DB ⇄ engine row adapters (findings, TB, rules) |
| `coverage.ts` | Auto-vs-advisory coverage from rule/finding grouping |
| `workpaper.ts` | Per-ledger workpaper assembly |
| `flags.ts` | `VITE_SCRUTINY_V2` resolution + v2 run-fn routing |
| `scrutinyUi.ts` | Shared `Finding` / `RuleTemplate` types + filter constants |
| `makerChecker.ts` | Draft→Open→Rejected query lifecycle + client-hidden statuses |
| `aiNarration.ts` `aiTdsSection.ts` `aiQueryDraft.ts` `aiInvestigator.ts` `investigatorPrompts.ts` | AI enrichers (all never-throw → null/{} fallback) |
| `exclusionLearning.ts` | Prior-period waiver matching (per-rule+ledger) |
| `facts.ts` | ~30 human-fact catalogue + Gate-4 advisory completeness |
| `forensics.ts` `moneyFlow.ts` `reconcile.ts` | Benford/duplicates · money-flow · connector reconciliation |
| `commandCenter.ts` | Risk-by-category, radar geometry, attention feed |
| `clause3cd.ts` `deliverables.ts` `evidencePack.ts` | 3CD mapping · workpaper/query-letter · evidence pack |
| `precision.ts` `portfolio.ts` `benchmark.ts` | Rule precision · cross-engagement rollup · benchmarking |
| `slaNudges.ts` `rollover.ts` `reviewQueue.ts` `partnerMis.ts` `queryLoop.ts` | Phase 8 workflow helpers |

---

## 5. Architectural decisions & assumptions (deviations from the handoff, made under §8 authority)

1. **AI enrichment lives frontend-side, not in the engine.** The 119-rule engine stays 100% deterministic; AI (narration/TDS/query-draft/investigator) is a UI-layer enhancement over engine output. Keeps findings reproducible and the engine key-free. *Assumption:* the engine must never depend on a model being reachable.
2. **Exclusion learning is deterministic (prior-waiver match), not Voyage embeddings.** No `VOYAGE_API_KEY` / vector store in scope; `exclusionLearning.ts` matches on rule_id + ledger. Semantic similarity is a later upgrade. (Ticket 2.5.)
3. **Connectors are in-session, no persistence.** GST-2B/26AS/bank are manual uploads reconciled in memory (5.3); no new tables. *Assumption:* persistence + auto-fetch is a senior/portal concern.
4. **`scrutiny_facts` authored but not applied to prod;** facts persist only once the migration is applied to a DB. The Facts panel **degrades gracefully** (captures locally, shows a notice) when the table is absent.
5. **Rollover is conservative.** Only standing entity attributes + RP nominations carry year-on-year; every per-year assertion is re-answered (8.3). Chosen to prevent last year's "verified = yes" silently carrying.
6. **All Phase-8 automation is advisory.** SLA nudges, evidence pack, MIS and auto-close never block sign-off/UDIN (decision #8); the client reply *suggests* a resolve, the auditor confirms.
7. **`(supabase.from as any)` casts** are used where `src/integrations/supabase/types.ts` is stale for the new columns/tables. `tsc` is intentionally **not** a build gate (only vite/esbuild is); types.ts is regenerated via the Supabase CLI, not hand-edited (protected file).
8. **Model tiers (Ticket 2.1):** gateway maps request types to Haiku 4.5 (light) / Sonnet 5 (standard) / Opus 4.8 (judgment), replacing the retired `claude-sonnet-4-20250514`.

---

## 6. Tech debt & known issues

- **`types.ts` is stale** for the new scrutiny columns/tables → `(… as any)` casts at the DB boundary. Regenerate via `npx supabase gen types` after the dev migrations land, then drop the casts.
- **Firm-wide fetch caps:** portfolio findings capped at 1,000, queries at 2,000 (flagged in-UI). Very large firms would need pagination/server aggregation.
- **Maker/checker shown as truncated user-ids** in the review queue (8.4) — no firm-wide `users` name map is fetched. A one-shot `users` lookup would show names.
- **`client_response` SLA ages from query `created_at`,** not a true dispatch time (no `dispatched_at` column). Slightly overstates client-wait; a `dispatched_at` column would tighten it.
- **Two phase-1 preview files** exist (`phase-1-engine.html` superseded by `phase-1-deterministic-engine.html`) — the older can be deleted.
- **Transient Windows esbuild `onwriteError`** intermittently fails `npm run build` with a stream flake (not a code error); a re-run passes. Cosmetic to CI on Windows only.
- **No React component tests** — UI is verified by build only (per convention); pure helpers carry the 213-test coverage.

---

## 7. Build & test summary

- **`npm run build`** — clean, **0 TypeScript errors** (chunk-size warnings only, acceptable).
- **`npx vitest run src/lib/scrutiny`** — **213 tests / 29 files, all passing.**
- Coverage is on the pure logic (interpreter, adapters, all helpers). Components are thin and presentational; the page wires inputs.
- Per-phase test growth: P1 ~40 → P2 82 → P3 ~100 → P6 153 → P7 165 → **P8 213**.

---

## 8. Preview locations

Committed: `docs/ledger-scrutiny/previews/phase-{1..8}-*.html` (self-contained HTML, illustrative mock-ups).
Copied for the partner: `C:\Users\kvdes\OneDrive\Desktop\Audit\Scrutiny_Previews\phase-{1..8}-*.html`.

---

## 9. Dev-only deploy checklist (senior/partner action — NOT done by the build)

1. **Apply `scrutiny_facts` migration to the dev DB** → enables Facts persistence (Phase 3) + rollover (8.3). Graceful without.
   `npx supabase db query --linked "$(cat supabase/migrations/20260704000000_scrutiny_facts.sql)"`
2. **Deploy `claude-gateway`** with `ANTHROPIC_API_KEY` set → enables AI enrichers (2.2/2.3/2.4/4.1). All degrade to deterministic without it.
   `npx supabase functions deploy claude-gateway`
3. **Deploy `run-scrutiny-v2`** (already smoke-tested in dev at 1.1) for any fresh environment.
4. **Already applied + verified in dev:** `20260630120000` (findings reconcile, additive/nullable) and `20260630130000` (tally RLS firm-scope). **Prod apply is the partner's call** — 0.4 requires confirming the Tally sync uses the service-role key (see migration header).

---

## 10. Rollback strategy

- **Instant kill switch:** `VITE_SCRUTINY_V2` off (the default) → the v1 flat findings table returns, zero new surface. Per-user: clear localStorage `scrutiny_v2`.
- **Branch isolation:** nothing is merged to `main`. Deleting the branch removes the entire feature set. `git branch -r --contains HEAD` is empty at every commit.
- **Per-ticket revert:** each ticket is a single commit → `git revert <sha>` backs out one feature cleanly.
- **Migrations:** additive and backward-compatible — G2 adds nullable columns (engine writes unchanged); `scrutiny_facts` is a new table; the only behavioural change is the tally RLS tightening (0.4), reversible by dropping the added policies.
- **Gateway (2.1):** a model-map change only; `git revert c8e321f1` restores the prior map. AI features fall back to deterministic regardless.

---

## 11. What the CA/senior should decide

- **Thresholds:** SLA (2/5, 7/14, 3/7 days), precision bands (promote ≥80% / demote ≤30%, min 5 actioned), benchmark bands (≥1.5× above / ≤0.5× below). Right for the practice?
- **Rollover scope:** only rp_exist, MSME status/Udyam, MSME-vendor tagging, director loans + RP names carry. Anything else standing enough?
- **Auto-apply vs advisory:** should rule demote/promote ever auto-disable a rule? Should a client reply ever auto-close a finding without the one-click confirm?
- **Prod rollout:** confirm the Tally service-role key (0.4), regenerate `types.ts`, then decide the flag-on cohort.
