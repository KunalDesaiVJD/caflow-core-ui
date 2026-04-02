/**
 * parser.js — Tally XML Trial Balance Parser
 *
 * Handles Tally's exported XML format (Trial Balance display report).
 * Extracts rows using DSP-prefixed display fields:
 *   DSPDISPNAME → display_name
 *   DSPOPAMTA   → opening_balance_raw
 *   DSPDRAMTA   → debit_raw
 *   DSPCRAMTA   → credit_raw
 *   DSPCLAMTA   → closing_balance_raw
 *
 * Design principles:
 *   - NEVER crashes on missing/malformed tags
 *   - Blank numeric fields are treated as 0 (not errors)
 *   - Tries multiple known Tally XML path strategies
 *   - Falls back to deep tree search as final resort
 *   - Row with no DSPDISPNAME is logged and skipped (not thrown)
 *   - Skips known summary/total rows (Grand Total, etc.)
 */

const { XMLParser } = require('fast-xml-parser');
const { num } = require('./normalizer');

// ─── Rows to skip (totals and summary lines) ────────────────────────────────
const SKIP_ROW_NAMES = new Set([
  'grand total',
  'grand  total',
  'grandtotal',
  'total',
  'grand totals',
  'closing stock',  // sometimes injected as a TB line artificially
]);

// ─── XML Parser configuration ───────────────────────────────────────────────
const xmlParserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  // Do not merge arrays — keep structure intact
  isArray: (name) => [
    'DSPROW', 'TALLYMESSAGE', 'COLLECTION', 'ROW', 'LEDGER', 'GROUP',
    'ENTRY', 'TRIALBALROW', 'TBROW', 'LINE',
  ].includes(name),
};

/**
 * Safe text extractor — handles string, number, null, object.
 *
 * @param {*} v
 * @returns {string}
 */
function getText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in v) return String(v['#text']).trim();
  return '';
}

/**
 * Extract a single TB row from a node object.
 * Returns null if the node has no usable DSPDISPNAME.
 *
 * @param {object} node
 * @returns {{ display_name: string, opening_balance_raw: number, debit_raw: number, credit_raw: number, closing_balance_raw: number } | null}
 */
function extractRowFromNode(node) {
  if (!node || typeof node !== 'object') return null;

  // Support both direct fields and nested objects with #text
  const displayName = getText(node.DSPDISPNAME ?? node.DISPNAME ?? node.NAME ?? node.name ?? '');
  if (!displayName) return null;

  // Skip known totals/summary rows
  if (SKIP_ROW_NAMES.has(displayName.toLowerCase().trim())) return null;

  return {
    display_name: displayName,
    opening_balance_raw: num(getText(node.DSPOPAMTA ?? node.OPAMTA ?? node.OPENINGBALANCE ?? '')),
    debit_raw:           num(getText(node.DSPDRAMTA ?? node.DRAMTA  ?? node.DEBIT         ?? '')),
    credit_raw:          num(getText(node.DSPCRAMTA ?? node.CRAMTA  ?? node.CREDIT        ?? '')),
    closing_balance_raw: num(getText(node.DSPCLAMTA ?? node.CLAMTA  ?? node.CLOSINGBALANCE ?? '')),
  };
}

/**
 * Recursively search for nodes that contain DSPDISPNAME anywhere in the tree.
 *
 * @param {*} obj - Any parsed XML value
 * @param {object[]} result - Accumulator
 * @returns {object[]}
 */
function findDspRows(obj, result = []) {
  if (!obj || typeof obj !== 'object') return result;

  // If this object itself has a DSPDISPNAME, it is a TB row
  if ('DSPDISPNAME' in obj || 'DISPNAME' in obj) {
    result.push(obj);
    return result;
  }

  // Recurse into all values
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        findDspRows(item, result);
      }
    } else if (typeof val === 'object' && val !== null) {
      findDspRows(val, result);
    }
  }

  return result;
}

