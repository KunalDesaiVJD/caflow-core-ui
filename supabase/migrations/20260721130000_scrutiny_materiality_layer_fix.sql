-- Materiality was applied at the wrong layer, and it cost coverage.
--
-- Measured against the firm's own queries: of those quoting an amount the MEDIAN is Rs.8,260, 73%
-- are under Rs.50,000, and the smallest is Rs.6. Meanwhile materiality scaling pushed CRED-004's
-- floor to Rs.6,50,000 and DORM-201's to Rs.3,25,000 at a mid-size engagement. The rules could not
-- see the population the auditors actually query.
--
-- An audit query is not a materiality judgement. A Rs.420 TDS short-deduction is a compliance
-- breach at any size; a Rs.26 kasar transfer is a bookkeeping question at any size. Materiality
-- decides what is worth REPORTING to the client, not what is worth DETECTING — and the two-tier
-- split already provides that: triage caps the client-facing list, everything else stays a review
-- note, searchable and promotable.
--
-- So detection floors come back down to a genuinely trivial level, and materiality governs ranking
-- instead. Nothing is lost: large items still outrank small ones for the shortlist, but a small
-- compliance breach is now findable rather than filtered out before anyone sees it.

-- Compliance and bookkeeping-quality rules: detect at a trivial floor, no materiality scaling.
update scrutiny_rules
set detection_logic = (detection_logic - 'materiality')
      || jsonb_build_object(coalesce(case when detection_logic ? 'min_amount' then 'min_amount' end, 'min_balance'), 2000)
where rule_id in ('TDS-212','CRED-002','DEBT-001','PROV-STALE-01','LIAB-STALE-01','ADV-STALE-01');

-- Party-stream rules keep a floor high enough to stay reviewable but far below materiality.
update scrutiny_rules
set detection_logic = (detection_logic - 'materiality') || '{"min_amount":25000}'::jsonb
where rule_id in ('CRED-004','DEBT-STREAMGAP-01');

-- Balance-quality rules: size genuinely is the measure here (a tiny dormant balance is not worth a
-- query), so materiality is retained but the multiplier drops to a tenth of performance materiality.
update scrutiny_rules
set detection_logic = detection_logic || '{"materiality":{"min_balance":0.1}}'::jsonb
where rule_id in ('DORM-201','DEBT-005','CRED-003');
