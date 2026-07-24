-- Remove the analytical / trend rules outright, per the firm's instruction that scrutiny must
-- raise practical, verifiable queries only.
--
-- A finding like "expenses up 200% on last year" or "current ratio below 1" is an ANALYTICAL
-- observation, not an audit query: it names no ledger, asks the client nothing answerable, and
-- cannot be closed with a document. Human auditors do not raise them, so they were noise by
-- construction. All were already inactive and had produced zero findings; deleting them prevents
-- accidental reactivation and stops them cluttering the rule master.
delete from scrutiny_rules
where detection_logic->>'check' in
      ('month_spike','ratio','ratio_change','py_comparison','balance_decreased','frequency')
   or detection_logic ? 'vs_prior_year';

-- DEBT-007 counts round-off keyword hits with no materiality and has never produced a finding;
-- the practical version of this test is RC-201 (material amounts routed through Kasar/Round-Off).
delete from scrutiny_rules where rule_id = 'DEBT-007';
