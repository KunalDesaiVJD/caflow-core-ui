/**
 * server.js — Tally XML Ingestion API
 *
 * Endpoints:
 *   GET  /health                     — liveness check
 *   POST /upload-xml                 — upload + parse + normalize + store
 *   GET  /trial-balance/:upload_id   — normalized trial balance (report-ready)
 *   GET  /trial-balance-raw/:upload_id — raw + normalized (debug mode)
 *   GET  /logs/:upload_id            — processing logs for this upload
 *
 * All responses use normalized values by default.
 * Raw values are available only via /trial-balance-raw (explicit opt-in).
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const { v4: uuidv4 } = require('uuid');

const { parseTallyXml }    = require('./parser');
const { classifyRow }      = require('./classifier');
const { normalizeRow }     = require('./normalizer');
const {
  createUploadRecord,
  markUploadComplete,
  markUploadFailed,
  insertTbRows,
  getTbRows,
  getLogs,
} = require('./database');
const { log, flushLogs, resetBuffer } = require('./logger');

// ─── Express setup ───────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ─── Multer: memory storage — no disk writes ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const mime = file.mimetype;
    if (
      name.endsWith('.xml') ||
      mime === 'text/xml' ||
      mime === 'application/xml' ||
      mime === 'application/xhtml+xml'
    ) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${mime}. Only .xml files are accepted.`));
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    service:   'caflow-tally-xml-service',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /upload-xml
//
// Accepts: multipart/form-data with field "file" (Tally trial balance XML)
// Returns: upload summary with row counts and links to result endpoints
// ─────────────────────────────────────────────────────────────────────────────
app.post('/upload-xml', upload.single('file'), async (req, res) => {
  const uploadId = uuidv4();
  resetBuffer();

  // ── Guard: file must be present ──────────────────────────────────────────
  if (!req.file) {
    return res.status(400).json({
      error: 'No file uploaded',
      hint: 'Send a multipart/form-data POST with field name "file" containing a Tally XML',
    });
  }

  const fileName = req.file.originalname;

  // ── Encoding detection — Tally exports XML in UTF-16 LE with BOM ─────────
  // BOM: FF FE = UTF-16 LE | FE FF = UTF-16 BE | no BOM = assume UTF-8
  const buf = req.file.buffer;
  let rawXml;
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    // UTF-16 LE (most common Tally export encoding)
    rawXml = buf.toString('utf16le');
    if (rawXml.charCodeAt(0) === 0xFEFF) rawXml = rawXml.slice(1); // strip BOM char
  } else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    // UTF-16 BE — swap bytes then decode as LE
    const swapped = Buffer.alloc(buf.length);
    for (let i = 0; i + 1 < buf.length; i += 2) {
      swapped[i] = buf[i + 1];
      swapped[i + 1] = buf[i];
    }
    rawXml = swapped.toString('utf16le');
    if (rawXml.charCodeAt(0) === 0xFEFF) rawXml = rawXml.slice(1);
  } else {
    // UTF-8 / ASCII (no BOM)
    rawXml = buf.toString('utf-8');
  }

  console.log(`\n─── Upload: ${fileName} (${(rawXml.length / 1024).toFixed(1)} KB) — ID: ${uploadId} ───`);

  // ── Step 1: Create upload record (status = processing) ──────────────────
  try {
    await createUploadRecord(uploadId, fileName, rawXml);
  } catch (dbErr) {
    return res.status(503).json({
      error:     'Database unavailable — could not create upload record',
      detail:    dbErr.message,
      upload_id: uploadId,
    });
  }

  await log(uploadId, 'info', `Upload received: ${fileName} (${rawXml.length} bytes)`);

  // ── Step 2: Parse XML ────────────────────────────────────────────────────
  let rawRows;
  try {
    rawRows = parseTallyXml(rawXml);
    await log(uploadId, 'info', `XML parsed successfully — ${rawRows.length} candidate rows found`);
  } catch (parseErr) {
    await log(uploadId, 'error', `XML parse failed: ${parseErr.message}`);
    await markUploadFailed(uploadId, parseErr.message);
    return res.status(422).json({
      error:     'XML parse failed',
      detail:    parseErr.message,
      upload_id: uploadId,
      hint:      'Ensure the file is a valid Tally Trial Balance XML export',
    });
  }

  if (rawRows.length === 0) {
    await log(uploadId, 'warn', 'No DSP rows found in XML — check file format');
    await markUploadFailed(uploadId, 'No rows found in XML');
    return res.status(422).json({
      error:     'No data rows found in XML',
      upload_id: uploadId,
      hint:      'Ensure this is a Tally Trial Balance XML export containing DSPDISPNAME fields',
    });
  }

  // ── Step 3: Classify + Normalize each row ────────────────────────────────
  const processedRows  = [];
  let unknownCount     = 0;
  let invalidCount     = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];

    // Skip rows without a display name (parser should already filter these,
    // but guard here for safety)
    if (!raw.display_name || raw.display_name.trim() === '') {
      await log(uploadId, 'warn', `Row ${i + 1}: empty display_name — skipped`);
      invalidCount++;
      continue;
    }

    try {
      const category   = classifyRow(raw.display_name);
      const normalized = normalizeRow(raw, category);

      if (category === 'unknown') {
        await log(
          uploadId, 'warn',
          `Row ${i + 1}: "${raw.display_name}" — category unknown, raw values preserved as-is`
        );
        unknownCount++;
      }

      processedRows.push({
        upload_id:                  uploadId,
        display_name:               raw.display_name.trim(),
        account_category:           category,
        opening_balance_raw:        raw.opening_balance_raw,
        debit_raw:                  raw.debit_raw,
        credit_raw:                 raw.credit_raw,
        closing_balance_raw:        raw.closing_balance_raw,
        opening_balance_normalized: normalized.opening_balance_normalized,
        debit_normalized:           normalized.debit_normalized,
        credit_normalized:          normalized.credit_normalized,
        closing_balance_normalized: normalized.closing_balance_normalized,
        sign_rule_applied:          normalized.sign_rule_applied,
      });
    } catch (rowErr) {
      await log(
        uploadId, 'error',
        `Row ${i + 1}: "${raw.display_name}" — processing error: ${rowErr.message}`
      );
      invalidCount++;
      // Continue — do not fail entire upload for one bad row
    }
  }

  await log(
    uploadId, 'info',
    `Classification complete — ${processedRows.length} valid, ` +
    `${unknownCount} unknown category, ${invalidCount} invalid/skipped`
  );

  // ── Step 4: Insert rows to DB ────────────────────────────────────────────
  try {
    await insertTbRows(processedRows);
    await log(uploadId, 'info', `Stored ${processedRows.length} rows in tally_tb_rows`);
  } catch (dbErr) {
    await log(uploadId, 'error', `DB insert failed: ${dbErr.message}`);
    await markUploadFailed(uploadId, dbErr.message);
    return res.status(503).json({
      error:     'Failed to store processed rows',
      detail:    dbErr.message,
      upload_id: uploadId,
    });
  }

  // ── Step 5: Mark upload complete ─────────────────────────────────────────
  await markUploadComplete(uploadId, processedRows.length);
  await flushLogs();

  console.log(`  ✅ Upload ${uploadId} complete — ${processedRows.length} rows stored\n`);

  // ── Step 6: Return summary ───────────────────────────────────────────────
  return res.status(200).json({
    success:                true,
    upload_id:              uploadId,
    file_name:              fileName,
    total_rows_in_xml:      rawRows.length,
    rows_processed:         processedRows.length,
    rows_unknown_category:  unknownCount,
    rows_invalid_skipped:   invalidCount,
    category_summary:       buildCategorySummary(processedRows),
    _links: {
      normalized: `/trial-balance/${uploadId}`,
      raw:        `/trial-balance-raw/${uploadId}`,
      logs:       `/logs/${uploadId}`,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /trial-balance/:upload_id
//
// Returns normalized trial balance — report-ready, audit-safe.
// ALL values use the normalized sign convention.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/trial-balance/:upload_id', async (req, res) => {
  const { upload_id } = req.params;

  if (!isValidUuid(upload_id)) {
    return res.status(400).json({ error: 'Invalid upload_id format' });
  }

  try {
    const rows = await getTbRows(upload_id, false);

    if (rows.length === 0) {
      return res.status(404).json({
        error:     'No data found for this upload_id',
        upload_id,
        hint:      'Check that the upload completed successfully via GET /logs/:upload_id',
      });
    }

    const data = rows.map(r => ({
      display_name:    r.display_name,
      category:        r.account_category,
      opening_balance: r.opening_balance_normalized,
      debit:           r.debit_normalized,
      credit:          r.credit_normalized,
      closing_balance: r.closing_balance_normalized,
      sign_rule:       r.sign_rule_applied,
    }));

    return res.json({
      upload_id,
      mode:      'normalized',
      row_count: data.length,
      note:      'All values are normalized (sign-corrected). Use /trial-balance-raw for raw values.',
      data,
    });
  } catch (err) {
    console.error(`[GET /trial-balance] ${err.message}`);
    return res.status(500).json({ error: err.message, upload_id });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /trial-balance-raw/:upload_id
//
// Returns both raw XML values AND normalized values side-by-side.
// Use for debugging sign convention issues.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/trial-balance-raw/:upload_id', async (req, res) => {
  const { upload_id } = req.params;

  if (!isValidUuid(upload_id)) {
    return res.status(400).json({ error: 'Invalid upload_id format' });
  }

  try {
    const rows = await getTbRows(upload_id, true);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No data found for this upload_id', upload_id });
    }

    const data = rows.map(r => ({
      display_name:               r.display_name,
      category:                   r.account_category,
      // ── Raw values (as extracted from XML — DO NOT use for reports) ──
      opening_balance_raw:        r.opening_balance_raw,
      debit_raw:                  r.debit_raw,
      credit_raw:                 r.credit_raw,
      closing_balance_raw:        r.closing_balance_raw,
      // ── Normalized values (sign-corrected — use these for reports) ──
      opening_balance_normalized: r.opening_balance_normalized,
      debit_normalized:           r.debit_normalized,
      credit_normalized:          r.credit_normalized,
      closing_balance_normalized: r.closing_balance_normalized,
      sign_rule:                  r.sign_rule_applied,
    }));

    return res.json({
      upload_id,
      mode:      'raw_and_normalized',
      row_count: data.length,
      warning:   'raw_* fields reflect Tally XML signs which are NOT presentation-ready. Always use *_normalized for UI and reports.',
      data,
    });
  } catch (err) {
    console.error(`[GET /trial-balance-raw] ${err.message}`);
    return res.status(500).json({ error: err.message, upload_id });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /logs/:upload_id
//
// Returns all processing log entries for this upload.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/logs/:upload_id', async (req, res) => {
  const { upload_id } = req.params;

  if (!isValidUuid(upload_id)) {
    return res.status(400).json({ error: 'Invalid upload_id format' });
  }

  try {
    const logs = await getLogs(upload_id);
    return res.json({
      upload_id,
      log_count: logs.length,
      logs,
    });
  } catch (err) {
    console.error(`[GET /logs] ${err.message}`);
    return res.status(500).json({ error: err.message, upload_id });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler (catches multer errors and middleware errors)
// ─────────────────────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum allowed size is 50 MB.' });
  }
  console.error(`[Unhandled Error] ${err.message}`);
  return res.status(400).json({ error: err.message });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(str) {
  return UUID_RE.test(str ?? '');
}

function buildCategorySummary(rows) {
  const summary = {};
  for (const r of rows) {
    const cat = r.account_category;
    if (!summary[cat]) {
      summary[cat] = { count: 0, total_closing_balance: 0 };
    }
    summary[cat].count++;
    summary[cat].total_closing_balance =
      Math.round((summary[cat].total_closing_balance + (r.closing_balance_normalized || 0)) * 100) / 100;
  }
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);

app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         CAFlow — Tally XML Ingestion Service               ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Running on  http://localhost:${PORT}${''.padEnd(28 - PORT.toString().length)}║`);
  console.log('║                                                            ║');
  console.log('║  POST  /upload-xml              Upload Tally XML file      ║');
  console.log('║  GET   /trial-balance/:id       Normalized TB data         ║');
  console.log('║  GET   /trial-balance-raw/:id   Raw + normalized data      ║');
  console.log('║  GET   /logs/:id                Processing logs            ║');
  console.log('║  GET   /health                  Liveness check             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
});

module.exports = app; // exported for testing
