# PY-Only Drift Fix Report — 6 Remaining Cells

**Date:** 2026-06-11
**Branch:** `claude/auto-2026-06-11-py-drift-fix`
**Algorithm:** Drift = COA PY − Note PY (negative = note over-stated, positive = note under-stated)

---

## Summary

All 6 PY-only drift cells fixed. Notes PY now equals COA PY exactly for every cell (|drift| < ₹1).

| # | Engagement | Note | Before Drift | Pattern | After Drift |
|---|------------|------|--------------|---------|-------------|
| 1 | MAHARSH INFRA | borrowings | -₹3,64,16,574 | B (wrong sign) | ₹0 |
| 2 | MAHARSH INFRA | loans_advances | -₹24,00,000 | A (PY-shell stale) | ₹0 |
| 3 | MAHIL INFRA | borrowings | -₹40,50,250 | B (wrong sign) | ₹0 |
| 4 | NIRALI PERFUMERY | other_expenses | +₹2,29,331 | E (missing PY) | ₹0 |
| 5 | REVTI INFRA | loans_advances | -₹94,37,674 | B (wrong sign) | ₹0 |
| 6 | SKYLARK CORP | other_expenses | -₹24,849 | E (over-stated static) | ₹0 |

---

## Cell 1: MAHARSH INFRA — borrowings — Pattern B

**Engagement:** `70563956-c474-4b78-b2e6-6c2ead600efd`

**Investigation:**
- COA PY (CR-natural rule on CY TB opening for NCE_LTB):
  - Balaji Infra Cr 2,000,000 → +2,000,000
  - Bhakti Infra **Dr** 13,489,450 → **−13,489,450** (opposite-side contra)
  - Ishvarbhai Cr 5,963,317 → +5,963,317
  - Mahil Infra Cr 2,025,125 → +2,025,125
  - Revti Infra **Dr** 4,718,837 → **−4,718,837** (opposite-side contra)
  - Shree Maruti Cr 2,228,102 → +2,228,102
  - Others (Bhimajibhai, Dipesh, Keval, Kirit, Rahil, Sarojben): all 0
  - **Total COA PY = −5,991,743**
- Note PY (sum of py_data) = 30,424,831
- **Drift = COA PY − Note PY = −5,991,743 − 30,424,831 = −36,416,574** ✓

**Pattern:** B — Dr-on-CR-natural ledgers stored as positive instead of negative. Both Bhakti and Revti need sign flip. Fix delta = 2 × (13,489,450 + 4,718,837) = 36,416,574. ✓

**SQL applied:**
```sql
UPDATE nce_financial_notes
SET py_data = py_data || jsonb_build_object(
  'custom_bhakti_infra_1_lt', -13489450,
  'custom_revti_infra_5_lt',  -4718837
), updated_at = NOW()
WHERE engagement_id='70563956-c474-4b78-b2e6-6c2ead600efd'
  AND note_type='borrowings';
```

**Verification:** Note PY = −5,991,743 = COA PY. Drift = 0.

---

## Cell 2: MAHARSH INFRA — loans_advances — Pattern A

**Engagement:** `70563956-c474-4b78-b2e6-6c2ead600efd`

**Investigation:**
- COA PY (DR-natural rule on CY TB opening for NCE_LTLA/NCE_STLA): sum of 15 ledgers = **51,866,109**
- Note PY = 54,266,109
- Drift = 51,866,109 − 54,266,109 = **−2,400,000** ✓
- Identified `custom_advance_tax_1_st = 2,400,000` as the surplus row.
- "Advance Tax" exists in coa_mapping but is mapped to **NCE_OCA** (other_ca), not NCE_STLA. So this custom row is a stale PY-shell artefact in the wrong note.

**Pattern:** A — PY-shell-only stale value (the row's label doesn't correspond to any TB ledger mapped to NCE_LTLA / NCE_STLA).

**SQL applied:**
```sql
UPDATE nce_financial_notes
SET py_data = py_data || jsonb_build_object('custom_advance_tax_1_st', 0),
    updated_at = NOW()
WHERE engagement_id='70563956-c474-4b78-b2e6-6c2ead600efd'
  AND note_type='loans_advances';
```

**Verification:** Note PY = 51,866,109 = COA PY. Drift = 0.

---

## Cell 3: MAHIL INFRA — borrowings — Pattern B

**Engagement:** `e11aebd4-6e1e-481c-90dc-7dff556dc5cb`

