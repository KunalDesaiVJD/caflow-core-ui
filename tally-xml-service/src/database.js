/**
 * database.js — Supabase operations for Tally XML ingestion
 *
 * Tables:
 *   tally_xml_uploads      — one record per uploaded XML file
 *   tally_tb_rows          — one record per parsed ledger/group row
 *   tally_processing_logs  — processing events per upload
 *
 * Uses SERVICE ROLE key — bypasses RLS for server-side inserts.
 * All inserts are chunked at 200 rows (Supabase REST API limit).
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// ─── Supabase client (initialised once, reused) ────────────────────────────
let _supabase = null;

function getSupabase() {
  if (_supabase) return _supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env\n' +
      'Copy .env.example → .env and fill in your project credentials.'
    );
  }

  _supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _supabase;
}

// ─── Helper: chunk array into sub-arrays of size n ─────────────────────────
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Helper: round to 4 decimal places ─────────────────────────────────────
function round4(n) {
  if (!n || !Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

// ─── tally_xml_uploads ──────────────────────────────────────────────────────

/**
 * Create the upload record (status = 'processing').
 * Stores raw_xml unless SKIP_RAW_XML_STORAGE=true.
 *
 * @param {string} uploadId - UUID
 * @param {string} fileName - Original filename
 * @param {string} rawXml   - Full XML string
 */
async function createUploadRecord(uploadId, fileName, rawXml) {
  const skipStorage = process.env.SKIP_RAW_XML_STORAGE === 'true';

  const { error } = await getSupabase()
    .from('tally_xml_uploads')
    .insert({
      id: uploadId,
      file_name: fileName,
      raw_xml: skipStorage ? null : rawXml,
      parse_status: 'processing',
      total_rows: 0,
      created_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Failed to create upload record: ${error.message}`);
  }
}

/**
 * Mark upload as completed with final row count.
 *
 * @param {string} uploadId
 * @param {number} totalRows
 */
async function markUploadComplete(uploadId, totalRows) {
  const { error } = await getSupabase()
    .from('tally_xml_uploads')
    .update({
      parse_status: 'completed',
      total_rows: totalRows,
    })
    .eq('id', uploadId);

  if (error) {
    console.warn(`[DB] Warning: could not mark upload complete: ${error.message}`);
  }
}

/**
 * Mark upload as failed with error message stored in a log.
 *
 * @param {string} uploadId
 * @param {string} reason
 */
async function markUploadFailed(uploadId, reason) {
  const { error } = await getSupabase()
    .from('tally_xml_uploads')
    .update({ parse_status: 'failed' })
    .eq('id', uploadId);

  if (error) {
    console.warn(`[DB] Warning: could not mark upload failed: ${error.message}`);
  }
}

// ─── tally_tb_rows ──────────────────────────────────────────────────────────

/**
 * Batch insert processed TB rows into tally_tb_rows.
 * Inserts in chunks of 200 to respect Supabase row limit.
 *
 * @param {{ upload_id: string, display_name: string, account_category: string, opening_balance_raw: number, debit_raw: number, credit_raw: number, closing_balance_raw: number, opening_balance_normalized: number, debit_normalized: number, credit_normalized: number, closing_balance_normalized: number, sign_rule_applied: string }[]} rows
 */
async function insertTbRows(rows) {
  if (!rows || rows.length === 0) return;

  const records = rows.map(r => ({
    upload_id:                    r.upload_id,
    display_name:                 r.display_name,
    account_category:             r.account_category,
    opening_balance_raw:          round4(r.opening_balance_raw),
    debit_raw:                    round4(r.debit_raw),
    credit_raw:                   round4(r.credit_raw),
    closing_balance_raw:          round4(r.closing_balance_raw),
    opening_balance_normalized:   round4(r.opening_balance_normalized),
    debit_normalized:             round4(r.debit_normalized),
    credit_normalized:            round4(r.credit_normalized),
    closing_balance_normalized:   round4(r.closing_balance_normalized),
    sign_rule_applied:            r.sign_rule_applied,
    created_at:                   new Date().toISOString(),
  }));

  const batches = chunk(records, 200);
  let inserted = 0;

  for (const batch of batches) {
    const { error } = await getSupabase()
      .from('tally_tb_rows')
      .insert(batch);

    if (error) {
      throw new Error(`tally_tb_rows insert failed (batch ${inserted + 1}): ${error.message}`);
    }
    inserted += batch.length;
  }
}

/**
 * Fetch TB rows for an upload, ordered by display_name.
 * Returns both raw and normalized columns regardless of mode flag
 * (filtering is done in the API layer for presentation).
 *
 * @param {string} uploadId
 * @param {boolean} includeRaw - If true, include raw columns in select
 * @returns {object[]}
 */
async function getTbRows(uploadId, includeRaw = false) {
  const select = includeRaw
    ? '*'
    : 'display_name, account_category, opening_balance_normalized, debit_normalized, credit_normalized, closing_balance_normalized, sign_rule_applied';

  const { data, error } = await getSupabase()
    .from('tally_tb_rows')
    .select(select)
    .eq('upload_id', uploadId)
    .order('display_name', { ascending: true });

  if (error) throw new Error(`Failed to fetch TB rows: ${error.message}`);
  return data ?? [];
}

// ─── tally_processing_logs ──────────────────────────────────────────────────

/**
 * Insert a single log entry.
 * Does NOT throw on failure — logs are best-effort and must not crash processing.
 *
 * @param {string} uploadId
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 */
async function insertLog(uploadId, level, message) {
  try {
    await getSupabase()
      .from('tally_processing_logs')
      .insert({
        upload_id:   uploadId,
        log_level:   level,
        log_message: message,
        created_at:  new Date().toISOString(),
      });
  } catch (err) {
    // Log to console but never fail the caller
    console.warn(`[DB] Log insert failed: ${err.message}`);
  }
}

/**
 * Bulk insert multiple log entries (more efficient than one-by-one for large files).
 *
 * @param {{ upload_id: string, log_level: string, log_message: string }[]} entries
 */
async function bulkInsertLogs(entries) {
  if (!entries || entries.length === 0) return;

  const records = entries.map(e => ({
    upload_id:   e.upload_id,
    log_level:   e.log_level,
    log_message: e.log_message,
    created_at:  new Date().toISOString(),
  }));

  try {
    const batches = chunk(records, 200);
    for (const batch of batches) {
      await getSupabase().from('tally_processing_logs').insert(batch);
    }
  } catch (err) {
    console.warn(`[DB] Bulk log insert failed: ${err.message}`);
  }
}

/**
 * Fetch all logs for an upload, ordered by created_at ASC.
 *
 * @param {string} uploadId
 * @returns {{ id: string, log_level: string, log_message: string, created_at: string }[]}
 */
async function getLogs(uploadId) {
  const { data, error } = await getSupabase()
    .from('tally_processing_logs')
    .select('id, log_level, log_message, created_at')
    .eq('upload_id', uploadId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch logs: ${error.message}`);
  return data ?? [];
}

module.exports = {
  createUploadRecord,
  markUploadComplete,
  markUploadFailed,
  insertTbRows,
  getTbRows,
  insertLog,
  bulkInsertLogs,
  getLogs,
};
