const express = require('express');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const router = express.Router();
const {
  requireAuth,
  requirePermission,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync,
  getDepartmentByIdAsync,
  getDepartmentByNameAsync
} = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const {
  CURRENT_VERSION: PROCESS_GOVERNANCE_SCHEMA_VERSION,
  contentHash,
  createEmptyProcessGovernanceDocument,
  normalizeProcessGovernanceDocument,
  previewProcessGovernanceDocument,
  handoffCandidates
} = require('../processGovernanceV2');
const {
  HANDOFF_STATUSES: HANDOFF_STATUS_VALUES,
  applyCrossDeptHandoffV2
} = require('../crossDeptHandoffV2Migration');
const {
  applyProcessGovernanceUnified
} = require('../processGovernanceUnifiedMigration');
const {
  contentHash: v7ContentHash,
  validateAndProjectV7
} = require('../processV7PreviewReview');

const FIELD_STATUSES = new Set(['suggested', 'business_confirmed', 'data_governed', 'published', 'retired']);
const DRAFT_STATUSES = new Set(['draft', 'submitted', 'under_review', 'needs_changes', 'approved', 'published', 'rejected']);
const CLASSIFICATION_STATUSES = new Set(['unclassified', 'needs_review', 'confirmed']);
const TABLE_KINDS = new Set(['main', 'detail']);
const HANDOFF_STATUSES = new Set(HANDOFF_STATUS_VALUES);
HANDOFF_STATUSES.add('conflict_open');
const HANDOFF_STAGES = Object.freeze([
  ['pending_assignment', '责任部门分派', 'mdm_lead'],
  ['pending_origin_review', '归口部门审核', 'department_mdm_reviewer'],
  ['pending_counterparty_scope', '外部门确认范围', 'department_mdm_reviewer'],
  ['pending_counterparty_detail', '外部门补充实际承接内容', 'department_contact'],
  ['pending_counterparty_review', '外部门审核', 'department_mdm_reviewer'],
  ['pending_structure_gate', 'MDM结构卡口', 'mdm_lead'],
  ['confirmed', '确认完成', null]
]);
const PROCESS_TYPES = new Set(['new', 'inherit', 'handoff', 'adjustment']);
const STEP_TYPES = new Set(['action', 'decision']);
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
const EVIDENCE_STATUS_MIGRATION_KEY = '2026-07-01-process-design-evidence-status';
const EDITION_SCHEMA_MIGRATION_KEY = '2026-07-02-process-design-document-editions';
const FORM_STRUCTURE_SCHEMA_MIGRATION_KEY = '2026-07-03-process-design-form-structure';
const STEP_TRANSITION_SCHEMA_MIGRATION_KEY = '2026-07-07-process-design-step-transitions';
const STRUCTURED_OUTPUT_SCHEMA_VERSION = 'document-structured-output-v2';
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
  if (error.payload && error.payload.code) error.code = error.payload.code;
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
  return `FM-${documentNo}-${edition}-${pad3(sequence)}`;
}

