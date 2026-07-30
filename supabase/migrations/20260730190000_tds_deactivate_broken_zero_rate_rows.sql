-- Data-hygiene fix, same pattern as the earlier 194F / malformed-92B /
-- mis-filed-194C-under-24Q corrections: rows found via a null-
-- nature_of_payment audit are broken, not legitimately description-less.
--
-- NOTE: "92A" was investigated in the same audit and is DELIBERATELY NOT
-- touched here. It has 667 real tds_deductees rows (570 created the same
-- day as this migration), with widely varying effective rates (5-11%,
-- consistent with slab-based salary tax, not a flat rate) despite
-- rate_of_tds=0 on the rate_master row. Traced to genius-import.ts's
-- ensureRateMasterSections() — a deliberate safety net that auto-creates a
-- rate=0% placeholder (with an explicit "please verify" warning) for any
-- imported section code its seed table doesn't recognise, rather than
-- silently guessing. This looks like live, active salary TDS data that
-- needs a human decision on what "92A" should actually map to (192 Salary?
-- something else in Genius's own coding?) before anything is changed —
-- deactivating it now would repeat the exact blank-dropdown mistake this
-- session already made once and corrected for 194C.
--
-- bare "194I" / "194J" (FY2025-26, 26Q, created 2026-07-18): vestigial
-- parent-category rows predating the 194I(a)/(b) and 194J(a)/(b) split,
-- both rate=0%, ZERO real tds_deductees rows reference either (confirmed
-- before applying this). The split rows already cover every real case;
-- these two have no purpose left and would silently apply 0% TDS if ever
-- selected by mistake. User-confirmed via AskUserQuestion (2026-07-30) to
-- deactivate, not delete, matching prior precedent.

UPDATE tds_rate_master SET is_active=false,
  notes=coalesce(notes || ' | ', '') || 'Deactivated: vestigial 0%-rate parent row predating the (a)/(b) split, which already covers every real case. Found via a null-nature_of_payment audit, migration 20260730190000.'
  WHERE id IN ('e0e197b4-6684-40a4-9e8e-f77fc0c01308', '44a99987-486c-40d0-a4fd-3bca281335a5');
