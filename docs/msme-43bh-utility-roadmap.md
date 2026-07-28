# MSME 43B(h) Analyser — Opinion, Design & As-Built

_Utility to auto-decide allowance / disallowance of sums payable to micro & small
enterprises under **Section 43B(h)**, Income Tax Act 1961, by evaluating two years
of vendor ledgers._

---

## 1. Legal basis

| Item | Position |
|------|----------|
| **Provision** | Section **43B(h)**, inserted by Finance Act 2023 |
| **Effective** | **AY 2024-25** (FY 2023-24) onwards |
| **Effect** | Sum payable to a **micro/small** enterprise not paid within the s.15 MSMED-Act time limit is disallowed in the year of accrual, allowed only in the year of **actual payment** |
| **Catch** | The first proviso to s.43B ("paid before ITR due date") does **not** apply to (h). Only the 15/45-day window counts. |

**Section 15, MSMED Act 2006 — time limit:** with a written agreement → as agreed,
capped at **45 days**; without → **15 days**, from the day of acceptance.

**Scope decisions (all configurable):** micro & small only (medium excluded);
MSME status is **not** determined by this tool — employees upload only the ledgers
of registered micro/small vendors; disallowance base is **net of TDS**.

## 2. Why two years are required

The disallowance on a bill outstanding at 31-March depends on **when it is actually
settled**, which for a 45-day window frequently happens in April of the following
year. Per CY bill:

```
due_date = bill_date + window(15|45)
outstanding@31-Mar not cleared within due_date  →  disallowed in CY
   … of which paid (cash) during FY after due_date  →  allowed in FY
   … still unpaid at FY end                          →  outstanding
```

Non-cash reductions (TDS, credit/debit notes, kasar/vatav, round-off) are compliant
and netted out of the base — never a delayed-payment concern.

## 3. Terminology handling

Clients use varied trade terms (kasar, vatav, vatti, discount, rebate, round-off,
write-off, rate diff, debit note, TDS…). A configurable **synonym dictionary**
(`config.ts`) classifies each entry deterministically; the matched keyword is the
audit reason. Low-confidence debits are flagged for review.

## 4. Architecture (as built)

In-browser (PDF ledgers never leave the client). Pure, environment-agnostic
parsing functions validated against real data in a Node harness.

```
2 PDFs/vendor (CY + FY)
  → pdfText          positioned text → physical lines (pdfjs-dist)
  → detectFormat     Tally | Expert
  → parseTally / parseExpert   canonical VendorLedger  (self-check: reconstructed
                               running balance == printed closing balance)
  → classify         settlement type per txn (synonym dictionary)
  → engine           FIFO matcher + two-year 43B(h) computation
  → exportExcel      workpaper + Form 3CD Clause 26 hook
  → Msme43b.tsx      upload, drilldown, exceptions, export
```

| File | Role |
|------|------|
| `src/lib/msme43b/types.ts` | Canonical data model |
| `src/lib/msme43b/config.ts` | Legal ruleset + synonym dictionary (Phase 0) |
| `src/lib/msme43b/pdfText.ts` | pdfjs-dist wrapper + line reconstruction |
| `src/lib/msme43b/parseTally.ts` | Tally detailed-ledger parser (position-based) |
| `src/lib/msme43b/parseExpert.ts` | Expert fixed-width parser (multi-ledger split) |
| `src/lib/msme43b/classify.ts` | Settlement-type classifier |
| `src/lib/msme43b/engine.ts` | FIFO matcher + 43B(h) engine |
| `src/lib/msme43b/exportExcel.ts` | Excel workpaper + Form 3CD hook |
| `src/pages/Msme43b.tsx` | UI (route `/msme-43b`, sidebar → Utilities) |

## 5. Validation

- **Parsers:** every one of the 35 sample ledgers (37 ledger sections incl.
  multi-vendor files) reconstructs to its **printed closing balance with zero
  drift**, across both Tally and Expert formats, with cross-year continuity
  (CY closing == FY opening) holding.
- **Engine:** 9 deterministic unit tests (`engine.test.ts`) cover within-window
  (nil), late-FY (disallow + re-allow), unpaid (outstanding), TDS net-out,
  kasar compliance, FIFO opening-first, missing-FY, and continuity breaks.

## 6. Matching assumption

The sample exports carry **no bill-wise references**, so settlements are matched
**FIFO** (oldest open bill first) — the defensible default, disclosed on the
workpaper. If a client ever prints bill-wise (Agst Ref) ledgers, explicit linkage
can be slotted into the matcher without touching the engine.

## 7. Form 3CD

The 43B(h) **principal** disallowance is reported under **Clause 26** (sums covered
by s.43B). Clause 22 covers only MSMED-Act s.23 **interest**, which this tool does
not compute (out of scope).

## 8. Roadmap status

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Config + legal ruleset | ✅ |
| 1 | Tally + Expert PDF ingestion | ✅ |
| 2 | Terminology classifier | ✅ |
| 3 | FIFO settlement matcher | ✅ |
| 4 | Two-year 43B(h) computation | ✅ |
| 5 | React UI (upload, drilldown, exceptions) | ✅ |
| 6 | Excel workpaper + Form 3CD Clause 26 hook | ✅ |
| 7 | Intelligence (LLM narration classifier, anomaly detection, YoY carry-forward, batch) | Future |

### Future (Phase 7) ideas
- Optional LLM classifier for ambiguous narrations, human-in-loop.
- Persist runs to Supabase; batch multiple clients.
- Automatic carry-forward of CY-disallowed → FY-allowed across successive audits.
