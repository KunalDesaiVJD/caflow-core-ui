-- CRED-003 (581 findings, 8.1 per engagement) asks the auditor to confirm whether each party is an
-- MSME. The rule is honestly framed — it does not claim MSME status, it asks for it — but it asks
-- once PER PARTY. An auditor confirming Udyam registration works from a single list, so this is one
-- query per engagement, not eighty.
--
-- No MSME master exists in CAFlow yet; when one does, this becomes a determination rather than a
-- request, and the natural home for it is a scrutiny_judgments kind ('msme_status') so the answer is
-- recorded once per party and reused every year.
update scrutiny_rules set
  detection_logic = detection_logic || '{"rollup":{"metric":"total","min_count":2}}'::jsonb,
  audit_query_template = 'The following {count} trade payable balances, totalling Rs.{amount}, have been outstanding beyond 45 days ({accounts}). Please confirm which of these parties are registered as Micro or Small enterprises under the MSMED Act (Udyam). For any that are, payment beyond the 45-day limit attracts interest under section 16 of the MSMED Act, the interest is disallowable under section 23, and the outstanding principal and interest require separate disclosure under Schedule III together with the Clause 22 particulars in Form 3CD. Kindly furnish the Udyam registration certificates on record and confirm the agreed credit period with each supplier.'
where rule_id = 'CRED-003';
