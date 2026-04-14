/**
 * Direct sync script — fetches from eofficeportal API and imports into Supabase.
 * Uses Node.js with SSL bypass for the expired cert.
 *
 * Changes:
 *   1. Only ACTIVE clients are imported (IsActive / Status field).
 *   2. Existing clients are UPDATED (all fields except customer_id).
 *   3. Groups from API are AUTO-CREATED if missing, then client is assigned.
 */
import https from 'https';
import http from 'http';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hubyywmodekfdzhwiumb.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc4OTI3OCwiZXhwIjoyMDg4MzY1Mjc4fQ.PmVYktsuUJDweOgP7J_209hlrV_xQl2qUOi7Uc7yeHc';
const API_URL      = 'https://eofficeportal.com/Company/SmartService.asmx/FillCustomerlist?customerGroupid=nullksd9ow34e9w0sdmoaskjof8w0eur0wejfomasdojo9auwerwjrowejmfojaspf';

const ENTITY_MAP = {
  'INDIVIDUAL': 'Individual', 'FIRM': 'Partnership', 'LLP': 'LLP',
  'HUF': 'HUF', 'PVT. LTD.': 'Private Ltd', 'PUBLIC LTD': 'Public Ltd',
  'AOP': 'AOP', 'Trust': 'Trust',
};

const AUTO_GROUP_COLORS = [
  '#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6',
  '#8b5cf6','#06b6d4','#84cc16','#f97316','#ec4899',
];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Fetch with SSL bypass ──────────────────────────────────────────────────────
function fetchWithSSLBypass(url) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { agent }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Parse XML → JSON ──────────────────────────────────────────────────────────
function parse(rawText) {
  const open  = rawText.indexOf('>',  rawText.indexOf('<string'));
  const close = rawText.indexOf('</string>');
  if (open === -1 || close === -1) throw new Error('No <string> element');
  return JSON.parse(rawText.slice(open + 1, close).trim());
}

// ── Active filter ─────────────────────────────────────────────────────────────
function isActive(r) {
  if (r.IsActive !== undefined && r.IsActive !== null && r.IsActive !== '') {
    const v = String(r.IsActive).toLowerCase().trim();
    return v === 'true' || v === '1' || v === 'active' || v === 'y' || v === 'yes';
  }
  if (r.Status !== undefined && r.Status !== null && r.Status !== '') {
    return String(r.Status).toLowerCase().trim() === 'active';
  }
  return true; // no active/status field — include all
}

// ── Build update payload ──────────────────────────────────────────────────────
function buildPayload(r) {
  return {
    name:        r.ClientName?.trim()   || null,
    pan:         r.PanCard?.trim()      || null,
    entity_type: ENTITY_MAP[r.companytypename] ?? r.companytypename ?? null,
    email:       r.email?.trim()        || null,
    mobile:      (r.Mobile || '').replace(/\D/g, '').slice(0, 10) || null,
    address:     r.ComAddress?.trim()   || null,
    gstin:       r.GST_No?.trim() ? [r.GST_No.trim()] : null,
    tan_number:  r.TAN_no?.trim()       || null,
  };
}

