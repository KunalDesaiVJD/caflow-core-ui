-- ─────────────────────────────────────────────────────────────────────────────
-- Remove party / business / person names from coa_mapping_intelligence.
-- These were incorrectly stored as global patterns; they are vendor/customer
-- names specific to individual clients and must never train the global AI.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Delete rows already flagged as party names
DELETE FROM coa_mapping_intelligence
WHERE is_party_name = true;

-- 2. Delete rows with company-type suffixes (pvt, ltd, llp, corp, etc.)
--    These are always vendor/customer names, never generic ledger names.
DELETE FROM coa_mapping_intelligence
WHERE normalized_name ~* '\y(pvt|ltd|llp|corp|inc|enterprises|trading|industries|electricals|brothers|sons|associates|agency|suppliers|traders|works|solutions|services|consultants|infosolutions|networking|technologies|tech|broadband|app labs|connect|smartlink|infra|construction|builders|developers|exports|imports|international|overseas|global)\y';

-- 3. Delete rows that look like person names (firstname [initial] lastname pattern)
--    e.g. "bhautik r sojitra", "p. m. thakkar", "hardik hudda"
DELETE FROM coa_mapping_intelligence
WHERE normalized_name ~ '^[a-z]+\.?\s+[a-z]\.?\s+[a-z]+'   -- firstname initial lastname
   OR normalized_name ~ '^[a-z]+\s+[a-z]+\s+[a-z]+\s*$'    -- three-word name with no accounting keywords
      AND normalized_name !~* '\y(tax|charges|expenses|income|receipt|payment|fee|cost|account|advance|deposit|loan|interest|rent|salary|wages|commission|discount|provision|reserve|capital|stock|inventory|asset|liability|payable|receivable|purchase|sale)\y';

-- 4. Delete engagement-scoped entries (always client-specific party names)
DELETE FROM coa_mapping_intelligence
WHERE scope = 'engagement';

-- 5. Ensure the upsert_coa_intelligence function marks party names correctly
--    going forward. Update any remaining rows that match known business patterns
--    (safety net — shouldn't have any after deletes above).
UPDATE coa_mapping_intelligence
SET is_party_name = true
WHERE is_party_name = false
  AND normalized_name ~* '\y(pvt|ltd|llp|corp|inc)\y';

-- 6. Also clean the alias index — remove any aliases whose canonical entry was deleted
--    (already handled by ON DELETE CASCADE, but run explicitly for safety)
DELETE FROM coa_alias_index
WHERE canonical_id NOT IN (SELECT id FROM coa_mapping_intelligence);
