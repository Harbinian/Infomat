const express = require('express');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const router = express.Router();
const {
  requireAuth,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync,
  getDepartmentByIdAsync
} = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');

const PROJECT_WIDE_ROLES = new Set(['admin', 'it_lead']);
const REVIEW_ROLES = new Set(['admin', 'it_lead', 'reviewer', 'owner', 'data_quality', 'decision_group']);
const DEPT_CREATE_ROLES = new Set(['submitter', 'business_contact']);
const FIELD_STATUSES = new Set(['suggested', 'business_confirmed', 'data_governed', 'published', 'retired']);
const DRAFT_STATUSES = new Set(['draft', 'submitted', 'under_review', 'needs_changes', 'approved', 'published', 'rejected']);
const CLASSIFICATION_STATUSES = new Set(['unclassified', 'needs_review', 'confirmed']);
const TABLE_KINDS = new Set(['main', 'detail']);
const HANDOFF_STATUSES = new Set(['pending_return', 'returned', 'pending_review', 'confirmed']);
const PROCESS_TYPES = new Set(['new', 'inherit', 'handoff', 'adjustment']);
const EDITABLE_DRAFT_STATUSES = new Set(['draft', 'needs_changes']);
const BASIS_TYPES = new Set(['现场实际', '制度 / 规程', '表单 / 台账', '会议 / 访谈', '暂无证据']);
const DEFAULT_PROCESS_DESIGN_FIELD_TYPES = [
  ['text', '文本'],
  ['long_text', '长文本'],
  ['number', '数字'],
  ['amount', '金额'],
  ['date', '日期'],
  ['datetime', '日期时间'],
  ['enum', '枚举'],
  ['boolean', '布尔'],
  ['department', '部门'],
  ['person', '人员'],
  ['file_no', '文件编号'],
  ['signature', '签名'],
  ['image', '图片'],
  ['attachment', '附件'],
  ['qrcode', '二维码']
];
const FIELD_TYPES = new Set(DEFAULT_PROCESS_DESIGN_FIELD_TYPES.map(([, name]) => name));
const ARCHIVE_LOCATIONS = new Set(['部门自行保存', '资料室']);
const RETENTION_PERIODS = new Set(['1年', '3年', '10年', '永久']);
const EVIDENCE_TYPES = new Set(['制度条款', '表单样例', '访谈记录', '会议纪要', '流程图', '台账记录', '暂无证据']);
const EVIDENCE_STATUSES = new Set(['verified', 'pending_review', 'source_missing', 'ocr_extracted_not_confirmed', 'review_only']);
const PROCESS_EVIDENCE_VERIFY_PERMISSION = 'process_evidence:verify';
const EVIDENCE_STATUS_MIGRATION_KEY = '2026-07-01-process-design-evidence-status';
const EDITION_SCHEMA_MIGRATION_KEY = '2026-07-02-process-design-document-editions';
const FORM_STRUCTURE_SCHEMA_MIGRATION_KEY = '2026-07-03-process-design-form-structure';
const ENGINEERING_ARCHIVE_ROOM_DEPARTMENT_NAME = '工程技术部';
const VERIFIED_EVIDENCE_MESSAGE = '发布需至少 1 条已核验(verified)证据。';
const REPO_ROOT = path.resolve(__dirname, '../../../..');

let repositoryFactory = null;
let repositoryPromise = null;

function runAction(res, action) {
  return action().catch(error => {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json(error.payload || { error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  });
}

function httpError(statusCode, message, payload) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.payload = payload || { error: message };
  return error;
}

function text(value) {
  return String(value || '').trim();
}

function optionalText(value) {
  const cleaned = text(value);
  return cleaned || null;
}

function formatProcedureCode(draftId, sequence) {
  return `PROCEDURE-${Number(draftId)}-${String(Number(sequence) || 1).padStart(3, '0')}`;
}

function pad3(sequence) {
  return String(Number(sequence) || 1).padStart(3, '0');
}

function formatFormCode(draft, sequence) {
  const documentNo = text(draft && draft.document_no) || 'UNSET';
  const edition = text(draft && draft.planned_edition).toUpperCase() || 'A';
  return `FM-${documentNo}-${pad3(sequence)}-${edition}`;
}

function formatFormStructureCode(formCode, structureKind) {
  const value = text(formCode);
  const marker = structureKind === 'detail' ? 'D' : 'M';
  const nextMatch = value.match(/^FM-(.+)-([0-9]{3})-([A-Z]+)$/);
  if (nextMatch) return `FM-${nextMatch[1]}-${marker}${nextMatch[2]}-${nextMatch[3]}`;
  const legacyMatch = value.match(/^FM-(.+)-([A-Z]+)-([0-9]{3})$/);
  if (legacyMatch) return `FM-${legacyMatch[1]}-${marker}${legacyMatch[3]}-${legacyMatch[2]}`;
  return `${value}-${marker}`;
}

function formatFieldCode(structureCode, sequence) {
  return `${text(structureCode)}-${pad3(sequence)}`;
}

function editionToNumber(edition) {
  const value = text(edition).toUpperCase();
  if (!/^[A-Z]+$/.test(value)) return 0;
  return value.split('').reduce((sum, ch) => sum * 26 + (ch.charCodeAt(0) - 64), 0);
}

function numberToEdition(number) {
  let value = Number(number || 0);
  if (!Number.isInteger(value) || value < 1) return 'A';
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function nextEdition(currentEdition) {
  return numberToEdition(editionToNumber(currentEdition) + 1);
}

function editionLabel(edition) {
  const value = text(edition).toUpperCase();
  return value ? `${value}版` : 'A版';
}

function documentVersionNo(documentNo, edition) {
  return `${text(documentNo)}-${text(edition).toUpperCase()}`;
}

function markdownFileSafe(value) {
  return text(value).replace(/[\\/:*?"<>|]/g, '_');
}

function parseProcedureSequence(processCode, draftId) {
  const prefix = `PROCEDURE-${Number(draftId)}-`;
  const value = text(processCode);
  if (!value.startsWith(prefix)) return 0;
  const sequence = Number(value.slice(prefix.length));
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0;
}

function parseFormSequence(formCode, draft) {
  const documentNo = text(draft && draft.document_no) || 'UNSET';
  const edition = text(draft && draft.planned_edition).toUpperCase() || 'A';
  const value = text(formCode);
  const prefix = `FM-${documentNo}-`;
  const suffix = `-${edition}`;
  let sequence = 0;
  if (value.startsWith(prefix) && value.endsWith(suffix)) {
    sequence = Number(value.slice(prefix.length, -suffix.length));
  }
  if (!sequence) {
    const legacyPrefix = `FM-${documentNo}-${edition}-`;
    if (!value.startsWith(legacyPrefix)) return 0;
    sequence = Number(value.slice(legacyPrefix.length));
  }
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0;
}

function parseFieldSequence(fieldCode, structureCode) {
  const prefix = `${text(structureCode)}-`;
  const value = text(fieldCode);
  if (!value.startsWith(prefix)) return 0;
  const sequence = Number(value.slice(prefix.length));
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0;
}

function hasWhitespace(value) {
  return /\s/.test(String(value || ''));
}

function enumDetail(field, message) {
  return { field, message };
}

function assertNoManualNumber(body, field, label) {
  if (Object.prototype.hasOwnProperty.call(body || {}, field) && text(body[field])) {
    throw httpError(422, '校验失败', { error: '校验失败', details: [enumDetail(field, `${label}由系统自动生成，不能手填`)] });
  }
}

function assertNoWhitespaceFields(body, fields) {
  const details = fields
    .filter(field => Object.prototype.hasOwnProperty.call(body || {}, field) && hasWhitespace(body[field]))
    .map(field => enumDetail(field, '字段内容不能包含空格'));
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
}

function assertEnum(body, field, allowed, label, options = {}) {
  const value = text(body && body[field]);
  if (!value && options.optional) return null;
  if (!allowed.has(value)) {
    throw httpError(422, '校验失败', { error: '校验失败', details: [enumDetail(field, `${label}必须从系统选项中选择`)] });
  }
  return value;
}

function boolInt(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function jsonArray(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => text(item)).filter(Boolean));
  const single = text(value);
  return single ? JSON.stringify([single]) : JSON.stringify([]);
}

function splitMarkdownRow(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function isMarkdownSeparator(cells) {
  return (cells || []).length > 0 && cells.every(cell => /^:?-{2,}:?$/.test(String(cell || '').replace(/\s/g, '')));
}

function headerIndex(header, names) {
  return header.findIndex(cell => names.some(name => String(cell || '').includes(name)));
}

function parseProcessTaxonomyMarkdown(markdown, sourceFile) {
  const rows = [];
  const lines = String(markdown || '').split(/\r?\n/);
  let header = null;
  let indexes = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      if (header && rows.length) break;
      continue;
    }
    const cells = splitMarkdownRow(trimmed);
    if (!header && cells.some(cell => cell.includes('能力域')) && cells.some(cell => cell.includes('业务能力'))) {
      header = cells;
      indexes = {
        dept: headerIndex(header, ['部门（D1）', '部门']),
        l1: headerIndex(header, ['能力域（L1）', '能力域']),
        l2: headerIndex(header, ['业务能力（L2）', '业务能力']),
        l3: headerIndex(header, ['业务流程（L3）', '业务流程'])
      };
      continue;
    }
    if (!header || !indexes) continue;
    if (isMarkdownSeparator(cells)) continue;
    const l1Name = text(cells[indexes.l1]);
    const l2Name = text(cells[indexes.l2]);
    if (!l1Name || !l2Name || l1Name.includes('能力域') || l2Name.includes('业务能力')) continue;
    rows.push({
      l1_name: l1Name,
      l2_name: l2Name,
      l3_name: text(cells[indexes.l3]),
      department_name: text(cells[indexes.dept]),
      source_file: sourceFile || null
    });
  }
  return rows;
}

function buildProcessTaxonomyPayload(rows) {
  const byPair = new Map();
  for (const row of rows || []) {
    const l1Name = text(row.l1_name);
    const l2Name = text(row.l2_name);
    if (!l1Name || !l2Name) continue;
    const key = `${l1Name}\n${l2Name}`;
    if (!byPair.has(key)) {
      byPair.set(key, {
        l1_name: l1Name,
        l2_name: l2Name,
        l3_count: 0,
        departments: new Set(),
        source_files: new Set()
      });
    }
    const item = byPair.get(key);
    if (text(row.l3_name)) item.l3_count += 1;
    if (text(row.department_name)) item.departments.add(text(row.department_name));
    if (text(row.source_file)) item.source_files.add(text(row.source_file));
  }
  const items = [...byPair.values()]
    .map(item => ({
      l1_name: item.l1_name,
      l2_name: item.l2_name,
      l3_count: item.l3_count,
      departments: [...item.departments].sort((left, right) => left.localeCompare(right, 'zh-CN')),
      source_files: [...item.source_files].sort((left, right) => left.localeCompare(right, 'zh-CN'))
    }))
    .sort((left, right) => (left.l1_name + left.l2_name).localeCompare(right.l1_name + right.l2_name, 'zh-CN'));
  const l1Options = [...new Set(items.map(item => item.l1_name))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  return { items, l1Options };
}

function readProcessTaxonomyFromNorms() {
  const normsDir = path.join(REPO_ROOT, 'docs', 'norms');
  if (!fs.existsSync(normsDir)) return buildProcessTaxonomyPayload([]);
  const rows = [];
  for (const entry of fs.readdirSync(normsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('部门-能力-流程-系统映射关系.md')) continue;
    const relativePath = path.posix.join('docs/norms', entry.name);
    const fullPath = path.join(normsDir, entry.name);
    rows.push(...parseProcessTaxonomyMarkdown(fs.readFileSync(fullPath, 'utf8'), relativePath));
  }
  return buildProcessTaxonomyPayload(rows);
}

async function taxonomyValidationDetails(repo, body, scope) {
  const hasL1 = Object.prototype.hasOwnProperty.call(body || {}, 'l1_name');
  const hasL2 = Object.prototype.hasOwnProperty.call(body || {}, 'l2_name');
  if (!hasL1 && !hasL2) return [];
  const details = [];
  const l1Name = text(body && body.l1_name);
  const l2Name = text(body && body.l2_name);
  if (!l1Name) details.push({ field: 'l1_name', message: '请选择已有 L1 能力域' });
  if (!l2Name) details.push({ field: 'l2_name', message: '请选择已有 L2 业务能力' });
  if (details.length) return details;
  const taxonomy = typeof repo.listProcessTaxonomy === 'function'
    ? await repo.listProcessTaxonomy(scope || {})
    : buildProcessTaxonomyPayload([]);
  const items = taxonomy.items || [];
  if (!items.length) {
    return [{ field: 'l1_name', message: '请先导入本部门已有流程映射关系后再选择 L1/L2' }];
  }
  const matched = items.some(item => text(item.l1_name) === l1Name && text(item.l2_name) === l2Name);
  return matched ? [] : [{ field: 'l2_name', message: 'L1/L2 必须从本部门已有映射关系中选择，暂不开放新增能力域或业务能力' }];
}

async function appendProcessTaxonomyValidation(repo, body, details, scope) {
  details.push(...await taxonomyValidationDetails(repo, body, scope));
}

function processBodyWithDraftTaxonomy(draft, body) {
  const payload = { ...(body || {}) };
  if (!text(payload.l1_name)) payload.l1_name = text(draft && draft.l1_name);
  if (!text(payload.l2_name)) payload.l2_name = text(draft && draft.l2_name);
  return payload;
}

function publicDraft(row) {
  if (!row) return null;
  return {
    ...row,
    planned_edition: row.planned_edition || 'A',
    related_departments: parseJsonArray(row.related_departments_json),
    involves_other_departments: Boolean(row.involves_other_departments)
  };
}

function publicBehaviorDetail(row) {
  if (!row) return null;
  return {
    ...row,
    requires_approval: Boolean(row.requires_approval),
    is_cross_department: Boolean(row.is_cross_department)
  };
}

function publicProcess(row) {
  return row || null;
}

function publicHandoff(row) {
  return row || null;
}

function activeSteps(steps) {
  return (steps || []).filter(step => (step.status || 'active') === 'active');
}

function behaviorDetailHasContent(detail) {
  if (!detail) return false;
  if (detail.requires_approval || detail.is_cross_department) return true;
  return ['precondition', 'trigger_scene', 'execution_standard', 'delivery_object', 'approval_note']
    .some(field => Boolean(text(detail[field])));
}

function objectEventPayload(objectType, objectId, objectName, action) {
  return {
    metadata: {
      object_type: objectType,
      object_id: objectId,
      object_name: objectName || null,
      action
    }
  };
}

function publicFormTableField(row) {
  if (!row) return null;
  return {
    ...row,
    required: Boolean(row.is_required)
  };
}

function markdownList(items, renderItem) {
  if (!items || !items.length) return '- 暂未填写';
  return items.map(renderItem).join('\n');
}

function processDesignMarkdown(detail) {
  const draft = detail.draft || {};
  const profile = detail.documentProfile || {};
  const documentNo = text(draft.document_no) || text(profile.document_no) || '待定';
  const edition = text(draft.planned_edition) || text(detail.version && detail.version.edition) || 'A';
  const title = text(draft.document_title) || text(profile.document_title) || text(draft.process_name) || '未命名制度';
  const lines = [
    `# ${documentNo} ${title} ${editionLabel(edition)}`,
    '',
    `- 制度编号：${documentNo}`,
    `- 制度名称：${title}`,
    `- 版次：${editionLabel(edition)}`,
    `- 对应流程数：${(detail.processes || []).length || 0}`,
    '',
    '## 目的',
    text(profile.purpose) || '待填写',
    '',
    '## 范围',
    text(profile.scope) || '待填写',
    '',
    '## 与已有制度/流程/表单的关系',
    text(profile.inheritance_relation) || '待填写',
    '',
    '## 术语',
    markdownList(detail.terms || [], term => `- ${text(term.term_name)}：${text(term.definition)}${text(term.applies_to) ? `（适用：${text(term.applies_to)}）` : ''}`),
    '',
    '## 流程',
    markdownList(detail.processes || [], process => `- ${text(process.process_code) || '未编号'} ${text(process.l1_name)} / ${text(process.l2_name)} / ${text(process.l3_name)}`),
    '',
    '## 业务行为',
    markdownList(activeSteps(detail.steps), step => {
      const process = (detail.processes || []).find(item => Number(item.id) === Number(step.process_id)) || {};
      const behavior = step.behaviorDetail || {};
      const handoffs = markdownList(step.handoffs || [], handoff => `  - 承接部门：${text(handoff.target_department)}；流程编号：${text(handoff.target_process_code) || '待定'}；流程：${text(handoff.target_process_name)}；业务行为：${text(handoff.target_behavior_name)}`);
      return [
        `### ${text(step.a1_code) || `A1-${step.id}`} ${text(step.step_name)}`,
        `- 所属流程：${text(process.l3_name) || '待确认'}`,
        `- 执行角色：${text(step.actor_role) || '待填写'}`,
        `- 前置条件：${text(behavior.precondition) || text(step.input_materials) || '待填写'}`,
        `- 触发场景：${text(behavior.trigger_scene) || '待填写'}`,
        `- 执行标准：${text(behavior.execution_standard) || '待填写'}`,
        `- 交付对象：${text(behavior.delivery_object) || text(step.output_result) || '待填写'}`,
        `- 是否需要审批：${behavior.requires_approval ? '是' : '否'}`,
        `- 是否跨部门：${behavior.is_cross_department ? '是' : '否'}`,
        '- 跨部门承接：',
        handoffs
      ].join('\n');
    }),
    '',
    '## 附表结构',
    markdownList(detail.forms || [], form => {
      const mainFields = markdownList(form.main_fields || form.fields || [], field => `  - ${text(field.field_code) || text(field.field_no) || '未编号'} ${text(field.field_name)}：${text(field.field_type) || '待定'}${field.required ? '，必填' : ''}${text(field.enum_options) ? `，选项：${text(field.enum_options)}` : ''}${text(field.description) ? `，${text(field.description)}` : ''}`);
      const tables = markdownList(form.tables || [], table => {
        const fields = markdownList(table.fields || [], field => `    - ${text(field.field_code) || text(field.field_no) || '未编号'} ${text(field.field_name)}：${text(field.field_type) || '待定'}${field.required ? '，必填' : ''}${text(field.enum_options) ? `，选项：${text(field.enum_options)}` : ''}${text(field.description) ? `，${text(field.description)}` : ''}`);
        return [
          `  - 明细表：${text(table.table_code) || text(table.table_no) || '未编号'} ${text(table.table_name)}`,
          fields
        ].join('\n');
      });
      return [
        `### ${text(form.form_code) || '未编号'} ${text(form.form_name)}`,
        `- 关联业务行为：${text(form.step_id) || '待填写'}`,
        `- 归档位置：${text(form.archive_location) || '待填写'}`,
        `- 留存周期：${text(form.retention_period) || '待填写'}`,
        `- 归档责任：${text(form.responsible_department_name) || '待填写'} / ${text(form.responsible_role) || '待填写'}`,
        `- 主表：${text(form.main_table_code) || '未编号'} ${text(form.main_table_name) || '主表'}`,
        mainFields,
        tables
      ].join('\n');
    })
  ];
  return lines.join('\n');
}

async function mysqlQuery(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function mysqlRun(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function executeIgnoringDuplicateColumn(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (error.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(error.message || '')))) return;
    throw error;
  }
}

async function executeIgnoringDuplicateKey(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (
      error.code === 'ER_DUP_KEYNAME'
      || error.code === 'ER_DUP_INDEX'
      || /Duplicate key name/i.test(String(error.message || ''))
    )) return;
    throw error;
  }
}

