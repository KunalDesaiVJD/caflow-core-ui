-- Second batch of Section 393 payment-code labels, from a fresh double-
-- blind research + adjudication pass (independent of the user's own PDF,
-- which only covered ~15 sections) on the remaining sections. FY2026-27
-- only, same as the first batch — the reform is prospective.
--
-- 13 of the 14 candidates this pass produced are applied here. The 14th
-- (194O = code 1035) is DELIBERATELY EXCLUDED: it collides with 194R(b),
-- which already carries code 1035 from the user's own verified PDF
-- (migration 20260730130000) — two different sections cannot share one
-- payment code, so this is very likely a research error (194O and 194R
-- sit in adjacent table rows under 393(1), an easy mix-up), not a genuine
-- conflict to resolve by picking a side. 194O keeps its plain description
-- pending a cleaner source.
--
-- Confidence varies per section — 11 were corroborated by 2+ reasonably
-- independent sources with no caveats; 194DA/196A carry a "medium
-- confidence" flag from the adjudicator (single strong source + internal
-- consistency, no primary CBDT text located). All are still materially
-- more verified than a single-document guess.

UPDATE tds_rate_master SET payment_code='1058', new_section_code='393(3) [Table: Sl. No. 1]',
  new_section_description='Winnings from lottery, crossword puzzles, card games and other games'
  WHERE section_code='194B' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1062', new_section_code='393(3) [Table: S.No. 3]',
  new_section_description='Winnings from horse races'
  WHERE section_code='194BB' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1005', new_section_code='393(1) [Table: S.No. 1(i)]',
  new_section_description='Insurance commission'
  WHERE section_code='194D' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1030', new_section_code='393(1) [Table: Sl. No. 8(i)]',
  new_section_description='Payment in respect of life insurance policy (maturity proceeds)'
  WHERE section_code='194DA' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1063', new_section_code='393(3) [Table: S.No. 4]',
  new_section_description='Commission on sale of lottery tickets'
  WHERE section_code='194G' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1011', new_section_code='393(1) [Table: S.N. 3(ii)]',
  new_section_description='Payment under a Joint Development Agreement (JDA)'
  WHERE section_code='194IC' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1013', new_section_code='393(1) [Table: Sl. No. 4(i)]',
  new_section_description='Income from units of a mutual fund'
  WHERE section_code='194K' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1012', new_section_code='393(1) [Table: S.No. 3(iii)]',
  new_section_description='Compensation on compulsory acquisition of certain immovable property'
  WHERE section_code='194LA' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1044', new_section_code='393(2) [Table: S.No. 5]',
  new_section_description='Interest from an infrastructure debt fund'
  WHERE section_code='194LB' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1037', new_section_code='393(1) [Table: Sl. No. 8(vi)]',
  new_section_description='Consideration for transfer of a virtual digital asset (crypto)'
  WHERE section_code='194S' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1057', new_section_code='393(2) [Table: Sl. No. 17]',
  new_section_description='Payment to a non-resident (other than salary)'
  WHERE section_code='195' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1050', new_section_code='393(2)',
  new_section_description='Income from units of a specified mutual fund/UTI paid to a non-resident'
  WHERE section_code='196A' AND financial_year='2026-27';

UPDATE tds_rate_master SET payment_code='1055', new_section_code='393(2) [Table: Sl. No. 15]',
  new_section_description='Income of Foreign Institutional Investors from securities'
  WHERE section_code='196D' AND financial_year='2026-27';
