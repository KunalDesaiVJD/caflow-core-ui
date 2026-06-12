# MASTER PROMPT — CAFlow Full-System FS Reconciliation Audit, Fix & Assurance Report

> Paste this entire prompt into a fresh Claude Code session opened in the
> `caflow-core-ui` repository. It is self-contained: no prior conversation
> context is required. Expected duration: 1–3 hours autonomous run.

---

## ROLE

You are the lead reconciliation auditor for CAFlow, a CA-firm audit platform
(React/TypeScript frontend on Vercel, Supabase Postgres backend). Your mandate
is a **360° audit of the financial-statement reconciliation chain** for every
engagement in the Audit Intelligence module, **fixing every divergence with
real ledger-level data**, and producing an **enterprise-grade assurance
report** that proves — per engagement, per note, per year — that everything
tallies.

## THE CHAIN UNDER AUDIT

```
Tally TB (tally_ledgers: ledger_name, opening/closing balance + Dr/Cr type)
  → COA Mapping (audit_engagements.coa_mapping JSONB: ledger name → {code})
    → Notes to Accounts (nce_financial_notes: cy_data/py_data JSONB per note_type)
      → Face of BS & P&L (computed in PipelineFinancialStatements.tsx)
        → FsHealthPanel (runtime three-way check, src/lib/fsReconciliation.ts)
```

## NON-NEGOTIABLE CONSTRAINTS

1. **NEVER modify COA mapping** (`audit_engagements.coa_mapping`). Read-only.
2. **NEVER insert plug/balancing rows** (e.g. "COA Reconciliation Adjustment").
   Every rupee in a note must trace to a real TB ledger or a pre-existing
   auditor manual row. If COA has figures, push the REAL per-ledger breakup
   into the note. A fix that merely makes totals tally is a failure.
3. **Exempt from the match requirement: Capital Account and Fixed Assets/PPE
   only.** Everything else — including COGS family and Inventories
   (via the inventory accounting identity) — is in scope.
4. **Assertion-guarded writes**: any data fix is saved ONLY if the note's
   post-fix total equals the true COA total for BOTH years (±₹1). Otherwise
   leave the note untouched and report it. Never make data worse.
5. **No UI write paths**: persistNotes/auto-save/re-sync are intentionally
   disabled (write-protected). All data fixes go through SQL via
   `npx supabase db query --linked --file <file>.sql`.
6. Work autonomously; do not ask for confirmation mid-run. Commit to a
   `claude/auto-YYYY-MM-DD-HH-MM` branch, build (`npm run build`, zero TS
   errors), merge to main, verify the Vercel deploy picked up a new bundle
   hash before browser verification.

## THE VERIFICATION DOCTRINE (the most important lesson)

"Reconciled" means **all FOUR readers agree**, per year:

| Reader | Where |
|---|---|
| 1. COA Mapping page totals | Stage 6 UI (left-nav "COA Mapping"), BS + P&L tabs |
| 2. Notes to Accounts UI | Stage 7 → Notes tab → Notes to Accounts → Expand All — the RENDERED totals |
| 3. BS / P&L face | Stage 7 Balance Sheet + P&L tabs (scrape `<input>` values — innerText does NOT contain input values!) |
| 4. Database ground truth | SQL sweep vs signed TB × COA |

History proves SQL-only checks lie: two root causes (RC-10, RC-11) were
invisible to every back-end check and existed only on the rendered screen.
**Final sign-off requires live browser verification** (Claude-in-Chrome) of at
least 5 engagements including every engagement you modified, with the FS
Health banner green and note totals visually matching face values.

## CATALOG OF THE 13 KNOWN ROOT-CAUSE CLASSES (audit each explicitly)

Data-layer classes:
- **RC-A Missing PY rows/values**: PY-only ledgers with no note row; rows missing PY values (SHRI RAM: Telephone, Travelling, Water, Web Dev).
- **RC-B Sign flips**: Dr-balance on a CR-natural note must be NEGATIVE (advance to creditor reduces borrowings — BHAKTI "Maharsh Infra" +1.5cr should be −1.5cr). Single source of truth: `src/lib/fsSignConvention.ts` (signedBalance/signedOpening).
- **RC-C Stale/junk rows**: rows whose label matches no mapped ledger carrying values (MAHIL row "B" PY ₹44.8L).
- **RC-D Inventory identity**: cogs note PY-closing stock MUST equal CY-opening stock per category (pc_open/close_trade|wip|fg, raw, pack, other). OM REALTY/DHANANI class.

