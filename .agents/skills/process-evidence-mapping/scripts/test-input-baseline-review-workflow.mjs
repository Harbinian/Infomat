#!/usr/bin/env node
/**
 * End-to-end checks for the generic process evidence workflow.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');
const workflow = join(root, '.agents', 'skills', 'process-evidence-mapping', 'scripts', 'run-process-input-baseline-review-workflow.mjs');
const validator = join(root, '.agents', 'skills', 'process-evidence-mapping', 'scripts', 'validate-document-structured-output-v2.mjs');
const fixtureParent = join(root, 'artifacts', 'process-input-baseline-review');
mkdirSync(fixtureParent, { recursive: true });
const fixtureRoot = mkdtempSync(join(fixtureParent, 'test-v2-'));
const sourceDir = join(fixtureRoot, 'source');
const runDir = join(fixtureRoot, 'basic');
const blockedRunDir = join(fixtureRoot, 'blocked');
const mixedBlockedRunDir = join(fixtureRoot, 'mixed-blocked');
const sourcePath = join(sourceDir, 'GLTX-GC-01-A产品设计需求管理程序.md');
const mappingPath = join(sourceDir, '工程技术部流程映射.md');

mkdirSync(sourceDir, { recursive: true });

writeFileSync(sourcePath, [
  '# 产品设计需求管理程序',
  '',
  '## 1 目的',
  '',
  '规范产品设计需求文件的编制、审核、批准、发放和归档。',
  '',
  '## 2 范围',
  '',
  '适用于工程技术部产品设计需求管理。',
  '',
  '## 5 工作程序',
  '',
  '5.1 设计人员编制产品设计需求文件。',
  '',
  '5.2 项目负责人审核产品设计需求文件。',
  '',
  '5.3 部门负责人批准后，由设计人员将产品设计需求文件发放给项目管理部，项目管理部签收。',
  '',
  '## 6 记录',
  '',
  '产品设计需求文件由工程技术部归档保存。',
  '',
].join('\n'), 'utf8');
writeFileSync(mappingPath, '# 工程技术部流程映射测试占位\n', 'utf8');

execFileSync(process.execPath, [
  workflow,
  '--input', sourcePath,
  '--department', '工程技术部',
  '--mapping', mappingPath,
  '--out', runDir,
  '--no-embedding',
], {
  cwd: root,
  stdio: 'pipe',
  encoding: 'utf8',
});

for (const name of [
  'source_manifest.jsonl',
  'chunks.jsonl',
  'document_review_items.json',
  'role_review_items.json',
  'object_chains.json',
  'mapping_diff_items.json',
  'mapping_diff_report.md',
  'document-structured-output-v2.json',
  'pending-issues.md',
]) {
  assert.equal(existsSync(join(runDir, name)), true, `workflow should create ${name}`);
}

const outputPath = join(runDir, 'document-structured-output-v2.json');
const output = JSON.parse(readFileSync(outputPath, 'utf8'));
assert.equal(output.schema_version, 'document-structured-output-v2');
assert.equal(output.draft.department.department_name, '工程技术部');
assert.ok(output.processes.length >= 1, 'should compile at least one L3 candidate');
assert.ok(output.steps.length >= 1, 'should compile at least one A1 candidate');
assert.ok(output.behavior_details.length >= 1, 'should compile behavior details');
assert.ok(output.evidence_catalog.length >= 1, 'should compile traceable evidence');
assert.ok(output.evidence_catalog.every((item) => item.status === 'pending_review'), 'automatic evidence must stay pending_review');
assert.deepEqual(output.cross_dept_handoffs, [], 'handoff candidates must not become handoff records automatically');
assert.equal(Object.hasOwn(output, 'structure_block_projection'), false, 'review workflow must not emit a formal structure block projection');

for (const issue of output.pending_issues) {
  for (const field of [
    'stable_key',
    'structured_object_type',
    'structured_object_key',
    'target_block',
    'target_field',
    'evidence_status',
    'issue_type',
    'question_for_user',
  ]) {
    assert.ok(Object.hasOwn(issue, field), `pending issue should include ${field}`);
  }
}

for (const expectedType of [
  'L3 结构待确认',
  'A1 行为待确认',
  '角色责任待确认',
  '跨部门承接待确认',
]) {
  assert.ok(output.pending_issues.some((item) => item.issue_type === expectedType), `should create ${expectedType}`);
}

const pendingMarkdown = readFileSync(join(runDir, 'pending-issues.md'), 'utf8');
assert.ok(pendingMarkdown.includes('document-structured-output-v2'), 'human view should identify its v2 source');
assert.ok(pendingMarkdown.includes('跨部门承接待确认'), 'human view should include unresolved handoff facts');

execFileSync(process.execPath, [validator, '--input', outputPath], {
  cwd: root,
  stdio: 'pipe',
  encoding: 'utf8',
});

for (const [name, mutate] of [
  ['missing-process-evidence', data => { data.processes[0].evidence_refs = ['missing_evidence']; }],
  ['missing-evidence-object', data => { data.evidence_catalog[0].object_type = 'step'; data.evidence_catalog[0].object_ref = 'missing_step'; }],
  ['wrong-evidence-type', data => { data.evidence_catalog[0].object_type = 'form'; data.evidence_catalog[0].object_ref = data.steps[0].step_ref; }],
  ['missing-issue-object', data => { data.pending_issues[0].structured_object_type = 'step'; data.pending_issues[0].structured_object_key = 'missing_step'; }],
  ['missing-form-parent', data => { data.forms = [{ form_ref: 'test_form', form_name: '测试表单', form_code: 'TEST-01', main_table_name: 'test_form', step_ref: 'missing_step' }]; }],
  ['duplicate-issue-key', data => { data.pending_issues.push({ ...data.pending_issues[0] }); }],
  ['wrong-process-transition', data => {
    data.processes.push({ ...data.processes[0], process_ref: 'another_process' });
    data.step_transitions = [{ transition_ref: 'test_transition', process_ref: 'another_process', from_step_ref: data.steps[0].step_ref, to_step_ref: null, condition: '结束', evidence_refs: [] }];
  }],
]) {
  const invalid = structuredClone(output);
  mutate(invalid);
  const invalidPath = join(runDir, `${name}.json`);
  writeFileSync(invalidPath, JSON.stringify(invalid));
  const result = spawnSync(process.execPath, [validator, '--input', invalidPath], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${name} must fail validation`);
  assert.match(`${result.stdout}\n${result.stderr}`, /missing|duplicate|another process/, `${name} must fail the reference check`);
}

const todoGenerator = join(root, '.agents/skills/process-evidence-mapping/scripts/update-input-baseline-review-todo-md.mjs');
const issueInput = join(runDir, 'view-input.json');
const issueView = join(runDir, 'view-output.md');
const openIssue = output.pending_issues.find(item => item.issue_type === 'A1 行为待确认' && item.current_value);
writeFileSync(mappingPath, `# 已有名称\n\n${openIssue.current_value}\n`);
function renderIssue(issue) {
  writeFileSync(issueInput, JSON.stringify({ pending_issues: [issue] }));
  execFileSync(process.execPath, [todoGenerator, '--review-items', issueInput, '--mapping', mappingPath, '--todo', issueView], { cwd: root, stdio: 'pipe' });
  return readFileSync(issueView, 'utf8');
}
assert.equal((renderIssue(openIssue).match(/^\| DSO-/gm) || []).length, 1, 'same-name mappings cannot close an unresolved issue');
assert.equal((renderIssue({ ...openIssue, user_decision: '不是问题', user_reason: null }).match(/^\| DSO-/gm) || []).length, 1, 'a decision without its reason cannot close an issue');
assert.equal((renderIssue({ ...openIssue, user_decision: '修改源文件后重新导入', user_reason: '计划修改' }).match(/^\| DSO-/gm) || []).length, 1, 'a planned correction is not a resolved issue');
assert.equal((renderIssue({ ...openIssue, user_decision: '不是问题', user_reason: '经核对，该字段不适用于本行为。' }).match(/^\| DSO-/gm) || []).length, 0);
writeFileSync(issueView, renderIssue(openIssue).replace('| 待处理 |', '| 已处理 |'));
assert.match(renderIssue(openIssue), /\| 待处理 \|/, 'a derived markdown annotation cannot override v2 state');

const forbiddenOutputPath = join(runDir, 'forbidden-image-text-status.json');
const forbiddenOutput = structuredClone(output);
forbiddenOutput.evidence_catalog[0].status = `${['o', 'c', 'r'].join('')}_extracted_not_confirmed`;
writeFileSync(forbiddenOutputPath, JSON.stringify(forbiddenOutput, null, 2), 'utf8');
const forbiddenResult = spawnSync(process.execPath, [validator, '--input', forbiddenOutputPath], {
  cwd: root,
  stdio: 'pipe',
  encoding: 'utf8',
});
assert.notEqual(forbiddenResult.status, 0, 'validator must reject image-to-text evidence statuses');
assert.match(
  `${forbiddenResult.stdout}\n${forbiddenResult.stderr}`,
  /forbidden image-to-text status/,
);

const blockedSource = join(sourceDir, 'blocked-image.png');
writeFileSync(blockedSource, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const blockedResult = spawnSync(process.execPath, [
  workflow,
  '--input', blockedSource,
  '--department', '工程技术部',
  '--mapping', mappingPath,
  '--out', blockedRunDir,
  '--no-embedding',
], {
  cwd: root,
  stdio: 'pipe',
  encoding: 'utf8',
});
assert.notEqual(blockedResult.status, 0, 'image input must block the workflow');
assert.match(`${blockedResult.stdout}\n${blockedResult.stderr}`, /存在不可直接读取的来源/);
const blockedSources = readFileSync(join(blockedRunDir, 'source_manifest.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
assert.equal(blockedSources.length, 1);
assert.equal(blockedSources[0].extraction_status, 'blocked_unreadable');
assert.ok(blockedSources[0].source_file.endsWith('blocked-image.png'));
assert.equal(existsSync(join(blockedRunDir, 'document-structured-output-v2.json')), false, 'blocked source must not produce v2 output');

const mixedBlockedResult = spawnSync(process.execPath, [
  workflow,
  '--input', sourceDir,
  '--department', '工程技术部',
  '--mapping', mappingPath,
  '--out', mixedBlockedRunDir,
  '--no-embedding',
], {
  cwd: root,
  stdio: 'pipe',
  encoding: 'utf8',
});
assert.notEqual(mixedBlockedResult.status, 0, 'a directory containing an image must block the workflow');
assert.match(
  `${mixedBlockedResult.stdout}\n${mixedBlockedResult.stderr}`,
  /存在不可直接读取的来源，工作流已阻断/,
);
assert.equal(
  existsSync(join(mixedBlockedRunDir, 'document-structured-output-v2.json')),
  false,
  'a mixed readable and image source batch must not produce v2 output',
);

console.log('Process input baseline review workflow checks passed');
