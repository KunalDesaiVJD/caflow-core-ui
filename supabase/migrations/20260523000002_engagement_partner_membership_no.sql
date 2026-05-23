-- Add partner_membership_no to audit_engagements so Form3CA/3CB can read it
-- directly without a cross-firm firms table lookup (which RLS can block).
ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS partner_membership_no TEXT;
