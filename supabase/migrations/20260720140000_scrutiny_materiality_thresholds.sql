-- Step 2: thresholds scale to the engagement, gated on human approval.
--
-- detection_logic.materiality maps dotted paths to MULTIPLES of the engagement's approved
-- performance materiality. The literal threshold stays as the fallback, so every rule behaves
-- exactly as it does today until an auditor approves materiality for that engagement — an
-- unapproved engagement degrades to current behaviour, never to silence.
--
-- Nothing below changes a single finding on its own. It takes effect only once a human approves a
-- scrutiny_judgments row of kind='materiality' for the engagement. That is deliberate: the scale
-- is a professional judgement under SA 320, not something the engine should pick.

-- CRED-004 (3,983 findings, 72/engagement, the largest single source of noise): stream_gap had NO
-- notion of size and flagged every counterparty. min_amount is now supported by the handler; set it
-- to half of performance materiality.
update scrutiny_rules set detection_logic =
  detection_logic || '{"min_amount":100000,"materiality":{"min_amount":0.5}}'::jsonb
where rule_id = 'CRED-004';

-- DEBT-STREAMGAP-01 (864): the debtor-side mirror of the same defect.
update scrutiny_rules set detection_logic =
  detection_logic || '{"min_amount":100000,"materiality":{"min_amount":0.5}}'::jsonb
where rule_id = 'DEBT-STREAMGAP-01';

-- CRED-003 (1,149): a 45-day MSME test with a Rs.1,000 floor will always flood.
update scrutiny_rules set detection_logic =
  jsonb_set(detection_logic, '{min_balance}', '50000'::jsonb) || '{"materiality":{"min_balance":0.25}}'::jsonb
where rule_id = 'CRED-003';

-- Dormant / stale balance families: a flat floor is exactly the case where entity size matters,
-- since the same rupee amount is trivial at one client and material at another.
update scrutiny_rules set detection_logic =
  detection_logic || '{"materiality":{"min_balance":0.25}}'::jsonb
where rule_id in ('DORM-201','TDS-212','DEBT-001','CRED-002','ADV-STALE-01','LIAB-STALE-01','PROV-STALE-01')
  and detection_logic ? 'min_balance';

comment on column scrutiny_rules.detection_logic is
  'Rule definition. Optional "materiality" maps dotted paths to multiples of the engagement''s approved performance materiality; literals remain the fallback when no materiality is approved.';
