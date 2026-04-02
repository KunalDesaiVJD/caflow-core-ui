/**
 * logger.js — Structured logging for Tally XML ingestion
 *
 * Writes to:
 *   1. Console (always) — for developer visibility
 *   2. tally_processing_logs table (via database.js) — for API exposure
 *
 * Uses an in-memory buffer that is flushed in one bulk DB insert at the end
 * of each upload, minimising round-trips during row processing.
 *
 * Design rules:
 *   - NEVER throws — all DB errors are silently swallowed to avoid cascading
 *   - flushLogs() must be called at the end of each upload processing cycle
 *   - resetBuffer() can be called between uploads (or flush handles this)
 */

const { insertLog, bulkInsertLogs } = require('./database');

// In-memory buffer — flushed at end of each upload
const _buffer = [];
let _currentUploadId = null;

/**
 * Set the active upload context (clears buffer from prior upload).
 *
 * @param {string} uploadId
 */
function setUploadContext(uploadId) {
  _currentUploadId = uploadId;
  _buffer.length = 0;
}

/**
 * Log a message immediately to the DB (for critical events that should
 * survive even if flushLogs() is never reached, e.g. parse failure).
 *
 * @param {string} uploadId
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 */
async function log(uploadId, level, message) {
  const prefix = level === 'error' ? '✘' : level === 'warn' ? '⚠' : '•';
  console.log(`  ${prefix} [${level.toUpperCase()}] ${message}`);

  // Buffer for bulk flush
  _buffer.push({ upload_id: uploadId, log_level: level, log_message: message });

  // For error-level messages, write immediately so they survive crashes
  if (level === 'error') {
    await insertLog(uploadId, level, message);
  }
}

/**
 * Flush all buffered logs to the database in a single bulk insert.
 * Call this once at the end of successful processing.
 *
 * Non-error logs are buffered (not written row-by-row) for performance.
 * Error logs are already written by log() so they will be duplicated
 * unless we filter them out before flushing.
 */
async function flushLogs() {
  // Only flush non-error entries — errors were already written immediately
  const nonErrorEntries = _buffer.filter(e => e.log_level !== 'error');
  if (nonErrorEntries.length > 0) {
    await bulkInsertLogs(nonErrorEntries);
  }
  // Clear buffer
  _buffer.length = 0;
}

/**
 * Clear the in-memory buffer without writing to DB.
 * Use between uploads in long-running processes.
 */
function resetBuffer() {
  _buffer.length = 0;
  _currentUploadId = null;
}

module.exports = { log, flushLogs, resetBuffer, setUploadContext };
