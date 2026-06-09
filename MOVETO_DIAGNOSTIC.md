# Move To Persistence — Diagnostic Report

**Date:** 2026-06-09  
**Entity:** REVTI INFRA (Partnership, NCE)  
**Note:** Note 3 Long-Term Borrowings (noteType: `borrowings`)

---

## 1. Move To Handler

- **File:** `src/components/stage8/NCEDetailedNotes.tsx:2684-2843`
- **Function:** `handlePromoteCustomToStatic(noteType, customId, targetId)`
- **UI trigger:** `RowActionsMenu` (line 341–454) renders "Move to…" dropdown; bulk-move toolbar (line 1002–1039) renders "Move" button for multi-select.

### Fields changed on move

| Field | Before | After |
|-------|--------|-------|
| `source` | `"auto"` | `"manual"` |
| `attachedTo` | original static parent or `undefined` | `targetId` (new parent) |
| `tbDerived` | `undefined` or `true` | `true` (if was auto or already tbDerived) |
| `section` | original section | target's section (Pattern A notes) |

### Row shape before move
```json
{
  "id": "custom_au_small_finance_bank_42",
  "label": "Au Small Finance Bank",
  "source": "auto",
  "attachedTo": "sec_demand_bank",
  "section": "secured",
  "tbDerived": undefined
}
```

### Row shape after move
```json
{
  "id": "custom_au_small_finance_bank_42",
  "label": "Au Small Finance Bank",
  "source": "manual",
  "attachedTo": "unsec_fi",
  "section": "unsecured",
  "tbDerived": true
}
```

### Exact state update (line 2727–2750)
```typescript
const movedRows = cur.customRows.map(r => {
  if (r.id === customId) {
    const wasTbDerived = r.tbDerived === true || r.source === "auto";
    return {
      ...r,
      source: "manual" as const,
      attachedTo: targetId,
      ...(wasTbDerived ? { tbDerived: true } : {}),
      ...(targetSection !== undefined ? { section: targetSection } : {}),
    };
  }
  return r;
});
```

### Badge computation (line 3164–3165)
```typescript
const autoCount = d.customRows.filter(r => r.source === "auto").length;
const manuCount = d.customRows.filter(r => r.source === "manual").length;
```
After move: 40 auto → 38 auto + 2 manual ✓

---

## 2. Save All Notes Handler

- **File:** `src/components/stage8/NCEDetailedNotes.tsx:3035-3047`
- **Function:** `handleSave`
- **Supabase table:** `nce_financial_notes`
- **Conflict key:** `engagement_id, financial_year, note_type`

### Columns written (per row)
| Column | Type | Value |
|--------|------|-------|
| `engagement_id` | string (UUID) | engagement UUID |
| `financial_year` | string | e.g., "2024-25" |
| `note_type` | string | e.g., "borrowings" |
| `cy_data` | Json | serialised note (see below) |
| `py_data` | Json | `{ [rowId]: number }` |
| `updated_at` | string | ISO timestamp |

### Serialisation function: `serialiseNoteData` (nceAutoPopulate.ts:628–648)
```typescript
cy_data: {
  ...d.cy,                                    // numeric amounts
  _custom_rows:      d.customRows,            // ← FULL ARRAY including attachedTo, source
  _hidden_rows:      d.hiddenRows ?? [],
  _label_overrides:  d.labelOverrides ?? {},
  _ejected_ledgers:  d.ejectedLedgers ?? [],
  _source_label_overrides: ...,
  _cy_sources: ...,
}
```

### Does payload include attachedTo/move field: **YES**

The `_custom_rows` array is `d.customRows` verbatim — each `NCECustomRow` object is serialised in full, including `source`, `attachedTo`, `section`, and `tbDerived`. The save correctly writes the moved row's new state to the database.

### Sample cy_data (1 note, borrowings):
```json
{
  "sec_demand_bank": 50000000,
  "unsec_fi": 0,
  "_custom_rows": [
    {
      "id": "custom_au_small_finance_bank_42",
      "label": "Au Small Finance Bank",
      "source": "manual",
      "attachedTo": "unsec_fi",
      "section": "unsecured",
      "tbDerived": true
    }
  ],
  "_hidden_rows": [],
  "_label_overrides": {},
  "_ejected_ledgers": [],
  "_cy_sources": { ... }
}
```

**Conclusion for §2:** The save is CORRECT. `attachedTo`, `source: "manual"`, `tbDerived`, and `section` are all persisted to Supabase.

