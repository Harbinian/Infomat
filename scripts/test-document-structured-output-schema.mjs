/**
 * 校验文档结构化输出标准 schema 是否仍与前端字段、MySQL 表和结构块 parser 关键枚举对齐。
 *
 * 用法: node scripts/test-document-structured-output-schema.mjs
 * 输入:
 *   - docs/contracts/document-structured-output.schema.json
 *   - apps/mdm-platform/server/mysqlSchema.js
 *   - apps/mdm-platform/server/routes/processDesignMysql.js
 *   - apps/mdm-platform/public/index.html
 *   - scripts/parse-sankey-data.mjs
 * 输出: 只读校验结果，不写文件，不写数据库。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const schemaPath = resolve(repoRoot, 'docs/contracts/document-structured-output.schema.json');
const mysqlSchemaPath = resolve(repoRoot, 'apps/mdm-platform/server/mysqlSchema.js');
const mysqlRoutePath = resolve(repoRoot, 'apps/mdm-platform/server/routes/processDesignMysql.js');
const frontendPath = resolve(repoRoot, 'apps/mdm-platform/public/index.html');
const parserPath = resolve(repoRoot, 'scripts/parse-sankey-data.mjs');
const reportPath = resolve(repoRoot, 'docs/reports/2026-07-02-mdm-process-governance-pending-issue-fields.md');

const schemaText = readFileSync(schemaPath, 'utf8');
const schema = JSON.parse(schemaText);
const mysqlSchema = readFileSync(mysqlSchemaPath, 'utf8');
const mysqlRoute = readFileSync(mysqlRoutePath, 'utf8');
const frontend = readFileSync(frontendPath, 'utf8');
const parser = readFileSync(parserPath, 'utf8');
const report = readFileSync(reportPath, 'utf8');

function collectFromObject(root, visitor) {
  if (!root || typeof root !== 'object') return;
  visitor(root);
  if (Array.isArray(root)) {
    root.forEach(item => collectFromObject(item, visitor));
    return;
  }
  Object.values(root).forEach(value => collectFromObject(value, visitor));
}

function collectMysqlTables(root) {
  const tables = new Set();
  collectFromObject(root, node => {
    const table = node?.['x-mysql']?.table;
    if (typeof table === 'string' && table) tables.add(table);
  });
  return [...tables].sort();
}

function collectUiIds(root) {
  const ids = new Set();
  collectFromObject(root, node => {
    const nodeIds = node?.['x-ui']?.ids;
    if (Array.isArray(nodeIds)) nodeIds.forEach(id => ids.add(id));
  });
  return [...ids].sort();
}

function assertEnum(defName, expected) {
  const actual = schema.$defs?.[defName]?.enum;
  assert.deepEqual(actual, expected, `${defName} enum drifted`);
}

function assertAllIncluded(text, values, context) {
  for (const value of values) {
    assert.ok(text.includes(value), `${context} missing ${value}`);
  }
}

assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.equal(schema.properties.schema_version.const, 'document-structured-output-v2');
for (const field of ['schema_version', 'draft', 'document_profile', 'processes', 'steps', 'step_transitions', 'evidence_catalog']) {
  assert.ok(schema.required.includes(field), `top-level required missing ${field}`);
}
for (const field of ['document_no', 'document_title', 'planned_edition']) {
  assert.ok(schema.$defs.draft.required.includes(field), `draft required missing ${field}`);
}
assert.ok(!schema.$defs.draft.required.includes('reason'), 'draft schema should not require removed why-new field');
assert.ok(!schema.$defs.draft.required.includes('basis_description'), 'draft schema should not require removed basis description field');
assert.ok(schema.$defs.documentProfile.required.includes('document_no'), 'document profile should require制度编号');
assert.ok(schema.$defs.edition, 'schema should define edition format');
assert.ok(schema.$defs.versionStatus, 'schema should define version status enum');
assertEnum('versionStatus', ['published', 'superseded', 'retired']);

assertEnum('processType', ['new', 'inherit', 'handoff', 'adjustment']);
assertEnum('processSystem', ['', 'OA', 'MES', 'PLM', 'ERP']);
assertEnum('stepType', ['action', 'decision']);
assertEnum('fieldType', ['文本', '长文本', '数字', '日期', '日期时间', '金额', '枚举', '布尔', '部门', '人员', '文件编号', '签名', '图片', '附件', '二维码']);
assertEnum('evidenceType', ['制度条款', '表单样例', '访谈记录', '会议纪要', '流程图', '台账记录', '暂无证据']);
assertEnum('evidenceStatus', ['verified', 'pending_review', 'source_missing', 'ocr_extracted_not_confirmed', 'review_only']);

assertAllIncluded(mysqlRoute, schema.$defs.processType.enum.map(value => `'${value}'`), 'processDesignMysql PROCESS_TYPES');
assertAllIncluded(mysqlRoute, schema.$defs.fieldType.enum.map(value => `'${value}'`), 'processDesignMysql FIELD_TYPES');
assertAllIncluded(mysqlRoute, schema.$defs.evidenceType.enum.map(value => `'${value}'`), 'processDesignMysql EVIDENCE_TYPES');
assertAllIncluded(mysqlRoute, schema.$defs.evidenceStatus.enum.map(value => `'${value}'`), 'processDesignMysql EVIDENCE_STATUSES');
assertAllIncluded(mysqlRoute, ['nextEdition', 'confirm_complete_rewrite', 'superseded'], 'processDesignMysql edition control');
assertAllIncluded(frontend, schema.$defs.fieldType.enum, 'frontend field type options');
assertAllIncluded(frontend, schema.$defs.evidenceType.enum, 'frontend evidence type options');
assertAllIncluded(frontend, ['pgDesignDocumentNo', 'pgDesignDocumentTitle', 'pgDesignPlannedEdition', 'pgDesignCurrentEdition'], 'frontend document edition fields');
assert.ok(!frontend.includes('id="pgDesignReason"'), 'frontend should not expose removed why-new field');
assert.ok(!frontend.includes('id="pgDesignBasisDescription"'), 'frontend should not expose removed basis description field');
assert.ok(schema.$defs.step.required.includes('step_type'), 'step schema should require action/decision node type');
assert.ok(schema.$defs.stepTransition, 'schema should define step transition objects for decision branches');
assert.ok(schema.properties.step_transitions.items.$ref === '#/$defs/stepTransition', 'top-level step_transitions should use the transition definition');
for (const field of ['transition_ref', 'process_ref', 'from_step_ref', 'condition', 'to_step_ref', 'evidence_refs']) {
  assert.ok(Object.prototype.hasOwnProperty.call(schema.$defs.stepTransition.properties, field), `stepTransition missing ${field}`);
}
assert.ok(mysqlSchema.includes('CREATE TABLE IF NOT EXISTS process_design_step_transitions'), 'MySQL schema should persist decision branch transitions');
assert.ok(frontend.includes('判断分支'), 'MDM frontend should display imported decision branches');
assertAllIncluded(parser, schema.$defs.evidenceStatus.enum.map(value => `'${value}'`), 'parse-sankey evidence statuses');
assert.ok(parser.includes('const STRUCTURE_BLOCK_VERSION = 1'), 'parser structure block version drifted');

const projectionProps = schema.$defs.structureBlockProjection.properties;
for (const block of ['meta', 'l3_catalog', 'a1_catalog', 'evidence_catalog', 'mdm_requirement_catalog']) {
  assert.ok(Object.prototype.hasOwnProperty.call(projectionProps, block), `structure_block_projection missing ${block}`);
}

const mysqlTables = collectMysqlTables(schema);
assert.ok(mysqlTables.length >= 12, 'schema should map current process_design tables');
for (const table of mysqlTables) {
  assert.ok(
    mysqlSchema.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
    `MySQL schema missing table declared by document schema: ${table}`
  );
}

const uiIds = collectUiIds(schema);
assert.ok(uiIds.length >= 40, 'schema should map current process design UI fields');
for (const id of uiIds) {
  assert.ok(
    frontend.includes(`id="${id}"`) || frontend.includes(`'${id}'`) || frontend.includes(`"${id}"`),
    `frontend missing UI id declared by document schema: ${id}`
  );
}

const pendingProps = schema.$defs.pendingIssue.properties;
for (const field of [
  'stable_key',
  'department',
  'document_name',
  'structured_object_type',
  'structured_object_key',
  'target_block',
  'target_field',
  'current_value',
  'source_file',
  'source_anchor',
  'source_excerpt',
  'evidence_status',
  'issue_type',
  'question_for_user',
  'suggested_handler',
  'allowed_actions',
  'user_decision',
  'user_reason',
  'user_note',
  'next_step'
]) {
  assert.ok(Object.prototype.hasOwnProperty.call(pendingProps, field), `pendingIssue missing ${field}`);
}

assert.ok(
  report.includes('docs/contracts/document-structured-output.schema.json'),
  'pending issue report should point reviewers to the canonical schema'
);

console.log('document structured output schema checks passed');
