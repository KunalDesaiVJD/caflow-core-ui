-- tds_challan_download_batches / tds_challan_csi_batches — align RLS with
-- the app's actual auth model, same fix already applied project-wide
-- (this app never establishes a Supabase Auth session; it authenticates
-- through its own localStorage session and talks to Postgres with the anon
-- key, so auth.uid() is always NULL at runtime).
--
-- Both tables were created with an `auth_firm_...` policy scoped to
-- `TO authenticated` keyed on auth.uid() — which the anon-key app can never
-- satisfy, so every insert from the actual "Download Challan" / "Upload
-- Downloaded Report" flow failed with 42501 (row-level security policy
-- violation), silently, since the app never runs as `authenticated`. This
-- is not a data-loss bug — tds_challan_download_batches has always been
-- empty because nothing could ever be written to it, not because anything
-- was deleted — but it is why the feature has never actually saved
-- anything end to end, independent of the browser-extension automation.

drop policy if exists "auth_firm_challan_download_batches" on public.tds_challan_download_batches;
create policy "app manage tds_challan_download_batches"
  on public.tds_challan_download_batches for all to public using (true) with check (true);

drop policy if exists "auth_firm_challan_csi_batches" on public.tds_challan_csi_batches;
create policy "app manage tds_challan_csi_batches"
  on public.tds_challan_csi_batches for all to public using (true) with check (true);

grant select, insert, update, delete on public.tds_challan_download_batches to anon, authenticated;
grant select, insert, update, delete on public.tds_challan_csi_batches       to anon, authenticated;