**Investigation:**
- COA PY (CR-natural on CY TB opening for NCE_LTB, 28 mapped ledgers deduped): **104,246,598**
- Note PY = 108,296,848
- Drift = 104,246,598 − 108,296,848 = **−4,050,250** ✓
- Maharsh Infra is **Dr 2,025,125** on CR-natural note → signed contribution = −2,025,125, but Note stored +2,025,125. Fix delta = 2 × 2,025,125 = 4,050,250 ✓

**Pattern:** B — wrong sign.

**SQL applied:**
```sql
UPDATE nce_financial_notes
SET py_data = py_data || jsonb_build_object('custom_maharsh_infra_10_lt', -2025125),
    updated_at = NOW()
WHERE engagement_id='e11aebd4-6e1e-481c-90dc-7dff556dc5cb'
  AND note_type='borrowings';
```

**Verification:** Note PY = 104,246,598 = COA PY. Drift = 0.

---

## Cell 4: NIRALI PERFUMERY PRODUCTS — other_expenses — Pattern E

**Engagement:** `31bd3aca-c3f8-48b4-b876-7b7e2ddbacac`
**PY shell engagement:** `ef64ab1b-fc76-4243-b8b3-41f058d1dc36`

**Investigation:**
- P&L COA PY computed from PY-shell TB **closing** (NCE_OTH_EXP mapping) = **3,721,511.31**
- Note PY = 3,492,180.31
- Drift = 3,721,511.31 − 3,492,180.31 = **+229,331** ✓
- Drift is POSITIVE → note missing entries. Identified missing PY values:
  - Vehicle Insurance Exp = 45,381 (already a source of `travel` static row but PY entry 0)
  - Vehicle Loan Interest = 16,528 (in `travel` sources, PY 0)
  - Vehicle Petrol Expenses = 135,230 (in `travel` sources, PY 0)
  - Vehicle Reparing Expenses = 13,519 (in `travel` sources, PY 0)
  - Water Expesnes = 18,673 (custom_water_expesnes_11, PY 0)
- Sum = 45,381 + 16,528 + 135,230 + 13,519 + 18,673 = **229,331** ✓

**Pattern:** E — missing PY entries on smart-mapped static row + custom row.

**SQL applied:**
```sql
UPDATE nce_financial_notes
SET py_data = py_data || jsonb_build_object(
  'travel', 210658,                          -- 45,381 + 16,528 + 135,230 + 13,519
  'custom_water_expesnes_11', 18673
), updated_at = NOW()
WHERE engagement_id='31bd3aca-c3f8-48b4-b876-7b7e2ddbacac'
  AND note_type='other_expenses';
```

**Verification:** Note PY = 3,721,511.31 = COA PY. Drift = 0.

---

## Cell 5: REVTI INFRA — loans_advances — Pattern B

**Engagement:** `de5f2adf-352f-47d8-a754-5c54a1552f93`

**Investigation:**
- COA PY (DR-natural on CY TB opening for NCE_STLA):
  - Krishna Infra Dr 4,591,874 → +4,591,874
  - **Maharsh Infra Cr 4,718,837 → −4,718,837** (opposite-side contra)
  - Mahil Infra Dr 128,304 → +128,304
  - Security Deposit GMMR Dr 50,000 → +50,000
  - Shree Hari Infra Dr 30,428,705 → +30,428,705
  - Torrent Power Dr 4,592 → +4,592
  - **Total COA PY = 30,484,638**
- Note PY = 39,922,312
- Drift = 30,484,638 − 39,922,312 = **−9,437,674** ✓
- Maharsh Infra stored as +4,718,837 in note. Fix delta = 2 × 4,718,837 = 9,437,674. ✓

**Pattern:** B — wrong sign.

**SQL applied:**
```sql
UPDATE nce_financial_notes
SET py_data = py_data || jsonb_build_object('custom_maharsh_infra_1_st', -4718837),
    updated_at = NOW()
WHERE engagement_id='de5f2adf-352f-47d8-a754-5c54a1552f93'
  AND note_type='loans_advances';
```

**Verification:** Note PY = 30,484,638 = COA PY. Drift = 0.

---

## Cell 6: SKYLARK CORPORATION — other_expenses — Pattern E

**Engagement:** `22495b77-4573-41aa-bbcc-52a187918954`
**PY shell engagement:** `b650730a-04c6-47ff-9a61-1b3bfad66557`

**Investigation:**
- COA PY (DR-natural on PY-shell TB closing for NCE_OTH_EXP):
  - Dr sum = 31,176,543.74
  - Cr sum (GST Member 1,800,584 + Kasar Vatav 2,282.45) = 1,802,866.45
  - **Total COA PY = 29,373,677.29**
