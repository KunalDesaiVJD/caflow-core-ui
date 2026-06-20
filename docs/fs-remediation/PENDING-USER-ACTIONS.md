# FS Remediation — Remaining Actions (owner checklist)

Everything that could be built and verified without database access is **done, on this branch, and in PR #6**. The steps below are the ones that require *your* review, your production-deploy decision, or your credentialed environment — they cannot be done from a checkout with no DB creds, and figure-moving changes must not ship without a parity run (§11).

## UPDATE 2026-06-20 — two findings + a hard environment fact
- **WHERE THIS CAN RUN (verified):** the `kvdes` machine (`C:/Users/kvdes/...`) has **no `.env.local` / `.env`** in any checkout, and `C:/Users/Admin/...` does **not exist** on it. The parity harness + every flag flip / re-populate / migration therefore **can only run on the credentialed (office) computer that holds `.env.local`.** No agent can do it from the `kvdes` machine.
- **THE FLIP ALONE DOESN'T MOVE THE SCREEN (new):** the Stage-7 NCE face renders a **persisted snapshot** of note totals. `NCE_SIGNED_NOTE_AMOUNTS` gates only the engine's WRITE path, so after flipping it you **must re-populate** each engagement ("Refresh notes from TB", notes unlocked — or SQL re-write of `py_data`). Without that, the old figures stay on screen. See FLIP-RUNBOOK §2.3.
- **B1 is a code edit, not a flag (new):** `PipelineFinancialStatements.tsx:3972` drops the 4th `pyCoaMap` arg to `computeCOATotals`, mis-stating the FS-Health/export-gate PY anchor (not the face). Apply during the credentialed run. See FLIP-RUNBOOK §4.3.
- **MAHARSH INFRA ₹3,23,66,324 is fully explained:** two PY note lines (Long-term borrowings + ST loans), same sign root, both correct after `NCE_SIGNED_NOTE_AMOUNTS` + a re-populate. Stage-6 COA preview already balances (₹12,11,20,677.55) — the books are fine; only the Stage-7 face snapshot is stale. NOT unmapped ledgers (the 20 unmapped are all ₹0).

## The finish line, in order
1. **Review PR #6** → https://github.com/KunalDesaiVJD/caflow-core-ui/pull/6 — click-test the auto **Vercel Preview** (faces read-only, note totals locked, disclosures still editable).
2. **Merge PR #6** → deploys `main` to production. Only the **figure-neutral** changes go live; the **7 flags stay OFF**, so **no client figure changes**.
3. In the credentialed checkout (`C:/Users/Admin/...`): `git fetch && git checkout claude/auto-2026-06-19-fs-remediation && npm install`, then `node scripts/fs-parity/fs-parity.cjs capture baseline.json`.
4. **Flip one flag at a time** (order + expected diff in `FLIP-RUNBOOK.md`): `FS_NO_CAPITAL_PLUG` → `FS_CORP_PY_FACE_FROM_NOTE` → `NCE_SIGNED_NOTE_AMOUNTS` + `CORP_SIGNED_NOTE_TOTALS` (together) → `NCE_RESYNC_DELETE_FIRST` → `FS_CORP_EXPORT_GATE` → `FS_BLOCK_UNEXPLAINED_DRIFT`. After each: re-sync an engagement → `capture after.json` → `diff baseline.json after.json` → clean engagements must show **zero** delta; review movers; sign off.
5. After all flags validated ON: retire the flags + dead engines.

## Builds to finish *with me* in the credentialed env (need live data to be safe)
- **PD-3 / Rule-10** — promote opening≠prior-close from a Stage-7 export-disable to a **generation-level hard-stop** surfaced at Audit Intelligence.
- **BUG-041 fingerprint wiring** — compute `coaMappingFingerprint` on the FS page + persist it at notes-build (schema column *or* JSONB-meta with live verification — the stamp must not be summed into a total) + pass to `evaluateNotesStaleness`.
- **D1 re-sync orchestrator** — unify the 5 re-sync entry points into one `resyncEngagement(...)`, add `ledger_aliases` + a stable `ledger_id`, replay captions/regrouping by row id.

## Decisions still owed (small — unblock pre-staging)
- **BUG-096** — ST-loans note number: keep **shared Note 14** (per the in-code "combined LT/ST" comment) or change to **20** (per the audit)?
- **§11–§13** — also append to the canonical `CLAUDE.md` (binds every future session)? (currently in this doc folder only)
- **D1** — add the `ledger_aliases` table + stable `ledger_id`? (y/n)
- **BUG-109** — refresh-dialog wording: auto-resolves once D1 wiring is real; confirm then.
- **BUG-111** — party-name scope-at-apply: **excluded** per the "don't touch COA mapping" constraint; confirm it stays out (or schedule separately).

## Data checks (run on a real engagement)
- A **Cr-balance ledger under an inventory parent**? (gates the COGS sign-flip effect)
- Any `coa_mapping` code absent from `NCE_NOTE_FS_MAP`/`FS_CODE_NATURE`? (such codes default to CR sign — `resolveNature`)
- An engagement using the **`INV_STOCK` dual-post** inventory code?
- Does `fs_reconciliation_log` exist with the expected columns? (BUG-112 now surfaces a failure if not)
- PY source: should PY-shell ledgers classify via the **PY-shell's own** mapping vs current-year mapping?

## Status snapshot
- Branch `claude/auto-2026-06-19-fs-remediation`: 16 commits, `npm run build` clean, 108 unit tests pass, adversarial verification passed (every OFF path byte-identical, always-on changes figure-neutral).
- Production (`main`) is unchanged until PR #6 is merged.
