# CAFlow — Tally XML TB Import: Refactor Analysis

## N.1 — What is wrong in the current code (plain English)

### Problem 1: The hierarchy guesser is unreliable

The current importer reads all rows from the Excel/XML as a flat list and then tries
to reconstruct the parent–child tree by checking whether the sum of a sequence of rows
equals the value of an earlier row.  This is called "sum-match" in the code
(`rebuildHierarchy` in `tb-hierarchy.ts`).

**Why this breaks:**
- If two groups happen to sum to the same number it assigns the wrong parent.
- If a group has only one child ledger, the child and the group often have
  identical values — the algorithm cannot tell which is the parent.
- Large datasets (> 300 rows) hit the 600-row scan window limit and orphan nodes.
- Three repair passes try to fix what the first pass got wrong, creating a
  compound-error situation where each pass can silently move nodes.

**The fix that was missed:** Tally XML exports include two tags inside every
`DSPACCNAME` block that give the exact answer:
- `DSPACCNAMELEVEL` — the level number (1 = top group, 2 = sub-group, 3 = ledger, etc.)
- `DSPACCACCISLEAF` — `"Yes"` for ledgers, `"No"` for groups

The current parser reads neither of these tags.  It ignores perfect structural
information that is already in the file and replaces it with expensive guessing.

---

### Problem 2: The sign-correction happens in the wrong place at the wrong time

Tally XML uses a sign convention that is the opposite of what accountants expect:
- A bank account (Dr-normal, asset) with a **debit** balance is stored as a
  **negative** number in the XML (e.g. `-50000`).
- The same bank account with a **credit** balance (overdraft) is stored as a
  **positive** number (e.g. `+50000`).

So to display the number the way an accountant expects, the importer must invert
the sign for all Dr-normal accounts.

**The current code has three layers that each try to do this correction:**

1. `PipelineStage2.tsx` — "Pass 3" — runs when data is loaded from the database.
   It says: "if a Dr-normal account has a negative value, flip it positive."
   This strips all negatives but leaves positive values unchanged.

2. `tb-hierarchy.ts` → `buildTbPresentationModel()` — also tries to detect the
   XML sign convention and invert.  But by the time it runs, Pass 3 has already
   flattened all negatives, so its detection logic fires with no negatives present
   and concludes "this is not an XML import — do nothing."

3. The edge function (`parse-tally-tb`) stores raw values from the XML unchanged
   (which is correct — it should store raw values), but adds no sign-convention
   marker.

**The result:**  A debtor (Sundry Debtors) with a genuine credit balance has a
positive value in the Tally XML file.  Pass 3 sees `> 0`, does not flip it, and
the debtor appears as a positive asset in the balance sheet — which is wrong.
A genuine credit balance on a Dr-normal asset account should display as a negative
(contra-asset) in the balance sheet.

---

### Problem 3: No constitution awareness at parse time

The classification of ledgers into BS/PL sections relies on keyword lists.  These
keyword lists do not distinguish between constitutions.  For example:

