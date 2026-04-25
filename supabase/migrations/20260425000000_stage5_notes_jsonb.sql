-- Phase UI-6 (Stage 5 Notes tab) — add JSONB column on audit_engagements
-- to persist note-wise schedule data. Matches the spec from the user prompt.
--
-- Layout:
--   bs_liab / bs_asset / pl  → nested key/value, e.g. bs_liab.share_capital.cy = 100000
--   fa.rows                   → AS-10 PPE movement schedule (4 default categories)
--   manual_edits              → array of dot-paths the user has overridden so the
--                               auto-sync routine can skip those during refresh.
--   auto_synced_at            → timestamp of the last auto-population run.

ALTER TABLE audit_engagements
ADD COLUMN IF NOT EXISTS stage5_notes jsonb DEFAULT '{
  "bs_liab": {},
  "bs_asset": {},
  "pl": {},
  "fa": {
    "rows": [
      {"id":"land","particulars":"Land","useful_life":"indefinite",
       "gross_open":0,"additions":0,"disposals":0,
       "depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"factory_building","particulars":"Factory Building",
       "useful_life":30,"gross_open":0,"additions":0,"disposals":0,
       "depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"plant_machinery","particulars":"Plant & Machinery",
       "useful_life":15,"gross_open":0,"additions":0,"disposals":0,
       "depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"computers","particulars":"Computers",
       "useful_life":3,"gross_open":0,"additions":0,"disposals":0,
       "depn_open":0,"depn_add":0,"depn_disp":0}
    ]
  },
  "auto_synced_at": null,
  "manual_edits": []
}'::jsonb;

-- Backfill existing rows where the column is NULL (DEFAULT only applies to new
-- inserts, not existing rows). Idempotent: only updates rows that need it.
UPDATE audit_engagements
SET stage5_notes = '{
  "bs_liab": {},
  "bs_asset": {},
  "pl": {},
  "fa": {
    "rows": [
      {"id":"land","particulars":"Land","useful_life":"indefinite",
       "gross_open":0,"additions":0,"disposals":0,
       "depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"factory_building","particulars":"Factory Building",
       "useful_life":30,"gross_open":0,"additions":0,"disposals":0,
       "depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"plant_machinery","particulars":"Plant & Machinery",
       "useful_life":15,"gross_open":0,"additions":0,"disposals":0,
       "depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"computers","particulars":"Computers",
       "useful_life":3,"gross_open":0,"additions":0,"disposals":0,
       "depn_open":0,"depn_add":0,"depn_disp":0}
    ]
  },
  "auto_synced_at": null,
  "manual_edits": []
}'::jsonb
WHERE stage5_notes IS NULL;

COMMENT ON COLUMN audit_engagements.stage5_notes IS
  'Stage 5 Notes tab data — Schedule III Division I detail schedules. '
  'Sub-keys: bs_liab, bs_asset, pl (nested k/v per note row); '
  'fa.rows (AS-10 PPE movement schedule); '
  'manual_edits (paths the user has overridden — auto-resync skips these); '
  'auto_synced_at (last auto-population run).';
