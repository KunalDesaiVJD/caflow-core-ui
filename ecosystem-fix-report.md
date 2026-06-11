# Ecosystem-wide NCE Data Fix Report — FINAL

- Generated: 2026-06-11T09:46:52.216Z
- Active engagements scanned: **37**
- Note types in scope: **17** (cogs excluded — structural; capital/PPE/intangibles out of scope)

## Pattern A–F summary (Patterns A-F applied via ecosystem_fix.mjs)

Note: Patterns B and C produced patches in 6 cells, but simulation showed only 2 strictly reduced drift; the rest were skipped per the defensive-skip rule.

| Pattern | Description | Cells touched | Notes |
|---|---|---:|---|
| **A** | Detach children of source-parents (Swastik Site Expense) | 0 | No drifted cell matched the pattern this pass |
| **B** | Negate Kasar/round-off on DR-natural notes where TB is Cr | 1 | Applied to 1 cell (REVTI other_expenses) |
| **C** | Negate Dr-contra on CR-natural notes | 1 | Applied to 1 cell (SKYLARK trade_payables) |
| **D** | LT/ST 2× duplication | 0 | No cell had both _lt and _st keys with same value |
| **E** | Standalone duplicate of sourced ledger | 0 | None matched |
| **F** | Stale PY values for ledgers absent from CY TB | 0 | None matched (no clear stale candidates) |
| **G** | Synthesize missing TB-mapped ledger rows | 139 | Applied via ecosystem_pattern_g.mjs + ecosystem_full_g.mjs |

## Pattern G — per-cell ledger additions

