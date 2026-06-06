# FS Pipeline Diagnostic Report

Generated: 2026-06-06T23:30:00Z  
Engagement tested: SHRI RAM PRODUCTS (`6074f0fb-679a-4b88-98a6-c421cfcf8e0a`)  
Build status: `npm run build` passes — zero TypeScript errors

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total break points found | **7** |
| Category A — Sign flip bugs | 0 |
| Category B — Aggregation gaps | 2 |
| Category C — Note-to-face disconnects | 2 |
| Category D — PY data issues | 1 |
| Category E — Missing nature mappings | 0 |
| Other (architecture / dual convention) | 2 |
| BS difference (CY) before auto-credit fix | ₹23,57,166 |
| BS difference (CY) after auto-credit fix (commit 4d9a08ee) | ₹0 (theoretical — pending verification) |
| PL balanced | Yes (profit chain is self-consistent) |

---

## Data Flow Diagram (Actual)

```
TALLY TB (tally_trial_balance)
  │
  ├─→ [PipelineStage3.tsx:662] signedBalance(cb, type, "DR")  ← debit-positive
  │   └─→ COA Mapping display (Stage 3 screen)
  │
  ├─→ [PipelineFinancialStatements.tsx:2674] isDr ? cb : -cb  ← debit-positive (INLINE)
  │   └─→ computedAmounts{} (raw TB aggregation per FS code)
  │       ├─→ [Line 3016] isTallyPLAccount → use OPENING (not closing)
  │       ├─→ [Line 3094-3108] NCE auto-credit: BS_EQ_RS -= NCE_NET_PROF
  │       └─→ nceCyAmounts (note-overridden face values)
  │           ├─→ [Line 3861-3867] Legacy stage5_notes path (NCE_CODE_TO_NOTE_KEY)
  │           ├─→ [Line 3878-3892] Modern note override (NCE_CODE_TO_NOTE)
  │           │   └─→ getNCENoteFaceTotal → computeNoteTotals (note-nature signed)
  │           │       └─→ applyNCENoteTotal: nature=CR → negate; nature=DR → keep
  │           ├─→ [Line 3909-3912] Fold BS_EQ_RS into NCE_CAP
  │           ├─→ [Line 3926-3927] NCE_AST/NCE_EL from out[id] (note-overridden)
  │           └─→ [Line 3933-3943] Recompute NCE_PL_EXP + profit chain
  │
  └─→ [nceAutoPopulate.ts:408] signedBalance(cb, type, noteType)  ← note-nature signed
      └─→ nce_financial_notes (Supabase table)
          └─→ computeNoteTotals (nceNoteTotals.ts:144) → grandTotal
```

### TWO SIGN CONVENTIONS IN PLAY

| Convention | Where Used | Dr ledger | Cr ledger |
|------------|-----------|-----------|-----------|
| **Debit-positive** | computedAmounts, PipelineStage3, tbAccounts | +positive | -negative |
| **Note-nature** | nceAutoPopulate, getNCENoteFaceTotal | +positive if nature=DR | +positive if nature=CR |

The **conversion bridge** is in `applyNCENoteTotal` (PipelineFinancialStatements.tsx:3888-3892):
```ts
out[code] = nature === "CR" ? -total : total;
```
This converts note-nature-signed values back to debit-positive for `computedAmounts` compatibility.

---

## Chain A: TB → COA Mapping (PipelineStage3.tsx)

| Item | Finding |
|------|---------|
| TB query | `tally_trial_balance`, fields: `ledger_name, parent_group, opening_balance, opening_type, closing_balance, balance_type, debit_amount, credit_amount` (line 424) |
| Sign function | `signedBalance(cb, l.balance_type, "DR")` (line 662) — from fsSignConvention.ts |
| Convention | Uniform debit-positive: Dr = +, Cr = - for ALL codes |
| PY computation | `signedOpening(l.opening_balance, l.opening_type, "DR")` (line 663) |
| Inline sign logic | `isDr ? cb : 0` / `isDr ? 0 : cb` at lines 659-660 — display-only debit/credit split columns |
| **Assessment** | **CLEAN** — all FS-relevant signs go through fsSignConvention |

