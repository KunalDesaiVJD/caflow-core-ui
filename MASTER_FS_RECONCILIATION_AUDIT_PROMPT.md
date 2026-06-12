# MASTER PROMPT — CAFlow Full-System FS Reconciliation DIAGNOSTIC AUDIT (READ-ONLY)

> Paste this entire prompt into a fresh Claude Code session opened in the
> `caflow-core-ui` repository. It is self-contained — no prior conversation
> context required. Expected duration: 1–2 hours autonomous run.

---

## ROLE & MISSION

You are the independent reconciliation auditor for CAFlow, a CA-firm audit
platform (React/TypeScript frontend on Vercel, Supabase Postgres backend).
Your mission is a **360° DIAGNOSTIC audit** of the financial-statement
reconciliation chain for **every engagement** in the Audit Intelligence
module, and an **enterprise-grade evidence report** that proves — per
engagement, per note, per year (CY and PY separately) — whether everything
tallies, and if not, exactly where, by how much, and why.

## ⛔ ABSOLUTE RULE — DIAGNOSE ONLY

**You are FORBIDDEN from fixing anything.** Specifically:
- NO `UPDATE` / `INSERT` / `DELETE` / `DO $$` blocks that mutate data —
  every SQL you run must be a pure `SELECT` (a transient temp table inside a
  read-only analysis query is acceptable only if nothing persists).
- NO edits to any source file, NO git commits, NO deploys, NO builds.
- NO clicks in the browser that change state (no Save, no Refresh-that-writes,
  no Complete Stage, no form inputs). Navigation, tab switches, expanding
  notes, screenshots, and reading values are allowed.
- If you discover a defect, you DOCUMENT it (root cause, evidence, exact
  proposed remediation) and **STOP — ask the user before any fix**. Every
  finding goes in the report with a proposed-fix column; none is applied.

## THE CHAIN UNDER AUDIT

```
Tally TB (tally_ledgers: ledger_name, opening/closing balance + Dr/Cr type)
  → COA Mapping (audit_engagements.coa_mapping JSONB: ledger name → {code})
    → Notes to Accounts (nce_financial_notes: cy_data/py_data JSONB per note_type)
      → Face of BS & P&L (computed in PipelineFinancialStatements.tsx)
        → FsHealthPanel (runtime three-way check, src/lib/fsReconciliation.ts)
```

Exempt from the match requirement: **Capital Account and Fixed Assets/PPE
only**. Everything else is in scope — including the COGS family and
Inventories (checked via the inventory accounting identity, see RC-D).

## THE FOUR-READER VERIFICATION DOCTRINE (the core lesson of v1–v10)

"Tallied" means **all FOUR readers agree**, per year, per note:

| # | Reader | How to read it |
|---|---|---|
| 1 | COA Mapping page totals | Stage 6 UI (left-nav "COA Mapping"), BS + P&L tabs |
| 2 | Notes to Accounts UI | Stage 7 → Notes tab → Notes to Accounts → Expand All — the RENDERED totals the auditor's eyes see |
| 3 | BS / P&L face | Stage 7 Balance Sheet + P&L tabs — values live in `<input>` elements; scrape `input.value` via JS, innerText does NOT contain them |
| 4 | Database ground truth | SQL sweep: signed TB × COA vs note JSONB sums |

History proves SQL-only checks lie: two prior root causes (RC-10, RC-11)
were invisible to every back-end check and existed ONLY on the rendered
screen. A note is "VERIFIED" in your report only when readers 1–4 agree;
"DB-CLEAN" (reader 4 only) is a weaker status and must be labelled as such.

## CATALOG OF THE 14 KNOWN ROOT-CAUSE CLASSES — test every one explicitly

Data-layer classes (scan for instances):
- **RC-A Missing PY rows/values** — PY-only ledgers with no note row; rows missing PY values (historic: SHRI RAM Telephone/Travelling/Water/Web Dev).
- **RC-B Sign flips** — a Dr balance on a CR-natural note must contribute NEGATIVE (advance to a creditor reduces borrowings; historic: BHAKTI "Maharsh Infra" +1.5cr stored instead of −1.5cr). Single source of truth: `src/lib/fsSignConvention.ts`.
- **RC-C Stale/junk rows** — rows whose label matches no mapped ledger yet carry values (historic: MAHIL manual row "B", PY ₹44.8L).
- **RC-D Inventory identity** — cogs note PY-closing stock must equal CY-opening stock per category (pc_open/close_trade|wip|fg, raw, pack, other). Historic: OM REALTY/DHANANI blank PY closing.
- **RC-P Plug rows** — any row named like "COA Reconciliation Adjustment" or JSONB keys `coa_reconcile_balance%`. Zero tolerance: these were inserted by an earlier flawed remediation and must not exist. Report any survivor.