function formatFormStructureCode(formCode, structureKind) {
  return `${text(formCode)}-${structureKind === 'detail' ? 'D' : 'M'}`;
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
  const prefix = `FM-${documentNo}-${edition}-`;
  const value = text(formCode);
  if (!value.startsWith(prefix)) return 0;
  const sequence = Number(value.slice(prefix.length));
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

function arrayItems(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  for (const value of values) {
    const cleaned = text(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object || {}, field);
}

function structuredOutputData(body) {
  const data = body && body.schema_version ? body : body && body.data;
  return data && typeof data === 'object' ? data : null;
}

function hasNonEmptyWorkRoleBindings(data) {
  const values = [
    data && data.work_role_bindings,
    data && data.structure_block_projection && data.structure_block_projection.work_role_bindings
  ];
  return values.some(value => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(text(value));
  });
}

function assertWorkRoleBindingsSupported(data) {
  if (text(data && data.schema_version) !== STRUCTURED_OUTPUT_SCHEMA_VERSION || !hasNonEmptyWorkRoleBindings(data)) return;
  throw httpError(422, '校验失败', {
    code: 'WORK_ROLE_BINDINGS_UNSUPPORTED',
    error: '校验失败',
    details: [{
      field: 'work_role_bindings',
      message: '当前 MDM 尚不承接工作角色绑定。请保留原结构化文件，并在 3001 继续整理；待 MDM 承接能力上线后再导入。'
    }]
  });
}

function enumValue(value, allowed, fallback) {
  const cleaned = text(value);
  if (!cleaned) return fallback;
  return allowed.has(cleaned) ? cleaned : fallback;
}

function structuredOutputDraftPayload(data) {
  const draft = data && data.draft || {};
  const profile = data && data.document_profile || {};
  const meta = data && data.structure_block_projection && data.structure_block_projection.meta || {};
  const relatedDepartments = arrayItems(draft.related_departments).map(item => text(item)).filter(Boolean);
  const documentNo = firstText(draft.document_no, profile.document_no, meta.document_no);
  const documentTitle = firstText(profile.document_title, draft.document_title, draft.process_name, meta.document_title);
  const payload = {
    document_no: documentNo,
    document_title: documentTitle,
    process_name: firstText(draft.process_name, documentTitle),
    reason: text(draft.reason),
    basis_type: enumValue(draft.basis_type, BASIS_TYPES, '制度 / 规程'),
    basis_description: text(draft.basis_description),
    involves_other_departments: hasOwn(draft, 'involves_other_departments') ? Boolean(draft.involves_other_departments) : relatedDepartments.length > 0,
    related_departments: relatedDepartments
  };
  if (text(draft.l1_name)) payload.l1_name = text(draft.l1_name);
  if (text(draft.l2_name)) payload.l2_name = text(draft.l2_name);
  if (text(draft.l3_name)) payload.l3_name = text(draft.l3_name);
  return payload;
}

function structuredOutputProfilePayload(data, draftPayload) {
  const profile = data && data.document_profile || {};
  return {
    document_no: firstText(profile.document_no, draftPayload.document_no),
    document_title: firstText(profile.document_title, draftPayload.document_title, draftPayload.process_name),
    purpose: text(profile.purpose),
    scope: text(profile.scope),
    inheritance_relation: optionalText(profile.inheritance_relation)
  };
}

function refKey(value, fallback) {
  return text(value) || fallback;
}

function fieldTypeName(value) {
  const cleaned = text(value);
  if (FIELD_TYPES.has(cleaned)) return cleaned;
  const aliases = { '数值': '数字', '数量': '数字', '是/否': '布尔' };
  return aliases[cleaned] || '文本';
}

function importCounts() {
  return {
    terms: 0,
    processes: 0,
    steps: 0,
    step_transitions: 0,
    behavior_details: 0,
    cross_dept_handoffs: 0,
    forms: 0,
    form_tables: 0,
    form_table_fields: 0,
    evidence: 0
  };
}

function pushImportWarning(warnings, objectType, index, message) {
  warnings.push({ object_type: objectType, index, message });
}

function evidenceObjectTarget(item, maps, fallbackProcessId) {
  const objectType = text(item && item.object_type);
  const objectRef = text(item && (item.object_ref || item.process_ref || item.step_ref || item.form_ref || item.table_field_ref || item.field_ref));
  if (objectType === 'process' && maps.processes.has(objectRef)) return { object_type: 'process', object_id: maps.processes.get(objectRef) };
  if ((objectType === 'step' || objectType === 'behavior_detail') && maps.steps.has(objectRef)) return { object_type: 'step', object_id: maps.steps.get(objectRef) };
  if (objectType === 'form' && maps.forms.has(objectRef)) return { object_type: 'form', object_id: maps.forms.get(objectRef) };
  if ((objectType === 'field' || objectType === 'form_table_field' || objectType === 'form_field') && maps.fields.has(objectRef)) return { object_type: 'field', object_id: maps.fields.get(objectRef) };
  return { object_type: 'process', object_id: fallbackProcessId || null };
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

function publicStepTransition(row) {
  if (!row) return null;
  return {
    ...row,
    evidence_refs: parseJsonArray(row.evidence_refs_json)
  };
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

async function ensureProcessDesignStepTransitionSchema(pool) {
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_steps ADD COLUMN step_type VARCHAR(32) NOT NULL DEFAULT 'action' AFTER process_id");
  await pool.execute("UPDATE process_design_steps SET step_type='action' WHERE step_type IS NULL OR step_type=''");
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_step_transitions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      draft_id BIGINT NOT NULL,
      process_id BIGINT NOT NULL,
      from_step_id BIGINT NOT NULL,
      condition_text VARCHAR(255) NOT NULL,
      to_step_id BIGINT NULL,
      evidence_refs_json JSON NULL,
      sort_order INT NOT NULL DEFAULT 1,
      created_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_process_design_step_transitions_draft (draft_id, sort_order),
      INDEX idx_process_design_step_transitions_process (process_id, from_step_id),
      CONSTRAINT fk_process_design_step_transitions_draft FOREIGN KEY (draft_id)
        REFERENCES process_design_drafts(id) ON DELETE CASCADE,
      CONSTRAINT fk_process_design_step_transitions_process FOREIGN KEY (process_id)
        REFERENCES process_design_processes(id) ON DELETE CASCADE,
      CONSTRAINT fk_process_design_step_transitions_from_step FOREIGN KEY (from_step_id)
        REFERENCES process_design_steps(id) ON DELETE CASCADE,
      CONSTRAINT fk_process_design_step_transitions_to_step FOREIGN KEY (to_step_id)
        REFERENCES process_design_steps(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_step_transitions ADD INDEX idx_process_design_step_transitions_draft (draft_id, sort_order)');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_step_transitions ADD INDEX idx_process_design_step_transitions_process (process_id, from_step_id)');
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [STEP_TRANSITION_SCHEMA_MIGRATION_KEY]);
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
    const rows = await mysqlQuery(pool, 'SELECT * FROM process_design_cross_dept_handoffs WHERE step_id=? AND is_current=1 ORDER BY sort_order, id', [stepId]);
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

  async function loadStepTransitions(draftId) {
    const rows = await mysqlQuery(pool, `
      SELECT t.*,
             fromStep.step_name AS from_step_name,
             fromStep.step_type AS from_step_type,
             toStep.step_name AS to_step_name,
             process.l3_name AS process_name
      FROM process_design_step_transitions t
      JOIN process_design_steps fromStep ON fromStep.id=t.from_step_id
      LEFT JOIN process_design_steps toStep ON toStep.id=t.to_step_id
      LEFT JOIN process_design_processes process ON process.id=t.process_id
      WHERE t.draft_id=?
      ORDER BY t.process_id, t.sort_order, t.id
    `, [draftId]);
    return rows.map(publicStepTransition);
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

  async function validateFormalV7Draft(draft) {
    const document = parseJsonObject(draft && draft.process_content_json);
    const departments = await mysqlQuery(pool, `
      SELECT id, name, code
      FROM departments
      WHERE status='active'
      ORDER BY sort_order, id
    `);
    const owningDepartment = departments.find(item => Number(item.id) === Number(draft.department_id)) || null;
    const preview = validateAndProjectV7(document, departments, {
      owningDepartmentName: owningDepartment && owningDepartment.name || ''
    });
    if (preview.errors.length) {
      throw httpError(422, '正式V7草稿正文校验失败', {
        error: '正式V7草稿正文校验失败',
        code: 'V7_FORMAL_CONTENT_INVALID',
        details: preview.errors
      });
    }
    if (v7ContentHash(document) !== text(draft.content_hash)) {
      throw httpError(409, '正式V7草稿正文摘要与当前记录不一致', {
        error: '正式V7草稿正文摘要与当前记录不一致',
        code: 'V7_FORMAL_CONTENT_HASH_MISMATCH'
      });
    }
    const [promotion] = await mysqlQuery(pool, `
      SELECT p.*, c.status AS preview_case_status, c.scope_decision,
             c.current_revision_no, c.current_content_hash
      FROM process_v7_promotions p
      JOIN process_v7_preview_cases c ON c.id=p.preview_case_id
      WHERE p.draft_id=?
      ORDER BY p.id DESC
      LIMIT 1
    `, [draft.id]);
    if (
      !promotion ||
      text(promotion.content_hash) !== text(draft.content_hash) ||
      Number(promotion.preview_revision_no) !== Number(draft.revision_no) ||
      text(promotion.preview_case_status) !== 'review_complete' ||
      Number(promotion.current_revision_no) !== Number(draft.revision_no) ||
      text(promotion.current_content_hash) !== text(draft.content_hash)
    ) {
      throw httpError(409, '正式V7草稿没有匹配的已完成预览核对记录', {
        error: '正式V7草稿没有匹配的已完成预览核对记录',
        code: 'V7_FORMAL_PROMOTION_EVIDENCE_MISMATCH'
      });
    }
    return { document, preview, promotion };
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
        WHERE s.draft_id=? AND s.status='active' AND h.is_current=1
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
    const [unfinishedHandoff] = await mysqlQuery(pool, `
      SELECT COUNT(*) AS count
      FROM process_design_cross_dept_handoffs handoff
      JOIN process_design_steps step ON step.id=handoff.step_id
      WHERE step.draft_id=?
        AND handoff.is_current=1
        AND handoff.status NOT IN ('confirmed','closed_not_required')
    `, [draft.id]);
    if (Number(unfinishedHandoff.count || 0) > 0) {
      details.push('发布前所有当前跨部门承接关系必须确认完成，或依据双方决定关闭为不需要承接。');
    }
    const [unsupportedClosedHandoff] = await mysqlQuery(pool, `
      SELECT COUNT(*) AS count
      FROM process_design_cross_dept_handoffs handoff
      JOIN process_design_steps step ON step.id=handoff.step_id
      WHERE step.draft_id=?
        AND handoff.is_current=1
        AND handoff.status='closed_not_required'
        AND NOT EXISTS (
          SELECT 1
          FROM governance_decision_records decisionRecord
          WHERE decisionRecord.subject_domain='process'
            AND decisionRecord.subject_type='cross_dept_handoff'
            AND decisionRecord.subject_id=CAST(handoff.id AS CHAR)
            AND decisionRecord.subject_version=handoff.candidate_version
            AND decisionRecord.decision='approved'
        )
    `, [draft.id]);
    if (Number(unsupportedClosedHandoff.count || 0) > 0) {
      details.push('标记为不需要承接的关系缺少部门决定记录，不能发布。');
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

  async function publicationGovernanceReadiness(draft) {
    const subjectVersion = text(draft.planned_edition) || 'A';
    const requiredDepartments = [];
    const missingDepartments = [];
    const ownerDepartment = (await mysqlQuery(pool, `
      SELECT id, name, final_responsible_person_id
      FROM departments
      WHERE id=? AND status='active'
      LIMIT 1
    `, [draft.department_id]))[0];
    if (ownerDepartment) requiredDepartments.push(ownerDepartment);
    else missingDepartments.push(`部门ID ${draft.department_id}`);

    for (const departmentName of parseJsonArray(draft.related_departments)) {
      const department = (await mysqlQuery(pool, `
        SELECT id, name, final_responsible_person_id
        FROM departments
        WHERE name=? AND status='active'
        LIMIT 1
      `, [departmentName]))[0];
      if (!department) {
        missingDepartments.push(departmentName);
      } else if (!requiredDepartments.some(item => Number(item.id) === Number(department.id))) {
        requiredDepartments.push(department);
      }
    }

    const incompleteDepartments = [];
    for (const department of requiredDepartments) {
      if (!department.final_responsible_person_id) {
        incompleteDepartments.push({
          departmentId: Number(department.id),
          departmentName: department.name,
          reason: '部门尚未配置最终责任人'
        });
        continue;
      }
      const decision = (await mysqlQuery(pool, `
        SELECT decision, accountable_person_id, decided_at
        FROM governance_decision_records
        WHERE subject_domain='process'
          AND subject_type='process_design_draft'
          AND subject_id=?
          AND subject_version=?
          AND department_id=?
        ORDER BY created_at DESC, decision_record_id DESC
        LIMIT 1
      `, [String(draft.id), subjectVersion, department.id]))[0];
      if (
        !decision ||
        decision.decision !== 'approved' ||
        Number(decision.accountable_person_id) !== Number(department.final_responsible_person_id)
      ) {
        incompleteDepartments.push({
          departmentId: Number(department.id),
          departmentName: department.name,
          reason: !decision
            ? '尚未记录部门决定'
            : decision.decision !== 'approved'
              ? '最新部门决定不是同意'
              : '部门最终责任人已经变化，需要重新记录决定'
        });
      }
    }

    const [blockingRisk] = await mysqlQuery(pool, `
      SELECT COUNT(*) AS count
      FROM process_design_risks
      WHERE draft_id=? AND status IN ('open','needs_fix')
    `, [draft.id]);

    return {
      subjectDomain: 'process',
      subjectType: 'process_design_draft',
      subjectId: String(draft.id),
      subjectVersion,
      requiredDepartments: requiredDepartments.map(item => ({
        departmentId: Number(item.id),
        departmentName: item.name
      })),
      missingDepartments,
      incompleteDepartments,
      blockingIssueCount: Number(blockingRisk && blockingRisk.count || 0),
      ready: missingDepartments.length === 0 &&
        incompleteDepartments.length === 0 &&
        Number(blockingRisk && blockingRisk.count || 0) === 0
    };
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
      stepTransitions: await loadStepTransitions(draft.id),
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
    const document = draft.document_id ? await getDocumentById(draft.document_id) : null;
    const versions = document ? await mysqlQuery(pool, `
      SELECT *
      FROM process_design_versions
      WHERE document_id=?
      ORDER BY effective_at DESC, id DESC
    `, [document.id]) : [];
    const reviewTasks = await loadReviewTasks(draftId);
    const events = await loadEvents(draftId);
    if (text(draft.schema_version) === 'process-governance-v7') {
      const content = parseJsonObject(draft.process_content_json);
      const contentHashVerified = Boolean(
        content &&
        text(draft.content_hash) &&
        v7ContentHash(content) === text(draft.content_hash)
      );
      const approvedCurrentReview = reviewTasks.some(task =>
        text(task.status) === 'approved' &&
        Number(task.draft_revision_no) === Number(draft.revision_no) &&
        text(task.content_hash) === text(draft.content_hash)
      );
      return {
        draft,
        document,
        versions,
        reviewTasks,
        events,
        v7_native: true,
        content,
        content_hash_verified: contentHashVerified,
        outcome: {
          formed: draft.status === 'published' ? '已形成不可变的原生V7正式版本' : '已形成原生V7正式草稿',
          current: `当前状态为${draft.status}`,
          missing: contentHashVerified ? [] : ['V7正文与内容摘要不一致'],
          next: draft.status === 'published' ? '后续治理对象绑定process_version_id' : '按当前状态完成正式审核或发布'
        },
        publishable: draft.status === 'approved' && approvedCurrentReview && contentHashVerified
      };
    }
    const readiness = await publishReadiness(draft);
    return {
      draft,
      document,
      versions,
      editionDiff: await editionDiffForDraft(draft),
      documentProfile: await loadDocumentProfile(draftId),
      terms: await loadTerms(draftId),
      processes: await loadProcesses(draftId),
      steps: await loadSteps(draftId),
      stepTransitions: await loadStepTransitions(draftId),
      forms: await loadForms(draftId),
      evidence: await loadEvidence(draftId),
      risks: await buildRisks(draftId),
      reviewTasks,
      events,
      outcome: await outcomeForDraft(draft),
      publishable: readiness.publishable
    };
  }

  async function getHandoffContext(handoffId) {
    const [row] = await mysqlQuery(pool, `
      SELECT handoff.*,
             step.step_name AS anchor_behavior_name,
             draft.department_id AS owning_department_id,
             draft.status AS draft_status,
             sourceDept.final_responsible_person_id AS source_final_responsible_person_id,
             targetDept.final_responsible_person_id AS target_final_responsible_person_id
      FROM process_design_cross_dept_handoffs handoff
      JOIN process_design_steps step ON step.id=handoff.step_id
      JOIN process_design_drafts draft ON draft.id=step.draft_id
      LEFT JOIN departments sourceDept
        ON sourceDept.id=handoff.source_department_id
        OR (handoff.source_department_id IS NULL AND sourceDept.name=handoff.source_department)
      LEFT JOIN departments targetDept
        ON targetDept.id=handoff.target_department_id
        OR (handoff.target_department_id IS NULL AND targetDept.name=handoff.target_department)
      WHERE handoff.id=?
      LIMIT 1
    `, [handoffId]);
    if (!row) return null;
    const inbound = text(row.handoff_direction) === 'inbound_prerequisite';
    return {
      ...publicHandoff(row),
      counterparty_department_id: inbound ? row.source_department_id : row.target_department_id,
      counterparty_department: inbound ? row.source_department : row.target_department,
      counterparty_final_responsible_person_id: inbound
        ? row.source_final_responsible_person_id
        : row.target_final_responsible_person_id,
      origin_department_id: inbound ? row.target_department_id || row.owning_department_id : row.source_department_id || row.owning_department_id,
      origin_department: inbound ? row.target_department : row.source_department,
      origin_final_responsible_person_id: inbound
        ? row.target_final_responsible_person_id
        : row.source_final_responsible_person_id
    };
  }

  async function addHandoffEvent(handoffId, eventType, stageCode, actor = {}, basisText, payload, conflictId = null) {
    await mysqlRun(pool, `
      INSERT INTO process_design_handoff_events
        (handoff_id, conflict_id, event_type, stage_code,
         actor_user_id, actor_person_id, actor_department_id, actor_department_name,
         actor_role_code, basis_text, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      handoffId,
      conflictId || null,
      eventType,
      optionalText(stageCode),
      actor.userId || null,
      actor.personId || null,
      actor.departmentId || null,
      optionalText(actor.departmentName),
      optionalText(actor.roleCode),
      optionalText(basisText),
      payload ? JSON.stringify(payload) : null
    ]);
  }

  function actorCanReadHandoff(handoff, actor) {
    const roles = new Set(arrayItems(actor && actor.roleCodes).map(item => text(item)).filter(Boolean));
    if (roles.has('admin') || roles.has('mdm_lead')) return true;
    const departmentId = Number(actor && actor.departmentId || 0);
    if (
      (roles.has('department_contact') || roles.has('department_mdm_reviewer')) &&
      [Number(handoff.origin_department_id || 0), Number(handoff.counterparty_department_id || 0)].includes(departmentId)
    ) return true;
    if (
      roles.has('data_conflict_handler') &&
      Number(handoff.assigned_handler_person_id || 0) === Number(actor && actor.personId || 0)
    ) return true;
    return roles.has('decision_group') && text(handoff.conflict_status) === 'pending_decision';
  }

  function actorCanActOnHandoff(handoff, actor) {
    const roles = new Set(arrayItems(actor && actor.roleCodes).map(item => text(item)).filter(Boolean));
    const departmentId = Number(actor && actor.departmentId || 0);
    const status = text(handoff && handoff.status);
    if (roles.has('mdm_lead') && ['pending_assignment', 'pending_structure_gate', 'returned'].includes(status)) return true;
    if (
      roles.has('department_mdm_reviewer') &&
      status === 'pending_origin_review' &&
      departmentId === Number(handoff.origin_department_id || 0)
    ) return true;
    if (
      roles.has('department_mdm_reviewer') &&
      ['pending_counterparty_scope', 'pending_counterparty_review'].includes(status) &&
      departmentId === Number(handoff.counterparty_department_id || 0)
    ) return true;
    return roles.has('department_contact') &&
      status === 'pending_counterparty_detail' &&
      departmentId === Number(handoff.counterparty_department_id || 0);
  }

  async function hasHandoffParticipant(handoff, actor) {
    return Boolean(handoff && handoff.is_current && actorCanActOnHandoff(handoff, actor));
  }

  async function runLockedHandoffMutation(methodName, handoff, args, options = {}) {
    if (options.__tx || typeof pool.getConnection !== 'function') return { handled: false };
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await mysqlQuery(
        connection,
        'SELECT id FROM process_design_cross_dept_handoffs WHERE id=? FOR UPDATE',
        [handoff.id]
      );
      const txRepo = makeProcessDesignMysqlRepository(connection);
      const lockedHandoff = await txRepo.getHandoffContext(handoff.id);
      if (!lockedHandoff) throw httpError(404, '跨部门承接不存在');
      const result = await txRepo[methodName](
        lockedHandoff,
        ...args,
        { ...options, __tx: true }
      );
      await connection.commit();
      return { handled: true, result };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function runLockedConflictMutation(methodName, conflict, args, options = {}) {
    if (options.__tx || typeof pool.getConnection !== 'function') return { handled: false };
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await mysqlQuery(
        connection,
        'SELECT id FROM process_design_handoff_conflicts WHERE id=? FOR UPDATE',
        [conflict.id]
      );
      const txRepo = makeProcessDesignMysqlRepository(connection);
      const lockedConflict = await txRepo.getHandoffConflictContext(conflict.id);
      if (!lockedConflict) throw httpError(404, '承接冲突不存在');
      const result = await txRepo[methodName](
        lockedConflict,
        ...args,
        { ...options, __tx: true }
      );
      await connection.commit();
      return { handled: true, result };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function getOpenHandoffConflict(handoffId) {
    const [row] = await mysqlQuery(pool, `
      SELECT conflict.*,
             handler.person_name AS assigned_handler_name
      FROM process_design_handoff_conflicts conflict
      LEFT JOIN person handler ON handler.person_id=conflict.assigned_handler_person_id
      WHERE conflict.handoff_id=?
        AND conflict.status NOT IN ('closed','returned_for_revision')
      ORDER BY conflict.id DESC
      LIMIT 1
    `, [handoffId]);
    if (!row) return null;
    return {
      ...row,
      evidence: parseJsonArray(row.evidence_json)
    };
  }

  async function getLatestHandoffConflict(handoffId) {
    const [row] = await mysqlQuery(pool, `
      SELECT conflict.*,
             handler.person_name AS assigned_handler_name
      FROM process_design_handoff_conflicts conflict
      LEFT JOIN person handler ON handler.person_id=conflict.assigned_handler_person_id
      WHERE conflict.handoff_id=?
      ORDER BY conflict.id DESC
      LIMIT 1
    `, [handoffId]);
    if (!row) return null;
    return {
      ...row,
      evidence: parseJsonArray(row.evidence_json)
    };
  }

  async function openHandoffConflict(handoff, reason, actor, options = {}) {
    const transaction = await runLockedHandoffMutation(
      'openHandoffConflict',
      handoff,
      [reason, actor],
      options
    );
    if (transaction.handled) return transaction.result;
    const existing = await getOpenHandoffConflict(handoff.id);
    if (existing) return existing;
    const initialStatus = options.initialStatus === 'pending_decision' ? 'pending_decision' : 'pending_assignment';
    const result = await mysqlRun(pool, `
      INSERT INTO process_design_handoff_conflicts
        (handoff_id, status, opened_reason, created_by_user_id, created_by_person_id,
         escalated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      handoff.id,
      initialStatus,
      text(reason),
      actor.userId || null,
      actor.personId || null,
      initialStatus === 'pending_decision' ? new Date() : null
    ]);
    await mysqlRun(pool, `
      UPDATE process_design_cross_dept_handoffs
      SET status='conflict_open', updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND is_current=1
    `, [handoff.id]);
    await addHandoffEvent(
      handoff.id,
      'conflict_opened',
      'conflict_open',
      actor,
      reason,
      { conflict_status: initialStatus },
      result.insertId
    );
    return await getOpenHandoffConflict(handoff.id);
  }

  async function listHandoffQueue(actor, options = {}) {
    const limit = Math.min(Math.max(Number(options.limit || 100), 1), 200);
    const rows = await mysqlQuery(pool, `
      SELECT handoff.*,
             step.step_name AS anchor_behavior_name,
             draft.process_name,
             draft.document_no,
             draft.department_id AS owning_department_id,
             originDept.id AS origin_department_id,
             originDept.name AS origin_department,
             counterpartyDept.id AS counterparty_department_id,
             counterpartyDept.name AS counterparty_department,
             conflict.id AS conflict_id,
             conflict.status AS conflict_status,
             conflict.assigned_handler_person_id
      FROM process_design_cross_dept_handoffs handoff
      JOIN process_design_steps step ON step.id=handoff.step_id
      JOIN process_design_drafts draft ON draft.id=step.draft_id
      LEFT JOIN departments originDept
        ON originDept.id=CASE
          WHEN handoff.handoff_direction='inbound_prerequisite'
            THEN COALESCE(handoff.target_department_id, draft.department_id)
          ELSE COALESCE(handoff.source_department_id, draft.department_id)
        END
      LEFT JOIN departments counterpartyDept
        ON counterpartyDept.id=CASE
          WHEN handoff.handoff_direction='inbound_prerequisite'
            THEN handoff.source_department_id
          ELSE handoff.target_department_id
        END
      LEFT JOIN process_design_handoff_conflicts conflict
        ON conflict.handoff_id=handoff.id
       AND conflict.status NOT IN ('closed','returned_for_revision')
      WHERE handoff.is_current=1
      ORDER BY handoff.updated_at DESC, handoff.id DESC
      LIMIT ${limit}
    `);
    const visible = rows.filter(row => actorCanReadHandoff(row, actor));
    const items = visible.map(row => ({
      ...publicHandoff(row),
      can_act: actorCanActOnHandoff(row, actor),
      current_stage: handoffStage(row.status),
      next_responsible_role: handoffStage(row.status).responsible_role
    }));
    return {
      items,
      total: items.length,
      queue_truth: 'process_design_cross_dept_handoffs'
    };
  }

  function handoffStage(status) {
    if (status === 'conflict_open') {
      return { code: 'conflict_open', name: '承接冲突处理中', responsible_role: 'data_conflict_handler' };
    }
    if (status === 'closed_not_required') {
      return { code: 'closed_not_required', name: '确认无需承接', responsible_role: null };
    }
    if (status === 'returned') {
      return { code: 'returned', name: '退回上一责任步骤', responsible_role: 'department_contact' };
    }
    const item = HANDOFF_STAGES.find(([code]) => code === status) || [status, status || '待处理', null];
    return { code: item[0], name: item[1], responsible_role: item[2] };
  }

  function conflictStage(conflict) {
    if (
      text(conflict && conflict.status) === 'pending_department_confirmation' &&
      [conflict.origin_confirmation, conflict.counterparty_confirmation].includes('rejected')
    ) {
      return {
        code: 'conflict_escalation',
        name: '协调方案未被接受，待提请项目决策',
        responsible_role: 'data_conflict_handler'
      };
    }
    const stages = {
      pending_assignment: {
        code: 'conflict_assignment',
        name: '承接冲突待分派',
        responsible_role: 'mdm_lead'
      },
      coordinating: {
        code: 'conflict_coordinate',
        name: '承接冲突协调中',
        responsible_role: 'data_conflict_handler'
      },
      pending_department_confirmation: {
        code: 'conflict_department_confirmation',
        name: '协调方案待双方部门确认',
        responsible_role: 'department_mdm_reviewer'
      },
      pending_decision: {
        code: 'conflict_decision',
        name: '承接冲突待项目决策',
        responsible_role: 'decision_group'
      }
    };
    return stages[text(conflict && conflict.status)] || handoffStage('conflict_open');
  }

  function nextHandoffActions(handoff, conflict, currentStage, actor) {
    if (!currentStage.responsible_role) return [];
    if (
      conflict &&
      conflict.status === 'pending_department_confirmation' &&
      ![conflict.origin_confirmation, conflict.counterparty_confirmation].includes('rejected')
    ) {
      return [
        {
          action: currentStage.code,
          responsible_role: currentStage.responsible_role,
          can_act: actorCanActOnConflict(conflict, actor) &&
            Number(actor && actor.departmentId || 0) === Number(handoff.origin_department_id || 0),
          department_id: handoff.origin_department_id || null,
          department_name: handoff.origin_department || null,
          handler_person_id: null,
          handler_person_name: null
        },
        {
          action: currentStage.code,
          responsible_role: currentStage.responsible_role,
          can_act: actorCanActOnConflict(conflict, actor) &&
            Number(actor && actor.departmentId || 0) === Number(handoff.counterparty_department_id || 0),
          department_id: handoff.counterparty_department_id || null,
          department_name: handoff.counterparty_department || null,
          handler_person_id: null,
          handler_person_name: null
        }
      ];
    }
    const action = {
      action: currentStage.code,
      responsible_role: currentStage.responsible_role,
      can_act: conflict
        ? actorCanActOnConflict(conflict, actor)
        : actorCanActOnHandoff(handoff, actor),
      department_id: null,
      department_name: null,
      handler_person_id: conflict && conflict.assigned_handler_person_id || null,
      handler_person_name: conflict && conflict.assigned_handler_name || null
    };
    if (['pending_origin_review'].includes(handoff.status)) {
      action.department_id = handoff.origin_department_id || null;
      action.department_name = handoff.origin_department || null;
    } else if ([
      'pending_counterparty_scope',
      'pending_counterparty_detail',
      'pending_counterparty_review'
    ].includes(handoff.status)) {
      action.department_id = handoff.counterparty_department_id || null;
      action.department_name = handoff.counterparty_department || null;
    }
    return [action];
  }

  async function getHandoffStory(handoffId, actor) {
    const handoff = await getHandoffContext(handoffId);
    if (!handoff) return null;
    const conflict = await getOpenHandoffConflict(handoff.id);
    const conflictContext = conflict ? {
      ...conflict,
      origin_department_id: handoff.origin_department_id,
      counterparty_department_id: handoff.counterparty_department_id
    } : null;
    const latestConflictRecord = conflict || await getLatestHandoffConflict(handoff.id);
    const latestConflict = latestConflictRecord ? {
      ...latestConflictRecord,
      origin_department_id: handoff.origin_department_id,
      counterparty_department_id: handoff.counterparty_department_id
    } : null;
    const enriched = { ...handoff, ...(conflictContext ? {
      conflict_id: conflictContext.id,
      conflict_status: conflictContext.status,
      assigned_handler_person_id: conflictContext.assigned_handler_person_id
    } : {}) };
    if (!actorCanReadHandoff(enriched, actor)) throw httpError(403, '无权查看该承接故事链');
    const events = await mysqlQuery(pool, `
      SELECT event.*,
             person.person_name AS actor_person_name
      FROM process_design_handoff_events event
      LEFT JOIN person ON person.person_id=event.actor_person_id
      WHERE event.handoff_id=?
      ORDER BY event.id
    `, [handoff.id]);
    const currentStage = handoff.status === 'conflict_open'
      ? conflictStage(conflictContext)
      : handoffStage(handoff.status);
    const lastNormalStageCode = handoff.status === 'conflict_open'
      ? [...events].reverse().map(event => text(event.stage_code))
        .find(stageCode => HANDOFF_STAGES.some(([code]) => code === stageCode))
      : handoff.status;
    const currentStageIndex = HANDOFF_STAGES.findIndex(([code]) => code === lastNormalStageCode);
    const milestones = HANDOFF_STAGES.map(([code, name, responsibleRole], index) => ({
      stage_code: code,
      stage_name: name,
      responsible_role: responsibleRole,
      state: handoff.status === 'confirmed' || handoff.status === 'closed_not_required'
        ? 'completed'
        : currentStageIndex >= 0 && index < currentStageIndex
          ? 'completed'
          : code === lastNormalStageCode
            ? handoff.status === 'conflict_open' ? 'branched' : 'current'
            : 'pending'
    }));
    if (handoff.status === 'conflict_open') {
      milestones.push({
        stage_code: currentStage.code,
        stage_name: currentStage.name,
        responsible_role: currentStage.responsible_role,
        state: 'current'
      });
    }
    return {
      handoff: publicHandoff(handoff),
      current_stage: currentStage,
      next_actions: nextHandoffActions(handoff, conflictContext, currentStage, actor),
      milestones,
      events: events.map(event => ({
        ...event,
        payload: parseJsonObject(event.payload_json)
      })),
      conflict: latestConflict
    };
  }

  async function getHandoffConflictContext(conflictId) {
    const [row] = await mysqlQuery(pool, `
      SELECT conflict.*,
             handoff.status AS handoff_status,
             handoff.handoff_ref,
             handoff.handoff_direction,
             handoff.requested_matter,
             handoff.transfer_data_name,
             handoff.completion_standard,
             draft.process_name,
             draft.document_no,
             CASE
               WHEN handoff.handoff_direction='inbound_prerequisite'
                 THEN COALESCE(handoff.target_department_id, draft.department_id)
               ELSE COALESCE(handoff.source_department_id, draft.department_id)
             END AS origin_department_id,
             CASE
               WHEN handoff.handoff_direction='inbound_prerequisite'
                 THEN handoff.source_department_id
               ELSE handoff.target_department_id
             END AS counterparty_department_id,
             originDept.name AS origin_department,
             counterpartyDept.name AS counterparty_department,
             handler.person_name AS assigned_handler_name
      FROM process_design_handoff_conflicts conflict
      JOIN process_design_cross_dept_handoffs handoff ON handoff.id=conflict.handoff_id
      JOIN process_design_steps step ON step.id=handoff.step_id
      JOIN process_design_drafts draft ON draft.id=step.draft_id
      LEFT JOIN departments originDept ON originDept.id=CASE
        WHEN handoff.handoff_direction='inbound_prerequisite'
          THEN COALESCE(handoff.target_department_id, draft.department_id)
        ELSE COALESCE(handoff.source_department_id, draft.department_id)
      END
      LEFT JOIN departments counterpartyDept ON counterpartyDept.id=CASE
        WHEN handoff.handoff_direction='inbound_prerequisite'
          THEN handoff.source_department_id
        ELSE handoff.target_department_id
      END
      LEFT JOIN person handler ON handler.person_id=conflict.assigned_handler_person_id
      WHERE conflict.id=?
      LIMIT 1
    `, [conflictId]);
    if (!row) return null;
    return { ...row, evidence: parseJsonArray(row.evidence_json) };
  }

  function actorCanReadConflict(conflict, actor) {
    const roles = new Set(arrayItems(actor && actor.roleCodes).map(item => text(item)).filter(Boolean));
    if (roles.has('admin') || roles.has('mdm_lead')) return true;
    if (
      roles.has('data_conflict_handler') &&
      Number(conflict.assigned_handler_person_id || 0) === Number(actor && actor.personId || 0)
    ) return true;
    if (roles.has('decision_group') && conflict.status === 'pending_decision') return true;
    const departmentId = Number(actor && actor.departmentId || 0);
    return roles.has('department_mdm_reviewer') &&
      [Number(conflict.origin_department_id || 0), Number(conflict.counterparty_department_id || 0)].includes(departmentId);
  }

  function actorHasGovernanceRole(actor, roleCode) {
    return arrayItems(actor && actor.roleCodes).map(item => text(item)).includes(roleCode);
  }

  function actorCanActOnConflict(conflict, actor) {
    if (!conflict) return false;
    const departmentId = Number(actor && actor.departmentId || 0);
    if (actorHasGovernanceRole(actor, 'mdm_lead') && conflict.status === 'pending_assignment') return true;
    if (
      actorHasGovernanceRole(actor, 'data_conflict_handler') &&
      Number(conflict.assigned_handler_person_id || 0) === Number(actor && actor.personId || 0)
    ) {
      if (conflict.status === 'coordinating') return true;
      return conflict.status === 'pending_department_confirmation' &&
        [conflict.origin_confirmation, conflict.counterparty_confirmation].includes('rejected');
    }
    if (
      actorHasGovernanceRole(actor, 'department_mdm_reviewer') &&
      conflict.status === 'pending_department_confirmation'
    ) {
      return [Number(conflict.origin_department_id || 0), Number(conflict.counterparty_department_id || 0)]
        .includes(departmentId);
    }
    return actorHasGovernanceRole(actor, 'decision_group') && conflict.status === 'pending_decision';
  }

  async function listHandoffConflictQueue(actor, options = {}) {
    const limit = Math.min(Math.max(Number(options.limit || 100), 1), 200);
    const ids = await mysqlQuery(pool, `
      SELECT id
      FROM process_design_handoff_conflicts
      WHERE status NOT IN ('closed','returned_for_revision')
      ORDER BY updated_at DESC, id DESC
      LIMIT ${limit}
    `);
    const items = [];
    for (const row of ids) {
      const conflict = await getHandoffConflictContext(row.id);
      if (conflict && actorCanReadConflict(conflict, actor)) {
        const roles = new Set(arrayItems(actor && actor.roleCodes).map(item => text(item)).filter(Boolean));
        items.push({
          ...conflict,
          can_act: actorCanActOnConflict(conflict, actor),
          action_role: roles.has('data_conflict_handler') &&
            Number(conflict.assigned_handler_person_id || 0) === Number(actor && actor.personId || 0) &&
            (
              conflict.status === 'coordinating' ||
              conflict.status === 'pending_department_confirmation' &&
                [conflict.origin_confirmation, conflict.counterparty_confirmation].includes('rejected')
            )
            ? 'data_conflict_handler'
            : roles.has('department_mdm_reviewer') ? 'department_mdm_reviewer' : null
        });
      }
    }
    return {
      items,
      total: items.length,
      queue_truth: 'process_design_handoff_conflicts'
    };
  }

  async function assignHandoffConflict(conflict, handlerPersonId, actor, options = {}) {
    const transaction = await runLockedConflictMutation(
      'assignHandoffConflict',
      conflict,
      [handlerPersonId, actor],
      options
    );
    if (transaction.handled) return transaction.result;
    if (!actorHasGovernanceRole(actor, 'mdm_lead')) throw httpError(403, '只有MDM工作组组长可以分派承接冲突');
    if (conflict.status !== 'pending_assignment') throw httpError(409, '当前承接冲突不需要分派处理人');
    await mysqlRun(pool, `
      UPDATE process_design_handoff_conflicts
      SET assigned_handler_person_id=?, status='coordinating', updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending_assignment'
    `, [handlerPersonId, conflict.id]);
    await addHandoffEvent(
      conflict.handoff_id,
      'conflict_assigned',
      'conflict_coordinate',
      actor,
      'MDM工作组组长已分派承接冲突处理人',
      { assigned_handler_person_id: handlerPersonId },
      conflict.id
    );
    return await getHandoffConflictContext(conflict.id);
  }

  async function saveHandoffConflictProposal(conflict, body, actor, options = {}) {
    const transaction = await runLockedConflictMutation(
      'saveHandoffConflictProposal',
      conflict,
      [body, actor],
      options
    );
    if (transaction.handled) return transaction.result;
    if (!actorHasGovernanceRole(actor, 'data_conflict_handler')) throw httpError(403, '只有冲突处理人可以记录协调方案');
    if (Number(conflict.assigned_handler_person_id || 0) !== Number(actor && actor.personId || 0)) {
      throw httpError(403, '只能处理本人被分派的承接冲突');
    }
    if (!['coordinating', 'pending_department_confirmation'].includes(conflict.status)) {
      throw httpError(409, '当前承接冲突不接受协调方案');
    }
    await mysqlRun(pool, `
      UPDATE process_design_handoff_conflicts
      SET origin_position=?, counterparty_position=?, evidence_json=?, proposal_text=?,
          origin_confirmation=NULL, counterparty_confirmation=NULL,
          status='pending_department_confirmation', updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status IN ('coordinating','pending_department_confirmation')
    `, [
      text(body.origin_position),
      text(body.counterparty_position),
      JSON.stringify(arrayItems(body.evidence)),
      text(body.proposal_text),
      conflict.id
    ]);
    await addHandoffEvent(
      conflict.handoff_id,
      'conflict_proposal_recorded',
      'conflict_department_confirmation',
      actor,
      text(body.proposal_text),
      {
        origin_position: text(body.origin_position),
        counterparty_position: text(body.counterparty_position),
        evidence: arrayItems(body.evidence)
      },
      conflict.id
    );
    return await getHandoffConflictContext(conflict.id);
  }

  async function confirmHandoffConflictProposal(conflict, departmentId, accepted, basis, actor, options = {}) {
    const transaction = await runLockedConflictMutation(
      'confirmHandoffConflictProposal',
      conflict,
      [departmentId, accepted, basis, actor],
      options
    );
    if (transaction.handled) return transaction.result;
    if (!actorHasGovernanceRole(actor, 'department_mdm_reviewer')) {
      throw httpError(403, '只有部门MDM审核员可以确认协调方案');
    }
    if (conflict.status !== 'pending_department_confirmation') {
      throw httpError(409, '当前承接冲突不等待部门确认');
    }
    const isOrigin = Number(departmentId) === Number(conflict.origin_department_id);
    const isCounterparty = Number(departmentId) === Number(conflict.counterparty_department_id);
    if (!isOrigin && !isCounterparty) throw httpError(403, '部门审核员只能确认本部门参与的协调方案');
    const field = isOrigin ? 'origin_confirmation' : 'counterparty_confirmation';
    await mysqlRun(pool, `
      UPDATE process_design_handoff_conflicts
      SET ${field}=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending_department_confirmation'
    `, [accepted ? 'accepted' : 'rejected', conflict.id]);
    let updated = await getHandoffConflictContext(conflict.id);
    await addHandoffEvent(
      conflict.handoff_id,
      accepted ? 'conflict_proposal_accepted' : 'conflict_proposal_rejected',
      'conflict_department_confirmation',
      actor,
      basis,
      { department_id: departmentId, accepted: Boolean(accepted) },
      conflict.id
    );
    if (updated.origin_confirmation === 'accepted' && updated.counterparty_confirmation === 'accepted') {
      await mysqlRun(pool, `
        UPDATE process_design_handoff_conflicts
        SET status='closed', closed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [conflict.id]);
      await mysqlRun(pool, `
        UPDATE process_design_cross_dept_handoffs
        SET status='pending_structure_gate', updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND is_current=1
      `, [conflict.handoff_id]);
      await addHandoffEvent(
        conflict.handoff_id,
        'conflict_closed_by_department_consensus',
        'pending_structure_gate',
        actor,
        '双方部门MDM审核员均已确认协调方案',
        null,
        conflict.id
      );
      updated = await getHandoffConflictContext(conflict.id);
    }
    return updated;
  }

  async function escalateHandoffConflict(conflict, basis, actor, options = {}) {
    const transaction = await runLockedConflictMutation(
      'escalateHandoffConflict',
      conflict,
      [basis, actor],
      options
    );
    if (transaction.handled) return transaction.result;
    if (!actorHasGovernanceRole(actor, 'data_conflict_handler')) throw httpError(403, '只有冲突处理人可以提请项目决策');
    if (Number(conflict.assigned_handler_person_id || 0) !== Number(actor && actor.personId || 0)) {
      throw httpError(403, '只能升级本人被分派的承接冲突');
    }
    if (conflict.status !== 'pending_department_confirmation') {
      throw httpError(409, '当前承接冲突不等待提请项目决策');
    }
    if (conflict.origin_confirmation !== 'rejected' && conflict.counterparty_confirmation !== 'rejected') {
      throw httpError(409, '至少一个部门不接受协调方案后才能提请项目决策组');
    }
    await mysqlRun(pool, `
      UPDATE process_design_handoff_conflicts
      SET status='pending_decision', escalated_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending_department_confirmation'
    `, [conflict.id]);
    await addHandoffEvent(
      conflict.handoff_id,
      'conflict_escalated',
      'conflict_decision',
      actor,
      basis,
      null,
      conflict.id
    );
    return await getHandoffConflictContext(conflict.id);
  }

  async function decideHandoffConflict(conflict, decision, basis, actor, options = {}) {
    const transaction = await runLockedConflictMutation(
      'decideHandoffConflict',
      conflict,
      [decision, basis, actor],
      options
    );
    if (transaction.handled) return transaction.result;
    if (!actorHasGovernanceRole(actor, 'decision_group')) throw httpError(403, '只有项目决策组可以处理升级事项');
    if (conflict.status !== 'pending_decision') throw httpError(409, '当前承接冲突不等待项目决策');
    const transition = {
      continue_handoff: ['closed', 'pending_structure_gate'],
      not_required: ['closed', 'closed_not_required'],
      return_revision: ['returned_for_revision', 'returned']
    }[decision];
    if (!transition) throw httpError(422, '项目决策结论无效');
    await mysqlRun(pool, `
      UPDATE process_design_handoff_conflicts
      SET status=?, decision=?, decision_basis=?,
          closed_at=CASE WHEN ?='closed' THEN CURRENT_TIMESTAMP ELSE closed_at END,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending_decision'
    `, [transition[0], decision, basis, transition[0], conflict.id]);
    await mysqlRun(pool, `
      UPDATE process_design_cross_dept_handoffs
      SET status=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND is_current=1
    `, [transition[1], conflict.handoff_id]);
    await addHandoffEvent(
      conflict.handoff_id,
      'conflict_decided',
      transition[1],
      actor,
      basis,
      { decision },
      conflict.id
    );
    return await getHandoffConflictContext(conflict.id);
  }

  async function updateHandoffIssueProjection(handoff, status, note, actor = {}) {
    if (!handoff || !handoff.issue_id) return;
    const mapping = {
      pending_assignment: ['waiting_studio_review', 'pending_studio_review'],
      pending_origin_review: ['waiting_department_review', 'pending_department_review'],
      pending_counterparty_scope: ['waiting_department_review', 'pending_department_review'],
      pending_counterparty_detail: ['waiting_others', 'pending_collaboration'],
      pending_counterparty_review: ['waiting_department_review', 'pending_department_review'],
      pending_structure_gate: ['waiting_studio_review', 'pending_studio_review'],
      confirmed: ['completed', 'closed'],
      closed_not_required: ['closed', 'closed'],
      returned: ['waiting_my_action', 'needs_more_info'],
      conflict_open: ['waiting_mdm_decision', 'pending_mdm_decision'],
      rejected: ['closed', 'not_accepted'],
      escalated: ['waiting_mdm_decision', 'pending_mdm_decision']
    };
    const [displayStatus, pointStatus] = mapping[status] || ['waiting_my_action', 'needs_more_info'];
    await mysqlRun(pool, `
      UPDATE process_governance_issues
      SET display_status=?, closed_at=CASE WHEN ? IN ('completed','closed') THEN CURRENT_TIMESTAMP ELSE NULL END,
          updated_at=CURRENT_TIMESTAMP
      WHERE issue_id=?
    `, [displayStatus, displayStatus, handoff.issue_id]);
    if (handoff.point_id) {
      await mysqlRun(pool, `
        UPDATE process_governance_issue_points
        SET current_step=?, point_status=?, note=COALESCE(?, note), updated_at=CURRENT_TIMESTAMP
        WHERE point_id=?
      `, [status, pointStatus, optionalText(note), handoff.point_id]);
    }
    const eventType = status === 'confirmed' || status === 'closed_not_required'
      ? 'closed'
      : status === 'pending_structure_gate'
        ? 'department_reviewed'
        : status === 'escalated'
          ? 'mdm_decided'
          : status === 'returned'
            ? 'more_info_requested'
            : 'collaboration_answered';
    await mysqlRun(pool, `
      INSERT INTO process_governance_issue_events
        (issue_id, point_id, event_type, actor_user_id, actor_person_id, actor_dept_name, actor_role_code, note, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      handoff.issue_id, handoff.point_id || null, eventType,
      actor.userId || null, actor.personId || null, optionalText(actor.departmentName),
      optionalText(actor.roleCode), optionalText(note), JSON.stringify({ handoff_status: status })
    ]);
  }

  async function createHandoffIssue(draft, processRow, stepRow, candidate, handoffId, status, actor) {
    const issueKey = `handoff-${candidate.candidate_version.slice(0, 24)}-${candidate.handoff_key_hash.slice(0, 24)}`;
    const externalDepartment = candidate.handoff_direction === 'inbound_prerequisite'
      ? text(candidate.source_department)
      : text(candidate.target_department);
    const directionLabel = candidate.handoff_direction === 'inbound_prerequisite' ? '前置输入' : '后续承接';
    const prompt = candidate.handoff_direction === 'inbound_prerequisite'
      ? '请确认是否提供该输入、由哪条流程和行为产生、提供什么数据，以及达到什么标准。'
      : '请确认是否承接该事项、进入哪条流程和行为、办理什么，以及达到什么标准。';
    const displayStatus = status === 'pending_assignment' ? 'waiting_studio_review' : 'waiting_department_review';
    const issueResult = await mysqlRun(pool, `
      INSERT INTO process_governance_issues
        (issue_key, primary_dept_name, owner_dept_name, source_layer, source_type,
         source_ref_table, source_ref_id, l1_name, l2_name, l3_name, a1_name,
         title, what_text, why_text, where_text, who_text, when_text, how_text, how_much_text,
         display_status, priority_score)
      VALUES (?, ?, ?, 'procedure', 'handoff_acceptance',
              'process_design_cross_dept_handoffs', ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, '', ?, 70)
    `, [
      issueKey, draft.department_name || candidate.owning_department, externalDepartment || null,
      String(handoffId), processRow.l1_name, processRow.l2_name, processRow.l3_name,
      stepRow.step_name, `${directionLabel}：${candidate.requested_matter || candidate.transfer_data_name || '跨部门交界对象'}`,
      candidate.requested_matter || candidate.transfer_data_name || '待补充交界对象',
      candidate.trigger_condition || '待补充触发条件',
      `${candidate.source_department || '待明确部门'} → ${candidate.target_department || '待明确部门'}`,
      externalDepartment || '待MDM工作组组长分派',
      candidate.trigger_condition || '待补充',
      candidate.completion_standard || '待补充完成标准',
      displayStatus
    ]);
    const issueId = issueResult.insertId;
    const pointResult = await mysqlRun(pool, `
      INSERT INTO process_governance_issue_points
        (issue_id, point_key, point_type, title, prompt_text, enum_options_json,
         current_step, point_status, requires_studio_review)
      VALUES (?, ?, 'handoff_acceptance', ?, ?, ?, ?, ?, 1)
    `, [
      issueId, `${issueKey}-acceptance`, `${directionLabel}承接确认`, prompt,
      JSON.stringify(['分派责任部门', '确认承接', '说明不属于本部门', '退回补充', '提请争议处理']),
      status, status === 'pending_assignment' ? 'pending_studio_review' : 'pending_department_review'
    ]);
    const pointId = pointResult.insertId;
    const participants = [
      ['department_reviewer', draft.department_name || candidate.owning_department, 'department_mdm_reviewer', '审核归口部门候选关系'],
      ['studio_reviewer', null, 'mdm_lead', status === 'pending_assignment' ? '分派责任部门' : '执行结构卡口']
    ];
    if (externalDepartment) {
      participants.push(
        ['collaborator', externalDepartment, 'department_contact', '补充本部门实际承接内容'],
        ['department_reviewer', externalDepartment, 'department_mdm_reviewer', '记录本部门审核决定']
      );
    }
    for (const [participantType, departmentName, roleCode, actionLabel] of participants) {
      await mysqlRun(pool, `
        INSERT INTO process_governance_issue_participants
          (issue_id, point_id, participant_type, dept_name, role_code, can_view, can_act, action_label, action_status)
        VALUES (?, ?, ?, ?, ?, 1, 1, ?, 'waiting')
      `, [issueId, pointId, participantType, departmentName, roleCode, actionLabel]);
    }
    await mysqlRun(pool, `
      INSERT INTO process_governance_issue_events
        (issue_id, point_id, event_type, actor_user_id, actor_person_id, actor_dept_name, actor_role_code, note, payload_json)
      VALUES (?, ?, 'created', ?, ?, ?, 'department_mdm_reviewer', ?, ?)
    `, [
      issueId, pointId, actor.userId || null, actor.personId || null, optionalText(actor.departmentName),
      '3001跨部门承接关系已审核导入并生成待办',
      JSON.stringify({ handoff_id: handoffId, handoff_ref: candidate.handoff_ref, candidate_version: candidate.candidate_version })
    ]);
    return { issueId, pointId };
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
            related_departments_json, department_id, schema_version, l1_status, l2_status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', '现场实际', '', 0, ?, ?, ?, 'unclassified', 'unclassified', ?)
      `, [
        document.id, document.document_no, document.document_title, plannedEdition, currentVersion.id, document.document_no,
        document.document_title, jsonArray([]), targetDeptId || document.owning_department_id,
        PROCESS_GOVERNANCE_SCHEMA_VERSION, actorUserId
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
    async personHasActiveRole(personId, roleCode) {
      const [row] = await mysqlQuery(pool, `
        SELECT pr.person_role_id
        FROM person_roles pr
        JOIN roles role ON role.role_id=pr.role_id
        JOIN person person ON person.person_id=pr.person_id
        WHERE pr.person_id=?
          AND role.role_code=?
          AND pr.status='active'
          AND person.status='active'
        LIMIT 1
      `, [personId, roleCode]);
      return Boolean(row);
    },
    getDraft,
    getDraftByTerm,
    getDraftByProcess,
    getDraftByStep,
    getDraftByHandoff,
    getHandoff,
    getHandoffContext,
    hasHandoffParticipant,
    listHandoffQueue,
    getHandoffStory,
    getHandoffConflictContext,
    listHandoffConflictQueue,
    openHandoffConflict,
    assignHandoffConflict,
    saveHandoffConflictProposal,
    confirmHandoffConflictProposal,
    escalateHandoffConflict,
    decideHandoffConflict,
    getDraftByForm,
    getDraftByFormTable,
    getDraftByFormTableField,
    getDraftByField,
    getDraftByEvidence,
    getDocumentById,
    async getVersionContent(versionId) {
      const [version] = await mysqlQuery(pool, `
        SELECT id, draft_id, document_id, document_no, document_title, edition, version_no,
               department_id, schema_version, process_content_json, content_json, content_hash,
               source_revision_no, status, published_at, effective_at, supersedes_version_id
        FROM process_design_versions
        WHERE id=?
        LIMIT 1
      `, [versionId]);
      if (!version) return null;
      const rawContent = version.process_content_json || version.content_json;
      return {
        process_version_id: Number(version.id),
        draft_id: Number(version.draft_id),
        document_id: Number(version.document_id),
        document_no: version.document_no,
        document_title: version.document_title,
        edition: version.edition,
        version_no: version.version_no,
        department_id: Number(version.department_id),
        schema_version: text(version.schema_version),
        content_hash: text(version.content_hash) || null,
        source_revision_no: version.source_revision_no == null ? null : Number(version.source_revision_no),
        status: version.status,
        published_at: version.published_at,
        effective_at: version.effective_at,
        supersedes_version_id: version.supersedes_version_id == null ? null : Number(version.supersedes_version_id),
        document: rawContent ? parseJsonObject(rawContent) : null
      };
    },
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
    publicationGovernanceReadiness,
    outcomeForDraft,
    detail: detailForDraft,
    async listCanonicalDrafts(departmentIds, options = {}) {
      const limit = Math.min(Math.max(Number(options.limit || 50), 1), 200);
      const params = [];
      let where = 'WHERE d.status<>\'published\'';
      if (departmentIds) {
        if (!departmentIds.length) return [];
        where += ` AND d.department_id IN (${departmentIds.map(() => '?').join(',')})`;
        params.push(...departmentIds);
      }
      return await mysqlQuery(pool, `
        SELECT d.id, d.document_no, d.document_title, d.process_name, d.status,
               d.schema_version, d.content_hash, d.revision_no,
               d.department_id, dept.name AS department_name,
               d.content_updated_at, d.updated_at
        FROM process_design_drafts d
        LEFT JOIN departments dept ON dept.id=d.department_id
        ${where}
        ORDER BY d.updated_at DESC, d.id DESC
        LIMIT ${limit}
      `, params);
    },
    async canonicalContent(draft) {
      if (text(draft.process_content_json)) {
        const candidate = parseJsonObject(draft.process_content_json);
        const normalized = normalizeProcessGovernanceDocument(candidate);
        if (!normalized.errors.length) {
          return {
            source: 'draft_canonical_json',
            schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION,
            content_hash: normalized.content_hash,
            revision: Number(draft.revision_no || 0),
            document: normalized.document
          };
        }
      }
      const [imported] = await mysqlQuery(pool, `
        SELECT normalized_json, normalized_schema_version, content_hash
        FROM process_design_structured_imports
        WHERE draft_id=?
        ORDER BY import_id DESC
        LIMIT 1
      `, [draft.id]);
      if (imported && text(imported.normalized_json)) {
        const candidate = parseJsonObject(imported.normalized_json);
        const normalized = normalizeProcessGovernanceDocument(candidate);
        if (!normalized.errors.length) {
          return {
            source: 'structured_import',
            schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION,
            content_hash: normalized.content_hash,
            revision: Number(draft.revision_no || 0),
            document: normalized.document
          };
        }
      }
      const [version] = await mysqlQuery(pool, `
        SELECT schema_version, process_content_json, content_json, content_hash, source_revision_no
        FROM process_design_versions
        WHERE draft_id=? OR id=?
        ORDER BY id DESC
        LIMIT 1
      `, [draft.id, draft.base_version_id || 0]);
      const versionValue = version && (version.process_content_json || version.content_json);
      if (versionValue) {
        const candidate = parseJsonObject(versionValue);
        const normalized = normalizeProcessGovernanceDocument(candidate);
        if (!normalized.errors.length) {
          return {
            source: version.process_content_json ? 'published_canonical_json' : 'published_version_conversion',
            schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION,
            content_hash: normalized.content_hash,
            revision: Number(version.source_revision_no || draft.revision_no || 0),
            document: normalized.document
          };
        }
        return {
          source: 'manual_conversion_required',
          schema_version: null,
          content_hash: null,
          revision: Number(draft.revision_no || 0),
          document: null,
          errors: normalized.errors
        };
      }
      return {
        source: 'empty_template',
        schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION,
        content_hash: null,
        revision: Number(draft.revision_no || 0),
        document: createEmptyProcessGovernanceDocument({
          process_ref: `draft_${draft.id}`,
          process_name: draft.process_name,
          owning_department: draft.department_name
        })
      };
    },
    async saveCanonicalContent(draft, documentInput, expectedRevision, actorUserId, options = {}) {
      if (!options.__tx && typeof pool.getConnection === 'function') {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const txRepo = makeProcessDesignMysqlRepository(connection);
          const lockedDraft = await txRepo.getDraft(draft.id);
          const result = await txRepo.saveCanonicalContent(
            lockedDraft,
            documentInput,
            expectedRevision,
            actorUserId,
            { ...options, __tx: true }
          );
          await connection.commit();
          return result;
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }
      const expected = Number(expectedRevision);
      if (!Number.isInteger(expected) || expected < 0) {
        throw httpError(422, '校验失败', {
          error: '校验失败',
          details: [{ field: 'expected_revision', message: '保存草稿必须携带当前修订号' }]
        });
      }
      const normalized = normalizeProcessGovernanceDocument(documentInput);
      if (normalized.errors.length) {
        throw httpError(422, '单流程治理JSON不符合结构规则', {
          error: '单流程治理JSON不符合结构规则',
          code: 'PROCESS_GOVERNANCE_CONTENT_INVALID',
          details: normalized.errors
        });
      }
      const currentContent = await this.canonicalContent(draft);
      if (
        Number(draft.revision_no || 0) === expected &&
        currentContent.content_hash &&
        currentContent.content_hash === normalized.content_hash
      ) {
        return {
          changed: false,
          revision: expected,
          content_hash: normalized.content_hash,
          schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION,
          document: normalized.document,
          warnings: normalized.warnings
        };
      }
      const result = await mysqlRun(pool, `
        UPDATE process_design_drafts
        SET schema_version=?, process_content_json=?, content_hash=?,
            revision_no=revision_no+1, content_updated_by=?,
            content_updated_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND revision_no=?
      `, [
        PROCESS_GOVERNANCE_SCHEMA_VERSION,
        JSON.stringify(normalized.document),
        normalized.content_hash,
        actorUserId || null,
        draft.id,
        expected
      ]);
      if (!Number(result.affectedRows || 0)) {
        const latest = await getDraft(draft.id);
        throw httpError(409, '草稿已被其他人员修改，请重新载入后再保存', {
          error: '草稿已被其他人员修改，请重新载入后再保存',
          code: 'DRAFT_REVISION_CONFLICT',
          expected_revision: expected,
          current_revision: Number(latest && latest.revision_no || 0),
          actual_revision: Number(latest && latest.revision_no || 0)
        });
      }
      const updated = await getDraft(draft.id);
      const actor = options.actor || {
        userId: actorUserId || null,
        personId: null,
        departmentId: draft.department_id,
        departmentName: draft.department_name,
        roleCodes: ['department_contact'],
        roleCode: 'department_contact'
      };
      const preview = previewProcessGovernanceDocument(normalized.document);
      await this.importProcessGovernanceCandidate(
        preview,
        {
          decisionBasis: 'MDM流程治理编制保存',
          voidedHandoffs: options.voidedHandoffs
        },
        actor,
        {
          __tx: true,
          targetDraft: updated,
          skipCanonicalUpdate: true,
          skipImportAudit: true
        }
      );
      await addEvent(draft.id, 'canonical_content_saved', actorUserId, '已保存单流程治理JSON草稿', {
        schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION,
        content_hash: normalized.content_hash,
        revision_no: updated.revision_no
      });
      return {
        changed: true,
        revision: Number(updated.revision_no),
        content_hash: normalized.content_hash,
        schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION,
        document: normalized.document,
        warnings: normalized.warnings,
        governance_projection: 'synced'
      };
    },
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
            schema_version, l1_name, l2_name, l3_name, l1_status, l2_status, created_by)
        VALUES (?, ?, ?, 'A', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        document.id, documentNo, documentTitle, documentNo,
        text(body.process_name), text(body.reason), text(body.basis_type), text(body.basis_description),
        boolInt(body.involves_other_departments), jsonArray(body.related_departments),
        targetDeptId, proxyDeptId || null, optionalText(body.proxy_reason),
        PROCESS_GOVERNANCE_SCHEMA_VERSION,
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
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_processes WHERE draft_id=?', [draft.id]);
      const procedureCode = await nextProcedureCode(draft.id);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_processes
          (draft_id, process_code, process_type, l1_name, l2_name, l3_name, description, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, procedureCode, processType,
        text(body.l1_name), text(body.l2_name), text(body.l3_name),
        optionalText(body.description), body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'process_added', actorUserId, `已补充流程：${text(body.l3_name)}`, objectEventPayload('process', result.insertId, text(body.l3_name), 'added'));
      return await getById('process_design_processes', result.insertId);
    },
    async updateProcess(draft, processId, body, actorUserId) {
      const current = await getById('process_design_processes', processId);
      if (!current || Number(current.draft_id) !== Number(draft.id)) throw httpError(404, '流程不存在');
      const processType = PROCESS_TYPES.has(text(body.process_type)) ? text(body.process_type) : 'new';
      await mysqlRun(pool, `
        UPDATE process_design_processes
        SET process_type=?, l1_name=?, l2_name=?, l3_name=?, description=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [
        processType, text(body.l1_name), text(body.l2_name), text(body.l3_name),
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
      const stepType = STEP_TYPES.has(text(body.step_type)) ? text(body.step_type) : 'action';
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_steps WHERE draft_id=? AND process_id=?', [draft.id, processId]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_steps
          (draft_id, process_id, step_type, step_name, actor_role, timing, input_materials, output_result, need_confirmation,
           related_departments, basis, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, processId, stepType, text(body.step_name), optionalText(body.actor_role), optionalText(body.timing),
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
      if (Object.prototype.hasOwnProperty.call(body, 'step_type')) {
        sets.push('step_type=?');
        params.push(STEP_TYPES.has(text(body.step_type)) ? text(body.step_type) : 'action');
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_steps SET ${sets.join(', ')} WHERE id=?`, [...params, stepId]);
        await addEvent(draft.id, 'step_updated', actorUserId, `已修改业务行为：${text(body.step_name) || text(current.step_name)}`, objectEventPayload('step', stepId, text(body.step_name) || text(current.step_name), 'updated'));
      }
      return await getById('process_design_steps', stepId);
    },
    async createStepTransition(draft, body, actorUserId) {
      const processId = Number(body.process_id || 0);
      const fromStepId = Number(body.from_step_id || 0);
      const toStepId = body.to_step_id == null ? null : Number(body.to_step_id || 0);
      const [fromStep] = await mysqlQuery(pool, 'SELECT id, draft_id, process_id, step_type FROM process_design_steps WHERE id=? AND draft_id=?', [fromStepId, draft.id]);
      if (!fromStep || Number(fromStep.process_id) !== processId || text(fromStep.step_type) !== 'decision') {
        throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'from_step_id', message: '判断分支必须从同一流程内的判断节点发出' }] });
      }
      if (toStepId) {
        const [toStep] = await mysqlQuery(pool, 'SELECT id, process_id FROM process_design_steps WHERE id=? AND draft_id=?', [toStepId, draft.id]);
        if (!toStep || Number(toStep.process_id) !== processId) {
          throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'to_step_id', message: '判断分支流向必须属于同一流程' }] });
        }
      }
      const [processRow] = await mysqlQuery(pool, 'SELECT id FROM process_design_processes WHERE id=? AND draft_id=?', [processId, draft.id]);
      if (!processRow) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'process_id', message: '判断分支必须归属同一制度流程' }] });
      if (!text(body.condition_text)) {
        throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'condition_text', message: '判断分支必须填写条件' }] });
      }
      const [orderRow] = await mysqlQuery(pool, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM process_design_step_transitions WHERE draft_id=? AND process_id=?', [draft.id, processId]);
      const result = await mysqlRun(pool, `
        INSERT INTO process_design_step_transitions
          (draft_id, process_id, from_step_id, condition_text, to_step_id, evidence_refs_json, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        draft.id, processId, fromStepId, text(body.condition_text), toStepId || null,
        JSON.stringify(arrayItems(body.evidence_refs).map(item => text(item)).filter(Boolean)),
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'step_transition_added', actorUserId, `已导入判断分支：${text(body.condition_text)}`, objectEventPayload('step_transition', result.insertId, text(body.condition_text), 'added'));
      return await getById('process_design_step_transitions', result.insertId);
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
    async importProcessGovernanceCandidate(preview, review, actor, options = {}) {
      if (!options.__tx && typeof pool.getConnection === 'function') {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const txRepo = makeProcessDesignMysqlRepository(connection);
          const result = await txRepo.importProcessGovernanceCandidate(
            preview,
            review,
            actor,
            { ...options, __tx: true }
          );
          await connection.commit();
          return result;
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }

      const document = preview.document;
      const process = document.process || {};
      const processRef = text(process.process_ref);
      const contentHashValue = text(preview.content_hash);
      const [existingImport] = await mysqlQuery(pool, `
        SELECT *
        FROM process_design_structured_imports
        WHERE source_process_ref=? AND content_hash=?
        LIMIT 1
      `, [processRef, contentHashValue]);
      if (existingImport && !options.skipImportAudit) {
        await mysqlRun(pool, `
          UPDATE process_design_drafts
          SET schema_version=?, process_content_json=COALESCE(process_content_json, ?),
              content_hash=COALESCE(content_hash, ?),
              revision_no=CASE WHEN revision_no<1 THEN 1 ELSE revision_no END,
              content_updated_by=COALESCE(content_updated_by, ?),
              content_updated_at=COALESCE(content_updated_at, CURRENT_TIMESTAMP)
          WHERE id=?
        `, [
          PROCESS_GOVERNANCE_SCHEMA_VERSION,
          JSON.stringify(document),
          contentHashValue,
          actor.userId || null,
          existingImport.draft_id
        ]);
        const existingDraft = await getDraft(existingImport.draft_id);
        const existingHandoffs = await mysqlQuery(pool, `
          SELECT *
          FROM process_design_cross_dept_handoffs
          WHERE draft_id=? AND source_process_ref=? AND source_content_hash=? AND is_current=1
          ORDER BY sort_order, id
        `, [existingImport.draft_id, processRef, contentHashValue]);
        return {
          idempotent: true,
          import_id: Number(existingImport.import_id),
          draft: existingDraft,
          handoffs: existingHandoffs.map(publicHandoff),
          content_hash: contentHashValue
        };
      }

      const [owningDepartment] = await mysqlQuery(pool, `
        SELECT id, name, final_responsible_person_id
        FROM departments
        WHERE name=? AND status='active'
        LIMIT 1
      `, [text(process.owning_department)]);
      if (!owningDepartment) {
        throw httpError(422, '校验失败', {
          error: '校验失败',
          details: [{ field: 'process.owning_department', message: '归口部门不在3000当前有效部门中' }]
        });
      }
      if (Number(owningDepartment.id) !== Number(actor.departmentId)) {
        throw httpError(403, '部门MDM审核员只能审核导入本人部门的流程');
      }

      const [latestImport] = await mysqlQuery(pool, `
        SELECT *
        FROM process_design_structured_imports
        WHERE source_process_ref=?
        ORDER BY import_id DESC
        LIMIT 1
        FOR UPDATE
      `, [processRef]);
      let draft = options.targetDraft || (latestImport ? await getDraft(latestImport.draft_id) : null);
      if (draft && draft.status === 'published') {
        const next = await this.createNextEditionDraft(draft.document_id, actor.userId, owningDepartment.id);
        draft = next.draft || next;
      }
      if (!draft) {
        const stableDocumentNo = `PG-${processRef}`.slice(0, 128);
        draft = await this.createDraft({
          document_no: stableDocumentNo,
          document_title: text(process.process_name),
          process_name: text(process.process_name),
          reason: '3001结构化流程经部门审核后导入',
          basis_type: '现场实际',
          basis_description: text(review.decisionBasis),
          involves_other_departments: preview.handoff_candidates.length > 0,
          related_departments: preview.handoff_candidates.flatMap(candidate => [
            candidate.handoff_direction === 'inbound_prerequisite'
              ? candidate.source_department
              : candidate.target_department
          ]).map(text).filter(Boolean),
          l1_name: optionalText(process.capability_domain),
          l2_name: optionalText(process.business_capability),
          l3_name: optionalText(process.process_name)
        }, actor.userId, owningDepartment.id, null);
        draft = draft.draft || draft;
      } else if (!EDITABLE_DRAFT_STATUSES.has(draft.status || 'draft')) {
        await mysqlRun(pool, `
          UPDATE process_design_drafts
          SET status='needs_changes', updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [draft.id]);
        draft = await getDraft(draft.id);
      }
      await mysqlRun(pool, `
        UPDATE process_design_drafts
        SET l1_status=?, l2_status=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [
        text(process.classification_status) === 'confirmed' && text(process.capability_domain) ? 'confirmed' : 'unclassified',
        text(process.classification_status) === 'confirmed' && text(process.business_capability) ? 'confirmed' : 'unclassified',
        draft.id
      ]);
      if (text(process.purpose) && text(process.scope)) {
        await this.saveDocumentProfile(draft, {
          document_title: text(process.process_name),
          document_no: text(draft.document_no),
          purpose: text(process.purpose),
          scope: text(process.scope),
          inheritance_relation: null
        }, actor.userId);
      }

      let [processRow] = await mysqlQuery(pool, `
        SELECT *
        FROM process_design_processes
        WHERE draft_id=? AND source_process_ref=?
        LIMIT 1
      `, [draft.id, processRef]);
      const processPayload = {
        l1_name: text(process.capability_domain) || '待确认能力域',
        l2_name: text(process.business_capability) || '待确认业务能力',
        l3_name: text(process.process_name),
        process_type: 'new',
        description: `来源：${PROCESS_GOVERNANCE_SCHEMA_VERSION}；流程标识：${processRef}`
      };
      if (!processRow) {
        processRow = await this.createProcess(draft, processPayload, actor.userId);
        await mysqlRun(pool, 'UPDATE process_design_processes SET source_process_ref=? WHERE id=?', [processRef, processRow.id]);
        processRow = await getById('process_design_processes', processRow.id);
      } else {
        processRow = await this.updateProcess(draft, processRow.id, processPayload, actor.userId);
      }

      const candidateAnchors = new Set(preview.handoff_candidates.map(item => text(item.anchor_behavior_ref)).filter(Boolean));
      const stepByRef = new Map();
      for (let index = 0; index < arrayItems(document.behaviors).length; index += 1) {
        const behavior = document.behaviors[index] || {};
        const behaviorRef = text(behavior.behavior_ref);
        let [stepRow] = await mysqlQuery(pool, `
          SELECT *
          FROM process_design_steps
          WHERE draft_id=? AND source_behavior_ref=?
          LIMIT 1
        `, [draft.id, behaviorRef]);
        const stepPayload = {
          process_id: processRow.id,
          step_type: text(behavior.node_type) === 'decision' ? 'decision' : 'action',
          step_name: text(behavior.behavior_name),
          actor_role: optionalText(behavior.current_actor_role),
          timing: optionalText(behavior.timing),
          input_materials: optionalText(behavior.input_description),
          output_result: optionalText(behavior.output_description),
          need_confirmation: false
        };
        if (!stepRow) {
          stepRow = await this.createStep(draft, stepPayload, actor.userId);
          await mysqlRun(pool, 'UPDATE process_design_steps SET source_behavior_ref=? WHERE id=?', [behaviorRef, stepRow.id]);
          stepRow = await getById('process_design_steps', stepRow.id);
        } else {
          stepRow = await this.updateStep(draft, stepRow.id, stepPayload, actor.userId);
        }
        stepByRef.set(behaviorRef, stepRow);
        await this.saveBehaviorDetail(draft, stepRow.id, {
          precondition: optionalText(behavior.precondition),
          trigger_scene: optionalText(behavior.trigger),
          execution_standard: optionalText(behavior.completion_standard),
          delivery_object: optionalText(behavior.output_description),
          requires_approval: text(behavior.node_type) === 'approval',
          approval_note: null,
          is_cross_department: candidateAnchors.has(behaviorRef)
        }, actor.userId);
      }

      const importedHandoffs = [];
      for (let index = 0; index < preview.handoff_candidates.length; index += 1) {
        const candidate = {
          ...preview.handoff_candidates[index],
          owning_department: text(process.owning_department),
          candidate_version: contentHash(preview.handoff_candidates[index]),
          handoff_key_hash: contentHash(text(preview.handoff_candidates[index].handoff_ref))
        };
        const stepRow = stepByRef.get(text(candidate.anchor_behavior_ref));
        if (!stepRow) {
          throw httpError(422, '校验失败', {
            error: '校验失败',
            details: [{ field: `cross_department_handoffs.${index}.anchor_behavior_ref`, message: '本流程锚点不存在' }]
          });
        }
        const inbound = candidate.handoff_direction === 'inbound_prerequisite';
        const externalDepartmentName = inbound ? text(candidate.source_department) : text(candidate.target_department);
        const [externalDepartment] = externalDepartmentName
          ? await mysqlQuery(pool, `
              SELECT id, name, final_responsible_person_id
              FROM departments
              WHERE name=? AND status='active'
              LIMIT 1
            `, [externalDepartmentName])
          : [];
        const sourceDepartmentId = inbound ? externalDepartment && externalDepartment.id : owningDepartment.id;
        const targetDepartmentId = inbound ? owningDepartment.id : externalDepartment && externalDepartment.id;
        const [previous] = await mysqlQuery(pool, `
          SELECT *
          FROM process_design_cross_dept_handoffs
          WHERE draft_id=? AND handoff_ref=? AND is_current=1
          ORDER BY revision_no DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `, [draft.id, text(candidate.handoff_ref)]);
        if (previous && text(previous.candidate_version) === candidate.candidate_version) {
          importedHandoffs.push(previous);
          continue;
        }
        if (previous) {
          await mysqlRun(pool, `
            UPDATE process_design_cross_dept_handoffs
            SET is_current=0, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
          `, [previous.id]);
          if (previous.issue_id) {
            await mysqlRun(pool, `
              UPDATE process_governance_issues
              SET display_status='closed', closed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
              WHERE issue_id=?
            `, [previous.issue_id]);
            await mysqlRun(pool, `
              UPDATE process_governance_issue_participants
              SET can_act=0, action_status='done', updated_at=CURRENT_TIMESTAMP
              WHERE issue_id=?
            `, [previous.issue_id]);
          }
        }
        const initialStatus = candidate.counterparty_resolution === 'needs_identification' || !externalDepartment
          ? 'pending_assignment'
          : 'pending_origin_review';
        const result = await mysqlRun(pool, `
          INSERT INTO process_design_cross_dept_handoffs
            (step_id, draft_id, handoff_ref, handoff_direction, anchor_behavior_ref,
             counterparty_resolution, source_department_id, source_department,
             target_department_id, target_department, transfer_data_ref, transfer_data_name,
             requested_matter, trigger_condition, completion_standard,
             counterparty_process_ref, counterparty_process_name,
             counterparty_behavior_ref, counterparty_behavior_name,
             requires_return, returned_data_ref, returned_data_name,
             resume_behavior_ref, resume_step_id,
             target_process_name, target_behavior_name, handoff_standard,
             status, source_schema_version, source_process_ref, source_content_hash,
             candidate_version, revision_no, is_current, supersedes_handoff_id,
             sort_order, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `, [
          stepRow.id, draft.id, text(candidate.handoff_ref), candidate.handoff_direction,
          text(candidate.anchor_behavior_ref), candidate.counterparty_resolution,
          sourceDepartmentId || null, text(candidate.source_department),
          targetDepartmentId || null, text(candidate.target_department),
          optionalText(candidate.transfer_data_ref), optionalText(candidate.transfer_data_name),
          optionalText(candidate.requested_matter), optionalText(candidate.trigger_condition),
          optionalText(candidate.completion_standard),
          optionalText(candidate.counterparty_process_ref), optionalText(candidate.counterparty_process_name),
          optionalText(candidate.counterparty_behavior_ref), optionalText(candidate.counterparty_behavior_name),
          boolInt(candidate.requires_return), optionalText(candidate.returned_data_ref),
          optionalText(candidate.returned_data_name), optionalText(candidate.resume_behavior_ref),
          candidate.resume_behavior_ref && stepByRef.get(text(candidate.resume_behavior_ref))
            ? stepByRef.get(text(candidate.resume_behavior_ref)).id
            : null,
          optionalText(candidate.counterparty_process_name), optionalText(candidate.counterparty_behavior_name),
          optionalText(candidate.completion_standard), initialStatus,
          text(preview.source_schema_version), processRef, contentHashValue, candidate.candidate_version,
          previous ? Number(previous.revision_no || 1) + 1 : 1,
          previous && previous.id || null, index + 1, actor.userId
        ]);
        await addHandoffEvent(
          result.insertId,
          'handoff_candidate_created',
          initialStatus,
          actor,
          '单流程治理JSON经部门审核后生成承接治理投影',
          {
            handoff_ref: candidate.handoff_ref,
            candidate_version: candidate.candidate_version,
            source_content_hash: contentHashValue
          }
        );
        importedHandoffs.push(await getById('process_design_cross_dept_handoffs', result.insertId));
      }

      const currentHandoffRefs = new Set(preview.handoff_candidates.map(candidate => text(candidate.handoff_ref)));
      const removedHandoffs = await mysqlQuery(pool, `
        SELECT *
        FROM process_design_cross_dept_handoffs
        WHERE draft_id=? AND source_process_ref=? AND is_current=1
        FOR UPDATE
      `, [draft.id, processRef]);
      const voidReasons = new Map(arrayItems(review.voidedHandoffs).map(item => [
        text(item && item.handoff_ref),
        text(item && item.reason)
      ]));
      for (const removed of removedHandoffs.filter(item => !currentHandoffRefs.has(text(item.handoff_ref)))) {
        const [decisionCount, conflictCount] = await Promise.all([
          mysqlQuery(pool, `
            SELECT COUNT(*) AS count
            FROM governance_decision_records
            WHERE subject_type='cross_dept_handoff' AND subject_id=?
          `, [String(removed.id)]),
          mysqlQuery(pool, 'SELECT COUNT(*) AS count FROM process_design_handoff_conflicts WHERE handoff_id=?', [removed.id])
        ]);
        const hasGovernanceHistory = !['pending_assignment', 'pending_origin_review'].includes(text(removed.status)) ||
          Boolean(removed.issue_id) ||
          Number(decisionCount[0] && decisionCount[0].count || 0) > 0 ||
          Number(conflictCount[0] && conflictCount[0].count || 0) > 0;
        const reason = voidReasons.get(text(removed.handoff_ref));
        if (hasGovernanceHistory && !reason) {
          throw httpError(409, '已有治理记录的承接不能直接删除，必须填写作废原因', {
            error: '已有治理记录的承接不能直接删除，必须填写作废原因',
            code: 'HANDOFF_VOID_REASON_REQUIRED',
            handoff_ref: text(removed.handoff_ref)
          });
        }
        await mysqlRun(pool, `
          UPDATE process_design_cross_dept_handoffs
          SET is_current=0, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [removed.id]);
        await addHandoffEvent(
          removed.id,
          'handoff_voided',
          'voided',
          actor,
          reason || '编制内容已删除；该承接尚未进入部门处理',
          { handoff_ref: removed.handoff_ref, source_content_hash: contentHashValue }
        );
      }

      if (!options.skipCanonicalUpdate) {
        await mysqlRun(pool, `
          UPDATE process_design_drafts
          SET schema_version=?, process_content_json=?, content_hash=?,
              revision_no=revision_no+1, content_updated_by=?,
              content_updated_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [
          PROCESS_GOVERNANCE_SCHEMA_VERSION,
          JSON.stringify(document),
          contentHashValue,
          actor.userId || null,
          draft.id
        ]);
      }
      let importResult = null;
      if (!options.skipImportAudit) {
        importResult = await mysqlRun(pool, `
          INSERT INTO process_design_structured_imports
            (source_process_ref, source_schema_version, normalized_schema_version, content_hash,
             draft_id, review_basis, normalized_json, approved_by_user_id, approved_by_person_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          processRef, text(preview.source_schema_version), PROCESS_GOVERNANCE_SCHEMA_VERSION,
          contentHashValue, draft.id, text(review.decisionBasis), JSON.stringify(document),
          actor.userId || null, actor.personId
        ]);
      }
      await addEvent(
        draft.id,
        options.skipImportAudit ? 'canonical_governance_projection_synced' : 'structured_output_approved_import',
        actor.userId,
        options.skipImportAudit ? '单流程治理JSON已同步治理投影' : '3001结构化流程已通过部门审核并导入',
        {
          import_id: importResult && importResult.insertId || null,
          source_schema_version: preview.source_schema_version,
          normalized_schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION,
          content_hash: contentHashValue,
          handoff_count: importedHandoffs.length,
          governance_warnings: preview.warnings
        }
      );
      return {
        idempotent: false,
        import_id: importResult ? Number(importResult.insertId) : null,
        draft: await getDraft(draft.id),
        handoffs: importedHandoffs.map(publicHandoff),
        content_hash: contentHashValue
      };
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
        optionalText(body.handoff_standard), 'pending_origin_review',
        body.sort_order ? Number(body.sort_order) : Number(orderRow.next_order || 1), actorUserId
      ]);
      await addEvent(draft.id, 'cross_dept_handoff_requested', actorUserId, `已发起跨部门承接：${text(body.target_department)}`);
      return await getById('process_design_cross_dept_handoffs', result.insertId);
    },
    async acceptHandoffReturn(draft, handoffId, body, actorUserId) {
      await mysqlRun(pool, `
        UPDATE process_design_cross_dept_handoffs
        SET target_process_code=?, target_process_name=?, target_behavior_code=?, target_behavior_name=?,
            status='pending_counterparty_review', returned_by=?, returned_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
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
        throw httpError(422, '校验失败', {
          error: '校验失败',
          details: [{ field: 'status', message: '承接状态只能通过承接待办动作变更' }]
        });
      }
      if (sets.length) {
        sets.push('updated_at=CURRENT_TIMESTAMP');
        await mysqlRun(pool, `UPDATE process_design_cross_dept_handoffs SET ${sets.join(', ')} WHERE id=?`, [...params, handoffId]);
        await addEvent(draft.id, 'cross_dept_handoff_updated', actorUserId, '已更新跨部门承接');
      }
      return await getById('process_design_cross_dept_handoffs', handoffId);
    },
    async assignHandoffCounterparty(handoff, department, actor, options = {}) {
      const transaction = await runLockedHandoffMutation(
        'assignHandoffCounterparty',
        handoff,
        [department, actor],
        options
      );
      if (transaction.handled) return transaction.result;
      if (!actorCanActOnHandoff(handoff, actor)) throw httpError(403, '当前人员不是该承接待办的可操作参与人');
      if (handoff.status !== 'pending_assignment') throw httpError(409, '当前承接不需要分派责任部门');
      const inbound = text(handoff.handoff_direction) === 'inbound_prerequisite';
      const sets = inbound
        ? 'source_department_id=?, source_department=?'
        : 'target_department_id=?, target_department=?';
      await mysqlRun(pool, `
        UPDATE process_design_cross_dept_handoffs
        SET ${sets}, counterparty_resolution='identified', status='pending_origin_review',
            updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND is_current=1
      `, [department.id, department.name, handoff.id]);
      if (handoff.issue_id) {
        for (const [participantType, roleCode, actionLabel] of [
          ['collaborator', 'department_contact', '补充本部门实际承接内容'],
          ['department_reviewer', 'department_mdm_reviewer', '记录本部门审核决定']
        ]) {
          await mysqlRun(pool, `
            INSERT INTO process_governance_issue_participants
              (issue_id, point_id, participant_type, dept_name, role_code, can_view, can_act, action_label, action_status)
            VALUES (?, ?, ?, ?, ?, 1, 1, ?, 'waiting')
          `, [handoff.issue_id, handoff.point_id || null, participantType, department.name, roleCode, actionLabel]);
        }
      }
      const updated = await getHandoffContext(handoff.id);
      await addHandoffEvent(
        handoff.id,
        'counterparty_assigned',
        'pending_origin_review',
        actor,
        `已分派给${department.name}`,
        { department_id: department.id, department_name: department.name }
      );
      await updateHandoffIssueProjection(updated, 'pending_origin_review', `已分派给${department.name}`, actor);
      return updated;
    },
    async saveHandoffCounterpartyResponse(handoff, body, actor, options = {}) {
      const transaction = await runLockedHandoffMutation(
        'saveHandoffCounterpartyResponse',
        handoff,
        [body, actor],
        options
      );
      if (transaction.handled) return transaction.result;
      if (!actorCanActOnHandoff(handoff, actor)) throw httpError(403, '当前人员不是该承接待办的可操作参与人');
      if (handoff.status !== 'pending_counterparty_detail') {
        throw httpError(409, '当前承接不等待外部门补充实际内容');
      }
      const fields = {
        counterparty_process_ref: optionalText(body.counterparty_process_ref),
        counterparty_process_name: text(body.counterparty_process_name),
        counterparty_behavior_ref: optionalText(body.counterparty_behavior_ref),
        counterparty_behavior_name: text(body.counterparty_behavior_name),
        transfer_data_ref: optionalText(body.transfer_data_ref || handoff.transfer_data_ref),
        transfer_data_name: optionalText(body.transfer_data_name || handoff.transfer_data_name),
        requested_matter: optionalText(body.requested_matter || handoff.requested_matter),
        completion_standard: optionalText(body.completion_standard || handoff.completion_standard),
        returned_data_ref: optionalText(body.returned_data_ref || handoff.returned_data_ref),
        returned_data_name: optionalText(body.returned_data_name || handoff.returned_data_name)
      };
      await mysqlRun(pool, `
        UPDATE process_design_cross_dept_handoffs
        SET counterparty_process_ref=?, counterparty_process_name=?,
            counterparty_behavior_ref=?, counterparty_behavior_name=?,
            transfer_data_ref=?, transfer_data_name=?, requested_matter=?,
            completion_standard=?, returned_data_ref=?, returned_data_name=?,
            target_process_name=?, target_behavior_name=?,
            status='pending_counterparty_review', returned_by=?, returned_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND is_current=1
      `, [
        fields.counterparty_process_ref, fields.counterparty_process_name,
        fields.counterparty_behavior_ref, fields.counterparty_behavior_name,
        fields.transfer_data_ref, fields.transfer_data_name, fields.requested_matter,
        fields.completion_standard, fields.returned_data_ref, fields.returned_data_name,
        fields.counterparty_process_name, fields.counterparty_behavior_name,
        actor.userId || null, handoff.id
      ]);
      const updated = await getHandoffContext(handoff.id);
      await addHandoffEvent(
        handoff.id,
        'counterparty_detail_completed',
        'pending_counterparty_review',
        actor,
        '外部门联系人已补充实际承接内容',
        fields
      );
      await updateHandoffIssueProjection(updated, 'pending_counterparty_review', '外部门联系人已补充实际承接内容', actor);
      return updated;
    },
    async recordHandoffDepartmentDecision(handoff, department, body, actor, options = {}) {
      const transaction = await runLockedHandoffMutation(
        'recordHandoffDepartmentDecision',
        handoff,
        [department, body, actor],
        options
      );
      if (transaction.handled) return transaction.result;
      if (!actorCanActOnHandoff(handoff, actor)) throw httpError(403, '当前人员不是该承接待办的可操作参与人');
      const latest = (await mysqlQuery(pool, `
        SELECT decision_record_id
        FROM governance_decision_records
        WHERE subject_domain='process'
          AND subject_type='cross_dept_handoff'
          AND subject_id=?
          AND subject_version=?
          AND department_id=?
        ORDER BY decision_record_id DESC
        LIMIT 1
      `, [String(handoff.id), text(handoff.candidate_version), department.id]))[0];
      const requestedDecision = text(body.decision);
      const storedDecision = requestedDecision === 'not_required' ? 'rejected' : requestedDecision;
      const result = await mysqlRun(pool, `
        INSERT INTO governance_decision_records
          (subject_domain, subject_type, subject_id, subject_version, department_id,
           accountable_person_id, recorded_by_person_id, decision, decision_basis,
           evidence_reference, decided_at, supersedes_decision_record_id)
        VALUES ('process', 'cross_dept_handoff', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `, [
        String(handoff.id), text(handoff.candidate_version), department.id,
        department.final_responsible_person_id, actor.personId, storedDecision,
        text(body.decision_basis), optionalText(body.evidence_reference),
        latest && latest.decision_record_id || null
      ]);
      let nextStatus = handoff.status;
      const isOrigin = Number(department.id) === Number(handoff.origin_department_id);
      if (requestedDecision === 'rejected' || requestedDecision === 'not_required') {
        const conflict = await openHandoffConflict(handoff, text(body.decision_basis), actor);
        const updatedConflictHandoff = await getHandoffContext(handoff.id);
        await updateHandoffIssueProjection(updatedConflictHandoff, 'conflict_open', text(body.decision_basis), actor);
        return {
          handoff: updatedConflictHandoff,
          decision_record_id: Number(result.insertId),
          conflict
        };
      } else if (requestedDecision === 'returned') {
        if (handoff.status === 'pending_counterparty_scope') nextStatus = 'pending_origin_review';
        else if (handoff.status === 'pending_counterparty_review') nextStatus = 'pending_counterparty_detail';
        else nextStatus = 'returned';
      }
      else if (isOrigin && handoff.status === 'pending_origin_review') nextStatus = 'pending_counterparty_scope';
      else if (!isOrigin && handoff.status === 'pending_counterparty_scope') nextStatus = 'pending_counterparty_detail';
      else if (!isOrigin && handoff.status === 'pending_counterparty_review') nextStatus = 'pending_structure_gate';
      else {
        throw httpError(409, '当前承接状态不接受该部门决定');
      }
      await mysqlRun(pool, `
        UPDATE process_design_cross_dept_handoffs
        SET status=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND is_current=1
      `, [nextStatus, handoff.id]);
      const updated = await getHandoffContext(handoff.id);
      await addHandoffEvent(
        handoff.id,
        requestedDecision === 'returned' ? 'handoff_returned' : 'department_decision_recorded',
        nextStatus,
        actor,
        text(body.decision_basis),
        {
          department_id: department.id,
          decision: requestedDecision,
          decision_record_id: Number(result.insertId)
        }
      );
      await updateHandoffIssueProjection(updated, nextStatus, text(body.decision_basis), actor);
      return { handoff: updated, decision_record_id: Number(result.insertId) };
    },
    async runHandoffStructureGate(handoff, body, actor, options = {}) {
      const transaction = await runLockedHandoffMutation(
        'runHandoffStructureGate',
        handoff,
        [body, actor],
        options
      );
      if (transaction.handled) return transaction.result;
      if (!actorCanActOnHandoff(handoff, actor)) throw httpError(403, '当前人员不是该承接待办的可操作参与人');
      if (handoff.status !== 'pending_structure_gate') {
        throw httpError(409, '当前承接不等待MDM结构卡口处理');
      }
      const action = text(body.action);
      if (action === 'returned') {
        await mysqlRun(pool, "UPDATE process_design_cross_dept_handoffs SET status='pending_counterparty_review', updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_current=1", [handoff.id]);
        const updated = await getHandoffContext(handoff.id);
        await addHandoffEvent(handoff.id, 'structure_gate_returned', 'pending_counterparty_review', actor, text(body.note), null);
        await updateHandoffIssueProjection(updated, 'pending_counterparty_review', text(body.note), actor);
        return updated;
      }
      if (action === 'escalated') {
        const conflict = await openHandoffConflict(handoff, text(body.note) || 'MDM结构卡口提请争议处理', actor);
        const updated = await getHandoffContext(handoff.id);
        await updateHandoffIssueProjection(updated, 'conflict_open', text(body.note), actor);
        return { handoff: updated, conflict };
      }
      const departmentIds = [handoff.origin_department_id, handoff.counterparty_department_id]
        .map(Number).filter(Boolean);
      const departments = departmentIds.length
        ? await mysqlQuery(pool, `
            SELECT id, name, final_responsible_person_id
            FROM departments
            WHERE id IN (${departmentIds.map(() => '?').join(',')}) AND status='active'
          `, departmentIds)
        : [];
      const missing = [];
      for (const department of departments) {
        if (!department.final_responsible_person_id) {
          missing.push(`${department.name}尚未配置最终责任人`);
          continue;
        }
        const [decision] = await mysqlQuery(pool, `
          SELECT decision, accountable_person_id
          FROM governance_decision_records
          WHERE subject_domain='process'
            AND subject_type='cross_dept_handoff'
            AND subject_id=?
            AND subject_version=?
            AND department_id=?
          ORDER BY decision_record_id DESC
          LIMIT 1
        `, [String(handoff.id), text(handoff.candidate_version), department.id]);
        if (!decision || decision.decision !== 'approved') missing.push(`${department.name}尚未形成有效同意决定`);
        else if (Number(decision.accountable_person_id) !== Number(department.final_responsible_person_id)) {
          missing.push(`${department.name}最终责任人已变化，需要重新记录决定`);
        }
      }
      if (departments.length !== 2) missing.push('承接双方责任部门尚未完整落位');
      if (!text(handoff.anchor_behavior_ref)) missing.push('本流程锚点未落位');
      if (!text(handoff.transfer_data_ref) && !text(handoff.requested_matter)) missing.push('传递数据和承接事项均未说明');
      if (!text(handoff.trigger_condition) && !text(handoff.completion_standard)) missing.push('触发条件和完成标准均未说明');
      if (missing.length) {
        throw httpError(409, '承接关系尚未通过结构卡口', {
          error: '承接关系尚未通过结构卡口',
          details: missing
        });
      }
      await mysqlRun(pool, "UPDATE process_design_cross_dept_handoffs SET status='confirmed', updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_current=1", [handoff.id]);
      const updated = await getHandoffContext(handoff.id);
      await addHandoffEvent(
        handoff.id,
        'structure_gate_confirmed',
        'confirmed',
        actor,
        text(body.note) || '结构、证据和双方决定均已通过检查',
        null
      );
      await updateHandoffIssueProjection(updated, 'confirmed', text(body.note) || '结构、证据和双方决定均已通过检查', actor);
      return updated;
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
      const structureCode = text(table.table_code) || text(table.table_no) || formatFormStructureCode('FM-UNSET-A-001', structureKind);
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
      const isV7 = text(draft.schema_version) === 'process-governance-v7';
      if (isV7) await validateFormalV7Draft(draft);
      await mysqlRun(pool, `
        UPDATE process_design_drafts
        SET status='submitted', submitted_by=?, submitted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [actorUserId, draft.id]);
      const taskResult = isV7
        ? await mysqlRun(pool, `
          INSERT INTO process_design_review_tasks
            (draft_id, draft_revision_no, content_hash, task_type, assignee_role, created_by)
          VALUES (?, ?, ?, 'department_review', 'department_mdm_reviewer', ?)
        `, [draft.id, Number(draft.revision_no), draft.content_hash, actorUserId])
        : await mysqlRun(pool, `
          INSERT INTO process_design_review_tasks (draft_id, task_type, assignee_role, created_by)
          VALUES (?, 'department_review', 'department_mdm_reviewer', ?)
        `, [draft.id, actorUserId]);
      await addEvent(draft.id, 'submitted', actorUserId, optionalText(note) || '已提交审核');
      const updated = await getDraft(draft.id);
      return {
        draft: updated,
        reviewTask: await getById('process_design_review_tasks', taskResult.insertId),
        outcome: isV7 ? {
          formed: '已形成原生V7正式草稿',
          current: '当前V7正文已提交部门审核',
          missing: [],
          next: '部门审核员核对当前修订号和内容摘要后记录审核结论'
        } : await outcomeForDraft(updated)
      };
    },
    async getReviewTask(taskId) {
      return await getById('process_design_review_tasks', taskId);
    },
    async decideReviewTask(task, decision, note, actorUserId) {
      if (text(task && task.status) !== 'pending') {
        throw httpError(409, '该审核任务已经处理，不能重复记录结论', {
          error: '该审核任务已经处理，不能重复记录结论',
          code: 'REVIEW_TASK_ALREADY_DECIDED'
        });
      }
      const statusByDecision = { approve: 'approved', reject: 'rejected', needs_changes: 'needs_changes' };
      const nextStatus = statusByDecision[decision];
      const draft = await getDraft(task.draft_id);
      if (!draft) throw httpError(404, '制度结构草稿不存在');
      if (text(draft.schema_version) === 'process-governance-v7') {
        if (
          Number(task.draft_revision_no) !== Number(draft.revision_no) ||
          text(task.content_hash) !== text(draft.content_hash)
        ) {
          throw httpError(409, '审核任务绑定的V7正文已经过期，请重新提交当前修订', {
            error: '审核任务绑定的V7正文已经过期，请重新提交当前修订',
            code: 'V7_REVIEW_CONTENT_STALE'
          });
        }
        await validateFormalV7Draft(draft);
      }
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
      if (text(draft.schema_version) === 'process-governance-v7') {
        const [lockedDraftRow] = await mysqlQuery(pool, 'SELECT * FROM process_design_drafts WHERE id=? FOR UPDATE', [draft.id]);
        const lockedDraft = publicDraft(lockedDraftRow);
        if (!lockedDraft) throw httpError(404, '制度结构草稿不存在');
        if (text(lockedDraft.status) !== 'approved') {
          throw httpError(409, '正式V7草稿尚未通过部门审核，不能发布', {
            error: '正式V7草稿尚未通过部门审核，不能发布',
            code: 'V7_FORMAL_REVIEW_REQUIRED'
          });
        }
        if (!lockedDraft.document_id) {
          throw httpError(409, '正式V7草稿必须关联明确的流程主档', {
            error: '正式V7草稿必须关联明确的流程主档',
            code: 'V7_DOCUMENT_LINK_REQUIRED'
          });
        }
        const [document] = await mysqlQuery(pool, 'SELECT * FROM process_design_documents WHERE id=? FOR UPDATE', [lockedDraft.document_id]);
        if (!document || text(document.status) !== 'active') {
          throw httpError(409, '正式流程主档不存在或已停用，不能发布', {
            error: '正式流程主档不存在或已停用，不能发布',
            code: 'V7_FORMAL_DOCUMENT_NOT_FOUND'
          });
        }
        let currentVersion = null;
        if (document.current_version_id) {
          [currentVersion] = await mysqlQuery(pool, 'SELECT * FROM process_design_versions WHERE id=? FOR UPDATE', [document.current_version_id]);
          if (!currentVersion || Number(currentVersion.document_id) !== Number(document.id)) {
            throw httpError(409, '正式流程主档的当前版本指针无效，不能发布', {
              error: '正式流程主档的当前版本指针无效，不能发布',
              code: 'V7_FORMAL_CURRENT_VERSION_INVALID'
            });
          }
        } else {
          const [unexpectedVersion] = await mysqlQuery(pool, `
            SELECT * FROM process_design_versions
            WHERE document_id=? AND status='published'
            ORDER BY effective_at DESC, id DESC
            LIMIT 1
            FOR UPDATE
          `, [document.id]);
          if (unexpectedVersion) {
            throw httpError(409, '正式流程主档存在版本但缺少当前版本指针，不能发布', {
              error: '正式流程主档存在版本但缺少当前版本指针，不能发布',
              code: 'V7_FORMAL_CURRENT_VERSION_INVALID'
            });
          }
        }
        const reviewTasks = await mysqlQuery(pool, `
          SELECT * FROM process_design_review_tasks
          WHERE draft_id=?
          ORDER BY id DESC
          FOR UPDATE
        `, [lockedDraft.id]);
        const approvedReview = reviewTasks.find(task =>
          text(task.status) === 'approved' &&
          Number(task.draft_revision_no) === Number(lockedDraft.revision_no) &&
          text(task.content_hash) === text(lockedDraft.content_hash)
        );
        if (!approvedReview) {
          throw httpError(409, '没有找到绑定当前修订号和内容摘要的审核通过记录', {
            error: '没有找到绑定当前修订号和内容摘要的审核通过记录',
            code: 'V7_REVIEW_CONTENT_STALE'
          });
        }
        const formalSource = await validateFormalV7Draft(lockedDraft);
        if (text(document.process_ref) !== text(formalSource.preview.processRef)) {
          throw httpError(409, '正式流程主档与V7正文的process_ref不一致', {
            error: '正式流程主档与V7正文的process_ref不一致',
            code: 'V7_FORMAL_PROCESS_REF_CONFLICT'
          });
        }
        const expectedEdition = currentVersion ? nextEdition(currentVersion.edition) : 'A';
        const plannedEdition = text(lockedDraft.planned_edition) || expectedEdition;
        if (plannedEdition !== expectedEdition) {
          throw httpError(409, '制度版次不连续，不能跳号', {
            error: '制度版次不连续，不能跳号',
            expected_edition: expectedEdition,
            planned_edition: plannedEdition
          });
        }
        if (currentVersion && Number(lockedDraft.base_version_id || 0) !== Number(currentVersion.id)) {
          throw httpError(409, '当前有效版次已变化，请重新提升最新V7修订');
        }
        const versionNo = documentVersionNo(document.document_no, plannedEdition);
        const result = await mysqlRun(pool, `
          INSERT INTO process_design_versions
            (draft_id, document_id, document_no, document_title, edition, version_no,
             department_id, l1_name, l2_name, l3_name, content_json,
             schema_version, process_content_json, content_hash, source_revision_no,
             published_by, effective_at, supersedes_version_id, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL,
                  'process-governance-v7', ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'published')
        `, [
          lockedDraft.id,
          document.id,
          document.document_no,
          document.document_title,
          plannedEdition,
          versionNo,
          lockedDraft.department_id,
          lockedDraft.process_content_json,
          lockedDraft.content_hash,
          Number(lockedDraft.revision_no),
          actorUserId,
          currentVersion && currentVersion.id || null
        ]);
        if (currentVersion) {
          await mysqlRun(pool, "UPDATE process_design_versions SET status='superseded' WHERE id=?", [currentVersion.id]);
        }
        await mysqlRun(pool, `
          UPDATE process_design_drafts
          SET status='published', active_document_no=NULL, published_by=?,
              published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [actorUserId, lockedDraft.id]);
        await mysqlRun(pool, `
          UPDATE process_design_documents
          SET document_title=?, current_edition=?, current_version_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `, [document.document_title, plannedEdition, result.insertId, actorUserId, document.id]);
        const version = await getById('process_design_versions', result.insertId);
        await addEvent(lockedDraft.id, 'publish', actorUserId, optionalText(note) || '已发布原生V7流程版本', {
          process_version_id: Number(version.id),
          schema_version: 'process-governance-v7',
          content_hash: lockedDraft.content_hash,
          source_revision_no: Number(lockedDraft.revision_no),
          document_no: document.document_no,
          edition: plannedEdition,
          supersedes_version_id: currentVersion && currentVersion.id || null
        });
        const publishedDraft = await getDraft(lockedDraft.id);
        return {
          draft: publishedDraft,
          version,
          process_version_id: Number(version.id),
          outcome: {
            formed: '已形成不可变的原生V7正式版本',
            current: `当前正式版本为${versionNo}`,
            missing: [],
            next: '后续治理对象应绑定process_version_id，不读取原始3001文件或预览案例'
          }
        };
      }
      const details = await publishValidationDetails(draft);
      if (details.length) {
        throw httpError(details.includes(VERIFIED_EVIDENCE_MESSAGE) ? 409 : 422, '校验失败', { error: '校验失败', details });
      }
      const governanceReadiness = await publicationGovernanceReadiness(draft);
      if (!governanceReadiness.ready) {
        const responsibilityIncomplete = governanceReadiness.missingDepartments.length > 0 ||
          governanceReadiness.incompleteDepartments.length > 0;
        throw httpError(409, responsibilityIncomplete ? '责任链不完整，不能发布' : '阻断问题尚未关闭，不能发布', {
          error: responsibilityIncomplete ? '责任链不完整，不能发布' : '阻断问题尚未关闭，不能发布',
          code: responsibilityIncomplete ? 'RESPONSIBILITY_CHAIN_INCOMPLETE' : 'PUBLISH_BLOCKED',
          governanceReadiness
        });
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
           department_id, l1_name, l2_name, l3_name, content_json,
           schema_version, process_content_json, content_hash, source_revision_no,
           published_by, effective_at, supersedes_version_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'published')
      `, [
        draft.id, document.id, draft.document_no, draft.document_title || draft.process_name,
        plannedEdition, versionNo, draft.department_id, draft.l1_name || '', draft.l2_name || '', draft.l3_name || '',
        JSON.stringify(content),
        text(draft.schema_version) || PROCESS_GOVERNANCE_SCHEMA_VERSION,
        draft.process_content_json || null,
        draft.content_hash || null,
        Number(draft.revision_no || 0),
        actorUserId,
        currentVersion && currentVersion.id || null
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
      return {
        draft: publishedDraft,
        version,
        process_version_id: Number(version.id),
        outcome: await outcomeForDraft(publishedDraft)
      };
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
      await ensureProcessDesignStepTransitionSchema(pool);
      await applyCrossDeptHandoffV2(pool);
      await applyProcessGovernanceUnified(pool);
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

async function currentPermSet(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet || new Set();
}

async function hasCurrentPermission(req, permissionCode) {
  return (await currentPermSet(req)).has(permissionCode);
}

async function canViewAcrossDepartments(req) {
  return await hasCurrentPermission(req, 'governance:read-global');
}

async function authorizedDepartmentIds(req) {
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
  if (await canViewAcrossDepartments(req)) return;
  const deptIds = await authorizedDepartmentIds(req);
  if (deptIds.has(Number(draft.department_id)) && await hasCurrentPermission(req, 'governance:read-department')) return;
  throw httpError(403, '无权查看该制度结构草稿');
}

async function assertCanEditDraft(req, repo, draft) {
  await assertCanViewDraft(req, repo, draft);
  assertAdminCannotWrite(await currentRoleCodes(req));
  if (draft.status === 'published') throw httpError(409, '已发布流程不能直接修改草稿');
  const deptIds = await authorizedDepartmentIds(req);
  if (
    deptIds.has(Number(draft.department_id)) &&
    await hasCurrentPermission(req, 'governance:draft-department')
  ) return;
  throw httpError(403, '无权维护该制度结构草稿');
}

async function assertCanEditDraftContent(req, repo, draft) {
  await assertCanEditDraft(req, repo, draft);
  if (!EDITABLE_DRAFT_STATUSES.has(draft.status || 'draft')) {
    throw httpError(409, '当前状态只读，需要退回修改或新建变更版本');
  }
}

async function assertCanReview(req, repo, draft) {
  await assertCanViewDraft(req, repo, draft);
  assertAdminCannotWrite(await currentRoleCodes(req));
  const deptIds = await authorizedDepartmentIds(req);
  if (
    deptIds.has(Number(draft.department_id)) &&
    await hasCurrentPermission(req, 'governance:review-department')
  ) return;
  throw httpError(403, '无权审核该制度结构草稿');
}

async function assertCanVerifyEvidenceStatus(req) {
  const perms = await currentPermSet(req);
  if (perms.has('governance:structure-gate')) return;
  throw httpError(403, '无权核验证据状态');
}

async function assertCanReturnHandoff(req, repo, draft, handoff) {
  if (!handoff) throw httpError(404, '跨部门承接不存在');
  if (!await hasCurrentPermission(req, 'governance:draft-department')) {
    throw httpError(403, '跨部门承接结果只能由承接部门主对接人回写');
  }
  const department = req.session.departmentId ? await getDepartmentByIdAsync(req.session.departmentId) : null;
  const departmentName = department && (department.name || department.department_name);
  if (departmentName && text(departmentName) === text(handoff.target_department)) return;
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

function structuredOutputDepartmentName(data) {
  const draft = data && data.draft || {};
  const department = draft.department || {};
  const profile = data && data.document_profile || {};
  const meta = data && data.structure_block_projection && data.structure_block_projection.meta || {};
  return firstText(
    draft.department_name,
    department.department_name,
    department.name,
    profile.department_name,
    meta.dept_name
  );
}

async function currentRoleCodes(req) {
  const rows = await getUserRoleCodesAsync(req.session.personId || req.session.userId, req.session.role);
  return new Set(arrayItems(rows).map(item => text(item && (item.code || item.role_code))).filter(Boolean));
}

async function currentDepartmentIdentity(req) {
  const department = req.session.departmentId
    ? await getDepartmentByIdAsync(Number(req.session.departmentId))
    : null;
  return department
    ? { id: Number(department.id || department.department_id), name: text(department.name || department.department_name) }
    : null;
}

function assertAdminCannotWrite(roleCodes) {
  if (roleCodes.has('admin')) throw httpError(403, '管理员对治理材料只读，不能执行承接业务写入');
}

async function processGovernancePreview(req) {
  const source = structuredOutputData(req.body || {});
  const preview = previewProcessGovernanceDocument(source);
  if (preview.errors.length) {
    throw httpError(422, '校验失败', { error: '校验失败', details: preview.errors });
  }
  const department = await currentDepartmentIdentity(req);
  const canReadGlobal = await canViewAcrossDepartments(req);
  if (!canReadGlobal && (!department || department.name !== text(preview.document.process.owning_department))) {
    throw httpError(403, '只能预览本人部门归口的流程');
  }
  return preview;
}

async function requireCurrentRole(req, expectedRole) {
  const roleCodes = await currentRoleCodes(req);
  assertAdminCannotWrite(roleCodes);
  if (!roleCodes.has(expectedRole)) throw httpError(403, `当前操作仅限${expectedRole}角色`);
  return roleCodes;
}

function handoffActor(req, roleCodes, department, roleCode) {
  return {
    userId: req.session.userId || null,
    personId: req.session.personId || req.session.userId,
    departmentId: department && department.id || null,
    departmentName: department && department.name || null,
    roleCodes: [...roleCodes],
    roleCode
  };
}

async function currentGovernanceActor(req, roleCode = null) {
  const roleCodes = await currentRoleCodes(req);
  const department = await currentDepartmentIdentity(req);
  return handoffActor(req, roleCodes, department, roleCode);
}

async function assertHandoffParticipant(repo, handoff, actor) {
  if (!handoff) throw httpError(404, '跨部门承接不存在');
  if (!handoff.is_current) throw httpError(409, '该承接版本已被新修订替代');
  if (!await repo.hasHandoffParticipant(handoff, actor)) {
    throw httpError(403, '当前人员不是该承接待办的可操作参与人');
  }
}

router.get('/summary', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  let deptIds = null;
  if (!await canViewAcrossDepartments(req)) {
    deptIds = Array.from(await authorizedDepartmentIds(req));
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
  if (!await hasCurrentPermission(req, 'governance:draft-department')) return false;
  const allowed = await authorizedDepartmentIds(req);
  return Boolean(document && allowed.has(Number(document.owning_department_id)));
}

async function structuredImportTargetDepartment(req, repo, data) {
  const draft = data && data.draft || {};
  let requestedDeptId = Number(draft.department_id || draft.department && draft.department.department_id || 0) || null;
  const requestedDeptName = structuredOutputDepartmentName(data);
  if (!requestedDeptId && requestedDeptName) {
    const department = await getDepartmentByNameAsync(requestedDeptName);
    if (!department) {
      throw httpError(422, '校验失败', {
        error: '校验失败',
        details: [{ field: 'department.department_name', message: '结构化文件中的归口部门不存在' }]
      });
    }
    requestedDeptId = Number(department.id || department.department_id || 0) || null;
  }
  const sessionDeptId = req.session.departmentId ? Number(req.session.departmentId) : null;
  const targetDeptId = requestedDeptId || sessionDeptId;
  if (!targetDeptId) throw httpError(400, '请先维护人员组织信息后再导入结构化文件');
  if (!await repo.departmentExists(targetDeptId)) {
    throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'department_id', message: '所属部门不存在' }] });
  }
  if (!await hasCurrentPermission(req, 'governance:draft-department')) throw httpError(403, '无权导入制度结构草稿');
  if (requestedDeptId && requestedDeptId !== sessionDeptId) throw httpError(403, '部门主对接人只能为本人部门导入制度结构草稿');
  const allowed = await authorizedDepartmentIds(req);
  if (!allowed.has(Number(targetDeptId))) throw httpError(403, '无权为该部门导入制度结构草稿');
  return {
    targetDeptId,
    proxyDeptId: null
  };
}

function structuredOutputProcessRows(data, draftPayload) {
  const rows = arrayItems(data && data.processes);
  if (rows.length) return rows;
  if (text(draftPayload.l1_name) || text(draftPayload.l2_name) || text(draftPayload.l3_name)) {
    return [{
      process_ref: 'proc_1',
      process_type: 'new',
      l1_name: draftPayload.l1_name,
      l2_name: draftPayload.l2_name,
      l3_name: draftPayload.l3_name,
      description: null
    }];
  }
  return [];
}

async function validateStructuredOutputProcesses(repo, processRows, scope) {
  const details = [];
  for (let index = 0; index < processRows.length; index += 1) {
    const process = processRows[index] || {};
    if (!firstText(process.l1_name, process.l2_name, process.l3_name)) continue;
    if (!text(process.l1_name)) details.push({ field: `processes.${index}.l1_name`, message: '请选择已有 L1 能力域' });
    if (!text(process.l2_name)) details.push({ field: `processes.${index}.l2_name`, message: '请选择已有 L2 业务能力' });
    if (!text(process.l3_name)) details.push({ field: `processes.${index}.l3_name`, message: 'L3 流程不能为空' });
    if (text(process.l1_name) && text(process.l2_name)) {
      const taxonomyErrors = await taxonomyValidationDetails(repo, process, scope);
      taxonomyErrors.forEach(error => details.push({ ...error, field: `processes.${index}.${error.field}` }));
    }
  }
  return details;
}

async function createStructuredImportDraft(req, repo, data, draftPayload, target) {
  const lookup = await repo.lookupDocument(draftPayload.document_no);
  if (lookup && lookup.exists && !(await canMaintainDocument(req, lookup.document))) {
    throw httpError(403, '该制度编号已存在，不属于当前可维护范围。');
  }
  if (lookup && lookup.active_draft) {
    throw httpError(409, '该制度编号已有进行中草稿', {
      error: '该制度编号已有进行中草稿',
      active_draft: lookup.active_draft
    });
  }
  if (lookup && lookup.current_version && lookup.document && lookup.document.id) {
    const result = await repo.createNextEditionDraft(lookup.document.id, req.session.userId, target.targetDeptId);
    const draft = result.draft || result;
    const updatePayload = {
      process_name: draftPayload.process_name,
      reason: draftPayload.reason,
      basis_type: draftPayload.basis_type,
      basis_description: draftPayload.basis_description,
      involves_other_departments: draftPayload.involves_other_departments,
      related_departments: draftPayload.related_departments,
      l1_name: draftPayload.l1_name,
      l2_name: draftPayload.l2_name,
      l3_name: draftPayload.l3_name
    };
    return await repo.updateDraft(draft, updatePayload, req.session.userId);
  }
  return await repo.createDraft({
    ...draftPayload,
    department_id: target.targetDeptId,
    proxy_reason: target.proxyDeptId ? '导入结构化输出文件' : null
  }, req.session.userId, target.targetDeptId, target.proxyDeptId);
}

async function importStructuredOutput(req, repo, body) {
  const data = structuredOutputData(body);
  if (!data || text(data.schema_version) !== STRUCTURED_OUTPUT_SCHEMA_VERSION) {
    throw httpError(422, '校验失败', {
      error: '校验失败',
      details: [{ field: 'schema_version', message: `结构化文件必须使用 ${STRUCTURED_OUTPUT_SCHEMA_VERSION}` }]
    });
  }
  const target = await structuredImportTargetDepartment(req, repo, data);
  const draftPayload = structuredOutputDraftPayload(data);
  const details = draftRequiredErrors(draftPayload);
  const taxonomyScope = await taxonomyScopeForDepartmentId(target.targetDeptId);
  details.push(...await taxonomyValidationDetails(repo, draftPayload, taxonomyScope));
  const processRows = structuredOutputProcessRows(data, draftPayload);
  details.push(...await validateStructuredOutputProcesses(repo, processRows, taxonomyScope));
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });

  let created = await createStructuredImportDraft(req, repo, data, draftPayload, target);
  let draft = created.draft || created;
  const counts = importCounts();
  const warnings = [];
  const maps = {
    processes: new Map(),
    steps: new Map(),
    stepRows: new Map(),
    forms: new Map(),
    tables: new Map(),
    fields: new Map()
  };

  const profilePayload = structuredOutputProfilePayload(data, draftPayload);
  if (profilePayload.purpose && profilePayload.scope) {
    await repo.saveDocumentProfile(draft, profilePayload, req.session.userId);
  } else if (profilePayload.purpose || profilePayload.scope || profilePayload.inheritance_relation) {
    pushImportWarning(warnings, 'document_profile', 0, '制度目的和适用范围不完整，已先导入草稿，请在页面补齐制度说明。');
  }

  for (let index = 0; index < arrayItems(data.terms).length; index += 1) {
    const term = data.terms[index] || {};
    if (!text(term.term_name) || !text(term.definition)) {
      pushImportWarning(warnings, 'terms', index, '术语名称或定义为空，未导入该术语。');
      continue;
    }
    await repo.createTerm(draft, {
      term_name: term.term_name,
      definition: term.definition,
      applies_to: optionalText(term.applies_to)
    }, req.session.userId);
    counts.terms += 1;
  }

  const processRefFallbacks = [];
  for (let index = 0; index < processRows.length; index += 1) {
    const process = processRows[index] || {};
    if (!firstText(process.l1_name, process.l2_name, process.l3_name)) continue;
    const createdProcess = await repo.createProcess(draft, {
      l1_name: process.l1_name,
      l2_name: process.l2_name,
      l3_name: process.l3_name,
      process_type: enumValue(process.process_type, PROCESS_TYPES, 'new'),
      description: optionalText(process.description)
    }, req.session.userId);
    const key = refKey(process.process_ref, `process:${index}`);
    maps.processes.set(key, createdProcess.id);
    processRefFallbacks.push({ key, id: createdProcess.id });
    counts.processes += 1;
  }

  const stepRefFallbacks = [];
  for (let index = 0; index < arrayItems(data.steps).length; index += 1) {
    const step = data.steps[index] || {};
    const processId = maps.processes.get(text(step.process_ref)) || processRefFallbacks[0] && processRefFallbacks[0].id;
    if (!processId || !text(step.step_name)) {
      pushImportWarning(warnings, 'steps', index, '业务行为缺少所属流程或行为名称，未导入该行为。');
      continue;
    }
    const stepType = STEP_TYPES.has(text(step.step_type)) ? text(step.step_type) : 'action';
    const createdStep = await repo.createStep(draft, {
      process_id: processId,
      step_type: stepType,
      step_name: step.step_name,
      actor_role: optionalText(step.actor_role),
      timing: optionalText(step.timing),
      input_materials: optionalText(step.input_materials),
      output_result: optionalText(step.output_result),
      need_confirmation: false
    }, req.session.userId);
    const key = refKey(step.step_ref, `step:${index}`);
    maps.steps.set(key, createdStep.id);
    maps.stepRows.set(key, { id: createdStep.id, processId, stepType });
    stepRefFallbacks.push({ key, id: createdStep.id });
    counts.steps += 1;
  }

  for (let index = 0; index < arrayItems(data.behavior_details).length; index += 1) {
    const detail = data.behavior_details[index] || {};
    const stepId = maps.steps.get(text(detail.step_ref));
    if (!stepId) {
      pushImportWarning(warnings, 'behavior_details', index, '业务行为详情找不到对应行为，未导入该详情。');
      continue;
    }
    await repo.saveBehaviorDetail(draft, stepId, {
      precondition: optionalText(detail.precondition),
      trigger_scene: optionalText(detail.trigger_scene),
      execution_standard: optionalText(detail.execution_standard),
      delivery_object: optionalText(detail.delivery_object),
      requires_approval: Boolean(detail.requires_approval),
      approval_note: optionalText(detail.approval_note),
      is_cross_department: Boolean(detail.is_cross_department)
    }, req.session.userId);
    counts.behavior_details += 1;
  }

  for (let index = 0; index < arrayItems(data.step_transitions).length; index += 1) {
    const transition = data.step_transitions[index] || {};
    const fromRow = maps.stepRows.get(text(transition.from_step_ref));
    if (!fromRow || !text(transition.condition)) {
      pushImportWarning(warnings, 'step_transitions', index, '判断分支缺少判断节点或条件，未导入该分支。');
      continue;
    }
    if (fromRow.stepType !== 'decision') {
      pushImportWarning(warnings, 'step_transitions', index, '判断分支只能从判断节点发出，未导入该分支。');
      continue;
    }
    const declaredProcessId = maps.processes.get(text(transition.process_ref));
    if (declaredProcessId && Number(declaredProcessId) !== Number(fromRow.processId)) {
      pushImportWarning(warnings, 'step_transitions', index, '判断分支声明的流程和来源判断节点不一致，已按来源判断节点所在流程导入。');
    }
    let toStepId = null;
    if (text(transition.to_step_ref)) {
      const toRow = maps.stepRows.get(text(transition.to_step_ref));
      if (toRow && Number(toRow.processId) === Number(fromRow.processId)) {
        toStepId = toRow.id;
      } else {
        pushImportWarning(warnings, 'step_transitions', index, '判断分支流向不在同一流程，已按未补流向导入。');
      }
    } else {
      pushImportWarning(warnings, 'step_transitions', index, '判断分支缺少流向步骤，已导入分支条件，请在详情中补齐流向。');
    }
    await repo.createStepTransition(draft, {
      process_id: fromRow.processId,
      from_step_id: fromRow.id,
      condition_text: transition.condition,
      to_step_id: toStepId,
      evidence_refs: transition.evidence_refs
    }, req.session.userId);
    counts.step_transitions += 1;
  }

  for (let index = 0; index < arrayItems(data.cross_dept_handoffs).length; index += 1) {
    const handoff = data.cross_dept_handoffs[index] || {};
    const stepId = maps.steps.get(text(handoff.step_ref));
    if (!stepId || !text(handoff.target_department)) {
      pushImportWarning(warnings, 'cross_dept_handoffs', index, '跨部门承接缺少对应行为或承接部门，未导入该承接。');
      continue;
    }
    await repo.createHandoff(draft, stepId, {
      target_department: handoff.target_department,
      handoff_standard: optionalText(handoff.handoff_standard)
    }, req.session.userId);
    counts.cross_dept_handoffs += 1;
  }

  for (let index = 0; index < arrayItems(data.forms).length; index += 1) {
    const form = data.forms[index] || {};
    const stepId = maps.steps.get(text(form.step_ref)) || stepRefFallbacks[0] && stepRefFallbacks[0].id;
    if (!stepId || !text(form.form_name)) {
      pushImportWarning(warnings, 'forms', index, '表单缺少对应业务行为或表单名称，未导入该表单。');
      continue;
    }
    const createdForm = await repo.createForm(draft, {
      step_id: stepId,
      form_name: form.form_name,
      main_table_name: firstText(form.main_table_name, '主表'),
      archive_location: enumValue(form.archive_location, ARCHIVE_LOCATIONS, null),
      retention_period: enumValue(form.retention_period, RETENTION_PERIODS, null),
      responsible_department_name: optionalText(form.responsible_department_name),
      responsible_role: optionalText(form.responsible_role)
    }, req.session.userId);
    maps.forms.set(refKey(form.form_ref, `form:${index}`), createdForm.id);
    counts.forms += 1;
  }

  for (let index = 0; index < arrayItems(data.form_tables).length; index += 1) {
    const table = data.form_tables[index] || {};
    const formId = maps.forms.get(text(table.form_ref));
    if (!formId) {
      pushImportWarning(warnings, 'form_tables', index, '表结构找不到对应表单，未导入该表结构。');
      continue;
    }
    const tableKey = refKey(table.table_ref, `table:${index}`);
    if (text(table.table_kind) === 'detail') {
      if (!text(table.table_name)) {
        pushImportWarning(warnings, 'form_tables', index, '明细表缺少表名，未导入该明细表。');
        continue;
      }
      const createdTable = await repo.createFormTable(draft, formId, { table_name: table.table_name }, req.session.userId);
      maps.tables.set(tableKey, { id: createdTable.id, structure_kind: 'detail' });
      counts.form_tables += 1;
    } else {
      maps.tables.set(tableKey, { id: formId, structure_kind: 'main' });
    }
  }

  const sourceTableFields = arrayItems(data.form_table_fields);
  for (let index = 0; index < sourceTableFields.length; index += 1) {
    const field = sourceTableFields[index] || {};
    let tableTarget = maps.tables.get(text(field.table_ref));
    if (!tableTarget && text(field.structure_kind) === 'main' && maps.forms.size === 1) {
      tableTarget = { id: Array.from(maps.forms.values())[0], structure_kind: 'main' };
    }
    if (!tableTarget || !text(field.field_name)) {
      pushImportWarning(warnings, 'form_table_fields', index, '字段缺少对应表结构或字段名称，未导入该字段。');
      continue;
    }
    const structureKind = text(field.structure_kind) === 'detail' ? 'detail' : tableTarget.structure_kind;
    const createdField = await repo.createFormTableField(draft, tableTarget.id, {
      structure_kind: structureKind,
      field_name: field.field_name,
      field_type: fieldTypeName(field.field_type),
      enum_options: optionalText(field.enum_options),
      required: Boolean(field.required),
      description: optionalText(field.description)
    }, req.session.userId);
    maps.fields.set(refKey(field.table_field_ref, `table_field:${index}`), createdField.id);
    counts.form_table_fields += 1;
  }

  if (!sourceTableFields.length) {
    for (let index = 0; index < arrayItems(data.form_fields).length; index += 1) {
      const field = data.form_fields[index] || {};
      const formId = maps.forms.get(text(field.form_ref));
      if (!formId || !text(field.field_name_cn)) {
        pushImportWarning(warnings, 'form_fields', index, '字段缺少对应表单或字段名称，未导入该字段。');
        continue;
      }
      const createdField = await repo.createFormTableField(draft, formId, {
        structure_kind: 'main',
        field_name: field.field_name_cn,
        field_type: fieldTypeName(field.field_type),
        enum_options: optionalText(field.enum_options),
        required: Boolean(field.required),
        description: optionalText(field.evidence_note)
      }, req.session.userId);
      maps.fields.set(refKey(field.field_ref, `field:${index}`), createdField.id);
      counts.form_table_fields += 1;
    }
  }

  const fallbackProcessId = processRefFallbacks[0] && processRefFallbacks[0].id || draft.id;
  for (let index = 0; index < arrayItems(data.evidence_catalog).length; index += 1) {
    const evidence = data.evidence_catalog[index] || {};
    if (!text(evidence.description)) {
      pushImportWarning(warnings, 'evidence_catalog', index, '证据说明为空，未导入该证据。');
      continue;
    }
    const targetObject = evidenceObjectTarget(evidence, maps, fallbackProcessId);
    await repo.createEvidence(draft, {
      ...targetObject,
      evidence_type: enumValue(evidence.evidence_type, EVIDENCE_TYPES, '制度条款'),
      description: evidence.description,
      source_name: optionalText(evidence.source_name || evidence.source_file),
      source_anchor: optionalText(evidence.source_anchor || evidence.locator),
      confirmer: optionalText(evidence.confirmer),
      record_time: optionalText(evidence.record_time),
      missing_reason: optionalText(evidence.missing_reason),
      expected_provider: optionalText(evidence.expected_provider),
      expected_at: optionalText(evidence.expected_at)
    }, req.session.userId);
    if (text(evidence.status) && text(evidence.status) !== 'pending_review') {
      pushImportWarning(warnings, 'evidence_catalog', index, '证据已按待核验导入，核验状态需要在 MDM 中重新确认。');
    }
    counts.evidence += 1;
  }

  const detail = await repo.detail(draft.id);
  draft = detail && detail.draft || draft;
  return { draft, imported: counts, warnings, detail };
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

router.post('/import-structured-output', requireAuth, (req, res) => runAction(res, async () => {
  assertWorkRoleBindingsSupported(structuredOutputData(req.body || {}));
  const repo = await repository();
  const result = await importStructuredOutput(req, repo, req.body || {});
  res.status(201).json(result);
}));

router.get('/versions/:processVersionId/content', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const version = await repo.getVersionContent(req.params.processVersionId);
  if (!version) throw httpError(404, '正式流程版本不存在', { error: '正式流程版本不存在', code: 'PROCESS_VERSION_NOT_FOUND' });
  if (!await canViewAcrossDepartments(req)) {
    const departmentIds = await authorizedDepartmentIds(req);
    if (!departmentIds.has(Number(version.department_id)) || !await hasCurrentPermission(req, 'governance:read-department')) {
      throw httpError(403, '无权查看该正式流程版本', { error: '无权查看该正式流程版本', code: 'PROCESS_VERSION_SCOPE_DENIED' });
    }
  }
  if (!version.document) {
    throw httpError(409, '正式流程版本缺少可读正文', { error: '正式流程版本缺少可读正文', code: 'PROCESS_VERSION_CONTENT_MISSING' });
  }
  if (text(version.schema_version) === 'process-governance-v7') {
    const calculatedHash = v7ContentHash(version.document);
    if (text(version.content_hash) !== calculatedHash) {
      throw httpError(409, '正式V7版本正文摘要校验失败', {
        error: '正式V7版本正文摘要校验失败',
        code: 'V7_VERSION_CONTENT_HASH_MISMATCH'
      });
    }
    version.content_hash_verified = true;
  }
  res.json(version);
}));

router.post('/import-structured-output/preview', requireAuth, (req, res) => runAction(res, async () => {
  const preview = await processGovernancePreview(req);
  res.json({
    summary: preview.summary,
    handoff_candidates: preview.handoff_candidates,
    governance_warnings: preview.warnings,
    content_hash: preview.content_hash,
    normalized_schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION
  });
}));

router.post('/import-structured-output/approve', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await requireCurrentRole(req, 'department_mdm_reviewer');
  const decisionBasis = text(req.body && (req.body.decision_basis || req.body.review_basis));
  if (!decisionBasis) {
    throw httpError(422, '校验失败', {
      error: '校验失败',
      details: [{ field: 'decision_basis', message: '审核依据不能为空' }]
    });
  }
  const preview = await processGovernancePreview(req);
  const expectedHash = text(req.body && (req.body.preview_hash || req.body.content_hash));
  if (!expectedHash || expectedHash !== preview.content_hash) {
    throw httpError(409, '预览内容已变化，请重新预览后再审核导入', {
      error: '预览内容已变化，请重新预览后再审核导入',
      code: 'PREVIEW_HASH_MISMATCH',
      expected_hash: expectedHash || null,
      actual_hash: preview.content_hash
    });
  }
  const department = await currentDepartmentIdentity(req);
  const actor = handoffActor(req, roleCodes, department, 'department_mdm_reviewer');
  const repo = await repository();
  const result = await repo.importProcessGovernanceCandidate(preview, {
    decisionBasis,
    voidedHandoffs: req.body && req.body.voided_handoffs
  }, actor);
  res.status(result.idempotent ? 200 : 201).json({
    ...result,
    governance_warnings: preview.warnings,
    normalized_schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION
  });
}));

router.post('/documents/:id/drafts', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const document = await repo.getDocumentById(req.params.id);
  if (!document) throw httpError(404, '制度不存在');
  if (!(await canMaintainDocument(req, document))) throw httpError(403, '无权维护该制度');
  res.status(201).json(await repo.createNextEditionDraft(document.id, req.session.userId, document.owning_department_id));
}));

router.get('/drafts', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const departmentIds = await canViewAcrossDepartments(req)
    ? null
    : Array.from(await authorizedDepartmentIds(req));
  const items = await repo.listCanonicalDrafts(departmentIds, { limit: req.query && req.query.limit });
  res.json({ items, total: items.length, schema_version: PROCESS_GOVERNANCE_SCHEMA_VERSION });
}));

router.post('/drafts/canonical', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await currentRoleCodes(req);
  assertAdminCannotWrite(roleCodes);
  if (!roleCodes.has('department_contact')) throw httpError(403, '只有部门主对接人可以新建流程编制草稿');
  const normalized = normalizeProcessGovernanceDocument(req.body && (req.body.content || req.body.document || req.body));
  if (normalized.errors.length) {
    throw httpError(422, '单流程治理JSON不符合结构规则', {
      error: '单流程治理JSON不符合结构规则',
      code: 'PROCESS_GOVERNANCE_CONTENT_INVALID',
      details: normalized.errors
    });
  }
  const department = await currentDepartmentIdentity(req);
  if (!department || department.name !== text(normalized.document.process.owning_department)) {
    throw httpError(403, '部门主对接人只能新建本人部门归口的流程');
  }
  const repo = await repository();
  const process = normalized.document.process;
  const documentNo = text(req.body && req.body.document_no) || `PG-${text(process.process_ref)}`.slice(0, 128);
  const created = await repo.createDraft({
    document_no: documentNo,
    document_title: text(process.process_name),
    process_name: text(process.process_name),
    reason: '在MDM流程治理中编制单流程治理JSON',
    basis_type: '现场实际',
    basis_description: text(req.body && req.body.basis_description),
    involves_other_departments: normalized.document.cross_department_handoffs.length > 0,
    related_departments: normalized.document.cross_department_handoffs
      .flatMap(item => [item.source_department, item.target_department])
      .map(text)
      .filter(name => name && name !== department.name),
    l1_name: optionalText(process.capability_domain),
    l2_name: optionalText(process.business_capability),
    l3_name: optionalText(process.process_name)
  }, req.session.userId, department.id, null);
  const draft = created.draft || created;
  const actor = await currentGovernanceActor(req, 'department_contact');
  const saved = await repo.saveCanonicalContent(
    draft,
    normalized.document,
    0,
    req.session.userId,
    {
      actor,
      voidedHandoffs: req.body && req.body.voided_handoffs
    }
  );
  res.status(201).json({ draft: await repo.getDraft(draft.id), content: saved });
}));

router.post('/drafts', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const errors = draftRequiredErrors(req.body || {});
  if (text(req.body && req.body.basis_type) && !BASIS_TYPES.has(text(req.body.basis_type))) {
    errors.push({ field: 'basis_type', message: '依据类型必须从系统选项中选择' });
  }
  const requestedDeptId = req.body.department_id ? Number(req.body.department_id) : null;
  const sessionDeptId = req.session.departmentId ? Number(req.session.departmentId) : null;
  const targetDeptId = requestedDeptId || sessionDeptId;
  if (!targetDeptId) throw httpError(400, '请先维护人员组织信息后再创建制度结构草稿');
  if (!await repo.departmentExists(targetDeptId)) errors.push({ field: 'department_id', message: '所属部门不存在' });
  if (!await hasCurrentPermission(req, 'governance:draft-department')) throw httpError(403, '无权创建制度结构草稿');
  if (requestedDeptId && requestedDeptId !== sessionDeptId) throw httpError(403, '部门主对接人只能为本人部门创建流程');
  const allowed = await authorizedDepartmentIds(req);
  if (!allowed.has(Number(targetDeptId))) throw httpError(403, '无权为该部门创建流程');
  errors.push(...await taxonomyValidationDetails(repo, req.body || {}, await taxonomyScopeForDepartmentId(targetDeptId)));
  if (errors.length) throw httpError(422, '校验失败', { error: '校验失败', details: errors });
  await getDepartmentByIdAsync(targetDeptId);
  const draft = await repo.createDraft(req.body, req.session.userId, targetDeptId, null);
  res.status(201).json(draft);
}));

router.get('/drafts/:id/content', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  const content = await repo.canonicalContent(draft);
  if (!content.document) {
    throw httpError(409, '该草稿不能无损转换为单流程治理JSON', {
      error: '该草稿不能无损转换为单流程治理JSON',
      code: 'PROCESS_GOVERNANCE_MANUAL_CONVERSION_REQUIRED',
      object_id: Number(draft.id),
      details: content.errors || []
    });
  }
  res.json(content);
}));

router.put('/drafts/:id/content', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  if (text(draft && draft.schema_version) === 'process-governance-v7') {
    throw httpError(409, 'V7正式草稿正文不能在3000直接修改；请回到3001修改后上传新修订', {
      error: 'V7正式草稿正文不能在3000直接修改；请回到3001修改后上传新修订',
      code: 'V7_CONTENT_READ_ONLY'
    });
  }
  await assertCanEditDraftContent(req, repo, draft);
  const actor = await currentGovernanceActor(req, 'department_contact');
  const result = await repo.saveCanonicalContent(
    draft,
    req.body && (req.body.content || req.body.document),
    req.body && req.body.expected_revision,
    req.session.userId,
    {
      actor,
      voidedHandoffs: req.body && req.body.voided_handoffs
    }
  );
  res.json(result);
}));

router.get('/drafts/:id/export', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  const content = await repo.canonicalContent(draft);
  if (!content.document) throw httpError(409, '该草稿不能无损导出为单流程治理JSON');
  const filename = `${markdownFileSafe(text(draft.document_no) || `draft-${draft.id}`)}-${PROCESS_GOVERNANCE_SCHEMA_VERSION}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(content.document);
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
  const body = req.body || {};
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
  const body = req.body || {};
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

router.get('/cross-dept-handoffs', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const actor = await currentGovernanceActor(req);
  res.json(await repo.listHandoffQueue(actor, { limit: req.query && req.query.limit }));
}));

router.get('/cross-dept-handoffs/:id/story', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const actor = await currentGovernanceActor(req);
  const story = await repo.getHandoffStory(req.params.id, actor);
  if (!story) throw httpError(404, '跨部门承接不存在');
  res.json(story);
}));

router.get('/handoff-conflicts', requireAuth, (req, res) => runAction(res, async () => {
  const repo = await repository();
  const actor = await currentGovernanceActor(req);
  res.json(await repo.listHandoffConflictQueue(actor, { limit: req.query && req.query.limit }));
}));

router.post('/handoff-conflicts/:id/assign', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await requireCurrentRole(req, 'mdm_lead');
  const repo = await repository();
  const conflict = await repo.getHandoffConflictContext(req.params.id);
  if (!conflict) throw httpError(404, '承接冲突不存在');
  if (conflict.status !== 'pending_assignment') throw httpError(409, '当前承接冲突不需要分派处理人');
  const handlerPersonId = Number(req.body && req.body.handler_person_id || 0);
  if (!handlerPersonId || !await repo.personHasActiveRole(handlerPersonId, 'data_conflict_handler')) {
    throw httpError(422, '校验失败', {
      error: '校验失败',
      details: [{ field: 'handler_person_id', message: '冲突处理人必须是有效的数据冲突处理人' }]
    });
  }
  const actor = await currentGovernanceActor(req, 'mdm_lead');
  actor.roleCodes = [...roleCodes];
  res.json(await repo.assignHandoffConflict(conflict, handlerPersonId, actor));
}));

router.put('/handoff-conflicts/:id/proposal', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await requireCurrentRole(req, 'data_conflict_handler');
  const repo = await repository();
  const conflict = await repo.getHandoffConflictContext(req.params.id);
  if (!conflict) throw httpError(404, '承接冲突不存在');
  const actor = await currentGovernanceActor(req, 'data_conflict_handler');
  actor.roleCodes = [...roleCodes];
  if (Number(conflict.assigned_handler_person_id || 0) !== Number(actor.personId || 0)) {
    throw httpError(403, '只能处理本人被分派的承接冲突');
  }
  if (!['coordinating', 'pending_department_confirmation'].includes(conflict.status)) {
    throw httpError(409, '当前承接冲突不能修改协调方案');
  }
  const body = req.body || {};
  const details = [];
  if (!text(body.origin_position)) details.push({ field: 'origin_position', message: '归口部门立场不能为空' });
  if (!text(body.counterparty_position)) details.push({ field: 'counterparty_position', message: '外部门立场不能为空' });
  if (!text(body.proposal_text)) details.push({ field: 'proposal_text', message: '协调方案不能为空' });
  if (!arrayItems(body.evidence).length) details.push({ field: 'evidence', message: '至少记录一条协调证据' });
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.json(await repo.saveHandoffConflictProposal(conflict, body, actor));
}));

router.post('/handoff-conflicts/:id/department-confirmation', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await requireCurrentRole(req, 'department_mdm_reviewer');
  const repo = await repository();
  const conflict = await repo.getHandoffConflictContext(req.params.id);
  if (!conflict) throw httpError(404, '承接冲突不存在');
  if (conflict.status !== 'pending_department_confirmation') throw httpError(409, '当前承接冲突不等待部门确认');
  const confirmation = text(req.body && req.body.confirmation);
  const basis = text(req.body && req.body.basis);
  if (!['accepted', 'rejected'].includes(confirmation) || !basis) {
    throw httpError(422, '校验失败', {
      error: '校验失败',
      details: [
        ...(!['accepted', 'rejected'].includes(confirmation)
          ? [{ field: 'confirmation', message: '部门确认结果无效' }]
          : []),
        ...(!basis ? [{ field: 'basis', message: '部门确认依据不能为空' }] : [])
      ]
    });
  }
  const actor = await currentGovernanceActor(req, 'department_mdm_reviewer');
  actor.roleCodes = [...roleCodes];
  res.json(await repo.confirmHandoffConflictProposal(
    conflict,
    actor.departmentId,
    confirmation === 'accepted',
    basis,
    actor
  ));
}));

router.post('/handoff-conflicts/:id/escalate', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await requireCurrentRole(req, 'data_conflict_handler');
  const repo = await repository();
  const conflict = await repo.getHandoffConflictContext(req.params.id);
  if (!conflict) throw httpError(404, '承接冲突不存在');
  const actor = await currentGovernanceActor(req, 'data_conflict_handler');
  actor.roleCodes = [...roleCodes];
  if (Number(conflict.assigned_handler_person_id || 0) !== Number(actor.personId || 0)) {
    throw httpError(403, '只能升级本人被分派的承接冲突');
  }
  const basis = text(req.body && req.body.basis);
  if (!basis) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'basis', message: '提请项目决策的依据不能为空' }] });
  res.json(await repo.escalateHandoffConflict(conflict, basis, actor));
}));

