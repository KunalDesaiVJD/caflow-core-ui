# CAFlow Scrutiny Engine — Developer Handoff Brief

> **Read this whole file before writing any code.** It gives you (and the AI assistant in your session) everything needed to build the Scrutiny Engine one ticket at a time. You are not expected to know the audit rules — they are written down, and the **Senior (a CA)** confirms anything uncertain.

---

## ⏳ AUTONOMOUS BUILD MODE — partner is away ~7 days (READ FIRST)

The partner will give **no commands for ~7 days**. The **Junior + Senior** complete the work between you. **The Senior is a CA** and is therefore the **decision-maker for every audit-domain question** — use the defaults in §8 and adjust with CA judgment. **Do not wait for the partner for anything.** Work through the phases (§5) in order. It is fine if not all phases finish in 7 days — each *completed* phase must be committed to the branch and **previewed for the CA** (below).

### 👀 PREVIEW AFTER EVERY PHASE — mandatory (this is the partner's window while away)
At the END of each phase, before starting the next:
1. `npm run build` passes (zero TypeScript errors).
2. Run the app (`npm run dev`) and open the Scrutiny screen; take **screenshots** of every new/changed screen.
3. Create a self-contained preview page `docs/ledger-scrutiny/previews/phase-<N>-<name>.html` that: (a) summarises what this phase delivered, (b) **embeds the screenshots**, (c) lists exactly what the CA should review. Commit it to the branch **and** copy it to `C:/Users/kvdes/OneDrive/Desktop/Audit/Scrutiny_Previews/`.
4. Give the CA the **preview link** = that file path (opens in any browser) — plus `http://localhost:5173` if she is on the same machine. The CA reviews and confirms, then proceed to the next phase.

Never skip the preview. It is how progress is visible while the partner is away.

---

## 0. GOLDEN RULES — never break these

1. **Work ONLY inside the worktree:** `C:/Users/kvdes/caflow-ledger-scrutiny-wt` (branch `claude/auto-2026-06-21-ledger-scrutiny`).
2. **NEVER work inside** `C:/Users/kvdes/OneDrive/Desktop/Audit/caflow-core-ui-main` (the main repo — it auto-commits and **pushes to `main`**).
3. **NEVER push to `main`, never merge, never `git checkout main`.** Commit only to the branch. `git push` is not your job.
4. **Do ONE ticket at a time.** Finish → run its acceptance test → `git commit` to the branch → **STOP**, let the developer test, then continue. (No partner gating — the developers drive.)
5. **Do NOT apply migrations to PRODUCTION.** Use a dev database (§8). 
6. **Never guess audit logic.** If it is not in this file or `dossier/12-canonical-decisions.md`, the **Senior CA decides** using §8 — do not invent.
7. **Before every commit:** `npm run build` (zero TS errors). Don't touch protected files in the repo's `CLAUDE.md`.

---

## 1. What you are building

An **automated Ledger Scrutiny module** for the CAFlow audit app: it reads the client's Tally vouchers, runs ~122 ready-made checks (Income-Tax / Companies Act / GST / SA), and produces audit queries + working-paper conclusions — replacing the old, non-working `PipelineStage4` screen. Full vision = an "AI audit command center", built in phases. The AI assistant does the heavy coding; **you drive, test, and confirm.**

---

## 2. The binding decisions (the law)

`docs/ledger-scrutiny/dossier/12-canonical-decisions.md` **overrides everything.** Locked decisions:

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | Build everything, in §5 order |
| 2 | Ledger → family | **Reuse the existing COA Mapping** module |
| 3 | AI | Full AI (agentic + narration) — senior-owned phases |
| 4 | UI target | The "ultra command center" (`prototype/scrutiny-engine-prototype.html`) |
| 5 | Team | Junior + Senior(CA); tickets tagged `[JUNIOR]`/`[SENIOR]`/`[CA]` |
| 6 | Queries | Write into the existing `audit_client_queries` table |
| 7 | Maker-checker | Always — second person approves before a query is "sent" |
| 8 | Coverage | Advisory only — never block Sign-off/UDIN |
| 9 | Connectors | GST-2B / 26AS / bank by manual file upload |
| 10 | Fact masters | Engagement Setup + AI nominations |
| 11 | Rule editing | Firm partners/admins; every edit logged |
| 12 | AI cost | Tiered (cheap bulk, top model only for judgment) |

---

## 3. Where everything is (under `docs/ledger-scrutiny/` unless noted)

- `dossier/12-canonical-decisions.md` — **BINDING.** Read first.
- `dossier/00..11` — the 12 implementation specs (per-ticket how-to). `dossier/99` — known issues to fix.
- `rules/00-master-index.md` — the 122 checks. `rules/00-threshold-master.md` — editable limits. `rules/00-recall-register.md` — what each misses. `rules/01..17` — detail.
- `supabase/migrations/20260621000000_scrutiny_v2.sql` (+ `…0001_seed`, `…010000_matchers_fn`) — new tables / seed / matcher SQL. **Authored & verified, NOT applied.**
- `supabase/functions/scrutiny-run/index.ts` — the engine (10 matchers verified; see `prototype/VERIFIED-FINDINGS.md`).
- `prototype/scrutiny-engine-prototype.html` — the UI you build toward.
- `src/components/scrutiny-v2/` — React scaffold (type-checks; data hooks are TODO).
- Integration points: `src/pages/AuditPipeline.tsx`, `src/components/pipeline/PipelineStage4.tsx`, tables `tally_vouchers` / `tally_ledgers` / `tally_trial_balance` / `audit_client_queries`.