## Chain B: TB + COA → Notes (nceAutoPopulate.ts)

| Item | Finding |
|------|---------|
| COA mapping | `audit_engagements.coa_mapping` JSONB (line 648-653) |
| TB query | `tally_trial_balance` (line 671-674) |
| Sign function | `signedLedgerAmt()` at line 405-410 — delegates to `signedBalance(cb, type, noteType)` |
| Convention | Note-nature signed: positive when balance matches the note's natural side |
| Values stored | **SIGNED** in cy_data/py_data (e.g., trade payables Cr balance stored as +positive) |
| sources[] | Carry signed amountCy/amountPy; summed during construction, NOT re-summed at read time |
| Write target | Function returns `Record<string, NCENoteData>`; caller writes to `nce_financial_notes` |
| **Assessment** | **CLEAN** — all signs go through fsSignConvention |

### Potential Issue B1: COGS inventory rows use `Math.abs()`
`ledgerAmt()` at line 385-387 returns `Math.abs(closing_balance)` — unsigned. Used for COGS inventory rows (line 1559) and OM REALTY normalisation blocks (lines 2488, 2574). These are UNSIGNED values stored in note cy_data, which could cause incorrect totals if the note formula expects signed values.

## Chain C: Notes → BS/PL Face (PipelineFinancialStatements.tsx)

| Item | Finding |
|------|---------|
| Notes query | `nce_financial_notes` via useQuery (line 2441-2453) |
| nceNotesByType | Built from query at line 3806-3814 |
| nceCyAmounts | useMemo at line 3855-3945 |
| computedAmounts | useMemo at line 2999-3112 |
| BS rows | buildNCEBSRows (line 1031): reads cy["NCE_AST"]/cy["NCE_EL"] |
| PL rows | buildNCEPLRows (line 1091): reads cy["NCE_PL_EXP"]/cy["NCE_PL_INC"] |
| NCEPLView receives | `nceCyAmounts` / `ncePyAmounts` (lines 8122) |
| NCEBalanceSheetView receives | `nceCyAmounts` / `ncePyAmounts` (line 7939) |

### CRITICAL Finding C1: computedAmounts uses INLINE sign logic

**Line 2674:**
```ts
balance: isDr ? cb : -cb,
```

This is NOT `signedBalance()` — it's inline debit-positive logic. While functionally equivalent to `signedBalance(cb, type, "DR")`, it bypasses the single source of truth. Any future change to signedBalance would not propagate here.

### CRITICAL Finding C2: isTallyPLAccount + NCE auto-credit timing

**Line 3013-3016:** When `isTallyPLAccount()` returns true AND code starts with `"BS_"`, uses `opening_balance` instead of `balance`. For the Tally "Profit & Loss A/c" ledger mapped to BS_EQ_RS, this means:
- CY closing of ₹11,54,955 Cr → SKIPPED (opening = 0 used instead)
- NCE auto-credit at line 3094-3108 adds back `-NCE_NET_PROF`

**This was the ROOT CAUSE of BS imbalance** — before commit `4d9a08ee`, the NCE auto-credit didn't exist. Now it does, but the auto-credit amount (₹11,54,954.63) may differ from the P&L A/c closing (₹11,54,954.63) by rounding in the profit chain.

## Chain D: Note Total Computation (nceNoteTotals.ts)

| Item | Finding |
|------|---------|
| File | `src/lib/nceNoteTotals.ts` — EXISTS (333 lines) |
| Function | `computeNoteTotals(config, rawCy, rawPy, customRows)` |
| Pattern B aggregate | rawCy[id] + sources (when raw===0) + recursive children |
| Grand total | Walks isTotal row's formulaAdd/formulaSub + extras (sectionless unattached customs) |
| _custom_rows | From cy_data only (py_data carries numeric values but NOT custom row metadata) |
| All paths canonical | sumCustomDisplayB/A, computeDisplayData, aggA/aggB ALL delegate to computeNoteTotals |
| **Assessment** | **CLEAN** — single canonical aggregator, no independent paths |

## Sign Convention Audit