router.post('/handoff-conflicts/:id/decision', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await requireCurrentRole(req, 'decision_group');
  const repo = await repository();
  const conflict = await repo.getHandoffConflictContext(req.params.id);
  if (!conflict) throw httpError(404, '承接冲突不存在');
  if (conflict.status !== 'pending_decision') throw httpError(409, '当前承接冲突不等待项目决策');
  const decision = text(req.body && req.body.decision);
  const basis = text(req.body && req.body.basis);
  if (!['continue_handoff', 'not_required', 'return_revision'].includes(decision) || !basis) {
    throw httpError(422, '校验失败', {
      error: '校验失败',
      details: [
        ...(!['continue_handoff', 'not_required', 'return_revision'].includes(decision)
          ? [{ field: 'decision', message: '项目决策结论无效' }]
          : []),
        ...(!basis ? [{ field: 'basis', message: '项目决策依据不能为空' }] : [])
      ]
    });
  }
  const actor = await currentGovernanceActor(req, 'decision_group');
  actor.roleCodes = [...roleCodes];
  res.json(await repo.decideHandoffConflict(conflict, decision, basis, actor));
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

router.post('/cross-dept-handoffs/:id/assign-counterparty', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await requireCurrentRole(req, 'mdm_lead');
  const repo = await repository();
  const handoff = await repo.getHandoffContext(req.params.id);
  const department = await currentDepartmentIdentity(req);
  const actor = handoffActor(req, roleCodes, department, 'mdm_lead');
  await assertHandoffParticipant(repo, handoff, actor);
  if (handoff.status !== 'pending_assignment') throw httpError(409, '当前承接状态不需要分派责任部门');
  const targetDepartmentId = Number(req.body && req.body.department_id || 0);
  if (!targetDepartmentId) {
    throw httpError(422, '校验失败', {
      error: '校验失败',
      details: [{ field: 'department_id', message: '责任部门不能为空' }]
    });
  }
  const targetDepartment = await getDepartmentByIdAsync(targetDepartmentId);
  if (!targetDepartment) throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'department_id', message: '责任部门不存在' }] });
  res.json(await repo.assignHandoffCounterparty(handoff, {
    id: Number(targetDepartment.id || targetDepartment.department_id),
    name: text(targetDepartment.name || targetDepartment.department_name)
  }, actor));
}));

