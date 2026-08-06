/**
 * Cleanup script:
 * 1. Delete all manual draft clients from V J Desai & Co.
 * 2. Delete firms AKTA RAMANI, Demo CA Firm, KARAN PAREKH & all their records
 * 3. Set V J Desai & Co. as default firm for superadmin user
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hubyywmodekfdzhwiumb.supabase.co';
// SECURITY: this used to be a service_role key hardcoded in plain text —
// full, unrestricted database access, bypassing every RLS policy — checked
// into and pushed to git. It's now read from the environment instead. This
// does NOT undo the exposure: the old key value is still present in this
// file's git history and must be treated as compromised. Rotate it from the
// Supabase dashboard (Project Settings → API → service_role → regenerate),
// then set the new value as SUPABASE_SERVICE_ROLE_KEY before running this
// script — never paste it back into this file.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('[cleanup_firms] SUPABASE_SERVICE_ROLE_KEY environment variable is not set. Aborting.');
  process.exit(1);
}

const VJ_DESAI_ID      = 'be411601-f0f5-4f74-b93d-b87a8ef1b82b';
const SUPERADMIN_ID    = 'c82493cb-d42c-42a8-bd28-52779f954038';

const FIRMS_TO_DELETE  = [
  { id: 'ecab2014-9e0a-431c-ad82-2752b875b94f', name: 'AKTA RAMANI & ASSOCIATES' },
  { id: '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1', name: 'Demo CA Firm' },
  { id: '94d2274f-c900-4a59-96e5-c449831f64c0', name: 'KARAN PAREKH & ASSOCIATES' },
];
const FIRM_IDS_TO_DELETE = FIRMS_TO_DELETE.map(f => f.id);

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function del(table, filter, label) {
  let q = sb.from(table).delete();
  for (const [col, val] of Object.entries(filter)) {
    if (Array.isArray(val)) q = q.in(col, val);
    else if (val === null)   q = q.is(col, null);
    else if (val === 'true_flag') q = q.eq(col, true);
    else                     q = q.eq(col, val);
  }
  const { error, count } = await q;
  if (error) console.error(`  ✗ ${label}: ${error.message}`);
  else       console.log(`  ✓ ${label}: deleted`);
}

async function count(table, filter) {
  let q = sb.from(table).select('*', { count: 'exact', head: true });
  for (const [col, val] of Object.entries(filter)) {
    if (Array.isArray(val)) q = q.in(col, val);
    else if (val === true)  q = q.eq(col, true);
    else                    q = q.eq(col, val);
  }
  const { count: c } = await q;
  return c || 0;
}

async function main() {

  // ── STEP 1: Delete all manual draft clients from V J Desai & Co. ─────────────
  console.log('\n=== STEP 1: Delete manual draft clients from V J Desai & Co. ===');

  const { data: vjDrafts } = await sb.from('clients')
    .select('id')
    .eq('firm_id', VJ_DESAI_ID)
    .eq('is_draft', true)
    .neq('source', 'api_import');

  console.log(`  Found ${vjDrafts?.length || 0} manual drafts to delete`);

  if (vjDrafts && vjDrafts.length > 0) {
    const draftIds = vjDrafts.map(d => d.id);
    // Delete companion records first
    for (const table of ['client_group_memberships', 'client_profiles', 'client_services',
                          'engagements', 'tds_filings', 'it_returns', 'invoices',
                          'timesheet_entries', 'audit_pipelines']) {
      try {
        const { error } = await sb.from(table).delete().in('client_id', draftIds);
        if (!error) console.log(`  ✓ Cleared ${table} for draft clients`);
      } catch(e) { /* table may not exist or no rows */ }
    }
    // Delete the drafts
    const { error } = await sb.from('clients').delete().in('id', draftIds);
    console.log(error ? `  ✗ Delete drafts error: ${error.message}` : `  ✓ Deleted ${draftIds.length} manual draft clients`);
  }

  // ── STEP 2: Delete all records for the 3 target firms ────────────────────────
  console.log('\n=== STEP 2: Delete records for AKTA / Demo / KARAN firms ===');

  for (const firm of FIRMS_TO_DELETE) {
    console.log(`\n  --- ${firm.name} (${firm.id}) ---`);

    // Get all client IDs for this firm
    const { data: firmClients } = await sb.from('clients').select('id').eq('firm_id', firm.id);
    const clientIds = (firmClients || []).map(c => c.id);
    console.log(`  Found ${clientIds.length} clients`);

    if (clientIds.length > 0) {
      // Delete client-dependent records
      for (const table of ['client_group_memberships', 'client_profiles', 'client_services',
                            'engagements', 'tds_filings', 'it_returns', 'invoices',
                            'timesheet_entries', 'audit_pipelines', 'notice_tracker',
                            'itr_demands', 'bank_recons', 'depreciation_entries']) {
        try {
          const { error } = await sb.from(table).delete().in('client_id', clientIds);
          if (!error) console.log(`    ✓ Cleared ${table}`);
        } catch(e) { /* skip */ }
      }

      // Delete clients
      const { error: clientErr } = await sb.from('clients').delete().eq('firm_id', firm.id);
      console.log(clientErr ? `    ✗ clients: ${clientErr.message}` : `    ✓ Deleted ${clientIds.length} clients`);
    }

    // Delete firm-level records
    for (const table of ['client_groups', 'firm_settings', 'service_masters',
                          'tds_filings', 'it_returns', 'invoices', 'timesheet_entries',
                          'roles', 'user_roles']) {
      try {
        const { error } = await sb.from(table).delete().eq('firm_id', firm.id);
        if (!error) console.log(`    ✓ Cleared ${table}`);
      } catch(e) { /* skip */ }
    }

    // Delete users tied to this firm
    const { data: firmUsers } = await sb.from('users').select('id').eq('firm_id', firm.id);
    if (firmUsers && firmUsers.length > 0) {
      const userIds = firmUsers.map(u => u.id);
      console.log(`    Found ${userIds.length} users for this firm`);
      // Delete user-dependent records
      for (const table of ['user_roles', 'timesheet_entries']) {
        try {
          await sb.from(table).delete().in('user_id', userIds);
        } catch(e) {}
      }
      const { error: userErr } = await sb.from('users').delete().eq('firm_id', firm.id);
      console.log(userErr ? `    ✗ users: ${userErr.message}` : `    ✓ Deleted ${userIds.length} users`);
    }

    // Finally delete the firm
    const { error: firmErr } = await sb.from('firms').delete().eq('id', firm.id);
    console.log(firmErr ? `    ✗ FIRM DELETE ERROR: ${firmErr.message}` : `    ✓ DELETED FIRM: ${firm.name}`);
  }

  // ── STEP 3: Set V J Desai & Co. as default firm for superadmin ───────────────
  console.log('\n=== STEP 3: Set V J Desai & Co. as default firm for superadmin ===');

  const { error: updateErr } = await sb.from('users')
    .update({ firm_id: VJ_DESAI_ID, default_firm_id: VJ_DESAI_ID })
    .eq('id', SUPERADMIN_ID);

  if (updateErr && updateErr.message.includes('default_firm_id')) {
    // Column might not exist, try without it
    const { error: e2 } = await sb.from('users').update({ firm_id: VJ_DESAI_ID }).eq('id', SUPERADMIN_ID);
    console.log(e2 ? `  ✗ ${e2.message}` : `  ✓ Superadmin firm_id set to V J Desai & Co.`);
  } else if (updateErr) {
    console.log(`  ✗ ${updateErr.message}`);
  } else {
    console.log(`  ✓ Superadmin default firm set to V J Desai & Co.`);
  }

  // ── STEP 4: Verify final state ────────────────────────────────────────────────
  console.log('\n=== STEP 4: Verification ===');

  const { data: remainingFirms } = await sb.from('firms').select('id, name').order('name');
  console.log('Remaining firms:');
  remainingFirms?.forEach(f => console.log('  -', f.name, '(' + f.id + ')'));

  const vjTotal     = await count('clients', { firm_id: VJ_DESAI_ID });
  const vjDraftLeft = await count('clients', { firm_id: VJ_DESAI_ID, is_draft: true });
  const vjApiCount  = await count('clients', { firm_id: VJ_DESAI_ID, source: 'api_import' });
  console.log(`\nV J Desai & Co. clients: ${vjTotal} total, ${vjDraftLeft} drafts remaining, ${vjApiCount} api_import`);

  const { data: adminUser } = await sb.from('users').select('firm_id, role').eq('id', SUPERADMIN_ID).single();
  console.log(`Superadmin firm_id: ${adminUser?.firm_id}`);

  console.log('\n✅ Cleanup complete!');
}

main().catch(e => { console.error(e); process.exit(1); });
