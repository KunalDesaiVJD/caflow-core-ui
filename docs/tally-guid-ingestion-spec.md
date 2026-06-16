# Phase 6 spec — Tally ledger GUID ingestion (external `team-package` agent)

> **Status:** spec only. The DB column ships in migration
> `20260616120000_tally_ledger_guid.sql`. The write side described here lives in
> the **external `team-package` sync agent**, which is **not in this repo** and
> is locked to its existing batch files. This document is the hand-off for
> whoever maintains that agent.

## Why

`coa_mapping` is keyed by `ledger_name`. A Tally **rename** therefore orphans the
mapping on the next re-sync (delete-then-insert lands the ledger under a new
name with no mapping). Today the app mitigates this with a fuzzy, auditor-
confirmed "carry forward" in the COA Mapping orphan panel. A **stable Tally
GUID** removes the guesswork: same GUID + new name = a rename, carried forward
deterministically.

## What to change in the sync agent

The agent already pulls ledger masters from the Tally XML server and inserts
rows into `tally_trial_balance`. Each Tally ledger master carries an immutable
identifier in the export:

- `<GUID>` — globally unique, preferred.
- `MASTERID` / `<MASTERID>` — fallback if GUID is absent.

**Required change:** when building each TB row for insert, read the ledger's
`GUID` (fall back to `MASTERID`) and set the new column:

```
row.tally_guid = ledger.GUID ?? ledger.MASTERID ?? null
```

No other change to the delete-then-insert flow is needed. The column is
nullable, so partially-populated data is safe.

## Consuming it in the app (follow-up, in this repo)

Once `tally_guid` is reliably populated, the orphan-quarantine logic in
`src/components/pipeline/PipelineStage3.tsx` should prefer GUID matching over
the fuzzy token-overlap heuristic:

1. On re-sync, for each unmapped live ledger, look up whether any **orphaned
   mapping** shares the same `tally_guid`. If so, carry it forward
   automatically (no auditor prompt needed — identity is certain).
2. Fall back to the existing Jaccard name-similarity suggestion only when no
   GUID match exists (covers historical rows inserted before this change).

To make GUID available to the mapping layer, store it alongside each
`coa_mapping` entry at mapping time (e.g. `{ code, noteRef, ..., tallyGuid }`),
so the orphan detector can compare the saved GUID against live TB GUIDs.

## Acceptance

- New TB rows have a non-null `tally_guid` for ledgers that expose one in Tally.
- Renaming a ledger in Tally and re-syncing carries its mapping forward with no
  manual action (once the app-side consumer ships).
- Rows with no GUID still sync (column stays null) and fall back to fuzzy match.