router.put('/cross-dept-handoffs/:id/counterparty-response', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await requireCurrentRole(req, 'department_contact');
  const repo = await repository();
  const handoff = await repo.getHandoffContext(req.params.id);
  const department = await currentDepartmentIdentity(req);
  const actor = handoffActor(req, roleCodes, department, 'department_contact');
  await assertHandoffParticipant(repo, handoff, actor);
  if (handoff.status !== 'pending_counterparty_detail') throw httpError(409, '当前承接状态不能补充外部门承接内容');
  if (!department || Number(department.id) !== Number(handoff.counterparty_department_id)) {
    throw httpError(403, '部门主对接人只能补充本部门实际承接内容');
  }
  const body = req.body || {};
  const details = [];
  if (!text(body.counterparty_process_name)) details.push({ field: 'counterparty_process_name', message: '本部门对应流程不能为空' });
  if (!text(body.counterparty_behavior_name)) details.push({ field: 'counterparty_behavior_name', message: '本部门对应业务行为不能为空' });
  if (!text(body.requested_matter || handoff.requested_matter) && !text(body.transfer_data_ref || handoff.transfer_data_ref)) {
    details.push({ field: 'requested_matter', message: '需要说明传递数据或承接事项' });
  }
  if (!text(body.completion_standard || handoff.completion_standard)) {
    details.push({ field: 'completion_standard', message: '完成标准不能为空' });
  }
  if (details.length) throw httpError(422, '校验失败', { error: '校验失败', details });
  res.json(await repo.saveHandoffCounterpartyResponse(handoff, body, actor));
}));

