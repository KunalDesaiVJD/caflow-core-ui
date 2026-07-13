-- Prepared By (preparer_id) and Filed By (checker_id) now reflect ONLY the
-- current status: Prepared By is populated only while a filing is "Reviewed",
-- Filed By only while it is "Filed". The previous behaviour left these values
-- populated after the status moved away. Clear any such stale values so existing
-- rows match the new rule (e.g. a "Filed By" name showing under a "Data Received"
-- status). Idempotent: re-running only clears values that violate the rule.
UPDATE public.tds_filings SET preparer_id = NULL
 WHERE preparer_id IS NOT NULL AND work_status <> 'Reviewed';

UPDATE public.tds_filings SET checker_id = NULL
 WHERE checker_id IS NOT NULL AND work_status <> 'Filed';