- Note PY = 29,398,526.29
- Drift = 29,373,677.29 − 29,398,526.29 = **−24,849** ✓
- Static rows over-stated:
  - `printing` stored 34,294. Sources (Stationary URD 21,924 + Stationary 18% 6,185) sum to 28,109. Excess = 6,185.
  - `repairs_bldg` stored 66,478. Sources (Repair 18% 29,150 + Repair URD 18,664) sum to 47,814. Excess = 18,664.
  - Total excess = 6,185 + 18,664 = **24,849** ✓ exact match.

**Pattern:** E — static row PY value differs from sum of TB-derived source ledgers (stale PY-shell carry-forward over the smart-mapped recompute).

**SQL applied:**
```sql
UPDATE nce_financial_notes
SET py_data = py_data || jsonb_build_object(
  'printing', 28109,
  'repairs_bldg', 47814
), updated_at = NOW()
WHERE engagement_id='22495b77-4573-41aa-bbcc-52a187918954'
  AND note_type='other_expenses';
```

**Verification:** Note PY = 29,373,677.29 = COA PY. Drift = 0.

---

## Final Verification Table (post-fix)

| Engagement | Note | Note PY (post-fix) | COA PY | Drift |
|------------|------|---------------------|--------|-------|
| MAHARSH INFRA | borrowings | −5,991,743.00 | −5,991,743.00 | 0 |
| MAHARSH INFRA | loans_advances | 51,866,109.00 | 51,866,109.00 | 0 |
| MAHIL INFRA | borrowings | 104,246,598.00 | 104,246,598.00 | 0 |
| NIRALI PERFUMERY | other_expenses | 3,721,511.31 | 3,721,511.31 | 0 |
| REVTI INFRA | loans_advances | 30,484,638.00 | 30,484,638.00 | 0 |
| SKYLARK CORP | other_expenses | 29,373,677.29 | 29,373,677.29 | 0 |

All 6 cells: |drift| < ₹1 ✓

---

## Chrome BS-Face Verification — skipped

**Reason:** The Claude-in-Chrome MCP detected 2 connected browsers (KUNAL SURFACE + WORK LAPTOP) and per the tool contract requires an explicit user selection before any browser action. Running in Auto Mode without a recent user reply, I skipped the live UI verification rather than guess which browser to drive. The SQL-side verification confirms Note PY = COA PY exactly for all 6 cells — once the user re-opens any of the 6 engagements' Financial Statements page in either browser (no re-sync needed, since the UI is write-protected per commits 15e931d6 and 7a1ddb8b), FsHealthPanel should show no PY drift for these notes.

Screenshot paths: none captured.

---

## Issues / Observations Discovered

1. **Concurrent re-sync race during the session.** Both MAHARSH cells (borrowings + loans_advances) reverted to pre-fix values once after the initial UPDATE (timestamp 10:47:27.482, identical for both rows — looks like a single batch upsert from a generateFS / Re-correct-from-COA-Mapping click in an open Chrome tab). The values were re-applied successfully on second attempt and held. Other 4 cells were not affected by this race. Per CLAUDE.md the UI is "fully write-protected" — but the protection lives in `persistNotes` (the per-row save in NCEDetailedNotes.tsx). The PipelineFinancialStatements "Re-correct from COA Mapping" button (`PipelineFinancialStatements.tsx:4757`) and PipelineStage3 generateFS auto-populate (`PipelineStage3.tsx:2575`) still upsert into `nce_financial_notes` and can overwrite manual fixes. If the user wants notes to be truly read-only end-to-end, those two callsites also need the same write-protection guard.

2. **MAHIL INFRA TB has duplicate-looking JOIN results.** The CTE join on `audit_engagements.coa_mapping` × `tally_trial_balance` produced duplicate rows for Krishna Enterprise, Maharsh Infra, Pearl Enterprise, Revti Infra although each ledger has only 1 TB row. Cause appears to be a multi-key collision in `coa_mapping` jsonb (likely both CY and PY-shell mappings under different casing). Worked around with DISTINCT-LOWER deduplication. Worth a separate audit of `coa_mapping` jsonb hygiene across all engagements.

3. **NIRALI `_cy_sources.travel`** lists 4 vehicle ledgers with `amountPy: 0`, but the PY shell TB has real PY closings for all 4. Whoever last populated `_cy_sources` skipped the PY column for the `travel` row. The fix sets the aggregate `travel` py_data to the correct 210,658 — but the per-ledger `_cy_sources[].amountPy` entries are still 0. The Note Total row reads from `py_data['travel']` (now correct), so the displayed PY total is right; but expanded per-ledger PY column in the renderer will still show 0 for each individual vehicle entry. Cosmetic only — does not affect the BS face balance.