Code-layer classes (verify the deployed code still contains each fix; cite file:line):
- **RC-E FsHealthPanel sign set** — `NCE_LIAB_CODE_SET` (fsReconciliation.ts) must include income codes NCE_REV_OPS/NCE_REV_OTH + NCE_CAP, else phantom 2× drift on revenue.
- **RC-F COA PY anchor** — computeCOATotals must use PY-shell TB closings for PY; CY-opening fallback ONLY when no PY engagement exists (P&L ledgers always open at 0).
- **RC-G BS residual absorber** — CY+PY net-profit auto-credit + residual into NCE_CAP (PipelineFinancialStatements.tsx, ~line 3072 CY / ~3280+ PY) keeps BS balanced when Tally books are unclosed.
- **RC-H Orphan-skip** — a note's PY override must reach the face even when its code is absent from pyShellBSAmounts, whenever the note carries non-zero data.
- **RC-I Pattern A bare keys** — LT/ST split notes (borrowings, provisions, loans_advances, investments) render ONLY `_lt`/`_st` suffixed keys; bare numeric keys are invisible to the renderer while still counted by aggregators (screen ≠ face).
- **RC-J Load-time self-heal guard** — NCEDetailedNotes' cy_sources heal must not overwrite saved PY when source entries lack `amountPy` (`anyPyDefined` guard).
- **RC-K lookupSuffixed per-column bare decision** (nceNoteTotals.ts) — a bare PY key must survive a suffixed CY.

