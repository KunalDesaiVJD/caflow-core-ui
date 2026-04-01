/**
 * tally-client.js — HTTP client for Tally XML API
 *
 * Tally ERP 9 / Tally Prime exposes an HTTP server on localhost:9000.
 * We POST XML requests and parse XML responses.
 *
 * Includes:
 *  - Retry logic (3 attempts with exponential backoff)
 *  - Timeout handling
 *  - Connection validation
 *  - Detailed error messages
 */

const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const { buildCompanyListQuery } = require('./queries');

// XML parser config — handles Tally's peculiar XML format
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  // Tally sometimes returns arrays as single items — always wrap in array
  isArray: (name) => [
    'GROUP', 'LEDGER', 'VOUCHER', 'COMPANY',
    'DSPACCNAME', 'DSPACC', 'ALLLEDGERENTRIES',
    'LEDGERENTRY', 'BILLALLOCATIONS',
    'TALLYMESSAGE', 'COLLECTION',
  ].includes(name),
});

class TallyClient {
  constructor(host = 'localhost', port = 9000) {
    this.url = `http://${host}:${port}`;
    this.timeout = 30000;     // 30s per request
    this.maxRetries = 3;
    this.retryDelay = 2000;   // 2s base delay, doubles each retry
  }

  // ─── Core request with retry ─────────────────────────────────────────────
  async request(xmlBody, retryCount = 0) {
    try {
      const response = await axios.post(this.url, xmlBody, {
        headers: {
          'Content-Type': 'text/xml;charset=utf-8',
          'Content-Length': Buffer.byteLength(xmlBody, 'utf8'),
        },
        timeout: this.timeout,
        responseType: 'text',
        // Tally returns 200 even for errors, so don't reject on status
        validateStatus: () => true,
      });

      if (!response.data || response.data.trim() === '') {
        throw new Error('Empty response from Tally. Is the company open?');
      }

      // Check for Tally error envelope
      if (response.data.includes('<LINEERROR>')) {
        const errMatch = response.data.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/);
        throw new Error(`Tally error: ${errMatch ? errMatch[1].trim() : 'Unknown'}`);
      }

      return response.data;
    } catch (err) {
      if (err.code === 'ECONNREFUSED') {
        const isRemote = !this.url.includes('localhost') && !this.url.includes('127.0.0.1');
        throw new Error(
          `Cannot connect to Tally at ${this.url}.\n` +
          (isRemote
            ? `  → REMOTE/LAN MODE: Check these on the SERVER PC:\n` +
              `     1. Tally is open and a company is loaded\n` +
              `     2. Tally XML Server is enabled (F12 → Advanced Config → Enable as Server = Yes)\n` +
              `     3. Windows Firewall on SERVER allows TCP port ${config_port(this.url)} INBOUND\n` +
              `        (Run on server: netsh advfirewall firewall add rule name="Tally XML" dir=in action=allow protocol=TCP localport=${config_port(this.url)})\n` +
              `     4. Server IP in .env TALLY_HOST is correct (run 'ipconfig' on server to verify)`
            : `  → LOCAL MODE: Check these on THIS PC:\n` +
              `     1. Tally is open with a company loaded\n` +
              `     2. Enable XML Server: Gateway of Tally → F12 → Advanced Config → Enable as Server = Yes\n` +
              `     3. Port 9000 is correct`)
        );
      }
      if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          console.warn(`  ⚠ Timeout (attempt ${retryCount + 1}/${this.maxRetries}). Retrying in ${delay / 1000}s...`);
          await sleep(delay);
          return this.request(xmlBody, retryCount + 1);
        }
        throw new Error(`Tally request timed out after ${this.maxRetries} retries`);
      }
      throw err;
    }
  }

  // ─── Parse XML response ────────────────────────────────────────────────
  parseXml(xmlText) {
    try {
      return xmlParser.parse(xmlText);
    } catch (err) {
      throw new Error(`XML parse error: ${err.message}`);
    }
  }

  // ─── Test connection ───────────────────────────────────────────────────
  async testConnection() {
    const xml = buildCompanyListQuery();
    const raw = await this.request(xml);
    const parsed = this.parseXml(raw);
    return !!parsed;
  }

  // ─── Get list of open companies ────────────────────────────────────────
  async getCompanies() {
    const xml = buildCompanyListQuery();
    const raw = await this.request(xml);
    const parsed = this.parseXml(raw);

    const companies = [];
    const envelope = parsed?.ENVELOPE;
    if (!envelope) return companies;

    // Walk BODY > DATA > TALLYMESSAGE > COLLECTION > COMPANY
    const body = envelope.BODY;
    const dataNode = body?.DATA || body?.EXPORTDATA;
    const messages = toArray(dataNode?.TALLYMESSAGE);

    for (const msg of messages) {
      const compList = toArray(msg?.COMPANY || msg?.collection?.COMPANY);
      for (const c of compList) {
        const name = getText(c?.NAME || c?.['#text'] || c);
        if (name) companies.push({ name, gst: getText(c?.GSTNUMBER), pan: getText(c?.PANNUMBER) });
      }
    }

    // Fallback: try COLLECTION directly
    if (companies.length === 0) {
      const colNode = envelope?.BODY?.DATA?.COLLECTION;
      const items = toArray(colNode?.COMPANY);
      for (const c of items) {
        const name = getText(c?.NAME || c?.['#text'] || c);
        if (name) companies.push({ name });
      }
    }

    return companies;
  }

  // ─── Generic collection fetch ──────────────────────────────────────────
  async fetchCollection(xmlQuery) {
    const raw = await this.request(xmlQuery);
    return { raw, parsed: this.parseXml(raw) };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function getText(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  if (val['#text']) return String(val['#text']).trim();
  return '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function config_port(url) {
  try { return new URL(url).port || '9000'; } catch { return '9000'; }
}

module.exports = { TallyClient, toArray, getText };