---

## 3. Page Load Sequence

### Mount effect: `useEffect` at NCEDetailedNotes.tsx:1882

| Step | Operation | File:Line |
|------|-----------|-----------|
| 1 | Fetch `audit_engagements.financial_year, clients.name` | :1888–1894 |
| 2 | Query `nce_financial_notes` filtered by `engagement_id + financial_year` | :1900–1906 |
| 3 | Deserialise each row via `deserialiseNoteData(cy_data, py_data)` | :1916–1922 |
| 4 | Check `hasData` (any note has real CY keys or custom rows) | :1910–1914 |
| 5a | If `!hasData` → call `nceAutoPopulate(engId, built)` (rebuild from scratch) | :1924–1929 |
| 5b | If `hasData` → run 11 self-heal migrations on `built` | :1931–2349 |
| 6 | Task 4 heal: promote `auto+attachedTo` rows → `manual` (one-shot) | :2293–2303 |
| 7 | Duplicate row dedup (label+attachedTo+section) | :2316–2349 |
| 8 | Persist healed `built` if any changes | :2351–2352 |
| 9 | Set component state: `setNoteData(built)` | :2354 |
| 10 | Check localStorage migration flags (4 keys) | :2373–2404 |
| 11 | Check `needsPyAnyEmpty` (any note has CY but no PY) | :2396–2401 |
| 12 | **If ANY trigger condition is true** → silent `nceAutoPopulate(engId, built)` | :2432–2464 |
| 13 | Overwrite state with refreshed data: `setNoteData(refreshed)` | :2445 |
| 14 | Persist refreshed data + set localStorage flags to "1" | :2446–2463 |

### Auto-populate runs on page load: **YES — conditionally**

The silent re-sync at step 12 triggers when ANY of these is true:
- `unEjectedAny` — healed orphan ejected ledgers
- `needsCySources` — any note has CY amounts but no `cy_sources` metadata
- `needsPyRefresh` = `needsPyAnyEmpty || !pyMigrationDone`
- `needsCySourcesPyRefresh` = `!pySourcesMigrationDone`
- `needsDrCrRefresh` = `!drCrMigrationDone`
- `needsSignFixRefresh` = `!signFixMigrationDone`

### **CRITICAL: `needsPyAnyEmpty` can trigger re-sync on EVERY page load**

```typescript
// Line 2396-2401
const needsPyAnyEmpty = Object.values(built).some(d => {
  const hasCY = Object.values(d.cy ?? {}).some(v => Math.abs(Number(v) || 0) > 0.005);
  const hasPY = Object.values(d.py ?? {}).some(v => Math.abs(Number(v) || 0) > 0.005);
  return hasCY && !hasPY;
});
const needsPyRefresh = needsPyAnyEmpty || !pyMigrationDone;
```

If ANY note has CY data but no PY data (common for first-year entities, entities without a PY shell, or notes that simply have no prior-year figures), `needsPyAnyEmpty` is **always true** — even after the localStorage flag `pyMigrationKey` is set to "1". The condition is `needsPyAnyEmpty || !pyMigrationDone`, so even with the flag set, `needsPyAnyEmpty` alone keeps the condition true.

**This means the silent re-sync runs on EVERY page load for affected entities.**

### Auto-populate preserves manual moves: **NO — for per-ledger-breakup notes**

Inside `nceAutoPopulate` (nceAutoPopulate.ts:1066–1079):

```typescript
const isPerLedgerBreakup =
  noteType === "borrowings" ||
  noteType === "investments" ||
  noteType === "loans_advances";

manualRows = manualRows.filter(mr => {
  const lbl = (mr.label || "").trim().toLowerCase();
  if (!lbl) return true;
  const currentCode = tbCodeByLabel.get(lbl);
  if (!currentCode) return true;             // user-typed row (no TB match) → keep
  if (isPerLedgerBreakup) return false;      // ← DROPS ALL TB-matching manual rows
  return ourCodes.has(currentCode);          // others: keep if mapping still ours
});
```

For `borrowings`, `investments`, and `loans_advances`, **ALL manual rows whose label matches a TB ledger are dropped** (line 1077: `return false`). This is intentional — the comment says "breakup note → always rebuild from auto" — but it has the side effect of destroying any Move To placements.

After the manual rows are dropped, the `manualLabelSet` (line 1108–1121) is built from the REMAINING manual rows. Since the moved rows were already purged, their labels are NOT claimed. The auto loop then recreates them as `source: "auto"` rows with the smart-match-determined `attachedTo`, ignoring the user's move.

