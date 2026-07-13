import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(resolve(root, 'docs', 'company-sankey-data.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const dashboardCheckSource = readFileSync(resolve(root, 'scripts', 'check-dashboard-data.mjs'), 'utf8');
const mainlineTestSource = readFileSync(resolve(root, 'scripts', 'test-process-governance-mainline.mjs'), 'utf8');

assert.ok(Array.isArray(data.nodes), 'company snapshot should keep nodes');
assert.ok(Array.isArray(data.links), 'company snapshot should keep links');
assert.ok(Array.isArray(data.systems), 'company snapshot should keep systems');
assert.ok(data.stats && Number(data.stats.mappings) > 0, 'company snapshot should keep stats');
assert.ok(data.crossDept && Array.isArray(data.crossDept.risks), 'company snapshot should keep crossDept risks');
assert.ok(Array.isArray(data.processMappings), 'company snapshot should expose processMappings for MySQL import');
assert.ok(
  data.processMappings.some(item => item.dept && item.l1 && item.l2 && item.l3 && item.sourceFile),
  'processMappings should preserve department scoped L1/L2/L3 source rows'
);
assert.ok(
  data.processMappings.every(item => !['总经理直辖域', '经营域', '生产域'].includes(item.l1)),
  'processMappings.l1 should be capability domains, not organization domains'
);

assert.ok(data.sourceManifest && Array.isArray(data.sourceManifest.files), 'sourceManifest.files should exist');
assert.ok(data.sourceManifest.files.length > 0, 'sourceManifest.files should not be empty');
assert.ok(
  data.sourceManifest.files.some(file => file.status === '纳入' && file.sha256 && file.path.startsWith('docs/norms/')),
  'source manifest should include hashed source files marked 纳入'
);
assert.ok(
  data.sourceManifest.files.some(file => file.status === '纳入' && file.sha256 && file.path === 'docs/organization/组织架构和部门职责.md'),
  'source manifest should include hashed organization source because parser derives department domains from it'
);
assert.ok(
  data.sourceManifest.files.every(file => ['纳入', '排除', '待复核'].includes(file.status)),
  'source manifest statuses should use controlled values'
);

assert.ok(Array.isArray(data.mdmRequirements), 'mdmRequirements should exist');
assert.ok(
  data.mdmRequirements.some(item => item.masterDataObject && item.sourceFile && item.sourceFile.endsWith('能力层与MDM建设要求.md')),
  'mdmRequirements should include master data review items from department MDM documents'
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
assert.strictEqual(
  pkg.scripts && pkg.scripts['test:process-governance-mainline'],
  'node scripts/test-process-governance-mainline.mjs',
  'root package should expose the aggregated process governance mainline test'
);
assert.strictEqual(
  pkg.scripts && pkg.scripts['build:pmo-task-data'],
  'python pmo/build_pmo_task_data.py',
  'root package should expose the PMO Markdown truth-source data builder'
);
assert.strictEqual(
  pkg.scripts && pkg.scripts['test:project-governance-upgrade'],
  'node scripts/test-project-governance-report.mjs && npm --prefix apps/mdm-platform run test:role-workbench && npm --prefix apps/mdm-platform run test:role-workbench-mysql',
  'root package should expose the project governance upgrade test'
);
assert.ok(
  existsSync(resolve(root, 'scripts', 'test-process-governance-mainline.mjs')),
  'test-process-governance-mainline.mjs should exist'
);
assert.ok(
  mainlineTestSource.includes('test:project-governance-upgrade'),
  'aggregated process governance mainline test should include the project governance upgrade test'
);
assert.strictEqual(
  pkg.scripts && pkg.scripts['test:pmo-standard-gap-operations'],
  'node scripts/check-pmo-standard-gap-operations.mjs',
  'root package should expose the PMO standard gap operations test'
);
assert.ok(
  mainlineTestSource.includes('check-pmo-standard-gap-operations.mjs'),
  'aggregated process governance mainline test should include PMO standard gap operations'
);
assert.strictEqual(
  pkg.scripts && pkg.scripts['test:norms-source-manifest'],
  'node scripts/check-norms-source-manifest.mjs',
  'root package should expose test:norms-source-manifest'
);
assert.ok(
  existsSync(resolve(root, 'scripts', 'check-norms-source-manifest.mjs')),
  'check-norms-source-manifest.mjs should exist'
);
assert.strictEqual(
  pkg.scripts && pkg.scripts['test:dept-domain-mapping'],
  'node scripts/check-dept-domain-mapping.mjs',
  'root package should expose test:dept-domain-mapping'
);
assert.ok(
  existsSync(resolve(root, 'scripts', 'check-dept-domain-mapping.mjs')),
  'check-dept-domain-mapping.mjs should exist'
);
assert.strictEqual(
  pkg.scripts && pkg.scripts['test:engineering-source-manifest'],
  'node scripts/check-engineering-source-manifest.mjs',
  'root package should expose test:engineering-source-manifest'
);
assert.ok(
  existsSync(resolve(root, 'scripts', 'check-engineering-source-manifest.mjs')),
  'check-engineering-source-manifest.mjs should exist'
);
assert.strictEqual(
  pkg.scripts && pkg.scripts['test:source-manifest-hashes'],
  'node scripts/check-source-manifest-hashes.mjs',
  'root package should expose test:source-manifest-hashes'
);
assert.ok(
  existsSync(resolve(root, 'scripts', 'check-source-manifest-hashes.mjs')),
  'check-source-manifest-hashes.mjs should exist'
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