async function executeIgnoringDuplicateCheck(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (
      error.code === 'ER_FK_DUP_NAME'
      || error.code === 'ER_DUP_KEYNAME'
      || /Duplicate check constraint name/i.test(String(error.message || ''))
      || /already exists/i.test(String(error.message || ''))
    )) return;
    throw error;
  }
}

async function dropProcessDesignVersionStatusChecks(pool) {
  const checks = await mysqlQuery(pool, `
    SELECT tc.CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.CHECK_CONSTRAINTS cc
      ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA
     AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA=DATABASE()
      AND tc.TABLE_NAME='process_design_versions'
      AND tc.CONSTRAINT_TYPE='CHECK'
      AND cc.CHECK_CLAUSE LIKE '%retired%'
      AND cc.CHECK_CLAUSE NOT LIKE '%superseded%'
  `);
  for (const row of checks) {
    await pool.execute(`ALTER TABLE process_design_versions DROP CHECK \`${row.CONSTRAINT_NAME}\``);
  }
}

async function ensureProcessDesignEditionSchema(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_documents (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      document_no VARCHAR(128) NOT NULL,
      document_title VARCHAR(255) NOT NULL,
      owning_department_id BIGINT NOT NULL,
      current_edition VARCHAR(16) NULL,
      current_version_id BIGINT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_by BIGINT NULL,
      updated_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_process_design_documents_no (document_no),
      INDEX idx_process_design_documents_dept (owning_department_id, status),
      INDEX idx_process_design_documents_current_version (current_version_id),
      CHECK (status IN ('active','retired'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN document_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN planned_edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN base_version_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN active_document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_drafts ADD UNIQUE KEY uq_process_design_drafts_active_document_no (active_document_no)');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_drafts ADD INDEX idx_process_design_drafts_document (document_id, status)');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN document_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN effective_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN supersedes_version_id BIGINT NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_versions ADD UNIQUE KEY uq_process_design_versions_document_edition (document_no, edition)');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_versions ADD INDEX idx_process_design_versions_document (document_id, status)');
  await dropProcessDesignVersionStatusChecks(pool);
  await executeIgnoringDuplicateCheck(pool, "ALTER TABLE process_design_versions ADD CONSTRAINT chk_process_design_versions_status CHECK (status IN ('published','superseded','retired'))");
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_mapping_records ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_mapping_records ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_mapping_records ADD COLUMN document_edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_mapping_records ADD INDEX idx_process_mapping_records_document (document_no, document_edition)');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_a1_items ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_a1_items ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_a1_items ADD COLUMN document_edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_a1_items ADD INDEX idx_process_a1_items_document (document_no, document_edition)');
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [EDITION_SCHEMA_MIGRATION_KEY]);
}

async function ensureProcessDesignEvidenceStatusSchema(pool) {
  await executeIgnoringDuplicateColumn(pool, `ALTER TABLE process_design_evidence ADD COLUMN status ENUM('verified','pending_review','source_missing','ocr_extracted_not_confirmed','review_only') NOT NULL DEFAULT 'pending_review'`);
  const [migration] = await mysqlQuery(pool, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [EVIDENCE_STATUS_MIGRATION_KEY]);
  if (migration) return;
  await mysqlRun(pool, "UPDATE process_design_evidence SET status='verified' WHERE status='pending_review' AND maturity='可支撑发布'");
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [EVIDENCE_STATUS_MIGRATION_KEY]);
}

async function ensureProcessDesignFormStructureSchema(pool) {
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN form_code VARCHAR(160) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN main_table_code VARCHAR(180) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN main_table_name VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_forms ADD COLUMN archive_location ENUM('部门自行保存','资料室') NULL");
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_forms ADD COLUMN retention_period ENUM('1年','3年','10年','永久') NULL");
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN responsible_department_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN responsible_department_name VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN responsible_role VARCHAR(255) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_forms ADD INDEX idx_process_design_forms_code (draft_id, form_code)');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_form_tables ADD COLUMN table_code VARCHAR(180) NULL');
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_form_table_fields ADD COLUMN structure_kind ENUM('main','detail') NOT NULL DEFAULT 'detail'");
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_form_table_fields ADD COLUMN field_code VARCHAR(220) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_form_table_fields ADD COLUMN enum_options TEXT NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_form_table_fields ADD INDEX idx_process_design_table_fields_kind (form_table_id, structure_kind, sort_order)');
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_field_types (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NOT NULL,
      name VARCHAR(128) NOT NULL,
      sort_order INT NOT NULL DEFAULT 1,
      is_active TINYINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_process_design_field_types_code (code),
      UNIQUE KEY uq_process_design_field_types_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  for (let index = 0; index < DEFAULT_PROCESS_DESIGN_FIELD_TYPES.length; index += 1) {
    const [code, name] = DEFAULT_PROCESS_DESIGN_FIELD_TYPES[index];
    await mysqlRun(pool, `
      INSERT INTO process_design_field_types (code, name, sort_order)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE name=VALUES(name), sort_order=VALUES(sort_order), is_active=1
    `, [code, name, index + 1]);
  }
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [FORM_STRUCTURE_SCHEMA_MIGRATION_KEY]);
}

