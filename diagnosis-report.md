# NCE Notes vs COA Mapping â€” Comprehensive Diagnosis (READ-ONLY)

- Generated: 2026-06-10T20:50:34.177Z
- Engagements (CY active, with COA mapping): **36**
- Note types analysed: **19**
- Total cells: **684** (= engagements Ã— note types)
- OK cells: **339**
- Drift cells (>â‚¹1): **41**
- Missing-note cells (with COA balances): **133**
- Missing-note cells (no COA balances either â€” benign): 171

## Pattern legend

| Pattern | Meaning |
|---|---|
| **P1** | Sign error (Cr-balance contra on DR-natural / Dr-balance contra on CR-natural) |
| **P2** | Missing ledger â€” TB has it, note doesn't represent it |
| **P3** | Stale ledger â€” note has a row whose source ledger doesn't match any TB ledger |
| **P4** | PY-shell-only â€” PY note has a value for a ledger absent from CY TB or PY TB |
| **P5** | Note empty / absent â€” row missing or all zeros despite COA having values |
| **P6** | Pre-fix double-count â€” parent-child source overlap, row zeroed by guard |
| **P7** | Other â€” manual review |

## Per-client summary

Counts only DRIFT and no_note cells. Total absolute drift = Î£(|CY drift| + |PY drift|).

| Client | FY | Drift cells | Î£ |drift| |
|---|---|---:|---:|
| ACCU PANELS ENERGY PVT LTD | 2025-26 | 16 | 2,31,10,64,573 |
| SHREE HARI INFRA | 2025-26 | 1 | 1,94,36,83,600 |
| SKYLARK CORPORATION | 2025-26 | 4 | 1,63,74,31,440 |
| SUKIRTI DEVELOPERS | 2025-26 | 3 | 1,40,68,02,515 |
| REVTI INFRA | 2025-26 | 3 | 1,21,85,08,618 |
| SHREEYAM INFRA | 2025-26 | 4 | 1,18,36,80,928 |
| DBS REALTY | 2025-26 | 1 | 1,06,59,47,447 |
| MAHIL INFRA | 2025-26 | 3 | 66,97,04,736 |
| BRICKSTONE INFRA | 2025-26 | 16 | 66,84,26,303 |
| SALIENT INFRATECH | 2025-26 | 1 | 62,38,26,289 |
| OM REALTY | 2025-26 | 1 | 52,25,95,000 |
| SATVA BUILDCON | 2025-26 | 2 | 40,88,28,415 |
| DHANANI REALTY | 2025-26 | 1 | 38,30,44,063 |
| SHIVASHRAY DEVELOPERS | 2025-26 | 1 | 32,92,05,398 |
| BAPASITARAM DEVELOPERS | 2025-26 | 1 | 30,96,49,809 |
| SWASTIK BUILDCON | 2025-26 | 2 | 28,67,25,838 |
| SHUBHAM BUILDCON | 2025-26 | 1 | 28,26,25,790 |
| MAHARSH INFRA | 2025-26 | 4 | 24,00,77,340 |
| BHAKTI INFRA | 2025-26 | 2 | 21,44,14,439 |
| GROWQ PRIVATE LIMITED | 2025-26 | 10 | 13,65,48,303 |
| SHREE MARUTI INFRA | 2025-26 | 1 | 12,65,53,000 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | 13 | 10,43,46,316 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | 13 | 9,30,57,914 |
| MICROCIRCUITS INNOVATIONS PRIVATE LIMITED | 2025-26 | 2 | 7,90,33,000 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | 4 | 2,49,02,999 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | 14 | 2,31,93,004 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | 10 | 1,87,36,279 |
| SHRI RAM PRODUCTS | 2025-26 | 1 | 60,37,548 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | 9 | 35,06,384 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | 2025-26 | 6 | 30,23,096 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | 2025-26 | 6 | 17,50,314 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | 2025-26 | 5 | 17,08,728 |
| SWENI CORPORATION | 2025-26 | 1 | 9,99,792 |
| PRINCESS GEMS EXPORTS LIMITED | 2025-26 | 6 | 8,44,225 |
| SWADESHI COSMETICS PRIVATE LIMITED | 2025-26 | 5 | 5,41,126 |
| SWADESHI LABORATORIES PRIVATE LIMITED | 2025-26 | 1 | 13,542 |

Engagements with **0** drift cells: 0

## Per-note summary

| Note | Drift cells | Î£ |drift| | Dominant patterns |
|---|---:|---:|---|
| borrowings | 14 | 85,38,68,712 | P5(8), P7(6) |
| other_lt_liab | 2 | 35,02,864 | P5(2) |
| provisions | 15 | 3,52,59,373 | P5(13), P2(2) |
| trade_payables | 13 | 19,13,99,419 | P5(12), P7(1) |
| other_cl | 12 | 39,49,26,700 | P5(10), P4(1), P7(1) |
| cwip | 0 | 0 | â€” |
| investments | 4 | 1,62,17,533 | P5(4) |
| loans_advances | 10 | 14,12,89,922 | P5(7), P7(3) |
| other_nc_assets | 2 | 31,54,372 | P5(2) |
| inventories | 2 | 24,90,93,862 | P5(2) |
| trade_receivables | 11 | 19,53,61,040 | P5(10), P2(1) |
| cash_bank | 12 | 4,28,23,688 | P5(12) |
| other_ca | 7 | 2,40,41,055 | P5(7) |
| revenue_ops | 9 | 1,44,42,26,097 | P5(8), P7(1) |
| other_income | 7 | 1,13,23,111 | P5(7) |
| cogs | 24 | 12,42,30,24,101 | P3(20), P5(4) |
| employee_exp | 8 | 13,51,16,867 | P5(8) |
| finance_costs | 4 | 1,06,68,717 | P5(4) |
| other_expenses | 18 | 15,57,40,678 | P5(13), P7(5) |

## Detail: every drift / missing-note cell

Sorted by client, then note. Empty rows (OK or no-data) are omitted. Drifted cells where COA-PY is "â€”" mean the CY engagement has no resolvable PY shell.

