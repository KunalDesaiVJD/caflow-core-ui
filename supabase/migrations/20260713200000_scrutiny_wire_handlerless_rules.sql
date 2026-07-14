-- Wire the 16 handler-less scrutiny rules to real engine handlers.
-- Engine adds: no_corresponding_entry (cross-leg), adequacy (actual vs base x pct), related_party
-- (reads the related_parties master; honest needs-data advisory until captured), balance_decreased.
-- Plus aliases: msme_payment_delay/inventory_ageing -> ageing, guarantee_disclosure -> keyword_balance.
-- Idempotent.

-- ── Cross-leg: one side booked, counterpart missing ────────────────────────────
update scrutiny_rules set detection_logic =
  '{"check":"no_corresponding_entry","primary":["purchase"],"counterpart":["creditor","payable","cash","bank"],"min_amount":1000}'
where rule_id = 'EXP-001';

update scrutiny_rules set detection_logic =
  '{"check":"no_corresponding_entry","primary":["creditor","payable"],"counterpart":["purchase","expense","cash","bank"],"min_amount":1000}'
where rule_id = 'CRED-004';

update scrutiny_rules set detection_logic =
  '{"check":"no_corresponding_entry","primary":["sales","income","revenue"],"counterpart":["debtor","receivable","cash","bank"],"min_amount":1000}'
where rule_id = 'DEBT-004';

-- loan repayment (payment voucher touching a loan) with no interest leg
update scrutiny_rules set detection_logic =
  '{"check":"repayment_without_interest","scope":{"voucher_type":["payment"]},"primary":["loan","borrow"],"counterpart":["interest"],"min_amount":1000}'
where rule_id = 'LOAN-003';

-- ── Statutory adequacy (actual vs base x pct); needs-data advisory when base absent ──
update scrutiny_rules set detection_logic =
  '{"check":"dividend_adequacy","actual":{"ledger_keywords":["dividend"]},"base":{"parent_group_keywords":["reserve","surplus"]},"pct":100,"op":">"}'
where rule_id = 'CAP-002';

update scrutiny_rules set detection_logic =
  '{"check":"drr_adequacy","actual":{"ledger_keywords":["debenture redemption","drr"]},"base":{"ledger_keywords":["debenture"]},"pct":25,"op":"<"}'
where rule_id = 'CAP-007';

update scrutiny_rules set detection_logic =
  '{"check":"remuneration_limit","actual":{"ledger_keywords":["director remuneration","managerial remuneration","director salary"]},"base":{"parent_group_keywords":["sales","income","revenue"]},"base_less":{"parent_group_keywords":["expense","purchase","indirect","direct"]},"pct":11,"op":">","min_base":1}'
where rule_id = 'RPT-004';

update scrutiny_rules set detection_logic =
  '{"check":"partner_remuneration_limit","actual":{"ledger_keywords":["partner remuneration","remuneration to partner","partner salary"]},"base":{"parent_group_keywords":["sales","income","revenue"]},"base_less":{"parent_group_keywords":["expense","purchase","indirect","direct"]},"pct":60,"op":">","min_base":1}'
where rule_id = 'PAY-007';

-- ── Reserve utilised during the year (securities premium, Sec 52) ─────────────
update scrutiny_rules set detection_logic =
  '{"check":"premium_utilization","scope":{"ledger_keywords":["securities premium","share premium"]},"min_drop":1}'
where rule_id = 'CAP-003';

-- ── Related-party family (one handler; mode = scope). Honest needs-data until RP list captured ──
update scrutiny_rules set detection_logic = '{"check":"rpt_disclosure_missing"}' where rule_id = 'RPT-003';
update scrutiny_rules set detection_logic =
  '{"check":"guarantee_related_party","scope":{"ledger_keywords":["guarantee"]}}' where rule_id = 'RPT-006';
update scrutiny_rules set detection_logic =
  '{"check":"investment_related_party","scope":{"parent_group_keywords":["investment"]}}' where rule_id = 'RPT-007';
update scrutiny_rules set detection_logic =
  '{"check":"related_party_sales","scope":{"parent_group_keywords":["debtor","receivable","sales"]}}' where rule_id = 'SALES-007';

-- ── Aliases onto existing handlers ────────────────────────────────────────────
-- MSME 45-day: list creditors outstanding beyond 45 days; the auditor confirms Udyam/MSME status.
update scrutiny_rules set detection_logic =
  '{"check":"msme_payment_delay","scope":{"parent_group_keywords":["creditor","payable"]},"days":45,"min_balance":1000}',
  audit_query_template = 'Creditor "{account}" (Rs {amount}) has been outstanding beyond 45 days. Confirm whether the party is MSME (Udyam) - if so, interest u/s 16 MSMED applies and the amount is disallowable u/s 43B(h) until paid; disclose in the MSME note.'
where rule_id = 'CRED-003';

update scrutiny_rules set detection_logic =
  '{"check":"inventory_ageing","scope":{"parent_group_keywords":["stock","inventory"]},"days":180,"min_balance":1000}'
where rule_id = 'INV-002';

update scrutiny_rules set detection_logic =
  '{"check":"guarantee_disclosure","keywords":["guarantee","secured loan","personal guarantee"],"nonzero":true}'
where rule_id = 'LOAN-006';