async function main() {
  console.log('[Sync] Fetching from eofficeportal...');
  const raw  = await fetchWithSSLBypass(API_URL);
  const recs = parse(raw);
  console.log(`[Sync] Total records from API: ${recs.length}`);

  // ── Filter active only ─────────────────────────────────────────────────────
  const activeRecs  = recs.filter(isActive);
  const inactiveCount = recs.length - activeRecs.length;
  console.log(`[Sync] Active: ${activeRecs.length}, Inactive filtered: ${inactiveCount}`);

  // ── Get existing customer_ids from DB ──────────────────────────────────────
  const { data: existing } = await supabase
    .from('clients').select('id, customer_id')
    .not('customer_id', 'is', null);
  const existingMap = new Map((existing || []).map(c => [String(c.customer_id), c.id]));
  console.log(`[Sync] Existing customer_ids in DB: ${existingMap.size}`);

  // ── Get firm_id for V J Desai & Co. ──────────────────────────────────────
  const { data: firms } = await supabase.from('firms').select('id, name');
  const firm = (firms || []).find(f => f.name && f.name.toLowerCase().includes('v j desai')) ||
               (firms || []).find(f => f.name && f.name.toLowerCase().includes('desai & co'));
  const firmId = firm?.id || null;
  console.log(`[Sync] Firm: ${firm?.name || 'unknown'} (${firmId})`);

  // ── Auto-create missing groups ─────────────────────────────────────────────
  const apiGroupNames = [...new Set(activeRecs.map(r => (r.groupname || '').trim()).filter(Boolean))];
  const { data: existingGroups } = await supabase.from('client_groups').select('id, name');
  const groupMap = new Map((existingGroups || []).map(g => [g.name.toLowerCase().trim(), g.id]));

  const missingGroups = apiGroupNames.filter(n => !groupMap.has(n.toLowerCase()));
  if (missingGroups.length > 0) {
    console.log(`[Sync] Auto-creating ${missingGroups.length} group(s):`, missingGroups);
    const colorOffset = (existingGroups || []).length;
    const newGroupRows = missingGroups.map((name, i) => ({
      name,
      color: AUTO_GROUP_COLORS[(colorOffset + i) % AUTO_GROUP_COLORS.length],
    }));
    const { data: created } = await supabase.from('client_groups').insert(newGroupRows).select('id, name');
    if (created) created.forEach(g => groupMap.set(g.name.toLowerCase().trim(), g.id));
  }

  // ── Separate new vs existing ───────────────────────────────────────────────
  const toInsert = activeRecs.filter(r => r.CustomerId && !existingMap.has(String(r.CustomerId)));
  const toUpdate = activeRecs.filter(r => r.CustomerId &&  existingMap.has(String(r.CustomerId)));
  console.log(`[Sync] New to insert: ${toInsert.length}, Existing to update: ${toUpdate.length}`);

  let created = 0, updated = 0, failed = 0;
  const BATCH = 25;

  // ── INSERT new ─────────────────────────────────────────────────────────────
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH);
    await Promise.all(chunk.map(async r => {
      const customer_id = String(r.CustomerId);
      const { error } = await supabase.from('clients').insert({
        customer_id,
        ...buildPayload(r),
        firm_id:  firmId,
        is_draft: true,
        source:   'api_import',
      });
      if (error) { console.error(`  INSERT FAIL ${customer_id}: ${error.message}`); failed++; }
      else {
        // Group membership
        const gid = groupMap.get((r.groupname || '').toLowerCase().trim());
        if (gid) {
          const { data: row } = await supabase.from('clients').select('id').eq('customer_id', customer_id).single();
          if (row?.id) {
            await supabase.from('client_group_memberships')
              .upsert({ client_id: row.id, group_id: gid }, { onConflict: 'client_id,group_id', ignoreDuplicates: true });
          }
        }
        created++;
      }
    }));
    console.log(`[Sync] Insert progress: ${Math.min(i + BATCH, toInsert.length)} / ${toInsert.length}`);
  }

  // ── UPDATE existing ────────────────────────────────────────────────────────
  for (let i = 0; i < toUpdate.length; i += BATCH) {
    const chunk = toUpdate.slice(i, i + BATCH);
    await Promise.all(chunk.map(async r => {
      const customer_id = String(r.CustomerId);
      const clientDbId  = existingMap.get(customer_id);
      const { error } = await supabase.from('clients')
        .update(buildPayload(r))
        .eq('customer_id', customer_id)
        .is('deleted_at', null);
      if (error) { console.error(`  UPDATE FAIL ${customer_id}: ${error.message}`); failed++; }
      else {
        // Group membership (upsert — keeps manually-added groups)
        const gid = groupMap.get((r.groupname || '').toLowerCase().trim());
        if (gid && clientDbId) {
          await supabase.from('client_group_memberships')
            .upsert({ client_id: clientDbId, group_id: gid }, { onConflict: 'client_id,group_id', ignoreDuplicates: true });
        }
        updated++;
      }
    }));
    console.log(`[Sync] Update progress: ${Math.min(i + BATCH, toUpdate.length)} / ${toUpdate.length}`);
  }

  console.log(`\n[Sync] DONE — Created: ${created}, Updated: ${updated}, Failed: ${failed}, Inactive skipped: ${inactiveCount}`);
}

main().catch(e => { console.error('[Sync] Fatal:', e.message); process.exit(1); });