Code-layer classes (verify the fixes are still in place; do not regress):
- **RC-E FsHealthPanel sign set**: `NCE_LIAB_CODE_SET` in fsReconciliation.ts must include income codes (NCE_REV_OPS/OTH) + NCE_CAP.
- **RC-F COA PY anchor**: computeCOATotals must use PY-shell TB closing for PY; CY-opening fallback ONLY when no PY engagement exists (P&L ledgers always open at 0 — signedOpening alone produces phantom "manual" deltas).
- **RC-G BS residual absorber**: CY+PY net-profit auto-credit + residual into NCE_CAP (PipelineFinancialStatements.tsx ~line 3072 CY / ~3280+ PY) keeps BS balanced when Tally books are unclosed.
- **RC-H Orphan-skip**: a note's PY override must reach the face even when the code is absent from pyShellBSAmounts, whenever the note has non-zero data.
- **RC-I Pattern A bare keys**: LT/ST split notes (borrowings, provisions, loans_advances, investments) render ONLY `_lt`/`_st` suffixed keys. Bare numeric keys are invisible to the renderer while counted by aggregators → screen ≠ face. Sweep column `bare_key_pattern_a` must be 0.
- **RC-J Load-time self-heal**: NCEDetailedNotes' cy_sources heal must not overwrite saved PY when source entries lack `amountPy` (guard `anyPyDefined`).
- **RC-K lookupSuffixed per-column bare decision** in nceNoteTotals.ts (PY bare key must survive a suffixed CY).

Tooling/semantics classes (these broke MY OWN earlier audits — bake into every query you write):
- **RC-L Duplicate mapping keys**: the same physical ledger can appear 2× in coa_mapping with different case AND different codes (MAHIL: ~25 dupes, "ASMITA COMPUTERS"→NCE_OTH_EXP vs "Asmita Computers"→NCE_TP). The app resolves by EXACT lookup `coaMapping[tb.ledger_name]` — only the variant exactly matching the TB name is live. Every SQL you write must dedupe `DISTINCT ON (lower(trim(key)))` ordered by exact-CY-TB-match DESC, exact-PY-TB-match DESC. Iterating mapping keys without this DOUBLE-COUNTS.
- **RC-M No-PY-engagement clients**: PY truth = CY TB opening balances (app fallback). Treating PY as 0 creates false drift (SWENI class).
- **RC-N Attribution is a PRIORITY chain, not a sum**: a ledger's presence in a note = its label-matched row value; the row's `sources[]` array and `_cy_sources` metadata are the COMPOSITION of that value. Summing row + sources double-counts (AMBER GUM class). Priority: label-matched row → custom-row sources[] → _cy_sources meta.
- Also: ledger-name joins must be `lower(trim(x)) = lower(trim(y))`; Pattern A column side must follow the ledger's code (NCE_STP → `_st`, NCE_LTP → `_lt`); cogs uses config split (cogs_a materials / cogs_c changes-in-inventories) — its COA comparison is structural, validate via the inventory identity instead of naive sums.

## EXISTING TOOLING (in repo root — extend, don't rebuild from scratch)

- `nce_assurance_peryear.sql` — full-book per-year sweep (RC-L/M-aware). Columns: client, notes, drift_cy, drift_py, cogs_identity_gaps, bare_key_pattern_a, has_py. PASS = every count 0.
- `nce_ledger_fix_v6.sql` (latest evolution v8 + `fix_pattern_a_column_side.sql`) — assertion-guarded per-ledger reconstructor (FWD priority attribution / new real rows / REV stale-zeroing / post-fix assertion). Adapt its selection filter to your target set.
- `nce_drift_fix.sql` — **DEPRECATED plug generator. NEVER RUN.**
- Key code files: `src/lib/fsSignConvention.ts`, `src/lib/nceNoteTotals.ts`, `src/lib/nceAutoPopulate.ts` (NCE_NOTE_FS_MAP, NCE_CODE_TO_NOTE, getNCENoteFaceTotal), `src/lib/fsReconciliation.ts` (computeCOATotals, validateFSReconciliation, CANONICAL_NCE_CODE), `src/components/pipeline/PipelineFinancialStatements.tsx`, `src/components/stage8/NCEDetailedNotes.tsx`.
- DB navigation: clients.entity_type ∈ (Partnership, Individual, HUF, AOP, Trust, LLP, Proprietorship) = NCE; engagements live in `audit_engagements` (NOT `engagements`); CY = financial_year '2025-26', PY = '2024-25' same client_id; corporates use stage5_notes + validateCorporateFSReconciliation.

## EXECUTION PLAN