Tooling/semantics classes — these broke the PREVIOUS audits themselves; bake
them into every query you write, and verify the standing sweep honours them:
- **RC-L Duplicate mapping keys** — the same physical ledger can appear twice in coa_mapping with different case AND different codes (historic: MAHIL ~25 dupes, "ASMITA COMPUTERS"→NCE_OTH_EXP vs "Asmita Computers"→NCE_TP). The app resolves by EXACT lookup `coaMapping[tb.ledger_name]` — only the variant exactly matching the TB name is live. Every SQL must dedupe `DISTINCT ON (lower(trim(key)))` ordered by exact-CY-TB-match DESC, then exact-PY-TB-match DESC. Iterating raw mapping keys double-counts.
- **RC-M No-PY-engagement clients** — PY truth = CY TB opening balances (the app's fallback). Treating PY as 0 creates false drift (historic: SWENI).
- **RC-N Attribution is a PRIORITY chain, not a sum** — a ledger's presence in a note = its label-matched row value; the row's `sources[]` array and `_cy_sources` metadata are the COMPOSITION of that value, not additional amounts. Priority: label-matched row → custom-row sources[] → _cy_sources meta. Summing levels double-counts (historic: AMBER GUM).
- Also: all ledger-name joins must be `lower(trim(a)) = lower(trim(b))`; Pattern A column side must follow the ledger's code (NCE_STP → `_st`, NCE_LTP → `_lt`) — combined totals can match while the per-column face is wrong; the cogs note's COA comparison is structural (cogs_a materials vs cogs_c changes-in-inventories) — use the inventory identity, not naive sums.

## EXISTING READ-ONLY TOOLING (repo root)

- `nce_assurance_peryear.sql` — full-book per-year sweep (already RC-L/M-aware). Columns: client, notes, drift_cy, drift_py, cogs_identity_gaps, bare_key_pattern_a, has_py. Pure SELECT — safe to run.
- `nce_drift_fix.sql`, `nce_ledger_fix*.sql`, `fix_*.sql` — historical FIX scripts. **DO NOT RUN ANY OF THEM** (this is a diagnostic engagement).
- Key code files to audit: `src/lib/fsSignConvention.ts`, `src/lib/nceNoteTotals.ts`, `src/lib/nceAutoPopulate.ts` (NCE_NOTE_FS_MAP, NCE_CODE_TO_NOTE, getNCENoteFaceTotal), `src/lib/fsReconciliation.ts` (computeCOATotals, validateFSReconciliation, CANONICAL_NCE_CODE, NCE_LIAB_CODE_SET), `src/components/pipeline/PipelineFinancialStatements.tsx`, `src/components/stage8/NCEDetailedNotes.tsx`.
- DB navigation: NCE clients = clients.entity_type ∈ (Partnership, Individual, HUF, AOP, Trust, LLP, Proprietorship); engagements live in **`audit_engagements`** (NOT the `engagements` table); CY = financial_year '2025-26'; PY = '2024-25' for the same client_id; corporates use stage5_notes + validateCorporateFSReconciliation.
- SQL runner: `npx supabase db query --linked --file <file>.sql -o csv`. Note: `RAISE NOTICE` output is NOT returned by the Management API — design queries to SELECT their results.

## EXECUTION PLAN (all phases read-only)

**Phase 0 — Inventory.** Counts: engagements by entity type and FY; notes per
engagement; clients without a PY engagement; duplicate mapping keys per
engagement (count + worst offenders + conflicting-code dupes); any
`coa_reconcile_balance%` keys (RC-P). Snapshot into CSVs.

**Phase 1 — Database sweep (reader 4).** Run `nce_assurance_peryear.sql`.
Independently re-derive a second-opinion sweep of your own construction
(per-cell: engagement × note × year — COA total, note total, delta) honouring
RC-L/M/N, and DIFF the two sweeps: any cell where your sweep and the standing
sweep disagree is itself a finding (tooling defect class). Also produce the
per-cell detail dataset for the report appendix.

**Phase 2 — Code regression audit.** Verify each RC-E…RC-K fix is present at
the cited file/location; record file:line + a quote in the report. Launch
parallel read-only Explore agents to hunt for NEW divergence classes beyond
the 14 — minimum surfaces: every reader/writer of cy_data/py_data; every
aggregation path; DOCX/Excel exports (nceFinancialsDocx.ts,
fsExcelTemplateNCE.ts — do exports use the canonical aggregator?); corporate
validator parity; lock-preview/readonly render paths; dynamic note-number
map; Stage 6 COA page total computation vs computeCOATotals. New suspicions
are FINDINGS with evidence + proposed fix — not fixes.

**Phase 3 — Four-reader browser verification (readers 1–3).** For AT LEAST 8
engagements — must include SHRI RAM PRODUCTS, BHAKTI INFRA, MAHIL INFRA,
DHANANI REALTY, OM REALTY, AMBER GUM INDUSTRIES, SKYLARK CORPORATION,
SUKIRTI DEVELOPERS — verify per engagement:
  (a) FS Health banner text (expect "N/N reconcile · COA, Notes and BS face
      all agree"; record the exact text; expand the breakdown if not green);
  (b) BS CHECK CY and PY ticks; TOTAL assets = TOTAL equity+liabilities,
      both columns;
  (c) at least 3 notes per engagement: open the rendered note, read its
      on-screen total (CY and PY) and compare to the corresponding face line
      and the Stage 6 COA page line;
  (d) screenshot every screen used as evidence.
Use a fresh cache-busting query param (`&v=<n>`) per navigation. Stage 7 (FS)
is `?stage=10`; reach COA Mapping via the left-nav link, not `?stage=6`.
Browser quirks: face values live in `<input>`s (scrape input.value via JS);
text extraction shows blanks for inputs — never report a blank cell as a
mismatch without checking input.value first (a prior false alarm).

**Phase 4 — Report.** Generate `CAFlow_FS_Diagnostic_Report_<date>.docx`
(use the `docx` npm package; `build_docx_v10.mjs` in repo root is a working
template) AND a companion `.xlsx`/CSV set with raw data. Required content:

1. **Executive summary** — overall verdict (TALLIED / NOT TALLIED), counts,
   and the one-paragraph answer to "can my team trust these statements?"
2. **Per-engagement assurance table** (every NCE engagement + all corporates
   listed) with columns:
   `Client | Engagement ID | Entity type | Notes count | Drift cells CY |
   Drift cells PY | Worst drift ₹ | COGS identity gaps | Renderer-invisible
   keys | Plug rows | Duplicate mapping keys | BS balanced CY (✓/✗) |
   BS balanced PY (✓/✗) | FS Health banner (verified set) | Four-reader
   verified (Y/–) | Status (VERIFIED / DB-CLEAN / FINDING)`
3. **Per-note detail appendix (xlsx/CSV)** — one row per engagement × note ×
   year: COA total, Note total (DB), Note total (on-screen, where captured),
   Face value, delta COA↔Note, delta Note↔Face, status.
4. **Findings register** — every defect found, each with: ID, class (RC-A…N
   or NEW), affected engagement(s)/note(s), evidence (query output, file:line,
   or screenshot ref), amount impact, root cause, **proposed remediation
   (NOT applied)**, risk if left unfixed.
5. **Code-regression checklist** — RC-E…RC-K each with file:line evidence of
   the guard being present (or a finding if absent).
6. **Honest disclosures** — anything unverifiable in this run and why, with
   the exact follow-up needed.

## ACCEPTANCE CRITERIA FOR THE DIAGNOSTIC

1. Every NCE engagement appears in the assurance table with every column
   populated — no cell "assumed" or left blank.
2. CY and PY assessed independently everywhere.
3. The browser-verified set covers ≥ 8 engagements with screenshots on file.
4. Zero data/code/state mutations occurred (re-state this in the report and
   list every command category you ran as evidence of read-only compliance).
5. Every finding carries evidence + proposed remediation, and the report
   explicitly says: **"No fixes were applied. Awaiting user approval per
   finding."**

## FINAL INSTRUCTION

When the report is complete, present in chat: the verdict, the assurance
table summary, the findings register (even if empty), and the file paths.
Then STOP. Do not fix anything — not even a "trivial" one-liner — without
the user's explicit, per-finding approval.
