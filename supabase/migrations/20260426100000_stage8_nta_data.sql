-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: stage8_nta_data
-- Adds a JSONB column to audit_engagements for the Stage 8 corporate
-- "Notes to Accounts" single-Note-1 editor (policies + general notes).
--
-- The DEFAULT skeleton is intentionally empty-body so Phase 2 (TypeScript
-- constants) fills display text on first open; users can reset any policy to
-- default by clearing its body field.
--
-- Client table NOTE:
--   clients.business_activity      → already exists (text)
--   clients.date_of_incorporation  → already exists (text)  — used as-is
--   clients.registered_office      → already exists (text)  — used as registered_address
--   No new client columns are needed; the component maps these existing fields.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_engagements
ADD COLUMN IF NOT EXISTS stage8_nta_data jsonb DEFAULT '{
  "overview": {
    "registered_address_override": null,
    "business_activity_override": null
  },
  "policies": [
    { "id": "2.1",  "title": "Basis of Preparation of Financial statements", "body": "" },
    { "id": "2.2",  "title": "Use of Estimates",                              "body": "" },
    { "id": "2.3",  "title": "Revenues recognition",                          "body": "" },
    { "id": "2.4",  "title": "Inventories",                                   "body": "" },
    { "id": "2.5",  "title": "Property Plant and Equipment",                  "body": "" },
    { "id": "2.6",  "title": "Depreciation /Amortization and Impairment",     "body": "" },
    { "id": "2.7",  "title": "Taxes on Income",                               "body": "" },
    { "id": "2.8",  "title": "Investments",                                   "body": "" },
    { "id": "2.9",  "title": "Trade and Other Receivables",                   "body": "" },
    { "id": "2.10", "title": "Cash and Cash Equivalents",                     "body": "" },
    { "id": "2.11", "title": "Cash Flow Statements",                          "body": "" },
    { "id": "2.12", "title": "Employee Benefits",                             "body": "" },
    { "id": "2.13", "title": "Provisions and Contingencies",                  "body": "" },
    { "id": "2.14", "title": "Government Grants",                             "body": "" },
    { "id": "2.15", "title": "Events after reporting date",                   "body": "" },
    { "id": "2.16", "title": "Earnings per Share",                            "body": "" },
    { "id": "2.17", "title": "Foreign currency transactions",                 "body": "" },
    { "id": "2.18", "title": "Segment Reporting",                             "body": "" }
  ],
  "general_notes": [
    { "id": 1, "body": "" },
    { "id": 2, "body": "" },
    { "id": 3, "body": "" },
    { "id": 4, "body": "" },
    { "id": 5, "body": "" },
    { "id": 6, "body": "" },
    { "id": 7, "body": "" },
    { "id": 8, "body": "" },
    { "id": 9, "body": "" }
  ]
}'::jsonb;

-- Index for fast reads (engagement_id is PK so direct lookup is O(1),
-- but a GIN index helps if we ever query inside the JSONB).
CREATE INDEX IF NOT EXISTS idx_audit_engagements_stage8_nta
  ON audit_engagements USING GIN (stage8_nta_data);