| Client | Note | Rows added | Σ CY | Σ PY |
|---|---|---:|---:|---:|
| AMBER GUM INDUSTRIES | borrowings | 7 | 5,05,03,398 | 5,35,53,123 |
| AMBER GUM INDUSTRIES | provisions | 4 | 62,862 | 48,548 |
| AMBER GUM INDUSTRIES | trade_payables | 73 | 5,72,06,635 | 2,22,48,180 |
| AMBER GUM INDUSTRIES | other_cl | 24 | 3,97,68,478 | 55,24,242 |
| AMBER GUM INDUSTRIES | inventories | 3 | 1,57,77,705 | 39,30,238 |
| AMBER GUM INDUSTRIES | trade_receivables | 63 | 11,36,51,961 | 6,85,32,604 |
| AMBER GUM INDUSTRIES | cash_bank | 3 | 2,42,02,380 | 2,76,09,224 |
| AMBER GUM INDUSTRIES | other_ca | 12 | 1,01,74,087 | 27,05,423 |
| SATVA BUILDCON | provisions | 3 | 0 | 1,72,875 |
| SKYLARK CORPORATION | other_cl | 132 | 13,43,23,500 | 25,30,57,609 |
| ACCU PANELS ENERGY PVT LTD | borrowings | 10 | 8,05,58,652 | 4,64,50,627 |
| ACCU PANELS ENERGY PVT LTD | other_lt_liab | 1 | 1,79,416 | 1,79,416 |
| ACCU PANELS ENERGY PVT LTD | provisions | 102 | 2,20,31,166 | 72,16,152 |
| ACCU PANELS ENERGY PVT LTD | trade_payables | 140 | 8,93,07,563 | 5,89,02,591 |
| ACCU PANELS ENERGY PVT LTD | other_cl | 8 | 53,000 | 56,000 |
| ACCU PANELS ENERGY PVT LTD | investments | 3 | 90,38,824 | 52,28,279 |
| ACCU PANELS ENERGY PVT LTD | loans_advances | 36 | 2,31,23,231 | 18,67,250 |
| ACCU PANELS ENERGY PVT LTD | inventories | 3 | 7,50,91,295 | 4,68,58,898 |
| ACCU PANELS ENERGY PVT LTD | trade_receivables | 75 | 4,93,56,431 | 4,87,14,563 |
| ACCU PANELS ENERGY PVT LTD | cash_bank | 4 | 31,57,761 | 29,56,887 |
| ACCU PANELS ENERGY PVT LTD | revenue_ops | 15 | 48,94,62,412 | 37,69,05,172 |
| ACCU PANELS ENERGY PVT LTD | other_income | 5 | 18,52,759 | 10,24,651 |
| ACCU PANELS ENERGY PVT LTD | employee_exp | 19 | 3,89,00,893 | 2,34,12,242 |
| ACCU PANELS ENERGY PVT LTD | finance_costs | 5 | 49,86,691 | 33,44,886 |
| ACCU PANELS ENERGY PVT LTD | other_expenses | 64 | 2,41,03,779 | 1,88,10,653 |
| AMBER DYE TRADE PRIVATE LIMITED | borrowings | 2 | 19,32,197 | 19,32,197 |
| AMBER DYE TRADE PRIVATE LIMITED | provisions | 9 | 4,62,650 | 4,66,760 |
| AMBER DYE TRADE PRIVATE LIMITED | trade_payables | 4 | -426 | -93,364 |
| AMBER DYE TRADE PRIVATE LIMITED | loans_advances | 8 | 7,72,984 | 7,61,631 |
| AMBER DYE TRADE PRIVATE LIMITED | other_nc_assets | 2 | -15,67,349 | -15,67,349 |
| AMBER DYE TRADE PRIVATE LIMITED | trade_receivables | 4 | -82,977 | 9,56,184 |
| AMBER DYE TRADE PRIVATE LIMITED | cash_bank | 5 | 1,07,51,627 | 1,01,52,908 |
| AMBER DYE TRADE PRIVATE LIMITED | other_ca | 3 | 59,848 | 77,929 |
| AMBER DYE TRADE PRIVATE LIMITED | revenue_ops | 5 | 47,92,795 | 3,01,54,550 |
| AMBER DYE TRADE PRIVATE LIMITED | other_income | 6 | 6,50,968 | 3,87,818 |
| AMBER DYE TRADE PRIVATE LIMITED | employee_exp | 2 | 10,21,000 | 10,65,400 |
| AMBER DYE TRADE PRIVATE LIMITED | other_expenses | 28 | 4,25,761 | 9,07,644 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | borrowings | 1 | 10,800 | 10,800 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | provisions | 1 | 11,210 | 11,210 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | trade_payables | 1 | 10,800 | 10,800 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | trade_receivables | 1 | 2,30,000 | 2,30,000 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | cash_bank | 2 | 5,74,287 | 6,01,135 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | other_expenses | 5 | 26,848 | 22,423 |
| BRICKSTONE INFRA | borrowings | 7 | 2,03,73,861 | 1,85,00,001 |
| BRICKSTONE INFRA | provisions | 1 | 35,000 | 35,000 |
| BRICKSTONE INFRA | trade_payables | 28 | 1,52,51,789 | 87,09,740 |
| BRICKSTONE INFRA | other_cl | 5 | 45,455 | 3,39,327 |
| BRICKSTONE INFRA | investments | 6 | 2,87,622 | 10,10,939 |
| BRICKSTONE INFRA | loans_advances | 1 | 0 | 2,50,000 |
| BRICKSTONE INFRA | inventories | 1 | 6,35,71,835 | 6,35,71,835 |
| BRICKSTONE INFRA | trade_receivables | 1 | 5,48,67,782 | -2,37,17,867 |
| BRICKSTONE INFRA | cash_bank | 2 | 13,33,792 | 4,40,405 |
| BRICKSTONE INFRA | other_ca | 13 | 31,23,400 | 59,05,007 |
| BRICKSTONE INFRA | revenue_ops | 1 | 10,33,92,800 | 11,35,92,975 |
| BRICKSTONE INFRA | other_income | 2 | 7,115 | 67,388 |
| BRICKSTONE INFRA | employee_exp | 2 | 2,64,000 | 3,67,237 |
| BRICKSTONE INFRA | finance_costs | 3 | 11,61,327 | 10,29,806 |
| BRICKSTONE INFRA | other_expenses | 22 | 2,17,04,265 | 6,03,07,980 |
| CROWNGLOBE PRIVATE LIMITED | provisions | 1 | 5,000 | 5,000 |
| CROWNGLOBE PRIVATE LIMITED | trade_payables | 6 | 2,02,322 | 57,626 |
| CROWNGLOBE PRIVATE LIMITED | other_cl | 10 | 10,51,875 | 11,05,712 |
| CROWNGLOBE PRIVATE LIMITED | loans_advances | 6 | 7,772 | 1,61,087 |
| CROWNGLOBE PRIVATE LIMITED | trade_receivables | 1 | 6,86,720 | 4,53,581 |
| CROWNGLOBE PRIVATE LIMITED | cash_bank | 2 | 1,48,709 | 2,85,020 |
| CROWNGLOBE PRIVATE LIMITED | other_ca | 10 | 1,57,749 | 4,738 |
| CROWNGLOBE PRIVATE LIMITED | other_income | 3 | 36,18,766 | 34,53,142 |
| CROWNGLOBE PRIVATE LIMITED | employee_exp | 9 | -1,76,092 | -89,463 |
| CROWNGLOBE PRIVATE LIMITED | other_expenses | 44 | 33,72,339 | 36,93,566 |
| GROWQ PRIVATE LIMITED | other_lt_liab | 3 | 15,72,016 | 15,72,016 |
| GROWQ PRIVATE LIMITED | provisions | 47 | 39,89,921 | 92,254 |
| GROWQ PRIVATE LIMITED | trade_payables | 24 | 3,79,985 | 29,02,205 |
| GROWQ PRIVATE LIMITED | other_cl | 14 | -10,55,137 | -21,41,631 |
| GROWQ PRIVATE LIMITED | trade_receivables | 8 | 54,71,757 | 47,90,255 |
| GROWQ PRIVATE LIMITED | other_ca | 10 | 83,70,495 | 46,20,086 |
| GROWQ PRIVATE LIMITED | revenue_ops | 2 | 5,09,01,652 | 0 |
| GROWQ PRIVATE LIMITED | other_income | 2 | -4,149 | 0 |
| GROWQ PRIVATE LIMITED | employee_exp | 4 | 3,92,57,658 | 0 |
| GROWQ PRIVATE LIMITED | other_expenses | 58 | 94,27,085 | 0 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | provisions | 3 | 1,80,000 | 2,44,000 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | trade_payables | 10 | 3,90,333 | 4,19,934 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | other_cl | 38 | 4,52,748 | 5,17,257 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | loans_advances | 2 | 9,84,000 | 9,84,000 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | other_nc_assets | 1 | 9,030 | 10,644 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | trade_receivables | 1 | 18,56,085 | 12,83,721 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | cash_bank | 2 | 42,19,803 | 45,61,197 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | other_ca | 10 | 7,79,061 | 8,13,158 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | revenue_ops | 2 | 1,76,41,331 | 2,08,19,525 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | other_income | 2 | 7,948 | 3,490 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | employee_exp | 7 | 1,28,75,323 | 1,49,29,950 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | finance_costs | 4 | 82,697 | 61,836 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | other_expenses | 35 | 40,30,340 | 49,00,501 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | borrowings | 1 | 10,800 | 10,800 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | provisions | 1 | 11,210 | 11,210 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | trade_payables | 1 | 10,800 | 10,800 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | cash_bank | 2 | 7,88,037 | 8,10,342 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | other_expenses | 4 | 22,305 | 22,423 |
| MICROCIRCUITS INNOVATIONS PRIVATE LIMITED | trade_payables | 9 | 1,55,107 | 4,480 |
| MICROCIRCUITS INNOVATIONS PRIVATE LIMITED | revenue_ops | 2 | 3,12,43,909 | 4,76,29,504 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | borrowings | 3 | 28,69,341 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | provisions | 3 | 77,146 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | trade_payables | 45 | 24,93,821 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | other_cl | 4 | 3,50,281 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | investments | 1 | 6,11,869 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | loans_advances | 3 | 8,07,887 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | trade_receivables | 8 | 1,50,057 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | cash_bank | 2 | 11,16,208 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | other_ca | 1 | 82,000 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | revenue_ops | 6 | 94,61,075 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | other_income | 3 | 2,44,916 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | employee_exp | 2 | 15,18,639 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | finance_costs | 1 | 1,474 | 0 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | other_expenses | 44 | 34,08,289 | 0 |
| PRINCESS GEMS EXPORTS LIMITED | borrowings | 2 | 2,63,000 | 2,63,000 |
| PRINCESS GEMS EXPORTS LIMITED | provisions | 2 | 10,900 | 10,900 |
| PRINCESS GEMS EXPORTS LIMITED | other_cl | 1 | 90,800 | 67,000 |
| PRINCESS GEMS EXPORTS LIMITED | investments | 2 | 20,000 | 20,000 |
| PRINCESS GEMS EXPORTS LIMITED | cash_bank | 2 | 24,539 | 25,188 |
| PRINCESS GEMS EXPORTS LIMITED | other_expenses | 5 | 24,449 | 24,449 |
| SIX VISION SOFTWARE PRIVATE LIMITED | provisions | 4 | 1,29,673 | 0 |
| SIX VISION SOFTWARE PRIVATE LIMITED | trade_payables | 2 | 19,123 | 0 |
| SIX VISION SOFTWARE PRIVATE LIMITED | other_cl | 1 | 1,00,000 | 0 |
| SIX VISION SOFTWARE PRIVATE LIMITED | trade_receivables | 1 | 9,000 | 0 |
| SIX VISION SOFTWARE PRIVATE LIMITED | cash_bank | 2 | 3,84,365 | 0 |
| SIX VISION SOFTWARE PRIVATE LIMITED | other_ca | 1 | 47,584 | 0 |
| SIX VISION SOFTWARE PRIVATE LIMITED | revenue_ops | 6 | 14,54,396 | 0 |
| SIX VISION SOFTWARE PRIVATE LIMITED | employee_exp | 2 | 12,38,970 | 0 |
| SIX VISION SOFTWARE PRIVATE LIMITED | other_expenses | 8 | 1,23,273 | 0 |
| SWADESHI COSMETICS PRIVATE LIMITED | borrowings | 3 | 2,01,500 | 2,01,500 |
| SWADESHI COSMETICS PRIVATE LIMITED | provisions | 2 | 10,900 | 10,900 |
| SWADESHI COSMETICS PRIVATE LIMITED | other_cl | 1 | 39,200 | 26,800 |
| SWADESHI COSMETICS PRIVATE LIMITED | cash_bank | 3 | 18,963 | 18,963 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | provisions | 2 | 10,900 | 10,900 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | other_cl | 1 | 10,900 | 0 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | loans_advances | 1 | 15,000 | 15,000 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | trade_receivables | 1 | 12,47,148 | 12,47,148 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | cash_bank | 2 | 2,25,951 | 2,27,600 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | other_expenses | 4 | 12,549 | 0 |
| SWADESHI LABORATORIES PRIVATE LIMITED | other_expenses | 4 | 493 | 13,049 |
| SWENI CORPORATION | trade_payables | 2 | 4,99,896 | 4,99,896 |

