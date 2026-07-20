-- Two pre-existing rules were producing ~2,059 findings (10.5% of the entire corpus) that are
-- almost entirely false positives. Both were found by adjudicating human audit queries against
-- the AI findings on the same engagements.
--
-- EXP-003 "Repairs >5L - Should Be Capital?"  (859 findings)
--   keywords_ledger_synonyms held a GENERIC boilerplate list -- expense, rent, depreciation,
--   interest, commission ... -- unrelated to repairs. ruleFromRow ORs that column into
--   scope.ledger_keywords whenever the rule has no parent_group condition, so the list WIDENED the
--   rule instead of translating Tally names for it. Combined with substring matching this flagged
--   "HDFC Bank - Current Account" (the synonym "rent" is a substring of "Cur-RENT-"), plus every
--   Salary, Depreciation and Income Tax ledger over the threshold.
--   Replaced with genuine repair-family synonyms.
--
-- EXP-004 "Personal Expenses in Business"  (1,200 findings)
--   The narration keyword "private" matches "PRIVATE LIMITED" in virtually every company name, so
--   a Rs.2,00,00,000 NEFT to "CLEAR QUANT TECHNOLOGIES PRIVATE LIMITED" was reported as a personal
--   expense. Dropped "private" and "home" (which matches "Homeopathy", "Home Loan" and similar) in
--   favour of terms that actually denote a personal-nature debit, and gave it repair-free synonyms.
--
-- EXP-001 / EXP-006 carried the same boilerplate synonym list; corrected for consistency even
-- though their current volume is low (38 and 0).

update scrutiny_rules
set keywords_ledger_synonyms = 'repairs,repair charges,repairs & maintenance,repairs and maintenance,r&m,maintenance charges,renovation,refurbishment,overhauling,servicing charges'
where rule_id = 'EXP-003';

update scrutiny_rules
set detection_logic = '{"check":"keyword_narration","keywords":["personal","household","domestic","family expense","drawings","personal use","self use"]}'::jsonb,
    keywords_ledger_synonyms = 'drawings,personal expense,personal drawings,household expense,domestic expense'
where rule_id = 'EXP-004';

update scrutiny_rules
set keywords_ledger_synonyms = 'purchase,purchases,purchase account,goods purchase,raw material purchase,trading purchase'
where rule_id = 'EXP-001';

update scrutiny_rules
set keywords_ledger_synonyms = null
where rule_id = 'EXP-006';
