/**
 * supabase-push.js — Push parsed Tally data to Supabase
 *
 * Tables written to:
 *  - ledger_import_batches   (one batch per sync run)
 *  - trial_balance_snapshots (one row per ledger)
 *  - tb_hierarchy_nodes      (one row per group/ledger node)
 */

const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

class SupabasePush {
  constructor(supabaseUrl, serviceKey) {
    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required in .env');
    }
    this.supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    this.batchId = uuidv4();
  }

  // ─── Create import batch record ──────────────────────────────────────────
  async createBatch({ engagementId, firmId, fromDate, toDate, financialYear, companyName, totalLedgers }) {
    const { data, error } = await this.supabase
      .from('ledger_import_batches')
      .insert({
        id: this.batchId,
        engagement_id: engagementId,
        firm_id: firmId,
        original_filename: `tally-sync-${companyName}-${financialYear}`,
        import_type: 'tally_auto_sync',
        total_rows: totalLedgers,
        leaf_rows: totalLedgers,
        processing_status: 'processing',
        status: 'processing',
        imported_at: new Date().toISOString(),
        error_log: [],
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to create batch: ${error.message}`);
    console.log(`  ✓ Batch created: ${this.batchId}`);
    return this.batchId;
  }

  // ─── Push trial balance snapshots (one row per ledger) ──────────────────
  async pushTrialBalance({ engagementId, clientId, financialYear, ledgers, groups }) {
    if (ledgers.length === 0) {
      console.warn('  ⚠ No ledgers to push');
      return;
    }

    // Delete existing snapshots for this engagement/FY/batch to allow clean re-sync
    await this.supabase
      .from('trial_balance_snapshots')
      .delete()
      .eq('engagement_id', engagementId)
      .eq('financial_year', financialYear);

    // Build group lookup for classification
    const groupMap = new Map(groups.map(g => [g.name.toLowerCase(), g]));

    const rows = ledgers.map(l => {
      const grp = groupMap.get((l.parent || '').toLowerCase()) || {};
      const nodeId = `L:${l.name}`;
      const parentNodeId = l.parent ? `G:${l.parent}` : null;

      return {
        engagement_id: engagementId,
        client_id: clientId,
        financial_year: financialYear,
        import_batch_id: this.batchId,
        ledger_name: l.name,
        account_type: l.account_type || grp.account_type || 'Unknown',
        primary_group: l.primary_group || l.parent || '',
        opening_balance: roundAmount(l.opening_balance),
        txn_debit: roundAmount(Math.abs(l.txn_debit || 0)),
        txn_credit: roundAmount(Math.abs(l.txn_credit || 0)),
        closing_balance: roundAmount(l.closing_balance),
        closing_balance_signed: roundAmount(l.closing_balance),
        node_id: nodeId,
        parent_node_id: parentNodeId,
        hierarchy_level: 1,
        normal_balance: l.normal_balance || 'Dr',
        bs_pl_side: l.bs_pl || grp.bs_pl || 'Unknown',
        validation_status: 'pending',
        processing_status: 'processed',
        import_format: 'tally_xml',
        source_format: 'tally_auto_sync',
        is_validated: false,
        raw_data: {
          tally_group: l.parent,
          raw_opening: l.raw_opening,
          raw_closing: l.raw_closing,
          synced_at: new Date().toISOString(),
        },
      };
    });

    // Push in chunks of 200 (Supabase row limit per request)
    const chunks = chunkArray(rows, 200);
    let pushed = 0;
    for (const chunk of chunks) {
      const { error } = await this.supabase
        .from('trial_balance_snapshots')
        .insert(chunk);
      if (error) throw new Error(`TB snapshot insert failed: ${error.message}`);
      pushed += chunk.length;
      process.stdout.write(`  ✓ TB snapshots: ${pushed}/${rows.length}\r`);
    }
    console.log(`  ✓ Pushed ${rows.length} trial balance snapshots`);
  }

  // ─── Push hierarchy nodes (groups + ledgers) ─────────────────────────────
  async pushHierarchy({ engagementId, hierarchyNodes }) {
    if (hierarchyNodes.length === 0) return;

    // Delete existing hierarchy for this engagement
    await this.supabase
      .from('tb_hierarchy_nodes')
      .delete()
      .eq('engagement_id', engagementId)
      .eq('import_batch_id', this.batchId);

    const rows = hierarchyNodes.map(n => ({
      engagement_id: engagementId,
      import_batch_id: this.batchId,
      node_id: n.node_id,
      parent_node_id: n.parent_node_id || null,
      level: n.level || 0,
      tally_group_name: n.tally_group_name,
      indent_value: n.level || 0,
      is_leaf: n.is_leaf || false,
      is_bold: n.is_bold || false,
      opening_balance: roundAmount(n.opening_balance),
      txn_debit: roundAmount(n.txn_debit),
      txn_credit: roundAmount(n.txn_credit),
      closing_balance: roundAmount(n.closing_balance),
      normal_balance: n.normal_balance || 'Dr',
      bs_pl_side: n.bs_pl_side || 'Unknown',
      primary_group: n.primary_group || '',
      row_number: n.row_number || 0,
    }));

    const chunks = chunkArray(rows, 200);
    let pushed = 0;
    for (const chunk of chunks) {
      const { error } = await this.supabase
        .from('tb_hierarchy_nodes')
        .insert(chunk);
      if (error) throw new Error(`Hierarchy insert failed: ${error.message}`);
      pushed += chunk.length;
      process.stdout.write(`  ✓ Hierarchy nodes: ${pushed}/${rows.length}\r`);
    }
    console.log(`  ✓ Pushed ${rows.length} hierarchy nodes`);
  }

  // ─── Mark batch complete ─────────────────────────────────────────────────
  async completeBatch(ledgerCount, errors = []) {
    const { error } = await this.supabase
      .from('ledger_import_batches')
      .update({
        processing_status: errors.length > 0 ? 'partial' : 'completed',
        status: errors.length > 0 ? 'partial' : 'completed',
        processed_rows: ledgerCount,
        row_count: ledgerCount,
        error_log: errors,
      })
      .eq('id', this.batchId);

    if (error) console.warn(`  ⚠ Could not mark batch complete: ${error.message}`);
    else console.log(`  ✓ Batch ${this.batchId} marked complete`);
  }

  // ─── Mark batch failed ───────────────────────────────────────────────────
  async failBatch(errorMessage) {
    await this.supabase
      .from('ledger_import_batches')
      .update({
        processing_status: 'failed',
        status: 'failed',
        error_log: [{ message: errorMessage, at: new Date().toISOString() }],
      })
      .eq('id', this.batchId);
  }

  // ─── Check Supabase connectivity ─────────────────────────────────────────
  async testConnection() {
    const { error } = await this.supabase
      .from('ledger_import_batches')
      .select('id')
      .limit(1);
    if (error) throw new Error(`Supabase connection failed: ${error.message}`);
    return true;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function roundAmount(n) {
  if (!n || isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

module.exports = { SupabasePush };