function makeProcessDesignMysqlRepository(pool) {
  async function getById(table, id) {
    const [row] = await mysqlQuery(pool, `SELECT * FROM ${table} WHERE id=?`, [id]);
    return row || null;
  }

  async function getDocumentByNo(documentNo) {
    const [row] = await mysqlQuery(pool, 'SELECT * FROM process_design_documents WHERE document_no=?', [text(documentNo)]);
    return row || null;
  }

  async function getDocumentById(documentId) {
    const [row] = await mysqlQuery(pool, 'SELECT * FROM process_design_documents WHERE id=?', [documentId]);
    return row || null;
  }

  async function getCurrentVersionForDocument(documentId) {
    const [row] = await mysqlQuery(pool, `
      SELECT *
      FROM process_design_versions
      WHERE document_id=? AND status='published'
      ORDER BY effective_at DESC, id DESC
      LIMIT 1
    `, [documentId]);
    return row || null;
  }

  async function getActiveDraftForDocumentNo(documentNo) {
    const [row] = await mysqlQuery(pool, `
      SELECT *
      FROM process_design_drafts
      WHERE document_no=?
        AND status IN ('draft','submitted','under_review','needs_changes','approved')
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `, [text(documentNo)]);
    return publicDraft(row);
  }

  async function addEvent(draftId, eventType, actorUserId, note, payload) {
    await mysqlRun(pool, `
      INSERT INTO process_design_events (draft_id, event_type, actor_user_id, note, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `, [draftId, eventType, actorUserId || null, optionalText(note), payload ? JSON.stringify(payload) : null]);
  }

  async function loadDocumentProfile(draftId) {
    const [row] = await mysqlQuery(pool, 'SELECT * FROM process_design_document_profiles WHERE draft_id=?', [draftId]);
    return row || null;
  }

  async function loadTerms(draftId) {
    return await mysqlQuery(pool, 'SELECT * FROM process_design_terms WHERE draft_id=? ORDER BY sort_order, id', [draftId]);
  }

  async function loadProcesses(draftId) {
    const rows = await mysqlQuery(pool, 'SELECT * FROM process_design_processes WHERE draft_id=? ORDER BY sort_order, id', [draftId]);
    return rows.map(publicProcess);
  }

  async function nextProcedureCode(draftId) {
    const rows = await mysqlQuery(pool, 'SELECT process_code FROM process_design_processes WHERE draft_id=?', [draftId]);
    const maxSequence = rows.reduce((max, row) => Math.max(max, parseProcedureSequence(row.process_code, draftId)), 0);
    return formatProcedureCode(draftId, maxSequence + 1);
  }

  async function loadBehaviorDetail(stepId) {
    const [row] = await mysqlQuery(pool, 'SELECT * FROM process_design_behavior_details WHERE step_id=?', [stepId]);
    return publicBehaviorDetail(row);
  }

  async function loadHandoffs(stepId) {
    const rows = await mysqlQuery(pool, 'SELECT * FROM process_design_cross_dept_handoffs WHERE step_id=? ORDER BY sort_order, id', [stepId]);
    return rows.map(publicHandoff);
  }

  async function loadSteps(draftId) {
    const steps = await mysqlQuery(pool, 'SELECT * FROM process_design_steps WHERE draft_id=? ORDER BY process_id, sort_order, id', [draftId]);
    const result = [];
    for (const step of steps) {
      result.push({
        ...step,
        behaviorDetail: await loadBehaviorDetail(step.id),
        handoffs: await loadHandoffs(step.id)
      });
    }
    return result;
  }

  async function loadFormTableFields(tableId) {
    const rows = await mysqlQuery(pool, 'SELECT * FROM process_design_form_table_fields WHERE form_table_id=? ORDER BY sort_order, id', [tableId]);
    return rows.map(publicFormTableField);
  }

  async function loadFormTables(formId) {
    const tables = await mysqlQuery(pool, "SELECT * FROM process_design_form_tables WHERE form_id=? AND table_kind='detail' ORDER BY sort_order, id", [formId]);
    const result = [];
    for (const table of tables) {
      result.push({ ...table, fields: await loadFormTableFields(table.id) });
    }
    return result;
  }

  async function loadMainFields(formId) {
    const rows = await mysqlQuery(pool, `
      SELECT ftf.*
      FROM process_design_form_table_fields ftf
      JOIN process_design_form_tables ft ON ft.id=ftf.form_table_id
      WHERE ft.form_id=?
        AND ft.table_kind='main'
        AND ftf.structure_kind='main'
      ORDER BY ftf.sort_order, ftf.id
    `, [formId]);
    return rows.map(publicFormTableField);
  }

  async function loadForms(draftId) {
    const forms = await mysqlQuery(pool, 'SELECT * FROM process_design_forms WHERE draft_id=? ORDER BY id', [draftId]);
    const result = [];
    for (const form of forms) {
      const legacyFields = await mysqlQuery(pool, 'SELECT * FROM process_design_form_fields WHERE form_id=? ORDER BY sort_order, id', [form.id]);
      const mainFields = await loadMainFields(form.id);
      result.push({ ...form, fields: mainFields, main_fields: mainFields, legacy_fields: legacyFields, tables: await loadFormTables(form.id) });
    }
    return result;
  }

  async function loadEvidence(draftId) {
    return await mysqlQuery(pool, 'SELECT * FROM process_design_evidence WHERE draft_id=? ORDER BY id', [draftId]);
  }

  async function loadEvents(draftId) {
    const rows = await mysqlQuery(pool, `
      SELECT e.*, u.name AS actor_user_name
      FROM process_design_events e
      LEFT JOIN users u ON u.id=e.actor_user_id
      WHERE e.draft_id=?
      ORDER BY e.id
    `, [draftId]);
    return rows.map(row => ({
      ...row,
      payload: parseJsonObject(row.payload_json)
    }));
  }

  async function loadReviewTasks(draftId) {
    return await mysqlQuery(pool, 'SELECT * FROM process_design_review_tasks WHERE draft_id=? ORDER BY id', [draftId]);
  }

  async function getDraft(id) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*, dept.name AS department_name, proxyDept.name AS proxy_department_name, creator.name AS created_by_name
      FROM process_design_drafts d
      LEFT JOIN departments dept ON dept.id=d.department_id
      LEFT JOIN departments proxyDept ON proxyDept.id=d.proxy_department_id
      LEFT JOIN users creator ON creator.id=d.created_by
      WHERE d.id=?
    `, [id]);
    return publicDraft(row);
  }

  async function getDraftByStep(stepId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_steps s
      JOIN process_design_drafts d ON d.id=s.draft_id
      WHERE s.id=?
    `, [stepId]);
    return publicDraft(row);
  }

  async function getDraftByTerm(termId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_terms t
      JOIN process_design_drafts d ON d.id=t.draft_id
      WHERE t.id=?
    `, [termId]);
    return publicDraft(row);
  }

  async function getDraftByProcess(processId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_processes p
      JOIN process_design_drafts d ON d.id=p.draft_id
      WHERE p.id=?
    `, [processId]);
    return publicDraft(row);
  }

  async function getDraftByHandoff(handoffId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_cross_dept_handoffs h
      JOIN process_design_steps s ON s.id=h.step_id
      JOIN process_design_drafts d ON d.id=s.draft_id
      WHERE h.id=?
    `, [handoffId]);
    return publicDraft(row);
  }

  async function getHandoff(handoffId) {
    const [row] = await mysqlQuery(pool, 'SELECT * FROM process_design_cross_dept_handoffs WHERE id=?', [handoffId]);
    return publicHandoff(row);
  }

  async function getDraftByForm(formId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_forms f
      JOIN process_design_drafts d ON d.id=f.draft_id
      WHERE f.id=?
    `, [formId]);
    return publicDraft(row);
  }

  async function getDraftByFormTable(tableId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_form_tables ft
      JOIN process_design_forms f ON f.id=ft.form_id
      JOIN process_design_drafts d ON d.id=f.draft_id
      WHERE ft.id=?
    `, [tableId]);
    return publicDraft(row);
  }

  async function getDraftByFormTableField(fieldId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_form_table_fields ftf
      JOIN process_design_form_tables ft ON ft.id=ftf.form_table_id
      JOIN process_design_forms f ON f.id=ft.form_id
      JOIN process_design_drafts d ON d.id=f.draft_id
      WHERE ftf.id=?
    `, [fieldId]);
    return publicDraft(row);
  }

  async function getDraftByField(fieldId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_form_fields ff
      JOIN process_design_forms f ON f.id=ff.form_id
      JOIN process_design_drafts d ON d.id=f.draft_id
      WHERE ff.id=?
    `, [fieldId]);
    return publicDraft(row);
  }

  async function getDraftByEvidence(evidenceId) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*
      FROM process_design_evidence e
      JOIN process_design_drafts d ON d.id=e.draft_id
      WHERE e.id=?
    `, [evidenceId]);
    return publicDraft(row);
  }

  async function getCounts(draftId) {
    const [[processes], [steps], [forms], [fields], [tableFields], [evidence], [publishableEvidence], [terms], [handoffs]] = await Promise.all([
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_processes WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, "SELECT COUNT(*) AS count FROM process_design_steps WHERE draft_id=? AND status='active'", [draftId]),
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_forms WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, `
        SELECT COUNT(*) AS count
        FROM process_design_form_fields ff
        JOIN process_design_forms f ON f.id=ff.form_id
        WHERE f.draft_id=?
      `, [draftId]),
      mysqlQuery(pool, `
        SELECT COUNT(*) AS count
        FROM process_design_form_table_fields ftf
        JOIN process_design_form_tables ft ON ft.id=ftf.form_table_id
        JOIN process_design_forms f ON f.id=ft.form_id
        WHERE f.draft_id=?
      `, [draftId]),
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_evidence WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, "SELECT COUNT(*) AS count FROM process_design_evidence WHERE draft_id=? AND status='verified'", [draftId]),
      mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_terms WHERE draft_id=?', [draftId]),
      mysqlQuery(pool, `
        SELECT COUNT(*) AS count
        FROM process_design_cross_dept_handoffs h
        JOIN process_design_steps s ON s.id=h.step_id
        WHERE s.draft_id=? AND s.status='active'
      `, [draftId])
    ]);
    const risks = (await buildRisks(draftId)).length;
    const fieldCount = Number(fields.count || 0);
    const tableFieldCount = Number(tableFields.count || 0);
    return {
      processes: Number(processes.count || 0),
      steps: Number(steps.count || 0),
      forms: Number(forms.count || 0),
      fields: fieldCount + tableFieldCount,
      formFields: fieldCount,
      tableFields: tableFieldCount,
      evidence: Number(evidence.count || 0),
      publishableEvidence: Number(publishableEvidence.count || 0),
      verifiedEvidence: Number(publishableEvidence.count || 0),
      terms: Number(terms.count || 0),
      handoffs: Number(handoffs.count || 0),
      risks
    };
  }

  async function buildRisks(draftId) {
    const risks = [];
    const draft = await getDraft(draftId);
    if (!draft) return risks;
    const processes = await loadProcesses(draftId);
    if (!processes.length) {
      risks.push({ object_type: 'process', object_id: draft.id, message: '还没有添加制度对应的流程明细。', status: 'open' });
    }
    for (const process of processes) {
      if (!text(process.l1_name) || !text(process.l2_name) || !text(process.l3_name)) {
        risks.push({ object_type: 'process', object_id: process.id, message: '流程明细还没有写清 L1、L2 和 L3。', status: 'open' });
      }
    }
    const profile = await loadDocumentProfile(draftId);
    if (!profile || !text(profile.purpose) || !text(profile.scope)) {
      risks.push({ object_type: 'document', object_id: draft.id, message: '制度文档还没有写清目的和范围。', status: 'open' });
    }
    for (const step of activeSteps(await loadSteps(draftId))) {
      if (!text(step.output_result)) risks.push({ object_type: 'step', object_id: step.id, message: '这一步做完后没有写清会产生什么结果。', status: 'open' });
      if (step.need_confirmation && !text(step.related_departments)) risks.push({ object_type: 'step', object_id: step.id, message: '这一步需要别人确认，但还没有指定确认部门。', status: 'open' });
      const detail = step.behaviorDetail || {};
      if (!text(detail.execution_standard)) risks.push({ object_type: 'behavior', object_id: step.id, message: '这个业务行为还没有写清执行标准。', status: 'open' });
      if (!text(detail.delivery_object)) risks.push({ object_type: 'behavior', object_id: step.id, message: '这个业务行为还没有写清交付对象。', status: 'open' });
      if (detail.requires_approval && !text(detail.approval_note)) risks.push({ object_type: 'behavior', object_id: step.id, message: '这个业务行为需要审批，但还没有说明审批要求。', status: 'open' });
      if (!step.process_id) risks.push({ object_type: 'step', object_id: step.id, message: '这个业务行为还没有归属到具体流程。', status: 'open' });
      if (detail.is_cross_department && !(step.handoffs || []).some(handoff => text(handoff.target_process_name) && text(handoff.target_behavior_name))) {
        risks.push({ object_type: 'handoff', object_id: step.id, message: '这个业务行为涉及跨部门，正在等待承接部门回写流程和业务行为。', status: 'open' });
      }
    }
    for (const form of await loadForms(draftId)) {
      if (!text(form.step_id)) risks.push({ object_type: 'form', object_id: form.id, message: '表单没有指向业务行为。', status: 'open' });
      if (!text(form.form_code)) risks.push({ object_type: 'form', object_id: form.id, message: '表单没有系统编号。', status: 'open' });
      if (!text(form.main_table_name)) risks.push({ object_type: 'form', object_id: form.id, message: '表单没有主表名称。', status: 'open' });
      if (!text(form.archive_location)) risks.push({ object_type: 'form', object_id: form.id, message: '表单没有选择归档位置。', status: 'open' });
      if (!text(form.retention_period)) risks.push({ object_type: 'form', object_id: form.id, message: '表单没有选择留存周期。', status: 'open' });
      if (!text(form.responsible_department_name) || !text(form.responsible_role)) risks.push({ object_type: 'form', object_id: form.id, message: '表单没有设置归档责任部门和角色。', status: 'open' });
      if (!(form.main_fields || []).length) risks.push({ object_type: 'form_table', object_id: form.id, message: '这个表单的主表还没有设置字段。', status: 'open' });
      (form.tables || []).forEach(table => {
        if (!text(table.table_name)) risks.push({ object_type: 'form_table', object_id: table.id, message: '这个明细表没有名称。', status: 'open' });
        if (!(table.fields || []).length) risks.push({ object_type: 'form_table', object_id: table.id, message: '这个附表还没有设置字段。', status: 'open' });
      });
      [
        ...(form.main_fields || []),
        ...(form.tables || []).flatMap(table => table.fields || [])
      ].forEach(field => {
        if (field.field_type === '枚举' && !text(field.enum_options)) risks.push({ object_type: 'field', object_id: field.id, message: '这个字段要从固定选项里选，但选项还没列出来。', status: 'open' });
      });
    }
    for (const evidence of await loadEvidence(draftId)) {
      if (evidence.status !== 'verified') risks.push({ object_type: 'evidence', object_id: evidence.id, message: '这条证据还没有完成核验。', status: 'open' });
    }
    const stored = await mysqlQuery(pool, `
      SELECT object_type, object_id, message, status
      FROM process_design_risks
      WHERE draft_id=? AND status NOT IN ('confirmed','accepted')
      ORDER BY id
    `, [draftId]);
    return [...risks, ...stored];
  }

  async function publishReadiness(draft) {
    const [processes, steps, evidence] = await Promise.all([
      loadProcesses(draft.id),
      loadSteps(draft.id),
      loadEvidence(draft.id)
    ]);
    const verifiedEvidenceCount = evidence.filter(item => item.status === 'verified').length;
    const processesConfirmed = processes.length > 0 && processes.every(process => (
      text(process.l1_name) && text(process.l2_name) && text(process.l3_name)
    ));
    return {
      verifiedEvidenceCount,
      stepCount: activeSteps(steps).length,
      processesConfirmed,
      publishable: verifiedEvidenceCount >= 1
        && processesConfirmed
        && activeSteps(steps).length >= 1
    };
  }

  async function publishValidationDetails(draft, options = {}) {
    const details = [];
    if (draft.l1_status === 'needs_review' || draft.l2_status === 'needs_review') details.push('待确认 L1/L2 未复核前不能作为正式能力结构发布。');
    const processes = await loadProcesses(draft.id);
    if (!processes.length) details.push('发布前至少需要 1 个制度流程。');
    if (processes.some(process => !text(process.l1_name) || !text(process.l2_name) || !text(process.l3_name))) details.push('发布前每个制度流程都要写清 L1、L2 和 L3。');
    const profile = await loadDocumentProfile(draft.id);
    if (!text(draft.document_no)) details.push('发布前还需填写制度编号。');
    if (!text(draft.document_title || draft.process_name)) details.push('发布前还需填写制度名称。');
    if (!profile || !text(profile.document_title)) details.push('发布前还需填写制度名称。');
    if (!profile || !text(profile.purpose)) details.push('发布前还需填写制度目的。');
    if (!profile || !text(profile.scope)) details.push('发布前还需填写制度范围。');
    const steps = activeSteps(await loadSteps(draft.id));
    if (!steps.length) details.push('发布前至少需要 1 个业务行为。');
    if (steps.some(step => !step.process_id)) details.push('发布前每个业务行为都要归属到具体流程。');
    if (steps.some(step => !text(step.output_result))) details.push('发布前每个步骤都要写清输出结果。');
    if (steps.some(step => !step.behaviorDetail || !text(step.behaviorDetail.execution_standard))) details.push('发布前每个业务行为都要写清执行标准。');
    if (steps.some(step => !step.behaviorDetail || !text(step.behaviorDetail.delivery_object))) details.push('发布前每个业务行为都要写清交付对象。');
    if (steps.some(step => step.behaviorDetail && step.behaviorDetail.is_cross_department && !(step.handoffs || []).some(handoff => text(handoff.target_process_name) && text(handoff.target_behavior_name)))) {
      details.push('发布前跨部门业务行为需要由承接部门回写承接流程和承接行为。');
    }
    const forms = await loadForms(draft.id);
    const fields = forms.flatMap(form => [
      ...(form.main_fields || []),
      ...(form.tables || []).flatMap(table => table.fields || [])
    ]);
    if (!fields.length) details.push('发布前至少需要 1 个字段。');
    const activeStepIds = new Set(steps.map(step => Number(step.id)));
    if (forms.some(form => !activeStepIds.has(Number(form.step_id)))) details.push('发布前每个在线表单都必须指向未作废的业务行为。');
    if (forms.some(form => !text(form.form_code))) details.push('发布前每个在线表单都需要系统生成表单编号。');
    if (forms.some(form => !text(form.form_name))) details.push('发布前每个在线表单都需要表单名称。');
    if (forms.some(form => !text(form.main_table_name))) details.push('发布前每个在线表单都需要主表名称。');
    if (forms.some(form => !text(form.archive_location))) details.push('发布前在线表单需要选择归档位置。');
    if (forms.some(form => !text(form.retention_period))) details.push('发布前在线表单需要选择留存周期。');
    if (forms.some(form => !text(form.responsible_department_name) || !text(form.responsible_role))) details.push('发布前在线表单需要设置归档责任部门和角色。');
    if (forms.some(form => !(form.main_fields || []).length)) details.push('发布前每个在线表单的主表至少需要 1 个字段。');
    if (forms.some(form => (form.tables || []).some(table => !text(table.table_name)))) details.push('发布前每个明细表都需要名称。');
    if (forms.some(form => (form.tables || []).some(table => !(table.fields || []).length))) details.push('发布前每个明细表至少需要 1 个字段。');
    if (fields.some(field => field.field_type === '枚举' && !text(field.enum_options))) details.push('发布前枚举字段需要列出固定选项。');
    const evidence = await loadEvidence(draft.id);
    if (!evidence.length) details.push('发布前至少需要 1 条证据。');
    if (evidence.length > 0 && !evidence.some(item => text(item.source_anchor))) details.push('发布前还需补 1 条来源锚点。');
    if (!evidence.some(item => item.status === 'verified')) details.push(VERIFIED_EVIDENCE_MESSAGE);
    return Array.from(new Set(details));
  }

  async function outcomeForDraft(draft) {
    const counts = await getCounts(draft.id);
    const formed = [];
    if (draft.process_name) formed.push('1 条制度结构草稿');
    if (counts.processes) formed.push(`${counts.processes} 个制度流程`);
    if (counts.steps) formed.push(`${counts.steps} 个业务行为`);
    if (counts.forms) formed.push(`${counts.forms} 个在线表单`);
    if (counts.fields) formed.push(`${counts.fields} 个字段草稿`);
    if (counts.terms) formed.push(`${counts.terms} 个术语`);
    if (counts.handoffs) formed.push(`${counts.handoffs} 个跨部门承接`);
    if (counts.evidence) formed.push(`${counts.evidence} 条证据说明`);
    if (draft.status === 'published') formed.push('1 个发布版本');
    const missing = await publishValidationDetails(draft, { relaxed: true });
    return {
      formed: formed.length ? `已形成 ${formed.join('、')}` : '已形成 0 条治理资产',
      current: draft.status === 'published'
        ? '当前内容已经发布为数据库流程地图版本'
        : draft.status === 'submitted'
          ? '当前内容可以等待审核或继续补充材料'
          : '当前内容可以保存制度说明或提交部门内审',
      missing,
      next: draft.status === 'published' ? '查看成果预览' : missing.length ? '继续补齐发布前缺项' : '提交审核或发布',
      counts
    };
  }

  async function versionContent(draft) {
    const profile = await loadDocumentProfile(draft.id);
    const diff = await editionDiffForDraft(draft);
    return {
      document_no: draft.document_no,
      document_title: draft.document_title || draft.process_name,
      edition: draft.planned_edition,
      supersedes_version_id: draft.base_version_id || null,
      version_status: 'published',
      edition_diff: diff,
      draft,
      documentProfile: profile,
      terms: await loadTerms(draft.id),
      processes: await loadProcesses(draft.id),
      steps: activeSteps(await loadSteps(draft.id)),
      forms: await loadForms(draft.id),
      evidence: await loadEvidence(draft.id)
    };
  }

  function namesFromRows(rows, fields) {
    const values = new Set();
    for (const row of rows || []) {
      for (const field of fields) {
        const value = text(row && row[field]);
        if (value) values.add(value);
      }
    }
    return values;
  }

  function missingNames(baseRows, currentRows, fields) {
    const current = namesFromRows(currentRows, fields);
    return [...namesFromRows(baseRows, fields)].filter(value => !current.has(value));
  }

  async function editionDiffForDraft(draft) {
    if (!draft || !draft.base_version_id) {
      return {
        base_edition: null,
        planned_edition: text(draft && draft.planned_edition) || 'A',
        missing: { processes: [], steps: [], forms: [] }
      };
    }
    const baseVersion = await getById('process_design_versions', draft.base_version_id);
    const content = parseJsonObject(baseVersion && baseVersion.content_json) || {};
    const baseForms = content.forms || [];
    const currentForms = await loadForms(draft.id);
    return {
      base_version_id: draft.base_version_id,
      base_edition: text(baseVersion && baseVersion.edition) || null,
      planned_edition: text(draft.planned_edition) || null,
      missing: {
        processes: missingNames(content.processes || [], await loadProcesses(draft.id), ['l3_name']),
        steps: missingNames(content.steps || [], activeSteps(await loadSteps(draft.id)), ['step_name']),
        forms: missingNames(baseForms, currentForms, ['form_name'])
      }
    };
  }

  async function archiveSupersededProjection(versionId) {
    if (!versionId) return;
    const sourceFile = `process_design_versions:${versionId}`;
    await mysqlRun(pool, "UPDATE process_mapping_records SET status='archived' WHERE source_file=? AND status='published'", [sourceFile]);
  }

  async function projectPublishedVersionToProcessMap(draft, version) {
    const [snapshot] = await mysqlQuery(pool, `
      SELECT *
      FROM process_governance_snapshots
      WHERE status='active'
      ORDER BY imported_at DESC, id DESC
      LIMIT 1
    `);
    if (!snapshot) return;
    const processes = await loadProcesses(draft.id);
    const steps = activeSteps(await loadSteps(draft.id));
    const sourceFile = `process_design_versions:${version.id}`;
    for (const process of processes) {
      const l3Key = `process-design:${version.id}:process:${process.id}`;
      await mysqlRun(pool, `
        INSERT INTO process_mapping_records
          (mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, l2_name,
           document_no, document_title, document_edition, l3_name, source_file, status)
        VALUES (?, 'l3', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
        ON DUPLICATE KEY UPDATE latest_snapshot_id=VALUES(latest_snapshot_id), status='published'
      `, [
        l3Key, snapshot.id, snapshot.id, draft.department_name, process.l2_name,
        version.document_no || draft.document_no, version.document_title || draft.document_title,
        version.edition || draft.planned_edition, process.l3_name, sourceFile
      ]);
      const [l3Record] = await mysqlQuery(pool, 'SELECT id FROM process_mapping_records WHERE mapping_key=?', [l3Key]);
      const processSteps = steps.filter(step => Number(step.process_id) === Number(process.id));
      for (let index = 0; index < processSteps.length; index += 1) {
        const step = processSteps[index];
        const behaviorDetail = step.behaviorDetail || {};
        const a1Code = text(step.a1_code) || `PD-${draft.id}-P${process.id}-A1-${String(index + 1).padStart(3, '0')}`;
        const approvalType = behaviorDetail.requires_approval ? '需审批' : (step.need_confirmation ? '需确认' : '记录');
        const outputTarget = text(behaviorDetail.delivery_object) || step.output_result || null;
        await mysqlRun(pool, 'UPDATE process_design_steps SET a1_code=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [a1Code, step.id]);
        const result = await mysqlRun(pool, `
          INSERT INTO process_a1_items
            (snapshot_id, a1_code, dept_name, document_no, document_title, document_edition,
             l3_name, behavior, execution_role, approval_type,
             input_source_dept, output_target_dept, suggested_systems, verification_note, source_file)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          snapshot.id, a1Code, draft.department_name,
          version.document_no || draft.document_no,
          version.document_title || draft.document_title,
          version.edition || draft.planned_edition,
          process.l3_name, step.step_name,
          step.actor_role || null, approvalType,
          step.input_materials || text(behaviorDetail.precondition) || null, outputTarget, JSON.stringify([]),
          '由文档结构化输出发布', sourceFile
        ]);
        await mysqlRun(pool, `
          INSERT INTO process_mapping_records
            (mapping_key, record_type, first_snapshot_id, latest_snapshot_id, parent_record_id, latest_a1_item_id,
             dept_name, l2_name, document_no, document_title, document_edition,
             l3_name, a1_code, behavior, execution_role, approval_type,
             input_source_dept, output_target_dept, suggested_systems, verification_note, source_file, status)
          VALUES (?, 'a1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
          ON DUPLICATE KEY UPDATE latest_snapshot_id=VALUES(latest_snapshot_id), status='published'
        `, [
          `process-design:${version.id}:step:${step.id}`, snapshot.id, snapshot.id,
          l3Record && l3Record.id || null, result.insertId, draft.department_name,
          process.l2_name,
          version.document_no || draft.document_no,
          version.document_title || draft.document_title,
          version.edition || draft.planned_edition,
          process.l3_name, a1Code, step.step_name, step.actor_role || null,
          approvalType, step.input_materials || text(behaviorDetail.precondition) || null,
          outputTarget, JSON.stringify([]), '由文档结构化输出发布', sourceFile
        ]);
      }
    }
  }

  async function detailForDraft(draftId) {
    const draft = await getDraft(draftId);
    if (!draft) return null;
    const readiness = await publishReadiness(draft);
    const document = draft.document_id ? await getDocumentById(draft.document_id) : null;
    const versions = document ? await mysqlQuery(pool, `
      SELECT *
      FROM process_design_versions
      WHERE document_id=?
      ORDER BY effective_at DESC, id DESC
    `, [document.id]) : [];
    return {
      draft,
      document,
      versions,
      editionDiff: await editionDiffForDraft(draft),
      documentProfile: await loadDocumentProfile(draftId),
      terms: await loadTerms(draftId),
      processes: await loadProcesses(draftId),
      steps: await loadSteps(draftId),
      forms: await loadForms(draftId),
      evidence: await loadEvidence(draftId),
      risks: await buildRisks(draftId),
      reviewTasks: await loadReviewTasks(draftId),
      events: await loadEvents(draftId),
      outcome: await outcomeForDraft(draft),
      publishable: readiness.publishable
    };
  }

  return {
    async lookupDocument(documentNo) {
      const normalizedNo = text(documentNo);
      const document = await getDocumentByNo(normalizedNo);
      if (!document) {
        return {
          exists: false,
          document_no: normalizedNo,
          next_edition: 'A',
          can_create: true,
          can_create_next: false,
          active_draft: null,
          current_version: null,
          message: '该制度编号可用，可创建 A版草稿'
        };
      }
      const [currentVersion, activeDraft] = await Promise.all([
        getCurrentVersionForDocument(document.id),
        getActiveDraftForDocumentNo(normalizedNo)
      ]);
      const currentEdition = text(document.current_edition) || text(currentVersion && currentVersion.edition) || null;
      return {
        exists: true,
        document,
        document_no: normalizedNo,
        current_version: currentVersion,
        current_edition: currentEdition,
        next_edition: currentEdition ? nextEdition(currentEdition) : 'A',
        active_draft: activeDraft,
        can_create: !activeDraft && !currentVersion,
        can_create_next: Boolean(currentVersion && !activeDraft),
        message: activeDraft ? '该制度编号已有进行中草稿' : (currentVersion ? '该制度编号可创建下一版次' : '该制度编号可创建 A版草稿')
      };
    },
    async createNextEditionDraft(documentId, actorUserId, targetDeptId) {
      const document = await getDocumentById(documentId);
      if (!document) throw httpError(404, '制度不存在');
      const activeDraft = await getActiveDraftForDocumentNo(document.document_no);
      if (activeDraft) {
        throw httpError(409, '该制度编号已有进行中草稿', {
          error: '该制度编号已有进行中草稿',
          active_draft: activeDraft
        });
      }
      const currentVersion = await getCurrentVersionForDocument(document.id);
      if (!currentVersion) throw httpError(409, '该制度还没有当前有效版次，请先创建 A版草稿');
      const plannedEdition = nextEdition(text(document.current_edition) || currentVersion.edition);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_drafts
          (document_id, document_no, document_title, planned_edition, base_version_id, active_document_no,
           process_name, reason, basis_type, basis_description, involves_other_departments,
           related_departments_json, department_id, l1_status, l2_status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', '现场实际', '', 0, ?, ?, 'unclassified', 'unclassified', ?)
      `, [
        document.id, document.document_no, document.document_title, plannedEdition, currentVersion.id, document.document_no,
        document.document_title, jsonArray([]), targetDeptId || document.owning_department_id, actorUserId
      ]);
      await addEvent(result.insertId, 'draft_created', actorUserId, `已创建 ${editionLabel(plannedEdition)} 完整重写草稿`, {
        document_no: document.document_no,
        planned_edition: plannedEdition,
        base_version_id: currentVersion.id
      });
      const draft = await getDraft(result.insertId);
      return { ...draft, outcome: await outcomeForDraft(draft) };
    },
    async editionDiff(draft) {
      return await editionDiffForDraft(draft);
    },
    async listProcessTaxonomy(scope = {}) {
      const departmentNames = Array.isArray(scope.departmentNames)
        ? scope.departmentNames.map(name => text(name)).filter(Boolean)
        : [];
      if (!departmentNames.length) return buildProcessTaxonomyPayload([]);
      const rows = await mysqlQuery(pool, `
        SELECT r.domain_name AS l1_name,
               r.l2_name,
               r.l3_name,
               r.dept_name AS department_name,
               r.source_file
        FROM process_mapping_records r
        WHERE r.record_type='l3'
          AND r.status IN ('active','published')
          AND r.domain_name IS NOT NULL
          AND r.domain_name <> ''
          AND r.l2_name IS NOT NULL
          AND r.l2_name <> ''
          AND r.dept_name IN (${departmentNames.map(() => '?').join(',')})
        ORDER BY r.dept_name, r.domain_name, r.l2_name, r.l3_name
      `, departmentNames);
      return buildProcessTaxonomyPayload(rows);
    },
    async listFieldTypes() {
      const rows = await mysqlQuery(pool, `
        SELECT code, name, sort_order
        FROM process_design_field_types
        WHERE is_active=1
        ORDER BY sort_order, id
      `);
      return rows.map(row => ({ code: row.code, name: row.name, sort_order: row.sort_order }));
    },
    async listRosterRolesByDepartment(departmentId) {
      const department = await getById('departments', Number(departmentId));
      const roleNames = new Set();
      try {
        const rows = await mysqlQuery(pool, `
          SELECT DISTINCT pos.position_name
          FROM person p
          JOIN person_position_assignment ppa ON ppa.person_id=p.person_id
          JOIN position pos ON pos.position_id=ppa.position_id
          WHERE p.current_department_id=?
            AND p.status='active'
            AND ppa.status='active'
            AND pos.status='active'
            AND pos.position_name IS NOT NULL
            AND pos.position_name <> ''
          ORDER BY pos.position_name
        `, [Number(departmentId)]);
        rows.forEach(row => roleNames.add(text(row.position_name)));
      } catch (error) {
        if (!/doesn.t exist|Unknown table|Unknown column|ER_NO_SUCH_TABLE|ER_BAD_FIELD_ERROR/i.test(String(error && (error.message || error.code) || ''))) {
          throw error;
        }
      }
      if (!roleNames.size) {
        const users = await mysqlQuery(pool, `
          SELECT DISTINCT post
          FROM users
          WHERE department_id=?
            AND post IS NOT NULL
            AND post <> ''
          ORDER BY post
        `, [Number(departmentId)]);
        users.forEach(row => roleNames.add(text(row.post)));
      }
      return {
        department_id: Number(departmentId),
        department_name: department && department.name || null,
        roles: [...roleNames].filter(Boolean).sort((left, right) => left.localeCompare(right, 'zh-CN'))
      };
    },
    async summary(departmentIds, documentNo) {
      const params = [];
      const versionParams = [];
      let whereSql = 'WHERE 1=1';
      let draftWhereSql = 'WHERE 1=1';
      let versionWhereSql = 'WHERE 1=1';
      if (departmentIds) {
        if (!departmentIds.length) return { summary: { totalDrafts: 0, publishedVersions: 0, byStatus: {} }, drafts: [] };
        const markers = departmentIds.map(() => '?').join(',');
        whereSql += ` AND department_id IN (${markers})`;
        draftWhereSql += ` AND d.department_id IN (${markers})`;
        versionWhereSql += ` AND v.department_id IN (${markers})`;
        params.push(...departmentIds);
        versionParams.push(...departmentIds);
      }
      const documentNoFilter = text(documentNo);
      if (documentNoFilter) {
        whereSql += ' AND document_no=?';
        draftWhereSql += ' AND d.document_no=?';
        versionWhereSql += ' AND v.document_no=?';
        params.push(documentNoFilter);
        versionParams.push(documentNoFilter);
      }
      const rows = await mysqlQuery(pool, `
        SELECT status, COUNT(*) AS count
        FROM process_design_drafts
        ${whereSql}
          AND status <> 'published'
        GROUP BY status
      `, params);
      const byStatus = {};
      rows.forEach(row => { byStatus[row.status] = Number(row.count || 0); });
      const totalDrafts = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
      const [publishedRow] = await mysqlQuery(pool, `
        SELECT COUNT(*) AS count
        FROM process_design_versions v
        ${versionWhereSql}
      `, versionParams);
      const drafts = await mysqlQuery(pool, `
        SELECT d.id, d.process_name, d.document_no, d.document_title, d.planned_edition,
               doc.current_edition, d.base_version_id, d.status, d.l1_name, d.l2_name, d.l3_name,
               dept.name AS department_name, d.updated_at
        FROM process_design_drafts d
        LEFT JOIN process_design_documents doc ON doc.id=d.document_id
        LEFT JOIN departments dept ON dept.id=d.department_id
        ${draftWhereSql}
          AND d.status <> 'published'
        ORDER BY d.updated_at DESC, d.id DESC
        LIMIT 20
      `, params);
      const versions = await mysqlQuery(pool, `
        SELECT v.id, v.draft_id, v.document_id, v.document_no, v.document_title, v.edition,
               v.version_no, v.status, v.effective_at, v.published_at,
               dept.name AS department_name
        FROM process_design_versions v
        LEFT JOIN departments dept ON dept.id=v.department_id
        ${versionWhereSql}
        ORDER BY v.effective_at DESC, v.id DESC
        LIMIT 20
      `, versionParams);
      return { summary: { totalDrafts, publishedVersions: Number(publishedRow.count || 0), byStatus }, drafts, versions };
    },
    async departmentExists(departmentId) {
      if (!departmentId) return false;
      const [row] = await mysqlQuery(pool, 'SELECT id FROM departments WHERE id=?', [departmentId]);
      return Boolean(row);
    },
    getDraft,
    getDraftByTerm,
    getDraftByProcess,
    getDraftByStep,
    getDraftByHandoff,
    getHandoff,
    getDraftByForm,
    getDraftByFormTable,
    getDraftByFormTableField,
    getDraftByField,
    getDraftByEvidence,
    getDocumentById,
    loadDocumentProfile,
    loadTerms,
    loadProcesses,
    loadSteps,
    loadForms,
    loadEvidence,
    loadEvents,
    loadReviewTasks,
    buildRisks,
    getCounts,
    publishReadiness,
    publishValidationDetails,
    outcomeForDraft,
    detail: detailForDraft,
    async markdownForDraft(draftId) {
      const detail = await detailForDraft(draftId);
      if (!detail) return null;
      const draftTitle = text(detail.draft.document_title) || text(detail.documentProfile && detail.documentProfile.document_title) || text(detail.draft.process_name) || `process-design-${draftId}`;
      const documentNo = text(detail.draft.document_no) || text(detail.documentProfile && detail.documentProfile.document_no) || `draft-${draftId}`;
      const edition = text(detail.draft.planned_edition) || 'A';
      return {
        filename: `${markdownFileSafe(documentNo)}-${markdownFileSafe(draftTitle)}-${editionLabel(edition)}.md`,
        markdown: processDesignMarkdown(detail)
      };
    },
    async createDraft(body, actorUserId, targetDeptId, proxyDeptId) {
      const documentNo = text(body.document_no);
      const documentTitle = text(body.document_title) || text(body.process_name);
      let document = await getDocumentByNo(documentNo);
      if (document) {
        const activeDraft = await getActiveDraftForDocumentNo(documentNo);
        if (activeDraft) {
          throw httpError(409, '该制度编号已有进行中草稿', {
            error: '该制度编号已有进行中草稿',
            active_draft: activeDraft
          });
        }
        if (document.current_version_id) {
          throw httpError(409, '该制度编号已发布过，请创建下一版次草稿', {
            error: '该制度编号已发布过，请创建下一版次草稿',
            document,
            current_edition: document.current_edition,
            next_edition: nextEdition(document.current_edition)
          });
        }
      } else {
        const docResult = await mysqlRun(pool, `
          INSERT INTO process_design_documents
            (document_no, document_title, owning_department_id, status, created_by, updated_by)
          VALUES (?, ?, ?, 'active', ?, ?)
        `, [documentNo, documentTitle, targetDeptId, actorUserId, actorUserId]);
        document = await getDocumentById(docResult.insertId);
      }
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_drafts
          (document_id, document_no, document_title, planned_edition, base_version_id, active_document_no,
           process_name, reason, basis_type, basis_description, involves_other_departments,
           related_departments_json, department_id, proxy_department_id, proxy_reason,
           l1_name, l2_name, l3_name, l1_status, l2_status, created_by)
        VALUES (?, ?, ?, 'A', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        document.id, documentNo, documentTitle, documentNo,
        text(body.process_name), text(body.reason), text(body.basis_type), text(body.basis_description),
        boolInt(body.involves_other_departments), jsonArray(body.related_departments),
        targetDeptId, proxyDeptId || null, optionalText(body.proxy_reason),
        optionalText(body.l1_name), optionalText(body.l2_name), optionalText(body.l3_name),
        optionalText(body.l1_name) ? 'confirmed' : 'unclassified',
        optionalText(body.l2_name) ? 'confirmed' : 'unclassified',
        actorUserId
      ]);
      await addEvent(result.insertId, 'draft_created', actorUserId, '已创建制度结构草稿');
      const draft = await getDraft(result.insertId);
      return { ...draft, outcome: await outcomeForDraft(draft) };
    },
    async updateDraft(draft, body, actorUserId) {
      if (Object.prototype.hasOwnProperty.call(body, 'basis_type') && !BASIS_TYPES.has(text(body.basis_type))) {
        throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'basis_type', message: '依据类型必须从系统选项中选择' }] });
      }
      const allowed = {
        process_name: text,
        reason: text,
        basis_type: text,
        basis_description: text,
        l1_name: optionalText,
        l2_name: optionalText,
        l3_name: optionalText,
        proxy_reason: optionalText
      };
      const sets = [];
      const params = [];
      const changesDocumentIdentity = Object.prototype.hasOwnProperty.call(body, 'document_no')
        || Object.prototype.hasOwnProperty.call(body, 'document_title');
      if (changesDocumentIdentity) {
        if (draft.base_version_id) throw httpError(409, '下一版次草稿的制度编号和制度名称不可修改');
        const document = draft.document_id ? await getDocumentById(draft.document_id) : null;
        if (document && document.current_version_id) throw httpError(409, 'A版发布后制度编号和制度名称不可修改');
        const nextDocumentNo = text(body.document_no) || text(draft.document_no);
        const nextDocumentTitle = text(body.document_title) || text(draft.document_title) || text(body.process_name) || text(draft.process_name);
        const existingDocument = await getDocumentByNo(nextDocumentNo);
        if (existingDocument && Number(existingDocument.id) !== Number(draft.document_id)) {
          throw httpError(409, '该制度编号已存在', { error: '该制度编号已存在' });
        }
        if (draft.document_id) {
          await mysqlRun(pool, `
            UPDATE process_design_documents
            SET document_no=?, document_title=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
          `, [nextDocumentNo, nextDocumentTitle, actorUserId, draft.document_id]);
        }
        sets.push('document_no=?', 'document_title=?', 'active_document_no=?');
        params.push(nextDocumentNo, nextDocumentTitle, EDITABLE_DRAFT_STATUSES.has(draft.status || 'draft') ? nextDocumentNo : null);
        if (!Object.prototype.hasOwnProperty.call(body, 'process_name')) {
          sets.push('process_name=?');
          params.push(nextDocumentTitle);
        }
      }
      Object.entries(allowed).forEach(([field, normalizer]) => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(normalizer(body[field]));
        }
      });
      ['l1_status', 'l2_status'].forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          const status = text(body[field]) || 'unclassified';
          if (!CLASSIFICATION_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field, message: '能力层级状态无效' }] });
          sets.push(`${field}=?`);
          params.push(status);
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'involves_other_departments')) {
        sets.push('involves_other_departments=?');
        params.push(boolInt(body.involves_other_departments));
      }
      if (Object.prototype.hasOwnProperty.call(body, 'related_departments')) {
        sets.push('related_departments_json=?');
        params.push(jsonArray(body.related_departments));
      }
      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        const status = text(body.status);
        if (!DRAFT_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'status', message: '草稿状态无效' }] });
        sets.push('status=?');
        params.push(status);
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_drafts SET ${sets.join(', ')} WHERE id=?`, [...params, draft.id]);
        await addEvent(draft.id, 'draft_updated', actorUserId, '已更新制度结构草稿');
      }
      const updated = await getDraft(draft.id);
      return { ...updated, outcome: await outcomeForDraft(updated) };
    },
    async deleteDraft(draft) {
      await mysqlRun(pool, 'DELETE FROM process_design_drafts WHERE id=?', [draft.id]);
      if (draft.document_id && !draft.base_version_id) {
        const document = await getDocumentById(draft.document_id);
        if (document && !document.current_version_id) {
          await mysqlRun(pool, 'DELETE FROM process_design_documents WHERE id=?', [draft.document_id]);
        }
      }
      return { deleted: true, id: Number(draft.id) };
    },
    async saveDocumentProfile(draft, body, actorUserId) {
      await mysqlRun(pool, `
        INSERT INTO process_design_document_profiles
          (draft_id, document_title, document_no, purpose, scope, inheritance_relation, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          document_title=VALUES(document_title),
          document_no=VALUES(document_no),
          purpose=VALUES(purpose),
          scope=VALUES(scope),
          inheritance_relation=VALUES(inheritance_relation),
          updated_at=CURRENT_TIMESTAMP
      `, [
        draft.id, text(draft.document_title) || text(body.document_title), text(draft.document_no) || text(body.document_no), text(body.purpose),
        text(body.scope), optionalText(body.inheritance_relation), actorUserId
      ]);
      await addEvent(draft.id, 'document_profile_saved', actorUserId, '已保存制度说明');
      return await loadDocumentProfile(draft.id);
    },
    async createTerm(draft, body, actorUserId) {
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_terms WHERE draft_id=?', [draft.id]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_terms
          (draft_id, term_name, definition, applies_to, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        draft.id, text(body.term_name), text(body.definition), optionalText(body.applies_to),
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'term_added', actorUserId, `已补充术语：${text(body.term_name)}`, objectEventPayload('term', result.insertId, text(body.term_name), 'added'));
      return await getById('process_design_terms', result.insertId);
    },
    async updateTerm(draft, termId, body, actorUserId) {
      const current = await getById('process_design_terms', termId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '术语不存在');
      await mysqlRun(pool, `
        UPDATE process_design_terms
        SET term_name=?, definition=?, applies_to=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [text(body.term_name), text(body.definition), optionalText(body.applies_to), termId]);
      await addEvent(draft.id, 'term_updated', actorUserId, `已修改术语：${text(body.term_name)}`, objectEventPayload('term', termId, text(body.term_name), 'updated'));
      return await getById('process_design_terms', termId);
    },
    async deleteTerm(draft, termId, actorUserId) {
      const current = await getById('process_design_terms', termId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '术语不存在');
      await mysqlRun(pool, 'DELETE FROM process_design_terms WHERE id=?', [termId]);
      await addEvent(draft.id, 'term_deleted', actorUserId, `已删除术语：${text(current.term_name)}`, objectEventPayload('term', termId, text(current.term_name), 'deleted'));
      return { deleted: true, id: Number(termId) };
    },
    async createProcess(draft, body, actorUserId) {
      const processType = PROCESS_TYPES.has(text(body.process_type)) ? text(body.process_type) : 'new';
      const l1Name = text(body.l1_name) || text(draft.l1_name);
      const l2Name = text(body.l2_name) || text(draft.l2_name);
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_processes WHERE draft_id=?', [draft.id]);
      const procedureCode = await nextProcedureCode(draft.id);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_processes
          (draft_id, process_code, process_type, l1_name, l2_name, l3_name, description, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, procedureCode, processType,
        l1Name, l2Name, text(body.l3_name),
        optionalText(body.description), body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'process_added', actorUserId, `已补充流程：${text(body.l3_name)}`, objectEventPayload('process', result.insertId, text(body.l3_name), 'added'));
      return await getById('process_design_processes', result.insertId);
    },
    async updateProcess(draft, processId, body, actorUserId) {
      const current = await getById('process_design_processes', processId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '流程不存在');
      const processType = PROCESS_TYPES.has(text(body.process_type)) ? text(body.process_type) : 'new';
      const l1Name = text(body.l1_name) || text(draft.l1_name);
      const l2Name = text(body.l2_name) || text(draft.l2_name);
      await mysqlRun(pool, `
        UPDATE process_design_processes
        SET process_type=?, l1_name=?, l2_name=?, l3_name=?, description=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [
        processType, l1Name, l2Name, text(body.l3_name),
        optionalText(body.description), processId
      ]);
      await addEvent(draft.id, 'process_updated', actorUserId, `已修改流程：${text(body.l3_name)}`, objectEventPayload('process', processId, text(body.l3_name), 'updated'));
      return await getById('process_design_processes', processId);
    },
    async deleteProcess(draft, processId, actorUserId) {
      const current = await getById('process_design_processes', processId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '流程不存在');
      const [stepCount] = await mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_steps WHERE process_id=?', [processId]);
      if (Number(stepCount.count || 0) > 0) {
        throw httpError(409, '这个流程下面还有业务行为，不能直接删除。请先把这些行为改到其它流程，或逐条处理这些行为。');
      }
      await mysqlRun(pool, 'DELETE FROM process_design_processes WHERE id=?', [processId]);
      await addEvent(draft.id, 'process_deleted', actorUserId, `已删除流程：${text(current.l3_name)}`, objectEventPayload('process', processId, text(current.l3_name), 'deleted'));
      return { deleted: true, id: Number(processId) };
    },
    async createStep(draft, body, actorUserId) {
      const processId = Number(body.process_id || 0);
      const [processRow] = await mysqlQuery(pool, 'SELECT id FROM process_design_processes WHERE id=? AND draft_id=?', [processId, draft.id]);
      if (!processRow) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'process_id', message: '业务行为必须归属一个制度流程' }] });
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_steps WHERE draft_id=? AND process_id=?', [draft.id, processId]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_steps
          (draft_id, process_id, step_name, actor_role, timing, input_materials, output_result, need_confirmation,
           related_departments, basis, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, processId, text(body.step_name), optionalText(body.actor_role), optionalText(body.timing),
        optionalText(body.input_materials), optionalText(body.output_result), boolInt(body.need_confirmation),
        optionalText(body.related_departments), optionalText(body.basis),
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'step_added', actorUserId, `已补充步骤：${text(body.step_name)}`, objectEventPayload('step', result.insertId, text(body.step_name), 'added'));
      return await getById('process_design_steps', result.insertId);
    },
    async updateStep(draft, stepId, body, actorUserId) {
      const current = await getById('process_design_steps', stepId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '业务行为不存在');
      if ((current.status || 'active') === 'voided') throw httpError(409, '已作废业务行为不能直接修改');
      const fields = ['step_name', 'actor_role', 'timing', 'input_materials', 'output_result', 'related_departments', 'basis'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'step_name' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'process_id')) {
        const processId = Number(body.process_id || 0);
        const [processRow] = await mysqlQuery(pool, 'SELECT id FROM process_design_processes WHERE id=? AND draft_id=?', [processId, draft.id]);
        if (!processRow) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'process_id', message: '业务行为必须归属同一制度草稿下的流程' }] });
        sets.push('process_id=?');
        params.push(processId);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'need_confirmation')) {
        sets.push('need_confirmation=?');
        params.push(boolInt(body.need_confirmation));
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_steps SET ${sets.join(', ')} WHERE id=?`, [...params, stepId]);
        await addEvent(draft.id, 'step_updated', actorUserId, `已修改业务行为：${text(body.step_name) || text(current.step_name)}`, objectEventPayload('step', stepId, text(body.step_name) || text(current.step_name), 'updated'));
      }
      return await getById('process_design_steps', stepId);
    },
    async saveBehaviorDetail(draft, stepId, body, actorUserId) {
      const step = await getById('process_design_steps', stepId);
      if (!step || Number(step.draft_id) !== Number(draft.id)) throw httpError(404, '业务行为不存在');
      if ((step.status || 'active') === 'voided') throw httpError(409, '已作废业务行为不能直接修改');
      const existing = await loadBehaviorDetail(stepId);
      if (existing && existing.is_cross_department && !boolInt(body.is_cross_department)) {
        const [handoffCount] = await mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_cross_dept_handoffs WHERE step_id=?', [stepId]);
        if (Number(handoffCount.count || 0) > 0) throw httpError(409, '已经存在跨部门承接记录，不能改为非跨部门');
      }
      await mysqlRun(pool, `
        INSERT INTO process_design_behavior_details
          (step_id, precondition, trigger_scene, execution_standard, delivery_object,
           requires_approval, approval_note, is_cross_department, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          precondition=VALUES(precondition),
          trigger_scene=VALUES(trigger_scene),
          execution_standard=VALUES(execution_standard),
          delivery_object=VALUES(delivery_object),
          requires_approval=VALUES(requires_approval),
          approval_note=VALUES(approval_note),
          is_cross_department=VALUES(is_cross_department),
          updated_at=CURRENT_TIMESTAMP
      `, [
        stepId, optionalText(body.precondition), optionalText(body.trigger_scene),
        optionalText(body.execution_standard), optionalText(body.delivery_object),
        boolInt(body.requires_approval), optionalText(body.approval_note),
        boolInt(body.is_cross_department), actorUserId
      ]);
      await addEvent(draft.id, 'step_updated', actorUserId, `已保存业务行为详情：${text(step.step_name)}`, objectEventPayload('step', stepId, text(step.step_name), 'updated'));
      return await loadBehaviorDetail(stepId);
    },
    async deleteStep(draft, stepId, options = {}) {
      const current = await getById('process_design_steps', stepId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '业务行为不存在');
      const [handoffCount] = await mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_cross_dept_handoffs WHERE step_id=?', [stepId]);
      const [formCount] = await mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_forms WHERE step_id=?', [stepId]);
      const detail = await loadBehaviorDetail(stepId);
      const hasDependency = Number(handoffCount.count || 0) > 0 || Number(formCount.count || 0) > 0 || behaviorDetailHasContent(detail);
      if (options.mode === 'delete') {
        if (hasDependency) throw httpError(409, '这个业务行为已有跨部门承接、关联表单或行为详情，不能物理删除，请作废。');
        await mysqlRun(pool, 'DELETE FROM process_design_steps WHERE id=?', [stepId]);
        await addEvent(draft.id, 'step_deleted', options.actorUserId, `已删除业务行为：${text(current.step_name)}`, objectEventPayload('step', stepId, text(current.step_name), 'deleted'));
        return { deleted: true, id: Number(stepId) };
      }
      if ((current.status || 'active') !== 'voided') {
        await mysqlRun(pool, `
          UPDATE process_design_steps
          SET status='voided', void_reason=?, voided_by=?, voided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [optionalText(options.reason) || '由维护人作废', options.actorUserId || null, stepId]);
        await addEvent(draft.id, 'step_voided', options.actorUserId, `已作废业务行为：${text(current.step_name)}`, objectEventPayload('step', stepId, text(current.step_name), 'voided'));
      }
      return await getById('process_design_steps', stepId);
    },
    async createHandoff(draft, stepId, body, actorUserId) {
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_cross_dept_handoffs WHERE step_id=?', [stepId]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_cross_dept_handoffs
          (step_id, target_department, target_process_code, target_process_name,
           target_behavior_code, target_behavior_name, handoff_standard, status, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        stepId, text(body.target_department), null, null, null, null,
        optionalText(body.handoff_standard), 'pending_return',
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'cross_dept_handoff_requested', actorUserId, `已发起跨部门承接：${text(body.target_department)}`);
      return await getById('process_design_cross_dept_handoffs', result.insertId);
    },
    async acceptHandoffReturn(draft, handoffId, body, actorUserId) {
      await mysqlRun(pool, `
        UPDATE process_design_cross_dept_handoffs
        SET target_process_code=?, target_process_name=?, target_behavior_code=?, target_behavior_name=?,
            status='returned', returned_by=?, returned_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [
        optionalText(body.target_process_code), text(body.target_process_name),
        optionalText(body.target_behavior_code), text(body.target_behavior_name),
        actorUserId, handoffId
      ]);
      await addEvent(draft.id, 'cross_dept_handoff_returned', actorUserId, `承接部门已回写：${text(body.target_process_name)} / ${text(body.target_behavior_name)}`);
      return await getById('process_design_cross_dept_handoffs', handoffId);
    },
    async updateHandoff(draft, handoffId, body, actorUserId) {
      const fields = ['target_department', 'target_process_code', 'target_process_name', 'target_behavior_code', 'target_behavior_name', 'handoff_standard'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'target_department' || field === 'target_process_name' || field === 'target_behavior_name' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        const status = text(body.status);
        if (!HANDOFF_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'status', message: '承接状态无效' }] });
        sets.push('status=?');
        params.push(status);
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_cross_dept_handoffs SET ${sets.join(', ')} WHERE id=?`, [...params, handoffId]);
        await addEvent(draft.id, 'cross_dept_handoff_updated', actorUserId, '已更新跨部门承接');
      }
      return await getById('process_design_cross_dept_handoffs', handoffId);
    },
    async nextFormCode(draft) {
      const rows = await mysqlQuery(pool, 'SELECT form_code FROM process_design_forms WHERE draft_id=?', [draft.id]);
      const maxSequence = rows.reduce((max, row) => Math.max(max, parseFormSequence(row.form_code, draft)), 0);
      return formatFormCode(draft, maxSequence + 1);
    },
    async archiveDepartmentName(departmentId) {
      if (!departmentId) return null;
      const department = await getById('departments', Number(departmentId));
      return department && department.name || null;
    },
    async assertFormStep(draft, stepId) {
      const [step] = await mysqlQuery(pool, 'SELECT id, status FROM process_design_steps WHERE id=? AND draft_id=?', [Number(stepId), draft.id]);
      if (!step) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'step_id', message: '表单必须指向本制度草稿内的业务行为' }] });
      if ((step.status || 'active') !== 'active') throw httpError(409, '关联业务行为已作废，请先改挂表单');
      return step;
    },
    async ensureMainFormTable(form, actorUserId) {
      const [existing] = await mysqlQuery(pool, "SELECT * FROM process_design_form_tables WHERE form_id=? AND table_kind='main' ORDER BY id LIMIT 1", [form.id]);
      if (existing) return existing;
      const mainTableCode = text(form.main_table_code) || formatFormStructureCode(form.form_code, 'main');
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_form_tables
          (form_id, table_kind, table_no, table_code, table_name, description, sort_order, created_by)
        VALUES (?, 'main', ?, ?, ?, NULL, 1, ?)
      `, [form.id, mainTableCode, mainTableCode, text(form.main_table_name) || '主表', actorUserId || form.created_by || null]);
      return await getById('process_design_form_tables', result.insertId);
    },
    async nextFieldCode(table, structureKind) {
      const structureCode = text(table.table_code) || text(table.table_no) || formatFormStructureCode('FM-UNSET-001-A', structureKind);
      const rows = await mysqlQuery(pool, 'SELECT field_code FROM process_design_form_table_fields WHERE form_table_id=? AND structure_kind=?', [table.id, structureKind]);
      const maxSequence = rows.reduce((max, row) => Math.max(max, parseFieldSequence(row.field_code, structureCode)), 0);
      return formatFieldCode(structureCode, maxSequence + 1);
    },
    async createForm(draft, body, actorUserId) {
      const stepId = body.step_id ? Number(body.step_id) : null;
      if (!stepId) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'step_id', message: '表单必须指向业务行为' }] });
      await this.assertFormStep(draft, stepId);
      assertNoManualNumber(body || {}, 'form_code', '表单编号');
      if (Object.prototype.hasOwnProperty.call(body || {}, 'archive_location')) assertEnum(body || {}, 'archive_location', ARCHIVE_LOCATIONS, '归档位置', { optional: true });
      if (Object.prototype.hasOwnProperty.call(body || {}, 'retention_period')) assertEnum(body || {}, 'retention_period', RETENTION_PERIODS, '留存周期', { optional: true });
      const formCode = await this.nextFormCode(draft);
      const mainTableCode = formatFormStructureCode(formCode, 'main');
      const responsibleDepartmentId = body.responsible_department_id ? Number(body.responsible_department_id) : null;
      const responsibleDepartmentName = optionalText(body.responsible_department_name) || await this.archiveDepartmentName(responsibleDepartmentId);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_forms
          (draft_id, step_id, form_code, form_name, main_table_code, main_table_name,
           archive_location, retention_period, responsible_department_id, responsible_department_name,
           responsible_role, description, archive_rule, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `, [
        draft.id, stepId, formCode, text(body.form_name), mainTableCode,
        text(body.main_table_name) || '主表', optionalText(body.archive_location),
        optionalText(body.retention_period), responsibleDepartmentId, responsibleDepartmentName,
        optionalText(body.responsible_role), actorUserId
      ]);
      await this.ensureMainFormTable(await getById('process_design_forms', result.insertId), actorUserId);
      await addEvent(draft.id, 'form_added', actorUserId, `已补充在线表单：${text(body.form_name)}`);
      return await getById('process_design_forms', result.insertId);
    },
    async updateForm(draft, formId, body, actorUserId) {
      const fields = ['form_name', 'main_table_name', 'archive_location', 'retention_period', 'responsible_role', 'status'];
      const sets = [];
      const params = [];
      if (Object.prototype.hasOwnProperty.call(body || {}, 'form_code')) assertNoManualNumber(body || {}, 'form_code', '表单编号');
      if (Object.prototype.hasOwnProperty.call(body || {}, 'archive_location')) assertEnum(body || {}, 'archive_location', ARCHIVE_LOCATIONS, '归档位置', { optional: true });
      if (Object.prototype.hasOwnProperty.call(body || {}, 'retention_period')) assertEnum(body || {}, 'retention_period', RETENTION_PERIODS, '留存周期', { optional: true });
      if (Object.prototype.hasOwnProperty.call(body || {}, 'step_id')) {
        const stepId = Number(body.step_id || 0);
        await this.assertFormStep(draft, stepId);
        sets.push('step_id=?');
        params.push(stepId);
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, 'responsible_department_id')) {
        const responsibleDepartmentId = body.responsible_department_id ? Number(body.responsible_department_id) : null;
        sets.push('responsible_department_id=?');
        params.push(responsibleDepartmentId);
        sets.push('responsible_department_name=?');
        params.push(optionalText(body.responsible_department_name) || await this.archiveDepartmentName(responsibleDepartmentId));
      }
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'form_name' || field === 'main_table_name' || field === 'status' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_forms SET ${sets.join(', ')} WHERE id=?`, [...params, formId]);
        const form = await getById('process_design_forms', formId);
        const [mainTable] = await mysqlQuery(pool, "SELECT id FROM process_design_form_tables WHERE form_id=? AND table_kind='main' ORDER BY id LIMIT 1", [formId]);
        if (mainTable && Object.prototype.hasOwnProperty.call(body || {}, 'main_table_name')) {
          await mysqlRun(pool, 'UPDATE process_design_form_tables SET table_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [text(body.main_table_name) || '主表', mainTable.id]);
        } else if (!mainTable && form) {
          await this.ensureMainFormTable(form, actorUserId);
        }
        await addEvent(draft.id, 'form_updated', actorUserId, '已更新在线表单');
      }
      return await getById('process_design_forms', formId);
    },
    async createFormTable(draft, formId, body, actorUserId) {
      const form = await getById('process_design_forms', formId);
      if (!form || Number(form.draft_id) !== Number(draft.id)) throw httpError(404, '表单不存在');
      const [existing] = await mysqlQuery(pool, "SELECT id FROM process_design_form_tables WHERE form_id=? AND table_kind='detail' LIMIT 1", [formId]);
      if (existing) throw httpError(409, '一个表单只能创建一个明细表');
      assertNoManualNumber(body || {}, 'table_code', '表编号');
      const tableCode = formatFormStructureCode(form.form_code, 'detail');
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_form_tables
          (form_id, table_kind, table_no, table_code, table_name, description, sort_order, created_by)
        VALUES (?, 'detail', ?, ?, ?, NULL, 2, ?)
      `, [formId, tableCode, tableCode, text(body.table_name), actorUserId]);
      await addEvent(draft.id, 'form_table_added', actorUserId, `已补充明细表：${text(body.table_name)}`);
      return await getById('process_design_form_tables', result.insertId);
    },
    async updateFormTable(draft, tableId, body, actorUserId) {
      assertNoManualNumber(body || {}, 'table_no', '表编号');
      assertNoManualNumber(body || {}, 'table_code', '表编号');
      const fields = ['table_name'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(text(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'table_kind') && text(body.table_kind) && text(body.table_kind) !== 'detail') {
        throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'table_kind', message: '当前只允许维护明细表' }] });
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_form_tables SET ${sets.join(', ')} WHERE id=?`, [...params, tableId]);
        await addEvent(draft.id, 'form_table_updated', actorUserId, '已更新明细表结构');
      }
      return await getById('process_design_form_tables', tableId);
    },
    async createFormTableField(draft, tableId, body, actorUserId) {
      const structureKind = text(body.structure_kind) === 'main' ? 'main' : 'detail';
      let table = null;
      if (structureKind === 'main') {
        const form = await getById('process_design_forms', tableId);
        if (!form || Number(form.draft_id) !== Number(draft.id)) throw httpError(404, '表单不存在');
        table = await this.ensureMainFormTable(form, actorUserId);
      } else {
        table = await getById('process_design_form_tables', tableId);
        if (!table || text(table.table_kind) !== 'detail') throw httpError(404, '明细表不存在，请先创建明细表');
        const form = await getById('process_design_forms', table.form_id);
        if (!form || Number(form.draft_id) !== Number(draft.id)) throw httpError(404, '表单不存在');
      }
      if (text(body.field_type) === '枚举' && !text(body.enum_options)) {
        throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'enum_options', message: '枚举字段需要填写选项' }] });
      }
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_form_table_fields WHERE form_table_id=? AND structure_kind=?', [table.id, structureKind]);
      const fieldCode = await this.nextFieldCode(table, structureKind);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_form_table_fields
          (form_table_id, structure_kind, field_no, field_code, field_name, field_type, enum_options, is_required, description, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        table.id, structureKind, fieldCode, fieldCode, text(body.field_name), text(body.field_type),
        optionalText(body.enum_options), boolInt(body.required), optionalText(body.description),
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'form_table_field_added', actorUserId, `已补充表单字段：${text(body.field_name)}`);
      return publicFormTableField(await getById('process_design_form_table_fields', result.insertId));
    },
    async updateFormTableField(draft, fieldId, body, actorUserId) {
      assertNoManualNumber(body || {}, 'field_no', '字段编号');
      assertNoManualNumber(body || {}, 'field_code', '字段编号');
      assertNoWhitespaceFields(body || {}, ['field_name']);
      if (Object.prototype.hasOwnProperty.call(body || {}, 'field_type')) assertEnum(body || {}, 'field_type', FIELD_TYPES, '字段类型');
      const current = await getById('process_design_form_table_fields', fieldId);
      if (!current) throw httpError(404, '字段不存在');
      const mergedFieldType = Object.prototype.hasOwnProperty.call(body || {}, 'field_type') ? text(body.field_type) : text(current.field_type);
      const mergedEnumOptions = Object.prototype.hasOwnProperty.call(body || {}, 'enum_options') ? text(body.enum_options) : text(current.enum_options);
      if (mergedFieldType === '枚举' && !mergedEnumOptions) {
        throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'enum_options', message: '枚举字段需要填写选项' }] });
      }
      const fields = ['field_name', 'field_type', 'description', 'enum_options'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'field_name' || field === 'field_type' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'required')) {
        sets.push('is_required=?');
        params.push(boolInt(body.required));
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_form_table_fields SET ${sets.join(', ')} WHERE id=?`, [...params, fieldId]);
        await addEvent(draft.id, 'form_table_field_updated', actorUserId, '已更新表单字段');
      }
      return publicFormTableField(await getById('process_design_form_table_fields', fieldId));
    },
    async deleteForm(draft, formId, actorUserId) {
      await mysqlRun(pool, 'DELETE FROM process_design_forms WHERE id=? AND draft_id=?', [Number(formId), draft.id]);
      await addEvent(draft.id, 'form_deleted', actorUserId, '已删除在线表单');
      return { deleted: true, id: Number(formId) };
    },
    async deleteFormTable(draft, tableId, actorUserId) {
      const table = await getById('process_design_form_tables', tableId);
      if (!table) throw httpError(404, '明细表不存在');
      if (table.table_kind !== 'detail') throw httpError(409, '主表结构不能删除');
      await mysqlRun(pool, 'DELETE FROM process_design_form_tables WHERE id=?', [Number(tableId)]);
      await addEvent(draft.id, 'form_table_deleted', actorUserId, '已删除明细表');
      return { deleted: true, id: Number(tableId) };
    },
    async deleteFormTableField(draft, fieldId, actorUserId) {
      await mysqlRun(pool, 'DELETE FROM process_design_form_table_fields WHERE id=?', [Number(fieldId)]);
      await addEvent(draft.id, 'form_table_field_deleted', actorUserId, '已删除表单字段');
      return { deleted: true, id: Number(fieldId) };
    },
    async moveFormTableField(draft, fieldId, direction, actorUserId) {
      const current = await getById('process_design_form_table_fields', fieldId);
      if (!current) throw httpError(404, '字段不存在');
      const table = await getById('process_design_form_tables', current.form_table_id);
      if (!table) throw httpError(404, '表结构不存在');
      const form = await getById('process_design_forms', table.form_id);
      if (!form || Number(form.draft_id) !== Number(draft.id)) throw httpError(404, '表单不存在');
      const rows = await mysqlQuery(
        'SELECT id, sort_order FROM process_design_form_table_fields WHERE form_table_id=? AND structure_kind=? ORDER BY sort_order, id',
        [current.form_table_id, current.structure_kind]
      );
      for (let index = 0; index < rows.length; index += 1) {
        const nextOrder = index + 1;
        if (Number(rows[index].sort_order || 0) !== nextOrder) {
          await mysqlRun(pool, 'UPDATE process_design_form_table_fields SET sort_order=? WHERE id=?', [nextOrder, rows[index].id]);
          rows[index].sort_order = nextOrder;
        }
      }
      const currentIndex = rows.findIndex(row => Number(row.id) === Number(fieldId));
      const targetIndex = direction === 'down' ? currentIndex + 1 : currentIndex - 1;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= rows.length) {
        return publicFormTableField(await getById('process_design_form_table_fields', fieldId));
      }
      await mysqlRun(pool, 'UPDATE process_design_form_table_fields SET sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [targetIndex + 1, rows[currentIndex].id]);
      await mysqlRun(pool, 'UPDATE process_design_form_table_fields SET sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [currentIndex + 1, rows[targetIndex].id]);
      await addEvent(draft.id, 'form_table_field_updated', actorUserId, '已调整表单字段顺序');
      return publicFormTableField(await getById('process_design_form_table_fields', fieldId));
    },
    async createField(draft, formId, body, actorUserId) {
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_form_fields WHERE form_id=?', [formId]);
      const status = FIELD_STATUSES.has(text(body.status)) ? text(body.status) : 'suggested';
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_form_fields
          (form_id, field_name_cn, field_name_en, data_object, field_type, enum_options,
           evidence_note, status, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        formId, text(body.field_name_cn), optionalText(body.field_name_en), optionalText(body.data_object),
        optionalText(body.field_type), optionalText(body.enum_options), optionalText(body.evidence_note),
        status, body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'field_added', actorUserId, `已补充字段：${text(body.field_name_cn)}`);
      return await getById('process_design_form_fields', result.insertId);
    },
    async updateField(draft, fieldId, body, actorUserId) {
      assertNoWhitespaceFields(body || {}, ['field_name_cn', 'field_name_en', 'data_object']);
      if (Object.prototype.hasOwnProperty.call(body || {}, 'field_type')) assertEnum(body || {}, 'field_type', FIELD_TYPES, '字段类型');
      const fields = ['field_name_cn', 'field_name_en', 'data_object', 'field_type', 'enum_options', 'evidence_note'];
      const sets = [];
      const params = [];
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'field_name_cn' ? text(body[field]) : optionalText(body[field]));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        const status = text(body.status);
        if (!FIELD_STATUSES.has(status)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'status', message: '字段状态无效' }] });
        sets.push('status=?');
        params.push(status);
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_form_fields SET ${sets.join(', ')} WHERE id=?`, [...params, fieldId]);
        await addEvent(draft.id, 'field_updated', actorUserId, '已更新字段草稿');
      }
      return await getById('process_design_form_fields', fieldId);
    },
    async createEvidence(draft, body, actorUserId) {
      const maturity = evidenceMaturity(body);
      const objectType = ['process', 'step', 'form', 'field'].includes(text(body.object_type)) ? text(body.object_type) : 'process';
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_evidence
          (draft_id, object_type, object_id, evidence_type, description, source_name, source_anchor,
           confirmer, record_time, missing_reason, expected_provider, expected_at, maturity, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, objectType, body.object_id ? Number(body.object_id) : draft.id,
        text(body.evidence_type), text(body.description), optionalText(body.source_name),
        optionalText(body.source_anchor), optionalText(body.confirmer), optionalText(body.record_time),
        optionalText(body.missing_reason), optionalText(body.expected_provider), optionalText(body.expected_at),
        maturity, 'pending_review', actorUserId
      ]);
      await addEvent(draft.id, 'evidence_added', actorUserId, `已补充证据说明：${text(body.evidence_type)}`);
      return await getById('process_design_evidence', result.insertId);
    },
    async updateEvidence(draft, evidenceId, body, actorUserId) {
      if (Object.prototype.hasOwnProperty.call(body || {}, 'evidence_type')) assertEnum(body || {}, 'evidence_type', EVIDENCE_TYPES, '证据类型');
      const current = await getById('process_design_evidence', evidenceId);
      if (!current) throw httpError(404, '证据不存在');
      const merged = { ...current, ...(body || {}) };
      const fields = ['object_type', 'object_id', 'evidence_type', 'description', 'source_name', 'source_anchor', 'confirmer', 'record_time', 'missing_reason', 'expected_provider', 'expected_at'];
      const sets = [];
      const params = [];
      let nextStatus = null;
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          sets.push(`${field}=?`);
          params.push(field === 'object_id' ? (body[field] ? Number(body[field]) : null) : (field === 'object_type' || field === 'evidence_type' || field === 'description' ? text(body[field]) : optionalText(body[field])));
        }
      });
      if (Object.prototype.hasOwnProperty.call(body || {}, 'status')) {
        nextStatus = text(body.status);
        if (!EVIDENCE_STATUSES.has(nextStatus)) {
          throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'status', message: '证据状态无效' }] });
        }
        sets.push('status=?');
        params.push(nextStatus);
      }
      sets.push('maturity=?');
      params.push(evidenceMaturity(merged));
      sets.push('updated_at=CURRENT_TIMESTAMP');
      await mysqlRun(pool, `UPDATE process_design_evidence SET ${sets.join(', ')} WHERE id=?`, [...params, evidenceId]);
      await addEvent(draft.id, 'evidence_updated', actorUserId, '已更新证据说明');
      if (nextStatus && nextStatus !== current.status) {
        await addEvent(draft.id, 'evidence_status_change', actorUserId, '已更新证据核验状态', {
          from_status: current.status || 'pending_review',
          to_status: nextStatus
        });
      }
      return await getById('process_design_evidence', evidenceId);
    },
    async submitDraft(draft, note, actorUserId) {
      await mysqlRun(pool, `
        UPDATE process_design_drafts
        SET status='submitted', submitted_by=?, submitted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [actorUserId, draft.id]);
      const taskResult = await mysqlRun(pool, `
        INSERT INTO process_design_review_tasks (draft_id, task_type, assignee_role, created_by)
        VALUES (?, 'department_review', 'reviewer', ?)
      `, [draft.id, actorUserId]);
      await addEvent(draft.id, 'submitted', actorUserId, optionalText(note) || '已提交审核');
      const updated = await getDraft(draft.id);
      return {
        draft: updated,
        reviewTask: await getById('process_design_review_tasks', taskResult.insertId),
        outcome: await outcomeForDraft(updated)
      };
    },
    async getReviewTask(taskId) {
      return await getById('process_design_review_tasks', taskId);
    },
    async decideReviewTask(task, decision, note, actorUserId) {
      const statusByDecision = { approve: 'approved', reject: 'rejected', needs_changes: 'needs_changes' };
      const nextStatus = statusByDecision[decision];
      await mysqlRun(pool, `
        UPDATE process_design_review_tasks
        SET status=?, decision_note=?, decided_by=?, decided_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [nextStatus, optionalText(note), actorUserId, task.id]);
      await mysqlRun(pool, 'UPDATE process_design_drafts SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [nextStatus, task.draft_id]);
      await addEvent(task.draft_id, `review_${decision}`, actorUserId, optionalText(note) || '已处理审核任务');
      return { draft: await getDraft(task.draft_id), reviewTask: await getById('process_design_review_tasks', task.id) };
    },
    async publishDraft(draft, note, actorUserId, options = {}) {
      if (pool && typeof pool.getConnection === 'function' && !options.__tx) {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const txRepo = makeProcessDesignMysqlRepository(connection);
          const txDraft = await txRepo.getDraft(draft.id);
          const result = await txRepo.publishDraft(txDraft || draft, note, actorUserId, { ...options, __tx: true });
          await connection.commit();
          return result;
        } catch (error) {
          await connection.rollback().catch(() => {});
          throw error;
        } finally {
          connection.release();
        }
      }
      const details = await publishValidationDetails(draft);
      if (details.length) {
        throw httpError(details.includes(VERIFIED_EVIDENCE_MESSAGE) ? 409 : 422, '校验失败', { error: '校验失败', details });
      }
      if (draft.base_version_id && !options.confirm_complete_rewrite) {
        throw httpError(409, '发布下一版次前请确认新版已完整重写', {
          error: '发布下一版次前请确认新版已完整重写',
          edition_diff: await editionDiffForDraft(draft)
        });
      }
      const readiness = await publishReadiness(draft);
      const document = draft.document_id ? await getDocumentById(draft.document_id) : null;
      if (!document) throw httpError(409, '制度主档不存在，不能发布');
      const currentVersion = await getCurrentVersionForDocument(document.id);
      const expectedEdition = currentVersion ? nextEdition(currentVersion.edition) : 'A';
      const plannedEdition = text(draft.planned_edition) || expectedEdition;
      if (plannedEdition !== expectedEdition) {
        throw httpError(409, '制度版次不连续，不能跳号', {
          error: '制度版次不连续，不能跳号',
          expected_edition: expectedEdition,
          planned_edition: plannedEdition
        });
      }
      if (currentVersion && Number(draft.base_version_id || 0) !== Number(currentVersion.id)) {
        throw httpError(409, '当前有效版次已变化，请重新创建下一版次草稿');
      }
      const versionNo = documentVersionNo(draft.document_no, plannedEdition);
      const content = await versionContent(draft);
      content.version_status = 'published';
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_versions
          (draft_id, document_id, document_no, document_title, edition, version_no,
           department_id, l1_name, l2_name, l3_name, content_json, published_by,
           effective_at, supersedes_version_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'published')
      `, [
        draft.id, document.id, draft.document_no, draft.document_title || draft.process_name,
        plannedEdition, versionNo, draft.department_id, draft.l1_name || '', draft.l2_name || '', draft.l3_name || '',
        JSON.stringify(content), actorUserId, currentVersion && currentVersion.id || null
      ]);
      if (currentVersion) {
        await mysqlRun(pool, "UPDATE process_design_versions SET status='superseded' WHERE id=?", [currentVersion.id]);
        await archiveSupersededProjection(currentVersion.id);
      }
      await mysqlRun(pool, `
        UPDATE process_design_drafts
        SET status='published', active_document_no=NULL, published_by=?, published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [actorUserId, draft.id]);
      await mysqlRun(pool, `
        UPDATE process_design_documents
        SET document_title=?, current_edition=?, current_version_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [draft.document_title || draft.process_name, plannedEdition, result.insertId, actorUserId, document.id]);
      const version = await getById('process_design_versions', result.insertId);
      await projectPublishedVersionToProcessMap(await getDraft(draft.id), version);
      await addEvent(draft.id, 'publish', actorUserId, optionalText(note) || '已发布流程版本', {
        version_no: versionNo,
        document_no: draft.document_no,
        document_title: draft.document_title || draft.process_name,
        edition: plannedEdition,
        supersedes_version_id: currentVersion && currentVersion.id || null,
        verified_evidence_count: readiness.verifiedEvidenceCount,
        l1l2l3_confirmed: readiness.processesConfirmed,
        step_count: readiness.stepCount
      });
      const publishedDraft = await getDraft(draft.id);
      return { draft: publishedDraft, version, outcome: await outcomeForDraft(publishedDraft) };
    }
  };
}

function evidenceMaturity(payload) {
  const evidenceType = text(payload.evidence_type);
  const description = text(payload.description);
  if (evidenceType === '暂无证据') {
    return text(payload.missing_reason) && text(payload.expected_provider) && text(payload.expected_at)
      ? '发布前需补'
      : '可保存草稿';
  }
  if (!evidenceType || !description) return '可保存草稿';
  if (!text(payload.source_name) && !text(payload.source_anchor)) return '可提交审核';
  if (text(payload.source_name) && text(payload.source_anchor) && (text(payload.confirmer) || text(payload.record_time))) {
    return '可支撑发布';
  }
  return '发布前需补';
}

async function repository() {
  if (repositoryFactory) return await repositoryFactory();
  if (!repositoryPromise) {
    repositoryPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      await ensureProcessDesignEditionSchema(pool);
      await ensureProcessDesignEvidenceStatusSchema(pool);
      await ensureProcessDesignFormStructureSchema(pool);
      return makeProcessDesignMysqlRepository(pool);
    })();
  }
  return await repositoryPromise;
}

function setProcessDesignRepositoryFactory(factory) {
  repositoryFactory = factory;
  repositoryPromise = null;
}

function resetProcessDesignRepositoryFactory() {
  repositoryFactory = null;
  repositoryPromise = null;
}

async function currentRoleCodes(req) {
  const rows = await getUserRoleCodesAsync(req.session.userId, req.session.userRole);
  const codes = new Set((rows || []).map(row => row.code || row.role_code).filter(Boolean));
  if (req.session.userRole) codes.add(req.session.userRole);
  return codes;
}

async function currentPermSet(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet || new Set();
}

function hasRole(roleCodes, allowed) {
  return Array.from(roleCodes).some(code => allowed.has(code));
}

async function canWorkAcrossDepartments(req, roleCodes) {
  const perms = await currentPermSet(req);
  return perms.has('*:*') || perms.has('admin:access') || hasRole(roleCodes, PROJECT_WIDE_ROLES);
}

async function authorizedDepartmentIds(req, roleCodes) {
  if (await canWorkAcrossDepartments(req, roleCodes)) return null;
  const ids = new Set();
  if (req.session.departmentId) ids.add(Number(req.session.departmentId));
  return ids;
}

function draftRequiredErrors(body) {
  const required = [
    ['document_no', '制度编号不能为空'],
    ['process_name', '制度名称不能为空'],
    ['basis_type', '依据类型不能为空']
  ];
  const errors = required.filter(([field]) => !text(body[field])).map(([field, message]) => ({ field, message }));
  if (!Object.prototype.hasOwnProperty.call(body, 'involves_other_departments')) {
    errors.push({ field: 'involves_other_departments', message: '请说明是否涉及其他部门' });
  }
  return errors;
}

async function assertCanViewDraft(req, repo, draft) {
  if (!draft) throw httpError(404, '制度结构草稿不存在');
  const roleCodes = await currentRoleCodes(req);
  if (await canWorkAcrossDepartments(req, roleCodes)) return roleCodes;
  if (Number(draft.created_by || 0) === Number(req.session.userId)) return roleCodes;
  const deptIds = await authorizedDepartmentIds(req, roleCodes);
  if (deptIds && deptIds.has(Number(draft.department_id))) return roleCodes;
  throw httpError(403, '无权查看该制度结构草稿');
}

async function assertCanEditDraft(req, repo, draft) {
  const roleCodes = await assertCanViewDraft(req, repo, draft);
  if (draft.status === 'published') throw httpError(409, '已发布流程不能直接修改草稿');
  if (await canWorkAcrossDepartments(req, roleCodes)) return roleCodes;
  if (Number(draft.created_by || 0) === Number(req.session.userId)) return roleCodes;
  if (hasRole(roleCodes, new Set([...DEPT_CREATE_ROLES, ...REVIEW_ROLES]))) return roleCodes;
  throw httpError(403, '无权维护该制度结构草稿');
}

async function assertCanEditDraftContent(req, repo, draft) {
  const roleCodes = await assertCanEditDraft(req, repo, draft);
  if (!EDITABLE_DRAFT_STATUSES.has(draft.status || 'draft')) {
    throw httpError(409, '当前状态只读，需要退回修改或新建变更版本');
  }
  return roleCodes;
}

async function assertCanReview(req, repo, draft) {
  const roleCodes = await assertCanViewDraft(req, repo, draft);
  if (await canWorkAcrossDepartments(req, roleCodes) || hasRole(roleCodes, REVIEW_ROLES)) return roleCodes;
  throw httpError(403, '无权审核该制度结构草稿');
}

async function assertCanVerifyEvidenceStatus(req) {
  const perms = await currentPermSet(req);
  if (perms.has('*:*') || perms.has('admin:access') || perms.has(PROCESS_EVIDENCE_VERIFY_PERMISSION)) return;
  throw httpError(403, '无权核验证据状态');
}

async function assertCanReturnHandoff(req, repo, draft, handoff) {
  if (!handoff) throw httpError(404, '跨部门承接不存在');
  const roleCodes = await currentRoleCodes(req);
  if (await canWorkAcrossDepartments(req, roleCodes)) return roleCodes;
  const department = req.session.departmentId ? await getDepartmentByIdAsync(req.session.departmentId) : null;
  const departmentName = department && (department.name || department.department_name);
  if (departmentName && text(departmentName) === text(handoff.target_department)) return roleCodes;
  throw httpError(403, '跨部门承接结果只能由承接部门回写');
}

async function departmentNameForId(departmentId) {
  if (!departmentId) return null;
  const department = await getDepartmentByIdAsync(Number(departmentId));
  return department && (department.name || department.department_name) || null;
}

async function currentDepartmentTaxonomyScope(req) {
  const departmentName = await departmentNameForId(req.session.departmentId);
  return { departmentNames: departmentName ? [departmentName] : [] };
}

async function taxonomyScopeForDepartmentId(departmentId) {
  const departmentName = await departmentNameForId(departmentId);
  return { departmentNames: departmentName ? [departmentName] : [] };
}

router.get('/summary', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const roleCodes = await currentRoleCodes(req);
  let deptIds = null;
  if (!await canWorkAcrossDepartments(req, roleCodes)) {
    deptIds = Array.from(await authorizedDepartmentIds(req, roleCodes) || []);
  }
  res.json(await repo.summary(deptIds, req.query && req.query.document_no));
}));

router.get('/process-taxonomy', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  res.json(await repo.listProcessTaxonomy(await currentDepartmentTaxonomyScope(req)));
}));

router.get('/field-types', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  res.json({ items: await repo.listFieldTypes() });
}));

router.get('/departments/:id/roster-roles', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const departmentId = Number(req.params.id);
  if (!departmentId) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'department_id', message: '归档责任部门无效' }] });
  res.json(await repo.listRosterRolesByDepartment(departmentId));
}));

async function canMaintainDocument(req, document) {
  const roleCodes = await currentRoleCodes(req);
  if (await canWorkAcrossDepartments(req, roleCodes)) return true;
  const allowed = await authorizedDepartmentIds(req, roleCodes);
  return Boolean(allowed && document && allowed.has(Number(document.owning_department_id)));
}

router.get('/documents/lookup', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const documentNo = text(req.query && req.query.document_no);
  if (!documentNo) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'document_no', message: '制度编号不能为空' }] });
  const result = await repo.lookupDocument(documentNo);
  if (result.exists && !(await canMaintainDocument(req, result.document))) {
    return res.json({
      exists: true,
      accessible: false,
      can_create: false,
      can_create_next: false,
      document_no: documentNo,
      message: '该制度编号已存在，不属于当前可维护范围。'
    });
  }
  res.json({ accessible: true, ...result });
}));

router.post('/documents/:id/drafts', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const document = await repo.getDocumentById(req.params.id);
  if (!document) throw httpError(404, '制度不存在');
  if (!(await canMaintainDocument(req, document))) throw httpError(403, '无权维护该制度');
  res.status(201).json(await repo.createNextEditionDraft(document.id, req.session.userId, document.owning_department_id));
}));

router.post('/drafts', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const roleCodes = await currentRoleCodes(req);
  const errors = draftRequiredErrors(req.body || {});
  if (text(req.body && req.body.basis_type) && !BASIS_TYPES.has(text(req.body.basis_type))) {
    errors.push({ field: 'basis_type', message: '依据类型必须从系统选项中选择' });
  }
  const canCrossDept = await canWorkAcrossDepartments(req, roleCodes);
  const requestedDeptId = req.body.department_id ? Number(req.body.department_id) : null;
  const sessionDeptId = req.session.departmentId ? Number(req.session.departmentId) : null;
  const targetDeptId = requestedDeptId || sessionDeptId;
  if (!targetDeptId && !canCrossDept) throw httpError(400, '请先维护人员组织信息后再创建制度结构草稿');
  if (!await repo.departmentExists(targetDeptId)) errors.push({ field: 'department_id', message: '所属部门不存在' });
  if (!canCrossDept) {
    if (requestedDeptId && requestedDeptId !== sessionDeptId) throw httpError(403, '普通填报人只能为本人部门创建流程');
    const allowed = await authorizedDepartmentIds(req, roleCodes);
    if (!allowed || !allowed.has(Number(targetDeptId))) throw httpError(403, '无权为该部门创建流程');
    if (!hasRole(roleCodes, new Set([...DEPT_CREATE_ROLES, ...REVIEW_ROLES]))) throw httpError(403, '无权创建制度结构草稿');
  } else if (requestedDeptId && sessionDeptId && requestedDeptId !== sessionDeptId && !text(req.body.proxy_reason)) {
    errors.push({ field: 'proxy_reason', message: '管理员或信息化负责人代建时必须填写代建原因' });
  }
  errors.push(...await taxonomyValidationDetails(repo, req.body || {}, await taxonomyScopeForDepartmentId(targetDeptId)));
  if (errors.length) throw httpError(422, '校验失败', { error: '校验失败', details: errors });
  await getDepartmentByIdAsync(targetDeptId);
  const draft = await repo.createDraft(req.body, req.session.userId, targetDeptId, requestedDeptId && sessionDeptId && requestedDeptId !== sessionDeptId ? sessionDeptId : null);
  res.status(201).json(draft);
}));

router.get('/drafts/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  res.json(await repo.detail(draft.id));
}));

router.put('/drafts/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const taxonomyErrors = await taxonomyValidationDetails(repo, req.body || {}, await taxonomyScopeForDepartmentId(draft.department_id));
  if (taxonomyErrors.length) throw httpError(422, '校验失败', { error: '校验失败', details: taxonomyErrors });
  res.json(await repo.updateDraft(draft, req.body || {}, req.session.userId));
}));

router.delete('/drafts/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.deleteDraft(draft, req.session.userId));
}));

router.put('/drafts/:id/document-profile', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = req.body || {};
  const details = [];
  if (!text(body.document_title)) details.push({ field: 'document_title', message: '制度名称不能为空' });
  if (!text(body.purpose)) details.push({ field: 'purpose', message: '目的不能为空' });
  if (!text(body.scope)) details.push({ field: 'scope', message: '范围不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.json(await repo.saveDocumentProfile(draft, body, req.session.userId));
}));

router.post('/drafts/:id/terms', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = req.body || {};
  const details = [];
  if (!text(body.term_name)) details.push({ field: 'term_name', message: '术语名称不能为空' });
  if (!text(body.definition)) details.push({ field: 'definition', message: '术语定义不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.status(201).json(await repo.createTerm(draft, body, req.session.userId));
}));

router.put('/terms/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByTerm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = req.body || {};
  const details = [];
  if (!text(body.term_name)) details.push({ field: 'term_name', message: '术语名称不能为空' });
  if (!text(body.definition)) details.push({ field: 'definition', message: '术语定义不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.json(await repo.updateTerm(draft, Number(req.params.id), body, req.session.userId));
}));

router.delete('/terms/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByTerm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.deleteTerm(draft, Number(req.params.id), req.session.userId));
}));

router.post('/drafts/:id/processes', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = processBodyWithDraftTaxonomy(draft, req.body || {});
  const details = [];
  assertNoManualNumber(body, 'process_code', '流程编号');
  if (!text(body.l1_name)) details.push({ field: 'l1_name', message: 'L1 能力不能为空' });
  if (!text(body.l2_name)) details.push({ field: 'l2_name', message: 'L2 业务能力不能为空' });
  if (!text(body.l3_name)) details.push({ field: 'l3_name', message: 'L3 流程不能为空' });
  if (text(body.process_type) && !PROCESS_TYPES.has(text(body.process_type))) details.push({ field: 'process_type', message: '流程类型必须从系统选项中选择' });
  await appendProcessTaxonomyValidation(repo, body, details, await taxonomyScopeForDepartmentId(draft.department_id));
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.status(201).json(await repo.createProcess(draft, body, req.session.userId));
}));

router.put('/processes/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByProcess(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = processBodyWithDraftTaxonomy(draft, req.body || {});
  const details = [];
  assertNoManualNumber(body, 'process_code', '流程编号');
  if (!text(body.l1_name)) details.push({ field: 'l1_name', message: 'L1 能力不能为空' });
  if (!text(body.l2_name)) details.push({ field: 'l2_name', message: 'L2 业务能力不能为空' });
  if (!text(body.l3_name)) details.push({ field: 'l3_name', message: 'L3 流程不能为空' });
  if (text(body.process_type) && !PROCESS_TYPES.has(text(body.process_type))) details.push({ field: 'process_type', message: '流程类型必须从系统选项中选择' });
  await appendProcessTaxonomyValidation(repo, body, details, await taxonomyScopeForDepartmentId(draft.department_id));
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.json(await repo.updateProcess(draft, Number(req.params.id), body, req.session.userId));
}));

router.delete('/processes/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByProcess(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.deleteProcess(draft, Number(req.params.id), req.session.userId));
}));

router.get('/drafts/:id/markdown', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  const result = await repo.markdownForDraft(draft.id);
  if (!result) throw httpError(404, '制度结构草稿不存在');
  res.json(result);
}));

router.post('/drafts/:id/steps', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const details = [];
  if (!Number(req.body && req.body.process_id || 0)) details.push({ field: 'process_id', message: '业务行为必须归属一个制度流程' });
  if (!text(req.body.step_name)) details.push({ field: 'step_name', message: '步骤名称不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.status(201).json(await repo.createStep(draft, req.body || {}, req.session.userId));
}));

router.put('/steps/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByStep(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateStep(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.put('/steps/:id/behavior-detail', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByStep(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.saveBehaviorDetail(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.delete('/steps/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByStep(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.deleteStep(draft, Number(req.params.id), {
    mode: text(req.query && req.query.mode) === 'delete' ? 'delete' : 'void',
    reason: req.body && req.body.reason,
    actorUserId: req.session.userId
  }));
}));

router.post('/steps/:id/cross-dept-handoffs', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByStep(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const body = req.body || {};
  const details = [];
  if (!text(body.target_department)) details.push({ field: 'target_department', message: '承接部门不能为空' });
  ['target_process_code', 'target_process_name', 'target_behavior_code', 'target_behavior_name'].forEach(field => {
    if (text(body[field])) details.push({ field, message: '承接流程和业务行为只能由承接部门回写' });
  });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.status(201).json(await repo.createHandoff(draft, Number(req.params.id), body, req.session.userId));
}));

router.put('/cross-dept-handoffs/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByHandoff(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateHandoff(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.put('/cross-dept-handoffs/:id/returned-result', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByHandoff(req.params.id);
  const handoff = await repo.getHandoff(req.params.id);
  await assertCanReturnHandoff(req, repo, draft, handoff);
  if (!EDITABLE_DRAFT_STATUSES.has(draft.status || 'draft')) throw httpError(409, '当前状态只读，需要退回修改或新建变更版本');
  const body = req.body || {};
  const details = [];
  if (!text(body.target_process_name)) details.push({ field: 'target_process_name', message: '承接流程不能为空' });
  if (!text(body.target_behavior_name)) details.push({ field: 'target_behavior_name', message: '承接业务行为不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.json(await repo.acceptHandoffReturn(draft, Number(req.params.id), body, req.session.userId));
}));

router.post('/drafts/:id/forms', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const details = [];
  if (!Number(req.body && req.body.step_id || 0)) details.push({ field: 'step_id', message: '表单必须指向业务行为' });
  if (!text(req.body && req.body.form_name)) details.push({ field: 'form_name', message: '表单名称不能为空' });
  if (!text(req.body && req.body.main_table_name)) details.push({ field: 'main_table_name', message: '主表名称不能为空' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.status(201).json(await repo.createForm(draft, req.body || {}, req.session.userId));
}));

router.put('/forms/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByForm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateForm(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/forms/:id/tables', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByForm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  assertNoManualNumber(req.body || {}, 'table_no', '表编号');
  assertNoManualNumber(req.body || {}, 'table_code', '表编号');
  if (text(req.body && req.body.table_kind) && text(req.body.table_kind) !== 'detail') throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'table_kind', message: '当前只允许创建明细表' }] });
  if (!text(req.body && req.body.table_name)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'table_name', message: '明细表名称不能为空' }] });
  res.status(201).json(await repo.createFormTable(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.put('/form-tables/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByFormTable(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateFormTable(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/form-tables/:id/fields', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByFormTable(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  assertNoManualNumber(req.body || {}, 'field_no', '字段编号');
  assertNoManualNumber(req.body || {}, 'field_code', '字段编号');
  assertNoWhitespaceFields(req.body || {}, ['field_name']);
  if (text(req.body && req.body.structure_kind) && text(req.body.structure_kind) !== 'detail') throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'structure_kind', message: '明细表接口只能新增明细字段' }] });
  assertEnum(req.body || {}, 'field_type', FIELD_TYPES, '字段类型');
  if (!text(req.body && req.body.field_name)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'field_name', message: '明细字段名称不能为空' }] });
  res.status(201).json(await repo.createFormTableField(draft, Number(req.params.id), { ...(req.body || {}), structure_kind: 'detail' }, req.session.userId));
}));

router.put('/form-table-fields/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByFormTableField(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateFormTableField(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/forms/:id/fields', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByForm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  assertNoManualNumber(req.body || {}, 'field_no', '字段编号');
  assertNoManualNumber(req.body || {}, 'field_code', '字段编号');
  assertNoWhitespaceFields(req.body || {}, ['field_name']);
  assertEnum(req.body || {}, 'field_type', FIELD_TYPES, '字段类型');
  if (!text(req.body && req.body.field_name)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'field_name', message: '主表字段名称不能为空' }] });
  res.status(201).json(await repo.createFormTableField(draft, Number(req.params.id), { ...(req.body || {}), structure_kind: 'main' }, req.session.userId));
}));

router.delete('/forms/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByForm(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.deleteForm(draft, Number(req.params.id), req.session.userId));
}));

router.delete('/form-tables/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByFormTable(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.deleteFormTable(draft, Number(req.params.id), req.session.userId));
}));

router.delete('/form-table-fields/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByFormTableField(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.deleteFormTableField(draft, Number(req.params.id), req.session.userId));
}));

router.put('/form-table-fields/:id/order', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByFormTableField(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const direction = text(req.body && req.body.direction) === 'down' ? 'down' : 'up';
  res.json(await repo.moveFormTableField(draft, Number(req.params.id), direction, req.session.userId));
}));

router.put('/form-fields/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByField(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  res.json(await repo.updateField(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.post('/drafts/:id/evidence', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  assertEnum(req.body || {}, 'evidence_type', EVIDENCE_TYPES, '证据类型');
  if (!text(req.body.evidence_type) || !text(req.body.description)) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'evidence', message: '证据类型和说明不能为空' }] });
  res.status(201).json(await repo.createEvidence(draft, req.body || {}, req.session.userId));
}));

router.put('/evidence/:id', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraftByEvidence(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status') && text(req.body.status) === 'verified') {
    await assertCanVerifyEvidenceStatus(req);
  }
  res.json(await repo.updateEvidence(draft, Number(req.params.id), req.body || {}, req.session.userId));
}));

router.get('/drafts/:id/risks', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  const items = await repo.buildRisks(draft.id);
  res.json({ summary: { total: items.length }, items });
}));

router.get('/drafts/:id/edition-diff', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  res.json(await repo.editionDiff(draft));
}));

router.get('/drafts/:id/outcome-preview', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  res.json({ draft, outcome: await repo.outcomeForDraft(draft), counts: await repo.getCounts(draft.id), risks: await repo.buildRisks(draft.id) });
}));

router.post('/drafts/:id/submit', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanEditDraftContent(req, repo, draft);
  const errors = draftRequiredErrors(draft);
  if (errors.length) throw httpError(422, '校验失败', { error: '校验失败', details: errors });
  res.json(await repo.submitDraft(draft, req.body && req.body.note, req.session.userId));
}));

router.post('/review-tasks/:id/decision', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const task = await repo.getReviewTask(req.params.id);
  if (!task) throw httpError(404, '审核任务不存在');
  const draft = await repo.getDraft(task.draft_id);
  await assertCanReview(req, repo, draft);
  const decision = text(req.body.decision);
  if (!{ approve: true, reject: true, needs_changes: true }[decision]) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'decision', message: '审核结论无效' }] });
  res.json(await repo.decideReviewTask(task, decision, req.body.note, req.session.userId));
}));

router.post('/drafts/:id/publish', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanReview(req, repo, draft);
  res.json(await repo.publishDraft(draft, req.body && req.body.note, req.session.userId, req.body || {}));
}));

router.setProcessDesignRepositoryFactory = setProcessDesignRepositoryFactory;
router.resetProcessDesignRepositoryFactory = resetProcessDesignRepositoryFactory;
router.makeProcessDesignMysqlRepository = makeProcessDesignMysqlRepository;
router.ensureProcessDesignEditionSchema = ensureProcessDesignEditionSchema;
router.ensureProcessDesignEvidenceStatusSchema = ensureProcessDesignEvidenceStatusSchema;
router.ensureProcessDesignFormStructureSchema = ensureProcessDesignFormStructureSchema;

module.exports = router;
