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

function countTodoRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| CAND-')).length;
}

rmSync(runDir, { recursive: true, force: true });
mkdirSync(runDir, { recursive: true });
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
const diffReport = readFileSync(join(runDir, 'mapping_diff_report.md'), 'utf8');
const todoMarkdown = readFileSync(todoPath, 'utf8');

assert.equal(documentCandidate.department, '财务部');
assert.equal(documentCandidate.source_file.endsWith('GLTX-CW-01-A财务成本核算管理程序.docx'), true);
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

console.log('Process candidate workflow checks passed');