| Client | FY | Note | Section | COA CY | Note CY | CY Drift | COA PY | Note PY | PY Drift | Attach | Status | Patterns |
|---|---|---|---|---:|---:|---:|---:|---:|---:|:---:|---|---|
| ACCU PANELS ENERGY PVT LTD | 2025-26 | borrowings | BS-Liab | 8,05,58,652 | â€” | 8,05,58,652 | 4,64,50,627 | â€” | 4,64,50,627 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | cash_bank | BS-Asst | 31,57,761 | â€” | 31,57,761 | 29,56,887 | â€” | 29,56,887 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | cogs | PL-Exp | 44,13,89,806 | â€” | 44,13,89,806 | 31,65,42,627 | â€” | 31,65,42,627 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | employee_exp | PL-Exp | 3,89,00,893 | â€” | 3,89,00,893 | 2,34,12,242 | â€” | 2,34,12,242 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | finance_costs | PL-Exp | 49,86,691 | â€” | 49,86,691 | 33,44,886 | â€” | 33,44,886 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | inventories | BS-Asst | 7,50,91,295 | â€” | 7,50,91,295 | 4,68,58,898 | â€” | 4,68,58,898 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | investments | BS-Asst | 90,38,824 | â€” | 90,38,824 | 52,28,279 | â€” | 52,28,279 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | loans_advances | BS-Asst | 2,31,23,231 | â€” | 2,31,23,231 | 18,67,250 | â€” | 18,67,250 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | other_cl | BS-Liab | 53,000 | â€” | 53,000 | 56,000 | â€” | 56,000 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | other_expenses | PL-Exp | 2,41,03,779 | â€” | 2,41,03,779 | 1,88,10,653 | â€” | 1,88,10,653 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | other_income | PL-Inc | 18,52,759 | â€” | 18,52,759 | 10,24,651 | â€” | 10,24,651 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | other_lt_liab | BS-Liab | 1,79,416 | â€” | 1,79,416 | 1,79,416 | â€” | 1,79,416 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | provisions | BS-Liab | 2,20,31,166 | â€” | 2,20,31,166 | 72,16,152 | â€” | 72,16,152 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | revenue_ops | PL-Inc | 48,94,62,412 | â€” | 48,94,62,412 | 37,69,05,172 | â€” | 37,69,05,172 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | trade_payables | BS-Liab | 8,93,07,563 | â€” | 8,93,07,563 | 5,89,02,591 | â€” | 5,89,02,591 | n | no_note | P5 |
| ACCU PANELS ENERGY PVT LTD | 2025-26 | trade_receivables | BS-Asst | 4,93,56,431 | â€” | 4,93,56,431 | 4,87,14,563 | â€” | 4,87,14,563 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | borrowings | BS-Liab | 19,32,197 | â€” | 19,32,197 | 19,32,197 | â€” | 19,32,197 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | cash_bank | BS-Asst | 1,07,51,627 | â€” | 1,07,51,627 | 1,01,52,908 | â€” | 1,01,52,908 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | cogs | PL-Exp | 45,33,000 | â€” | 45,33,000 | 2,87,69,000 | â€” | 2,87,69,000 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | employee_exp | PL-Exp | 10,21,000 | â€” | 10,21,000 | 10,65,400 | â€” | 10,65,400 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | loans_advances | BS-Asst | 7,72,984 | â€” | 7,72,984 | 7,61,631 | â€” | 7,61,631 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | other_ca | BS-Asst | 59,848 | â€” | 59,848 | 77,929 | â€” | 77,929 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | other_expenses | PL-Exp | 4,25,761 | â€” | 4,25,761 | 9,07,644 | â€” | 9,07,644 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | other_income | PL-Inc | 6,50,968 | â€” | 6,50,968 | 3,87,818 | â€” | 3,87,818 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | other_nc_assets | BS-Asst | -15,67,349 | â€” | -15,67,349 | -15,67,349 | â€” | -15,67,349 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | provisions | BS-Liab | 4,62,650 | â€” | 4,62,650 | 4,66,760 | â€” | 4,66,760 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | revenue_ops | PL-Inc | 47,92,795 | â€” | 47,92,795 | 3,01,54,550 | â€” | 3,01,54,550 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | trade_payables | BS-Liab | -426 | â€” | -426 | -93,364 | â€” | -93,364 | n | no_note | P5 |
| AMBER DYE TRADE PRIVATE LIMITED | 2025-26 | trade_receivables | BS-Asst | -82,977 | â€” | -82,977 | 9,56,184 | â€” | 9,56,184 | n | no_note | P5 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | 2025-26 | borrowings | BS-Liab | 10,800 | â€” | 10,800 | 10,800 | â€” | 10,800 | n | no_note | P5 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | 2025-26 | cash_bank | BS-Asst | 5,74,287 | â€” | 5,74,287 | 6,01,135 | â€” | 6,01,135 | n | no_note | P5 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | 2025-26 | other_expenses | PL-Exp | 26,848 | â€” | 26,848 | 22,423 | â€” | 22,423 | n | no_note | P5 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | 2025-26 | provisions | BS-Liab | 11,210 | â€” | 11,210 | 11,210 | â€” | 11,210 | n | no_note | P5 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | 2025-26 | trade_payables | BS-Liab | 10,800 | â€” | 10,800 | 10,800 | â€” | 10,800 | n | no_note | P5 |
| AUSTOMEC ENVIRO PRIVATE LIMITED | 2025-26 | trade_receivables | BS-Asst | 2,30,000 | â€” | 2,30,000 | 2,30,000 | â€” | 2,30,000 | n | no_note | P5 |
| BAPASITARAM DEVELOPERS | 2025-26 | cogs | PL-Exp | 84,71,546 | 17,35,45,668 | -16,50,74,122 | 17,29,981 | 14,63,05,668 | -14,45,75,687 | y(7) | DRIFT | P3 |
| BHAKTI INFRA | 2025-26 | borrowings | BS-Liab | 73,30,715 | 3,74,94,223 | -3,01,63,508 | 2,61,15,547 | 2,61,15,547 | 0 | y(4) | DRIFT | P7 |
| BHAKTI INFRA | 2025-26 | cogs | PL-Exp | 9,89,36,990 | 23,86,03,990 | -13,96,67,000 | 4,05,41,583 | 8,51,25,514 | -4,45,83,931 | y(12) | DRIFT | P3 |
| BRICKSTONE INFRA | 2025-26 | borrowings | BS-Liab | 2,03,73,861 | â€” | 2,03,73,861 | 1,85,00,001 | â€” | 1,85,00,001 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | cash_bank | BS-Asst | 13,33,792 | â€” | 13,33,792 | 4,40,405 | â€” | 4,40,405 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | cogs | PL-Exp | 1,27,24,582 | â€” | 1,27,24,582 | 7,24,36,174 | â€” | 7,24,36,174 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | employee_exp | PL-Exp | 2,64,000 | â€” | 2,64,000 | 3,67,237 | â€” | 3,67,237 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | finance_costs | PL-Exp | 11,61,327 | â€” | 11,61,327 | 10,29,806 | â€” | 10,29,806 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | inventories | BS-Asst | 6,35,71,835 | â€” | 6,35,71,835 | 6,35,71,835 | â€” | 6,35,71,835 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | investments | BS-Asst | 2,87,622 | â€” | 2,87,622 | 10,10,939 | â€” | 10,10,939 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | loans_advances | BS-Asst | 0 | â€” | 0 | 2,50,000 | â€” | 2,50,000 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | other_ca | BS-Asst | 31,23,400 | â€” | 31,23,400 | 59,05,007 | â€” | 59,05,007 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | other_cl | BS-Liab | 45,455 | â€” | 45,455 | 3,39,327 | â€” | 3,39,327 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | other_expenses | PL-Exp | 2,17,04,265 | â€” | 2,17,04,265 | 6,03,07,980 | â€” | 6,03,07,980 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | other_income | PL-Inc | 7,115 | â€” | 7,115 | 67,388 | â€” | 67,388 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | provisions | BS-Liab | 35,000 | â€” | 35,000 | 35,000 | â€” | 35,000 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | revenue_ops | PL-Inc | 10,33,92,800 | â€” | 10,33,92,800 | 11,35,92,975 | â€” | 11,35,92,975 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | trade_payables | BS-Liab | 1,52,51,789 | â€” | 1,52,51,789 | 87,09,740 | â€” | 87,09,740 | n | no_note | P5 |
| BRICKSTONE INFRA | 2025-26 | trade_receivables | BS-Asst | 5,48,67,782 | â€” | 5,48,67,782 | -2,37,17,867 | â€” | -2,37,17,867 | n | no_note | P5 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | cash_bank | BS-Asst | 1,48,709 | â€” | 1,48,709 | 2,85,020 | â€” | 2,85,020 | n | no_note | P5 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | employee_exp | PL-Exp | -1,76,092 | â€” | -1,76,092 | -89,463 | â€” | -89,463 | n | no_note | P5 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | loans_advances | BS-Asst | 7,772 | â€” | 7,772 | 1,61,087 | â€” | 1,61,087 | n | no_note | P5 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | other_ca | BS-Asst | 1,57,749 | â€” | 1,57,749 | 4,738 | â€” | 4,738 | n | no_note | P5 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | other_cl | BS-Liab | 10,51,875 | â€” | 10,51,875 | 11,05,712 | â€” | 11,05,712 | n | no_note | P5 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | other_expenses | PL-Exp | 33,72,339 | â€” | 33,72,339 | 36,93,566 | â€” | 36,93,566 | n | no_note | P5 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | other_income | PL-Inc | 36,18,766 | â€” | 36,18,766 | 34,53,142 | â€” | 34,53,142 | n | no_note | P5 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | provisions | BS-Liab | 5,000 | â€” | 5,000 | 5,000 | â€” | 5,000 | n | no_note | P5 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | trade_payables | BS-Liab | 2,02,322 | â€” | 2,02,322 | 57,626 | â€” | 57,626 | n | no_note | P5 |
| CROWNGLOBE PRIVATE LIMITED | 2025-26 | trade_receivables | BS-Asst | 6,86,720 | â€” | 6,86,720 | 4,53,581 | â€” | 4,53,581 | n | no_note | P5 |
| DBS REALTY | 2025-26 | cogs | PL-Exp | 2,43,36,480 | 59,42,01,480 | -56,98,65,000 | 10,20,18,383 | 59,81,00,830 | -49,60,82,447 | y(18) | DRIFT | P3 |
| DHANANI REALTY | 2025-26 | cogs | PL-Exp | 4,53,09,749 | 28,07,19,249 | -23,54,09,500 | 2,73,59,095 | 17,49,93,658 | -14,76,34,563 | y(19) | DRIFT | P3 |
| GROWQ PRIVATE LIMITED | 2025-26 | employee_exp | PL-Exp | 3,92,57,658 | â€” | 3,92,57,658 | 0 | â€” | 0 | n | no_note | P5 |
| GROWQ PRIVATE LIMITED | 2025-26 | other_ca | BS-Asst | 83,70,495 | â€” | 83,70,495 | 46,20,086 | â€” | 46,20,086 | n | no_note | P5 |
| GROWQ PRIVATE LIMITED | 2025-26 | other_cl | BS-Liab | -10,55,137 | â€” | -10,55,137 | -21,41,631 | â€” | -21,41,631 | n | no_note | P5 |
| GROWQ PRIVATE LIMITED | 2025-26 | other_expenses | PL-Exp | 94,27,085 | â€” | 94,27,085 | 0 | â€” | 0 | n | no_note | P5 |
| GROWQ PRIVATE LIMITED | 2025-26 | other_income | PL-Inc | -4,149 | â€” | -4,149 | 0 | â€” | 0 | n | no_note | P5 |
| GROWQ PRIVATE LIMITED | 2025-26 | other_lt_liab | BS-Liab | 15,72,016 | â€” | 15,72,016 | 15,72,016 | â€” | 15,72,016 | n | no_note | P5 |
| GROWQ PRIVATE LIMITED | 2025-26 | provisions | BS-Liab | 39,89,921 | â€” | 39,89,921 | 92,254 | â€” | 92,254 | n | no_note | P5 |
| GROWQ PRIVATE LIMITED | 2025-26 | revenue_ops | PL-Inc | 5,09,01,652 | â€” | 5,09,01,652 | 0 | â€” | 0 | n | no_note | P5 |
| GROWQ PRIVATE LIMITED | 2025-26 | trade_payables | BS-Liab | 3,79,985 | â€” | 3,79,985 | 29,02,205 | â€” | 29,02,205 | n | no_note | P5 |
| GROWQ PRIVATE LIMITED | 2025-26 | trade_receivables | BS-Asst | 54,71,757 | â€” | 54,71,757 | 47,90,255 | â€” | 47,90,255 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | cash_bank | BS-Asst | 42,19,803 | â€” | 42,19,803 | 45,61,197 | â€” | 45,61,197 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | employee_exp | PL-Exp | 1,28,75,323 | â€” | 1,28,75,323 | 1,49,29,950 | â€” | 1,49,29,950 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | finance_costs | PL-Exp | 82,697 | â€” | 82,697 | 61,836 | â€” | 61,836 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | loans_advances | BS-Asst | 9,84,000 | â€” | 9,84,000 | 9,84,000 | â€” | 9,84,000 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | other_ca | BS-Asst | 7,79,061 | â€” | 7,79,061 | 8,13,158 | â€” | 8,13,158 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | other_cl | BS-Liab | 4,52,748 | â€” | 4,52,748 | 5,17,257 | â€” | 5,17,257 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | other_expenses | PL-Exp | 40,30,340 | â€” | 40,30,340 | 49,00,501 | â€” | 49,00,501 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | other_income | PL-Inc | 7,948 | â€” | 7,948 | 3,490 | â€” | 3,490 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | other_nc_assets | BS-Asst | 9,030 | â€” | 9,030 | 10,644 | â€” | 10,644 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | provisions | BS-Liab | 1,80,000 | â€” | 1,80,000 | 2,44,000 | â€” | 2,44,000 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | revenue_ops | PL-Inc | 1,76,41,331 | â€” | 1,76,41,331 | 2,08,19,525 | â€” | 2,08,19,525 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | trade_payables | BS-Liab | 3,90,333 | â€” | 3,90,333 | 4,19,934 | â€” | 4,19,934 | n | no_note | P5 |
| KWIKTEAM SUPPORT SERVICES PVT LTD | 2025-26 | trade_receivables | BS-Asst | 18,56,085 | â€” | 18,56,085 | 12,83,721 | â€” | 12,83,721 | n | no_note | P5 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | 2025-26 | borrowings | BS-Liab | 10,800 | â€” | 10,800 | 10,800 | â€” | 10,800 | n | no_note | P5 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | 2025-26 | cash_bank | BS-Asst | 7,88,037 | â€” | 7,88,037 | 8,10,342 | â€” | 8,10,342 | n | no_note | P5 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | 2025-26 | other_expenses | PL-Exp | 22,305 | â€” | 22,305 | 22,423 | â€” | 22,423 | n | no_note | P5 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | 2025-26 | provisions | BS-Liab | 11,210 | â€” | 11,210 | 11,210 | â€” | 11,210 | n | no_note | P5 |
| LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED | 2025-26 | trade_payables | BS-Liab | 10,800 | â€” | 10,800 | 10,800 | â€” | 10,800 | n | no_note | P5 |
| MAHARSH INFRA | 2025-26 | borrowings | BS-Liab | 3,89,11,987 | 3,96,62,995 | -7,51,008 | -59,91,743 | 3,04,24,831 | -3,64,16,574 | y(7) | DRIFT | P7 |
| MAHARSH INFRA | 2025-26 | cogs | PL-Exp | 11,08,05,924 | 25,59,03,924 | -14,50,98,000 | 11,80,18,839 | 17,34,30,339 | -5,54,11,500 | y(20) | DRIFT | P3 |
| MAHARSH INFRA | 2025-26 | loans_advances | BS-Asst | 10,55,92,088 | 10,55,92,088 | 0 | 5,18,66,109 | 5,42,66,109 | -24,00,000 | y(3) | DRIFT | P7 |
| MAHARSH INFRA | 2025-26 | other_expenses | PL-Exp | 76,89,211 | 76,89,469 | -258 | 89,36,183 | 89,36,183 | 0 | n | DRIFT | P7 |
| MAHIL INFRA | 2025-26 | borrowings | BS-Liab | 9,53,28,844 | 9,53,28,844 | 0 | 10,42,46,598 | 10,82,96,848 | -40,50,250 | y(25) | DRIFT | P7 |
| MAHIL INFRA | 2025-26 | cogs | PL-Exp | 31,180 | 39,76,06,180 | -39,75,75,000 | 6,74,559 | 26,87,11,577 | -26,80,37,018 | y(4) | DRIFT | P3 |
| MAHIL INFRA | 2025-26 | other_cl | BS-Liab | 45,90,917 | 45,90,917 | 0 | 1,06,15,624 | 1,06,58,092 | -42,468 | y(5) | DRIFT | P4 |
| MICROCIRCUITS INNOVATIONS PRIVATE LIMITED | 2025-26 | revenue_ops | PL-Inc | 3,12,43,909 | â€” | 3,12,43,909 | 4,76,29,504 | â€” | 4,76,29,504 | n | no_note | P5 |
| MICROCIRCUITS INNOVATIONS PRIVATE LIMITED | 2025-26 | trade_payables | BS-Liab | 1,55,107 | â€” | 1,55,107 | 4,480 | â€” | 4,480 | n | no_note | P5 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | cogs | PL-Exp | 2,04,12,709 | 3,34,40,181 | -1,30,27,472 | 1,81,90,072 | 2,98,19,966 | -1,16,29,894 | y(16) | DRIFT | P3 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | other_expenses | PL-Exp | 25,55,584 | 25,55,584 | 0 | 37,21,511 | 34,92,180 | 2,29,331 | n | DRIFT | P7 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | provisions | BS-Liab | 1,23,521 | 1,23,521 | 0 | 2,02,480 | 1,95,943 | 6,537 | n | DRIFT | P2 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | trade_receivables | BS-Asst | 7,55,399 | 7,55,399 | 0 | 13,21,324 | 13,31,089 | -9,765 | n | DRIFT | P2 |
| OM REALTY | 2025-26 | cogs | PL-Exp | 9,87,199 | 21,16,73,199 | -21,06,86,000 | 6,50,17,957 | 37,69,26,957 | -31,19,09,000 | y(26) | DRIFT | P3 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | borrowings | BS-Liab | 28,69,341 | â€” | 28,69,341 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | cash_bank | BS-Asst | 11,16,208 | â€” | 11,16,208 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | employee_exp | PL-Exp | 15,18,639 | â€” | 15,18,639 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | finance_costs | PL-Exp | 1,474 | â€” | 1,474 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | investments | BS-Asst | 6,11,869 | â€” | 6,11,869 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | loans_advances | BS-Asst | 8,07,887 | â€” | 8,07,887 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | other_ca | BS-Asst | 82,000 | â€” | 82,000 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | other_cl | BS-Liab | 3,50,281 | â€” | 3,50,281 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | other_expenses | PL-Exp | 34,08,289 | â€” | 34,08,289 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | other_income | PL-Inc | 2,44,916 | â€” | 2,44,916 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | provisions | BS-Liab | 77,146 | â€” | 77,146 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | revenue_ops | PL-Inc | 94,61,075 | â€” | 94,61,075 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | trade_payables | BS-Liab | 24,93,821 | â€” | 24,93,821 | 0 | â€” | 0 | n | no_note | P5 |
| ORVIX TECHNOLOGIES PRIVATE LIMITED | 2025-26 | trade_receivables | BS-Asst | 1,50,057 | â€” | 1,50,057 | 0 | â€” | 0 | n | no_note | P5 |
| PRINCESS GEMS EXPORTS LIMITED | 2025-26 | borrowings | BS-Liab | 2,63,000 | â€” | 2,63,000 | 2,63,000 | â€” | 2,63,000 | n | no_note | P5 |
| PRINCESS GEMS EXPORTS LIMITED | 2025-26 | cash_bank | BS-Asst | 24,539 | â€” | 24,539 | 25,188 | â€” | 25,188 | n | no_note | P5 |
| PRINCESS GEMS EXPORTS LIMITED | 2025-26 | investments | BS-Asst | 20,000 | â€” | 20,000 | 20,000 | â€” | 20,000 | n | no_note | P5 |
| PRINCESS GEMS EXPORTS LIMITED | 2025-26 | other_cl | BS-Liab | 90,800 | â€” | 90,800 | 67,000 | â€” | 67,000 | n | no_note | P5 |
| PRINCESS GEMS EXPORTS LIMITED | 2025-26 | other_expenses | PL-Exp | 24,449 | â€” | 24,449 | 24,449 | â€” | 24,449 | n | no_note | P5 |
| PRINCESS GEMS EXPORTS LIMITED | 2025-26 | provisions | BS-Liab | 10,900 | â€” | 10,900 | 10,900 | â€” | 10,900 | n | no_note | P5 |
| REVTI INFRA | 2025-26 | borrowings | BS-Liab | 24,05,64,571 | 48,11,29,142 | -24,05,64,571 | 20,90,02,376 | 41,80,04,752 | -20,90,02,376 | y(40) | DRIFT | P7 |
| REVTI INFRA | 2025-26 | cogs | PL-Exp | 3,30,74,567 | 54,27,56,666 | -50,96,82,099 | 2,81,80,713 | 18,14,71,776 | -15,32,91,063 | y(23) | DRIFT | P3 |
| REVTI INFRA | 2025-26 | loans_advances | BS-Asst | 7,54,83,871 | 15,09,67,742 | -7,54,83,871 | 3,04,84,638 | 6,09,69,276 | -3,04,84,638 | y(6) | DRIFT | P7 |
| SALIENT INFRATECH | 2025-26 | cogs | PL-Exp | 4,03,39,600 | 42,91,17,753 | -38,87,78,153 | 5,72,26,020 | 29,22,74,155 | -23,50,48,135 | y(15) | DRIFT | P3 |
| SATVA BUILDCON | 2025-26 | cogs | PL-Exp | 94,92,604 | 19,02,89,144 | -18,07,96,540 | 11,00,87,507 | 33,79,46,507 | -22,78,59,000 | y(23) | DRIFT | P3 |
| SATVA BUILDCON | 2025-26 | provisions | BS-Liab | 95,587 | 95,587 | 0 | 2,80,462 | 1,07,587 | 1,72,875 | n | DRIFT | P2 |
| SHIVASHRAY DEVELOPERS | 2025-26 | cogs | PL-Exp | 3,49,53,002 | 27,08,39,792 | -23,58,86,790 | 7,63,21,328 | 16,96,39,936 | -9,33,18,608 | y(18) | DRIFT | P3 |
| SHREE HARI INFRA | 2025-26 | cogs | PL-Exp | 5,39,69,499 | 1,03,05,00,299 | -97,65,30,800 | 9,75,58,954 | 1,06,47,11,754 | -96,71,52,800 | y(27) | DRIFT | P3 |
| SHREE MARUTI INFRA | 2025-26 | cogs | PL-Exp | 69,090 | 5,56,19,090 | -5,55,50,000 | 12,52,573 | 7,22,55,573 | -7,10,03,000 | y(3) | DRIFT | P3 |
| SHREEYAM INFRA | 2025-26 | borrowings | BS-Liab | 83,05,010 | 1,66,10,020 | -83,05,010 | 83,05,010 | 1,66,10,020 | -83,05,010 | y(11) | DRIFT | P7 |
| SHREEYAM INFRA | 2025-26 | cogs | PL-Exp | 2,68,270 | 39,74,68,270 | -39,72,00,000 | 35,77,334 | 62,65,77,334 | -62,30,00,000 | y(18) | DRIFT | P3 |
| SHREEYAM INFRA | 2025-26 | other_expenses | PL-Exp | -1,36,70,637 | -1,36,70,637 | 0 | -4,26,10,699 | -4,25,13,791 | -96,908 | n | DRIFT | P7 |
| SHREEYAM INFRA | 2025-26 | revenue_ops | PL-Inc | 17,70,00,000 | 17,70,00,000 | 0 | 20,45,73,400 | 35,13,47,400 | -14,67,74,000 | n | DRIFT | P7 |
| SHRI RAM PRODUCTS | 2025-26 | cogs | PL-Exp | 3,32,96,998 | 3,78,10,506 | -45,13,508 | 2,89,50,809 | 3,04,74,849 | -15,24,040 | y(4) | DRIFT | P3 |
| SHUBHAM BUILDCON | 2025-26 | cogs | PL-Exp | 2,21,47,716 | 21,95,54,035 | -19,74,06,318 | 8,50,43,499 | 17,02,62,971 | -8,52,19,472 | y(5) | DRIFT | P3 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | cash_bank | BS-Asst | 3,84,365 | â€” | 3,84,365 | 0 | â€” | 0 | n | no_note | P5 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | employee_exp | PL-Exp | 12,38,970 | â€” | 12,38,970 | no shell | â€” | â€” | n | no_note | P5 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | other_ca | BS-Asst | 47,584 | â€” | 47,584 | 0 | â€” | 0 | n | no_note | P5 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | other_cl | BS-Liab | 1,00,000 | â€” | 1,00,000 | 0 | â€” | 0 | n | no_note | P5 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | other_expenses | PL-Exp | 1,23,273 | â€” | 1,23,273 | no shell | â€” | â€” | n | no_note | P5 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | provisions | BS-Liab | 1,29,673 | â€” | 1,29,673 | 0 | â€” | 0 | n | no_note | P5 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | revenue_ops | PL-Inc | 14,54,396 | â€” | 14,54,396 | no shell | â€” | â€” | n | no_note | P5 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | trade_payables | BS-Liab | 19,123 | â€” | 19,123 | 0 | â€” | 0 | n | no_note | P5 |
| SIX VISION SOFTWARE PRIVATE LIMITED | 2025-26 | trade_receivables | BS-Asst | 9,000 | â€” | 9,000 | 0 | â€” | 0 | n | no_note | P5 |
| SKYLARK CORPORATION | 2025-26 | cogs | PL-Exp | 6,21,73,641 | 76,02,85,264 | -69,81,11,623 | 4,98,34,050 | 59,06,77,328 | -54,08,43,279 | y(25) | DRIFT | P3 |
| SKYLARK CORPORATION | 2025-26 | other_cl | BS-Liab | 13,55,46,875 | 12,23,375 | 13,43,23,500 | -28,92,896 | -25,59,50,505 | 25,30,57,609 | y(6) | DRIFT | P7 |
| SKYLARK CORPORATION | 2025-26 | other_expenses | PL-Exp | 6,58,49,271 | 6,58,49,271 | 0 | 2,93,73,677 | 2,94,03,091 | -29,414 | n | DRIFT | P7 |
| SKYLARK CORPORATION | 2025-26 | trade_payables | BS-Liab | 5,02,61,618 | 6,13,27,634 | -1,10,66,016 | 1,57,02,248 | 1,57,02,248 | 0 | y(89) | DRIFT | P7 |
| SUKIRTI DEVELOPERS | 2025-26 | borrowings | BS-Liab | 24,21,469 | 48,42,938 | -24,21,469 | 14,02,99,861 | 28,05,99,723 | -14,02,99,861 | y(2) | DRIFT | P7 |
| SUKIRTI DEVELOPERS | 2025-26 | cogs | PL-Exp | 6,31,85,440 | 73,55,67,883 | -67,23,82,443 | 52,94,305 | 59,38,21,477 | -58,85,27,172 | y(9) | DRIFT | P3 |
| SUKIRTI DEVELOPERS | 2025-26 | loans_advances | BS-Asst | 40,61,645 | 56,47,430 | -15,85,785 | 21,23,085 | 37,08,870 | -15,85,785 | y(1) | DRIFT | P7 |
| SWADESHI COSMETICS PRIVATE LIMITED | 2025-26 | borrowings | BS-Liab | 2,01,500 | â€” | 2,01,500 | 2,01,500 | â€” | 2,01,500 | n | no_note | P5 |
| SWADESHI COSMETICS PRIVATE LIMITED | 2025-26 | cash_bank | BS-Asst | 18,963 | â€” | 18,963 | 18,963 | â€” | 18,963 | n | no_note | P5 |
| SWADESHI COSMETICS PRIVATE LIMITED | 2025-26 | cogs | PL-Exp | 12,400 | â€” | 12,400 | 0 | â€” | 0 | n | no_note | P5 |
| SWADESHI COSMETICS PRIVATE LIMITED | 2025-26 | other_cl | BS-Liab | 39,200 | â€” | 39,200 | 26,800 | â€” | 26,800 | n | no_note | P5 |
| SWADESHI COSMETICS PRIVATE LIMITED | 2025-26 | provisions | BS-Liab | 10,900 | â€” | 10,900 | 10,900 | â€” | 10,900 | n | no_note | P5 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | 2025-26 | cash_bank | BS-Asst | 2,25,951 | â€” | 2,25,951 | 2,27,600 | â€” | 2,27,600 | n | no_note | P5 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | 2025-26 | loans_advances | BS-Asst | 15,000 | â€” | 15,000 | 15,000 | â€” | 15,000 | n | no_note | P5 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | 2025-26 | other_cl | BS-Liab | 10,900 | â€” | 10,900 | 0 | â€” | 0 | n | no_note | P5 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | 2025-26 | other_expenses | PL-Exp | 12,549 | â€” | 12,549 | 0 | â€” | 0 | n | no_note | P5 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | 2025-26 | provisions | BS-Liab | 10,900 | â€” | 10,900 | 10,900 | â€” | 10,900 | n | no_note | P5 |
| SWADESHI HERBS AND COSMETICS PRIVATE LIMITED | 2025-26 | trade_receivables | BS-Asst | 12,47,148 | â€” | 12,47,148 | 12,47,148 | â€” | 12,47,148 | n | no_note | P5 |
| SWADESHI LABORATORIES PRIVATE LIMITED | 2025-26 | other_expenses | PL-Exp | 493 | â€” | 493 | 13,049 | â€” | 13,049 | n | no_note | P5 |
| SWASTIK BUILDCON | 2025-26 | cogs | PL-Exp | 90,99,551 | 13,58,09,551 | -12,67,10,000 | 42,54,669 | 16,42,70,203 | -16,00,15,534 | y(13) | DRIFT | P3 |
| SWASTIK BUILDCON | 2025-26 | other_expenses | PL-Exp | 94,73,287 | 94,73,376 | -88 | 5,66,193 | 5,66,409 | -216 | y(3) | DRIFT | P7 |
| SWENI CORPORATION | 2025-26 | trade_payables | BS-Liab | 4,99,896 | â€” | 4,99,896 | 4,99,896 | â€” | 4,99,896 | n | no_note | P5 |