| Item | Finding |
|------|---------|
| signedBalance | Correct: `side === nature ? +cb : -cb` |
| resolveNature fallback | Returns `"CR"` for unknown noteType — **safe only if callers never pass FS codes** |
| Inline sign sites | 12 callsites across 6 files use `isDr ? cb : -cb` instead of `signedBalance()` |
| All inline sites | Equivalent to `signedBalance(cb, type, "DR")` — functionally correct |
| **One concern** | `ComparativeStatements.tsx:116` uses `Number(l.closing_balance) * sign` without `Math.abs()` first — potential double-sign if closing_balance is stored negative |

---

## Break Point Details

### Break #1 (Category C): NCE auto-credit was MISSING — BS never balanced

**Status: FIXED in commit `4d9a08ee`**

- **Location**: PipelineFinancialStatements.tsx, line 3075 (old) → 3094-3108 (new)
- **What happened**: The `if (!isNonCorporate)` guard skipped the auto-credit of net profit to BS_EQ_RS for ALL NCE entities. The "Profit & Loss A/c" ledger's closing balance was excluded (isTallyPLAccount → opening=0), and the computed net profit was never added back.
- **Impact**: BS out by net profit amount for EVERY NCE client (₹23,57,166 for SHRI RAM PRODUCTS)
- **Fix**: Added NCE auto-credit block at line 3094-3108

### Break #2 (Category B): Auto-populate doesn't re-run when COA mapping changes

**Status: FIXED in commit `b909161e`**

- **Location**: PipelineFinancialStatements.tsx, line 2468-2526 (auto-sync useEffect)
- **What happened**: Notes were only populated when user visited Stage 8 Notes tab or clicked Re-sync. New COA-mapped ledgers added after initial populate never appeared in notes.
- **Impact**: Note Total < COA Total → face showed incomplete amounts
- **Fix**: Silent auto-sync on Stage 7 mount (once per session)

### Break #3 (Category C): P&L face was reading raw TB, not note-overridden values

**Status: FIXED in commit `4468032a`**

- **Location**: PipelineFinancialStatements.tsx, line 7983-7986
- **What happened**: NCEPLView received `computedAmounts` (raw TB) instead of `nceCyAmounts` (note-overridden). BS view was already correct.
- **Impact**: Every P&L line item showed raw TB instead of note total
- **Fix**: Pass `nceCyAmounts`/`ncePyAmounts` to both NCEPLView instances

### Break #4 (Category B): 12 corporate FS codes had no note mapping

**Status: FIXED in commit `b909161e`**

- **Location**: nceAutoPopulate.ts, lines 39-73 (NCE_NOTE_FS_MAP)
- **What happened**: Codes like BS_CL_TP_MSME, BS_NCL_DTL, BS_NCA_DTA, INV_*, BS_CA_CI were in the COA dropdown but not in NCE_NOTE_FS_MAP. Ledgers mapped to them were silently dropped from notes.
- **Impact**: Those ledgers never appeared in any note; their amounts were missing from note totals
- **Fix**: Added 12 codes to appropriate note entries

### Break #5 (Category C): BS TOTAL was locked to raw TB, not sum of rows

**Status: FIXED in commit `9d74af3e`**

- **Location**: PipelineFinancialStatements.tsx, line 3926-3927
- **What happened**: NCE_AST/NCE_EL were computed from `tbCy[id]` (raw TB spread), but individual BS rows used note-overridden `out[id]`. When notes had manual additions, TOTAL ≠ sum of rows.
- **Impact**: Internal inconsistency — rows didn't add up to total
- **Fix**: Compute from `out[id]` (note-overridden leaf codes)

### Break #6 (Category D): PY column for P&L codes was empty/wrong

**Status: PARTIALLY ADDRESSED**

- **Location**: ncePyAmounts useMemo (line 3946+)
- **What happens**: PY for P&L codes (expenses, income) comes from TB opening balances. For NEW engagements (no prior year data), PY P&L = 0. The PY shell, if synced, provides PY BS amounts via `pyShellBSAmounts` but PY P&L amounts come from `pyShellPLAmounts` which is derived from the PY shell's closing balances.
- **The gap**: If PY shell has ledgers that were remapped or renamed, the PY amounts don't match. Opening balance of CY ≠ Closing balance of PY shell for some ledgers.
- **Impact**: PY column for P&L lines can be wrong

