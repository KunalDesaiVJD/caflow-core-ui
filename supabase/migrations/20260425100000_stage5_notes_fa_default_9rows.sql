-- UI-6 Phase 6 — Extend stage5_notes FA default from 4 rows to 9 rows.
-- Matches FS NOTES.xlsx template (Land, Factory Building, Plant & Machinery,
-- Electric Equipments, Computers, Office Equipment, Furniture & Fixtures,
-- Vehicles, Software). Only affects NEW engagements; existing rows keep
-- whatever they had (the in-app loader merges defaults into legacy rows).

ALTER TABLE audit_engagements
ALTER COLUMN stage5_notes
SET DEFAULT '{
  "bs_liab": {},
  "bs_asset": {},
  "pl": {},
  "fa": {
    "rows": [
      {"id":"land","particulars":"Land","useful_life":"indefinite","gross_open":0,"additions":0,"disposals":0,"depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"factory_building","particulars":"Factory Building","useful_life":30,"gross_open":0,"additions":0,"disposals":0,"depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"plant_machinery","particulars":"Plant & Machinery","useful_life":15,"gross_open":0,"additions":0,"disposals":0,"depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"electric_equipments","particulars":"Electric Equipments","useful_life":10,"gross_open":0,"additions":0,"disposals":0,"depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"computers","particulars":"Computers","useful_life":3,"gross_open":0,"additions":0,"disposals":0,"depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"office_equipment","particulars":"Office Equipment","useful_life":5,"gross_open":0,"additions":0,"disposals":0,"depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"furniture_fixtures","particulars":"Furniture and Fixtures","useful_life":10,"gross_open":0,"additions":0,"disposals":0,"depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"vehicles","particulars":"Vehicles","useful_life":8,"gross_open":0,"additions":0,"disposals":0,"depn_open":0,"depn_add":0,"depn_disp":0},
      {"id":"software","particulars":"Software","useful_life":10,"gross_open":0,"additions":0,"disposals":0,"depn_open":0,"depn_add":0,"depn_disp":0}
    ]
  },
  "auto_synced_at": null,
  "manual_edits": []
}'::jsonb;
