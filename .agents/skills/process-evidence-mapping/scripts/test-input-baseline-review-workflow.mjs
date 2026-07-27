#!/usr/bin/env node
/**
 * End-to-end checks for the generic process evidence workflow.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');
const workflow = join(root, '.agents', 'skills', 'process-evidence-mapping', 'scripts', 'run-process-input-baseline-review-workflow.mjs');
const validator = join(root, '.agents', 'skills', 'process-evidence-mapping', 'scripts', 'validate-document-structured-output-v2.mjs');
const sourceDir = join(root, 'artifacts', 'process-input-baseline-review', 'test-v2-source');
const runDir = join(root, 'artifacts', 'process-input-baseline-review', 'test-v2-basic');
const blockedRunDir = join(root, 'artifacts', 'process-input-baseline-review', 'test-v2-blocked');
const mixedBlockedRunDir = join(root, 'artifacts', 'process-input-baseline-review', 'test-v2-mixed-blocked');
const sourcePath = join(sourceDir, 'GLTX-GC-01-A产品设计需求管理程序.md');
const mappingPath = join(sourceDir, '工程技术部流程映射.md');

for (const target of [sourceDir, runDir, blockedRunDir, mixedBlockedRunDir]) {
  rmSync(target, { recursive: true, force: true });
}
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
assert.match(`${blockedResult.stdout}\n${blockedResult.stderr}`, /图片来源不进入本技能/);
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
