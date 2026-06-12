# MASTER PROMPT — CAFlow FULL-DATABASE FS Reconciliation DIAGNOSTIC AUDIT (READ-ONLY)

> Paste this entire prompt into a fresh Claude Code session opened in the
> `caflow-core-ui` repository. It is self-contained — no prior conversation
> context required. Scope: **EVERY engagement in the `audit_engagements`
> table — all financial years, all entity types, no sampling.**
> Expected duration: several hours autonomous run; do not cut scope to save
> time — completeness outranks speed.

---

## ROLE & MISSION

You are the independent reconciliation auditor for CAFlow, a CA-firm audit
platform (React/TypeScript frontend on Vercel, Supabase Postgres backend).
Your mission is an **exhaustive, full-database DIAGNOSTIC audit** of the
financial-statement reconciliation chain across **every engagement that
exists in the database**, and an **enterprise-grade evidence report** that
proves — per engagement, per note, per year (CY and PY separately) — whether
everything tallies; and if not, exactly where, by how much, and why.

## ⛔ ABSOLUTE RULE — DIAGNOSE ONLY

**You are FORBIDDEN from fixing anything.** Specifically:
- NO `UPDATE` / `INSERT` / `DELETE` / data-mutating `DO $$` blocks — every
  SQL you run must be a pure `SELECT` (transient temp tables inside a
  read-only analysis query are acceptable only if nothing persists).
- NO edits to any source file, NO git commits, NO deploys, NO builds.
- NO state-changing clicks in the browser (no Save, no Complete Stage, no
  form inputs, no buttons that write). Navigation, tab switches, expanding
  notes, scrolling, and screenshots are allowed.
- If you discover a defect, you DOCUMENT it (root cause, evidence, exact
  proposed remediation) and **STOP — ask the user before any fix**. Every
  finding goes in the report with a proposed-fix column; none is applied.

## AUDIT UNIVERSE — DEFINE IT FIRST, AUDIT ALL OF IT

Build the universe from the database, not from assumptions:

```sql
SELECT ae.id, ae.financial_year, ae.is_py_shell, c.name, c.entity_type,
       (SELECT count(*) FROM nce_financial_notes n WHERE n.engagement_id = ae.id)  AS nce_notes,
       (ae.stage5_notes IS NOT NULL) AS has_corporate_notes,
       (SELECT count(*) FROM tally_ledgers t WHERE t.engagement_id = ae.id)        AS tb_rows,
       (SELECT count(*) FROM jsonb_object_keys(coalesce(ae.coa_mapping,'{}'::jsonb))) AS mapped_ledgers
FROM audit_engagements ae JOIN clients c ON c.id = ae.client_id
ORDER BY c.name, ae.financial_year;
```

Every row of this query MUST appear in the final assurance table with a
status. Classify each engagement into exactly one audit track:

| Track | Definition | Audit applied |
|---|---|---|
| **NCE-FULL** | entity_type ∈ (Partnership, Individual, HUF, AOP, Trust, LLP, Proprietorship), has nce_financial_notes rows | Full four-reader audit (DB sweep + code + browser) |
| **NCE-PRE** | NCE entity, TB/COA present but no notes yet (pre-Stage-7) | DB-level checks only (COA integrity, duplicate keys, TB sanity); note in report "not yet at Stage 7" |
| **CORP-FULL** | Private Ltd / Public Ltd / company, stage5_notes present | Corporate validator parity audit (DB sweep against stage5_notes + browser FS Health check) |
| **CORP-PRE** | Corporate, no stage5_notes yet | DB-level checks only |
| **PY-SHELL** | is_py_shell = true | Verified indirectly as the PY source of its CY twin; listed with that linkage |
| **EMPTY** | No TB, no mapping, no notes | Listed with status EMPTY (nothing to reconcile) — still in the table |

No engagement may be silently dropped. If a row fits no track, that itself
is a finding.

## THE CHAIN UNDER AUDIT

```
Tally TB (tally_ledgers: ledger_name, opening/closing balance + Dr/Cr type)
  → COA Mapping (audit_engagements.coa_mapping JSONB: ledger name → {code})
    → Notes to Accounts (nce_financial_notes cy_data/py_data — NCE;
                          stage5_notes — corporate)
      → Face of BS & P&L (computed in PipelineFinancialStatements.tsx)
        → FsHealthPanel (runtime three-way check, src/lib/fsReconciliation.ts)
```

Exempt from the match requirement: **Capital Account and Fixed Assets/PPE
only.** Everything else is in scope — including the COGS family and
Inventories (checked via the inventory accounting identity, RC-D).

## THE FOUR-READER VERIFICATION DOCTRINE (the core lesson of v1–v10)

"Tallied" means **all FOUR readers agree**, per year, per note:

