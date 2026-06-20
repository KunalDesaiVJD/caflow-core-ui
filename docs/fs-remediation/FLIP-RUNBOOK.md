# FS Remediation — Flip & Validate Runbook

How to take the staged Phase-2 changes live, **one flag at a time**, with the parity harness as the safety net (§11). Run everything in the **credentialed checkout** (the one with `.env.local`).

> Golden rule: **flip ONE flag → re-sync/regenerate ONE engagement → diff → review → sign off.** Never flip two at once; you lose attribution.

---

## 0. One-time setup

```
git fetch && git checkout claude/auto-2026-06-19-fs-remediation && npm install
node scripts/fs-parity/fs-parity.cjs capture baseline.json      # current production state
```
`baseline.json` is your reference. It snapshots the persisted figure layer (note totals, fa rows) for **every** engagement. Keep it.

The diff command (used after every flip):
```
node scripts/fs-parity/fs-parity.cjs diff baseline.json after.json
```
Exit 0 = zero figure delta. Exit 1 = figures moved (the report lists exactly which engagement / note / code, old → new).

---

## 1. What's already LIVE on this branch (no flag — already in effect once merged)

These are figure-neutral or report-only; they need **no** flip. Expect the parity diff to be **zero** for all of them:

| Change | Effect |
|---|---|
| `[SIGN-TRACE]` removed | no console spam |
| Export block-reason branch fixed | correct "blocked because…" text |
| Drift-log `catch` surfaced | a missing `fs_reconciliation_log` warns instead of silently failing |
| **Faces read-only** (`FS_FACE_FIGURES_READONLY`) | auditors can't type figures onto the BS/PL face; displayed values unchanged |
| **Note totals locked** | "Total — (per BS/P&L)" rows read-only; disclosures (ageing, MSME split, share capital, etc.) still editable |
| **Unexplained-vs-manual labelling** | FS-Health panel flags a Note≠COA gap with no manual row as "⚠ unexplained" |
| **Corporate COA anchor real** | corporate FS-Health COA column now shows real values (was always = note) |
| **Staleness COA-detection logic** | `evaluateNotesStaleness` can flag a COA change — *pending the fingerprint wiring (§4)* |

> Validation for this set: after merging, capture `after.json` and diff against `baseline.json` → **must be zero**. (These move no persisted figure.) If anything moves here, STOP — it's a regression, not an intended correction.

---

## 2. The figure-moving flags — flip order (lowest blast-radius first)

`src/lib/nceFeatureFlags.ts` and the face flag in `PipelineFinancialStatements.tsx`. Recommended order:

### 2.1 `FS_NO_CAPITAL_PLUG` (start here — clearest signal)
- **What flips:** the NCE BS stops plugging its imbalance into Owners' Capital. A genuinely unbalanced BS now *shows* unbalanced, **blocks export**, and displayed Capital becomes the real note/COA value.
- **Expected diff:** **zero** on engagements that already balanced (residual ≤ ₹2). On a "dirty" engagement, Owners' Capital (`NCE_CAP`) changes by the previously-hidden residual, and the BS-balance gate trips.
- **Validate:** flip → open the engagement's FS → re-capture → diff. A non-zero Capital delta = the imbalance that *was* hidden. Confirm the BS genuinely doesn't balance (it's a real mapping/sign issue to fix), or that the move is the expected correction.
- **Rollback:** set back to `false`.

### 2.2 `FS_CORP_PY_FACE_FROM_NOTE` (corporate only)
- **What flips:** corporate BS **PY** column reads the note PY breakup instead of the raw current-year opening balance.
- **Expected diff:** zero where opening == note-PY; moves on reclassified / manual-PY / shell-vs-opening corporate engagements. Also aligns the Word BS PY.
- **Validate:** corporate engagements only; diff each BS-note PY column.

### 2.3 `NCE_SIGNED_NOTE_AMOUNTS` + `CORP_SIGNED_NOTE_TOTALS` (the sign choke-point — flip TOGETHER)
- **What flips:** contras finally **deduct** — a Dr party in a Cr-natural head, a Cr write-back in an expense head, an abnormal Cr stock under inventory (COGS/inventory sign is staged on the same flag). NCE + Corporate must flip together or CY/PY go inconsistent.
- **Expected diff:** zero on engagements with no abnormal-side ledgers; on others, the note/face for the affected head changes by 2× the opposite-side ledger sum (it was added, now it nets). **This is the biggest mover** — diff carefully, especially PY columns of borrowings/provisions/investments/loans and Changes-in-Inventories / net profit.
- **Validate:** widest parity sweep. Cross-check a couple of affected notes by hand against the COA mapping.
- **⚠ RE-POPULATE REQUIRED — or the screen will not change.** The Stage-7 face renders a *persisted snapshot* of the note totals (`nce_financial_notes.cy_data/py_data`), read via `getNCENoteFaceTotal` → `computeNoteTotals` (sums verbatim). `NCE_SIGNED_NOTE_AMOUNTS` gates **only the engine WRITE path** — flipping it does **nothing on render** until the notes are rebuilt and re-saved. After flipping, for EACH engagement: click **"Refresh notes from TB"** (notes must be UNLOCKED / not finalized; `recorrectFromCOAMapping` is hard-disabled) — or do a direct SQL re-write of `py_data` for `note_type IN ('borrowings','loans_advances')`. The parity harness's re-sync re-persists automatically (that's *why* runbook step "flip → re-sync → diff" works); an auditor viewing the app must trigger it manually. Confirmed live on MAHARSH INFRA (`70563956…`) 2026-06-20 via 4-agent trace `wf_692a20cd` (high confidence). Both PY movers — Long-term borrowings (+₹3,64,16,574) and ST loans (+₹40,50,250) = the ₹3,23,66,324 imbalance — are the SAME sign root and both correct on this one re-populate.