- "Capital Account" → proprietorship: BS Liability (proprietor's equity)
- "Capital Account" → partnership: BS Liability (partner's capital — different structure)
- "Capital Account" → private limited: does NOT appear (it's "Share Capital" instead)

The parser uses the same keyword list for all constitutions, which causes
misclassifications that then require manual correction every time.

---

### Problem 4: No validation gate before publish

After import the data flows directly into the audit working papers.  There is no
step that checks:
- Does the balance sheet balance?
- Are there orphaned nodes that were never placed in the tree?
- Are there duplicate ledger names?
- Do group totals match the sum of their children?

Errors discovered later (e.g. during financial statement preparation) must be
traced back to the import and corrected manually.

---

## N.2 — Why Tally XML structures differ across constitutions

Every Indian entity type that uses Tally has a different top-level group structure
because the RBI/MCA/ICAI regulatory frameworks for each entity type require
different financial statements.

### Proprietorship
```
Primary Groups:
  Capital Account          (BS Cr — owner's equity, single person)
  Current Assets           → Sundry Debtors, Cash, Bank, Stock, etc.
  Current Liabilities      → Sundry Creditors, Duties & Taxes, etc.
  Fixed Assets
  Purchase Accounts
  Sales Accounts
  Direct Expenses / Indirect Expenses / Direct Incomes / Indirect Incomes
```
Tally creates a single "Capital Account" ledger for the proprietor.  There are no
partners' current accounts, no share capital, no reserves.

### Partnership
```
Primary Groups:
  Partners' Capital Account    (BS Cr — one per partner)
  Partners' Current Account    (BS Cr — drawings, interest, salary per partner)
  Current Assets, Current Liabilities, Fixed Assets (same as proprietorship)
  Indirect Expenses:
    Partner Remuneration
    Interest on Capital
    Partner Payout
```
Partners' Capital and Partners' Current Account are SEPARATE sub-groups — each
partner has a ledger under each.  The sum-match algorithm regularly confuses
the two because they often have similar values.

### LLP
```
Primary Groups:
  Designated Partners' Capital Contribution  (BS Cr)
  Other Partners' Capital Contribution       (BS Cr, optional)
  Current Assets, Current Liabilities, Fixed Assets
```
LLPs use "Capital Contribution" not "Capital Account".  LLPs also have a concept
of profit sharing that looks like partners' accounts but is legally different.

### Private Limited Company
```
Primary Groups:
  Share Capital                (BS Cr — Equity Share Capital, Preference Share Capital)
  Reserves & Surplus           (BS Cr — General Reserve, Retained Earnings, etc.)
  Long-Term Borrowings         (BS Cr — Term Loans, Debentures)
  Short-Term Borrowings        (BS Cr — CC Limit, Working Capital Loan)
  Trade Payables               (BS Cr — Sundry Creditors)
  Other Current Liabilities    (BS Cr — Outstanding Expenses, Advance from Customers)
  Fixed Assets / Tangible Assets / Intangible Assets (BS Dr)
  Long-Term Investments        (BS Dr)
  Inventories                  (BS Dr)
  Trade Receivables            (BS Dr — Sundry Debtors)
  Cash and Cash Equivalents    (BS Dr)
  Short-Term Loans and Advances (BS Dr)
  Revenue from Operations      (PL Cr — Sales)
  Other Income                 (PL Cr)
  Cost of Materials Consumed   (PL Dr)
  Changes in Inventories       (PL Dr — Opening/Closing Stock)
  Employee Benefit Expenses    (PL Dr)
  Finance Costs                (PL Dr)
  Depreciation & Amortisation  (PL Dr)
  Other Expenses               (PL Dr)
```
Companies follow Schedule III of the Companies Act 2013, which prescribes exact
line-item names.  Tally's default company template maps these names to the
Tally group structure.

### HUF (Hindu Undivided Family)
```
  Capital Account              (Karta's capital — similar to proprietorship)
  Co-Parceners' Accounts       (similar to Partners' Current Account)
```
HUF has an unusual structure where the Karta (head) and co-parceners each have
capital accounts, but unlike a partnership there is a concept of "joint property"
that does not fit the standard liability model.

### Trust
```
  Corpus Fund / Endowment Fund  (BS Cr — instead of capital)
  Designated Funds              (BS Cr — restricted grants, etc.)
  Income & Expenditure Account  (replaces Profit & Loss)
```
Trusts do not have a "Profit and Loss" account — they have an "Income &
Expenditure" account.  Some ledger names are unique to trusts (Corpus, Endowment,
Grant Received).

### Why this breaks the current importer

The keyword list in `tb-hierarchy.ts` and `parse-tally-tb/index.ts` treats
"Capital Account" as always BS Liability.  That works for proprietorship and
partnership, but:
- A private limited company importing a TB where the accountant named the share
  capital ledger "Capital Account" (a common mistake in small Tally setups) gets
  it classified correctly by coincidence.
- But "Designated Partners' Capital Contribution" does not match any keyword,
  so LLP capital is classified as "unknown" and lands in the wrong section.

The sum-match algorithm does not know that a partnership TB will always have
multiple sub-ledgers named "Partner Name — Capital" under "Partners' Capital
Account".  It treats them as a coincidental numeric sum and sometimes gets the
parent wrong, putting one partner's capital under another partner's current account.

---

## N.3 — New architecture proposal

### Core principle: use Tally's own structural data

For XML imports, Tally already provides a complete and correct hierarchy.  The new
architecture reads it directly instead of reconstructing it.

### Architecture overview

```
 ┌─────────────────────────────────────────────────────────┐
 │  1. PARSE (Edge Function: parse-tally-tb)               │
 │     • Detect source: XML or Excel                       │
 │     • XML path: read DSPACCNAMELEVEL + DSPACCACCISLEAF  │
 │     • Excel path: read bold + indent hints              │
 │     • Store raw rows in tb_import_rows_raw              │
 │       (immutable; includes xmlLevel, xmlIsLeaf)         │
 └────────────────────┬────────────────────────────────────┘
                      │ raw rows
 ┌────────────────────▼────────────────────────────────────┐
 │  2. RESOLVE (resolveHierarchy function)                 │
 │     • XML: build tree from level numbers directly       │
 │     • Excel: sum-match heuristic (existing logic)       │
 │     • Apply manual overrides (tb_manual_overrides)      │
 │     • Detect sign convention, invert Dr-normal leaves   │
 │     • Classify section using constitution vocabulary    │
 │     • Store resolved rows in tb_import_rows_resolved    │
 └────────────────────┬────────────────────────────────────┘
                      │ resolved rows + confidence scores
 ┌────────────────────▼────────────────────────────────────┐
 │  3. VALIDATE (ValidationEngine)                         │
 │     • BS balance check (Assets = Liabilities + Capital) │
 │     • Orphan check (every node has a valid parent)      │
 │     • Duplicate name check                              │
 │     • Group sum check (parent total = sum of children)  │
 │     • Low-confidence node flagging                      │
 │     • Constitution profile consistency check            │
 │     • Store issues in tb_validation_issues              │
 └────────────────────┬────────────────────────────────────┘
                      │ issues list
 ┌────────────────────▼────────────────────────────────────┐
 │  4. AI REVIEW (optional, triggered by errors/warnings)  │
 │     • For each uncertain/misclassified node:            │
 │       - send name + hierarchyPath + section to AI       │
 │       - store suggestion in tb_ai_suggestions           │
 │     • UI shows suggestions in a review panel            │
 │     • User can Accept (→ creates override) or Reject    │
 └────────────────────┬────────────────────────────────────┘
                      │ accepted suggestions → overrides
 ┌────────────────────▼────────────────────────────────────┐
 │  5. MANUAL OVERRIDE UI                                  │
 │     • User can drag-drop a ledger to a different parent │
 │     • User can reassign section / normalBal             │
 │     • Override stored in tb_manual_overrides            │
 │     • Re-import re-applies all locked overrides         │
 └────────────────────┬────────────────────────────────────┘
                      │ final overrides applied
 ┌────────────────────▼────────────────────────────────────┐
 │  6. PUBLISH (gated on zero validation errors)           │
 │     • Creates tb_publish_snapshots record               │
 │     • Snapshot includes resolved rows + summary         │
 │     • Downstream audit uses snapshot, not live rows     │
 └─────────────────────────────────────────────────────────┘
```

### What changes in the database

New tables (see `supabase/migrations/20260404100000_tb_refactor_hierarchy.sql`):
- `tb_import_rows_raw` — immutable raw rows with XML hints
- `tb_import_rows_resolved` — hierarchy-resolved, sign-corrected, classified
- `tb_manual_overrides` — user corrections (persisted across re-imports)
- `tb_ai_suggestions` — AI advisory suggestions
- `tb_validation_issues` — per-import validation findings
- `tb_constitution_profiles` — detected constitution per engagement
- `tb_publish_snapshots` — final published TB snapshots

Existing table `tb_hierarchy_nodes` is unchanged for backwards compatibility.
The new pipeline writes to the new tables.  The existing pipeline (PipelineStage2)
continues to read from `tb_hierarchy_nodes` via its existing queries.
Migration to the new tables happens in a second phase once the new pipeline is stable.

### What changes in the code

| File | Change |
|------|--------|
| `supabase/functions/parse-tally-tb/index.ts` | Read DSPACCNAMELEVEL + DSPACCACCISLEAF; detect source type; write to `tb_import_rows_raw` |
| `src/lib/tb-types.ts` | New — all interfaces for the refactored system |
| `src/lib/tb-hierarchy-resolver.ts` | New — pure function that builds hierarchy from raw rows using the correct strategy per source type |
| `src/lib/tb-sign-corrector.ts` | New — isolated sign-correction logic; no longer scattered across three files |
| `src/lib/tb-validation-engine.ts` | New — all validation rules in one place |
| `src/lib/tb-constitution-detector.ts` | New — constitution detection from primary group vocabulary |
| `src/components/pipeline/TbReviewPanel.tsx` | New — AI suggestion review UI |
| `src/components/pipeline/TbOverridePanel.tsx` | New — manual override UI |
| `src/components/pipeline/PipelineStage2.tsx` | Remove Pass 3 sign-correction blocks; use new resolver output |
| `src/lib/tb-hierarchy.ts` | Remove `rebuildHierarchy`; keep presentation model builder |
