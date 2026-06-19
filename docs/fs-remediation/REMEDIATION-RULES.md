# FS Integrity Remediation — Rules, Decisions & Constraints (Phase 0)

Status: **Phase 0 — adopted 2026-06-19.** Source of findings: the 116-finding COA→Notes→Face
integrity audit (consolidated report). This document is the binding charter for the remediation.
It does **not** change any production code by itself.

> One-line goal: make `COA total == Note total == Face value` hold for **every note, both engines
> (NCE + Corporate), CY and PY** — and make it *stay* true and *enforced*.

---

## Hard constraints (set by the product owner — non-negotiable)

1. **No changes to Tally sync, PY-shell sync, or COA mapping** — their logic, data, and behaviour
   are off-limits. All remediation lives in the layers *after* COA mapping (notes engine, face,
   reconciliation, gates, exports, note components, feature flags, staleness).
2. **Pull-model reactivity.** Reactivity (Rule 1) and re-sync triggering are implemented on the
   **consumer side** via a `coa_fingerprint` the FS/notes layer computes itself — never by editing
   the COA-mapping handlers (`PipelineStage3`) or `TallySyncPage`.
3. **BUG-111 excluded.** The party-name-scope fix (`applyIntelligence`) lives in the mapping
   intelligence and would change mapping behaviour; it is **out of scope** for this remediation.
4. **No client figure moves without sign-off.** See §11.

> Note: editing `src/lib/nceNoteRegistry.ts` (the static note↔code registry) is **not** "changing
> COA mapping" — it is code, not the engagement's `coa_mapping` data or the Stage-3 screen.

---

## §11 — Change-Safety Protocol (process)

1. Any change that *can* alter a displayed CY or PY figure ships **behind a feature flag defaulting OFF**.
2. **No flag is flipped ON** until a **zero-delta parity run over a snapshot of all live engagements**
   passes: clean engagements show **no** change; "dirty" ones show **only the documented, expected
   correction**, signed off before merge. (Use `scripts/fs-parity/fs-parity.cjs`.)
3. **Signal-only** changes (banners, report-only gates, removing an edit affordance, fixing wrong
   text/nav, hygiene) are exempt from the flag rule **but must be proven figure-neutral by the same
   parity run** (capture baseline → apply → diff → expect zero delta).
4. **Visible-before-you-move-it:** a diagnostic that *exposes* a divergence must land (report-only)
   **before** the change that *moves* the number it exposes.
5. **Announce** figure-moving changes to in-flight engagements (a correct change is still a visible
   change to an auditor mid-engagement).

## §12 — Target Invariants (definition-of-done; enforced by tests, not trust)

Each becomes a test fixture; "done" = green on a known-good engagement, CY + PY, both engines.

1. **Single signed choke-point** — every TB→note/face conversion derives sign once via
   `fsSignConvention.signedBalance`; no second sign path.
2. **Face = Note** — the face renders note totals only; **no editable face figures**; no second/PY engine.
3. **One note-total engine** — the COA anchor and the note engine compute the same number the same
   way, identically keyed (reconciliation = 0 on a known-good fixture).
4. **Reactive** — any COA change recomputes notes → face → ratios → exports; staleness keyed on a
   `coa_fingerprint`.
5. **Re-sync = delete-rebuild figures + preserve intent by stable id** (see §13).
6. **No forged balance** — an unbalanced BS displays unbalanced and **blocks export**; Capital is
   **never** a plug; gates read the **pre-absorber** residual.

## §13 — Re-sync Behaviour (= Deliverable D1)

A re-sync is the pure function **`notes = rebuild(newTB × coa_mapping) ⊕ replay(intentOverlay)`**:

- **Figures** come *entirely* from the new TB (DELETE then REBUILD; no orphan/stale rows).
- **Intent** (assignments, captions, within-note regrouping, genuine manual rows) is captured
  *before* delete and re-applied **by stable row id, never by label match**.
- One orchestrator `resyncEngagement(engagementId, fy, { scope, trigger })`, triggered from the
  **FS-side fingerprint watcher** (honoring constraint #2 — `TallySyncPage` untouched).
- Renamed / new / deleted ledgers resolved by mapping key; PY classified via the PY-shell's own
  mapping; every downstream query invalidated at the end.
- Full per-case design (renamed/new/deleted × CY/PY, data-model, edge cases) is in Deliverable D1
  of the consolidated report.

---

## Policy Decisions (locked to recommended defaults; change here if needed)

| ID | Decision (D2 origin) | **Adopted default** |
|----|----------------------|---------------------|
| **PD-1** | Balance policy (D2.1) | Never plug Capital; show an explicit **"Unexplained difference"** line + **block export** |
| **PD-2** | Manual vs drift (D2.3) | `"manual"` only if a **real user-entered manual row exists**; every other Note−COA gap = **drift that blocks** |
| **PD-3** | Rule-10 opening≠prior-close (D2.13) | **Hard-block FS *generation*** at engagement level; "no PY shell" = a **visible skipped** state |
| **PD-4** | Manual-additions channel (D2.12) | Faces **100% read-only**; figure changes only via **tracked note manual rows** (shown separately from the COA total) |
| **PD-5** | Finalized notes on COA change (D2.4) | **Block** with "unlock to apply" |
| **PD-6** | PY authoritativeness (D2.7) | PY face = **note PY**; TB opening is a reconciliation **check only** |

PD-1/2/3/4 gate Phase 1; PD-5/6 + §13 gate Phase 2.

---

## Phase plan (each D2 conflict: make visible → correct → enforce)

- **Phase 0 (this doc + harness):** adopt §11–§13, lock PD-1…PD-6, build the parity harness. *No figures move.*
- **Phase 1 — make divergence visible (figure-neutral):** diagnostic honesty (PD-2), gate on the true
  residual *report-only* (PD-1), corp drift validator + keying *report-only* (D2.8/10/11), Rule-10
  surfaced *report-only* (PD-3), block **new** face edits (PD-4), staleness banner via fingerprint,
  build the re-sync orchestrator behind a flag OFF, hygiene (D2.16/17, nav). **Exit gate:** parity = zero delta.
- **Phase 2 — correct the numbers (flag-gated, parity-verified):** single signed choke-point
  (flip both sign flags together) + COGS signed; Face=Note (migrate `is_manual`, corp PY face = note
  PY · PD-6); remove the Capital plug (PD-1); one keyed note engine; re-sync delete-rebuild (§13/D1,
  flip `NCE_RESYNC_DELETE_FIRST`, finalized-notes policy · PD-5); enable auto-recompute. **Exit gate:**
  COA==Note==Face everywhere; parity signed off.
- **Phase 3 — enforce & lock:** flip report-only gates → blocking (PD-1/2/3); §12 invariant tests as
  CI gates; retire dead engines/spent flags; NCE↔Corporate parity feature work. **Exit gate:** §12 green.

See the consolidated report for the full bug inventory (BUG-001…116) and the per-phase mapping.
