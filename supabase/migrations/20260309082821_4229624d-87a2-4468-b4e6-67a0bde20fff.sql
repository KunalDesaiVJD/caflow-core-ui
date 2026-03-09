
-- client_profiles
ALTER TABLE public.client_profiles DROP CONSTRAINT IF EXISTS client_profiles_client_id_fkey;
ALTER TABLE public.client_profiles ADD CONSTRAINT client_profiles_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- trial_balance_snapshots
ALTER TABLE public.trial_balance_snapshots DROP CONSTRAINT IF EXISTS trial_balance_snapshots_client_id_fkey;
ALTER TABLE public.trial_balance_snapshots ADD CONSTRAINT trial_balance_snapshots_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- bank_reconciliations
ALTER TABLE public.bank_reconciliations DROP CONSTRAINT IF EXISTS bank_reconciliations_client_id_fkey;
ALTER TABLE public.bank_reconciliations ADD CONSTRAINT bank_reconciliations_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- documents
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_client_id_fkey;
ALTER TABLE public.documents ADD CONSTRAINT documents_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- itr_profiles
ALTER TABLE public.itr_profiles DROP CONSTRAINT IF EXISTS itr_profiles_client_id_fkey;
ALTER TABLE public.itr_profiles ADD CONSTRAINT itr_profiles_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- itr_demands
ALTER TABLE public.itr_demands DROP CONSTRAINT IF EXISTS itr_demands_client_id_fkey;
ALTER TABLE public.itr_demands ADD CONSTRAINT itr_demands_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- tds_entries
ALTER TABLE public.tds_entries DROP CONSTRAINT IF EXISTS tds_entries_client_id_fkey;
ALTER TABLE public.tds_entries ADD CONSTRAINT tds_entries_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- audit_engagements
ALTER TABLE public.audit_engagements DROP CONSTRAINT IF EXISTS audit_engagements_client_id_fkey;
ALTER TABLE public.audit_engagements ADD CONSTRAINT audit_engagements_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- related_parties
ALTER TABLE public.related_parties DROP CONSTRAINT IF EXISTS related_parties_client_id_fkey;
ALTER TABLE public.related_parties ADD CONSTRAINT related_parties_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- scrutiny_findings
ALTER TABLE public.scrutiny_findings DROP CONSTRAINT IF EXISTS scrutiny_findings_client_id_fkey;
ALTER TABLE public.scrutiny_findings ADD CONSTRAINT scrutiny_findings_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- timesheets
ALTER TABLE public.timesheets DROP CONSTRAINT IF EXISTS timesheets_client_id_fkey;
ALTER TABLE public.timesheets ADD CONSTRAINT timesheets_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- invoices
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_client_id_fkey;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
