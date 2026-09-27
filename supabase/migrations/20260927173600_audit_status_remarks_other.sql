-- Remarks becomes a fixed-vocabulary dropdown (Prepared / Checked / Uploaded /
-- Upload but Pending for approval / Others) instead of free text, mirroring
-- the existing audit_status / audit_status_other ("OTHERS (SPECIFY)")
-- pattern already in this table exactly.
--
-- remarks_other holds the free-text detail when "Others" is selected — same
-- role audit_status_other already plays for audit_status.
--
-- Backfill (no data is lost): any EXISTING remarks value that isn't one of
-- the 4 named presets (case-insensitive) is moved into remarks_other and
-- remarks is set to 'Others', so every current free-text remark (e.g.
-- "soum", "KUNAL", "CHECK", "Na") stays fully visible and editable under
-- Others instead of vanishing behind a dropdown that doesn't recognise it.
-- Values that already matched a preset case-insensitively get their casing
-- normalised so the dropdown selects the right option.
--
-- SAFETY: additive column + idempotent backfill (re-running only touches
-- rows still out of canonical form; a second run is a no-op).

ALTER TABLE public.audit_status ADD COLUMN IF NOT EXISTS remarks_other TEXT;

-- Preserve non-preset free text under Others.
UPDATE public.audit_status
SET remarks_other = remarks,
    remarks = 'Others'
WHERE remarks IS NOT NULL
  AND btrim(remarks) <> ''
  AND lower(btrim(remarks)) NOT IN ('prepared', 'checked', 'uploaded', 'upload but pending for approval', 'others');

-- Normalise casing for values that already matched a preset.
UPDATE public.audit_status SET remarks = 'Prepared'
  WHERE lower(btrim(remarks)) = 'prepared' AND remarks <> 'Prepared';
UPDATE public.audit_status SET remarks = 'Checked'
  WHERE lower(btrim(remarks)) = 'checked' AND remarks <> 'Checked';
UPDATE public.audit_status SET remarks = 'Uploaded'
  WHERE lower(btrim(remarks)) = 'uploaded' AND remarks <> 'Uploaded';
UPDATE public.audit_status SET remarks = 'Upload but Pending for approval'
  WHERE lower(btrim(remarks)) = 'upload but pending for approval' AND remarks <> 'Upload but Pending for approval';
UPDATE public.audit_status SET remarks = 'Others'
  WHERE lower(btrim(remarks)) = 'others' AND remarks <> 'Others';