## Final verification — cells still drifting (excl cogs)

| Client | FY | Note | Section | COA CY | Note CY | CY Drift | COA PY | Note PY | PY Drift |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| MAHARSH INFRA | 2025-26 | borrowings | BS-Liab | 3,89,11,987 | 3,89,11,987 | 0 | -59,91,743 | 3,04,24,831 | -3,64,16,574 |
| MAHARSH INFRA | 2025-26 | loans_advances | BS-Asst | 10,55,92,088 | 10,55,92,088 | 0 | 5,18,66,109 | 5,42,66,109 | -24,00,000 |
| MAHIL INFRA | 2025-26 | borrowings | BS-Liab | 9,53,28,844 | 9,53,28,844 | 0 | 10,42,46,598 | 10,82,96,848 | -40,50,250 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | other_expenses | PL-Exp | 25,55,584 | 25,55,584 | 0 | 37,21,511 | 34,92,180 | 2,29,331 |
| REVTI INFRA | 2025-26 | loans_advances | BS-Asst | 7,54,83,871 | 7,54,83,871 | 0 | 3,04,84,638 | 3,99,22,312 | -94,37,674 |
| SKYLARK CORPORATION | 2025-26 | other_expenses | PL-Exp | 6,58,49,271 | 6,58,49,271 | 0 | 2,93,73,677 | 2,93,98,526 | -24,849 |