## Caveat: notes with custom rows attached to a parent (attachedTo)

Raw key-sum may double-count when both parent value and child custom row hold the same source.

| Client | FY | Note | # attached |
|---|---|---|---:|
| BAPASITARAM DEVELOPERS | 2025-26 | provisions | 1 |
| BAPASITARAM DEVELOPERS | 2025-26 | trade_payables | 7 |
| BAPASITARAM DEVELOPERS | 2025-26 | other_nc_assets | 1 |
| BAPASITARAM DEVELOPERS | 2025-26 | other_ca | 3 |
| BAPASITARAM DEVELOPERS | 2025-26 | cogs | 7 |
| BAPASITARAM DEVELOPERS | 2025-26 | other_expenses | 1 |
| BHAKTI INFRA | 2025-26 | borrowings | 4 |
| BHAKTI INFRA | 2025-26 | trade_payables | 25 |
| BHAKTI INFRA | 2025-26 | other_cl | 3 |
| BHAKTI INFRA | 2025-26 | cogs | 12 |
| DBS REALTY | 2025-26 | borrowings | 4 |
| DBS REALTY | 2025-26 | trade_payables | 64 |
| DBS REALTY | 2025-26 | other_cl | 9 |
| DBS REALTY | 2025-26 | cogs | 18 |
| DBS REALTY | 2025-26 | other_expenses | 5 |
| DHANANI REALTY | 2025-26 | borrowings | 5 |
| DHANANI REALTY | 2025-26 | provisions | 1 |
| DHANANI REALTY | 2025-26 | trade_payables | 96 |
| DHANANI REALTY | 2025-26 | other_cl | 3 |
| DHANANI REALTY | 2025-26 | loans_advances | 1 |
| DHANANI REALTY | 2025-26 | cogs | 19 |
| MAHARSH INFRA | 2025-26 | borrowings | 7 |
| MAHARSH INFRA | 2025-26 | trade_payables | 27 |
| MAHARSH INFRA | 2025-26 | other_cl | 47 |
| MAHARSH INFRA | 2025-26 | loans_advances | 3 |
| MAHARSH INFRA | 2025-26 | cogs | 20 |
| MAHIL INFRA | 2025-26 | borrowings | 25 |
| MAHIL INFRA | 2025-26 | trade_payables | 38 |
| MAHIL INFRA | 2025-26 | other_cl | 5 |
| MAHIL INFRA | 2025-26 | cogs | 4 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | borrowings | 1 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | trade_payables | 42 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | other_cl | 3 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | loans_advances | 4 |
| NIRALI PERFUMERY PRODUCTS | 2025-26 | cogs | 16 |
| OM REALTY | 2025-26 | borrowings | 6 |
| OM REALTY | 2025-26 | provisions | 2 |
| OM REALTY | 2025-26 | trade_payables | 48 |
| OM REALTY | 2025-26 | other_cl | 65 |
| OM REALTY | 2025-26 | investments | 1 |
| OM REALTY | 2025-26 | loans_advances | 4 |
| OM REALTY | 2025-26 | other_income | 1 |
| OM REALTY | 2025-26 | cogs | 26 |
| OM REALTY | 2025-26 | other_expenses | 8 |
| REVTI INFRA | 2025-26 | borrowings | 40 |
| REVTI INFRA | 2025-26 | trade_payables | 55 |
| REVTI INFRA | 2025-26 | other_cl | 42 |
| REVTI INFRA | 2025-26 | loans_advances | 6 |
| REVTI INFRA | 2025-26 | other_ca | 6 |
| REVTI INFRA | 2025-26 | other_income | 3 |
| REVTI INFRA | 2025-26 | cogs | 23 |
| REVTI INFRA | 2025-26 | other_expenses | 20 |
| SALIENT INFRATECH | 2025-26 | borrowings | 8 |
| SALIENT INFRATECH | 2025-26 | trade_payables | 42 |
| SALIENT INFRATECH | 2025-26 | other_cl | 3 |
| SALIENT INFRATECH | 2025-26 | cogs | 15 |
| SATVA BUILDCON | 2025-26 | borrowings | 13 |
| SATVA BUILDCON | 2025-26 | trade_payables | 36 |
| SATVA BUILDCON | 2025-26 | other_cl | 6 |
| SATVA BUILDCON | 2025-26 | cogs | 23 |
| SHIVASHRAY DEVELOPERS | 2025-26 | borrowings | 7 |
| SHIVASHRAY DEVELOPERS | 2025-26 | provisions | 4 |
| SHIVASHRAY DEVELOPERS | 2025-26 | trade_payables | 24 |
| SHIVASHRAY DEVELOPERS | 2025-26 | other_cl | 3 |
| SHIVASHRAY DEVELOPERS | 2025-26 | other_nc_assets | 1 |
| SHIVASHRAY DEVELOPERS | 2025-26 | other_income | 1 |
| SHIVASHRAY DEVELOPERS | 2025-26 | cogs | 18 |
| SHIVASHRAY DEVELOPERS | 2025-26 | other_expenses | 4 |
| SHREE HARI INFRA | 2025-26 | borrowings | 94 |
| SHREE HARI INFRA | 2025-26 | trade_payables | 115 |
| SHREE HARI INFRA | 2025-26 | other_cl | 46 |
| SHREE HARI INFRA | 2025-26 | loans_advances | 2 |
| SHREE HARI INFRA | 2025-26 | cogs | 27 |
| SHREE MARUTI INFRA | 2025-26 | borrowings | 3 |
| SHREE MARUTI INFRA | 2025-26 | trade_payables | 4 |
| SHREE MARUTI INFRA | 2025-26 | other_cl | 17 |
| SHREE MARUTI INFRA | 2025-26 | cogs | 3 |
| SHREEYAM INFRA | 2025-26 | borrowings | 11 |
| SHREEYAM INFRA | 2025-26 | trade_payables | 8 |
| SHREEYAM INFRA | 2025-26 | other_cl | 19 |
| SHREEYAM INFRA | 2025-26 | cogs | 18 |
| SHRI RAM PRODUCTS | 2025-26 | borrowings | 5 |
| SHRI RAM PRODUCTS | 2025-26 | trade_payables | 41 |
| SHRI RAM PRODUCTS | 2025-26 | cogs | 4 |
| SHUBHAM BUILDCON | 2025-26 | borrowings | 19 |
| SHUBHAM BUILDCON | 2025-26 | trade_payables | 44 |
| SHUBHAM BUILDCON | 2025-26 | other_cl | 6 |
| SHUBHAM BUILDCON | 2025-26 | cogs | 5 |
| SKYLARK CORPORATION | 2025-26 | borrowings | 128 |
| SKYLARK CORPORATION | 2025-26 | trade_payables | 89 |
| SKYLARK CORPORATION | 2025-26 | other_cl | 6 |
| SKYLARK CORPORATION | 2025-26 | cogs | 25 |
| SUKIRTI DEVELOPERS | 2025-26 | borrowings | 2 |
| SUKIRTI DEVELOPERS | 2025-26 | trade_payables | 51 |
| SUKIRTI DEVELOPERS | 2025-26 | other_cl | 10 |
| SUKIRTI DEVELOPERS | 2025-26 | loans_advances | 1 |
| SUKIRTI DEVELOPERS | 2025-26 | cogs | 9 |
| SWASTIK BUILDCON | 2025-26 | borrowings | 8 |
| SWASTIK BUILDCON | 2025-26 | provisions | 2 |
| SWASTIK BUILDCON | 2025-26 | trade_payables | 14 |
| SWASTIK BUILDCON | 2025-26 | loans_advances | 2 |
| SWASTIK BUILDCON | 2025-26 | revenue_ops | 4 |
| SWASTIK BUILDCON | 2025-26 | cogs | 13 |
| SWASTIK BUILDCON | 2025-26 | other_expenses | 3 |

