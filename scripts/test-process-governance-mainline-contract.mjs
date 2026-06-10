import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(resolve(root, 'docs', 'company-sankey-data.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const dashboardCheckSource = readFileSync(resolve(root, 'scripts', 'check-dashboard-data.mjs'), 'utf8');

assert.ok(Array.isArray(data.nodes), 'company snapshot should keep nodes');
assert.ok(Array.isArray(data.links), 'company snapshot should keep links');
assert.ok(Array.isArray(data.systems), 'company snapshot should keep systems');
assert.ok(data.stats && Number(data.stats.mappings) > 0, 'company snapshot should keep stats');
assert.ok(data.crossDept && Array.isArray(data.crossDept.risks), 'company snapshot should keep crossDept risks');

assert.ok(data.sourceManifest && Array.isArray(data.sourceManifest.files), 'sourceManifest.files should exist');
assert.ok(data.sourceManifest.files.length > 0, 'sourceManifest.files should not be empty');
assert.ok(
  data.sourceManifest.files.some(file => file.status === '纳入' && file.sha256 && file.path.startsWith('docs/norms/')),
  'source manifest should include hashed source files marked 纳入'
);
assert.ok(
  data.sourceManifest.files.every(file => ['纳入', '排除', '待复核'].includes(file.status)),
  'source manifest statuses should use controlled values'
);

assert.ok(Array.isArray(data.mdmRequirements), 'mdmRequirements should exist');
assert.ok(
  data.mdmRequirements.some(item => item.masterDataObject && item.sourceFile && item.sourceFile.endsWith('能力层与MDM建设要求.md')),
  'mdmRequirements should include master data candidates from department MDM documents'
);

assert.ok(Array.isArray(data.evidenceRefs), 'evidenceRefs should exist');
assert.ok(
  data.evidenceRefs.some(ref => ref.refType === 'L3' && ref.l3Name && ref.sourceFile),
  'evidenceRefs should include L3 evidence references'
);
assert.ok(
  data.evidenceRefs.some(ref => ref.refType === 'A1' && ref.a1Code && ref.evidenceType),
  'evidenceRefs should include A1 evidence references'
);
assert.ok(
  data.evidenceRefs.some(ref => ref.refType === 'MDM' && ref.masterDataObject),
  'evidenceRefs should include MDM requirement references'
);

assert.strictEqual(
  pkg.scripts && pkg.scripts['sync:process-governance'],
  'node scripts/sync-process-governance-mainline.mjs',
  'root package should expose sync:process-governance'
);
assert.ok(
  existsSync(resolve(root, 'scripts', 'sync-process-governance-mainline.mjs')),
  'sync-process-governance-mainline.mjs should exist'
);
assert.ok(
  dashboardCheckSource.includes('跨部门完整性检查报告.md'),
  'dashboard data check should derive crossDept expectations from the cross-department report'
);
assert.ok(
  !/crossDept\.stats\.(totalChecked|pendingConfirm|highRisk) expected \d+/.test(dashboardCheckSource),
  'dashboard data check must not freeze crossDept metrics as hard-coded historical numbers'
);

console.log('Process governance mainline contract test passed');
