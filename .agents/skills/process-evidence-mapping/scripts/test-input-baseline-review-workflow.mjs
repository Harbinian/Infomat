#!/usr/bin/env node
/**
 * End-to-end checks for the generic process evidence workflow.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  'source_coverage.json',
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
assert.equal(JSON.parse(readFileSync(join(runDir, 'source_coverage.json'), 'utf8')).status, 'readable');
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

const legacyVisualPath = join(runDir, 'legacy-image-text-status.json');
const legacyVisual = structuredClone(output);
legacyVisual.evidence_catalog[0].status = 'ocr_extracted_not_confirmed';
legacyVisual.pending_issues[0].issue_type = 'OCR/抽取待复核';
writeFileSync(legacyVisualPath, JSON.stringify(legacyVisual), 'utf8');
execFileSync(process.execPath, [validator, '--input', legacyVisualPath], { cwd: root, stdio: 'pipe' });
const unconfirmedPath = join(runDir, 'unconfirmed-verified.json');
const unconfirmed = structuredClone(output);
unconfirmed.evidence_catalog[0].status = 'verified';
writeFileSync(unconfirmedPath, JSON.stringify(unconfirmed), 'utf8');
const unconfirmedResult = spawnSync(process.execPath, [validator, '--input', unconfirmedPath], { cwd: root, encoding: 'utf8' });
assert.notEqual(unconfirmedResult.status, 0, 'verified evidence still needs real confirmation fields');
assert.match(`${unconfirmedResult.stdout}\n${unconfirmedResult.stderr}`, /verified evidence.*missing/);
assert.equal((renderIssue(legacyVisual.pending_issues[0]).match(/^\| DSO-/gm) || []).length, 1, 'legacy OCR review issues remain visible');

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
assert.match(`${blockedResult.stdout}\n${blockedResult.stderr}`, /没有可用的来源内容/);
const blockedSources = readFileSync(join(blockedRunDir, 'source_manifest.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
assert.equal(blockedSources.length, 1);
assert.equal(blockedSources[0].extraction_status, 'blocked_unreadable');
assert.ok(blockedSources[0].source_file.endsWith('blocked-image.png'));
assert.equal(existsSync(join(blockedRunDir, 'document-structured-output-v2.json')), false, 'blocked source must not produce v2 output');
assert.equal(JSON.parse(readFileSync(join(blockedRunDir, 'source_coverage.json'), 'utf8')).status, 'unavailable');

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
assert.equal(mixedBlockedResult.status, 0, 'readable parts of a mixed source batch should continue');
assert.match(
  `${mixedBlockedResult.stdout}\n${mixedBlockedResult.stderr}`,
  /来源覆盖不完整.*不表示完整通过/,
);
assert.equal(
  existsSync(join(mixedBlockedRunDir, 'document-structured-output-v2.json')),
  true,
  'a mixed source batch should produce a clearly incomplete review draft',
);
const mixedOutput = JSON.parse(readFileSync(join(mixedBlockedRunDir, 'document-structured-output-v2.json'), 'utf8'));
const mixedCoverage = JSON.parse(readFileSync(join(mixedBlockedRunDir, 'source_coverage.json'), 'utf8'));
assert.equal(mixedCoverage.status, 'partial');
assert.equal(mixedCoverage.can_claim_complete, false);
assert.ok(mixedCoverage.gaps.some(gap => gap.source_file.endsWith('blocked-image.png')));
assert.match(mixedOutput.draft.basis_description, /成果不完整/);
assert.ok(mixedOutput.pending_issues.some(issue => issue.issue_type === '来源证据不足' && issue.source_file.endsWith('blocked-image.png')));
assert.ok(mixedOutput.evidence_catalog.every(item => !item.source_file.endsWith('blocked-image.png')), 'unreadable image cannot become evidence');
assert.match(readFileSync(join(mixedBlockedRunDir, 'pending-issues.md'), 'utf8'), /blocked-image\.png/);

const visualSource = join(sourceDir, 'visual-source.png');
writeFileSync(visualSource, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lHAAAAAASUVORK5CYII=', 'base64'));
const sourceHash = createHash('sha256').update(readFileSync(visualSource)).digest('hex');
const transcriptPath = join(fixtureRoot, 'visual-transcript.json');
const visualEnvelope = {
  source: { source_file: visualSource, source_hash: sourceHash, ocr_tool: 'fixture-visual', evidence_status: 'ocr_extracted_not_confirmed' },
  blocks: [{ source_file: visualSource, source_hash: sourceHash, page_no: 1, block_id: 'p001-b0001', text: '设计人员编制产品设计需求文件。', bbox: [0, 0, 1, 1], review_required: false, confidence: 1, evidence_status: 'ocr_extracted_not_confirmed' }],
};
function runVisual(envelope, name) {
  writeFileSync(transcriptPath, JSON.stringify(envelope), 'utf8');
  const out = join(fixtureRoot, name);
  const result = spawnSync(process.execPath, [workflow, '--input', visualSource, '--department', '工程技术部', '--mapping', mappingPath, '--out', out, '--visual-transcripts', transcriptPath, '--no-embedding'], { cwd: root, encoding: 'utf8' });
  return { result, out };
}
for (const [name, mutate, message] of [
  ['hash-mismatch', data => { data.source.source_hash = '0'.repeat(64); }, /source_hash does not match/],
  ['source-outside', data => { data.source.source_file = sourcePath; }, /outside the selected source/],
  ['block-source-mismatch', data => { data.blocks[0].source_file = sourcePath; }, /block source_file does not match/],
  ['page-mismatch', data => { data.blocks[0].page_no = 2; }, /block_id and page_no location do not match/],
  ['page-outside', data => { data.blocks[0].page_no = 2; data.blocks[0].block_id = 'p002-b0001'; }, /page_no is outside/],
  ['bbox-outside', data => { data.blocks[0].bbox = [0, 0, 5, 5]; }, /bbox is outside/],
  ['bbox-invalid', data => { data.blocks[0].bbox = [1, 0, 0, 1]; }, /bbox is not a valid/],
  ['verified-input', data => { data.blocks[0].evidence_status = 'verified'; }, /cannot import a confirmed or verified/],
  ['duplicate-location', data => { data.blocks.push({ ...data.blocks[0] }); }, /duplicate visual transcript block/],
  ['unknown-version', data => { data.schema_version = 'visual-v99'; }, /unsupported visual transcript schema_version/],
]) {
  const invalid = structuredClone(visualEnvelope);
  mutate(invalid);
  const { result, out } = runVisual(invalid, name);
  assert.notEqual(result.status, 0, `${name} must reject the transcript`);
  assert.match(`${result.stdout}\n${result.stderr}`, message);
  assert.equal(existsSync(join(out, 'document-structured-output-v2.json')), false);
}
for (const [name, envelope] of [
  ['visual-legacy', visualEnvelope],
  ['visual-v1', { schema_version: 'process-visual-transcripts-v1', sources: [visualEnvelope] }],
]) {
  const { result, out } = runVisual(envelope, name);
  assert.equal(result.status, 0, result.stderr);
  const visualOutput = JSON.parse(readFileSync(join(out, 'document-structured-output-v2.json'), 'utf8'));
  const visualChunks = readFileSync(join(out, 'chunks.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.ok(visualChunks.every(item => item.evidence_status === 'pending_review' && item.verification_status === 'unverified' && item.allowed_downstream_use === 'review_only' && item.review_required), 'confidence and legacy flags cannot confirm visual evidence');
  assert.equal(visualChunks[0].raw_text, visualEnvelope.blocks[0].text);
  assert.match(visualChunks[0].paragraph_id, /page-1\/block-p001-b0001\/bbox-/);
  assert.ok(visualChunks[0].visual_transcript_hash);
  assert.ok(visualOutput.evidence_catalog.length > 0);
  assert.ok(visualOutput.evidence_catalog.every(item => item.status === 'pending_review'));
  assert.ok(visualOutput.evidence_catalog.some(item => item.locate_method.includes('视觉转录')));
  assert.ok(visualOutput.pending_issues.some(item => item.issue_type === 'OCR/抽取待复核'));
  assert.match(readFileSync(join(out, 'pending-issues.md'), 'utf8'), /OCR\/抽取待复核/);
  const visualSources = readFileSync(join(out, 'source_manifest.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(visualSources[0].extraction_status, 'blocked_unreadable', 'original extractor limitation stays visible');
  assert.equal(visualSources[0].visual_transcript_blocks, 1);
  assert.equal(JSON.parse(readFileSync(join(out, 'source_coverage.json'), 'utf8')).status, 'partial');
  const compileResult = spawnSync(process.execPath, [
    join(root, '.agents/skills/process-evidence-mapping/scripts/compile-document-structured-output-v2.mjs'),
    '--document', join(out, 'document_review_items.json'), '--roles', join(out, 'role_review_items.json'),
    '--objects', join(out, 'object_chains.json'), '--issues', join(out, 'mapping_diff_items.json'),
    '--chunks', join(out, 'chunks.jsonl'), '--out', join(out, 'no-manifest.json'),
  ], { cwd: root, encoding: 'utf8' });
  assert.notEqual(compileResult.status, 0, 'direct visual compilation cannot omit its source manifest');
  assert.match(`${compileResult.stdout}\n${compileResult.stderr}`, /requires --source-manifest/);
}

console.log('Process input baseline review workflow checks passed');