### 2.4 `NCE_RESYNC_DELETE_FIRST` (re-sync hygiene)
- **What flips:** re-sync DELETEs then rebuilds NCE notes (removes orphan note rows); a ledger rename is stored as a display-only label override instead of mutating the row (no more duplicate-row double-count).
- **Expected diff:** zero on clean engagements; on engagements that had orphan rows or rename-duplicates, those notes correct (the orphan/dupe disappears).
- **Validate:** re-sync a known-dirty engagement (e.g. one with an LT↔ST reclassification) and confirm the orphan note is gone.
- **Note:** this delivers the *core* Rule-6 fix. The full D1 orchestrator (unified entry points, ledger_aliases, fingerprint wiring) is the architectural follow-up (§4).

---

## 3. Sign-off criteria (per flag)
A flag is cleared to stay ON when, across all live engagements:
- clean engagements show **zero** delta, AND
- every moved figure is a **documented, expected correction** (the books genuinely had the defect), reviewed and recorded.

If a move is *not* explainable as a correction → it's a regression → flag OFF and report.

---

## 4. Remaining work — finish in this (credentialed) environment
These were deliberately NOT built blind because they need real-data validation:
1. **Fingerprint wiring for the staleness banner (BUG-041):** compute `coaMappingFingerprint(coaMapping)` on the FS page, stamp it into `cy_data._coa_fingerprint` at notes-build (add the key to `META_KEYS`), read it back, and pass `liveCoaFingerprint` / `notesCoaFingerprint` into `evaluateNotesStaleness` (the logic already accepts them and is unit-tested). Figure-neutral — verify the banner appears after a COA-only remap.
2. **D1 re-sync orchestrator (§13):** unify the re-sync entry points into one `resyncEngagement(...)`, add `ledger_aliases` carry-forward, and replay intent (captions/regroup) by stable row id. Build it against a real re-sync so each step is validated.
3. **B1 — reconciliation/export-gate PY match (`computeCOATotals` dropped 4th arg).** `PipelineFinancialStatements.tsx:3972` currently calls `computeCOATotals(tallyTb ?? [], pyShellTb ?? [], coaMapping)` — only 3 args. The optional 4th `pyCoaMap` is dropped, so the FS-Health COA **anchor** classifies PY-shell ledgers against the **current-year** map (`fsReconciliation.ts` PY pass falls back to `lookupMapping`). This mis-states the PY anchor used by the drift/export gate. It does **NOT** move the face line (the face engine `nceAutoPopulate` loads the PY-shell's own map internally), so it is invisible until the gate is consulted. **Fix:** pass the PY-shell engagement's own `coa_mapping` as the 4th arg, then confirm the FS-Health PY reconciliation column equals the Stage-6 COA-mapping PY total. **Code edit, not a flag** — cannot ship by flipping. (Found 2026-06-20, trace `wf_692a20cd`.)

---

## 5. Rollback (any time)
Every change is on a branch and behind a flag. To revert one change: flip its flag to `false` (figure-movers) or `git revert <commit>` (the always-on ones). To abandon entirely: don't merge the branch.