**Phase 0 — Baseline (read-only).** Run the assurance sweep; snapshot results.
Inventory: engagement counts by entity type, notes per engagement, duplicate
mapping keys per engagement, no-PY-engagement clients. Browser-verify ONE
known-good engagement to calibrate your scraping (BS/P&L face values live in
`<input>` elements — scrape `input.value` via JS, not innerText).

**Phase 1 — Code regression audit.** Verify every RC-E…RC-K fix is present at
the cited locations. Launch parallel Explore agents to hunt for NEW divergence
classes beyond the 13 — minimum surfaces to sweep: every reader of
cy_data/py_data, every writer, every aggregation path, DOCX/Excel exports
(nceFinancialsDocx.ts, fsExcelTemplateNCE.ts — do exports use the canonical
aggregator?), corporate validator parity, lock-preview/readonly render paths,
and the dynamic note-number map. Any new class found: document trigger
conditions, fix in code, deploy.

**Phase 2 — Data audit & fix.** Run the per-ledger reconstructor across all
NCE engagements (assertion-guarded). For every SKIP, diagnose the attribution
hole per-ledger (write a diagnostic dump comparing expected-signed-TB vs
row/sources attribution for that note) and extend the reconstructor — never
lower the assertion bar. Apply the inventory-identity fix and the Pattern A
column-side fix. Target: 0 skips, 0 drift, 0 plugs (`coa_reconcile_balance%`
keys must not exist anywhere).

**Phase 3 — Four-reader verification.** Re-run the sweep (all zeros). Then in
the browser, for AT LEAST 5 engagements (must include every engagement whose
data you changed, and always SHRI RAM PRODUCTS, BHAKTI INFRA, MAHIL INFRA,
DHANANI REALTY, OM REALTY): confirm FS Health banner green ("N/N reconcile"),
BS CHECK CY ✓ and PY ✓, and for at least 2 notes per engagement open the
rendered note and compare its on-screen total to the face value for both
years. Screenshot each. Any mismatch: STOP, root-cause it as a potential
RC-14+, fix, redeploy, re-verify.

**Phase 4 — Report.** Generate `CAFlow_FS_Assurance_Report_<date>.docx`
(use the `docx` npm package; builders `build_docx_v9.mjs`/`v10` are templates)
AND a companion `.xlsx` with the raw per-cell data. Required content:

1. **Executive summary** — pass/fail counts, what changed, what was verified.
2. **Per-engagement assurance table** (every NCE engagement + corporates
   listed) with columns:
   `Client | Engagement ID | Entity type | Notes count | Drift cells CY |
   Drift cells PY | COGS identity gaps | Renderer-invisible keys | Plug rows |
   BS balanced CY (✓/✗) | BS balanced PY (✓/✗) | FS Health banner (from
   browser, for verified set) | Verified on screen (Y/–) | Status`
3. **Per-note detail appendix (xlsx)** — one row per (engagement × note ×
   year): COA total, Note total, Face value, deltas, status.
4. **Change log** — every data mutation this run: engagement, note, ledger,
   old value, new value, justification (TB figure cited).
5. **Root-cause register** — RC-A…RC-N + any new, each with: description,
   trigger, detection query, fix, regression guard.
6. **Honest disclosures** — anything skipped/unverifiable and why, with the
   exact follow-up needed.

## ACCEPTANCE CRITERIA (all must hold)

1. BS balanced CY AND PY on every NCE engagement (face TOTAL assets = TOTAL
   equity+liabilities, both columns).
2. Sweep: 0 drift_cy, 0 drift_py, 0 cogs_identity_gaps, 0 bare_key_pattern_a
   across every engagement.
3. 0 plug rows in the database; no new artificial/manual rows introduced.
4. Browser-verified four-reader agreement on the verification set, screenshots
   captured, with FS Health green.
5. Report delivered with every column above populated; no cell left "assumed".
6. All code/SQL committed to main; deprecated tools clearly marked.

## OPERATIONAL NOTES (hard-won; ignore at your peril)

- `RAISE NOTICE` output is NOT returned by the Supabase Management API — write
  results into a real table (`fix_report`) and SELECT it.
- plpgsql: don't reuse a DECLAREd record variable name as a CTE/table alias.
- Browser tabs cache aggressively: append a changing `&v=N` query param and
  hard-reload; confirm the deployed bundle hash changed before verifying.
- Stage URL param quirk: Stage 7 (FS) = `?stage=10`; COA Mapping is reached
  via the left-nav link, not `?stage=6`.
- A "fixed" claim without a fresh screenshot of the rendered screen is not a
  fixed claim. The user has been burned eight times by back-end-only checks.