## Deep dive (evidence per drifted cell)

For each drifted / missing-note cell, pattern classifications and supporting evidence are below.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” borrowings [BS-Liab]

- COA CY: **8,05,58,652**  | Note CY: **â€”**  | CY Drift: **8,05,58,652**
- COA PY: **4,64,50,627**  | Note PY: **â€”**  | PY Drift: **4,64,50,627**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **31,57,761**  | Note CY: **â€”**  | CY Drift: **31,57,761**
- COA PY: **29,56,887**  | Note PY: **â€”**  | PY Drift: **29,56,887**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” cogs [PL-Exp]

- COA CY: **44,13,89,806**  | Note CY: **â€”**  | CY Drift: **44,13,89,806**
- COA PY: **31,65,42,627**  | Note PY: **â€”**  | PY Drift: **31,65,42,627**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” employee_exp [PL-Exp]

- COA CY: **3,89,00,893**  | Note CY: **â€”**  | CY Drift: **3,89,00,893**
- COA PY: **2,34,12,242**  | Note PY: **â€”**  | PY Drift: **2,34,12,242**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” finance_costs [PL-Exp]

- COA CY: **49,86,691**  | Note CY: **â€”**  | CY Drift: **49,86,691**
- COA PY: **33,44,886**  | Note PY: **â€”**  | PY Drift: **33,44,886**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” inventories [BS-Asst]

- COA CY: **7,50,91,295**  | Note CY: **â€”**  | CY Drift: **7,50,91,295**
- COA PY: **4,68,58,898**  | Note PY: **â€”**  | PY Drift: **4,68,58,898**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” investments [BS-Asst]

- COA CY: **90,38,824**  | Note CY: **â€”**  | CY Drift: **90,38,824**
- COA PY: **52,28,279**  | Note PY: **â€”**  | PY Drift: **52,28,279**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” loans_advances [BS-Asst]

- COA CY: **2,31,23,231**  | Note CY: **â€”**  | CY Drift: **2,31,23,231**
- COA PY: **18,67,250**  | Note PY: **â€”**  | PY Drift: **18,67,250**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” other_cl [BS-Liab]