/**
 * Strategy 1: Tally display export (EXPORTDATA > REQUESTDATA > TALLYMESSAGE > COLLECTION > DSPROW)
 * Strategy 2: Tally data export (BODY > DATA > TALLYMESSAGE > COLLECTION > DSPROW)
 * Strategy 3: Flat COLLECTION > DSPROW
 * Strategy 4: Deep search for any node with DSPDISPNAME
 *
 * @param {object} parsed - Parsed XML object
 * @returns {object[]} Array of raw row nodes
 */
function findRowNodes(parsed) {
  const envelope = parsed?.ENVELOPE ?? parsed?.envelope ?? parsed;

  // ── Strategy 1: Standard Tally display export path ──────────────────────
  try {
    const messages = [].concat(
      envelope?.BODY?.EXPORTDATA?.REQUESTDATA?.TALLYMESSAGE ?? [],
      envelope?.BODY?.DATA?.TALLYMESSAGE ?? [],
      envelope?.BODY?.DATA?.REPORTDATA?.TALLYMESSAGE ?? [],
    ).filter(Boolean);

    let nodes = [];
    for (const msg of messages) {
      // Check COLLECTION container first (most common)
      const collections = [].concat(msg?.COLLECTION ?? []).filter(Boolean);
      for (const col of collections) {
        const rows = [].concat(col?.DSPROW ?? col?.ROW ?? col?.TRIALBALROW ?? col?.LINE ?? []).filter(Boolean);
        if (rows.length > 0) nodes.push(...rows);
      }
      // Also check direct DSPROW in message
      const directRows = [].concat(msg?.DSPROW ?? msg?.ROW ?? []).filter(Boolean);
      if (directRows.length > 0) nodes.push(...directRows);
    }
    if (nodes.length > 0) return nodes;
  } catch (_) {}

  // ── Strategy 2: Direct COLLECTION in BODY or REPORTDATA ─────────────────
  try {
    const body = envelope?.BODY ?? envelope?.REPORTDATA ?? envelope;
    const col = body?.COLLECTION ?? body?.REPORTDATA?.COLLECTION;
    if (col) {
      const rows = [].concat(
        col?.DSPROW ?? col?.ROW ?? col?.TRIALBALROW ?? []
      ).filter(Boolean);
      if (rows.length > 0) return rows;
    }
  } catch (_) {}

  // ── Strategy 3: TRIALBALANCE or TBDATA container ─────────────────────────
  try {
    const tbData =
      envelope?.BODY?.REPORTDATA?.TRIALBALANCE ??
      envelope?.TRIALBALANCE ??
      envelope?.TBDATA;
    if (tbData) {
      const rows = [].concat(tbData?.ROW ?? tbData?.DSPROW ?? tbData?.ENTRY ?? []).filter(Boolean);
      if (rows.length > 0) return rows;
    }
  } catch (_) {}

  // ── Strategy 4: Deep search anywhere in tree (catches all exotic formats) ─
  return findDspRows(parsed);
}

/**
 * Main parser — converts raw XML string into an array of TB row objects.
 *
 * @param {string} xmlString - Raw XML content from uploaded file
 * @returns {{ display_name: string, opening_balance_raw: number, debit_raw: number, credit_raw: number, closing_balance_raw: number }[]}
 * @throws {Error} If XML is completely unparseable (structural error)
 */
function parseTallyXml(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('Invalid input: xmlString must be a non-empty string');
  }

  const trimmed = xmlString.trim();
  if (!trimmed.startsWith('<')) {
    throw new Error('Invalid XML: content does not begin with "<". Is this really an XML file?');
  }

  // Parse XML
  const parser = new XMLParser(xmlParserOptions);
  let parsed;
  try {
    parsed = parser.parse(trimmed);
  } catch (err) {
    throw new Error(`XML parse error: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('XML parsed to empty or invalid structure');
  }

  // Find row nodes using all strategies
  const rawNodes = findRowNodes(parsed);

  // Extract and validate each row
  const rows = [];
  for (const node of rawNodes) {
    const row = extractRowFromNode(node);
    if (row) rows.push(row);
  }

  return rows;
}

module.exports = { parseTallyXml, extractRowFromNode, findRowNodes, getText, num };