router.post('/cross-dept-handoffs/:id/department-decision', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await requireCurrentRole(req, 'department_mdm_reviewer');
  const repo = await repository();
  const handoff = await repo.getHandoffContext(req.params.id);
  const currentDepartment = await currentDepartmentIdentity(req);
  const actor = handoffActor(req, roleCodes, currentDepartment, 'department_mdm_reviewer');
  await assertHandoffParticipant(repo, handoff, actor);
  const allowedStates = ['pending_origin_review', 'pending_counterparty_scope', 'pending_counterparty_review'];
  if (!allowedStates.includes(text(handoff.status))) throw httpError(409, '当前承接状态不能记录部门决定');
  const currentDepartmentId = currentDepartment && Number(currentDepartment.id);
  const isOrigin = currentDepartmentId === Number(handoff.origin_department_id);
  const isCounterparty = currentDepartmentId === Number(handoff.counterparty_department_id);
  if (!isOrigin && !isCounterparty) throw httpError(403, '部门审核员不能代替另一部门作出决定');
  if (handoff.status === 'pending_origin_review' && !isOrigin) throw httpError(403, '当前应由归口部门审核候选关系');
  if (handoff.status !== 'pending_origin_review' && !isCounterparty) throw httpError(403, '当前应由外部门审核承接范围或补充结果');
  const body = req.body || {};
  if (!['approved', 'returned', 'rejected', 'not_required'].includes(text(body.decision))) {
    throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'decision', message: '部门决定无效' }] });
  }
  if (!text(body.decision_basis)) {
    throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'decision_basis', message: '决定依据不能为空' }] });
  }
  const finalResponsiblePersonId = isOrigin
    ? handoff.origin_final_responsible_person_id
    : handoff.counterparty_final_responsible_person_id;
  if (!finalResponsiblePersonId) throw httpError(409, '部门尚未配置最终责任人，不能记录部门决定');
  res.json(await repo.recordHandoffDepartmentDecision(handoff, {
    id: currentDepartmentId,
    name: currentDepartment.name,
    final_responsible_person_id: Number(finalResponsiblePersonId)
  }, body, actor));
}));