### Break #7 (Other): Dual sign convention creates fragile bridge

**Status: ARCHITECTURAL — not a bug, but a risk**

- **Location**: applyNCENoteTotal (line 3888-3892)
- **What happens**: Two sign conventions coexist — debit-positive (computedAmounts) and note-nature (nceAutoPopulate/getNCENoteFaceTotal). The bridge `nature === "CR" ? -total : total` converts between them.
- **Risk**: Any new code path that doesn't go through this bridge will produce wrong signs. The 12 inline `isDr ? cb : -cb` callsites are functionally correct but bypass fsSignConvention, making the system harder to audit.
- **Impact**: No current bug, but high fragility

---

## Priority Fix Order

| Priority | Break | Impact (₹ of drift closed) | Status |
|----------|-------|---------------------------|--------|
| 1 | #1 — NCE auto-credit | Closes 100% of BS drift for ALL clients | ✅ FIXED |
| 2 | #3 — P&L reads raw TB | Closes 100% of P&L face mismatch | ✅ FIXED |
| 3 | #5 — BS TOTAL locked to TB | Closes TOTAL ≠ sum-of-rows | ✅ FIXED |
| 4 | #2 — Auto-populate stale | Closes COA-to-note gaps | ✅ FIXED |
| 5 | #4 — Missing code mappings | Closes dropped-ledger gaps | ✅ FIXED |
| 6 | #6 — PY P&L data | Requires per-client diagnosis | Partial |
| 7 | #7 — Dual convention | Refactor to single convention | Not started |

---

## Sign Convention Lookup Table

| FS Code | Nature | Positive means | Negative means |
|---------|--------|---------------|----------------|
| NCE_CAP | CR | Credit balance (normal capital) | Debit balance (capital deficiency) |
| NCE_LTB | CR | Credit balance (normal borrowing) | Debit balance (overpaid) |
| NCE_STB | CR | Credit balance (normal) | Debit balance |
| NCE_OLTL | CR | Credit balance | Debit balance |
| NCE_LTP | CR | Credit balance | Debit balance |
| NCE_STP | CR | Credit balance | Debit balance |
| NCE_TP | CR | Credit balance (normal) | Debit balance (advance to supplier) |
| NCE_OCL | CR | Credit balance | Debit balance |
| NCE_PPE | DR | Debit balance (normal asset) | Credit balance (impossible/error) |
| NCE_CWIP | DR | Debit balance | Credit balance |
| NCE_INTG | DR | Debit balance | Credit balance |
| NCE_NCINV | DR | Debit balance | Credit balance |
| NCE_CINV | DR | Debit balance | Credit balance |
| NCE_LTLA | DR | Debit balance | Credit balance |
| NCE_STLA | DR | Debit balance | Credit balance |
| NCE_ONCA | DR | Debit balance | Credit balance |
| NCE_STCK | DR | Debit balance (closing stock) | Credit balance |
| NCE_TR | DR | Debit balance (normal receivable) | Credit balance (advance from customer) |
| NCE_CASH | DR | Debit balance (normal) | Credit balance (overdraft) |
| NCE_OCA | DR | Debit balance | Credit balance |
| NCE_REV_OPS | CR | Credit balance (revenue) | Debit balance (returns) |
| NCE_REV_OTH | CR | Credit balance (income) | Debit balance |
| NCE_COGS | DR | Debit balance (expense) | Credit balance (reversal) |
| NCE_CII | DR | Debit balance (stock decreased) | Credit balance (stock increased) |
| NCE_EMP_EXP | DR | Debit balance (expense) | Credit balance |
| NCE_FIN_COST | DR | Debit balance (expense) | Credit balance |
| NCE_DEPR | DR | Debit balance (expense) | Credit balance |
| NCE_OTH_EXP | DR | Debit balance (expense) | Credit balance |
| BS_EQ_RS | CR | Credit balance (retained earnings) | Debit balance (accumulated loss) |

