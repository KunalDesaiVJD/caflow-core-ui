/**
 * parse_cell_map.mjs
 * Downloads XLSX files from Supabase Storage, reads the cell_map sheet,
 * and inserts rows into tax_audit_cell_map.
 * Run: node --env-file=.env scripts/parse_cell_map.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const xlsx = require(join(ROOT, 'node_modules', 'xlsx', 'xlsx.js'));

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const BUCKET = 'tax_audit_templates';

const TEMPLATES_DIR = join(ROOT, 'templates');

const templates = [
  { localFile: '3CA-3CD_v2.xlsx', templateName: '3CA-3CD' },
  { localFile: '3CB-3CD_v2.xlsx', templateName: '3CB-3CD' },
];

function downloadFile(localFile) {
  return readFileSync(join(TEMPLATES_DIR, localFile));
}

async function parseAndInsert(templateName, buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets['cell_map'];
  if (!ws) throw new Error(`No cell_map sheet in ${templateName}`);

  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  console.log(`  ${templateName}: ${rows.length} rows in cell_map`);

  const records = rows.map(r => ({
    template_name: templateName,
    sheet:         String(r.sheet || '').trim(),
    cell_address:  String(r.cell_address || '').trim(),
    field_key:     String(r.field_key || '').trim(),
    data_type:     String(r.data_type || 'text').trim() || 'text',
    source:        String(r.source || '').trim() || null,
    formula_cell:  r.formula === true || r.formula === 'true' || r.formula === 1 || r.formula === 'Y',
  })).filter(r => r.field_key && r.cell_address && r.sheet);

  // Delete existing rows for this template (idempotent re-run)
  await supabase.from('tax_audit_cell_map').delete().eq('template_name', templateName);

  const { error } = await supabase.from('tax_audit_cell_map').insert(records);
  if (error) throw new Error(`Insert failed for ${templateName}: ${error.message}`);

  console.log(`  ${templateName}: inserted ${records.length} rows ✓`);
  return records.length;
}

async function main() {
  let total = 0;
  for (const t of templates) {
    console.log(`\nProcessing ${t.templateName} (${t.localFile})...`);
    const buffer = downloadFile(t.localFile);
    const count = await parseAndInsert(t.templateName, buffer);
    total += count;
  }

  // Verify
  console.log('\nVerification query:');
  const { data, error } = await supabase
    .from('tax_audit_cell_map')
    .select('template_name')
    .order('template_name');

  if (error) {
    console.error('Verify error:', error.message);
  } else {
    const counts = {};
    for (const r of data) counts[r.template_name] = (counts[r.template_name] || 0) + 1;
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v} rows`);
  }

  console.log(`\nTotal inserted: ${total} rows`);
}

main().catch(err => { console.error(err); process.exit(1); });
