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
  // Ensure repeated sibling elements become arrays (not overwritten)
  isArray: (name) => [
    'DSPROW', 'TALLYMESSAGE', 'COLLECTION', 'ROW', 'LEDGER', 'GROUP',
    'ENTRY', 'TRIALBALROW', 'TBROW', 'LINE',
    // Strategy 5: Tally TB display export uses DSPACCNAME/DSPACCINFO pairs
    'DSPACCNAME', 'DSPACCINFO',
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
 * Strategy 1: Tally TB display export — DSPACCNAME[] / DSPACCINFO[] parallel arrays
 *             (most common real-world Tally export — direct ENVELOPE children)
 *             DSPACCNAME[i].DSPDISPNAME  →  display name
 *             DSPACCINFO[i].DSPOPAMT.DSPOPAMTA  →  opening balance
 *             DSPACCINFO[i].DSPDRAMT.DSPDRAMTA  →  debit
 *             DSPACCINFO[i].DSPCRAMT.DSPCRAMTA  →  credit
 *             DSPACCINFO[i].DSPCLAMT.DSPCLAMTA  →  closing balance
 *
 * Strategy 2: DSPROW-wrapped rows (TALLYMESSAGE > COLLECTION > DSPROW)
 * Strategy 3: Direct COLLECTION in BODY or REPORTDATA
 * Strategy 4: TRIALBALANCE / TBDATA container
 * Strategy 5: Deep search for any node with DSPDISPNAME (last resort)
 *
 * @param {object} parsed - Parsed XML object
 * @returns {object[]} Array of normalised row nodes (all have DSPDISPNAME + amount fields flat)
 */
function findRowNodes(parsed) {
  const envelope = parsed?.ENVELOPE ?? parsed?.envelope ?? parsed;

  // ── Strategy 1: DSPACCNAME[] / DSPACCINFO[] parallel array format ────────
  // This is the native Tally Trial Balance display export format.
  // Names and info are separate sibling arrays; zip them by index.
  try {
    const nameNodes = [].concat(envelope?.DSPACCNAME ?? []).filter(Boolean);
    const infoNodes = [].concat(envelope?.DSPACCINFO ?? []).filter(Boolean);

    if (nameNodes.length > 0 && infoNodes.length > 0) {
      const paired = [];
      const count = Math.min(nameNodes.length, infoNodes.length);
      for (let i = 0; i < count; i++) {
        const nameNode = nameNodes[i];
        const infoNode = infoNodes[i];
        // Flatten into a single node the extractor understands
        paired.push({
          DSPDISPNAME: nameNode?.DSPDISPNAME ?? '',
          DSPOPAMTA:   infoNode?.DSPOPAMT?.DSPOPAMTA ?? '',
          DSPDRAMTA:   infoNode?.DSPDRAMT?.DSPDRAMTA ?? '',
          DSPCRAMTA:   infoNode?.DSPCRAMT?.DSPCRAMTA ?? '',
          DSPCLAMTA:   infoNode?.DSPCLAMT?.DSPCLAMTA ?? '',
        });
      }
      if (paired.length > 0) return paired;
    }
  } catch (_) {}

  // ── Strategy 2: Standard TALLYMESSAGE > COLLECTION > DSPROW path ─────────
  try {
    const messages = [].concat(
      envelope?.BODY?.EXPORTDATA?.REQUESTDATA?.TALLYMESSAGE ?? [],
      envelope?.BODY?.DATA?.TALLYMESSAGE ?? [],
      envelope?.BODY?.DATA?.REPORTDATA?.TALLYMESSAGE ?? [],
    ).filter(Boolean);

    let nodes = [];
    for (const msg of messages) {
      const collections = [].concat(msg?.COLLECTION ?? []).filter(Boolean);
      for (const col of collections) {
        const rows = [].concat(col?.DSPROW ?? col?.ROW ?? col?.TRIALBALROW ?? col?.LINE ?? []).filter(Boolean);
        if (rows.length > 0) nodes.push(...rows);
      }
      const directRows = [].concat(msg?.DSPROW ?? msg?.ROW ?? []).filter(Boolean);
      if (directRows.length > 0) nodes.push(...directRows);
    }
    if (nodes.length > 0) return nodes;
  } catch (_) {}

  // ── Strategy 3: Direct COLLECTION in BODY or REPORTDATA ─────────────────
  try {
    const body = envelope?.BODY ?? envelope?.REPORTDATA ?? envelope;
    const col = body?.COLLECTION ?? body?.REPORTDATA?.COLLECTION;
    if (col) {
      const rows = [].concat(col?.DSPROW ?? col?.ROW ?? col?.TRIALBALROW ?? []).filter(Boolean);
      if (rows.length > 0) return rows;
    }
  } catch (_) {}

  // ── Strategy 4: TRIALBALANCE or TBDATA container ─────────────────────────
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

  // ── Strategy 5: Deep search anywhere in tree (catches all exotic formats) ─
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
