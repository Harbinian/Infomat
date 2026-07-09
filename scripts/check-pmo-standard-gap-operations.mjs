/**
 * 校验 PMO 执行标准缺口分桶、优先级队列和 H5 治理入口。
 *
 * 用法: node scripts/check-pmo-standard-gap-operations.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pmoRoot = resolve(root, 'pmo');
const tasksPath = resolve(pmoRoot, 'tasks.json');
const manifestPath = resolve(pmoRoot, 'pmo-source-manifest.json');
const planPath = resolve(pmoRoot, '信息化项目_计划管控真源.md');
const standardsPath = resolve(pmoRoot, '信息化项目_执行标准真源.md');
const appPath = resolve(pmoRoot, 'gantt-react', 'src', 'App.jsx');
const workflowPath = resolve(pmoRoot, 'gantt-react', 'src', 'utils', 'deliverableWorkflow.js');
const standardViewPath = resolve(pmoRoot, 'gantt-react', 'src', 'components', 'StandardGapOperationsView.jsx');
const packagePath = resolve(root, 'package.json');

const BUCKETS = ['必须补', '自动可补', '合理暂缓', '需拆分后补', '人工复核'];
const ACTIONABLE_BUCKETS = BUCKETS.filter(bucket => bucket !== '合理暂缓');
const GOVERNANCE_STANDARD_IDS = ['STD-GATE-001', 'STD-G9-001', 'STD-UAT-001', 'STD-PAY-001', 'STD-DR-001'];
const DEPRECATED_PMO_INPUTS = [
  'pmo/信息化项目_Project_H5最终执行版_导入表.xlsx',
  'pmo/信息化项目_Project_H5最终执行版_导入表_旧版备份.xlsx',
  'pmo/信息化项目组项目管理表.mpp',
  'pmo/信息化项目.csv',
  'pmo/md_to_xlsx.py',
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonBlock(filePath, blockName) {
  const text = readFileSync(filePath, 'utf8');
  const pattern = new RegExp(`<!-- pmo-${blockName}-source:start -->\\s*\\\`\\\`\\\`json\\s*([\\s\\S]*?)\\s*\\\`\\\`\\\`\\s*<!-- pmo-${blockName}-source:end -->`);
  const match = text.match(pattern);
  assert.ok(match, `${filePath} should contain pmo-${blockName}-source JSON block`);
  return JSON.parse(match[1]);
}

function isBoundStandard(task) {
  const standardId = String(task.executionStandardId || '').trim();
  return Boolean(standardId && standardId !== '暂缓');
}

function isActionableGap(task) {
  return ACTIONABLE_BUCKETS.includes(task.standardsGapBucket);
}

const tasks = readJson(tasksPath);
const manifest = readJson(manifestPath);
const planData = readJsonBlock(planPath, 'plan');
const standardData = readJsonBlock(standardsPath, 'standard');
const appSource = readFileSync(appPath, 'utf8');
const workflowSource = readFileSync(workflowPath, 'utf8');
const packageJson = readJson(packagePath);

assert.ok(Array.isArray(tasks) && tasks.length > 0, 'PMO tasks should be generated before checking standard gap operations');

for (const relativePath of DEPRECATED_PMO_INPUTS) {
  assert.equal(existsSync(resolve(root, relativePath)), false, `${relativePath} has been retired and must not exist`);
}

for (const id of GOVERNANCE_STANDARD_IDS) {
  assert.ok((standardData.standards || []).some(item => item.standardId === id), `execution standards should include ${id}`);
}
assert.equal(
  (standardData.standards || []).some(item => item.standardId === 'STD-ACPT-001'),
  false,
  'STD-ACPT-001 should not be introduced; acceptance uses STD-ACC-001'
);

assert.ok(planData.columns?.includes('里程碑例外原因'), 'plan source should expose 里程碑例外原因');
const milestoneExceptions = (planData.tasks || []).filter(task => task.里程碑 === '是' && task.工期 !== '0工作日' && !task.里程碑例外原因);
assert.deepEqual(
  milestoneExceptions.map(task => `${task.WBS} ${task.任务名称}`),
  [],
  'milestone tasks with non-zero duration must declare 里程碑例外原因'
);

const diagnosticFields = [
  'requiresExecutionStandard',
  'standardsGapBucket',
  'standardsGapReasons',
  'standardsGapPriorityScore',
  'suggestedStandardId',
  'suggestedAction',
];

for (const task of tasks) {
  for (const field of diagnosticFields) {
    assert.ok(Object.hasOwn(task, field), `task ${task.wbs || task.id} should include ${field}`);
  }
  assert.equal(typeof task.requiresExecutionStandard, 'boolean', `task ${task.wbs || task.id} requiresExecutionStandard should be boolean`);
  assert.ok(Array.isArray(task.standardsGapReasons), `task ${task.wbs || task.id} standardsGapReasons should be array`);
  assert.equal(typeof task.standardsGapPriorityScore, 'number', `task ${task.wbs || task.id} standardsGapPriorityScore should be number`);
  if (task.standardsGapBucket) {
    assert.ok(BUCKETS.includes(task.standardsGapBucket), `task ${task.wbs || task.id} has unknown bucket ${task.standardsGapBucket}`);
  }
}

const bucketCounts = Object.fromEntries(BUCKETS.map(bucket => [bucket, tasks.filter(task => task.standardsGapBucket === bucket).length]));
for (const bucket of BUCKETS) {
  assert.ok(bucketCounts[bucket] > 0, `bucket ${bucket} should have at least one task`);
}

const coveredTasksWithBucket = tasks.filter(task => isBoundStandard(task) && task.standardsGapBucket);
assert.deepEqual(
  coveredTasksWithBucket.map(task => `${task.wbs} ${task.name}`),
  [],
  'tasks with bound execution standards should not enter gap buckets'
);

const deferredWithoutReason = tasks.filter(task => task.standardsGapBucket === '合理暂缓' && !task.standardDeferredReason);
assert.deepEqual(
  deferredWithoutReason.map(task => `${task.wbs} ${task.name}`),
  [],
  '合理暂缓 tasks must include standardDeferredReason'
);

const highRiskActionable = tasks.filter(task => task.risk === '高' && !isBoundStandard(task) && isActionableGap(task));
const criticalActionable = tasks.filter(task => task.isCriticalControl === '是' && !isBoundStandard(task) && isActionableGap(task));
const phaseGateActionable = tasks.filter(task => task.phaseGateNo && !isBoundStandard(task) && isActionableGap(task));
assert.ok(highRiskActionable.length > 0, 'high-risk tasks without standards should enter actionable gap queue');
assert.ok(criticalActionable.length > 0, 'critical control tasks without standards should enter actionable gap queue');
assert.ok(phaseGateActionable.length > 0, 'phase-gate tasks without standards should enter actionable gap queue');

const actionableQueue = tasks
  .filter(isActionableGap)
  .sort((a, b) => b.standardsGapPriorityScore - a.standardsGapPriorityScore);
assert.ok(actionableQueue.length >= 30, 'standard gap priority queue should contain at least 30 actionable tasks');
assert.ok(
  actionableQueue.slice(0, 30).every(task => task.standardsGapPriorityScore > 0 && task.suggestedStandardId && task.suggestedAction),
  'top 30 priority queue tasks should include score, suggested standard, and suggested action'
);

assert.equal(manifest.standardGovernance?.schemaVersion, 'pmo-standard-gap-operations-v1');
assert.equal(manifest.standardGovernance?.referenceDate, manifest.snapshotDate);
assert.equal(manifest.standardGovernance?.taskCount, tasks.length);
assert.deepEqual(manifest.standardGovernance?.bucketCounts, bucketCounts);
assert.equal(manifest.standardGovernance?.actionableGapCount, actionableQueue.length);
assert.equal(manifest.standardGovernance?.standardSource, '信息化项目_执行标准真源.md');
assert.equal(manifest.standardGovernance?.generatedBy, 'pmo/build_pmo_task_data.py');

assert.equal(packageJson.scripts?.['test:pmo-standard-gap-operations'], 'node scripts/check-pmo-standard-gap-operations.mjs');
assert.ok(existsSync(standardViewPath), 'PMO H5 should include StandardGapOperationsView component');
assert.match(appSource, /standard-governance|标准治理/, 'PMO App should expose 标准治理 view');
assert.match(workflowSource, /standardsGapBucket|standardsGapPriorityScore|suggestedStandardId|suggestedAction/, 'frontend workflow should understand standard gap operations fields');

console.log(`PMO standard gap operations check passed: ${actionableQueue.length} actionable, buckets ${JSON.stringify(bucketCounts)}`);