## Balance Sheet balance check (notes only — capital + PPE excluded from this scope)

Each row shows the algebraic sum of in-scope asset notes minus liability notes. The TRUE BS balance also requires capital + PPE + intangibles + retained earnings, which are out of scope for this pass. A "balanced" cell here means asset notes and liability notes reconcile against COA — not that the full BS balances.

| Client | FY | CY Asset notes Σ | CY Liab notes Σ | PY Asset Σ | PY Liab Σ |
|---|---|---:|---:|---:|---:|
| ACCU PANELS ENERGY PVT LTD | 2025-26 | 15,97,67,543 | 19,21,29,796 | 10,56,25,877 | 11,28,04,786 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | 99,34,133 | 23,94,421 | 1,03,81,303 | 23,05,593 |
| AMBER GUM INDUSTRIES | 2025-26 | 16,38,06,133 | 14,75,41,373 | 10,27,77,489 | 8,13,74,092 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | 2025-26 | 8,04,287 | 32,810 | 8,31,135 | 32,810 |
| BAPASITARAM DEVELOPERS | 2025-26 | 9,66,33,004 | 57,37,797 | 7,83,83,684 | 11,76,284 |
| BHAKTI INFRA | 2025-26 | 9,62,55,813 | 7,95,48,987 | 15,69,30,599 | 16,52,36,553 |
| BRICKSTONE INFRA | 2025-26 | 12,31,84,430 | 3,57,06,105 | 4,74,60,319 | 2,75,84,068 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | 10,00,949 | 12,59,196 | 9,04,427 | 11,68,338 |
| DBS REALTY | 2025-26 | 30,94,65,053 | 15,01,48,123 | 29,22,50,220 | 19,29,89,419 |
| DHANANI REALTY | 2025-26 | 4,76,40,686 | 3,88,95,663 | 20,33,14,980 | 27,04,24,507 |
| GROWQ PRIVATE LIMITED | 2025-26 | 1,38,42,252 | 48,86,784 | 94,10,341 | 24,24,844 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | 78,47,979 | 10,23,081 | 76,52,720 | 11,81,192 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | 2025-26 | 7,88,037 | 32,810 | 8,10,342 | 32,810 |
| MAHARSH INFRA | 2025-26 | 18,83,44,984 | 18,14,33,195 | 12,54,48,613 | 16,52,81,067 |
| MAHIL INFRA | 2025-26 | 18,91,66,181 | 12,62,54,951 | 22,10,72,765 | 14,79,64,601 |
| MICROCIRCUITS INNOVATIONS PRIVATE LIMITED | 2025-26 | 0 | 1,55,107 | 0 | 4,480 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | 1,29,65,709 | 25,69,408 | 1,05,21,505 | 16,57,170 |
| OM REALTY | 2025-26 | 7,60,61,519 | 93,07,607 | 14,21,32,811 | 6,95,39,247 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | 27,68,022 | 57,90,589 | 0 | 0 |
| PRINCESS GEMS EXPORTS LIMITED | 2025-26 | 44,539 | 3,64,700 | 45,188 | 3,40,900 |
| REVTI INFRA | 2025-26 | 38,04,35,532 | 34,84,17,819 | 31,27,53,827 | 28,79,69,413 |
| SALIENT INFRATECH | 2025-26 | 23,62,70,545 | 16,29,51,213 | 15,91,20,666 | 8,93,42,266 |
| SATVA BUILDCON | 2025-26 | 5,87,62,499 | -23,89,595 | 13,02,72,280 | 6,80,63,552 |
| SHIVASHRAY DEVELOPERS | 2025-26 | 14,41,54,755 | 8,49,79,208 | 9,45,03,242 | 3,90,83,499 |
| SHREE HARI INFRA | 2025-26 | 48,88,40,377 | 44,13,29,800 | 52,46,99,037 | 48,81,81,024 |
| SHREE MARUTI INFRA | 2025-26 | 4,39,59,424 | 2,51,42,252 | 5,37,84,316 | 3,34,27,751 |
| SHREEYAM INFRA | 2025-26 | 17,31,07,136 | 2,21,53,352 | 27,73,81,693 | 1,84,34,470 |
| SHRI RAM PRODUCTS | 2025-26 | 2,23,04,302 | 1,01,38,646 | 1,98,08,774 | 99,78,844 |
| SHUBHAM BUILDCON | 2025-26 | 11,32,61,077 | 4,61,68,425 | 8,72,63,459 | 2,39,85,858 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | 4,40,949 | 2,48,796 | 0 | 0 |
| SKYLARK CORPORATION | 2025-26 | 41,66,69,258 | 32,88,62,906 | 31,60,96,566 | 23,52,02,273 |
| SUKIRTI DEVELOPERS | 2025-26 | -13,56,17,937 | -11,65,47,865 | 9,96,84,994 | -8,95,69,049 |
| SWADESHI COSMETICS PRIVATE LIMITED | 2025-26 | 18,963 | 2,51,600 | 18,963 | 2,39,200 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | 2025-26 | 14,88,099 | 21,800 | 14,89,748 | 10,900 |
| SWADESHI LABORATORIES PRIVATE LIMITED | 2025-26 | 0 | 0 | 0 | 0 |
| SWASTIK BUILDCON | 2025-26 | 7,68,82,441 | 5,67,49,413 | 8,01,18,716 | 4,74,52,047 |
| SWENI CORPORATION | 2025-26 | 0 | 4,99,896 | 0 | 4,99,896 |

## Unresolved drift items for human review

- **MAHARSH INFRA / borrowings** (complex LT/ST or contra): cyDrift=0, pyDrift=-3,64,16,574
- **MAHARSH INFRA / loans_advances** (complex LT/ST or contra): cyDrift=0, pyDrift=-24,00,000
- **MAHIL INFRA / borrowings** (complex LT/ST or contra): cyDrift=0, pyDrift=-40,50,250
- **NIRALI PERFUMERY PRODUCTS / other_expenses** (uncategorized): cyDrift=0, pyDrift=2,29,331
- **REVTI INFRA / loans_advances** (complex LT/ST or contra): cyDrift=0, pyDrift=-94,37,674
- **SKYLARK CORPORATION / other_expenses** (small rounding): cyDrift=0, pyDrift=-24,849

---
*End of report.*