- COA CY: **53,000**  | Note CY: **â€”**  | CY Drift: **53,000**
- COA PY: **56,000**  | Note PY: **â€”**  | PY Drift: **56,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **2,41,03,779**  | Note CY: **â€”**  | CY Drift: **2,41,03,779**
- COA PY: **1,88,10,653**  | Note PY: **â€”**  | PY Drift: **1,88,10,653**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” other_income [PL-Inc]

- COA CY: **18,52,759**  | Note CY: **â€”**  | CY Drift: **18,52,759**
- COA PY: **10,24,651**  | Note PY: **â€”**  | PY Drift: **10,24,651**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” other_lt_liab [BS-Liab]

- COA CY: **1,79,416**  | Note CY: **â€”**  | CY Drift: **1,79,416**
- COA PY: **1,79,416**  | Note PY: **â€”**  | PY Drift: **1,79,416**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” provisions [BS-Liab]

- COA CY: **2,20,31,166**  | Note CY: **â€”**  | CY Drift: **2,20,31,166**
- COA PY: **72,16,152**  | Note PY: **â€”**  | PY Drift: **72,16,152**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” revenue_ops [PL-Inc]

- COA CY: **48,94,62,412**  | Note CY: **â€”**  | CY Drift: **48,94,62,412**
- COA PY: **37,69,05,172**  | Note PY: **â€”**  | PY Drift: **37,69,05,172**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **8,93,07,563**  | Note CY: **â€”**  | CY Drift: **8,93,07,563**
- COA PY: **5,89,02,591**  | Note PY: **â€”**  | PY Drift: **5,89,02,591**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ACCU PANELS ENERGY PVT LTD (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **4,93,56,431**  | Note CY: **â€”**  | CY Drift: **4,93,56,431**
- COA PY: **4,87,14,563**  | Note PY: **â€”**  | PY Drift: **4,87,14,563**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” borrowings [BS-Liab]

- COA CY: **19,32,197**  | Note CY: **â€”**  | CY Drift: **19,32,197**
- COA PY: **19,32,197**  | Note PY: **â€”**  | PY Drift: **19,32,197**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **1,07,51,627**  | Note CY: **â€”**  | CY Drift: **1,07,51,627**
- COA PY: **1,01,52,908**  | Note PY: **â€”**  | PY Drift: **1,01,52,908**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” cogs [PL-Exp]

- COA CY: **45,33,000**  | Note CY: **â€”**  | CY Drift: **45,33,000**
- COA PY: **2,87,69,000**  | Note PY: **â€”**  | PY Drift: **2,87,69,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” employee_exp [PL-Exp]

- COA CY: **10,21,000**  | Note CY: **â€”**  | CY Drift: **10,21,000**
- COA PY: **10,65,400**  | Note PY: **â€”**  | PY Drift: **10,65,400**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” loans_advances [BS-Asst]

- COA CY: **7,72,984**  | Note CY: **â€”**  | CY Drift: **7,72,984**
- COA PY: **7,61,631**  | Note PY: **â€”**  | PY Drift: **7,61,631**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” other_ca [BS-Asst]

- COA CY: **59,848**  | Note CY: **â€”**  | CY Drift: **59,848**
- COA PY: **77,929**  | Note PY: **â€”**  | PY Drift: **77,929**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **4,25,761**  | Note CY: **â€”**  | CY Drift: **4,25,761**
- COA PY: **9,07,644**  | Note PY: **â€”**  | PY Drift: **9,07,644**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” other_income [PL-Inc]

- COA CY: **6,50,968**  | Note CY: **â€”**  | CY Drift: **6,50,968**
- COA PY: **3,87,818**  | Note PY: **â€”**  | PY Drift: **3,87,818**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” other_nc_assets [BS-Asst]

- COA CY: **-15,67,349**  | Note CY: **â€”**  | CY Drift: **-15,67,349**
- COA PY: **-15,67,349**  | Note PY: **â€”**  | PY Drift: **-15,67,349**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” provisions [BS-Liab]

- COA CY: **4,62,650**  | Note CY: **â€”**  | CY Drift: **4,62,650**
- COA PY: **4,66,760**  | Note PY: **â€”**  | PY Drift: **4,66,760**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” revenue_ops [PL-Inc]

- COA CY: **47,92,795**  | Note CY: **â€”**  | CY Drift: **47,92,795**
- COA PY: **3,01,54,550**  | Note PY: **â€”**  | PY Drift: **3,01,54,550**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **-426**  | Note CY: **â€”**  | CY Drift: **-426**
- COA PY: **-93,364**  | Note PY: **â€”**  | PY Drift: **-93,364**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AMBER DYE TRADE PRIVATE LIMITED (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **-82,977**  | Note CY: **â€”**  | CY Drift: **-82,977**
- COA PY: **9,56,184**  | Note PY: **â€”**  | PY Drift: **9,56,184**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AUSTOMEC ENVIRO PRIVATE LIMITED (2025-26) â€” borrowings [BS-Liab]

- COA CY: **10,800**  | Note CY: **â€”**  | CY Drift: **10,800**
- COA PY: **10,800**  | Note PY: **â€”**  | PY Drift: **10,800**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AUSTOMEC ENVIRO PRIVATE LIMITED (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **5,74,287**  | Note CY: **â€”**  | CY Drift: **5,74,287**
- COA PY: **6,01,135**  | Note PY: **â€”**  | PY Drift: **6,01,135**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AUSTOMEC ENVIRO PRIVATE LIMITED (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **26,848**  | Note CY: **â€”**  | CY Drift: **26,848**
- COA PY: **22,423**  | Note PY: **â€”**  | PY Drift: **22,423**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AUSTOMEC ENVIRO PRIVATE LIMITED (2025-26) â€” provisions [BS-Liab]

- COA CY: **11,210**  | Note CY: **â€”**  | CY Drift: **11,210**
- COA PY: **11,210**  | Note PY: **â€”**  | PY Drift: **11,210**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AUSTOMEC ENVIRO PRIVATE LIMITED (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **10,800**  | Note CY: **â€”**  | CY Drift: **10,800**
- COA PY: **10,800**  | Note PY: **â€”**  | PY Drift: **10,800**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### AUSTOMEC ENVIRO PRIVATE LIMITED (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **2,30,000**  | Note CY: **â€”**  | CY Drift: **2,30,000**
- COA PY: **2,30,000**  | Note PY: **â€”**  | PY Drift: **2,30,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BAPASITARAM DEVELOPERS (2025-26) â€” cogs [PL-Exp]

- COA CY: **84,71,546**  | Note CY: **17,35,45,668**  | CY Drift: **-16,50,74,122**
- COA PY: **17,29,981**  | Note PY: **14,63,05,668**  | PY Drift: **-14,45,75,687**
- Patterns: **P3**  | attachedTo flag: y (7)

  - CY stale note source 1 (sum 9,09,19,174): Work In Progress=9,09,19,174

### BHAKTI INFRA (2025-26) â€” borrowings [BS-Liab]

- COA CY: **73,30,715**  | Note CY: **3,74,94,223**  | CY Drift: **-3,01,63,508**
- COA PY: **2,61,15,547**  | Note PY: **2,61,15,547**  | PY Drift: **0**
- Patterns: **P7**  | attachedTo flag: y (4)

  - No known pattern matched; manual review needed.

### BHAKTI INFRA (2025-26) â€” cogs [PL-Exp]

- COA CY: **9,89,36,990**  | Note CY: **23,86,03,990**  | CY Drift: **-13,96,67,000**
- COA PY: **4,05,41,583**  | Note PY: **8,51,25,514**  | PY Drift: **-4,45,83,931**
- Patterns: **P3**  | attachedTo flag: y (12)

  - CY stale note source 1 (sum 5,30,00,000): Work in Progress=5,30,00,000

### BRICKSTONE INFRA (2025-26) â€” borrowings [BS-Liab]

- COA CY: **2,03,73,861**  | Note CY: **â€”**  | CY Drift: **2,03,73,861**
- COA PY: **1,85,00,001**  | Note PY: **â€”**  | PY Drift: **1,85,00,001**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **13,33,792**  | Note CY: **â€”**  | CY Drift: **13,33,792**
- COA PY: **4,40,405**  | Note PY: **â€”**  | PY Drift: **4,40,405**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” cogs [PL-Exp]

- COA CY: **1,27,24,582**  | Note CY: **â€”**  | CY Drift: **1,27,24,582**
- COA PY: **7,24,36,174**  | Note PY: **â€”**  | PY Drift: **7,24,36,174**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” employee_exp [PL-Exp]

- COA CY: **2,64,000**  | Note CY: **â€”**  | CY Drift: **2,64,000**
- COA PY: **3,67,237**  | Note PY: **â€”**  | PY Drift: **3,67,237**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” finance_costs [PL-Exp]

- COA CY: **11,61,327**  | Note CY: **â€”**  | CY Drift: **11,61,327**
- COA PY: **10,29,806**  | Note PY: **â€”**  | PY Drift: **10,29,806**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” inventories [BS-Asst]

- COA CY: **6,35,71,835**  | Note CY: **â€”**  | CY Drift: **6,35,71,835**
- COA PY: **6,35,71,835**  | Note PY: **â€”**  | PY Drift: **6,35,71,835**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” investments [BS-Asst]

- COA CY: **2,87,622**  | Note CY: **â€”**  | CY Drift: **2,87,622**
- COA PY: **10,10,939**  | Note PY: **â€”**  | PY Drift: **10,10,939**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” loans_advances [BS-Asst]

- COA CY: **0**  | Note CY: **â€”**  | CY Drift: **0**
- COA PY: **2,50,000**  | Note PY: **â€”**  | PY Drift: **2,50,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” other_ca [BS-Asst]

- COA CY: **31,23,400**  | Note CY: **â€”**  | CY Drift: **31,23,400**
- COA PY: **59,05,007**  | Note PY: **â€”**  | PY Drift: **59,05,007**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” other_cl [BS-Liab]

- COA CY: **45,455**  | Note CY: **â€”**  | CY Drift: **45,455**
- COA PY: **3,39,327**  | Note PY: **â€”**  | PY Drift: **3,39,327**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **2,17,04,265**  | Note CY: **â€”**  | CY Drift: **2,17,04,265**
- COA PY: **6,03,07,980**  | Note PY: **â€”**  | PY Drift: **6,03,07,980**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” other_income [PL-Inc]

- COA CY: **7,115**  | Note CY: **â€”**  | CY Drift: **7,115**
- COA PY: **67,388**  | Note PY: **â€”**  | PY Drift: **67,388**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” provisions [BS-Liab]

- COA CY: **35,000**  | Note CY: **â€”**  | CY Drift: **35,000**
- COA PY: **35,000**  | Note PY: **â€”**  | PY Drift: **35,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” revenue_ops [PL-Inc]

- COA CY: **10,33,92,800**  | Note CY: **â€”**  | CY Drift: **10,33,92,800**
- COA PY: **11,35,92,975**  | Note PY: **â€”**  | PY Drift: **11,35,92,975**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **1,52,51,789**  | Note CY: **â€”**  | CY Drift: **1,52,51,789**
- COA PY: **87,09,740**  | Note PY: **â€”**  | PY Drift: **87,09,740**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### BRICKSTONE INFRA (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **5,48,67,782**  | Note CY: **â€”**  | CY Drift: **5,48,67,782**
- COA PY: **-2,37,17,867**  | Note PY: **â€”**  | PY Drift: **-2,37,17,867**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### CROWNGLOBE PRIVATE LIMITED (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **1,48,709**  | Note CY: **â€”**  | CY Drift: **1,48,709**
- COA PY: **2,85,020**  | Note PY: **â€”**  | PY Drift: **2,85,020**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### CROWNGLOBE PRIVATE LIMITED (2025-26) â€” employee_exp [PL-Exp]

- COA CY: **-1,76,092**  | Note CY: **â€”**  | CY Drift: **-1,76,092**
- COA PY: **-89,463**  | Note PY: **â€”**  | PY Drift: **-89,463**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### CROWNGLOBE PRIVATE LIMITED (2025-26) â€” loans_advances [BS-Asst]

- COA CY: **7,772**  | Note CY: **â€”**  | CY Drift: **7,772**
- COA PY: **1,61,087**  | Note PY: **â€”**  | PY Drift: **1,61,087**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### CROWNGLOBE PRIVATE LIMITED (2025-26) â€” other_ca [BS-Asst]

- COA CY: **1,57,749**  | Note CY: **â€”**  | CY Drift: **1,57,749**
- COA PY: **4,738**  | Note PY: **â€”**  | PY Drift: **4,738**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### CROWNGLOBE PRIVATE LIMITED (2025-26) â€” other_cl [BS-Liab]

- COA CY: **10,51,875**  | Note CY: **â€”**  | CY Drift: **10,51,875**
- COA PY: **11,05,712**  | Note PY: **â€”**  | PY Drift: **11,05,712**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### CROWNGLOBE PRIVATE LIMITED (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **33,72,339**  | Note CY: **â€”**  | CY Drift: **33,72,339**
- COA PY: **36,93,566**  | Note PY: **â€”**  | PY Drift: **36,93,566**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### CROWNGLOBE PRIVATE LIMITED (2025-26) â€” other_income [PL-Inc]

- COA CY: **36,18,766**  | Note CY: **â€”**  | CY Drift: **36,18,766**
- COA PY: **34,53,142**  | Note PY: **â€”**  | PY Drift: **34,53,142**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### CROWNGLOBE PRIVATE LIMITED (2025-26) â€” provisions [BS-Liab]

- COA CY: **5,000**  | Note CY: **â€”**  | CY Drift: **5,000**
- COA PY: **5,000**  | Note PY: **â€”**  | PY Drift: **5,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### CROWNGLOBE PRIVATE LIMITED (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **2,02,322**  | Note CY: **â€”**  | CY Drift: **2,02,322**
- COA PY: **57,626**  | Note PY: **â€”**  | PY Drift: **57,626**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### CROWNGLOBE PRIVATE LIMITED (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **6,86,720**  | Note CY: **â€”**  | CY Drift: **6,86,720**
- COA PY: **4,53,581**  | Note PY: **â€”**  | PY Drift: **4,53,581**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### DBS REALTY (2025-26) â€” cogs [PL-Exp]

- COA CY: **2,43,36,480**  | Note CY: **59,42,01,480**  | CY Drift: **-56,98,65,000**
- COA PY: **10,20,18,383**  | Note PY: **59,81,00,830**  | PY Drift: **-49,60,82,447**
- Patterns: **P3**  | attachedTo flag: y (18)

  - CY stale note source 1 (sum 29,39,17,000): Work in Progress=29,39,17,000

### DHANANI REALTY (2025-26) â€” cogs [PL-Exp]

- COA CY: **4,53,09,749**  | Note CY: **28,07,19,249**  | CY Drift: **-23,54,09,500**
- COA PY: **2,73,59,095**  | Note PY: **17,49,93,658**  | PY Drift: **-14,76,34,563**
- Patterns: **P3**  | attachedTo flag: y (19)

  - CY stale note source 1 (sum 4,14,50,000): Work in Progress=4,14,50,000

### GROWQ PRIVATE LIMITED (2025-26) â€” employee_exp [PL-Exp]

- COA CY: **3,92,57,658**  | Note CY: **â€”**  | CY Drift: **3,92,57,658**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### GROWQ PRIVATE LIMITED (2025-26) â€” other_ca [BS-Asst]

- COA CY: **83,70,495**  | Note CY: **â€”**  | CY Drift: **83,70,495**
- COA PY: **46,20,086**  | Note PY: **â€”**  | PY Drift: **46,20,086**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### GROWQ PRIVATE LIMITED (2025-26) â€” other_cl [BS-Liab]

- COA CY: **-10,55,137**  | Note CY: **â€”**  | CY Drift: **-10,55,137**
- COA PY: **-21,41,631**  | Note PY: **â€”**  | PY Drift: **-21,41,631**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### GROWQ PRIVATE LIMITED (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **94,27,085**  | Note CY: **â€”**  | CY Drift: **94,27,085**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### GROWQ PRIVATE LIMITED (2025-26) â€” other_income [PL-Inc]

- COA CY: **-4,149**  | Note CY: **â€”**  | CY Drift: **-4,149**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### GROWQ PRIVATE LIMITED (2025-26) â€” other_lt_liab [BS-Liab]

- COA CY: **15,72,016**  | Note CY: **â€”**  | CY Drift: **15,72,016**
- COA PY: **15,72,016**  | Note PY: **â€”**  | PY Drift: **15,72,016**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### GROWQ PRIVATE LIMITED (2025-26) â€” provisions [BS-Liab]

- COA CY: **39,89,921**  | Note CY: **â€”**  | CY Drift: **39,89,921**
- COA PY: **92,254**  | Note PY: **â€”**  | PY Drift: **92,254**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### GROWQ PRIVATE LIMITED (2025-26) â€” revenue_ops [PL-Inc]

- COA CY: **5,09,01,652**  | Note CY: **â€”**  | CY Drift: **5,09,01,652**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### GROWQ PRIVATE LIMITED (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **3,79,985**  | Note CY: **â€”**  | CY Drift: **3,79,985**
- COA PY: **29,02,205**  | Note PY: **â€”**  | PY Drift: **29,02,205**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### GROWQ PRIVATE LIMITED (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **54,71,757**  | Note CY: **â€”**  | CY Drift: **54,71,757**
- COA PY: **47,90,255**  | Note PY: **â€”**  | PY Drift: **47,90,255**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **42,19,803**  | Note CY: **â€”**  | CY Drift: **42,19,803**
- COA PY: **45,61,197**  | Note PY: **â€”**  | PY Drift: **45,61,197**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” employee_exp [PL-Exp]

- COA CY: **1,28,75,323**  | Note CY: **â€”**  | CY Drift: **1,28,75,323**
- COA PY: **1,49,29,950**  | Note PY: **â€”**  | PY Drift: **1,49,29,950**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” finance_costs [PL-Exp]

- COA CY: **82,697**  | Note CY: **â€”**  | CY Drift: **82,697**
- COA PY: **61,836**  | Note PY: **â€”**  | PY Drift: **61,836**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” loans_advances [BS-Asst]

- COA CY: **9,84,000**  | Note CY: **â€”**  | CY Drift: **9,84,000**
- COA PY: **9,84,000**  | Note PY: **â€”**  | PY Drift: **9,84,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” other_ca [BS-Asst]

- COA CY: **7,79,061**  | Note CY: **â€”**  | CY Drift: **7,79,061**
- COA PY: **8,13,158**  | Note PY: **â€”**  | PY Drift: **8,13,158**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” other_cl [BS-Liab]

- COA CY: **4,52,748**  | Note CY: **â€”**  | CY Drift: **4,52,748**
- COA PY: **5,17,257**  | Note PY: **â€”**  | PY Drift: **5,17,257**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **40,30,340**  | Note CY: **â€”**  | CY Drift: **40,30,340**
- COA PY: **49,00,501**  | Note PY: **â€”**  | PY Drift: **49,00,501**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” other_income [PL-Inc]

- COA CY: **7,948**  | Note CY: **â€”**  | CY Drift: **7,948**
- COA PY: **3,490**  | Note PY: **â€”**  | PY Drift: **3,490**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” other_nc_assets [BS-Asst]

- COA CY: **9,030**  | Note CY: **â€”**  | CY Drift: **9,030**
- COA PY: **10,644**  | Note PY: **â€”**  | PY Drift: **10,644**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” provisions [BS-Liab]

- COA CY: **1,80,000**  | Note CY: **â€”**  | CY Drift: **1,80,000**
- COA PY: **2,44,000**  | Note PY: **â€”**  | PY Drift: **2,44,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” revenue_ops [PL-Inc]

- COA CY: **1,76,41,331**  | Note CY: **â€”**  | CY Drift: **1,76,41,331**
- COA PY: **2,08,19,525**  | Note PY: **â€”**  | PY Drift: **2,08,19,525**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **3,90,333**  | Note CY: **â€”**  | CY Drift: **3,90,333**
- COA PY: **4,19,934**  | Note PY: **â€”**  | PY Drift: **4,19,934**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### KWIKTEAM SUPPORT SERVICES PVT LTD (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **18,56,085**  | Note CY: **â€”**  | CY Drift: **18,56,085**
- COA PY: **12,83,721**  | Note PY: **â€”**  | PY Drift: **12,83,721**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED (2025-26) â€” borrowings [BS-Liab]

- COA CY: **10,800**  | Note CY: **â€”**  | CY Drift: **10,800**
- COA PY: **10,800**  | Note PY: **â€”**  | PY Drift: **10,800**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **7,88,037**  | Note CY: **â€”**  | CY Drift: **7,88,037**
- COA PY: **8,10,342**  | Note PY: **â€”**  | PY Drift: **8,10,342**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **22,305**  | Note CY: **â€”**  | CY Drift: **22,305**
- COA PY: **22,423**  | Note PY: **â€”**  | PY Drift: **22,423**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED (2025-26) â€” provisions [BS-Liab]

- COA CY: **11,210**  | Note CY: **â€”**  | CY Drift: **11,210**
- COA PY: **11,210**  | Note PY: **â€”**  | PY Drift: **11,210**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### LIMBABLE BIOTECHNOLOGY PRIVATE LIMITED (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **10,800**  | Note CY: **â€”**  | CY Drift: **10,800**
- COA PY: **10,800**  | Note PY: **â€”**  | PY Drift: **10,800**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### MAHARSH INFRA (2025-26) â€” borrowings [BS-Liab]

- COA CY: **3,89,11,987**  | Note CY: **3,96,62,995**  | CY Drift: **-7,51,008**
- COA PY: **-59,91,743**  | Note PY: **3,04,24,831**  | PY Drift: **-3,64,16,574**
- Patterns: **P7**  | attachedTo flag: y (7)

  - No known pattern matched; manual review needed.

### MAHARSH INFRA (2025-26) â€” cogs [PL-Exp]

- COA CY: **11,08,05,924**  | Note CY: **25,59,03,924**  | CY Drift: **-14,50,98,000**
- COA PY: **11,80,18,839**  | Note PY: **17,34,30,339**  | PY Drift: **-5,54,11,500**
- Patterns: **P3**  | attachedTo flag: y (20)

  - CY stale note source 1 (sum 7,80,00,000): Work in Progress=7,80,00,000

### MAHARSH INFRA (2025-26) â€” loans_advances [BS-Asst]

- COA CY: **10,55,92,088**  | Note CY: **10,55,92,088**  | CY Drift: **0**
- COA PY: **5,18,66,109**  | Note PY: **5,42,66,109**  | PY Drift: **-24,00,000**
- Patterns: **P7**  | attachedTo flag: y (3)

  - No known pattern matched; manual review needed.

### MAHARSH INFRA (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **76,89,211**  | Note CY: **76,89,469**  | CY Drift: **-258**
- COA PY: **89,36,183**  | Note PY: **89,36,183**  | PY Drift: **0**
- Patterns: **P7**  

  - No known pattern matched; manual review needed.

### MAHIL INFRA (2025-26) â€” borrowings [BS-Liab]

- COA CY: **9,53,28,844**  | Note CY: **9,53,28,844**  | CY Drift: **0**
- COA PY: **10,42,46,598**  | Note PY: **10,82,96,848**  | PY Drift: **-40,50,250**
- Patterns: **P7**  | attachedTo flag: y (25)

  - No known pattern matched; manual review needed.

### MAHIL INFRA (2025-26) â€” cogs [PL-Exp]

- COA CY: **31,180**  | Note CY: **39,76,06,180**  | CY Drift: **-39,75,75,000**
- COA PY: **6,74,559**  | Note PY: **26,87,11,577**  | PY Drift: **-26,80,37,018**
- Patterns: **P3**  | attachedTo flag: y (4)

  - CY stale note source 1 (sum 18,48,50,000): WIP=18,48,50,000

### MAHIL INFRA (2025-26) â€” other_cl [BS-Liab]

- COA CY: **45,90,917**  | Note CY: **45,90,917**  | CY Drift: **0**
- COA PY: **1,06,15,624**  | Note PY: **1,06,58,092**  | PY Drift: **-42,468**
- Patterns: **P4**  | attachedTo flag: y (5)

  - PY note has 1 source ledger(s) not in PY TB (sum 42,468): Gst Payable=42,468

### MICROCIRCUITS INNOVATIONS PRIVATE LIMITED (2025-26) â€” revenue_ops [PL-Inc]

- COA CY: **3,12,43,909**  | Note CY: **â€”**  | CY Drift: **3,12,43,909**
- COA PY: **4,76,29,504**  | Note PY: **â€”**  | PY Drift: **4,76,29,504**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### MICROCIRCUITS INNOVATIONS PRIVATE LIMITED (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **1,55,107**  | Note CY: **â€”**  | CY Drift: **1,55,107**
- COA PY: **4,480**  | Note PY: **â€”**  | PY Drift: **4,480**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### NIRALI PERFUMERY PRODUCTS (2025-26) â€” cogs [PL-Exp]

- COA CY: **2,04,12,709**  | Note CY: **3,34,40,181**  | CY Drift: **-1,30,27,472**
- COA PY: **1,81,90,072**  | Note PY: **2,98,19,966**  | PY Drift: **-1,16,29,894**
- Patterns: **P3**  | attachedTo flag: y (16)

  - CY stale note source 1 (sum 69,56,298): Closing Stock=69,56,298

### NIRALI PERFUMERY PRODUCTS (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **25,55,584**  | Note CY: **25,55,584**  | CY Drift: **0**
- COA PY: **37,21,511**  | Note PY: **34,92,180**  | PY Drift: **2,29,331**
- Patterns: **P7**  

  - No known pattern matched; manual review needed.

### NIRALI PERFUMERY PRODUCTS (2025-26) â€” provisions [BS-Liab]

- COA CY: **1,23,521**  | Note CY: **1,23,521**  | CY Drift: **0**
- COA PY: **2,02,480**  | Note PY: **1,95,943**  | PY Drift: **6,537**
- Patterns: **P2**  

  - PY missing 3 ledger(s) sum 6,537: CGST PAYABLE RCM=2,715; SGST PAYABLE RCM=2,715; TDS on Commission - 194H=1,107

### NIRALI PERFUMERY PRODUCTS (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **7,55,399**  | Note CY: **7,55,399**  | CY Drift: **0**
- COA PY: **13,21,324**  | Note PY: **13,31,089**  | PY Drift: **-9,765**
- Patterns: **P2**  

  - PY missing 5 ledger(s) sum 1,15,094: Ambica Agarbatti Works - Ahmedabad=7,088; Kinjal Traders=6,917; M/s Gaurav Consumer Product Private Ltd.=30,450; SHREE GURUKRUPA AGENCY - KUDAL=46,307; Shree Sai Agencies - Kannad=24,332

### OM REALTY (2025-26) â€” cogs [PL-Exp]

- COA CY: **9,87,199**  | Note CY: **21,16,73,199**  | CY Drift: **-21,06,86,000**
- COA PY: **6,50,17,957**  | Note PY: **37,69,26,957**  | PY Drift: **-31,19,09,000**
- Patterns: **P3**  | attachedTo flag: y (26)

  - CY stale note source 1 (sum 7,40,88,000): Work in Progress=7,40,88,000

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” borrowings [BS-Liab]

- COA CY: **28,69,341**  | Note CY: **â€”**  | CY Drift: **28,69,341**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **11,16,208**  | Note CY: **â€”**  | CY Drift: **11,16,208**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” employee_exp [PL-Exp]

- COA CY: **15,18,639**  | Note CY: **â€”**  | CY Drift: **15,18,639**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” finance_costs [PL-Exp]

- COA CY: **1,474**  | Note CY: **â€”**  | CY Drift: **1,474**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” investments [BS-Asst]

- COA CY: **6,11,869**  | Note CY: **â€”**  | CY Drift: **6,11,869**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” loans_advances [BS-Asst]

- COA CY: **8,07,887**  | Note CY: **â€”**  | CY Drift: **8,07,887**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” other_ca [BS-Asst]

- COA CY: **82,000**  | Note CY: **â€”**  | CY Drift: **82,000**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” other_cl [BS-Liab]

- COA CY: **3,50,281**  | Note CY: **â€”**  | CY Drift: **3,50,281**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **34,08,289**  | Note CY: **â€”**  | CY Drift: **34,08,289**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” other_income [PL-Inc]

- COA CY: **2,44,916**  | Note CY: **â€”**  | CY Drift: **2,44,916**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” provisions [BS-Liab]

- COA CY: **77,146**  | Note CY: **â€”**  | CY Drift: **77,146**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” revenue_ops [PL-Inc]

- COA CY: **94,61,075**  | Note CY: **â€”**  | CY Drift: **94,61,075**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **24,93,821**  | Note CY: **â€”**  | CY Drift: **24,93,821**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### ORVIX TECHNOLOGIES PRIVATE LIMITED (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **1,50,057**  | Note CY: **â€”**  | CY Drift: **1,50,057**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### PRINCESS GEMS EXPORTS LIMITED (2025-26) â€” borrowings [BS-Liab]

- COA CY: **2,63,000**  | Note CY: **â€”**  | CY Drift: **2,63,000**
- COA PY: **2,63,000**  | Note PY: **â€”**  | PY Drift: **2,63,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### PRINCESS GEMS EXPORTS LIMITED (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **24,539**  | Note CY: **â€”**  | CY Drift: **24,539**
- COA PY: **25,188**  | Note PY: **â€”**  | PY Drift: **25,188**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### PRINCESS GEMS EXPORTS LIMITED (2025-26) â€” investments [BS-Asst]

- COA CY: **20,000**  | Note CY: **â€”**  | CY Drift: **20,000**
- COA PY: **20,000**  | Note PY: **â€”**  | PY Drift: **20,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### PRINCESS GEMS EXPORTS LIMITED (2025-26) â€” other_cl [BS-Liab]

- COA CY: **90,800**  | Note CY: **â€”**  | CY Drift: **90,800**
- COA PY: **67,000**  | Note PY: **â€”**  | PY Drift: **67,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### PRINCESS GEMS EXPORTS LIMITED (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **24,449**  | Note CY: **â€”**  | CY Drift: **24,449**
- COA PY: **24,449**  | Note PY: **â€”**  | PY Drift: **24,449**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### PRINCESS GEMS EXPORTS LIMITED (2025-26) â€” provisions [BS-Liab]

- COA CY: **10,900**  | Note CY: **â€”**  | CY Drift: **10,900**
- COA PY: **10,900**  | Note PY: **â€”**  | PY Drift: **10,900**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### REVTI INFRA (2025-26) â€” borrowings [BS-Liab]

- COA CY: **24,05,64,571**  | Note CY: **48,11,29,142**  | CY Drift: **-24,05,64,571**
- COA PY: **20,90,02,376**  | Note PY: **41,80,04,752**  | PY Drift: **-20,90,02,376**
- Patterns: **P7**  | attachedTo flag: y (40)

  - No known pattern matched; manual review needed.

### REVTI INFRA (2025-26) â€” cogs [PL-Exp]

- COA CY: **3,30,74,567**  | Note CY: **54,27,56,666**  | CY Drift: **-50,96,82,099**
- COA PY: **2,81,80,713**  | Note PY: **18,14,71,776**  | PY Drift: **-15,32,91,063**
- Patterns: **P3**  | attachedTo flag: y (23)

  - CY stale note source 1 (sum 28,45,00,000): Work in Progress=28,45,00,000

### REVTI INFRA (2025-26) â€” loans_advances [BS-Asst]

- COA CY: **7,54,83,871**  | Note CY: **15,09,67,742**  | CY Drift: **-7,54,83,871**
- COA PY: **3,04,84,638**  | Note PY: **6,09,69,276**  | PY Drift: **-3,04,84,638**
- Patterns: **P7**  | attachedTo flag: y (6)

  - No known pattern matched; manual review needed.

### SALIENT INFRATECH (2025-26) â€” cogs [PL-Exp]

- COA CY: **4,03,39,600**  | Note CY: **42,91,17,753**  | CY Drift: **-38,87,78,153**
- COA PY: **5,72,26,020**  | Note PY: **29,22,74,155**  | PY Drift: **-23,50,48,135**
- Patterns: **P3**  | attachedTo flag: y (15)

  - CY stale note source 1 (sum 23,14,02,042): Work in Progress=23,14,02,042

### SATVA BUILDCON (2025-26) â€” cogs [PL-Exp]

- COA CY: **94,92,604**  | Note CY: **19,02,89,144**  | CY Drift: **-18,07,96,540**
- COA PY: **11,00,87,507**  | Note PY: **33,79,46,507**  | PY Drift: **-22,78,59,000**
- Patterns: **P3**  | attachedTo flag: y (23)

  - CY stale note source 1 (sum 5,70,33,340): WORK-IN-PROGRESS=5,70,33,340

### SATVA BUILDCON (2025-26) â€” provisions [BS-Liab]

- COA CY: **95,587**  | Note CY: **95,587**  | CY Drift: **0**
- COA PY: **2,80,462**  | Note PY: **1,07,587**  | PY Drift: **1,72,875**
- Patterns: **P2**  

  - PY missing 3 ledger(s) sum 1,72,875: UNPAID AUDIT FEE=25,000; UNPAID ELECTRIC EXPENSES=37,875; UNPAID PROFESSIONAL FEE=1,10,000

### SHIVASHRAY DEVELOPERS (2025-26) â€” cogs [PL-Exp]

- COA CY: **3,49,53,002**  | Note CY: **27,08,39,792**  | CY Drift: **-23,58,86,790**
- COA PY: **7,63,21,328**  | Note PY: **16,96,39,936**  | PY Drift: **-9,33,18,608**
- Patterns: **P3**  | attachedTo flag: y (18)

  - CY stale note source 1 (sum 14,25,68,182): Work in Progress=14,25,68,182

### SHREE HARI INFRA (2025-26) â€” cogs [PL-Exp]

- COA CY: **5,39,69,499**  | Note CY: **1,03,05,00,299**  | CY Drift: **-97,65,30,800**
- COA PY: **9,75,58,954**  | Note PY: **1,06,47,11,754**  | PY Drift: **-96,71,52,800**
- Patterns: **P3**  | attachedTo flag: y (27)

  - CY stale note source 1 (sum 47,60,00,000): Work in Progress=47,60,00,000

### SHREE MARUTI INFRA (2025-26) â€” cogs [PL-Exp]

- COA CY: **69,090**  | Note CY: **5,56,19,090**  | CY Drift: **-5,55,50,000**
- COA PY: **12,52,573**  | Note PY: **7,22,55,573**  | PY Drift: **-7,10,03,000**
- Patterns: **P3**  | attachedTo flag: y (3)

  - CY stale note source 1 (sum 2,40,00,000): WORK IN PROGRESS=2,40,00,000

### SHREEYAM INFRA (2025-26) â€” borrowings [BS-Liab]

- COA CY: **83,05,010**  | Note CY: **1,66,10,020**  | CY Drift: **-83,05,010**
- COA PY: **83,05,010**  | Note PY: **1,66,10,020**  | PY Drift: **-83,05,010**
- Patterns: **P7**  | attachedTo flag: y (11)

  - No known pattern matched; manual review needed.

### SHREEYAM INFRA (2025-26) â€” cogs [PL-Exp]

- COA CY: **2,68,270**  | Note CY: **39,74,68,270**  | CY Drift: **-39,72,00,000**
- COA PY: **35,77,334**  | Note PY: **62,65,77,334**  | PY Drift: **-62,30,00,000**
- Patterns: **P3**  | attachedTo flag: y (18)

  - CY stale note source 1 (sum 14,42,00,000): WORK IN PROGRESS=14,42,00,000

### SHREEYAM INFRA (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **-1,36,70,637**  | Note CY: **-1,36,70,637**  | CY Drift: **0**
- COA PY: **-4,26,10,699**  | Note PY: **-4,25,13,791**  | PY Drift: **-96,908**
- Patterns: **P7**  

  - No known pattern matched; manual review needed.

### SHREEYAM INFRA (2025-26) â€” revenue_ops [PL-Inc]

- COA CY: **17,70,00,000**  | Note CY: **17,70,00,000**  | CY Drift: **0**
- COA PY: **20,45,73,400**  | Note PY: **35,13,47,400**  | PY Drift: **-14,67,74,000**
- Patterns: **P7**  

  - No known pattern matched; manual review needed.

### SHRI RAM PRODUCTS (2025-26) â€” cogs [PL-Exp]

- COA CY: **3,32,96,998**  | Note CY: **3,78,10,506**  | CY Drift: **-45,13,508**
- COA PY: **2,89,50,809**  | Note PY: **3,04,74,849**  | PY Drift: **-15,24,040**
- Patterns: **P3**  | attachedTo flag: y (4)

  - CY stale note source 1 (sum 23,58,648): Closing Stock=23,58,648

### SHUBHAM BUILDCON (2025-26) â€” cogs [PL-Exp]

- COA CY: **2,21,47,716**  | Note CY: **21,95,54,035**  | CY Drift: **-19,74,06,318**
- COA PY: **8,50,43,499**  | Note PY: **17,02,62,971**  | PY Drift: **-8,52,19,472**
- Patterns: **P3**  | attachedTo flag: y (5)

  - CY stale note source 1 (sum 11,21,86,846): WORK IN PROGRESS=11,21,86,846

### SIX VISION SOFTWARE PRIVATE LIMITED (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **3,84,365**  | Note CY: **â€”**  | CY Drift: **3,84,365**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SIX VISION SOFTWARE PRIVATE LIMITED (2025-26) â€” employee_exp [PL-Exp]

- COA CY: **12,38,970**  | Note CY: **â€”**  | CY Drift: **12,38,970**
- COA PY: **no shell**  | Note PY: **â€”**  | PY Drift: **â€”**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SIX VISION SOFTWARE PRIVATE LIMITED (2025-26) â€” other_ca [BS-Asst]

- COA CY: **47,584**  | Note CY: **â€”**  | CY Drift: **47,584**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SIX VISION SOFTWARE PRIVATE LIMITED (2025-26) â€” other_cl [BS-Liab]

- COA CY: **1,00,000**  | Note CY: **â€”**  | CY Drift: **1,00,000**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SIX VISION SOFTWARE PRIVATE LIMITED (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **1,23,273**  | Note CY: **â€”**  | CY Drift: **1,23,273**
- COA PY: **no shell**  | Note PY: **â€”**  | PY Drift: **â€”**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SIX VISION SOFTWARE PRIVATE LIMITED (2025-26) â€” provisions [BS-Liab]

- COA CY: **1,29,673**  | Note CY: **â€”**  | CY Drift: **1,29,673**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SIX VISION SOFTWARE PRIVATE LIMITED (2025-26) â€” revenue_ops [PL-Inc]

- COA CY: **14,54,396**  | Note CY: **â€”**  | CY Drift: **14,54,396**
- COA PY: **no shell**  | Note PY: **â€”**  | PY Drift: **â€”**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SIX VISION SOFTWARE PRIVATE LIMITED (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **19,123**  | Note CY: **â€”**  | CY Drift: **19,123**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SIX VISION SOFTWARE PRIVATE LIMITED (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **9,000**  | Note CY: **â€”**  | CY Drift: **9,000**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SKYLARK CORPORATION (2025-26) â€” cogs [PL-Exp]

- COA CY: **6,21,73,641**  | Note CY: **76,02,85,264**  | CY Drift: **-69,81,11,623**
- COA PY: **4,98,34,050**  | Note PY: **59,06,77,328**  | PY Drift: **-54,08,43,279**
- Patterns: **P3**  | attachedTo flag: y (25)

  - CY stale note source 1 (sum 40,90,00,000): Work in Progress=40,90,00,000

### SKYLARK CORPORATION (2025-26) â€” other_cl [BS-Liab]

- COA CY: **13,55,46,875**  | Note CY: **12,23,375**  | CY Drift: **13,43,23,500**
- COA PY: **-28,92,896**  | Note PY: **-25,59,50,505**  | PY Drift: **25,30,57,609**
- Patterns: **P7**  | attachedTo flag: y (6)

  - No known pattern matched; manual review needed.

### SKYLARK CORPORATION (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **6,58,49,271**  | Note CY: **6,58,49,271**  | CY Drift: **0**
- COA PY: **2,93,73,677**  | Note PY: **2,94,03,091**  | PY Drift: **-29,414**
- Patterns: **P7**  

  - No known pattern matched; manual review needed.

### SKYLARK CORPORATION (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **5,02,61,618**  | Note CY: **6,13,27,634**  | CY Drift: **-1,10,66,016**
- COA PY: **1,57,02,248**  | Note PY: **1,57,02,248**  | PY Drift: **0**
- Patterns: **P7**  | attachedTo flag: y (89)

  - No known pattern matched; manual review needed.

### SUKIRTI DEVELOPERS (2025-26) â€” borrowings [BS-Liab]

- COA CY: **24,21,469**  | Note CY: **48,42,938**  | CY Drift: **-24,21,469**
- COA PY: **14,02,99,861**  | Note PY: **28,05,99,723**  | PY Drift: **-14,02,99,861**
- Patterns: **P7**  | attachedTo flag: y (2)

  - No known pattern matched; manual review needed.

### SUKIRTI DEVELOPERS (2025-26) â€” cogs [PL-Exp]

- COA CY: **6,31,85,440**  | Note CY: **73,55,67,883**  | CY Drift: **-67,23,82,443**
- COA PY: **52,94,305**  | Note PY: **59,38,21,477**  | PY Drift: **-58,85,27,172**
- Patterns: **P3**  | attachedTo flag: y (9)

  - CY stale note source 1 (sum 36,43,51,271): Opening Stock=36,43,51,271

### SUKIRTI DEVELOPERS (2025-26) â€” loans_advances [BS-Asst]

- COA CY: **40,61,645**  | Note CY: **56,47,430**  | CY Drift: **-15,85,785**
- COA PY: **21,23,085**  | Note PY: **37,08,870**  | PY Drift: **-15,85,785**
- Patterns: **P7**  | attachedTo flag: y (1)

  - No known pattern matched; manual review needed.

### SWADESHI COSMETICS PRIVATE LIMITED (2025-26) â€” borrowings [BS-Liab]

- COA CY: **2,01,500**  | Note CY: **â€”**  | CY Drift: **2,01,500**
- COA PY: **2,01,500**  | Note PY: **â€”**  | PY Drift: **2,01,500**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI COSMETICS PRIVATE LIMITED (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **18,963**  | Note CY: **â€”**  | CY Drift: **18,963**
- COA PY: **18,963**  | Note PY: **â€”**  | PY Drift: **18,963**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI COSMETICS PRIVATE LIMITED (2025-26) â€” cogs [PL-Exp]

- COA CY: **12,400**  | Note CY: **â€”**  | CY Drift: **12,400**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI COSMETICS PRIVATE LIMITED (2025-26) â€” other_cl [BS-Liab]

- COA CY: **39,200**  | Note CY: **â€”**  | CY Drift: **39,200**
- COA PY: **26,800**  | Note PY: **â€”**  | PY Drift: **26,800**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI COSMETICS PRIVATE LIMITED (2025-26) â€” provisions [BS-Liab]

- COA CY: **10,900**  | Note CY: **â€”**  | CY Drift: **10,900**
- COA PY: **10,900**  | Note PY: **â€”**  | PY Drift: **10,900**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI HERBS AND COSMETICS PRIVATE LIMITED (2025-26) â€” cash_bank [BS-Asst]

- COA CY: **2,25,951**  | Note CY: **â€”**  | CY Drift: **2,25,951**
- COA PY: **2,27,600**  | Note PY: **â€”**  | PY Drift: **2,27,600**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI HERBS AND COSMETICS PRIVATE LIMITED (2025-26) â€” loans_advances [BS-Asst]

- COA CY: **15,000**  | Note CY: **â€”**  | CY Drift: **15,000**
- COA PY: **15,000**  | Note PY: **â€”**  | PY Drift: **15,000**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI HERBS AND COSMETICS PRIVATE LIMITED (2025-26) â€” other_cl [BS-Liab]

- COA CY: **10,900**  | Note CY: **â€”**  | CY Drift: **10,900**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI HERBS AND COSMETICS PRIVATE LIMITED (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **12,549**  | Note CY: **â€”**  | CY Drift: **12,549**
- COA PY: **0**  | Note PY: **â€”**  | PY Drift: **0**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI HERBS AND COSMETICS PRIVATE LIMITED (2025-26) â€” provisions [BS-Liab]

- COA CY: **10,900**  | Note CY: **â€”**  | CY Drift: **10,900**
- COA PY: **10,900**  | Note PY: **â€”**  | PY Drift: **10,900**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI HERBS AND COSMETICS PRIVATE LIMITED (2025-26) â€” trade_receivables [BS-Asst]

- COA CY: **12,47,148**  | Note CY: **â€”**  | CY Drift: **12,47,148**
- COA PY: **12,47,148**  | Note PY: **â€”**  | PY Drift: **12,47,148**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWADESHI LABORATORIES PRIVATE LIMITED (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **493**  | Note CY: **â€”**  | CY Drift: **493**
- COA PY: **13,049**  | Note PY: **â€”**  | PY Drift: **13,049**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

### SWASTIK BUILDCON (2025-26) â€” cogs [PL-Exp]

- COA CY: **90,99,551**  | Note CY: **13,58,09,551**  | CY Drift: **-12,67,10,000**
- COA PY: **42,54,669**  | Note PY: **16,42,70,203**  | PY Drift: **-16,00,15,534**
- Patterns: **P3**  | attachedTo flag: y (13)

  - CY stale note source 1 (sum 6,21,60,000): WIP=6,21,60,000

### SWASTIK BUILDCON (2025-26) â€” other_expenses [PL-Exp]

- COA CY: **94,73,287**  | Note CY: **94,73,376**  | CY Drift: **-88**
- COA PY: **5,66,193**  | Note PY: **5,66,409**  | PY Drift: **-216**
- Patterns: **P7**  | attachedTo flag: y (3)

  - No known pattern matched; manual review needed.

### SWENI CORPORATION (2025-26) â€” trade_payables [BS-Liab]

- COA CY: **4,99,896**  | Note CY: **â€”**  | CY Drift: **4,99,896**
- COA PY: **4,99,896**  | Note PY: **â€”**  | PY Drift: **4,99,896**
- Patterns: **P5**  

  - Note row absent from nce_financial_notes.

---
*End of report â€” READ-ONLY, no data modified.*