| # | Reader | How to read it |
|---|---|---|
| 1 | COA Mapping page totals | Stage 6 UI (left-nav "COA Mapping"), BS + P&L tabs |
| 2 | Notes to Accounts UI | Stage 7 → Notes tab → Notes to Accounts → Expand All — the RENDERED totals the auditor's eyes see |
| 3 | BS / P&L face | Stage 7 Balance Sheet + P&L tabs — values live in `<input>` elements; scrape `input.value` via JS, innerText does NOT contain them |
| 4 | Database ground truth | SQL sweep: signed TB × COA vs note JSONB sums |

History proves SQL-only checks lie: two prior root causes (RC-J, RC-I below)
were invisible to every back-end check and existed ONLY on the rendered
screen. Statuses in your report:
- **VERIFIED** = readers 1–4 agree, screenshots on file.
- **DB-CLEAN** = reader 4 passed; readers 1–3 not individually captured
  (allowed only where the browser pass below records a green FS Health
  banner for that engagement).
- **FINDING** = any disagreement anywhere.

## CATALOG OF THE 14 KNOWN ROOT-CAUSE CLASSES — test every one explicitly

Data-layer classes (scan ALL engagements for instances):
- **RC-A Missing PY rows/values** — PY-only ledgers with no note row; rows missing PY values (historic: SHRI RAM Telephone/Travelling/Water/Web Dev).
- **RC-B Sign flips** — a Dr balance on a CR-natural note must contribute NEGATIVE (advance to a creditor reduces borrowings; historic: BHAKTI "Maharsh Infra" +1.5cr stored instead of −1.5cr). Single source of truth: `src/lib/fsSignConvention.ts`.
- **RC-C Stale/junk rows** — rows whose label matches no mapped ledger yet carry values (historic: MAHIL manual row "B", PY ₹44.8L).
- **RC-D Inventory identity** — cogs note PY-closing stock must equal CY-opening stock per category (pc_open/close_trade|wip|fg, raw_open/raw_close, pack_*, other_*). Historic: OM REALTY/DHANANI blank PY closing.
- **RC-P Plug rows** — any row labelled like "COA Reconciliation Adjustment" or JSONB keys `coa_reconcile_balance%`. Zero tolerance — these came from an earlier flawed remediation. Report any survivor anywhere in the database.

Code-layer classes (verify each fix is still present; cite file:line + quote):
- **RC-E FsHealthPanel sign set** — `NCE_LIAB_CODE_SET` (fsReconciliation.ts) must include income codes NCE_REV_OPS/NCE_REV_OTH + NCE_CAP, else phantom 2× drift on revenue.
- **RC-F COA PY anchor** — computeCOATotals must use PY-shell TB closings for PY; CY-opening fallback ONLY when no PY engagement exists (P&L ledgers always open at 0).
- **RC-G BS residual absorber** — CY+PY net-profit auto-credit + residual into NCE_CAP (PipelineFinancialStatements.tsx, ~line 3072 CY / ~3280+ PY) keeps BS balanced when Tally books are unclosed.
- **RC-H Orphan-skip** — a note's PY override must reach the face even when its code is absent from pyShellBSAmounts, whenever the note carries non-zero data.
- **RC-I Pattern A bare keys** — LT/ST split notes (borrowings, provisions, loans_advances, investments) render ONLY `_lt`/`_st` suffixed keys; bare numeric keys are invisible to the renderer while still counted by aggregators (screen ≠ face).
- **RC-J Load-time self-heal guard** — NCEDetailedNotes' cy_sources heal must not overwrite saved PY when source entries lack `amountPy` (`anyPyDefined` guard).
- **RC-K lookupSuffixed per-column bare decision** (nceNoteTotals.ts) — a bare PY key must survive a suffixed CY.