---

## 4. The loop for every ticket
AI restates plan → implements in the worktree → runs the acceptance test → `npm run build` → commits to branch → **STOPS**; developer tests, says "next". **At each phase end, also do the PREVIEW.**

---

## 5. The build backlog (phases)

- **Phase 0 — Foundations & hygiene** `[JUNIOR + SENIOR]` — env + baseline build; choose dev DB (§8); apply migrations to dev DB; fix the IDOR/anon-RLS security holes; consume COA-Mapping families. Detailed tickets in §6.
- **Phase 1 — Deterministic engine + templates UI** `[JUNIOR]` — deploy `scrutiny-run`; templates-first screen on real data; findings → `audit_client_queries` with **maker-checker**; per-ledger workpaper + coverage (advisory); drop-in `PipelineStage4` behind a flag.
- **Phase 2 — Gateway + AI narration/section** `[SENIOR]` — extend `claude-gateway` (model map + top-tier + Voyage); narration classification + TDS-section ID; AI query drafting; exclusion learning.
- **Phase 3 — Knowledge & Judgment layer** `[SENIOR + CA]` — ~30 human-facts; RP nomination; MSME/cert capture; Gate-4 fact-gating.
- **Phase 4 — Agentic AI auditor** `[SENIOR]` — multi-step investigator + NL command bar over read-only views.
- **Phase 5 — Forensics + connectors** `[SENIOR]` — money-flow graph; manual-upload GST-2B/26AS/bank reconciliations; Benford/duplicate forensics.
- **Phase 6 — Ultra command center UI + deliverables** `[JUNIOR + SENIOR]` — assemble dashboard; auto-drafted workpaper / query letter / 3CD clause-fill; risk radar; live feed.
- **Phase 7 — Portfolio + learning** `[SENIOR]` — cross-engagement view; precision tracking + auto-demote; rule promotion; benchmarking.
- **Phase 8 — Workflow & operationalisation** `[SENIOR]` — client-portal query loop (out + responses back + auto-close); notifications/alerts + SLA nudges; year-on-year rollover (carry forward confirmed facts/exclusions/rules); evidence pack / NFRA export; assignment & review queue; partner MIS.

---

## 6. START HERE — the first tickets

### Ticket 0.1 `[JUNIOR]` — Prove the baseline builds
`cd` to the worktree; confirm `git branch --show-current` = `claude/auto-2026-06-21-ledger-scrutiny`; `npm install`; `npm run build`. **Acceptance:** build passes, zero TS errors. If it fails, paste the error and STOP — don't force it.

### Ticket 0.2 `[SENIOR CA decides — NOT a blocker]` — Pick the build database
**Default:** use a **separate dev/staging Supabase project**, or run Supabase locally (`supabase start`). **NEVER apply migrations to production.** The Senior picks one and proceeds — do not wait for the partner.

### Ticket 0.3 `[SENIOR]` — Apply the v2 migrations to the dev DB
Apply `…000000`, `…0001`, `…010000` to the **dev** DB only. **Acceptance:** `select count(*) from archetype_def` = 122; `threshold_master` seeded.

### Ticket 0.4 `[SENIOR]` — Fix the security holes
Edge-function IDOR/auth + `tally_vouchers` anon RLS, per `dossier/12` (D4) and `dossier/09`.

### Ticket 1.1 `[JUNIOR]` — Deploy + smoke-test `scrutiny-run`
Deploy to dev; run for one engagement. **Acceptance:** non-zero `finding_count`, no error.

*(Tickets 1.2–1.5 and all later phases: the AI expands them from `dossier/02,04,05,06,08,09,10` when you reach them.)*

---

## 7. Audit-domain questions → answered by the Senior CA (defaults in §8)
40A(3) transport exception · 269ST counterparty · thresholds/severity confirmation · 3CD clauses · golden-file samples · logo/visibility. The Senior CA confirms or adjusts using §8. **Never invent; never wait for the partner.**

---

## 8. Senior-CA decision defaults (confirm or adjust — never wait for the partner)

- **Build DB:** separate dev/staging Supabase project, or local `supabase start`. Never prod.
- **40A(3) ₹35k transport:** flag transport by ledger family (freight / transport / carriage / lorry) **or** narration keyword; apply ₹35,000 there, ₹10,000 elsewhere.
- **269ST (party='Cash'):** accept the recall limit — flag single cash receipts ≥ ₹2,00,000; aggregate per party/day only where the counterparty is resolvable from narration; note the limitation in the working paper.
- **Thresholds & severity:** use `rules/00-threshold-master.md` (FY2025-26) + severities in `rules/00-master-index.md`; tweak in the Rules Master.
- **3CD auto-fill:** generate a **read-only** 3CD findings export (clauses 21(a)/(b)/(d), 31(a)/(b)/(ba), 22, 34). **Do NOT write into the live Form 3CD module** until the partner returns.
- **Golden-file tests:** baseline against the verified counts in `prototype/VERIFIED-FINDINGS.md`; spot-check a sample per rule.
- **Logo / visibility:** keep the "CG" placeholder; scrutiny visible to partner + staff only; clients see only raised queries via the existing Query Tracker.
