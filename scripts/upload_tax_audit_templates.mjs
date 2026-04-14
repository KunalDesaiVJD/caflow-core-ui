/**
 * upload_tax_audit_templates.mjs
 * Uploads both master XLSX files to Supabase Storage bucket: tax_audit_templates
 * Run: node scripts/upload_tax_audit_templates.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// env loaded via --env-file flag or already in process.env
const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const BUCKET = 'tax_audit_templates';
const TEMPLATES_DIR = join(__dirname, '..', 'templates');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const files = [
  { local: '3CA-3CD_v2.xlsx', remote: 'v1/3ca_3cd.xlsx' },
  { local: '3CB-3CD_v2.xlsx', remote: 'v1/3cb_3cd.xlsx' },
];

async function upload() {
  console.log(`Uploading to bucket: ${BUCKET}`);

  for (const f of files) {
    const localPath = join(TEMPLATES_DIR, f.local);
    const data = readFileSync(localPath);

    console.log(`  Uploading ${f.local} (${data.length} bytes) → ${f.remote} ...`);

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(f.remote, data, {
        contentType: XLSX_MIME,
        upsert: true,
      });

    if (error) {
      console.error(`  ✗ Failed: ${error.message}`);
      process.exit(1);
    }

    console.log(`  ✓ Uploaded: ${f.remote}`);
  }

  // Verify both files exist
  console.log('\nVerifying uploads...');
  const { data: listed, error: listErr } = await supabase.storage.from(BUCKET).list('v1');
  if (listErr) {
    console.error('List error:', listErr.message);
    process.exit(1);
  }

  console.log('Files in bucket/v1:');
  for (const item of listed) {
    console.log(`  ✓ ${item.name} — ${item.metadata?.size ?? '?'} bytes`);
  }

  console.log('\nAll done.');
}

upload().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