router.post('/cross-dept-handoffs/:id/structure-gate', requireAuth, (req, res) => runAction(res, async () => {
  const roleCodes = await requireCurrentRole(req, 'mdm_lead');
  const repo = await repository();
  const handoff = await repo.getHandoffContext(req.params.id);
  const department = await currentDepartmentIdentity(req);
  const actor = handoffActor(req, roleCodes, department, 'mdm_lead');
  await assertHandoffParticipant(repo, handoff, actor);
  if (!['pending_structure_gate', 'returned', 'escalated'].includes(text(handoff.status))) {
    throw httpError(409, '当前承接状态不能执行结构卡口');
  }
  const action = text(req.body && req.body.action) || 'confirmed';
  if (!['confirmed', 'returned', 'escalated'].includes(action)) {
    throw httpError(422, '校验失败', { error: '校验失败', details: [{ field: 'action', message: '结构卡口结论无效' }] });
  }
  res.json(await repo.runHandoffStructureGate(handoff, { ...(req.body || {}), action }, actor));
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

router.post('/drafts/:id/submit', requireAuth, requirePermission('governance:submit-department'), (req, res) => runAction(res, async () => {
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

router.post('/drafts/:id/publish', requireAuth, requirePermission('governance:publish'), (req, res) => runAction(res, async () => {
  const repo = await repository();
  const draft = await repo.getDraft(req.params.id);
  await assertCanViewDraft(req, repo, draft);
  res.json(await repo.publishDraft(draft, req.body && req.body.note, req.session.userId, req.body || {}));
}));

router.setProcessDesignRepositoryFactory = setProcessDesignRepositoryFactory;
router.resetProcessDesignRepositoryFactory = resetProcessDesignRepositoryFactory;
router.makeProcessDesignMysqlRepository = makeProcessDesignMysqlRepository;
router.ensureProcessDesignEditionSchema = ensureProcessDesignEditionSchema;
router.ensureProcessDesignEvidenceStatusSchema = ensureProcessDesignEvidenceStatusSchema;
router.ensureProcessDesignFormStructureSchema = ensureProcessDesignFormStructureSchema;
router.ensureProcessDesignStepTransitionSchema = ensureProcessDesignStepTransitionSchema;
router.assertWorkRoleBindingsSupported = assertWorkRoleBindingsSupported;
router.getProcessDesignRepository = repository;
router.currentProcessDesignRoleCodes = currentRoleCodes;
router.currentProcessDesignDepartment = currentDepartmentIdentity;
router.processDesignHandoffActor = handoffActor;
router.assertProcessDesignHandoffParticipant = assertHandoffParticipant;

module.exports = router;