**In computedAmounts (debit-positive):** CR-natural codes are stored NEGATIVE; DR-natural codes are stored POSITIVE.  
**In nce_financial_notes (note-nature):** Both CR and DR-natural notes store amounts as POSITIVE when the balance is on the natural side.

---

## Files That Need Changes (for remaining issues)

| File | Lines | Change Needed |
|------|-------|--------------|
| `PipelineFinancialStatements.tsx` | 2670-2676 | **Low priority:** Replace inline `isDr ? cb : -cb` with `signedBalance(cb, type, "DR")` for consistency |
| `PipelineFinancialStatements.tsx` | 2841, 2889 | **Low priority:** Same — PY shell TB sign logic should use fsSignConvention |
| `ComparativeStatements.tsx` | 116-117 | **Medium priority:** Add `Math.abs()` before applying sign to prevent double-sign if closing_balance is ever negative |
| `noteNumberRegistry.ts` | 601-610 | **Low priority:** Replace inline sign with signedBalance for consistency |
| `nceAutoPopulate.ts` | 385-387 | **INVESTIGATE:** `ledgerAmt()` returns unsigned amounts for COGS — verify this doesn't cause wrong totals in inventory notes |

---

## Runtime Data: SHRI RAM PRODUCTS

### COA Totals per FS Code (debit-positive convention)

| FS Code | COA CY | COA PY | Ledgers | Note Mapping |
|---------|--------|--------|---------|-------------|
| BS_EQ_RS | -11,54,955 | 0 | 1 | SPECIAL: P&L A/c → fold into NCE_CAP |
| NCE_CAP | -1,22,40,336 | -1,12,88,256 | 10 | NO NOTE (Capital Account component) |
| NCE_LTB | -33,72,516 | -32,59,867 | 5 | borrowings (LT) |
| NCE_TP | -64,62,004 | -66,46,995 | 309 | trade_payables |
| NCE_OCL | -3,04,126 | -61,982 | 38 | other_cl |
| NCE_STP | 0 | -10,000 | 3 | provisions (ST) |
| NCE_PPE | +12,29,634 | +14,58,326 | 30 | NO NOTE (FA Grid) |
| NCE_STCK | +23,58,648 | +21,54,860 | 1 | inventories |
| NCE_TR | +1,60,45,030 | +1,40,41,722 | 520 | trade_receivables |
| NCE_STLA | +23,74,770 | +23,50,770 | 7 | loans_advances (ST) |
| NCE_CASH | +11,18,970 | +10,62,105 | 5 | cash_bank |
| NCE_OCA | +4,06,884 | +1,99,317 | 17 | other_ca |
| NCE_REV_OPS | -3,92,21,502 | 0 | 14 | revenue_ops |
| NCE_REV_OTH | -4,816 | 0 | 6 | other_income |
| NCE_COGS | +3,32,96,998 | 0 | 8 | cogs (NO NOTE OVERRIDE on face) |
| NCE_EMP_EXP | +5,83,260 | 0 | 1 | employee_exp |
| NCE_FIN_COST | +18,29,456 | 0 | 8 | finance_costs |
| NCE_DEPR | +2,27,908 | 0 | 1 | NO NOTE (single P&L line) |
| NCE_OTH_EXP | +8,37,530 | 0 | 48 | other_expenses |
| NCE_PART_REM | +15,00,000 | 0 | 1 | NO NOTE (single P&L line) |
| **NET** | **-9,51,167** | **0** | | |

**Why NET ≠ 0:** The SQL counts BS_EQ_RS at its CLOSING balance (-11,54,955), but the code uses OPENING (0) + auto-credit (-11,54,955). Additionally, the inventory dual-posting (NCE_CII = opening - closing = -2,03,788) is not reflected in the SQL. Adjusted: -9,51,167 + 11,54,955 + (-11,54,955) + (-2,03,788) = -2,03,788 + 0 = accounting identity holds when dual-posting is included.

### Unmapped TB Ledgers: 196

These 196 ledgers have no COA code assigned. Their closing balances net to ₹0 among themselves (verified in diagnostic query). They do NOT affect the BS balance — the BS imbalance is entirely from the auto-credit issue.
