/**
 * Inspect Form_3CD sheet structure — shows cell addresses around key clause rows
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const xlsx = require(join(ROOT, 'node_modules', 'xlsx', 'xlsx.js'));

const buf = readFileSync(join(ROOT, 'templates', '3CA-3CD_v2.xlsx'));
const wb = xlsx.read(buf, { type: 'buffer', cellStyles: true });

const ws = wb.Sheets['Form_3CD'];
const range = xlsx.utils.decode_range(ws['!ref']);
console.log(`Form_3CD range: ${ws['!ref']} (rows ${range.e.r - range.s.r + 1}, cols ${range.e.c - range.s.c + 1})`);

// Dump all non-empty cells — show row, col, value (first 200 rows)
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '', range: 0 });
console.log('\n--- Form_3CD cells (first 120 rows) ---');
for (let r = 0; r < Math.min(rows.length, 120); r++) {
  const row = rows[r];
  const nonEmpty = row.map((v, c) => v !== '' ? `${xlsx.utils.encode_col(c)}:${String(v).slice(0,50)}` : null).filter(Boolean);
  if (nonEmpty.length > 0) console.log(`  Row ${r+1}: ${nonEmpty.join(' | ')}`);
}

// Also show the ANX_3CD_Main sheet structure
const ws2 = wb.Sheets['ANX_3CD_Main'];
if (ws2) {
  console.log('\n--- ANX_3CD_Main cells (first 80 rows) ---');
  const rows2 = xlsx.utils.sheet_to_json(ws2, { header: 1, defval: '', range: 0 });
  for (let r = 0; r < Math.min(rows2.length, 80); r++) {
    const row = rows2[r];
    const nonEmpty = row.map((v, c) => v !== '' ? `${xlsx.utils.encode_col(c)}:${String(v).slice(0,50)}` : null).filter(Boolean);
    if (nonEmpty.length > 0) console.log(`  Row ${r+1}: ${nonEmpty.join(' | ')}`);
  }
}
