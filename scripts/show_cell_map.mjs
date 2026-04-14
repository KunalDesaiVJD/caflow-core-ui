import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const xlsx = require(join(ROOT, 'node_modules', 'xlsx', 'xlsx.js'));

for (const [name, file] of [['3CA-3CD', '3CA-3CD_v2.xlsx'], ['3CB-3CD', '3CB-3CD_v2.xlsx']]) {
  console.log(`\n=== ${name} ===`);
  const buf = readFileSync(join(ROOT, 'templates', file));
  const wb = xlsx.read(buf, { type: 'buffer' });
  console.log('Sheets:', wb.SheetNames.join(', '));
  const ws = wb.Sheets['cell_map'];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  rows.forEach(r => {
    console.log(`  ${r.field_key} | sheet=${r.sheet} | cell=${r.cell_address} | source=${r.source} | type=${r.data_type} | formula=${r.formula}`);
  });
}