### Auto vs manual classification logic

| Classification | Created by | Survives re-sync? |
|---------------|------------|-------------------|
| `source: "auto"` | `nceAutoPopulate` TB walk | NO — rebuilt from scratch |
| `source: "manual"` | User "+ Add row", user "Move to…", user label edit | YES for Pattern B notes; **NO for per-ledger-breakup notes** (borrowings/investments/loans_advances) if label matches a TB ledger |

---

## 4. Root Cause

### Scenario: **D — Both: save is correct, but auto-populate overwrites on every reload**

### Explanation

The Move To persistence bug is caused by **two interacting defects**:

**Defect 1 — Aggressive manual-row purge in per-ledger-breakup notes (nceAutoPopulate.ts:1066–1079):**
For `borrowings`, `investments`, and `loans_advances`, `nceAutoPopulate` unconditionally drops ALL manual rows whose label matches any TB ledger. This design ("always rebuild from auto path") was added to fix the SHREE HARI INFRA wrong-parent bug, where stale manual rows with incorrect `attachedTo` survived indefinitely. But it also destroys intentional user moves — the function cannot distinguish between "stale heal artifact" and "deliberate user placement."

**Defect 2 — `needsPyAnyEmpty` triggers re-sync on every page load (NCEDetailedNotes.tsx:2396–2401):**
The condition `needsPyAnyEmpty` checks if ANY note has CY data but zero PY data. For entities in their first year, or entities whose PY shell has no data for certain notes, this is **permanently true**. The `pyMigrationDone` localStorage flag does NOT prevent re-sync because the condition is OR'd: `needsPyRefresh = needsPyAnyEmpty || !pyMigrationDone`. Even with `pyMigrationDone = true`, the `needsPyAnyEmpty` arm keeps the gate open.

### The collision sequence (on every page refresh):

1. Saved data loaded from Supabase — contains `source: "manual"` rows with correct `attachedTo` ✓
2. Task 4 heal runs — no-op (rows already manual) ✓  
3. `needsPyAnyEmpty` evaluates to `true` (some note has CY but no PY)
4. Silent re-sync calls `nceAutoPopulate(engagementId, built)`
5. For `borrowings`: stale-ledger purge at line 1077 drops ALL manual rows matching TB ledgers
6. `manualLabelSet` is built AFTER the purge → doesn't include the dropped rows
7. Auto loop recreates the rows as `source: "auto"` with smart-match-determined `attachedTo`
8. User's Move To placement is destroyed
9. Badge reverts from "38 auto + 2 manual" to "40 auto"

### The move is lost at:
**`src/lib/nceAutoPopulate.ts:1077`** — `if (isPerLedgerBreakup) return false;`

This line unconditionally drops every manual row matching a TB ledger for borrowings/investments/loans_advances, overriding the user's Move To placement every time `nceAutoPopulate` runs.

**The re-sync trigger that causes it to run on every refresh:**
**`src/components/stage8/NCEDetailedNotes.tsx:2401`** — `const needsPyRefresh = needsPyAnyEmpty || !pyMigrationDone;`

The `needsPyAnyEmpty` arm makes the trigger permanent for entities with any note lacking PY data.

---

## 5. Scope of Impact

### Affected note types

Only **per-ledger-breakup notes** lose Move To on re-sync:
| noteType | Display Name | Affected? |
|----------|-------------|-----------|
| `borrowings` | Notes 3/4 (LT/ST Borrowings) | **YES** |
| `investments` | Notes 5/6 (LT/ST Investments) | **YES** |
| `loans_advances` | Notes 7/8 (LT/ST Loans & Advances) | **YES** |
| `trade_payables` | Trade Payables | NO (Pattern B — manual rows preserved if code matches) |
| `other_cl` | Other Current Liabilities | NO |
| `other_expenses` | Other Expenses | NO |
| `cogs` | Cost of Goods Sold | NO |
| *(all other Pattern B)* | — | NO |

### Affected entities

**ALL NCE entities** where:
1. The entity has at least one note with CY data but no PY data (triggers `needsPyAnyEmpty`)  
   — OR any localStorage migration flag is missing/unset
2. AND the user has moved a row in a per-ledger-breakup note

This likely affects:
- First-year entities (no prior year data for any note)
- Entities without a PY shell engagement
- Entities where specific notes legitimately have zero PY (e.g., new borrowings taken in CY)