Tooling/semantics classes — these broke the PREVIOUS audits themselves; bake
them into every query you write, and verify the standing sweep honours them:
- **RC-L Duplicate mapping keys** — the same physical ledger can appear twice in coa_mapping with different case AND different codes (historic: MAHIL ~25 dupes, "ASMITA COMPUTERS"→NCE_OTH_EXP vs "Asmita Computers"→NCE_TP). The app resolves by EXACT lookup `coaMapping[tb.ledger_name]` — only the variant exactly matching the TB name is live. Every SQL must dedupe `DISTINCT ON (lower(trim(key)))` ordered by exact-CY-TB-match DESC, then exact-PY-TB-match DESC. Iterating raw mapping keys double-counts. Additionally REPORT every duplicate-key pair per engagement (count, conflicting codes) as data-hygiene findings — across ALL engagements, not only NCE.
- **RC-M No-PY-engagement clients** — PY truth = CY TB opening balances (the app's fallback). Treating PY as 0 creates false drift (historic: SWENI).
- **RC-N Attribution is a PRIORITY chain, not a sum** — a ledger's presence in a note = its label-matched row value; the row's `sources[]` array and `_cy_sources` metadata are the COMPOSITION of that value, not additional amounts. Priority: label-matched row → custom-row sources[] → _cy_sources meta. Summing levels double-counts (historic: AMBER GUM).
- Also: all ledger-name joins must be `lower(trim(a)) = lower(trim(b))`; Pattern A column side must follow the ledger's code (NCE_STP → `_st`, NCE_LTP → `_lt`) — combined totals can match while the per-column face is wrong; the cogs note's COA comparison is structural (cogs_a materials vs cogs_c changes-in-inventories) — use the inventory identity, not naive sums.

## EXISTING READ-ONLY TOOLING (repo root)

- `nce_assurance_peryear.sql` — full-book per-year sweep (already RC-L/M-aware) for FY 2025-26 NCE. Pure SELECT — safe to run. You must EXTEND its scope (other FYs, corporates) in your own copies; do not narrow it.
- `nce_drift_fix.sql`, `nce_ledger_fix*.sql`, `fix_*.sql` — historical FIX scripts. **DO NOT RUN ANY OF THEM.**
- Key code files to audit: `src/lib/fsSignConvention.ts`, `src/lib/nceNoteTotals.ts`, `src/lib/nceAutoPopulate.ts` (NCE_NOTE_FS_MAP, NCE_CODE_TO_NOTE, getNCENoteFaceTotal), `src/lib/fsReconciliation.ts` (computeCOATotals, validateFSReconciliation, validateCorporateFSReconciliation, CANONICAL_NCE_CODE, NCE_LIAB_CODE_SET), `src/components/pipeline/PipelineFinancialStatements.tsx`, `src/components/stage8/NCEDetailedNotes.tsx`.
- DB navigation: engagements live in **`audit_engagements`** (NOT the `engagements` table); PY pairing = same client_id with the immediately-prior financial_year string (derive it from the CY string, e.g. '2025-26' → '2024-25'; do NOT hardcode a single year — audit every FY present in the table).
- SQL runner: `npx supabase db query --linked --file <file>.sql -o csv`. `RAISE NOTICE` output is NOT returned — design queries to SELECT their results.

## EXECUTION PLAN (all phases read-only)

**Phase 0 — Universe & inventory.** Run the universe query; classify every
engagement into a track. Inventory per engagement: TB row count, mapped
ledger count, unmapped-with-balance count, duplicate mapping keys
(+ conflicting-code pairs), `coa_reconcile_balance%` survivors (RC-P),
clients lacking a PY engagement, numeric-string JSONB values, bare-key
Pattern A values. Snapshot all of it to CSVs.

**Phase 1 — Database sweep (reader 4) — ALL tracks, ALL years.**
(a) Run `nce_assurance_peryear.sql` as-is for the FY 2025-26 NCE book.
(b) Author extended sweeps covering: every other financial_year that has
    NCE engagements with notes; and the corporate track (stage5_notes
    breakup sums vs computeCOATotals-equivalent per corporate code map —
    mirror CORP_CODE_TO_NOTE in fsReconciliation.ts).
(c) Author an INDEPENDENT second-opinion sweep (your own construction,
    honouring RC-L/M/N) and DIFF it against the standing sweep cell-by-cell.
    Any disagreement between the two sweeps is itself a finding (tooling
    defect class — this is exactly how RC-L was eventually caught).
(d) Produce the per-cell dataset: one row per engagement × note × year with
    COA total, note total, delta — for ALL engagements with notes.

**Phase 2 — Code regression audit.** Verify each RC-E…RC-K guard is present
at the cited location; record file:line + quote. Launch parallel read-only
Explore agents to hunt for NEW divergence classes beyond the 14 — minimum
surfaces: every reader/writer of cy_data/py_data; every aggregation path;
DOCX/Excel exports (nceFinancialsDocx.ts, fsExcelTemplateNCE.ts — do exports
use the canonical aggregator?); corporate validator parity with the NCE one;
lock-preview/readonly render paths; dynamic note-number map; Stage 6 COA
page total computation vs computeCOATotals. New suspicions are FINDINGS with
evidence + proposed fix — not fixes.

**Phase 3 — Browser verification (readers 1–3) — EVERY engagement with FS
data.** For EVERY engagement in tracks NCE-FULL and CORP-FULL (no sampling):
  (a) open Stage 7 (`?stage=10&v=<fresh-n>`); record the exact FS Health
      banner text and BS CHECK CY/PY states; screenshot;
  (b) capture TOTAL assets and TOTAL equity+liabilities for both years from
      the face (scrape input.value via JS);
  (c) banner not green → expand the breakdown, capture the offending rows,
      classify against RC catalog, file a finding;
  (d) DEEP-DIVE tier: for every engagement that (i) has any sweep delta, OR
      (ii) shows a non-green banner, OR (iii) is on the historic-incident
      list (SHRI RAM PRODUCTS, BHAKTI INFRA, MAHIL INFRA, DHANANI REALTY,
      OM REALTY, AMBER GUM INDUSTRIES, SKYLARK CORPORATION, SUKIRTI
      DEVELOPERS, SWASTIK BUILDCON, NIRALI PERFUMERY, UMIYA INDUSTRIES,
      SWENI CORPORATION, REVTI INFRA, SHREE HARI INFRA) — additionally open
      the Notes tab → Expand All and reconcile EVERY note's rendered total
      (CY and PY) against the face and the Stage 6 COA page lines, with
      screenshots.
  Pace the browser work in batches; if a tab wedges (screenshot timeout),
  re-navigate with a fresh `&v=` param and retry — never skip an engagement
  because of a flaky tab.

**Phase 4 — Report.** Generate `CAFlow_FS_Diagnostic_Report_<date>.docx`
(use the `docx` npm package; `build_docx_v10.mjs` in repo root is a working
template) AND a companion `.xlsx`/CSV set with the raw data. Required:

1. **Executive summary** — overall verdict (TALLIED / NOT TALLIED), counts
   per track, and the one-paragraph answer to "can my team trust these
   statements?"
2. **Full-universe assurance table** — EVERY `audit_engagements` row, with
   columns:
   `Client | Engagement ID | FY | Entity type | Track | Notes count |
   TB rows | Mapped ledgers | Duplicate mapping keys | Drift cells CY |
   Drift cells PY | Worst drift ₹ | COGS identity gaps | Renderer-invisible
   keys | Plug rows | BS balanced CY (✓/✗) | BS balanced PY (✓/✗) |
   FS Health banner (exact text) | Four-reader verified (Y/–) |
   Status (VERIFIED / DB-CLEAN / FINDING / NOT-AT-STAGE-7 / PY-SHELL /
   EMPTY)`
3. **Per-note detail appendix (xlsx/CSV)** — one row per engagement × note ×
   year: COA total, Note total (DB), Note total (on-screen where captured),
   Face value, delta COA↔Note, delta Note↔Face, status.
4. **Findings register** — every defect, each with: ID, class (RC-A…P or
   NEW-n), affected engagement(s)/note(s), evidence (query output, file:line,
   or screenshot ref), amount impact ₹, root cause, **proposed remediation
   (NOT applied)**, risk if left unfixed, suggested priority.
5. **Code-regression checklist** — RC-E…RC-K each with file:line evidence of
   the guard (or a finding if absent/weakened).
6. **Data-hygiene appendix** — duplicate mapping keys per engagement with
   conflicting codes highlighted; unmapped ledgers carrying balances;
   no-PY-engagement clients.
7. **Honest disclosures** — anything unverifiable in this run and why, with
   the exact follow-up needed.

## ACCEPTANCE CRITERIA FOR THE DIAGNOSTIC

1. Every row of `audit_engagements` appears in the assurance table with
   every column populated — no sampling, no cell "assumed", no engagement
   dropped.
2. CY and PY assessed independently everywhere.
3. Browser verification covers 100% of NCE-FULL and CORP-FULL engagements
   (banner + BS totals + screenshot), with the deep-dive tier fully expanded
   where triggered.
4. Zero data/code/state mutations occurred — re-state this in the report and
   list every command category you ran as evidence of read-only compliance.
5. Every finding carries evidence + proposed remediation, and the report
   explicitly states: **"No fixes were applied. Awaiting user approval per
   finding."**

## OPERATIONAL NOTES (hard-won; ignore at your peril)

- Face values live in `<input>` elements — text extraction shows blanks for
  inputs; NEVER report a blank cell as a mismatch without checking
  `input.value` first (a prior false alarm).
- Browser tabs cache aggressively: always append a fresh `&v=<n>` param.
- Stage 7 (FS) is `?stage=10`; reach COA Mapping via the left-nav link, not
  `?stage=6` (that lands on Engagement Setup).
- plpgsql: don't reuse a DECLAREd record variable name as a CTE/table alias.
- The FS Health panel's "manual adj." amber status on cogs rows is
  structural (materials-vs-inventory-movement), not a defect — classify
  accordingly, don't raise false findings.
- A "tallied" claim without a fresh screenshot of the rendered screen is not
  a tallied claim. The user has been burned eight times by back-end-only
  checks.

## FINAL INSTRUCTION

When the report is complete, present in chat: the verdict, the
full-universe assurance table summary (counts per status), the findings
register (even if empty), and all file paths. Then STOP. Do not fix
anything — not even a "trivial" one-liner — without the user's explicit,
per-finding approval.
