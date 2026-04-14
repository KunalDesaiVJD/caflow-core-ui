const XLSX = require('xlsx');
const path = require('path');

const files = [
  "C:/Users/kvdes/OneDrive/Desktop/Audit/caflow-core-ui-main/templates/3CB-3CD_v2.xlsx",
  "C:/Users/kvdes/OneDrive/Desktop/Audit/caflow-core-ui-main/templates/3CA-3CD_v2.xlsx",
];

for (const fpath of files) {
  console.log('\n' + '='.repeat(60));
  console.log('FILE: ' + path.basename(fpath));
  console.log('='.repeat(60));

  const wb = XLSX.readFile(fpath, { cellStyles: true, cellFormula: true, sheetStubs: true });
  console.log('Sheets:', wb.SheetNames);

  // ---- Form_3CD ----
  const ws = wb.Sheets['Form_3CD'];
  if (!ws) { console.log('No Form_3CD sheet'); continue; }
  const ref = ws['!ref'];
  console.log('\n--- Form_3CD sheet ---');
  console.log('Ref range:', ref);

  const merges = ws['!merges'] || [];
  console.log('\nMerged cells (' + merges.length + '):');
  merges.forEach(m => {
    const s = XLSX.utils.encode_cell(m.s);
    const e = XLSX.utils.encode_cell(m.e);
    console.log('  ' + s + ':' + e);
  });

  console.log('\nNon-empty cells:');
  const range = XLSX.utils.decode_range(ref);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
        const formula = cell.f ? ' [formula: =' + cell.f + ']' : '';
        console.log('  ' + addr + ': ' + JSON.stringify(cell.v) + formula);
      }
    }
  }

  // ---- 01_Control ----
  const ws2 = wb.Sheets['01_Control'];
  if (ws2) {
    console.log('\n--- 01_Control sheet ---');
    const ref2 = ws2['!ref'];
    console.log('Ref range:', ref2);
    const range2 = XLSX.utils.decode_range(ref2);
    for (let R = range2.s.r; R <= range2.e.r; R++) {
      for (let C = range2.s.c; C <= range2.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws2[addr];
        if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
          const formula = cell.f ? ' [formula: =' + cell.f + ']' : '';
          console.log('  ' + addr + ': ' + JSON.stringify(cell.v) + formula);
        }
      }
    }
  }
}
