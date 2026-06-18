#!/usr/bin/env node
/**
 * Contract checks for the MySQL-backed candidate review service.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildReviewAppHtml,
  candidateReviewSchemaSql,
  describeMappingForBusiness,
  documentNameFromSource,
  formatSourceForBusiness,
  groupCandidatesForReview,
  highlightEvidenceHtml,
  highlightTermsForCandidate,
  loadCandidateRunBundle,
  makeCandidateReviewRepository,
  reviewButtonPalette,
  roleDefinitionStatus,
} from './candidate-review-core.mjs';

const root = resolve(import.meta.dirname, '..');
const runDir = join(root, 'artifacts', 'process-candidates', 'test-candidate-review-mysql');

rmSync(runDir, { recursive: true, force: true });
mkdirSync(runDir, { recursive: true });

writeFileSync(
  join(runDir, 'mapping_diff_items.json'),
  JSON.stringify(
    [
      {
        id: 'CAND-APPROVAL',
        stable_key: 'approval-chain-001',
        department: '财务部',
        source_file: 'docs/norms/财务部业务资料/GLTX-CW-01-A财务成本核算管理程序.docx',
        source_anchor: 'GLTX-CW-01-A §5.4 P71',
        candidate_type: '审批链待确认',
        content: '盈亏处理需查明原因，按照规定审批权限报有关部门审核批准',
        mapping_location: 'CW-L3-04',
        suggested_action: '回到原文条款/签批栏确认审批链；不得直接写入正式审批结论。',
        owner: '资料责任人/流程治理负责人',
      },
    ],
    null,
    2,
  ),
  'utf8',
);

writeFileSync(
  join(runDir, 'chunks.jsonl'),
  JSON.stringify({
    chunk_id: 'test-P0071',
    source_file: 'docs/norms/财务部业务资料/GLTX-CW-01-A财务成本核算管理程序.docx',
    doc_no: 'GLTX-CW-01-A',
    clause: '5.4',
    paragraph_id: 'P71',
    raw_text: '盈亏处理需查明原因，按照规定审批权限报有关部门审核批准。',
    extraction_quality: 'clean',
    evidence_status: 'candidate',
    verification_status: 'unverified',
    allowed_downstream_use: 'review_only',
  }) + '\n',
  'utf8',
);

writeFileSync(
  join(runDir, 'embedding_manifest.json'),
  JSON.stringify({ status: 'embedded', model: 'qwen3-embedding:latest', dimensions: 1024 }, null, 2),
  'utf8',
);

writeFileSync(join(runDir, 'mapping_diff_report.md'), '# 候选映射差异审计报告\n', 'utf8');

const schema = candidateReviewSchemaSql();
for (const required of [
  'CREATE TABLE IF NOT EXISTS candidate_review_runs',
  'CREATE TABLE IF NOT EXISTS candidate_review_items',
  'CREATE TABLE IF NOT EXISTS candidate_review_excerpts',
  'CREATE TABLE IF NOT EXISTS candidate_review_decisions',
  'document_name VARCHAR(255)',
  'issue_type VARCHAR(64)',
  'definition_status VARCHAR(64)',
  'normalized_note TEXT',
  'ENGINE=InnoDB',
  'utf8mb4',
]) {
assert.ok(schema.includes(required), `schema should include ${required}`);
}
assert.equal(schema.includes('sqlite_master'), false, 'schema must not use SQLite');
assert.equal(schema.includes('correction_note'), false, 'candidate review schema must not keep concatenated correction note fields');

const bundle = loadCandidateRunBundle(runDir);
assert.equal(bundle.run.run_id, 'test-candidate-review-mysql');
assert.equal(bundle.items.length, 1);
assert.equal(bundle.items[0].document_name, 'GLTX-CW-01-A财务成本核算管理程序.docx');
assert.equal(bundle.items[0].source_excerpts.length, 1);
assert.equal(bundle.items[0].source_excerpts[0].raw_text.includes('盈亏处理需查明原因'), true);

const terms = highlightTermsForCandidate({
  content: '经营发展部长审核批准成本核算报表',
  source_excerpts: [{ raw_text: '经营发展部长审核批准成本核算报表后，财务部成本会计归档。' }],
});
for (const term of ['经营发展部长', '审核', '批准', '成本核算报表', '归档']) {
  assert.ok(terms.includes(term), `highlight terms should include ${term}`);
}
const highlighted = highlightEvidenceHtml(
  bundle.items[0].source_excerpts[0].raw_text,
  bundle.items[0].content,
);
assert.ok(highlighted.includes('<mark>盈亏处理需查明原因</mark>'), 'evidence text should highlight candidate phrase');

const businessSource = formatSourceForBusiness(
  'docs/norms/财务部业务资料/GLTX-CW-01-A财务成本核算管理程序.docx',
  'GLTX-CW-01-A §5.4 P71',
);
assert.equal(
  businessSource,
  'GLTX-CW-01-A财务成本核算管理程序.docx · 第5.4条',
  'business source should hide parent directories and hide Pxx extraction anchors from business users',
);
assert.equal(businessSource.includes('docs/norms'), false, 'business source should not expose parent directories');
assert.equal(businessSource.includes('内部锚点P71'), false, 'internal extraction anchors must not be displayed to business users');
assert.equal(businessSource.includes('第71页'), false, 'paragraph ids must not be displayed as pages');
assert.equal(businessSource.includes('段落P71'), false, 'internal extraction anchors must not be displayed as original paragraphs');
assert.equal(businessSource.includes('块号P71'), false, 'internal extraction anchors must not be displayed as original block ids');
assert.equal(
  formatSourceForBusiness('制度.docx', 'P71'),
  '制度.docx · 原文位置待核对',
  'Pxx without real page, clause, or table location should be shown as a plain location warning',
);
assert.equal(formatSourceForBusiness('制度.docx', 'page=71 §5.4'), '制度.docx · 第5.4条 · 第71页');
assert.equal(documentNameFromSource('docs/norms/财务部业务资料/制度.docx'), '制度.docx');

const mappingDescription = describeMappingForBusiness('CW-L3-04');
assert.ok(mappingDescription.includes('CW-L3-04'), 'mapping description can keep the relation id');
assert.notEqual(mappingDescription, 'CW-L3-04', 'mapping description must not be only a relation id');
assert.ok(mappingDescription.includes('现有映射编号'), 'mapping description should explain what the relation id means');

const grouped = groupCandidatesForReview([
  bundle.items[0],
  { ...bundle.items[0], stable_key: 'other', department: '财务部', document_name: '制度B.docx', candidate_type: '角色待确认' },
]);
assert.equal(grouped[0].department, '财务部');
const financeDocGroup = grouped[0].documents.find((doc) => doc.document_name === 'GLTX-CW-01-A财务成本核算管理程序.docx');
const otherDocGroup = grouped[0].documents.find((doc) => doc.document_name === '制度B.docx');
assert.ok(financeDocGroup, 'grouping should include the source document name');
assert.ok(otherDocGroup, 'grouping should separate another document');
assert.equal(financeDocGroup.types[0].candidate_type, '审批链待确认');

assert.equal(roleDefinitionStatus('总经理', '总经理批准后执行。'), '原文明确');
assert.equal(roleDefinitionStatus('经营副总', '经营副总审批。'), '原文明确');
assert.equal(roleDefinitionStatus('生产副总', '生产副总审批。'), '原文明确');
assert.equal(roleDefinitionStatus('审核人', '审核人审核后提交。'), '原文定义不足');
assert.equal(roleDefinitionStatus('审核人', '工程技术部审核人审核后提交。'), '原文明确');

const palette = reviewButtonPalette();
for (const [key, config] of Object.entries(palette)) {
  assert.ok(config.background && config.color, `${key} should define contrasting button colors`);
  assert.notEqual(config.background.toLowerCase(), config.color.toLowerCase(), `${key} background and text color should differ`);
}

const html = buildReviewAppHtml();
for (const required of [
  '<title>候选映射复核工作台</title>',
  '/api/runs',
  '/api/runs/',
  'fetch(',
  '原文摘录',
  'mark',
  '现有映射说明',
  '这条候选说法是否成立',
  '原文能不能支撑这条说法',
  '问题类型',
  '定义充分性',
  '规范化说明',
  'id="issueType"',
  'id="definitionStatus"',
  'id="normalizedNote"',
  '原文定义不足',
  'data-action="confirm_candidate"',
  'data-action="needs_correction"',
  'data-action="reject_candidate"',
  'data-action="insufficient_evidence"',
  '正式映射仍需逐条回源核验',
]) {
  assert.ok(html.includes(required), `review app should include ${required}`);
}
assert.equal(html.includes('data-correction-fragment='), false, 'review app must not use click-to-concat correction fragments');
assert.equal(html.includes('点选标签生成修正意见'), false, 'review app must not present click-to-concat correction instructions');
assert.equal(html.includes('id="correctionPreview"'), false, 'review app must not keep correction preview composer');
assert.equal(html.includes('id="correctionNote"'), false, 'review app must not save a hidden concatenated correction note');
assert.equal(html.includes('tag-button'), false, 'review app must not keep click-to-concat tag button styles');
assert.equal(html.includes('correction-preview'), false, 'review app must not keep click-to-concat preview styles');
assert.equal(html.includes('导出复核 JSON'), false, 'service UI must not expose JSON export');
assert.equal(html.includes('review_decisions.json'), false, 'service UI must not mention JSON files');
const oldCorrectionTextarea = '<textarea id=' + '"correctionNote"';
assert.equal(html.includes(oldCorrectionTextarea), false, 'business reviewer should not need to type a correction note');
const oldWriteFromScratchLabel = ['如果不准确', '请直接写应该怎么说'].join('，');
assert.equal(html.includes(oldWriteFromScratchLabel), false, 'business UI should not ask reviewers to write from scratch');
for (const internalLabel of ['当前映射位置', '证据状态', '下一步动作', '归因分类', '修正说明', 'allowed_downstream_use=']) {
  assert.equal(html.includes(internalLabel), false, `business UI should not expose internal label: ${internalLabel}`);
}

const executed = [];
const fakePool = {
  async execute(sql, params = []) {
    executed.push({ sql, params });
    return [[], undefined];
  },
};
const repo = makeCandidateReviewRepository(fakePool);
await repo.upsertBundle(bundle);
await repo.saveDecision({
  run_id: bundle.run.run_id,
  stable_key: bundle.items[0].stable_key,
  decision: 'needs_correction',
  evidence_status: 'need_original_review',
  next_action: 'add_evolution_rule',
  failure_class: '证据不足',
  issue_type: 'source_mismatch',
  definition_status: 'needs_original_review',
  normalized_note: '审批对象需要回源确认。',
  reviewer: 'reviewer',
});

assert.ok(
  executed.some((entry) => entry.sql.includes('INSERT INTO candidate_review_runs')),
  'repository should insert candidate runs',
);
assert.ok(
  executed.some((entry) => entry.sql.includes('DELETE FROM candidate_review_items') && entry.sql.includes('stable_key NOT IN')),
  'repository should remove stale candidates when re-importing the same run',
);
assert.ok(
  executed.some((entry) => entry.sql.includes('INSERT INTO candidate_review_excerpts')),
  'repository should insert source excerpts',
);
assert.ok(
  executed.some((entry) => entry.sql.includes('INSERT INTO candidate_review_decisions')),
  'repository should save decisions in MySQL',
);
assert.ok(
  executed.some((entry) => entry.sql.includes('issue_type') && entry.sql.includes('definition_status') && entry.sql.includes('normalized_note')),
  'repository should persist structured review fields instead of a concatenated correction note',
);
assert.equal(
  executed.some((entry) => entry.sql.includes('correction_note')),
  false,
  'repository SQL must not persist concatenated correction notes',
);

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.scripts['review:mysql:init'], 'node scripts/init-candidate-review-mysql.mjs');
assert.equal(packageJson.scripts['review:mysql:import'], 'node scripts/import-candidate-review-mysql.mjs');
assert.equal(packageJson.scripts['review:mysql:serve'], 'node scripts/candidate-review-service.mjs');
assert.equal(packageJson.scripts['test:process-candidate-review'], 'node scripts/test-candidate-review-mysql.mjs');
assert.equal(packageJson.scripts['test:sankey-preview-status'], 'node scripts/test-sankey-preview-status.mjs');
assert.ok(packageJson.dependencies.mysql2, 'root package should depend on mysql2');

console.log('MySQL candidate review checks passed');