### Corporate FS affected: **NO**

Corporate FS uses a completely different component hierarchy (`CorporateFinancialStatements`, `CorporateBSNotes`, etc.) with its own data model. The NCE auto-populate pipeline and the per-ledger-breakup purge logic are specific to `NCEDetailedNotes.tsx` and `nceAutoPopulate.ts`.

### Cross-entity check

The Move To feature is available in ALL NCE notes (both Pattern A and Pattern B). The "Move to…" dropdown appears in `RowActionsMenu` for every custom row. However, only per-ledger-breakup notes (borrowings, investments, loans_advances) have the aggressive manual-row purge that destroys moves.

---

## 6. Data Schema

### Table: `nce_financial_notes`

Source: `src/integrations/supabase/types.ts:5091–5131`

| Column | Type | Notes |
|--------|------|-------|
| `id` | string (UUID) | Primary key |
| `engagement_id` | string (UUID) | FK → `audit_engagements.id` |
| `financial_year` | string | e.g., "2024-25" |
| `note_type` | string | e.g., "borrowings", "trade_payables" |
| `cy_data` | Json | Current year data + metadata |
| `py_data` | Json | Prior year amounts only |
| `created_at` | string \| null | Auto-generated |
| `updated_at` | string \| null | Set on each save |

**Unique constraint:** `(engagement_id, financial_year, note_type)`

### JSON structure of `cy_data`

```json
{
  // Numeric amounts keyed by static row ID or custom row ID
  "sec_demand_bank": 50000000,
  "unsec_fi": 0,
  "custom_au_small_finance_42": 8044734,

  // Metadata (underscore-prefixed)
  "_custom_rows": [
    {
      "id": "custom_au_small_finance_42",
      "label": "Au Small Finance Bank",
      "source": "manual",
      "attachedTo": "unsec_fi",
      "section": "unsecured",
      "tbDerived": true,
      "sources": null,
      "ejectedSource": null
    }
  ],
  "_hidden_rows": [],
  "_label_overrides": {},
  "_ejected_ledgers": [],
  "_cy_sources": {
    "sec_demand_bank": [
      { "ledger": "HDFC Bank OD", "amountCy": 50000000, "amountPy": 48000000 }
    ]
  },
  "_source_label_overrides": {}
}
```

### Key fields per custom row in `_custom_rows`

| Field | Purpose | Survives re-sync? |
|-------|---------|-------------------|
| `source` | `"auto"` or `"manual"` — determines if row is rebuilt | Manual: YES for Pattern B, **NO for per-ledger-breakup** |
| `attachedTo` | Static row ID the row is nested under (set by "Move to…") | Same as `source` |
| `section` | Pattern A section tag (`"secured"` / `"unsecured"`) | Same as `source` |
| `tbDerived` | Amount lock (true = from TB, read-only) | Same as `source` |

### No separate "overrides" or "manual_moves" field

All move information is stored inline in the `_custom_rows[].attachedTo` field. There is no separate tracking structure for user-initiated moves, which means the only thing protecting a move from being overwritten is the `source: "manual"` flag — and as shown above, that flag is insufficient for per-ledger-breakup notes.

---

## 7. Fix Recommendations (for reference — not implemented)

### Fix 1 (Minimal): Exempt user-moved rows from the per-ledger-breakup purge

At `nceAutoPopulate.ts:1077`, instead of `return false` for all TB-matching manual rows, preserve rows where `attachedTo` differs from the smart-match target — these represent intentional user moves:

```
if (isPerLedgerBreakup && mr.attachedTo !== smartMatchTarget) return true;  // user moved it
if (isPerLedgerBreakup) return false;  // stale heal artifact — safe to rebuild
```

### Fix 2 (Required): Break the `needsPyAnyEmpty` infinite re-sync loop

At `NCEDetailedNotes.tsx:2401`, gate `needsPyAnyEmpty` behind the migration flag:

```
const needsPyRefresh = !pyMigrationDone && needsPyAnyEmpty;  // one-shot only
```

Or alternatively:
```
const needsPyRefresh = !pyMigrationDone;  // ignore PY emptiness after first migration
```

### Fix 3 (Defense in depth): Add a `userMoved: true` flag

Add a `userMoved?: boolean` field to `NCECustomRow`. Set it in `handlePromoteCustomToStatic`. In `nceAutoPopulate`, never drop rows with `userMoved: true` regardless of note type.
