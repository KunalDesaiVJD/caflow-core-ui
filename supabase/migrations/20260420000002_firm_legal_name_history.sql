-- ─────────────────────────────────────────────────────────────────────────────
-- Firm Legal Name History
--   Stores constitution-change events per firm so that invoices, credit notes,
--   receipts, ledgers etc. can pick the name applicable to the document date.
--
--   Shape of legal_name_changes (JSONB array, sorted ascending by effective_date):
--     [
--       { "effective_date": "YYYY-MM-DD", "previous_name": "old name" },
--       ...
--     ]
--   The current firms.name is ALWAYS the most-recent (post-change) name.
--   Resolver logic (client side):
--     if docDate < earliest effective_date → return that entry's previous_name
--     else if docDate < next effective_date → walk array, return the matching previous_name
--     else → return firms.name
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add legal_name_changes column (idempotent)
ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS legal_name_changes JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.firms.legal_name_changes IS
  'Array of {effective_date, previous_name} — the name used for documents dated BEFORE effective_date.';

-- 2. Seed the V J Desai & Co. → V J Desai & Co. LLP transition
--    Effective 16 April 2026. Idempotent: only re-writes if the current name
--    matches either old or new form and the history is still empty.
UPDATE public.firms
   SET name = 'V J Desai & Co. LLP',
       legal_name_changes = COALESCE(legal_name_changes, '[]'::jsonb)
                         || jsonb_build_array(jsonb_build_object(
                              'effective_date', '2026-04-16',
                              'previous_name',  'V J Desai & Co.'
                            ))
 WHERE (name = 'V J Desai & Co.' OR name = 'V J Desai & Co. LLP')
   AND NOT (legal_name_changes @> '[{"previous_name":"V J Desai & Co."}]'::jsonb);

-- Also update display_name if it still held the old value
UPDATE public.firms
   SET display_name = 'V J Desai & Co. LLP'
 WHERE display_name = 'V J Desai & Co.';
