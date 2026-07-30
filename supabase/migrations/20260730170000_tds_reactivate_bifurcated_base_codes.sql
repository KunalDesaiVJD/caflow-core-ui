-- Fixes a real regression from migration 20260730130000: deactivating the
-- plain "194C" (24Q + 26Q) and "194R" (26Q) FY2026-27 rows broke the Section
-- dropdown for every EXISTING deductee entry already saved with that plain
-- section_code — the Select can't render a value that matches no active
-- option, so it shows blank, even though the underlying stored data was
-- never touched or deleted. ("194A" was already reactivated by the earlier
-- correction migration 20260730131500.)
--
-- Fix: reactivate the plain codes so existing entries render correctly
-- again. They now coexist with the new bifurcated 194C(a)/(b), 194R(a)/(b)
-- options — a user editing an existing entry keeps seeing its original
-- section; a NEW entry can pick either the plain code or the more precise
-- lettered Section 393 option. No data was ever deleted by either
-- migration; this only flips is_active back on.

UPDATE tds_rate_master SET is_active=true,
  notes=regexp_replace(coalesce(notes, ''), ' ?\| ?Superseded for FY2026-27 by Section 393 payment-code bifurcation \(194C\(a\)/\(b\)\) — see migration 20260730130000\.', '')
  WHERE section_code='194C' AND financial_year='2026-27';

UPDATE tds_rate_master SET is_active=true,
  notes=regexp_replace(coalesce(notes, ''), ' ?\| ?Superseded for FY2026-27 by Section 393 payment-code bifurcation \(194R\(a\)/\(b\)\) — see migration 20260730130000\.', '')
  WHERE section_code='194R' AND financial_year='2026-27';

UPDATE tds_rate_master SET notes=NULL WHERE notes='' AND section_code IN ('194C','194R') AND financial_year='2026-27';
