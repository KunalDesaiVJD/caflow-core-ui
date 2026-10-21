-- Noise reduction found by the end-to-end smoke test on real data (ACCUPANELS ENERGY):
-- three rules were flooding. Retarget them to the intended, practical population. Idempotent.

-- CRED-004 "Creditor Without Purchase Entry": per-voucher matching false-flagged legitimate
-- expense-to-creditor bookings (real expense ledgers are not named "expense"). Retarget to the
-- party-level stream_gap: a creditor with bank/cash movement but no purchase leg at all.
update scrutiny_rules set detection_logic =
  '{"check":"stream_gap","scope":{"parent_group_keywords":["creditor","payable"]},"present":["bank","cash"],"missing":["purchase"]}'
where rule_id = 'CRED-004';

-- BKR-DUP-01 duplicate ledgers: only compare ledgers that carry a balance, and tighten similarity.
update scrutiny_rules set detection_logic =
  '{"check":"duplicate_ledger","scope":{"nonzero":true},"min_similarity":0.85}'
where rule_id = 'BKR-DUP-01';

-- EXP-003 "Repairs >5L should be capital": single_txn can't scope to a ledger, so it flagged EVERY
-- voucher over 5L. Retarget to an expr scoped to repair/maintenance/renovation ledgers.
update scrutiny_rules set detection_logic =
  '{"check":"expr","grain":"account","scope":{"ledger_keywords":["repair","maintenance","renovation"]},"where":[{"field":"abs_closing","op":">","value":500000}]}'
where rule_id = 'EXP-003';
