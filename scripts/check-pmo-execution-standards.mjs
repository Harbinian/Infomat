/**
 * 校验 PMO 执行标准库、WBS 1.2 样板和 H5 诊断契约。
 *
 * 用法: node scripts/check-pmo-execution-standards.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pmoRoot = resolve(root, 'pmo');
const planPath = resolve(pmoRoot, '信息化项目_计划管控真源.md');
const wbsPath = resolve(pmoRoot, '信息化项目_WBS结构真源.md');
const standardsPath = resolve(pmoRoot, '信息化项目_执行标准真源.md');
const workflowSourcePath = resolve(pmoRoot, 'gantt-react', 'src', 'utils', 'deliverableWorkflow.js');
const taskLedgerSourcePath = resolve(pmoRoot, 'gantt-react', 'src', 'components', 'TaskLedger.jsx');

const REQUIRED_STANDARD_FIELDS = [
  '执行标准ID',
  '输入资料清单',
  '检查清单ID',
  '完成判定',
  '证据要求',
  '标准缺失标记',
  '标准暂缓原因',
];

const REQUIRED_STANDARD_IDS = [
  'STD-GEN-001',
  'STD-PLAN-001',
  'STD-INV-001',
  'STD-INTV-001',
  'STD-DATA-001',
  'STD-DATA-002',
  'STD-BOM-001',
  'STD-RES-001',
  'STD-SYS-001',
  'STD-IF-001',
  'STD-INFRA-001',
  'STD-NET-001',
  'STD-BKP-001',
  'STD-DB-001',
  'STD-GPU-001',
  'STD-ISSUE-001',
  'STD-REV-001',
  'STD-MOM-001',
  'STD-ACC-001',
];

const WBS3_STANDARD_BINDINGS = {
  '3.1.1': 'STD-DATA-001;STD-INV-001',
  '3.1.2': 'STD-GEN-001',
  '3.1.3': 'STD-REV-001',
  '3.1.4': 'STD-GEN-001;STD-MOM-001',
  '3.2.1': 'STD-DATA-001;STD-DATA-002;STD-INV-001',
  '3.2.2': 'STD-DATA-002;STD-GEN-001',
  '3.2.3': 'STD-REV-001',
  '3.2.4': 'STD-GEN-001;STD-MOM-001',
  '3.3.1': 'STD-BOM-001;STD-INV-001',
  '3.3.2': 'STD-BOM-001;STD-GEN-001',
  '3.3.3': 'STD-REV-001',
  '3.3.4': 'STD-GEN-001;STD-MOM-001',
  '3.4.1': 'STD-RES-001;STD-INV-001',
  '3.4.2': 'STD-RES-001;STD-GEN-001',
  '3.4.3': 'STD-REV-001',
  '3.4.4': 'STD-GEN-001;STD-MOM-001',
  '3.5.1': 'STD-DATA-001;STD-INV-001',
  '3.6.1': 'STD-DATA-001;STD-DATA-002;STD-INV-001',
  '3.7.1': 'STD-DATA-001;STD-ISSUE-001',
  '3.8.1': 'STD-ISSUE-001;STD-DATA-001',
  '3.9.1': 'STD-PLAN-001;STD-MOM-001',
};

function readJsonBlock(filePath, blockName) {
  const text = readFileSync(filePath, 'utf8');
  const pattern = new RegExp(`<!-- pmo-${blockName}-source:start -->\\s*\\\`\\\`\\\`json\\s*([\\s\\S]*?)\\s*\\\`\\\`\\\`\\s*<!-- pmo-${blockName}-source:end -->`);
  const match = text.match(pattern);
  assert.ok(match, `${filePath} should contain pmo-${blockName}-source JSON block`);
  return JSON.parse(match[1]);
}

function wbsDepth(wbs) {
  return String(wbs || '').split('.').filter(Boolean).length;
}

function assertNoWbsStructuralIssues(nodes) {
  const wbsList = nodes.map(node => String(node.WBS || ''));
  const seen = new Set();
  const duplicate = new Set();
  for (const wbs of wbsList) {
    if (seen.has(wbs)) duplicate.add(wbs);
    seen.add(wbs);
    assert.match(wbs, /^\d+(\.\d+)*$/, `WBS must be numeric dotted form: ${wbs}`);
  }
  assert.deepEqual([...duplicate], [], 'WBS must be unique');
  const orphans = wbsList.filter(wbs => wbs.includes('.') && !seen.has(wbs.split('.').slice(0, -1).join('.')));
  assert.deepEqual(orphans, [], 'child WBS nodes must have parent nodes');
}

assert.ok(existsSync(standardsPath), 'execution standard authoritative file should exist');
const standardData = readJsonBlock(standardsPath, 'standard');
assert.equal(standardData.schemaVersion, 'pmo-standard-source-v1');
assert.deepEqual(
  REQUIRED_STANDARD_IDS.filter(id => !(standardData.standards || []).some(item => item.standardId === id)),
  [],
  'execution standard source should include all V0.1 standard cards'
);

const wbsData = readJsonBlock(wbsPath, 'wbs');
const wbsNodes = wbsData.nodes || [];
assertNoWbsStructuralIssues(wbsNodes);
const wbs12Nodes = wbsNodes.filter(node => String(node.WBS || '') === '1.2' || String(node.WBS || '').startsWith('1.2.'));
assert.ok(wbs12Nodes.some(node => String(node.WBS) === '1.2.7'), 'WBS 1.2.7 should exist');
assert.ok(wbs12Nodes.some(node => String(node.WBS) === '1.2.7.6'), 'WBS 1.2.7.6 should exist');
assert.ok(Math.max(...wbs12Nodes.map(node => wbsDepth(node.WBS))) >= 4, 'WBS 1.2 should reach at least depth 4');
assert.equal(wbs12Nodes.find(node => String(node.WBS) === '1.2.4')?.是否里程碑, '否', 'WBS 1.2.4 should not be milestone');
assert.equal(wbsData.summary?.duplicateWbsCount, 0);
assert.equal(wbsData.summary?.orphanCount, 0);
assert.ok((wbsData.summary?.maxDepth || 0) >= 4, 'WBS source summary should reflect depth 4+');

const planData = readJsonBlock(planPath, 'plan');
assert.equal(
  planData.policy?.executionStandardAuthoritativeFile,
  '信息化项目_执行标准真源.md',
  'plan policy should point to execution standard authoritative file'
);
for (const field of REQUIRED_STANDARD_FIELDS) {
  assert.ok(planData.columns?.includes(field), `plan columns should include ${field}`);
}
const executionStandardGroup = (planData.fieldGroups || []).find(group => group.name === '执行标准字段');
assert.ok(executionStandardGroup, 'plan fieldGroups should include 执行标准字段');
assert.deepEqual(REQUIRED_STANDARD_FIELDS.filter(field => !executionStandardGroup.fields.includes(field)), []);

const tasks = planData.tasks || [];
const taskByWbs = new Map(tasks.map(task => [String(task.WBS), task]));
const wbs12Tasks = tasks.filter(task => String(task.WBS || '') === '1.2' || String(task.WBS || '').startsWith('1.2.'));
const wbs12TaskWbs = new Set(wbs12Tasks.map(task => String(task.WBS)));
const wbs12LeafTasks = wbs12Tasks.filter(task => ![...wbs12TaskWbs].some(wbs => wbs !== String(task.WBS) && wbs.startsWith(`${task.WBS}.`)));
assert.ok(wbs12LeafTasks.length >= 40, 'WBS 1.2 should contain execution-level leaf tasks');
assert.ok(wbs12LeafTasks.every(task => task.执行标准ID && task.完成判定 && task.证据要求), 'WBS 1.2 leaf tasks should bind standards, completion criteria, and evidence requirements');
assert.equal(taskByWbs.get('1.2.7.6')?.前置任务, taskByWbs.get('1.2.7.5')?.ID);
assert.equal(taskByWbs.get('1.3.1')?.前置任务, taskByWbs.get('1.2.7.6')?.ID);

for (const [wbs, standardId] of Object.entries(WBS3_STANDARD_BINDINGS)) {
  const task = taskByWbs.get(wbs);
  assert.ok(task, `WBS ${wbs} should exist`);
  assert.equal(task.执行标准ID, standardId, `WBS ${wbs} should bind ${standardId}`);
  assert.ok(task.完成判定, `WBS ${wbs} should include completion criteria`);
}
assert.match(taskByWbs.get('3.2.1')?.标准暂缓原因 || '', /必要时拆/);
assert.match(taskByWbs.get('3.3.1')?.标准暂缓原因 || '', /必要时拆/);
assert.match(taskByWbs.get('3.4.1')?.标准暂缓原因 || '', /必要时拆/);
assert.match(taskByWbs.get('3.6.1')?.标准暂缓原因 || '', /必要时拆/);
assert.match(taskByWbs.get('3.7.1')?.标准暂缓原因 || '', /必要时拆/);
assert.match(taskByWbs.get('3.9.1')?.标准暂缓原因 || '', /建议重命名/);

const workflowSource = readFileSync(workflowSourcePath, 'utf8');
const taskLedgerSource = readFileSync(taskLedgerSourcePath, 'utf8');
assert.match(workflowSource, /standardGap|执行标准缺口/, 'PMO workflow should compute execution standard diagnostics');
assert.match(taskLedgerSource, /standardGap|执行标准缺口/, 'PMO task ledger should expose execution standard diagnostics');

console.log('PMO execution standards check passed');
