#!/usr/bin/env node
/**
 * Regression checks for process candidate extraction and todo markdown.
 *
 * Usage: node .agents/skills/process-evidence-mapping/scripts/test-candidate-workflow.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');
const runDir = join(root, 'artifacts', 'process-candidates', 'test-gltx-cw-01');
const todoPath = join(runDir, '候选映射待办.md');
const sourceDoc = join(root, 'docs', 'norms', '财务部业务资料', 'GLTX-CW-01-A财务成本核算管理程序.docx');
const mappingPath = join(runDir, 'fixture-财务部映射-未覆盖.md');
const coveredMappingPath = join(runDir, 'fixture-财务部映射-已覆盖.md');
const genericRunDir = join(root, 'artifacts', 'process-candidates', 'test-engineering-generic');

function runNode(args) {
  execFileSync(process.execPath, args, {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJsonl(path, records) {
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

function countTodoRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| CAND-')).length;
}

rmSync(runDir, { recursive: true, force: true });
rmSync(genericRunDir, { recursive: true, force: true });
mkdirSync(runDir, { recursive: true });
mkdirSync(genericRunDir, { recursive: true });
const staleMappingFixture = [
  '# 财务部部门-能力-流程-系统映射关系（候选测试夹具）',
  '',
  '## 业务能力—流程—系统映射表',
  '',
  '| 序号 | 部门（D1） | 能力域（L1） | 业务能力（L2） | 业务流程（L3） | 制度依据（文件号/条款） | 应用系统（S1） | 系统设计依据 |',
  '|---|---|---|---|---|---|---|---|',
  '| 4 | 财务部 | 成本管理 | 成本核算管理 | 月度产品成本核算与成本结转 | GLTX-CW-01-A《财务成本核算管理程序》§5.3-§5.4 | ERP | 测试夹具仅保留L3，不覆盖候选A1 |',
  '',
  '## 业务行为（A1）映射（BBM增补）',
  '',
  '本夹具故意不包含 GLTX-CW-01 候选 A1、归档和审批链内容，用于证明候选待办会生成。',
  '',
].join('\n');
writeFileSync(mappingPath, staleMappingFixture, 'utf8');

runNode([
  '.agents/skills/process-evidence-mapping/scripts/run-process-candidate-workflow.mjs',
  '--input', sourceDoc,
  '--department', '财务部',
  '--mapping', mappingPath,
  '--out', runDir,
  '--todo', todoPath,
  '--no-embedding',
]);

for (const file of [
  'source_manifest.jsonl',
  'chunks.jsonl',
  'embedding_manifest.json',
  'candidate_evidence.jsonl',
  'document_candidate.json',
  'role_candidates.json',
  'object_chains.json',
  'mapping_diff_report.md',
]) {
  assert.equal(existsSync(join(runDir, file)), true, `${file} should be written`);
}
assert.equal(existsSync(todoPath), true, 'candidate todo markdown should be written');

const documentCandidate = readJson(join(runDir, 'document_candidate.json'));
const roleCandidates = readJson(join(runDir, 'role_candidates.json'));
const objectChains = readJson(join(runDir, 'object_chains.json'));
const embeddingManifest = readJson(join(runDir, 'embedding_manifest.json'));
const sourceManifest = readJsonl(join(runDir, 'source_manifest.jsonl'));
const chunks = readJsonl(join(runDir, 'chunks.jsonl'));
const mappingItems = readJson(join(runDir, 'mapping_diff_items.json'));
const diffReport = readFileSync(join(runDir, 'mapping_diff_report.md'), 'utf8');
const todoMarkdown = readFileSync(todoPath, 'utf8');

assert.equal(documentCandidate.department, '财务部');
assert.equal(documentCandidate.source_file.endsWith('GLTX-CW-01-A财务成本核算管理程序.docx'), true);
assert.equal(sourceManifest[0]?.source_boundary_flag, 'changxing_owned', 'source manifest should keep GLTX boundary');
assert.equal(chunks[0]?.source_boundary_flag, 'changxing_owned', 'chunks should inherit source boundary');
assert.equal(chunks[0]?.allowed_downstream_use, 'review_only', 'candidate chunks must remain review-only even for GLTX files');
assert.equal(
  mappingItems.every((item) => item.source_boundary_flag === 'changxing_owned'),
  true,
  'candidate todo items should inherit source boundary from their evidence',
);
assert.ok(documentCandidate.capability_candidates.some((item) => item.name.includes('成本核算')), 'should identify cost accounting candidate capability');
assert.ok(documentCandidate.process_candidates.some((item) => item.name.includes('月度产品成本核算')), 'should identify monthly product cost process candidate');
assert.ok(documentCandidate.behavior_candidates.some((item) => item.name.includes('处理盘盈盘亏')), 'should identify inventory gain/loss behavior candidate');
assert.ok(documentCandidate.behavior_candidates.some((item) => item.name.includes('处理废品损失')), 'should identify scrap loss behavior candidate');
assert.ok(documentCandidate.archive_candidates.some((item) => item.content.includes('保存年限30年')), 'should identify 30-year archive candidate');

const roleNames = roleCandidates.roles.map((role) => role.name);
for (const expected of ['财务部', '财务部成本会计', '车间工人', '车间主任', '定额员', '经营发展部长', '行政人事部']) {
  assert.ok(roleNames.includes(expected), `role candidate should include ${expected}`);
}
assert.ok(roleCandidates.roles.some((role) => role.name === '经营发展部长' && role.role_types.includes('批准角色')), 'should classify operation manager as approval role');
assert.ok(roleCandidates.roles.some((role) => role.name === '行政人事部' && role.role_types.includes('数据提供角色')), 'should classify HR as data provider');

assert.ok(objectChains.chains.some((chain) => chain.object_name === '工时调整申请/情况说明' && chain.actions.some((action) => action.includes('审核'))), 'should build work-hour adjustment approval object chain');
assert.ok(objectChains.chains.some((chain) => chain.object_name === '成本核算报表' && chain.actions.some((action) => action.includes('归档'))), 'should build archive object chain');

assert.equal(embeddingManifest.status, 'skipped');
assert.equal(embeddingManifest.model, 'qwen3-embedding:latest');
assert.equal(embeddingManifest.dimensions, 1024);
assert.match(diffReport, /本轮未使用向量检索/);
assert.match(diffReport, /相似度仅用于候选排序，不是证据强度/);

for (const forbidden of ['"审批类型"', '"输入来源部门"', '"输出目标部门"']) {
  assert.equal(JSON.stringify(documentCandidate).includes(forbidden), false, `candidate JSON must not emit formal field ${forbidden}`);
}

for (const requiredHeader of ['编号', '部门', '来源文件/条款', '候选类型', '候选内容', '当前映射位置', '建议动作', '处理状态', '负责人/确认对象']) {
  assert.ok(todoMarkdown.includes(requiredHeader), `todo markdown should include ${requiredHeader}`);
}
for (const type of ['候选A1', '审批链待确认', '受控传递待确认', '归档要求待补']) {
  assert.ok(todoMarkdown.includes(type), `todo markdown should include candidate type ${type}`);
}
assert.ok(todoMarkdown.includes('该文件只保留未解决候选项'), 'todo markdown should state unresolved-only policy');

const firstRowCount = countTodoRows(todoMarkdown);
assert.ok(firstRowCount > 0, 'todo markdown should contain candidate rows');
runNode([
  '.agents/skills/process-evidence-mapping/scripts/update-candidate-todo-md.mjs',
  '--candidates', join(runDir, 'mapping_diff_items.json'),
  '--mapping', mappingPath,
  '--todo', todoPath,
]);
const dedupedTodo = readFileSync(todoPath, 'utf8');
assert.equal(countTodoRows(dedupedTodo), firstRowCount, 'rerunning todo update should not duplicate rows');

const removedTodo = dedupedTodo
  .split(/\r?\n/)
  .filter((line) => !line.includes('处理盘盈盘亏'))
  .join('\n');
writeFileSync(todoPath, `${removedTodo}\n`, 'utf8');
runNode([
  '.agents/skills/process-evidence-mapping/scripts/update-candidate-todo-md.mjs',
  '--candidates', join(runDir, 'mapping_diff_items.json'),
  '--mapping', mappingPath,
  '--todo', todoPath,
]);
const restoredTodo = readFileSync(todoPath, 'utf8');
assert.ok(restoredTodo.includes('处理盘盈盘亏'), 'deleted unresolved item should reappear if mapping still does not cover it');

writeFileSync(coveredMappingPath, [
  staleMappingFixture,
  '处理盘盈盘亏',
  '处理废品损失',
  '归档成本核算报表',
  '相关报表由财务部负责存档，保存年限30年。',
  '接收行政人事部工资总额及明细费用',
].join('\n'), 'utf8');
runNode([
  '.agents/skills/process-evidence-mapping/scripts/update-candidate-todo-md.mjs',
  '--candidates', join(runDir, 'mapping_diff_items.json'),
  '--mapping', coveredMappingPath,
  '--todo', todoPath,
]);
const coveredTodo = readFileSync(todoPath, 'utf8');
assert.equal(coveredTodo.includes('处理盘盈盘亏'), false, 'formally covered candidate should not reappear in todo');
assert.equal(coveredTodo.includes('相关报表由财务部负责存档，保存年限30年'), false, 'covered archive candidate should not reappear in todo');

const engineeringSource = 'docs/norms/工程技术部业务资料/12.0-集成研发/GLC120102产品设计需求定义管理程序/产品设计需求定义管理程序.docx';
const engineeringChunksPath = join(genericRunDir, 'chunks.jsonl');
const engineeringDocumentPath = join(genericRunDir, 'document_candidate.json');
const engineeringRolesPath = join(genericRunDir, 'role_candidates.json');
const engineeringObjectsPath = join(genericRunDir, 'object_chains.json');
const pipeCandidatesPath = join(genericRunDir, 'pipe-candidates.json');
const pipeTodoPath = join(genericRunDir, 'pipe-todo.md');
writeJsonl(engineeringChunksPath, [
  {
    chunk_id: 'eng-001',
    source_file: engineeringSource,
    source_file_name: '产品设计需求定义管理程序.docx',
    leaf_dir: 'docs/norms/工程技术部业务资料/12.0-集成研发/GLC120102产品设计需求定义管理程序',
    doc_no: 'GLC120102',
    version: '',
    clause: '5.1',
    paragraph_id: 'P1',
    raw_text: '工程技术部负责产品设计需求定义的编制、审核、批准和发放。',
    extraction_quality: 'clean',
    evidence_status: 'candidate',
    verification_status: 'unverified',
    allowed_downstream_use: 'review_only',
    chunk_hash: 'eng-001',
  },
  {
    chunk_id: 'eng-002',
    source_file: engineeringSource,
    source_file_name: '产品设计需求定义管理程序.docx',
    leaf_dir: 'docs/norms/工程技术部业务资料/12.0-集成研发/GLC120102产品设计需求定义管理程序',
    doc_no: 'GLC120102',
    version: '',
    clause: '5.2',
    paragraph_id: 'P2',
    raw_text: '设计人员编制产品设计需求文件，项目负责人审核，部门负责人批准后发放。',
    extraction_quality: 'clean',
    evidence_status: 'candidate',
    verification_status: 'unverified',
    allowed_downstream_use: 'review_only',
    chunk_hash: 'eng-002',
  },
  {
    chunk_id: 'eng-003',
    source_file: engineeringSource,
    source_file_name: '产品设计需求定义管理程序.docx',
    leaf_dir: 'docs/norms/工程技术部业务资料/12.0-集成研发/GLC120102产品设计需求定义管理程序',
    doc_no: 'GLC120102',
    version: '',
    clause: '6',
    paragraph_id: 'P3',
    raw_text: '产品设计需求文件由工程技术部归档保存。',
    extraction_quality: 'clean',
    evidence_status: 'candidate',
    verification_status: 'unverified',
    allowed_downstream_use: 'review_only',
    chunk_hash: 'eng-003',
  },
  {
    chunk_id: 'eng-004',
    source_file: engineeringSource,
    source_file_name: '产品设计需求定义管理程序.docx',
    leaf_dir: 'docs/norms/工程技术部业务资料/12.0-集成研发/GLC120102产品设计需求定义管理程序',
    doc_no: 'GLC120102',
    version: '',
    clause: '7',
    paragraph_id: 'P4',
    raw_text: '研发项目成本核算数据仅用于项目成本控制，不改变本资料的工程技术部归属。',
    extraction_quality: 'clean',
    evidence_status: 'candidate',
    verification_status: 'unverified',
    allowed_downstream_use: 'review_only',
    chunk_hash: 'eng-004',
  },
  {
    chunk_id: 'eng-005',
    source_file: engineeringSource,
    source_file_name: '产品设计需求定义管理程序.docx',
    leaf_dir: 'docs/norms/工程技术部业务资料/12.0-集成研发/GLC120102产品设计需求定义管理程序',
    doc_no: 'GLC120102',
    version: '',
    clause: '8',
    paragraph_id: 'P5',
    raw_text: '生产副总审批重大产品设计需求变更。工程技术部审核人复核设计更改记录。',
    extraction_quality: 'clean',
    evidence_status: 'candidate',
    verification_status: 'unverified',
    allowed_downstream_use: 'review_only',
    chunk_hash: 'eng-005',
  },
]);
runNode([
  '.agents/skills/process-evidence-mapping/scripts/extract-process-candidates.mjs',
  '--chunks', engineeringChunksPath,
  '--department', '工程技术部',
  '--out', engineeringDocumentPath,
]);
runNode([
  '.agents/skills/process-evidence-mapping/scripts/extract-role-candidates.mjs',
  '--chunks', engineeringChunksPath,
  '--department', '工程技术部',
  '--out', engineeringRolesPath,
]);
runNode([
  '.agents/skills/process-evidence-mapping/scripts/build-object-chains.mjs',
  '--chunks', engineeringChunksPath,
  '--roles', engineeringRolesPath,
  '--out', engineeringObjectsPath,
]);
const engineeringDocument = readJson(engineeringDocumentPath);
const engineeringRoles = readJson(engineeringRolesPath);
const engineeringObjects = readJson(engineeringObjectsPath);
assert.ok(engineeringDocument.process_candidates.some((item) => item.name.includes('产品设计需求定义管理')), 'generic process extraction should use engineering document title');
assert.equal(JSON.stringify(engineeringDocument).includes('处理盘盈盘亏'), false, 'generic process extraction must not emit finance-only candidates');
assert.equal(JSON.stringify(engineeringDocument).includes('成本核算'), false, 'generic process extraction must not emit finance-only capabilities');
for (const expected of ['工程技术部', '设计人员', '项目负责人', '部门负责人']) {
  assert.ok(engineeringRoles.roles.some((role) => role.name === expected), `generic role extraction should include ${expected}`);
}
function engineeringRole(name) {
  return engineeringRoles.roles.find((role) => role.name === name);
}
assert.equal(engineeringRole('设计人员')?.definition_status, '原文定义不足', 'bare ordinary roles should be marked as insufficient source definition');
assert.equal(engineeringRole('项目负责人')?.definition_status, '原文定义不足', 'bare project roles should be marked as insufficient source definition');
assert.equal(engineeringRole('部门负责人')?.definition_status, '原文定义不足', 'generic department roles without a named department should be insufficient');
assert.equal(engineeringRole('工程技术部审核人')?.definition_status, '原文明确', 'department-prefixed roles should be source-defined');
assert.equal(engineeringRole('生产副总')?.definition_status, '原文明确', 'three leader roles should be source-defined without department prefix');
assert.ok(engineeringObjects.chains.some((chain) => chain.object_name === '产品设计需求文件' && chain.actions.some((action) => action.includes('批准'))), 'generic object chain should preserve approval action on product design requirement file');

writeFileSync(pipeCandidatesPath, JSON.stringify([{
  id: 'CAND-PIPEESCAPE',
  stable_key: 'pipeescape',
  department: '工程技术部',
  source_file: engineeringSource,
  source_anchor: 'T01R1',
  candidate_type: '候选A1',
  content: '表格内容 A | 表格内容 B',
  mapping_location: '当前正式映射未见同名受控覆盖',
  suggested_action: '确认是否需要补入。',
  status: '待处理',
  owner: '部门确认人',
}], null, 2), 'utf8');
for (let index = 0; index < 2; index += 1) {
  runNode([
    '.agents/skills/process-evidence-mapping/scripts/update-candidate-todo-md.mjs',
    '--candidates', pipeCandidatesPath,
    '--mapping', mappingPath,
    '--todo', pipeTodoPath,
  ]);
}
const pipeTodo = readFileSync(pipeTodoPath, 'utf8');
const pipeLine = pipeTodo.split(/\r?\n/).find((line) => line.startsWith('| CAND-PIPEESCAPE'));
assert.ok(pipeLine.includes('表格内容 A \\| 表格内容 B'), 'todo markdown should escape pipe characters in candidate content');
assert.ok(pipeLine.endsWith('| 待处理 | 部门确认人 |'), 'rerunning todo update should preserve status and owner when content contains escaped pipes');
assert.ok(pipeLine.includes('产品设计需求定义管理程序.docx 表01第1行'), 'todo source label should omit parent directories and humanize anchors');

console.log('Process candidate workflow checks passed');
