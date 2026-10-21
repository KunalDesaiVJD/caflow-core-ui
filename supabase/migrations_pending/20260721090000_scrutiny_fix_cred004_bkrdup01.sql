-- The two rules that between them were 25% of all findings, after everything else had been tuned.
-- Both were mis-specified rather than mis-tuned, which is why materiality barely touched them.

-- CRED-004 "Creditor Without Purchase Entry" (1,744 findings, 18.2/engagement, 3.6% alignment)
--
-- The message claims "no matching purchase/expense booked", but the rule only ever looked for a
-- leg matching "purchase". A labour contractor, a transporter or a staff-welfare vendor is settled
-- against LABOUR CHARGES, CARTING or OFFICE EXPENSE — never against a ledger named "purchase" — so
-- the whole population of expense-side creditors was flagged by construction.
--
-- Verified against the books: the flagged parties DO carry expense legs. Across a 400-finding
-- sample the counterpart ledgers were "advertisement exp - 18%" (766), "staff welfare@ nil rate"
-- (563), "travelling expense" (477), "office expense" (472), "carting & transportation" (148) and
-- "labour expense - urd" (141). Every one is a real expense booking the rule could not see.
--
-- `missing` now covers the expense side, so the rule fires only where a creditor was paid with no
-- expense of any kind booked against it — which is the actual audit concern.
update scrutiny_rules set detection_logic = detection_logic || jsonb_build_object(
  'missing', jsonb_build_array(
    'purchase','purchases','expense','exp.','exp ','labour','labor','wages','salary','remuneration',
    'contract','job work','jobwork','freight','carting','transport','cartage','service','charges',
    'fees','commission','brokerage','rent','repair','maintenance','professional','consultancy',
    'advertisement','printing','stationery','insurance','power','fuel','material','stores'
  ))
where rule_id = 'CRED-004';

-- BKR-DUP-01 "Duplicate Same-Party Ledgers in Group" (930 findings, 11.6/engagement)
--
-- Two separate defects, neither fixable by the similarity threshold:
--
-- 1. It was flagging GST rate splits. Tally keeps one ledger per rate — "Hardware Purchase - 5%",
--    "- 12%", "- 18%", "- 28%" — which tokenise identically once short numeric tokens drop out and
--    therefore score a PERFECT 1.0. Raising min_similarity would have excluded genuine duplicates
--    long before touching these. Four rate variants of one head also yield six pairs, which is
--    where the volume came from. Now handled in the engine: pairs identical apart from rate or
--    percentage markers are skipped, while real near-duplicates still fire.
--
-- 2. It claimed "same party" but was scoped to every non-zero ledger, so expense heads such as
--    "Cement Purchase" were compared as if they were parties. Scoped to actual party groups.
--
-- min_similarity is RAISED to 0.9 as well: with rate variants excluded, the remaining pairs should
-- be close name matches rather than merely similar phrases.
update scrutiny_rules set detection_logic =
  '{"check":"duplicate_ledger","scope":{"nonzero":true,"parent_group_keywords":["creditor","debtor","payable","receivable","supplier","customer","vendor","party"]},"min_similarity":0.9}'::jsonb
where rule_id = 'BKR-DUP-01';
