const fs = require('fs');
const p = 'C:/Users/kvdes/AppData/Local/Temp/claude/C--Users-kvdes-OneDrive-Desktop-Audit-caflow-core-ui-main/53e5b672-c5ce-45a6-bdc2-ebb50aa326cd/tasks/wy7kxyu90.output';
let d = JSON.parse(fs.readFileSync(p, 'utf8'));
let r = d.result;
if (typeof r === 'string') { const i = r.indexOf('{'); r = JSON.parse(r.slice(i)); }

const out = [];
out.push('RESULT KEYS: ' + Object.keys(r).join(', '));
out.push('specs#=' + (r.specs || []).length + ' adversarial#=' + (r.adversarial || []).length + ' plan?=' + !!r.plan);

out.push('\n\n================ ADVERSARIAL ================');
for (const a of (r.adversarial || [])) {
  out.push('\n### ' + (a.phase || '?'));
  out.push('verdict: ' + a.verdict);
  for (const f of (a.findings || [])) {
    out.push('  [' + f.severity + '] ' + f.issue);
    out.push('      MIT: ' + f.mitigation);
  }
  for (const x of (a.dataCorruptionRisks || [])) out.push('  DATA-RISK: ' + x);
}

out.push('\n\n================ RECONCILE PLAN ================');
const pl = r.plan || {};
out.push('\n-- SEQUENCE --');
(pl.sequence || []).forEach((s, i) => out.push((i + 1) + '. ' + s));
out.push('\n-- FILE CONFLICTS --');
for (const fc of (pl.fileConflicts || [])) {
  out.push('* ' + fc.file + '  [' + (fc.phases || []).join(', ') + ']');
  out.push('    -> ' + fc.resolution);
}
out.push('\n-- SHARED TYPE CHANGES --');
(pl.sharedTypeChanges || []).forEach(s => out.push('  - ' + s));
out.push('\n-- GOLDEN TEST TARGETS --');
(pl.goldenTestTargets || []).forEach(s => out.push('  - ' + s));
out.push('\n-- UNIFIED PLAN --');
out.push(pl.unifiedPlan || '(none)');

fs.writeFileSync('diag_audit/_design_summary.txt', out.join('\n'), 'utf8');

// Dump each spec to its own file
for (const s of (r.specs || [])) {
  const key = (s.phase || 'phase').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
  const lines = [];
  lines.push('PHASE: ' + s.phase);
  lines.push('\nSUMMARY:\n' + s.summary);
  lines.push('\nDEPENDS ON: ' + (s.dependsOn || []).join(', '));
  lines.push('\nNEW TYPES:');
  (s.newTypes || []).forEach(t => lines.push('  ' + t));
  lines.push('\nBACK-COMPAT:\n' + s.backCompat);
  lines.push('\nFILES:');
  for (const f of (s.files || [])) {
    lines.push('\n  === ' + f.path + ' ===');
    (f.changes || []).forEach(c => lines.push('   - ' + c));
  }
  lines.push('\nRISKS:');
  (s.risks || []).forEach(x => lines.push('  - ' + x));
  lines.push('\nTEST PLAN:');
  (s.testPlan || []).forEach(x => lines.push('  - ' + x));
  fs.writeFileSync('diag_audit/_spec_' + key + '.txt', lines.join('\n'), 'utf8');
}

fs.writeFileSync('diag_audit/_spec_index.txt', (r.specs || []).map(s => s.phase).join('\n'), 'utf8');
console.log('WROTE diag_audit/_design_summary.txt and ' + (r.specs || []).length + ' spec files');
console.log('Specs:'); (r.specs || []).forEach(s => console.log(' - ' + s.phase));
