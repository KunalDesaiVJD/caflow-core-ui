-- 20260604000003_documents_firm_scoped_delete.sql
--
-- L10 FIX (bug-bounty): tighten the DELETE policy on the `documents` bucket.
--
-- Before: `documents_auth_delete` allowed ANY authenticated user to DELETE
--   any object in the bucket. A user in Firm A could remove Firm B's
--   Checklist PDFs if they could guess the path (or list the bucket via
--   the Storage API). That's a cross-firm data-destruction vector.
--
-- After: deletes on engagement-scoped paths (currently only `checklist/*`)
--   require the user to belong to the firm that owns the engagement, OR
--   to have role='superadmin'. Other path prefixes keep the existing
--   permissive behaviour so non-engagement features (tds_ack_files etc.)
--   don't break.
--
-- Path scheme: `checklist/<engagement_id>/<filename>`. The engagement_id
--   is `split_part(name, '/', 2)`.

DROP POLICY IF EXISTS "documents_auth_delete" ON storage.objects;

CREATE POLICY "documents_firm_scoped_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (
      -- Path doesn't start with a firm-scoped prefix → fall back to legacy
      -- permissive behaviour (any authenticated user can delete). This
      -- keeps non-engagement features working until they get their own
      -- prefix-scoped policy.
      NOT (name LIKE 'checklist/%')
      -- Path is engagement-scoped → user must belong to the engagement's
      -- firm, OR be a superadmin.
      OR EXISTS (
        SELECT 1
        FROM public.audit_engagements e
        WHERE e.id::text = split_part(name, '/', 2)
          AND (
            -- Same firm as engagement
            e.firm_id IN (
              SELECT firm_id FROM public.users WHERE id = auth.uid()
            )
            -- OR superadmin
            OR EXISTS (
              SELECT 1 FROM public.users
              WHERE id = auth.uid() AND role = 'superadmin'
            )
          )
      )
    )
  );

COMMENT ON POLICY "documents_firm_scoped_delete" ON storage.objects IS
  'Firm-scoped DELETE for engagement-prefixed paths (currently checklist/*). '
  'Other prefixes fall back to authenticated permissive. Replaces the old '
  'documents_auth_delete which allowed cross-firm data destruction. '
  'Created 2026-06-04 in the bug-bounty L10 fix.';
