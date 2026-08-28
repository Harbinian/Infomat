const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { TextDecoder } = require('util');
const Ajv2020 = require('ajv/dist/2020');
const { validateProcessGovernanceV7 } = require('../../scripts/process-governance/v7-validator');
const { createDocxParserPool } = require('./scripts/docx-parser-pool');

const app = express();
const PORT = Number(process.env.STRUCTURED_OUTPUT_PORT || process.env.PORT || 3001);
const HOST = process.env.STRUCTURED_OUTPUT_HOST || '0.0.0.0';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_STRING_LENGTH = 1024 * 1024;
const MAX_JSON_NODES = 100000;
const MAX_DOCX_ENTRIES = 2000;
const MAX_DOCX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_PATH_DEPTH = 20;
const DOCX_PARSE_TIMEOUT_MS = 5000;
const MAX_CONCURRENT_DOCX_PARSERS = 2;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1
  }
});
const cytoscapeBrowserPath = require.resolve('cytoscape/dist/cytoscape.min.js');

const schemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'document-structured-output.schema.json');
const STANDARD_SCHEMA = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validateStandardDocument = new Ajv2020({ allErrors: true, strict: false }).compile(STANDARD_SCHEMA);
const processGovernanceV1SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v1.schema.json');
const processGovernanceV2SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v2.schema.json');
const processGovernanceV3SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v3.schema.json');
const processGovernanceV4SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v4.schema.json');
const processGovernanceV5SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v5.schema.json');
const processGovernanceV6SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v6.schema.json');
const processGovernanceV7SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v7.schema.json');
const processGovernanceVersionHistoryPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-version-history.json');
const PROCESS_GOVERNANCE_V1_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV1SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V2_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV2SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V3_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV3SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V4_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV4SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V5_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV5SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V6_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV6SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V7_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV7SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_SCHEMA_SOURCE = fs.readFileSync(processGovernanceV7SchemaPath);
const PROCESS_GOVERNANCE_SCHEMA = JSON.parse(PROCESS_GOVERNANCE_SCHEMA_SOURCE.toString('utf8'));
const PROCESS_GOVERNANCE_VERSION_HISTORY = JSON.parse(fs.readFileSync(processGovernanceVersionHistoryPath, 'utf8'));
const PROCESS_GOVERNANCE_SCHEMA_DIGEST = crypto
  .createHash('sha256')
  .update(PROCESS_GOVERNANCE_SCHEMA_SOURCE)
  .digest('hex');
const PROCESS_GOVERNANCE_V5_SCHEMA_DIGEST = crypto
  .createHash('sha256')
  .update(fs.readFileSync(processGovernanceV5SchemaPath))
  .digest('hex');
const PROCESS_GOVERNANCE_V6_SCHEMA_DIGEST = crypto
  .createHash('sha256')
  .update(fs.readFileSync(processGovernanceV6SchemaPath))
  .digest('hex');
const processGovernanceAjv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false
});
processGovernanceAjv.addSchema(PROCESS_GOVERNANCE_V1_SCHEMA);
processGovernanceAjv.addSchema(PROCESS_GOVERNANCE_V2_SCHEMA);
processGovernanceAjv.addSchema(PROCESS_GOVERNANCE_V3_SCHEMA);
processGovernanceAjv.addSchema(PROCESS_GOVERNANCE_V4_SCHEMA);
const validateProcessGovernanceV1Document = processGovernanceAjv.getSchema(PROCESS_GOVERNANCE_V1_SCHEMA.$id);
const validateProcessGovernanceV2Document = processGovernanceAjv.getSchema(PROCESS_GOVERNANCE_V2_SCHEMA.$id);
const validateProcessGovernanceV3Document = processGovernanceAjv.getSchema(PROCESS_GOVERNANCE_V3_SCHEMA.$id);
const validateProcessGovernanceV4Document = processGovernanceAjv.getSchema(PROCESS_GOVERNANCE_V4_SCHEMA.$id);
const validateProcessGovernanceV5Document = processGovernanceAjv.compile(PROCESS_GOVERNANCE_V5_SCHEMA);
const validateProcessGovernanceV6Document = processGovernanceAjv.compile(PROCESS_GOVERNANCE_V6_SCHEMA);
const validateProcessGovernanceV7Document = processGovernanceAjv.compile(PROCESS_GOVERNANCE_SCHEMA);
const earlyV7CompatibilitySchema = JSON.parse(JSON.stringify(PROCESS_GOVERNANCE_SCHEMA));
earlyV7CompatibilitySchema.$id = 'https://infomat.local/contracts/process-governance-v7-early-data-fields.schema.json';
const earlyV7OptionalProperties = new Set(['fields', 'updated_field_refs', 'data_field_ref', 'value_usage_mode']);
(function relaxEarlyV7DataFieldRequirements(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.required)) {
    node.required = node.required.filter(property => !earlyV7OptionalProperties.has(property));
  }
  Object.values(node).forEach(relaxEarlyV7DataFieldRequirements);
}(earlyV7CompatibilitySchema));
const earlyV7CompatibilityAjv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
earlyV7CompatibilityAjv.addSchema(PROCESS_GOVERNANCE_V1_SCHEMA);
earlyV7CompatibilityAjv.addSchema(PROCESS_GOVERNANCE_V2_SCHEMA);
const validateEarlyV7DataFieldsDocument = earlyV7CompatibilityAjv.compile(earlyV7CompatibilitySchema);
const ROSTER_PATH = path.join(__dirname, '..', '..', 'docs', 'organization', '花名册.md');
const WORK_ROLE_DATA_PATH = path.join(__dirname, '..', '..', 'docs', 'work-role-data.json');
const REPO_ROOT = path.join(__dirname, '..', '..');

function repositoryCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (_) {
    return 'unknown';
  }
}

const APP_COMMIT = repositoryCommit();

function structuredOutputUiConfig(env = process.env) {
  return {
    compact_task_ui_enabled: String(env && env.STRUCTURED_OUTPUT_COMPACT_TASK_UI_ENABLED || '') === '1',
    compact_task_ui_status: 'candidate',
    internal_workflow_step_count: 7,
    visible_task_count: 4
  };
}

const ENUMS = {
  basisType: ['现场实际', '制度 / 规程', '表单 / 台账', '会议 / 访谈', '暂无证据'],
  processType: ['new', 'inherit', 'handoff', 'adjustment'],
  processSystem: ['', 'OA', 'MES', 'PLM', 'ERP'],
  stepStatus: ['active', 'voided'],
  handoffStatus: ['pending_return', 'returned', 'pending_review', 'confirmed'],
  formStatus: ['draft', 'submitted', 'published', 'retired'],
  archiveLocation: ['部门自行保存', '资料室'],
  retentionPeriod: ['1年', '3年', '10年', '永久'],
  fieldStructureKind: ['main', 'detail'],
  tableKind: ['main', 'detail'],
  fieldType: ['文本', '长文本', '数字', '日期', '日期时间', '金额', '枚举', '布尔', '部门', '人员', '文件编号', '签名', '图片', '附件', '二维码'],
  fieldStatus: ['suggested', 'business_confirmed', 'data_governed', 'published', 'retired'],
  evidenceType: ['制度条款', '表单样例', '访谈记录', '会议纪要', '流程图', '台账记录', '暂无证据'],
  evidenceStatus: ['verified', 'pending_review', 'source_missing', 'ocr_extracted_not_confirmed', 'review_only'],
  evidenceObjectType: ['draft', 'document_profile', 'term', 'process', 'step', 'behavior_detail', 'handoff', 'form', 'form_table', 'form_table_field', 'form_field', 'evidence', 'mdm_requirement', 'work_role_binding'],
  workRoleParticipationTypes: ['owner', 'initiator', 'executor', 'reviewer', 'approver', 'collaborator', 'provider', 'receiver'],
  workRoleDuties: ['发起', '办理', '审核', '批准', '判断', '发送', '接收', '会签'],
  maturity: ['可保存草稿', '发布前需补', '可提交审核', '可支撑发布'],
  lStatus: ['unclassified', 'needs_review', 'confirmed'],
  departments: [
    { department_name: '全公司', domain: '全公司' },
    { department_name: '公司领导', domain: '公司领导' },
    { department_name: '工程技术部', domain: '总经理直辖' },
    { department_name: '质量管理部', domain: '总经理直辖' },
    { department_name: '财务部', domain: '总经理直辖' },
    { department_name: '行政人事部', domain: '经营副总' },
    { department_name: '经营发展部', domain: '经营副总' },
    { department_name: '物资保障部', domain: '经营副总' },
    { department_name: '项目管理部', domain: '生产副总' },
    { department_name: '复材车间', domain: '生产副总' },
    { department_name: '运维安环部', domain: '生产副总' }
  ]
};

const COMPANY_LEADERSHIP_DEPARTMENT = '公司领导';
const COMPANY_LEADERSHIP_ROLES = ['董事长', '总经理', '副总经理'];

const SECTION_LABELS = [
  '目的', '目标', '设立原因',
  '范围', '适用范围',
  '依据', '引用文件', '引用标准',
  '术语和定义', '术语与定义', '术语', '定义',
  '职责', '权限',
  '职责分工',
  '工作流程', '操作步骤', '业务流程', '管理流程', '工作程序', '申请流程', '操作流程', '审批流程',
  '核心流程及要求', '核心流程', '流程及要求', '流程要求', '办理流程', '实施流程', '流程', '程序', '规定', '管理内容',
  '相关流程', '流程图', '流程图示', '流程图说明', 'Visio', 'VISIO',
  '相关部门', '涉及部门', '协作部门',
  '表单与记录', '相关记录', '表单', '表格', '规定表格', '记录', '记录控制',
  '附则', '附件'
];

const WORKFLOW_VERBS = [
  '提交', '填写', '审核', '审批', '批准', '确认', '备案', '归档', '保存',
  '登记', '更新', '维护', '校验', '检查', '复核', '发起', '接收',
  '通知', '汇总', '编制', '编写', '形成', '输出', '移交', '承接', '提出',
  '组织', '召开', '反馈', '启动', '报送', '跟踪', '监控', '协调',
  '制定', '制订', '验证', '分析', '调查', '采取', '隔离', '传递',
  '关联', '落实', '审查', '签字', '提请', '指定', '提供',
  '验收', '评估', '评选', '修订', '推广', '出具', '审议'
];

const FIELD_LEXICON = {
  triggerVerbs: ['收到', '接到', '发现', '发生', '出现', '识别', '下发', '提出', '反馈'],
  triggerObjects: ['通知', '问题', '不合格', '偏差', '故障', '投诉', '反馈', '需求', '变更', '风险', '异常', '申请', '指令'],
  preconditionVerbs: ['审核', '审批', '批准', '确认'],
  inputVerbs: ['提交', '提供', '随附', '附', '附上', '依据', '接收', '收到', '填写', '上传', '导入'],
  outputVerbs: ['形成', '出具', '生成', '输出', '归档', '保存', '关闭', '更新', '记录', '答复', '反馈', '报送', '发放', '发布', '传递', '移交'],
  materialNouns: ['申请单', '申请表', '报告', '通知单', '通知', '清单', '计划', '记录', '台账', '资料', '材料', '证明文件', '证据', '表单', '文件', '图纸'],
  outputNouns: ['报告', '通知单', '通知', '清单', '计划', '记录', '台账', '资料', '材料', '证明文件', '证据', '表单', '文件', '结果', '结论', '数据库', '状态', '意见', '答复']
};

const EXPLICIT_BEHAVIOR_FIELDS = [
  { key: 'actor_role', labels: ['执行角色'] },
  { key: 'trigger_scene', labels: ['触发场景'] },
  { key: 'precondition', labels: ['前置条件'] },
  { key: 'input_materials', labels: ['输入材料', '输入'] },
  { key: 'output_result', labels: ['输出结果', '输出'] },
  { key: 'execution_standard', labels: ['执行标准'] }
];

const MAPPING_FILES_DIR = path.join(__dirname, '..', '..', 'docs', 'norms');
let processMappingCatalogCache = null;
let rosterRoleCatalogCache = null;
let workRoleCatalogCache = null;

function requestId(value) {
  return value || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function createEmptyDocument() {
  return {
    schema_version: 'document-structured-output-v2',
    generated_at: new Date().toISOString(),
    draft: {
      draft_ref: null,
      document_no: '',
      document_title: '',
      planned_edition: 'A',
      current_edition: null,
      base_version_ref: null,
      process_name: '',
      reason: '',
      basis_type: '制度 / 规程',
      involves_other_departments: false,
      related_departments: [],
      department: { department_name: '', department_code: null, domain: null },
      l1_name: null,
      l1_status: 'unclassified',
      l2_name: null,
      l2_status: 'unclassified',
      l3_name: null,
      status: 'draft'
    },
    document_profile: {
      profile_ref: null,
      draft_ref: null,
      document_title: '',
      document_no: '',
      purpose: '',
      scope: '',
      inheritance_relation: null
    },
    terms: [],
    processes: [],
    steps: [],
    behavior_details: [],
    step_transitions: [],
    cross_dept_handoffs: [],
    forms: [],
    form_tables: [],
    form_table_fields: [],
    form_fields: [],
    evidence_catalog: [],
    mdm_requirement_catalog: [],
    work_role_bindings: [],
    pending_issues: [],
    structure_block_projection: createEmptyProjection(),
    markdown_draft: ''
  };
}

function createEmptyProjection() {
  return {
    meta: {
      document_no: '',
      document_title: '',
      document_edition: 'A',
      document_version_status: null,
      dept_code: null,
      dept_name: '',
      domain: null,
      maintainer: null,
      version: '1.0.0',
      status: 'draft',
      parser_schema_version: 1
    },
    l3_catalog: [],
    a1_catalog: [],
    evidence_catalog: [],
    mdm_requirement_catalog: [],
    work_role_bindings: []
  };
}

function decodeTextBuffer(buffer) {
  if (!buffer || !buffer.length) return '';
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }
  const utf8Text = buffer.toString('utf8');
  const replacementCount = (utf8Text.match(/\uFFFD/g) || []).length;
  if (replacementCount === 0) return utf8Text;
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch (_) {
    return utf8Text;
  }
}

function createEmptyProcessGovernanceV5Document() {
  return {
    schema_version: 'process-governance-v5',
    export_meta: {
      package_ref: `package_${crypto.randomBytes(8).toString('hex')}`,
      exported_at: new Date().toISOString(),
      initiating_department: '',
      compiler: ''
    },
    process: {
      process_ref: `process_${crypto.randomBytes(8).toString('hex')}`,
      process_name: '',
      owning_department: '',
      purpose: '',
      scope: '',
      capability_domain: null,
      business_capability: null,
      classification_status: 'unclassified'
    },
    reference_materials: [],
    behaviors: [],
    flow_relations: [],
    data_objects: [],
    internal_process_calls: [],
    forms: [],
    terms: []
  };
}

function createEmptyProcessGovernanceV6Document() {
  const source = createEmptyProcessGovernanceV5Document();
  return {
    schema_version: 'process-governance-v6',
    export_meta: source.export_meta,
    process: source.process,
    behaviors: [],
    flow_relations: [],
    data_objects: [],
    forms: [],
    terms: [],
    migration: {
      source_schema_version: 'process-governance-v6',
      source_process_ref: null,
      source_process_count: 1,
      legacy_cross_department_records: [],
      reference_materials: [],
      internal_process_calls: [],
      work_roles: [],
      unresolved_actor_roles: [],
      unresolved_join_modes: []
    }
  };
}

function createEmptyProcessGovernanceV7Document() {
  const source = createEmptyProcessGovernanceV6Document();
  source.schema_version = 'process-governance-v7';
  source.migration.source_schema_version = 'process-governance-v7';
  return source;
}

function createEmptyProcessGovernanceDocument() {
  return createEmptyProcessGovernanceV7Document();
}

function normalizeUploadedFileName(value) {
  const original = String(value || '');
  if (!original) return original;
  const decoded = Buffer.from(original, 'latin1').toString('utf8');
  if (!decoded || decoded.includes('\uFFFD')) return original;
  const originalCjk = (original.match(/[\u4e00-\u9fa5]/g) || []).length;
  const decodedCjk = (decoded.match(/[\u4e00-\u9fa5]/g) || []).length;
  return decodedCjk > originalCjk ? decoded : original;
}

function normalizeLine(line) {
  return String(line || '').replace(/\u3000/g, ' ').trim();
}

function stripNumbering(line) {
  return normalizeLine(line).replace(/^(?:第?[一二三四五六七八九十百]+[章节条]?|[0-9]+(?:\.[0-9]+)*|[（(]?[0-9]+[)）]|[（(][一二三四五六七八九十百]+[)）])\s*[、.．:：)）-]?\s*/, '');
}

function isSectionHeading(line) {
  const stripped = stripNumbering(line);
  return SECTION_LABELS.some(label => stripped === label || stripped.startsWith(`${label}:`) || stripped.startsWith(`${label}：`));
}

function findSectionLine(lines, labels) {
  for (let i = 0; i < lines.length; i += 1) {
    const stripped = stripNumbering(lines[i]);
    for (const label of labels) {
      if (stripped === label || stripped.startsWith(`${label}:`) || stripped.startsWith(`${label}：`)) {
        return { index: i, label, stripped };
      }
    }
  }
  return null;
}

function extractLabeledBlock(text, labels) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const found = findSectionLine(lines, labels);
  if (!found) return null;

  const inlineValue = found.stripped.replace(found.label, '').replace(/^[：:\s]+/, '').trim();
  const block = [];
  if (inlineValue) block.push(inlineValue);

  for (let i = found.index + 1; i < lines.length; i += 1) {
    const line = normalizeLine(lines[i]);
    if (!line) {
      if (block.length) block.push('');
      continue;
    }
    const strippedLine = stripNumbering(line);
    if (['术语和定义', '术语与定义'].includes(found.label) && ['术语', '定义'].includes(strippedLine)) {
      block.push(line);
      continue;
    }
    if (isSectionHeading(line)) break;
    block.push(line);
  }

  return block.join('\n').replace(/\n{3,}/g, '\n\n').trim() || null;
}

function extractLabeledBlocks(text, labels) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];

  for (let i = 0; i < lines.length; i += 1) {
    const stripped = stripNumbering(lines[i]);
    const label = labels.find(item => stripped === item || stripped.startsWith(`${item}:`) || stripped.startsWith(`${item}：`));
    if (!label) continue;

    const inlineValue = stripped.replace(label, '').replace(/^[：:\s]+/, '').trim();
    const block = [];
    if (inlineValue) block.push(inlineValue);

    for (let j = i + 1; j < lines.length; j += 1) {
      const line = normalizeLine(lines[j]);
      if (!line) {
        if (block.length) block.push('');
        continue;
      }
      if (isSectionHeading(line)) break;
      block.push(line);
    }

    const value = block.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (value) blocks.push({
      label,
      block: value,
      lineOffset: inlineValue ? i : i + 1
    });
  }

  return blocks;
}

function sourceAnchorFor(text, sourceText) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const needle = String(sourceText || '').trim();
  const lineIndex = lines.findIndex(line => normalizeLine(line).includes(needle));
  if (lineIndex >= 0) return `第 ${lineIndex + 1} 行`;
  const fragments = needle.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  for (const fragment of fragments) {
    const fragmentIndex = lines.findIndex(line => normalizeLine(line).includes(fragment));
    if (fragmentIndex >= 0) return `第 ${fragmentIndex + 1} 行`;
  }
  return '原文片段';
}

function addSource(fieldSources, fieldOrigins, pathKey, text, sourceText, sourceName, sourceAnchor = null) {
  if (!pathKey || !sourceText) return;
  fieldSources[pathKey] = {
    source_name: sourceName || null,
    source_anchor: sourceAnchor || sourceAnchorFor(text, sourceText),
    source_text: String(sourceText).trim()
  };
  fieldOrigins[pathKey] = 'auto';
}

function addExternalSource(fieldSources, fieldOrigins, pathKey, sourceText, sourceName, sourceAnchor, origin = 'auto') {
  if (!pathKey || !sourceText) return;
  fieldSources[pathKey] = {
    source_name: sourceName || null,
    source_anchor: sourceAnchor || '来源文件',
    source_text: String(sourceText).trim()
  };
  fieldOrigins[pathKey] = origin;
}

function addWarning(fieldWarnings, pathKey, warning) {
  if (!pathKey || !warning) return;
  fieldWarnings[pathKey] = warning;
}

function markDefault(fieldOrigins, pathKey) {
  if (!fieldOrigins[pathKey]) fieldOrigins[pathKey] = 'default';
}

function setValue(data, pathKey, value) {
  const parts = pathKey.split('.');
  let target = data;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (target[part] == null) target[part] = {};
    target = target[part];
  }
  target[parts[parts.length - 1]] = value;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPunctuationOnly(value) {
  return /^[\s\-—–_()（）【】\[\]{}:：;；,.，。/\\|]+$/.test(String(value || ''));
}

function isValidKeyValue(label, value, options = {}) {
  const normalized = normalizeLine(value).replace(/^["“”'‘’]+|["“”'‘’]+$/g, '');
  if (!normalized || isPunctuationOnly(normalized)) return false;
  if (/^□/.test(normalized)) return false;
  if (labelsEqual(normalized, label)) return false;
  if (options.pattern && !options.pattern.test(normalized)) return false;
  if (options.reject && options.reject.test(normalized)) return false;
  return true;
}

function labelsEqual(value, label) {
  return normalizeLine(value).replace(/\s/g, '') === normalizeLine(label).replace(/\s/g, '');
}

function extractKeyValue(text, labels, options = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const nonEmpty = lines
    .map((line, index) => ({ line: normalizeLine(line), index }))
    .filter(item => item.line);

  for (const item of nonEmpty) {
    for (const label of labels) {
      const match = item.line.match(new RegExp(`(?:^|\\s)${escapeRegExp(label)}\\s*[：:]\\s*(.+)$`));
      if (!match) continue;
      const value = normalizeLine(match[1]);
      if (!isValidKeyValue(label, value, options)) continue;
      return { value, sourceText: item.line, lineIndex: item.index };
    }
  }

  for (let i = 0; i < nonEmpty.length - 1; i += 1) {
    const item = nonEmpty[i];
    for (const label of labels) {
      if (!labelsEqual(item.line, label)) continue;
      const next = nonEmpty[i + 1];
      const value = normalizeLine(next.line);
      if (!isValidKeyValue(label, value, options)) continue;
      return { value, sourceText: `${item.line}\n${next.line}`, lineIndex: item.index };
    }
  }
  return null;
}

function normalizeDepartment(value) {
  const raw = normalizeLine(value);
  if (!raw) return { department_name: '', department_code: null, domain: null };
  const found = ENUMS.departments.find(item => raw.includes(item.department_name) || item.department_name.includes(raw));
  const departmentName = found?.department_name || raw;
  return {
    department_name: departmentName,
    department_code: null,
    domain: found?.domain || null
  };
}

function splitList(value) {
  return String(value || '')
    .split(/[,，、;；\s/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function flattenBlock(block) {
  return String(block || '').replace(/\s*\n\s*/g, ' ').trim();
}

function parseMarkdownRow(line) {
  const trimmed = normalizeLine(line);
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  if (/^\|\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|$/.test(trimmed)) return null;
  return trimmed.slice(1, -1).split('|').map(cell => normalizeLine(cell));
}

function decodeHtmlEntity(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlText(fragment) {
  return normalizeLine(decodeHtmlEntity(String(fragment || '')
    .replace(/<\/p>\s*<p[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')));
}

function compactLabel(value) {
  return normalizeLine(value).replace(/\s+/g, '');
}

function normalizeTableTitle(value) {
  return compactLabel(value);
}

function extractHtmlTables(html) {
  const tables = [];
  const source = String(html || '');
  for (const tableMatch of source.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = [];
    for (const rowMatch of tableMatch[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [];
      for (const cellMatch of rowMatch[0].matchAll(/<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi)) {
        const attrs = cellMatch[1] || '';
        const colSpan = Number((attrs.match(/\bcolspan=["']?(\d+)/i) || [])[1] || 1);
        const rowSpan = Number((attrs.match(/\browspan=["']?(\d+)/i) || [])[1] || 1);
        cells.push({
          text: htmlText(cellMatch[2]),
          colSpan: Number.isFinite(colSpan) && colSpan > 0 ? colSpan : 1,
          rowSpan: Number.isFinite(rowSpan) && rowSpan > 0 ? rowSpan : 1
        });
      }
      if (cells.some(cell => cell.text)) rows.push(cells);
    }
    if (rows.length) tables.push({ rows, text: rows.map(row => row.map(cell => cell.text).filter(Boolean).join(' | ')).join('\n') });
  }
  return tables;
}

const docxParserPool = createDocxParserPool({
  maxConcurrent: MAX_CONCURRENT_DOCX_PARSERS,
  timeoutMs: DOCX_PARSE_TIMEOUT_MS,
  extractTables: extractHtmlTables
});

function normalizeRoleToken(value) {
  return normalizeLine(value).replace(/[\s/／\\\-—–_·,，、()（）]/g, '');
}

function loadRosterRoleCatalog() {
  if (rosterRoleCatalogCache) return rosterRoleCatalogCache;
  const catalog = {
    available: false,
    pairs: new Set(),
    departments: new Set(),
    positions: new Set(),
    rolesByDepartment: {}
  };
  if (!fs.existsSync(ROSTER_PATH)) {
    rosterRoleCatalogCache = catalog;
    return catalog;
  }

  const rolesByDepartment = new Map();
  const lines = fs.readFileSync(ROSTER_PATH, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  let headers = null;
  for (const line of lines) {
    const row = parseMarkdownRow(line);
    if (!row) continue;
    if (row.some(cell => /^-+$/.test(cell))) continue;
    if (row.includes('姓名') && row.includes('部门')) {
      headers = row;
      continue;
    }
    if (!headers) continue;
    const value = name => {
      const index = headers.indexOf(name);
      return index >= 0 ? normalizeLine(row[index]) : '';
    };
    const department = value('部门');
    const position = value('职务') || value('岗位');
    if (!department || !position) continue;
    const deptToken = normalizeRoleToken(department);
    const positionToken = normalizeRoleToken(position);
    if (!deptToken || !positionToken) continue;
    catalog.departments.add(deptToken);
    catalog.positions.add(positionToken);
    catalog.pairs.add(`${deptToken}${positionToken}`);
    catalog.pairs.add(`${department}${position}`);
    if (!rolesByDepartment.has(department)) rolesByDepartment.set(department, new Set());
    rolesByDepartment.get(department).add(position);
  }
  if (!rolesByDepartment.has(COMPANY_LEADERSHIP_DEPARTMENT)) {
    rolesByDepartment.set(COMPANY_LEADERSHIP_DEPARTMENT, new Set());
  }
  for (const role of COMPANY_LEADERSHIP_ROLES) {
    const roleToken = normalizeRoleToken(role);
    if (!roleToken) continue;
    catalog.departments.add(normalizeRoleToken(COMPANY_LEADERSHIP_DEPARTMENT));
    catalog.positions.add(roleToken);
    catalog.pairs.add(`${normalizeRoleToken(COMPANY_LEADERSHIP_DEPARTMENT)}${roleToken}`);
    catalog.pairs.add(`${COMPANY_LEADERSHIP_DEPARTMENT}${role}`);
    rolesByDepartment.get(COMPANY_LEADERSHIP_DEPARTMENT).add(role);
  }
  catalog.available = catalog.pairs.size > 0;
  catalog.rolesByDepartment = Object.fromEntries(
    Array.from(rolesByDepartment.entries())
      .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
      .map(([department, positions]) => [
        department,
        Array.from(positions).sort((left, right) => left.localeCompare(right, 'zh-CN'))
      ])
  );
  rosterRoleCatalogCache = catalog;
  return catalog;
}

function isEffectiveWorkRoleRecord(record, today = new Date().toISOString().slice(0, 10)) {
  if (!record || record.status !== 'active') return false;
  if (record.effective_from && record.effective_from > today) return false;
  if (record.effective_to && record.effective_to < today) return false;
  return true;
}

function loadWorkRoleCatalog() {
  if (workRoleCatalogCache) return workRoleCatalogCache;
  const empty = {
    available: false,
    schemaVersion: 'work-role-data-v1',
    workRoles: [],
    workRolePositionMappings: [],
    workRoleAliases: [],
    workRolesByDepartment: {},
    roleByCode: new Map()
  };
  if (!fs.existsSync(WORK_ROLE_DATA_PATH)) {
    workRoleCatalogCache = empty;
    return empty;
  }

  try {
    const source = JSON.parse(fs.readFileSync(WORK_ROLE_DATA_PATH, 'utf8'));
    const workRoles = (Array.isArray(source.workRoles) ? source.workRoles : [])
      .filter(item => item && item.work_role_code && item.work_role_name)
      .map(item => {
        const role = {
          work_role_code: normalizeLine(item.work_role_code),
          work_role_name: normalizeLine(item.work_role_name),
          definition: normalizeLine(item.definition) || null,
          status: normalizeLine(item.status) || 'draft',
          effective_from: item.effective_from || null,
          effective_to: item.effective_to || null
        };
        return { ...role, is_effective: isEffectiveWorkRoleRecord(role) };
      });
    const roleByCode = new Map(workRoles.map(item => [item.work_role_code, item]));
    const mappings = (Array.isArray(source.workRolePositionMappings) ? source.workRolePositionMappings : [])
      .filter(item => item && roleByCode.has(normalizeLine(item.work_role_code)))
      .map(item => {
        const mapping = {
          work_role_code: normalizeLine(item.work_role_code),
          department_name: normalizeLine(item.department_name),
          position_name: normalizeLine(item.position_name),
          status: normalizeLine(item.status) || 'draft',
          effective_from: item.effective_from || null,
          effective_to: item.effective_to || null
        };
        return { ...mapping, is_effective: isEffectiveWorkRoleRecord(mapping) };
      });
    const aliases = (Array.isArray(source.workRoleAliases) ? source.workRoleAliases : [])
      .filter(item => item && roleByCode.has(normalizeLine(item.work_role_code)))
      .map(item => ({
        source_role_text: normalizeLine(item.source_role_text),
        work_role_code: normalizeLine(item.work_role_code),
        department_name: normalizeLine(item.department_name),
        status: normalizeLine(item.status) || 'active'
      }));
    const byDepartment = new Map();
    for (const mapping of mappings) {
      const role = roleByCode.get(mapping.work_role_code);
      if (!role?.is_effective || !mapping.is_effective || !mapping.department_name) continue;
      if (!byDepartment.has(mapping.department_name)) byDepartment.set(mapping.department_name, new Map());
      const departmentRoles = byDepartment.get(mapping.department_name);
      if (!departmentRoles.has(role.work_role_code)) {
        departmentRoles.set(role.work_role_code, { ...role, position_names: [] });
      }
      const item = departmentRoles.get(role.work_role_code);
      if (mapping.position_name && !item.position_names.includes(mapping.position_name)) item.position_names.push(mapping.position_name);
    }
    const workRolesByDepartment = Object.fromEntries(
      Array.from(byDepartment.entries())
        .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
        .map(([department, roles]) => [
          department,
          Array.from(roles.values()).sort((left, right) => left.work_role_code.localeCompare(right.work_role_code))
        ])
    );
    workRoleCatalogCache = {
      available: workRoles.some(item => item.is_effective),
      schemaVersion: source.schemaVersion || 'work-role-data-v1',
      workRoles,
      workRolePositionMappings: mappings,
      workRoleAliases: aliases,
      workRolesByDepartment,
      roleByCode
    };
    return workRoleCatalogCache;
  } catch (_) {
    workRoleCatalogCache = empty;
    return empty;
  }
}

function publicEnums() {
  const workRoleCatalog = loadWorkRoleCatalog();
  return {
    ...ENUMS,
    rosterRolesByDepartment: loadRosterRoleCatalog().rolesByDepartment || {},
    workRoles: workRoleCatalog.workRoles,
    workRolesByDepartment: workRoleCatalog.workRolesByDepartment,
    workRoleDataVersion: workRoleCatalog.schemaVersion
  };
}

function splitActorRoleValues(actorRole) {
  return String(actorRole || '')
    .split(/(?:、|,|，|\/|／|或|及|和)/)
    .map(normalizeLine)
    .filter(Boolean);
}

function rosterPositionsForDepartment(catalog, department) {
  return Array.isArray(catalog.rolesByDepartment?.[department]) ? catalog.rolesByDepartment[department] : [];
}

function findRosterDepartment(value, catalog) {
  const token = normalizeRoleToken(value);
  return Object.keys(catalog.rolesByDepartment || {})
    .sort((left, right) => right.length - left.length)
    .find(department => token.startsWith(normalizeRoleToken(department)));
}

function actorMatchesDepartmentPosition(value, department, catalog) {
  const token = normalizeRoleToken(value);
  const deptToken = normalizeRoleToken(department);
  const positions = rosterPositionsForDepartment(catalog, department).map(position => normalizeRoleToken(position));
  if (!token || !deptToken || !positions.length) return false;
  return positions.some(positionToken => token === positionToken || token === `${deptToken}${positionToken}`);
}

function checkActorAgainstRoster(actorRole, expectedDepartment = '') {
  const role = normalizeLine(actorRole);
  if (!role) return null;
  const catalog = loadRosterRoleCatalog();
  if (!catalog.available) {
    return '当前未读取到花名册，原文角色对应的候选岗位需要人工核对。';
  }

  const values = splitActorRoleValues(role);
  const invalid = [];
  const outsideDepartment = [];
  for (const value of values.length ? values : [role]) {
    const token = normalizeRoleToken(value);
    if (!token) continue;
    if (expectedDepartment) {
      const valueDepartment = findRosterDepartment(value, catalog);
      if (valueDepartment && valueDepartment !== expectedDepartment) {
        outsideDepartment.push(value);
        continue;
      }
      if (actorMatchesDepartmentPosition(value, expectedDepartment, catalog)) continue;
      invalid.push(value);
      continue;
    }
    if (catalog.pairs.has(token)) continue;
    let matchedPair = false;
    for (const pair of catalog.pairs) {
      if (token.includes(pair)) {
        matchedPair = true;
        break;
      }
    }
    if (matchedPair) continue;
    invalid.push(value);
  }
  if (outsideDepartment.length) {
    return '原文中的这个角色称谓可能不属于当前归口部门，请核对参与部门或作为跨部门流转处理。';
  }
  if (!invalid.length) return null;
  if (expectedDepartment) return '花名册里没有找到当前归口部门下的同名候选岗位，请核对制度原文；岗位同名也不代表工作角色已经确认。';
  return '花名册里没有找到这个原文角色对应的候选部门和岗位，请核对制度原文。';
}

function applyActorRoleWarnings(data, context) {
  const expectedDepartment = data.draft?.department?.department_name || '';
  data.steps.forEach((step, index) => {
    const message = checkActorAgainstRoster(step.actor_role, expectedDepartment);
    if (!message) return;
    addWarning(context.fieldWarnings, `steps.${index}.actor_role`, {
      value: step.actor_role,
      message
    });
  });
}

function roleDepartmentName(sourceRoleText, fallbackDepartment) {
  const text = normalizeLine(sourceRoleText);
  const candidates = [
    ...ENUMS.departments.map(item => item.department_name),
    ...Object.keys(loadWorkRoleCatalog().workRolesByDepartment || {})
  ].filter(Boolean).sort((left, right) => right.length - left.length);
  return candidates.find(department => text.includes(department)) || normalizeLine(fallbackDepartment);
}

function roleTextKind(sourceRoleText) {
  const value = normalizeLine(sourceRoleText);
  if (!value) return 'empty';
  if (/(?:→|->|\/|／|、|，|,|；|;|与|及|和)/.test(value)) return 'multiple';
  if (/^(?:申请人|当前处理人|本人|经办人|全体员工|全体人员|全公司人员|所有员工)$/.test(value)) return 'contextual';
  if (/^(?:客户|供应商|银行|外部机构|第三方|承包商|承揽方)(?:$|代表$|联系人$|单位$)/.test(value)) return 'external';
  if (/^(?:有关部门|相关部门|各部门|各单位|相关单位|使用单位|责任单位|业务部门|所属部门|班组)(?:负责人|人员|代表)?$/.test(value)) return 'collective';
  return 'candidate';
}

function inferWorkRoleParticipationType(step) {
  const text = normalizeLine([step?.step_name, step?.actor_role].filter(Boolean).join(' '));
  if (/批准|审批|签发|核准/.test(text)) return 'approver';
  if (/审核|复核|校对|核对|评审/.test(text)) return 'reviewer';
  if (/发起|申请|提出/.test(text)) return 'initiator';
  if (/提供|报送|提交资料|传递/.test(text)) return 'provider';
  if (/接收|承接|收取/.test(text)) return 'receiver';
  if (/协同|协作|配合|会签/.test(text)) return 'collaborator';
  return 'executor';
}

function activeWorkRoleCandidates(sourceRoleText, departmentName) {
  const catalog = loadWorkRoleCatalog();
  if (!catalog.available) return [];
  const sourceToken = normalizeRoleToken(sourceRoleText);
  const departmentToken = normalizeRoleToken(departmentName);
  if (!sourceToken) return [];
  const matchingCodes = new Set();
  const activeMappings = catalog.workRolePositionMappings.filter(mapping =>
    mapping.is_effective &&
    (!departmentName || mapping.department_name === departmentName || mapping.department_name === '全公司')
  );
  const rolesAvailableInDepartment = new Set(activeMappings.map(mapping => mapping.work_role_code));

  for (const role of catalog.workRoles) {
    if (!role.is_effective || !rolesAvailableInDepartment.has(role.work_role_code)) continue;
    const roleToken = normalizeRoleToken(role.work_role_name);
    if (sourceToken === roleToken || (departmentToken && sourceToken === `${departmentToken}${roleToken}`)) {
      matchingCodes.add(role.work_role_code);
    }
  }
  for (const alias of catalog.workRoleAliases) {
    if (alias.status !== 'active' || !rolesAvailableInDepartment.has(alias.work_role_code)) continue;
    if (alias.department_name && departmentName && alias.department_name !== departmentName && alias.department_name !== '全公司') continue;
    const aliasToken = normalizeRoleToken(alias.source_role_text);
    if (sourceToken === aliasToken || (departmentToken && sourceToken === `${departmentToken}${aliasToken}`)) {
      matchingCodes.add(alias.work_role_code);
    }
  }
  for (const mapping of activeMappings) {
    const positionToken = normalizeRoleToken(mapping.position_name);
    if (!positionToken) continue;
    if (sourceToken === positionToken || (departmentToken && sourceToken === `${departmentToken}${positionToken}`)) {
      matchingCodes.add(mapping.work_role_code);
    }
  }
  return Array.from(matchingCodes)
    .map(code => catalog.roleByCode.get(code))
    .filter(Boolean);
}

function roleIssueStableKey(data, step, sourceRoleText) {
  const source = [
    data.draft?.department?.department_name,
    data.draft?.document_no || data.draft?.document_title,
    step.process_ref,
    step.step_ref,
    sourceRoleText,
    'work_role_bindings'
  ].join('|');
  return `work-role-${crypto.createHash('sha256').update(source).digest('hex').slice(0, 20)}`;
}

function addRoleEvidenceAndReviewItems(data, context) {
  const bindings = [];
  const issues = [];
  const processesByRef = new Map((data.processes || []).map(item => [item.process_ref, item]));
  for (const [index, step] of (data.steps || []).entries()) {
    const sourceRoleText = normalizeLine(step.actor_role);
    if (!sourceRoleText) continue;
    const fieldPath = `steps.${index}.actor_role`;
    const source = context.fieldSources[fieldPath] || {};
    const evidenceRef = `EV-ROLE-${String(index + 1).padStart(3, '0')}`;
    const participantDepartmentName = roleDepartmentName(
      sourceRoleText,
      processesByRef.get(step.process_ref)?.owner || data.draft?.department?.department_name || ''
    );
    data.evidence_catalog.push({
      evidence_ref: evidenceRef,
      draft_ref: null,
      object_type: 'step',
      object_ref: step.step_ref,
      evidence_type: '制度条款',
      description: `制度原文中的角色或岗位称谓：${sourceRoleText}`,
      source_name: source.source_name || data.draft?.document_title || null,
      source_anchor: source.source_anchor || null,
      source_file: source.source_name || null,
      source_excerpt: source.source_text || sourceRoleText,
      locator: source.source_anchor || null,
      locate_method: context.fieldOrigins[fieldPath] === 'external_reference' ? 'external_reference' : 'template_text',
      confirmer: null,
      record_time: null,
      missing_reason: null,
      expected_provider: participantDepartmentName || null,
      expected_at: null,
      maturity: '可保存草稿',
      status: 'pending_review'
    });
    step.evidence_refs = Array.from(new Set([...(step.evidence_refs || []), evidenceRef]));

    const kind = roleTextKind(sourceRoleText);
    const candidates = kind === 'candidate'
      ? activeWorkRoleCandidates(sourceRoleText, participantDepartmentName)
      : [];
    if (candidates.length === 1) {
      bindings.push({
        binding_ref: `wr_binding_${bindings.length + 1}`,
        process_ref: step.process_ref,
        step_ref: step.step_ref,
        participant_department: normalizeDepartment(participantDepartmentName),
        source_role_text: sourceRoleText,
        work_role_code: candidates[0].work_role_code,
        participation_type: inferWorkRoleParticipationType(step),
        status: 'proposed',
        evidence_refs: [evidenceRef],
        confirmation_basis: null
      });
    }

    const issueReason = kind === 'multiple'
      ? '原文在同一字段中包含多个角色，需要逐个确认参与类型。'
      : kind === 'contextual'
        ? '这是随流程实例变化的场景身份，不应直接登记为固定工作角色。'
        : kind === 'external'
          ? '这是外部参与方，不应直接登记为内部工作角色。'
          : kind === 'collective'
            ? '这是组织或集体称谓，需要确认是否存在可映射岗位的正式工作角色。'
            : candidates.length === 1
              ? `系统只提出候选 ${candidates[0].work_role_code}，仍需流程责任部门确认。`
              : candidates.length > 1
                ? '原文可对应多个正式工作角色，需要人工选择。'
                : '尚未找到行政人事部已发布且在参与部门具有有效岗位映射的工作角色。';
    issues.push({
      stable_key: roleIssueStableKey(data, step, sourceRoleText),
      department: participantDepartmentName || null,
      document_name: data.draft?.document_title || null,
      structured_object_type: 'step',
      structured_object_key: String(step.a1_code || step.step_ref),
      target_block: 'work_role_bindings',
      target_field: 'work_role_code',
      current_value: sourceRoleText,
      source_file: source.source_name || null,
      source_anchor: source.source_anchor || null,
      source_excerpt: source.source_text || sourceRoleText,
      evidence_status: 'pending_review',
      issue_type: '角色责任待确认',
      question_for_user: `${issueReason} 请核对这个业务行为应由哪个工作角色以何种方式参与。`,
      suggested_handler: '流程责任部门与行政人事部',
      allowed_actions: ['专项确认', '不是问题'],
      user_decision: null,
      user_reason: null,
      user_note: null,
      next_step: '先核对制度原文，再由流程责任部门确认绑定；角色目录或岗位映射缺失时交行政人事部维护。'
    });
  }
  data.work_role_bindings = bindings;
  data.pending_issues = issues;
}

function addClassificationReviewItems(data, context) {
  for (const [index, process] of (data.processes || []).entries()) {
    const source = context.fieldSources[`processes.${index}.l3_name`] || {};
    for (const [fieldName, fieldLabel] of [['l1_name', '能力域'], ['l2_name', '业务能力']]) {
      if (normalizeLine(process[fieldName]) !== '待确认') continue;
      const stableSource = [
        data.draft?.document_no || data.draft?.document_title,
        process.process_ref,
        fieldName
      ].join('|');
      data.pending_issues.push({
        stable_key: `process-classification-${crypto.createHash('sha256').update(stableSource).digest('hex').slice(0, 20)}`,
        department: data.draft?.department?.department_name || null,
        document_name: data.draft?.document_title || null,
        structured_object_type: 'process',
        structured_object_key: String(process.process_ref),
        target_block: 'l3_catalog',
        target_field: fieldName,
        current_value: '待确认',
        source_file: source.source_name || context.sourceName || null,
        source_anchor: source.source_anchor || null,
        source_excerpt: source.source_text || process.l3_name,
        evidence_status: 'pending_review',
        issue_type: 'L3 结构待确认',
        question_for_user: `请确认业务流程“${process.l3_name}”所属的${fieldLabel}。`,
        suggested_handler: '流程责任部门',
        allowed_actions: ['专项确认'],
        user_decision: null,
        user_reason: null,
        user_note: null,
        next_step: `由流程责任部门确认${fieldLabel}后更新结构化文件。`
      });
    }
  }
}

function resolveSchemaNode(schema, rootSchema = STANDARD_SCHEMA) {
  if (!schema?.$ref) return schema || {};
  const segments = schema.$ref.replace(/^#\//, '').split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  return segments.reduce((node, segment) => node?.[segment], rootSchema) || {};
}

function schemaAllowsNull(schema) {
  const resolved = resolveSchemaNode(schema);
  if (resolved.type === 'null') return true;
  if (Array.isArray(resolved.type) && resolved.type.includes('null')) return true;
  return [...(resolved.anyOf || []), ...(resolved.oneOf || [])].some(option => schemaAllowsNull(option));
}

function schemaMinLength(schema) {
  const resolved = resolveSchemaNode(schema);
  if (Number.isFinite(resolved.minLength)) return resolved.minLength;
  const options = [...(resolved.anyOf || []), ...(resolved.oneOf || [])];
  return options.reduce((maximum, option) => Math.max(maximum, schemaMinLength(option)), 0);
}

function schemaAllowsEmptyString(schema) {
  const resolved = resolveSchemaNode(schema);
  if (resolved.const === '') return true;
  if (Array.isArray(resolved.enum)) return resolved.enum.includes('');
  if (resolved.type === 'string') return !Number.isFinite(resolved.minLength) || resolved.minLength === 0;
  if (Array.isArray(resolved.type) && resolved.type.includes('string')) {
    return !Number.isFinite(resolved.minLength) || resolved.minLength === 0;
  }
  return [...(resolved.anyOf || []), ...(resolved.oneOf || [])].some(option => schemaAllowsEmptyString(option));
}

function normalizeOptionalContractValues(value, schema) {
  const resolved = resolveSchemaNode(schema);
  if (Array.isArray(value)) {
    const itemSchema = resolved.items || {};
    value.forEach(item => normalizeOptionalContractValues(item, itemSchema));
    return value;
  }
  if (!value || typeof value !== 'object') return value;

  const required = new Set(resolved.required || []);
  for (const key of Object.keys(value)) {
    const propertySchema = resolved.properties?.[key];
    if (!propertySchema) {
      if (resolved.additionalProperties === false) delete value[key];
      continue;
    }
    const propertyValue = value[key];
    if (propertyValue === null && !required.has(key) && !schemaAllowsNull(propertySchema)) {
      delete value[key];
      continue;
    }
    if (
      propertyValue === '' &&
      !required.has(key) &&
      (schemaMinLength(propertySchema) > 0 || !schemaAllowsEmptyString(propertySchema))
    ) {
      delete value[key];
      continue;
    }
    normalizeOptionalContractValues(propertyValue, propertySchema);
  }
  return value;
}

function contractValidationResult(data) {
  const valid = validateStandardDocument(data);
  return {
    valid: Boolean(valid),
    errors: valid
      ? []
      : (validateStandardDocument.errors || []).map(error => ({
          path: error.instancePath || '/',
          keyword: error.keyword,
          message: error.message || '不符合统一结构规则',
          params: error.params || {}
        }))
  };
}

function processGovernanceValidationResult(data, options = {}) {
  if (data?.schema_version === 'process-governance-v7') {
    return validateProcessGovernanceV7(data, {
      schemaValidator: options.validationProfile === 'early-v7-data-fields'
        ? validateEarlyV7DataFieldsDocument
        : validateProcessGovernanceV7Document
    });
  }
  const validators = {
    'process-governance-v1': validateProcessGovernanceV1Document,
    'process-governance-v2': validateProcessGovernanceV2Document,
    'process-governance-v3': validateProcessGovernanceV3Document,
    'process-governance-v4': validateProcessGovernanceV4Document,
    'process-governance-v5': validateProcessGovernanceV5Document,
    'process-governance-v6': validateProcessGovernanceV6Document,
    'process-governance-v7': validateProcessGovernanceV7Document
  };
  const validator = validators[data?.schema_version] || validateProcessGovernanceV5Document;
  const schemaValid = validator(data);
  const errors = schemaValid
    ? []
    : (validator.errors || []).map(error => ({
        path: error.instancePath || '/',
        keyword: error.keyword,
        message: error.message || '不符合单流程结构规则',
        params: error.params || {}
      }));

  const addError = (pathKey, message, params = {}) => {
    errors.push({ path: pathKey, keyword: 'localReference', message, params });
  };
  const uniqueRefs = (items, key, basePath) => {
    const seen = new Set();
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const value = item?.[key];
      if (!value) return;
      if (seen.has(value)) addError(`${basePath}/${index}/${key}`, `技术标识 ${value} 在当前文件中重复`, { ref: value });
      seen.add(value);
    });
    return seen;
  };
  const requireLocalRef = (set, value, pathKey, label) => {
    if (value && !set.has(value)) addError(pathKey, `${label} ${value} 不在当前文件中`, { ref: value });
  };

  const behaviors = Array.isArray(data?.behaviors) ? data.behaviors : [];
  const behaviorByRef = new Map(behaviors.map(behavior => [behavior?.behavior_ref, behavior]));
  const flowRelations = Array.isArray(data?.flow_relations) ? data.flow_relations : [];
  const dataObjects = Array.isArray(data?.data_objects) ? data.data_objects : [];
  const handoffs = Array.isArray(data?.cross_department_handoffs) ? data.cross_department_handoffs : [];
  const currentStructuredVersion = ['process-governance-v6', 'process-governance-v7'].includes(data?.schema_version);
  const modernDataVersion = ['process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(data?.schema_version);
  const internalCalls = currentStructuredVersion
    ? (Array.isArray(data?.migration?.internal_process_calls) ? data.migration.internal_process_calls : [])
    : (Array.isArray(data?.internal_process_calls) ? data.internal_process_calls : []);
  const forms = Array.isArray(data?.forms) ? data.forms : [];

  const behaviorRefs = uniqueRefs(behaviors, 'behavior_ref', '/behaviors');
  const dataRefs = uniqueRefs(dataObjects, 'data_ref', '/data_objects');
  const dataFieldOwners = new Map();
  uniqueRefs(flowRelations, 'relation_ref', '/flow_relations');
  uniqueRefs(handoffs, 'handoff_ref', '/cross_department_handoffs');
  uniqueRefs(internalCalls, 'call_ref', '/internal_process_calls');
  uniqueRefs(forms, 'form_ref', '/forms');
  const referenceMaterials = currentStructuredVersion
    ? data?.migration?.reference_materials
    : data?.reference_materials;
  uniqueRefs(referenceMaterials, 'material_ref', currentStructuredVersion ? '/migration/reference_materials' : '/reference_materials');
  uniqueRefs(data?.terms, 'term_ref', '/terms');

  behaviors.forEach((behavior, index) => {
    requireLocalRef(
      dataRefs,
      behavior?.actor_department_data_ref,
      `/behaviors/${index}/actor_department_data_ref`,
      '动态执行部门来源数据'
    );
    (behavior?.input_data_refs || []).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/behaviors/${index}/input_data_refs/${refIndex}`, '输入数据标识');
    });
    (behavior?.output_data_refs || []).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/behaviors/${index}/output_data_refs/${refIndex}`, '输出数据标识');
    });
    if (behavior?.work_role) {
      requireLocalRef(behaviorRefs, behavior.work_role.behavior_ref, `/behaviors/${index}/work_role/behavior_ref`, '工作角色绑定的业务行为');
      if (behavior.work_role.behavior_ref !== behavior.behavior_ref) {
        addError(`/behaviors/${index}/work_role/behavior_ref`, '工作角色必须绑定当前业务行为', {
          expected: behavior.behavior_ref,
          actual: behavior.work_role.behavior_ref
        });
      }
    }
  });

  flowRelations.forEach((relation, index) => {
    requireLocalRef(behaviorRefs, relation?.from_behavior_ref, `/flow_relations/${index}/from_behavior_ref`, '起点业务行为');
    requireLocalRef(behaviorRefs, relation?.to_behavior_ref, `/flow_relations/${index}/to_behavior_ref`, '终点业务行为');
  });

  dataObjects.forEach((dataObject, index) => {
    if (modernDataVersion) {
      const currentDataFieldRefs = new Set((dataObject?.fields || []).map(field => field?.field_ref).filter(Boolean));
      if (data?.schema_version === 'process-governance-v7') {
        uniqueRefs(dataObject?.fields, 'field_ref', `/data_objects/${index}/fields`);
        const fieldKeys = new Map();
        (dataObject?.fields || []).forEach((field, fieldIndex) => {
          const fieldPath = `/data_objects/${index}/fields/${fieldIndex}`;
          if (field?.field_ref) dataFieldOwners.set(field.field_ref, dataObject.data_ref);
          const key = `${String(field?.field_name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()}|${String(field?.field_type || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`;
          if (key !== '|') {
            if (fieldKeys.has(key)) {
              addError(fieldPath, `对象字段与${fieldKeys.get(key)}的名称和数据类型重复`, { ref: field?.field_ref });
            } else {
              fieldKeys.set(key, fieldPath);
            }
          }
        });
      }
      uniqueRefs(dataObject?.behavior_links, 'link_ref', `/data_objects/${index}/behavior_links`);
      uniqueRefs(dataObject?.source_relations, 'source_ref', `/data_objects/${index}/source_relations`);
      (dataObject?.behavior_links || []).forEach((link, linkIndex) => {
        requireLocalRef(behaviorRefs, link?.behavior_ref, `/data_objects/${index}/behavior_links/${linkIndex}/behavior_ref`, '数据关系对应行为');
        if (data?.schema_version === 'process-governance-v7') {
          if (link?.behavior_ref && behaviorByRef.get(link.behavior_ref)?.node_type !== 'action') {
            addError(
              `/data_objects/${index}/behavior_links/${linkIndex}/behavior_ref`,
              '数据关系关联了控制节点；请保留原内容，并将关系改到实际办理业务的行为',
              { ref: link.behavior_ref }
            );
          }
          const updatedFieldRefs = Array.isArray(link?.updated_field_refs) ? link.updated_field_refs : [];
          if (link?.operation !== 'update' && updatedFieldRefs.length) {
            addError(`/data_objects/${index}/behavior_links/${linkIndex}/updated_field_refs`, '只有更新操作可以登记更新字段', { ref: link?.link_ref });
          }
          updatedFieldRefs.forEach((fieldRef, fieldIndex) => {
            requireLocalRef(
              currentDataFieldRefs,
              fieldRef,
              `/data_objects/${index}/behavior_links/${linkIndex}/updated_field_refs/${fieldIndex}`,
              '更新字段'
            );
          });
        }
      });
      (dataObject?.source_relations || []).forEach((source, sourceIndex) => {
        requireLocalRef(
          behaviorRefs,
          source?.available_from_behavior_ref,
          `/data_objects/${index}/source_relations/${sourceIndex}/available_from_behavior_ref`,
          '数据可用位置'
        );
      });
      return;
    }
    requireLocalRef(behaviorRefs, dataObject?.produced_by_behavior_ref, `/data_objects/${index}/produced_by_behavior_ref`, '数据产生行为');
    (dataObject?.consumed_by_behavior_refs || []).forEach((ref, refIndex) => {
      requireLocalRef(behaviorRefs, ref, `/data_objects/${index}/consumed_by_behavior_refs/${refIndex}`, '数据使用行为');
    });
  });

  handoffs.forEach((handoff, index) => {
    if (data?.schema_version === 'process-governance-v1') {
      requireLocalRef(behaviorRefs, handoff?.send_behavior_ref, `/cross_department_handoffs/${index}/send_behavior_ref`, '发送行为');
      requireLocalRef(dataRefs, handoff?.input_data_ref, `/cross_department_handoffs/${index}/input_data_ref`, '承接输入数据');
      requireLocalRef(dataRefs, handoff?.returned_data_ref, `/cross_department_handoffs/${index}/returned_data_ref`, '承接返回数据');
      requireLocalRef(behaviorRefs, handoff?.return_behavior_ref, `/cross_department_handoffs/${index}/return_behavior_ref`, '主流程恢复行为');
      return;
    }
    requireLocalRef(behaviorRefs, handoff?.anchor_behavior_ref, `/cross_department_handoffs/${index}/anchor_behavior_ref`, '本流程锚点行为');
    requireLocalRef(dataRefs, handoff?.transfer_data_ref, `/cross_department_handoffs/${index}/transfer_data_ref`, '跨部门传递数据');
    requireLocalRef(dataRefs, handoff?.returned_data_ref, `/cross_department_handoffs/${index}/returned_data_ref`, '跨部门返回数据');
    requireLocalRef(behaviorRefs, handoff?.resume_behavior_ref, `/cross_department_handoffs/${index}/resume_behavior_ref`, '本流程恢复行为');
  });

  internalCalls.forEach((call, index) => {
    requireLocalRef(behaviorRefs, call?.caller_behavior_ref, `/internal_process_calls/${index}/caller_behavior_ref`, '调用行为');
    requireLocalRef(behaviorRefs, call?.return_behavior_ref, `/internal_process_calls/${index}/return_behavior_ref`, '返回后的恢复行为');
    (call?.input_data_refs || []).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/internal_process_calls/${index}/input_data_refs/${refIndex}`, '调用输入数据');
    });
    (call?.output_data_refs || []).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/internal_process_calls/${index}/output_data_refs/${refIndex}`, '调用输出数据');
    });
  });

  forms.forEach((form, formIndex) => {
    if (modernDataVersion) {
      uniqueRefs(form?.behavior_links, 'link_ref', `/forms/${formIndex}/behavior_links`);
      (form?.behavior_links || []).forEach((link, linkIndex) => {
        requireLocalRef(behaviorRefs, link?.behavior_ref, `/forms/${formIndex}/behavior_links/${linkIndex}/behavior_ref`, '表单关系对应行为');
        if (data?.schema_version === 'process-governance-v7' && link?.behavior_ref && behaviorByRef.get(link.behavior_ref)?.node_type !== 'action') {
          addError(
            `/forms/${formIndex}/behavior_links/${linkIndex}/behavior_ref`,
            '表单处理关系关联了控制节点；请保留原内容，并将关系改到实际办理业务的行为',
            { ref: link.behavior_ref }
          );
        }
      });
    } else {
      requireLocalRef(behaviorRefs, form?.behavior_ref, `/forms/${formIndex}/behavior_ref`, '表单对应行为');
    }
    uniqueRefs(form?.areas, 'area_ref', `/forms/${formIndex}/areas`);
    const itemRefs = new Set();
    (form?.areas || []).forEach((area, areaIndex) => {
      (area?.items || []).forEach((item, itemIndex) => {
        if (item?.item_ref && itemRefs.has(item.item_ref)) {
          addError(`/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/item_ref`, `技术标识 ${item.item_ref} 在当前表单中重复`, { ref: item.item_ref });
        }
        if (item?.item_ref) itemRefs.add(item.item_ref);
        if (!modernDataVersion) return;
        requireLocalRef(dataRefs, item?.business_data_ref, `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/business_data_ref`, '字段归属数据');
        if (data?.schema_version === 'process-governance-v7' && item?.data_field_ref) {
          const fieldPath = `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/data_field_ref`;
          const ownerRef = dataFieldOwners.get(item.data_field_ref);
          if (!ownerRef) {
            addError(fieldPath, `引用的对象字段 ${item.data_field_ref} 不在当前文件中`, { ref: item.data_field_ref });
          } else if (ownerRef !== item.business_data_ref) {
            addError(fieldPath, `引用的对象字段不属于字段已选择的数据对象 ${item.business_data_ref || '未选择'}`, {
              ref: item.data_field_ref,
              expected_data_ref: ownerRef
            });
          } else {
            const owner = dataObjects.find(dataObject => dataObject.data_ref === ownerRef);
            const dataField = (owner?.fields || []).find(field => field.field_ref === item.data_field_ref);
            if (dataField && dataField.field_type !== item.item_type) {
              addError(`/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/item_type`, '表单字段的数据类型与引用的对象字段不一致', {
                ref: item.data_field_ref,
                expected: dataField.field_type,
                actual: item.item_type
              });
            }
          }
        }
        uniqueRefs(item?.source_links, 'source_link_ref', `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/source_links`);
        (item?.source_links || []).forEach((link, linkIndex) => {
          if (['process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(data?.schema_version) && link?.source_type === 'external_system') return;
          requireLocalRef(dataRefs, link?.source_data_ref, `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/source_links/${linkIndex}/source_data_ref`, '字段取值来源数据');
        });
      });
    });
  });

  if (currentStructuredVersion) {
    const relationRefs = new Set(flowRelations.map(item => item?.relation_ref).filter(Boolean));
    const dataLinkRefs = new Set(dataObjects.flatMap(item => (item?.behavior_links || []).map(link => link?.link_ref)).filter(Boolean));
    const migration = data?.migration || {};
    const technicalIdentifiers = new Map();
    const registerIdentifiers = (items, key, basePath) => {
      (Array.isArray(items) ? items : []).forEach((item, index) => {
        const value = item?.[key];
        if (!value) return;
        const currentPath = `${basePath}/${index}/${key}`;
        if (technicalIdentifiers.has(value)) {
          addError(currentPath, `技术标识 ${value} 与 ${technicalIdentifiers.get(value)} 重复`, { ref: value });
        } else {
          technicalIdentifiers.set(value, currentPath);
        }
      });
    };
    registerIdentifiers([data.export_meta], 'package_ref', '/export_meta');
    registerIdentifiers([data.process], 'process_ref', '/process');
    registerIdentifiers(behaviors, 'behavior_ref', '/behaviors');
    registerIdentifiers(flowRelations, 'relation_ref', '/flow_relations');
    registerIdentifiers(dataObjects, 'data_ref', '/data_objects');
    registerIdentifiers(forms, 'form_ref', '/forms');
    registerIdentifiers(data.terms, 'term_ref', '/terms');
    dataObjects.forEach((dataObject, dataIndex) => {
      if (data?.schema_version === 'process-governance-v7') {
        registerIdentifiers(dataObject.fields, 'field_ref', `/data_objects/${dataIndex}/fields`);
      }
      registerIdentifiers(dataObject.behavior_links, 'link_ref', `/data_objects/${dataIndex}/behavior_links`);
      registerIdentifiers(dataObject.source_relations, 'source_ref', `/data_objects/${dataIndex}/source_relations`);
      if (data?.schema_version === 'process-governance-v7') {
        registerIdentifiers(dataObject?.lifecycle?.routes, 'route_ref', `/data_objects/${dataIndex}/lifecycle/routes`);
        (dataObject?.lifecycle?.routes || []).forEach((route, routeIndex) => {
          registerIdentifiers(route?.events, 'event_ref', `/data_objects/${dataIndex}/lifecycle/routes/${routeIndex}/events`);
        });
      }
      const operationsByBehavior = new Map();
      (dataObject.behavior_links || []).forEach(link => {
        if (!operationsByBehavior.has(link.behavior_ref)) operationsByBehavior.set(link.behavior_ref, new Set());
        operationsByBehavior.get(link.behavior_ref).add(link.operation);
      });
      operationsByBehavior.forEach((operations, behaviorRef) => {
        if (operations.has('pending_confirmation') && operations.size > 1) {
          addError(`/data_objects/${dataIndex}/behavior_links`, `数据对象与行为 ${behaviorRef} 的待确认操作不能与已确认操作并存`, { ref: behaviorRef });
        }
      });
    });
    forms.forEach((form, formIndex) => {
      registerIdentifiers(form.behavior_links, 'link_ref', `/forms/${formIndex}/behavior_links`);
      (form.areas || []).forEach((area, areaIndex) => {
        registerIdentifiers([area], 'area_ref', `/forms/${formIndex}/areas/${areaIndex}`);
        registerIdentifiers(area.items, 'item_ref', `/forms/${formIndex}/areas/${areaIndex}/items`);
        (area.items || []).forEach((item, itemIndex) => {
          registerIdentifiers(item.source_links, 'source_link_ref', `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/source_links`);
        });
      });
    });
    registerIdentifiers(migration.reference_materials, 'material_ref', '/migration/reference_materials');
    registerIdentifiers(migration.internal_process_calls, 'call_ref', '/migration/internal_process_calls');
    registerIdentifiers(migration.work_roles, 'archive_ref', '/migration/work_roles');
    registerIdentifiers(migration.unresolved_actor_roles, 'record_ref', '/migration/unresolved_actor_roles');
    registerIdentifiers(migration.unresolved_join_modes, 'record_ref', '/migration/unresolved_join_modes');
    registerIdentifiers(migration.legacy_cross_department_records, 'record_ref', '/migration/legacy_cross_department_records');
    if (data?.schema_version === 'process-governance-v7') {
      dataObjects.forEach((dataObject, dataIndex) => {
        (dataObject?.lifecycle?.routes || []).forEach((route, routeIndex) => {
          (route?.flow_relation_refs || []).forEach((relationRef, relationIndex) => {
            requireLocalRef(relationRefs, relationRef, `/data_objects/${dataIndex}/lifecycle/routes/${routeIndex}/flow_relation_refs/${relationIndex}`, '生命周期路径对应流程关系');
          });
          (route?.events || []).forEach((event, eventIndex) => {
            requireLocalRef(behaviorRefs, event?.trigger?.behavior_ref, `/data_objects/${dataIndex}/lifecycle/routes/${routeIndex}/events/${eventIndex}/trigger/behavior_ref`, '生命周期事件触发行为');
          });
        });
      });
    }
    const exactRelations = new Map();
    flowRelations.forEach((relation, index) => {
      if (relation?.from_behavior_ref && relation.from_behavior_ref === relation.to_behavior_ref) {
        addError(`/flow_relations/${index}/to_behavior_ref`, '流程关系的起点和终点不能相同', { ref: relation.relation_ref });
      }
      const duplicateKey = ['condition', 'loop'].includes(relation?.relation_type)
        ? [relation.relation_type, relation.from_behavior_ref, relation.to_behavior_ref, relation.condition].join('|')
        : [relation.relation_type, relation.from_behavior_ref, relation.to_behavior_ref].join('|');
      if (exactRelations.has(duplicateKey)) {
        addError(`/flow_relations/${index}`, `流程关系与${exactRelations.get(duplicateKey)}完全重复`, { ref: relation.relation_ref });
      } else {
        exactRelations.set(duplicateKey, relation.relation_ref);
      }
    });
    uniqueRefs(migration?.work_roles, 'archive_ref', '/migration/work_roles');
    uniqueRefs(migration?.unresolved_actor_roles, 'record_ref', '/migration/unresolved_actor_roles');
    uniqueRefs(migration?.unresolved_join_modes, 'record_ref', '/migration/unresolved_join_modes');
    uniqueRefs(migration?.legacy_cross_department_records, 'record_ref', '/migration/legacy_cross_department_records');
    (migration?.work_roles || []).forEach((archive, index) => {
      requireLocalRef(behaviorRefs, archive?.behavior_ref, `/migration/work_roles/${index}/behavior_ref`, '历史工作角色对应行为');
      requireLocalRef(behaviorRefs, archive?.work_role?.behavior_ref, `/migration/work_roles/${index}/work_role/behavior_ref`, '历史工作角色绑定行为');
      if (archive?.work_role?.behavior_ref && archive.work_role.behavior_ref !== archive.behavior_ref) {
        addError(`/migration/work_roles/${index}/work_role/behavior_ref`, '历史工作角色的行为引用必须一致');
      }
    });
    (migration?.unresolved_actor_roles || []).forEach((archive, index) => {
      requireLocalRef(behaviorRefs, archive?.behavior_ref, `/migration/unresolved_actor_roles/${index}/behavior_ref`, '待确认执行主体对应行为');
    });
    (migration?.unresolved_join_modes || []).forEach((archive, index) => {
      requireLocalRef(relationRefs, archive?.relation_ref, `/migration/unresolved_join_modes/${index}/relation_ref`, '待确认汇合方式对应关系');
    });
    (migration?.legacy_cross_department_records || []).forEach((archive, index) => {
      const handoff = archive?.source_handoff || {};
      requireLocalRef(behaviorRefs, handoff.anchor_behavior_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/anchor_behavior_ref`, '旧跨部门记录锚点行为');
      requireLocalRef(behaviorRefs, handoff.resume_behavior_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/resume_behavior_ref`, '旧跨部门记录恢复行为');
      requireLocalRef(dataRefs, handoff.transfer_data_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/transfer_data_ref`, '旧跨部门记录传递数据');
      requireLocalRef(dataRefs, handoff.returned_data_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/returned_data_ref`, '旧跨部门记录返回数据');
      requireLocalRef(behaviorRefs, archive?.created_behavior_ref, `/migration/legacy_cross_department_records/${index}/created_behavior_ref`, '旧跨部门记录创建行为');
      (archive?.created_relation_refs || []).forEach((ref, refIndex) => {
        requireLocalRef(relationRefs, ref, `/migration/legacy_cross_department_records/${index}/created_relation_refs/${refIndex}`, '旧跨部门记录创建关系');
      });
      (archive?.created_data_link_refs || []).forEach((ref, refIndex) => {
        requireLocalRef(dataLinkRefs, ref, `/migration/legacy_cross_department_records/${index}/created_data_link_refs/${refIndex}`, '旧跨部门记录创建数据关系');
      });
    });
  }

  const errorsById = new Map();
  errors.forEach(error => {
    const qualifier = error.params?.ref
      || error.params?.missingProperty
      || error.params?.expected
      || (error.params?.allowedValues ? JSON.stringify(error.params.allowedValues) : '');
    const errorId = `${error.keyword || 'validation'}:${error.path || '/'}:${qualifier}`;
    if (!errorsById.has(errorId)) errorsById.set(errorId, { ...error, error_id: errorId });
  });
  const deduplicatedErrors = [...errorsById.values()];
  return { valid: deduplicatedErrors.length === 0, errors: deduplicatedErrors };
}

function docxArchiveError(message) {
  return Object.assign(new Error(message), {
    publicCode: 'DOCX_ARCHIVE_UNSAFE',
    publicMessage: 'DOCX文件包含不安全或超出处理范围的压缩内容。请重新导出文件后重试。',
    statusCode: 422
  });
}

function inspectDocxArchive(buffer) {
  const minimumEocdSize = 22;
  if (!Buffer.isBuffer(buffer) || buffer.length < minimumEocdSize) throw new Error('DOCX文件不是有效的ZIP容器');
  const searchStart = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;
  for (let offset = buffer.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('DOCX文件缺少ZIP目录');
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const directoryDiskNumber = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntryCount = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const directorySize = buffer.readUInt32LE(eocdOffset + 12);
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    diskEntryCount === 0xFFFF
    || entryCount === 0xFFFF
    || directorySize === 0xFFFFFFFF
    || directoryOffset === 0xFFFFFFFF
  ) {
    throw docxArchiveError('不支持ZIP64格式的DOCX文件');
  }
  if (diskNumber !== 0 || directoryDiskNumber !== 0 || diskEntryCount !== entryCount) {
    throw docxArchiveError('不支持跨磁盘DOCX压缩包');
  }
  if (entryCount > MAX_DOCX_ENTRIES) throw docxArchiveError('DOCX文件包含的条目过多');
  if (directoryOffset + directorySize !== eocdOffset || directoryOffset < 0) throw docxArchiveError('DOCX目录位置无效');
  let offset = directoryOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw docxArchiveError('DOCX中央目录不完整');
    }
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const centralFlags = buffer.readUInt16LE(offset + 8);
    const centralMethod = buffer.readUInt16LE(offset + 10);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    if (localHeaderOffset === 0xFFFFFFFF) throw docxArchiveError('不支持ZIP64格式的DOCX文件');
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > eocdOffset) throw docxArchiveError('DOCX条目名称或扩展信息越界');
    const centralNameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    let entryName = '';
    try {
      entryName = new TextDecoder('utf-8', { fatal: true }).decode(centralNameBytes);
    } catch (_error) {
      throw docxArchiveError('DOCX条目名称不是有效的UTF-8文本');
    }
    const normalizedName = entryName.replace(/\\/g, '/');
    const pathParts = normalizedName.split('/').filter(Boolean);
    if (/^(?:\/|[A-Za-z]:)/.test(normalizedName) || pathParts.includes('..')) {
      throw docxArchiveError('DOCX条目包含路径越界');
    }
    if (pathParts.length > MAX_DOCX_PATH_DEPTH) throw docxArchiveError('DOCX条目路径层级过深');
    if (uncompressedBytes > MAX_DOCX_ENTRY_BYTES) throw docxArchiveError('DOCX单个解压条目过大');
    if (uncompressedBytes > 0 && (compressedBytes === 0 || uncompressedBytes > compressedBytes * 100)) {
      throw docxArchiveError('DOCX条目压缩比异常');
    }
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) throw docxArchiveError('DOCX解压后总量过大');

    if (localHeaderOffset + 30 > directoryOffset || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw docxArchiveError('DOCX本地文件头无效');
    }
    const localFlags = buffer.readUInt16LE(localHeaderOffset + 6);
    const localMethod = buffer.readUInt16LE(localHeaderOffset + 8);
    const localCompressedBytes = buffer.readUInt32LE(localHeaderOffset + 18);
    const localUncompressedBytes = buffer.readUInt32LE(localHeaderOffset + 22);
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const localNameStart = localHeaderOffset + 30;
    const localDataStart = localNameStart + localNameLength + localExtraLength;
    if (localDataStart > directoryOffset) throw docxArchiveError('DOCX本地文件头越界');
    const localNameBytes = buffer.subarray(localNameStart, localNameStart + localNameLength);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(localNameBytes);
    } catch (_error) {
      throw docxArchiveError('DOCX本地条目名称不是有效的UTF-8文本');
    }
    if (!centralNameBytes.equals(localNameBytes)) throw docxArchiveError('DOCX中央目录与本地条目名称不一致');
    if (centralFlags !== localFlags || centralMethod !== localMethod) {
      throw docxArchiveError('DOCX中央目录与本地文件头参数不一致');
    }
    const usesDataDescriptor = (centralFlags & 0x0008) !== 0;
    if (!usesDataDescriptor && (
      compressedBytes !== localCompressedBytes
      || uncompressedBytes !== localUncompressedBytes
    )) {
      throw docxArchiveError('DOCX中央目录与本地文件头大小不一致');
    }
    if (usesDataDescriptor && (
      (localCompressedBytes !== 0 && localCompressedBytes !== compressedBytes)
      || (localUncompressedBytes !== 0 && localUncompressedBytes !== uncompressedBytes)
    )) {
      throw docxArchiveError('DOCX数据描述符对应的本地文件头大小不一致');
    }
    if (localDataStart + compressedBytes > directoryOffset) throw docxArchiveError('DOCX压缩数据越过中央目录边界');
    offset = entryEnd;
  }
  if (offset !== eocdOffset) throw docxArchiveError('DOCX中央目录长度与条目不一致');
}

function parseDocxInWorker(buffer) {
  return docxParserPool.parse(buffer);
}

function containsUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) return true;
  }
  return false;
}

function jsonSafetyProblem(root) {
  const stack = [{ value: root, depth: 0, path: '/' }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      return { code: 'JSON_NODE_LIMIT_EXCEEDED', error: '结构化内容包含的对象和字段过多。请拆分或精简内容后重试。', path: current.path };
    }
    if (current.depth > MAX_JSON_DEPTH) {
      return { code: 'JSON_DEPTH_EXCEEDED', error: '结构化内容嵌套层级过深。请修正文件结构后重试。', path: current.path };
    }
    if (typeof current.value === 'string') {
      if (Buffer.byteLength(current.value, 'utf8') > MAX_JSON_STRING_LENGTH) {
        return { code: 'JSON_TEXT_TOO_LONG', error: '结构化内容中的单段文字超过1MB。请拆分或精简该段文字后重试。', path: current.path };
      }
      if (containsUnpairedSurrogate(current.value)) {
        return { code: 'INVALID_UNICODE', error: '结构化内容包含无效字符。请从原系统重新导出UTF-8 JSON后重试。', path: current.path };
      }
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    if (Array.isArray(current.value)) {
      current.value.forEach((value, index) => stack.push({ value, depth: current.depth + 1, path: `${current.path}${index}/` }));
      continue;
    }
    Object.entries(current.value).forEach(([key, value]) => {
      stack.push({ value: key, depth: current.depth + 1, path: `${current.path}${key}/` });
      stack.push({ value, depth: current.depth + 1, path: `${current.path}${key}/` });
    });
  }
  return null;
}

function loadProcessMappingCatalog() {
  if (processMappingCatalogCache) return processMappingCatalogCache;
  const catalog = [];
  if (!fs.existsSync(MAPPING_FILES_DIR)) {
    processMappingCatalogCache = catalog;
    return catalog;
  }
  const files = fs.readdirSync(MAPPING_FILES_DIR)
    .filter(name => name.endsWith('映射关系.md'))
    .map(name => path.join(MAPPING_FILES_DIR, name));

  for (const filePath of files) {
    const sourceName = path.relative(path.join(__dirname, '..', '..'), filePath).replace(/\\/g, '/');
    const lines = fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n').split('\n');
    let header = null;
    for (let i = 0; i < lines.length; i += 1) {
      const row = parseMarkdownRow(lines[i]);
      if (!row) continue;
      if (row.some(cell => cell.includes('部门')) && row.some(cell => cell.includes('业务流程'))) {
        header = row;
        continue;
      }
      if (!header) continue;
      const indexOf = keyword => header.findIndex(cell => cell.includes(keyword));
      const deptIndex = indexOf('部门');
      const l1Index = indexOf('能力域');
      const l2Index = indexOf('业务能力');
      const l3Index = indexOf('业务流程');
      const evidenceIndex = indexOf('制度依据');
      const systemIndex = indexOf('应用系统');
      if ([deptIndex, l1Index, l2Index, l3Index, evidenceIndex].some(index => index < 0)) continue;
      const department = row[deptIndex];
      const l1 = row[l1Index];
      const l2 = row[l2Index];
      const l3 = row[l3Index];
      const evidence = row[evidenceIndex];
      if (!department || !l1 || !l2 || !l3 || !evidence || department.includes('部门（D1）')) continue;
      catalog.push({
        department,
        l1,
        l2,
        l3,
        evidence,
        system: systemIndex >= 0 ? row[systemIndex] : '',
        sourceName,
        sourceAnchor: `第 ${i + 1} 行`,
        sourceText: lines[i].trim()
      });
    }
  }
  processMappingCatalogCache = catalog;
  return catalog;
}

function normalizeForMatch(value) {
  return normalizeLine(value)
    .replace(/[《》「」"'“”‘’（）()\s\-—–_]/g, '')
    .replace(/管理程序|管理规定|管理制度|程序文件/g, '')
    .toLowerCase();
}

function buildSourceHints(...values) {
  const hints = [];
  for (const value of values) {
    if (!value) continue;
    const raw = String(value);
    hints.push(raw);
    raw.split(/[\\/]+/).forEach(part => {
      if (!part) return;
      hints.push(part);
      hints.push(part.replace(/\.[^.]+$/, ''));
    });
  }
  return [...new Set(hints.map(item => normalizeLine(item)).filter(Boolean))];
}

function parseEvidenceDocumentInfo(evidence) {
  const text = normalizeLine(evidence);
  const titleMatch = text.match(/《([^》]+)》/);
  const title = titleMatch ? normalizeLine(titleMatch[1]) : '';
  const beforeTitle = titleMatch ? text.slice(0, titleMatch.index) : text;
  const codeMatch = beforeTitle.match(/[A-Z]{2,}(?:\/[A-Z]{2,})?(?:-[A-Z0-9]+)+(?:\/[A-Z])?/);
  if (!codeMatch) return { documentNo: '', plannedEdition: '', documentTitle: title };

  let code = codeMatch[0];
  let plannedEdition = '';
  const slashEdition = code.match(/\/([A-Z])$/);
  if (slashEdition) {
    plannedEdition = slashEdition[1];
    code = code.slice(0, -2);
  } else {
    const parts = code.split('-');
    const last = parts[parts.length - 1];
    if (/^[A-Z]$/.test(last) && parts.length > 2) {
      plannedEdition = last;
      code = parts.slice(0, -1).join('-');
    }
  }

  return {
    documentNo: code.replace(/\//g, ''),
    plannedEdition,
    documentTitle: title
  };
}

function documentCodeTail(documentNo) {
  const parts = String(documentNo || '').replace(/\//g, '-').split('-').filter(Boolean);
  if (parts.length < 2) return '';
  return parts.slice(-2).join('-');
}

function countOccurrences(haystack, needle) {
  const source = String(haystack || '').toLowerCase();
  const target = String(needle || '').toLowerCase();
  if (!target) return 0;
  let count = 0;
  let index = source.indexOf(target);
  while (index >= 0) {
    count += 1;
    index = source.indexOf(target, index + target.length);
  }
  return count;
}

function scoreMappingEntry(entry, data, text, context = {}) {
  const d = data.draft;
  const title = d.document_title || '';
  const documentNo = d.document_no || '';
  const edition = d.planned_edition || '';
  const fullNo = documentNo && edition ? `${documentNo}-${edition}` : documentNo;
  const evidenceInfo = parseEvidenceDocumentInfo(entry.evidence);
  const sourceHints = context.sourceHints || [];
  const normalizedHints = sourceHints.map(normalizeForMatch).filter(Boolean);
  let score = 0;
  if (fullNo && entry.evidence.includes(fullNo)) score += 100;
  if (documentNo && entry.evidence.includes(documentNo)) score += 60;
  if (title && entry.evidence.includes(`《${title}》`)) score += 50;
  if (evidenceInfo.documentNo && normalizedHints.some(hint => hint.includes(normalizeForMatch(evidenceInfo.documentNo)))) score += 100;
  if (evidenceInfo.documentTitle && normalizedHints.some(hint => hint.includes(normalizeForMatch(evidenceInfo.documentTitle)))) score += 50;
  const codeTail = documentCodeTail(evidenceInfo.documentNo);
  const codeTailHits = countOccurrences(text, codeTail);
  if (codeTailHits > 0) score += Math.min(70, 20 + codeTailHits * 10);
  if (title && normalizeForMatch(entry.l2) && normalizeForMatch(title).includes(normalizeForMatch(entry.l2))) score += 25;
  if (title && normalizeForMatch(entry.l2) && normalizeForMatch(entry.l2).includes(normalizeForMatch(title))) score += 25;
  if (d.department.department_name && entry.department === d.department.department_name) score += 15;
  if (entry.evidence && text.includes(entry.evidence.split('；')[0])) score += 5;
  return score;
}

function applyProcessMapping(data, text, context) {
  const catalog = loadProcessMappingCatalog();
  let best = null;
  let bestScore = 0;
  for (const entry of catalog) {
    const score = scoreMappingEntry(entry, data, text, context);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  if (!best || bestScore < 50) return null;
  const d = data.draft;
  const evidenceInfo = parseEvidenceDocumentInfo(best.evidence);
  if (!d.document_no && evidenceInfo.documentNo) d.document_no = evidenceInfo.documentNo;
  if (!d.planned_edition && evidenceInfo.plannedEdition) d.planned_edition = evidenceInfo.plannedEdition;
  if (!d.document_title && evidenceInfo.documentTitle) d.document_title = evidenceInfo.documentTitle;
  if (data.document_profile) {
    if (!data.document_profile.document_no && d.document_no) data.document_profile.document_no = d.document_no;
    if (!data.document_profile.document_title && d.document_title) data.document_profile.document_title = d.document_title;
  }
  d.department = normalizeDepartment(best.department || d.department.department_name);
  d.l1_name = best.l1;
  d.l1_status = 'confirmed';
  d.l2_name = best.l2;
  d.l2_status = 'confirmed';
  d.l3_name = best.l3;
  d.process_name = best.l3;
  const sourcePaths = [
    'draft.document_no',
    'draft.document_title',
    'draft.planned_edition',
    'document_profile.document_no',
    'document_profile.document_title',
    'draft.department.department_name',
    'draft.l1_name',
    'draft.l2_name',
    'draft.l3_name',
    'draft.process_name'
  ];
  sourcePaths.forEach(pathKey => {
    if (getValue(data, pathKey)) {
      addExternalSource(context.fieldSources, context.fieldOrigins, pathKey, best.sourceText, best.sourceName, best.sourceAnchor, 'external_reference');
    }
  });
  return best;
}

function inferActorRole(clause) {
  const normalized = normalizeLine(clause).replace(/^经(?=[^，。；;]{1,30}(?:审核|审批|批准|确认)后)/, '');
  if (WORKFLOW_VERBS.some(verb => normalized.startsWith(verb))) return null;
  const passive = normalized.match(/^由([一-鿿A-Za-z0-9（）()、]{2,30}?)(?:会同[^，,。；;]+)?(?:在[^，,。；;]+)?(?:规范|及时|定期|集中|正式)?(?:提交|反馈|编制|编写|填写|登记|归档|备案|发起|接收|更新|维护|组织|通知|汇总|复核|保存|启动|报送|跟踪|监控|协调|制定|制订|验证|分析|调查|采取|隔离|传递|关联|落实|审查|签字|提请|指定|提供|验收|评估|评选|修订|推广)/);
  if (passive) {
    const actor = passive[1].replace(/[，,。；;：:]+$/, '').trim();
    if (!/^(部门|各部门|公司|全体员工|员工)$/.test(actor) && /(部|部门|人|员|组|者|负责人|经理|主管|领导|内勤|专员|中心|车间|班组)$/.test(actor)) return actor;
  }
  const passiveObject = normalized.match(/^.+?由([一-鿿A-Za-z0-9（）()、]{2,30}?)(?:在[^，,。；;]+)?(?:提交|反馈|编制|编写|填写|登记|归档|备案|发起|接收|更新|维护|组织|通知|汇总|复核|保存|启动|报送|跟踪|监控|协调|制定|制订|验证|分析|调查|采取|隔离|传递|关联|落实|审查|签字|提请|指定|提供|验收|评估|评选|修订|推广)/);
  if (passiveObject) {
    const actor = passiveObject[1].replace(/[，,。；;：:]+$/, '').trim();
    if (!/^(部门|各部门|公司|全体员工|员工)$/.test(actor) && /(部|部门|人|员|组|者|负责人|经理|主管|领导|内勤|专员|中心|车间|班组)$/.test(actor)) return actor;
  }
  const objectReview = normalized.match(/^([一-鿿A-Za-z0-9（）()、]{2,20}?(?:小组|委员会|部门))对.+?[，,](?:评选|评估|审核|审议|确认|形成|出具)/);
  if (objectReview) return objectReview[1].trim();
  const explicit = normalized.match(/^([一-鿿A-Za-z0-9（）()、]{2,20}?)(?:需|应|须|应当)?(?:按[^，,。；;]{1,16})?(?:向[^，,。；;]{1,24})?(?:规范|及时|定期|集中|正式)?(?:提交|审核|审批|批准|确认|编制|编写|填写|登记|归档|备案|发起|接收|更新|维护|校验|检查|完成|组织|通知|汇总|复核|判定|保存|启动|报送|跟踪|监控|协调|制定|制订|验证|分析|调查|采取|隔离|传递|关联|落实|审查|签字|提请|指定|提供|验收|评估|评选|修订|推广)/);
  if (explicit) {
    const actor = explicit[1].replace(/[，,。；;：:]+$/, '').trim();
    if (!/^(部门|各部门|公司|全体员工|员工)$/.test(actor) && /(部|部门|人|员|组|者|负责人|经理|主管|领导|内勤|专员|中心|车间|班组)$/.test(actor)) return actor;
  }
  const department = ENUMS.departments.find(item => normalized.startsWith(item.department_name));
  if (department && firstVerbIndex(normalized) >= department.department_name.length) return department.department_name;
  const match = normalized.match(/^([一-鿿A-Za-z0-9（）()、]{2,30}?)(?:负责(?!人)|提交|审核|审批|批准|确认|编制|编写|填写|登记|归档|备案|发起|接收|更新|维护|校验|检查|完成|组织|通知|汇总|复核|判定|保存|制定|制订|验证|分析|调查|采取|隔离|传递|关联|落实|审查|签字|提请|指定|提供)/);
  if (!match) return null;
  const actor = match[1].replace(/[，,。；;：:]+$/, '').trim();
  return /(部|部门|人|员|组|者|负责人|经理|主管|领导|内勤|专员|中心|车间|班组)$/.test(actor) ? actor : null;
}

function firstVerbIndex(text) {
  let best = -1;
  for (const verb of WORKFLOW_VERBS) {
    const idx = String(text || '').indexOf(verb);
    if (idx >= 0 && (best < 0 || idx < best)) best = idx;
  }
  return best;
}

function cleanClause(raw) {
  return normalizeLine(raw)
    .replace(/^经(?=[^，。；;]{1,30}(?:审核|审批|批准|确认)后)/, '')
    .replace(/后$/, '')
    .replace(/完成$/, '')
    .replace(/[。；;，,]+$/, '')
    .trim();
}

function quotedFormName(value) {
  const match = String(value || '').match(/《([^》]{2,60}?(?:单|表|申请表|申报表|记录|报告|台账))》/);
  return match ? match[1].trim() : null;
}

function cleanWorkflowStepText(segment) {
  const text = cleanClause(segment);
  const formName = quotedFormName(text);
  if (formName && /填写/.test(text) && (/(?:^|[，,；;])\s*\d+\s*个工作日内/.test(text) || /附表\s*\d+/.test(text))) {
    return `填写《${formName}》`;
  }
  return text;
}

function isNonExecutableSegment(segment) {
  const text = normalizeLine(segment).replace(/^[-•]\s*/, '');
  if (!text) return true;
  if (/^(?:[^，,。；;]{1,12})?(?:包括|包含|含).{2,160}[、，,]/.test(text)) return true;
  if (isLikelyWorkflowSubheading(text)) return true;
  if (/^(?:若|如|如果).{2,120}(?:情况|情形|时|后)?$/.test(text) && extractTriggerScene(text)) return true;
  if (/^经(?!营|办).{1,80}(?:审核|审批|批准|确认|通过).{0,24}(?:的|后)?$/.test(text) && !/(?:提交|形成|出具|保存|反馈|报送|归档)/.test(text)) return true;
  if (/^(?:[^，,。；;]{0,20})?在收到.{1,40}(?:通知|指令|反馈|申请)$/.test(text)) return true;
  if (/^(?:[^，,。；;]{0,20})?在接收.{1,40}$/.test(text)) return true;
  if (/仅围绕|等核心事项|高效传递|流程高效衔接/.test(text)) return true;
  if (/^(?:确保|保障).{2,60}$/.test(text)) return true;
  if (/公司鼓励|鼓励全体员工|倡导|鼓励常态化|态度/.test(text)) return true;
  if (/^(?:公司|全体员工|员工)(?:应|需|可|鼓励|主动|常态化)/.test(text)) return true;
  if (/^各部门应按季度主动组织提案工作/.test(text)) return true;
  if (/^由部门集中提交/.test(text)) return true;
  if (/^(?:当|在).{2,80}(?:后|时)?$/.test(text) && extractTriggerScene(text)) return true;
  if (/^经.{2,60}(?:审核|审批|批准|确认)(?:后)?$/.test(text)) return true;
  if (/^经.{0,60}(?:审核|审批|批准|确认)通过的.{1,40}$/.test(text)) return true;
  if (/^若发现.{2,100}(?:情况|情形|问题)$/.test(text)) return true;
  if (/^随附.{2,80}(?:资料|材料|证明文件|证据|文件)$/.test(text)) return true;
  if (/^在\d+\s*个?\s*(?:工作日|日历日|小时|个月|年)内(?:反馈|报送|提交|完成).{1,40}$/.test(text)) return true;
  if (/^(?:当|对|对于).{2,80}时$/.test(text)) return true;
  if (/^(?:对于|关于|对).{2,60}(?:故障|问题|事项|情况|情形)$/.test(text)) return true;
  if (/^(?:各部门|部门)(?:应|需|可|主动|按季度|定期).{0,24}(?:工作|活动|建议)$/.test(text)) return true;
  if (/^[一-鿿A-Za-z0-9（）()、]{2,30}?对.+的(?:项目|事项|对象)$/.test(text)) return true;
  return false;
}

function isWorkflowSubheading(normalized, stripped, hasNumbering) {
  if (!stripped || /[。；;，,]/.test(stripped) || quotedFormName(stripped)) return false;
  const startsWithAction = /^(?:通知|确认|反馈|提交|填写|审核|审批|归档|保存|登记|更新|维护|校验|检查|复核|发起|接收|汇总|编制|编写|形成|输出|组织|召开|启动|报送|跟踪|制定|制订|验证|分析|调查|采取|隔离|传递|落实|审查|签字|提供|验收|评估|评选|修订|推广|出具)/.test(stripped);
  if (stripped.length > 12) return false;
  if (stripped === '表单填写') return true;
  if (stripped.includes('与')) return true;
  if (/管理$/.test(stripped)) return true;
  if (/(?:通知|确认|反馈|要求|说明|流程)$/.test(stripped) && !startsWithAction) return true;
  return false;
}

function isLikelyWorkflowSubheading(segment) {
  const text = stripNumbering(segment).replace(/^[-•]\s*/, '');
  if (!text || text.length > 18) return false;
  if (/[，,。；;：:]/.test(text) || quotedFormName(text)) return false;
  if (/^(?:申请人|相关人员|航达人员|理化检测团队|理化检测负责人|责任单位|业务主管|双方)/.test(text)) return false;
  if (WORKFLOW_VERBS.some(verb => text.startsWith(verb))) return false;
  const verbHits = WORKFLOW_VERBS.filter(verb => text.includes(verb)).length;
  if (verbHits >= 2) return false;
  if (/(?:流程|管理|要求|说明)$/.test(text)) return true;
  return /(?:通知|反馈|审批|填写|确认)$/.test(text) && verbHits === 1;
}

function splitWorkflowSentence(line) {
  const raw = normalizeLine(line)
    .replace(/^[-•]\s*/, '')
    .replace(/^[（(]?\d+[)）]?\s*[.、．)）]\s*/, '');
  if (!raw) return [];

  const steps = [];
  const sentences = raw.split(/。/).map(normalizeLine).filter(Boolean);
  for (const rawSentence of sentences) {
    const sentence = cleanClause(rawSentence);
    if (!sentence) continue;
    const firstActor = /^经[^，,。；;]{1,60}(?:审核|审批|批准|确认)后/.test(rawSentence) ? null : inferActorRole(sentence);
    const segments = sentence
      .split(/，|；|;/)
      .flatMap(part => part.split(/并|且/))
      .map(cleanClause)
      .filter(Boolean);

    for (const segment of segments) {
      if (isNonExecutableSegment(segment)) continue;
      const actor = inferActorRole(segment);
      const verbAt = firstVerbIndex(segment);
      if (verbAt < 0) continue;
      const cleanedText = cleanWorkflowStepText(segment);
      if (!cleanedText) continue;
      if (actor) {
        steps.push({ text: cleanedText, actor, sourceText: rawSentence });
        continue;
      }
      if (firstActor && verbAt === 0) {
        steps.push({ text: cleanWorkflowStepText(`${firstActor}${segment}`), actor: firstActor, sourceText: rawSentence });
        continue;
      }
      steps.push({ text: cleanedText, actor: null, sourceText: rawSentence });
    }
  }
  return steps;
}

function extractInputMaterials(text) {
  const source = String(text || '');
  if (!FIELD_LEXICON.inputVerbs.some(verb => source.includes(verb))) return null;
  const values = collectFieldObjects(source, FIELD_LEXICON.materialNouns);
  return joinFieldValues(values);
}

function extractOutputResult(text) {
  const source = String(text || '');
  if (!FIELD_LEXICON.outputVerbs.some(verb => source.includes(verb))) return null;
  const values = [];
  for (const clause of fieldClauses(source)) {
    if (!FIELD_LEXICON.outputVerbs.some(verb => clause.includes(verb))) continue;
    values.push(...collectFieldObjects(clause, FIELD_LEXICON.outputNouns));
  }
  return joinFieldValues(values);
}

function fieldClauses(text) {
  return String(text || '')
    .split(/[，,。；;]/)
    .map(cleanClause)
    .filter(Boolean);
}

function joinFieldValues(values) {
  const unique = [];
  for (const value of values.map(normalizeLine).filter(Boolean)) {
    if (value.length > 80) continue;
    if (!unique.includes(value)) unique.push(value);
  }
  return unique.length ? unique.join('；') : null;
}

function collectFieldObjects(text, nounSuffixes) {
  const source = String(text || '');
  const values = [];
  for (const match of source.matchAll(/《([^》]{2,80})》/g)) {
    values.push(`《${match[1].trim()}》`);
  }
  const nounAlternation = nounSuffixes.map(escapeRegExp).join('|');
  const objectPattern = new RegExp(`([\\u4e00-\\u9fa5A-Za-z0-9（）()、-]{2,40}(?:${nounAlternation}))`, 'g');
  for (const match of source.matchAll(objectPattern)) {
    const value = normalizeLine(match[1])
      .replace(/^(?:和|及|与|并|或|其|的)+/, '')
      .replace(/^(?:完整的|相关|有关|客观|书面)+(?=[\u4e00-\u9fa5A-Za-z0-9《])/, match[0].startsWith('客观') ? '客观' : '');
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

function extractTriggerScene(text) {
  const source = String(text || '');
  const verbs = FIELD_LEXICON.triggerVerbs.join('|');
  const pattern = new RegExp(`(?:当|在)?([^，,。；;]{0,40}(?:${verbs})[^，,。；;]{0,60}?)(?:后|时|，|,|。|；|;|$)`);
  const match = source.match(pattern);
  if (!match) return null;
  const value = normalizeLine(match[1]).replace(/^(?:当|在)/, '').replace(/[后时]$/, '');
  if (!FIELD_LEXICON.triggerObjects.some(noun => value.includes(noun))) return null;
  return value || null;
}

function extractPrecondition(text) {
  const source = String(text || '');
  const patterns = [
    /经([^，,。；;]{1,50}?(?:审核|审批|批准|确认)(?:[^，,。；;]{0,20})?)后?/,
    /(获得[^，,。；;]{1,40}?(?:审核|审批|批准|确认))/,
    /((?:完成|满足|具备)[^，,。；;]{1,50}?(?:后|条件|要求|资料|材料))/,
    /(未[^，,。；;]{1,50}?不得[^，,。；;]{0,40})/
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return normalizeLine(match[1]).replace(/[，,。；;]+$/, '') || null;
  }
  return null;
}

function detectApproval(text) {
  return /审核|审批|批准|复核|确认/.test(String(text || ''));
}

function detectCrossDepartment(step, ownDept, relatedDepartments) {
  const text = [step.step_name, step.actor_role].filter(Boolean).join(' ');
  return relatedDepartments.some(dept => dept && text.includes(dept) && dept !== ownDept);
}

function extractExecutionStandard(text) {
  const source = String(text || '');
  const match = source.match(/依据([^。；;，,]+?(?:创新性|战略契合度|预期效益|可行性|风险)[^。；;]*?)等标准/);
  return match ? `${match[1].trim()}等标准` : null;
}

function extractFillInstruction(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(normalizeLine);
  const start = lines.findIndex(line => compactLabel(line) === '填表说明');
  if (start < 0) return null;
  const parts = [];
  for (const line of lines.slice(start, start + 5)) {
    if (!line) continue;
    parts.push(line);
  }
  return parts.join('\n') || null;
}

function extractExecutionStandardInfo(sourceText, step, fullText) {
  const standard = extractExecutionStandard(sourceText);
  if (standard) return { value: standard, sourceText };
  const formName = quotedFormName(step?.step_name || '') || quotedFormName(sourceText || '');
  if (formName && /填写/.test(step?.step_name || sourceText || '')) {
    return {
      value: `按《${formName}》填表说明执行；建议继续完善具体填写标准。`,
      sourceText: extractFillInstruction(fullText) || sourceText || step?.step_name || ''
    };
  }
  const lexiconStandard = extractLexiconExecutionStandard(sourceText);
  if (lexiconStandard) return { value: lexiconStandard, sourceText };
  return { value: null, sourceText: null };
}

function extractLexiconExecutionStandard(text) {
  const values = [];
  for (const clause of fieldClauses(text)) {
    if (/(?:\d+\s*个?\s*(?:工作日|日历日)|\d+\s*(?:小时|个月|年))内/.test(clause)) {
      values.push(clause);
      continue;
    }
    if (/保存[^，,。；;]*(?:材料|记录|报告|表|单|文件|证据|资料)/.test(clause)) {
      values.push(clause);
      continue;
    }
    if (/(?:应|必须|不得|按|依据|符合|规定格式|连续验证)/.test(clause) && clause.length <= 120) {
      values.push(clause);
    }
  }
  return joinFieldValues(values);
}

function isTermHeader(value) {
  const label = compactLabel(value);
  return ['术语', '术语名称', '名词术语'].includes(label);
}

function isDefinitionHeader(value) {
  return compactLabel(value) === '定义';
}

function isSequenceHeader(value) {
  return ['序号', '编号', 'NO', 'No'].includes(compactLabel(value));
}

function shouldSkipTermName(value) {
  const text = normalizeLine(value);
  const label = compactLabel(text);
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  return isTermHeader(text) || isDefinitionHeader(text) || isSequenceHeader(text) || ['术语和定义', '术语与定义'].includes(label);
}

function extractTermsFromTables(context, text) {
  const terms = [];
  for (const table of context.sourceTables || []) {
    if (!table.rows?.length) continue;
    const headerIndex = table.rows.findIndex(row => row.some(cell => isTermHeader(cell.text)) && row.some(cell => isDefinitionHeader(cell.text)));
    if (headerIndex < 0) continue;
    const header = table.rows[headerIndex];
    const termIndex = header.findIndex(cell => isTermHeader(cell.text));
    const definitionIndex = header.findIndex(cell => isDefinitionHeader(cell.text));
    if (termIndex < 0 || definitionIndex < 0 || termIndex === definitionIndex) continue;
    for (const row of table.rows.slice(headerIndex + 1)) {
      const termName = normalizeLine(row[termIndex]?.text);
      const definition = normalizeLine(row[definitionIndex]?.text);
      if (shouldSkipTermName(termName) || !definition) continue;
      if (terms.some(term => term.term_name === termName)) continue;
      const index = terms.length;
      terms.push({
        term_ref: `term_${index + 1}`,
        draft_ref: null,
        term_name: termName,
        definition,
        applies_to: null
      });
      const sourceText = row.map(cell => cell.text).filter(Boolean).join('\n');
      addSource(context.fieldSources, context.fieldOrigins, `terms.${index}.term_name`, text, sourceText, context.sourceName);
      addSource(context.fieldSources, context.fieldOrigins, `terms.${index}.definition`, text, sourceText, context.sourceName);
    }
  }
  return terms;
}

function extractTerms(text, context) {
  const tableTerms = extractTermsFromTables(context, text);
  if (tableTerms.length) return tableTerms;

  const terms = [];
  const block = extractLabeledBlock(text, ['术语和定义', '术语与定义', '术语', '定义']);
  if (!block) return terms;
  const patterns = [
    /[（(](\d+)[)）]\s*(.+?)[：:]\s*(.+?)(?=\r?\n[（(]\d+[)）]|\r?\n\r?\n|$)/g,
    /^(\d+)[.、)）]\s*(.+?)[：:]\s*(.+?)$/gm
  ];
  for (const pattern of patterns) {
    for (const match of block.matchAll(pattern)) {
      const termName = match[2].trim();
      if (terms.some(term => term.term_name === termName)) continue;
      const index = terms.length;
      terms.push({
        term_ref: `term_${index + 1}`,
        draft_ref: null,
        term_name: termName,
        definition: match[3].trim(),
        applies_to: null
      });
      const sourceText = `${termName}：${match[3].trim()}`;
      addSource(context.fieldSources, context.fieldOrigins, `terms.${index}.term_name`, text, sourceText, context.sourceName);
      addSource(context.fieldSources, context.fieldOrigins, `terms.${index}.definition`, text, sourceText, context.sourceName);
    }
  }
  if (terms.length) return terms;

  const lines = block
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean)
    .filter(line => !shouldSkipTermName(line));

  function isTermName(line) {
    if (shouldSkipTermName(line)) return false;
    if (!line || line.length > 30) return false;
    if (/[。；;，,：:？?]/.test(line)) return false;
    if (/^(第?\d+|[一二三四五六七八九十]+)\s*[章节条]/.test(line)) return false;
    return /[\u4e00-\u9fa5A-Za-z]/.test(line);
  }

  for (let i = 0; i < lines.length - 1; i += 1) {
    const termName = lines[i];
    if (!isTermName(termName)) continue;
    const definitionParts = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (j > i + 1 && isTermName(lines[j])) break;
      definitionParts.push(lines[j]);
      if (/[。；;]$/.test(lines[j])) break;
    }
    const definition = definitionParts.join('');
    if (!definition || isTermName(definition)) continue;
    if (terms.some(term => term.term_name === termName)) continue;
    const index = terms.length;
    terms.push({
      term_ref: `term_${index + 1}`,
      draft_ref: null,
      term_name: termName,
      definition,
      applies_to: null
    });
    const sourceText = `${termName}\n${definition}`;
    addSource(context.fieldSources, context.fieldOrigins, `terms.${index}.term_name`, text, sourceText, context.sourceName);
    addSource(context.fieldSources, context.fieldOrigins, `terms.${index}.definition`, text, sourceText, context.sourceName);
  }
  return terms;
}

function cleanExplicitBehaviorValue(value, options = {}) {
  const trailingPattern = options.stripTrailingColon ? /[：:。；;]+$/ : /[。；;]+$/;
  return normalizeLine(value).replace(trailingPattern, '').trim();
}

function parseExplicitBehaviorStart(line) {
  const sourceText = normalizeLine(line);
  const match = sourceText.match(/^(?:业务行为|行为)\s*(?:编号\s*)?(?:[A-Za-z0-9一二三四五六七八九十百._-]+)?\s*[：:]\s*(.*)$/);
  if (!match) return null;
  const stepName = cleanExplicitBehaviorValue(match[1], { stripTrailingColon: true });
  if (!stepName) return null;
  return { stepName, sourceText };
}

function parseExplicitBehaviorField(line) {
  const sourceText = normalizeLine(line);
  for (const field of EXPLICIT_BEHAVIOR_FIELDS) {
    for (const label of field.labels) {
      const match = sourceText.match(new RegExp(`^${escapeRegExp(label)}\\s*[：:]\\s*(.*)$`));
      if (!match) continue;
      return {
        key: field.key,
        value: cleanExplicitBehaviorValue(match[1]),
        sourceText
      };
    }
  }
  return null;
}

function normalizeExplicitActorRole(value) {
  return String(value || '')
    .split(/[\/／]/)
    .map(part => normalizeLine(part)
      .replace(/\s*[—–－-]+\s*/g, '')
      .replace(/\s+/g, ''))
    .filter(Boolean)
    .join(' / ');
}

function parseExplicitWorkflowStage(line) {
  const sourceText = normalizeLine(line);
  const match = sourceText.match(/^阶段\s*([一二三四五六七八九十百0-9]+)\s*[：:]\s*(.+)$/);
  if (!match) return null;
  const stageName = cleanExplicitBehaviorValue(match[2], { stripTrailingColon: true });
  if (!stageName) return null;
  return {
    label: `阶段${match[1]}`,
    stageName,
    sourceText
  };
}

function extractExplicitBehaviorBlocks(text, lineOffset = 0) {
  const blocks = [];
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let current = null;
  let currentStage = null;

  const finishCurrent = () => {
    if (current?.stepName && current.seenFields.size > 0) {
      blocks.push({
        stepName: current.stepName,
        values: current.values,
        sources: current.sources,
        sourceAnchors: current.sourceAnchors,
        stage: current.stage
      });
    }
    current = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const normalized = normalizeLine(line);
    if (!normalized) continue;

    const stage = parseExplicitWorkflowStage(normalized);
    if (stage) {
      finishCurrent();
      currentStage = {
        ...stage,
        sourceAnchor: `第 ${lineOffset + lineIndex + 1} 行`
      };
      continue;
    }

    const behavior = parseExplicitBehaviorStart(normalized);
    if (behavior) {
      finishCurrent();
      current = {
        stepName: behavior.stepName,
        values: {},
        sources: { step_name: behavior.sourceText },
        sourceAnchors: { step_name: `第 ${lineOffset + lineIndex + 1} 行` },
        stage: currentStage,
        seenFields: new Set()
      };
      continue;
    }

    if (!current) continue;
    const field = parseExplicitBehaviorField(normalized);
    if (field) {
      current.seenFields.add(field.key);
      if (!Object.prototype.hasOwnProperty.call(current.values, field.key) || field.value) {
        current.values[field.key] = field.key === 'actor_role'
          ? normalizeExplicitActorRole(field.value)
          : field.value || null;
        current.sources[field.key] = field.sourceText;
        current.sourceAnchors[field.key] = `第 ${lineOffset + lineIndex + 1} 行`;
      }
      if (current.seenFields.size === EXPLICIT_BEHAVIOR_FIELDS.length) finishCurrent();
      continue;
    }

    if (/^\d+(?:\.\d+)+\s*\S/.test(normalized) || isSectionHeading(normalized)) {
      finishCurrent();
    }
  }

  finishCurrent();
  return blocks;
}

function extractWorkflowSteps(text, context) {
  const workflowLabels = [
    '工作流程', '操作步骤', '业务流程', '管理流程', '工作程序',
    '申请流程', '操作流程', '审批流程', '核心流程及要求', '核心流程',
    '流程及要求', '流程要求', '办理流程', '实施流程', '规定', '管理内容', '程序'
  ];
  const blocks = extractLabeledBlocks(text, workflowLabels);
  if (!blocks.length) return [];
  const groupedSteps = [];
  for (const entry of blocks) {
    const group = { label: entry.label, block: entry.block, steps: [] };
    const explicitBlocks = extractExplicitBehaviorBlocks(entry.block, entry.lineOffset || 0);
    if (explicitBlocks.length) {
      const toStep = block => ({
        text: block.stepName,
        actor: block.values.actor_role || null,
        sourceText: block.sources.step_name,
        explicit: block
      });
      const stageKeys = Array.from(new Set(explicitBlocks.map(block => block.stage?.sourceText).filter(Boolean)));
      const canSplitByStage = stageKeys.length >= 2 && explicitBlocks.every(block => block.stage?.sourceText);
      if (canSplitByStage) {
        for (const stageKey of stageKeys) {
          const stageBlocks = explicitBlocks.filter(block => block.stage.sourceText === stageKey);
          const stage = stageBlocks[0].stage;
          groupedSteps.push({
            label: stage.sourceText,
            processName: stage.stageName,
            block: stageBlocks.map(block => Object.values(block.sources).filter(Boolean).join('\n')).join('\n'),
            sourceText: stage.sourceText,
            steps: stageBlocks.map(toStep)
          });
        }
      } else {
        group.steps = explicitBlocks.map(toStep);
        groupedSteps.push(group);
      }
      continue;
    }
    let skipLetterList = false;
    for (const line of entry.block.replace(/\r\n?/g, '\n').split('\n')) {
      const normalized = normalizeLine(line);
      if (!normalized) continue;
      if (/^\s*\d+\.\d+/.test(normalized)) skipLetterList = false;
      if (/下列|以下|包括/.test(normalized) && /[:：]$/.test(normalized)) {
        skipLetterList = true;
        continue;
      }
      if (skipLetterList && /^[a-zA-Z][)）]\s*/.test(normalized)) continue;
      const stripped = stripNumbering(normalized);
      if (!stripped || isSectionHeading(normalized)) continue;
      const hasNumbering = /^\s*(?:[（(]?(?:\d+(?:\.\d+)*|[一二三四五六七八九十]+)[)）]?|第?[一二三四五六七八九十]+)\s*[.、．)）]/.test(normalized);
      if (isWorkflowSubheading(normalized, stripped, hasNumbering)) continue;
      const hasWorkflowVerb = WORKFLOW_VERBS.some(verb => stripped.includes(verb));
      if (!hasNumbering && !hasWorkflowVerb) continue;
      for (const piece of splitWorkflowSentence(stripped)) {
        if (!piece.text || piece.text.length > 160) continue;
        group.steps.push(piece);
      }
    }
    if (group.steps.length) groupedSteps.push(group);
  }

  const steps = [];
  const processGroups = [];
  const duplicateCounts = new Map();
  const baseProcessName = context.workflowProcessBaseName || '';
  groupedSteps.forEach((group, groupIndex) => {
    const processRef = `proc_${groupIndex + 1}`;
    const label = group.label || `流程 ${groupIndex + 1}`;
    let l3Name = group.processName || (groupedSteps.length > 1
      ? [baseProcessName, label].filter(Boolean).join(' - ')
      : (baseProcessName || label));
    const seen = duplicateCounts.get(l3Name) || 0;
    duplicateCounts.set(l3Name, seen + 1);
    if (seen > 0) l3Name = `${l3Name}（${seen + 1}）`;
    processGroups.push({ process_ref: processRef, l3_name: l3Name, label, sourceText: group.sourceText || group.block });

    for (const piece of group.steps) {
      const index = steps.length;
      const fieldSourceText = piece.sourceText || piece.text;
      const explicitValues = piece.explicit?.values || null;
      const step = {
        step_ref: `step_${index + 1}`,
        draft_ref: null,
        process_ref: processRef,
        step_type: 'action',
        a1_code: null,
        step_name: piece.text,
        actor_role: piece.actor,
        timing: null,
        input_materials: explicitValues ? explicitValues.input_materials || null : extractInputMaterials(fieldSourceText),
        output_result: explicitValues ? explicitValues.output_result || null : extractOutputResult(fieldSourceText),
        entry: null,
        system: '',
        status: 'active',
        evidence_refs: ['EV-DOC-001']
      };
      steps.push(step);
      const explicitSources = piece.explicit?.sources || {};
      const explicitAnchors = piece.explicit?.sourceAnchors || {};
      addSource(context.fieldSources, context.fieldOrigins, `steps.${index}.step_name`, text, explicitSources.step_name || piece.sourceText, context.sourceName, explicitAnchors.step_name);
      if (step.actor_role) {
        addSource(context.fieldSources, context.fieldOrigins, `steps.${index}.actor_role`, text, explicitSources.actor_role || piece.sourceText, context.sourceName, explicitAnchors.actor_role);
      }
      if (step.input_materials) {
        addSource(context.fieldSources, context.fieldOrigins, `steps.${index}.input_materials`, text, explicitSources.input_materials || fieldSourceText, context.sourceName, explicitAnchors.input_materials);
      }
      if (step.output_result) {
        addSource(context.fieldSources, context.fieldOrigins, `steps.${index}.output_result`, text, explicitSources.output_result || fieldSourceText, context.sourceName, explicitAnchors.output_result);
      }
      if (piece.explicit) {
        if (!context.explicitBehaviorDetails) context.explicitBehaviorDetails = {};
        context.explicitBehaviorDetails[index] = {
          precondition: explicitValues.precondition || null,
          trigger_scene: explicitValues.trigger_scene || null,
          execution_standard: explicitValues.execution_standard || null,
          sources: explicitSources,
          sourceAnchors: explicitAnchors
        };
      }
    }
  });
  context.workflowProcessGroups = processGroups;
  return steps;
}

function parseRetentionPeriod(value) {
  const text = String(value || '');
  if (/永久|长期/.test(text)) return '永久';
  const match = text.match(/保存\s*(\d+)\s*年|(\d+)\s*年/);
  if (!match) return null;
  const period = `${match[1] || match[2]}年`;
  return ENUMS.retentionPeriod.includes(period) ? period : null;
}

function parseArchiveLocation(value) {
  const text = String(value || '');
  if (text.includes('资料室')) return '资料室';
  if (/归档|保存|留存/.test(text)) return '部门自行保存';
  return null;
}

function parseResponsibleDepartment(value, ownDept) {
  const text = String(value || '');
  const found = ENUMS.departments.find(item => text.includes(item.department_name));
  return found?.department_name || ownDept || null;
}

function parseResponsibleRole(value) {
  const text = String(value || '');
  const match = text.match(/由([^，。；;\n\r]{2,30}?)(?:填写|编制|登记|维护|归档|保存|提交|负责)/);
  return match ? match[1].trim() : null;
}

function cleanFormName(value) {
  return normalizeLine(value).replace(/[《》]/g, '').trim();
}

function extractForms(text, context, ownDept) {
  const formBlock = extractLabeledBlock(text, ['表单与记录', '相关记录', '表单', '表格', '规定表格', '记录']);
  const forms = [];
  if (!formBlock) return forms;
  const seen = new Set();
  const patterns = [
    /([A-Z]{1,8}[-A-Z0-9]*[-\u4e00-\u9fa5A-Z0-9]*)?《([^》]{2,50}?(?:计划书|报告|方案|单|表|台账|记录|卡|册|登记簿|明细表|汇总表|申请表|审批表|验收单|入库单|出库单))》([^。\n\r]*)/g,
    /([一-鿿A-Za-z0-9（）()]{2,50}?(?:计划书|报告|方案|单|表|台账|记录|卡|册|登记簿|明细表|汇总表|申请表|审批表|验收单|入库单|出库单))\s*(?:[-—–－]|如|包含|包括|见|用于|是)([^。\n\r]*)/g
  ];
  for (const pattern of patterns) {
    for (const match of formBlock.matchAll(pattern)) {
      const tableNo = pattern === patterns[0] ? (match[1] || '').trim() : null;
      const name = cleanFormName(pattern === patterns[0] ? match[2] : match[1]);
      const tail = (pattern === patterns[0] ? match[3] : match[2]) || '';
      if (seen.has(name)) continue;
      seen.add(name);
      const formCode = tableNo || `FORM-${String(forms.length + 1).padStart(3, '0')}`;
      const form = {
        form_ref: `form_${forms.length + 1}`,
        draft_ref: null,
        step_ref: 'step_1',
        form_code: formCode,
        form_name: name,
        main_table_code: null,
        main_table_name: `${name}主表`,
        archive_location: parseArchiveLocation(tail),
        retention_period: parseRetentionPeriod(tail),
        responsible_department_ref: null,
        responsible_department_name: parseResponsibleDepartment(tail, ownDept),
        responsible_role: parseResponsibleRole(tail),
        status: 'draft',
        evidence_refs: ['EV-DOC-001']
      };
      forms.push(form);
      const index = forms.length - 1;
      const sourceText = `${tableNo || ''}《${name}》${tail}`.trim();
      addSource(context.fieldSources, context.fieldOrigins, `forms.${index}.form_name`, text, sourceText, context.sourceName);
      addSource(context.fieldSources, context.fieldOrigins, `forms.${index}.form_code`, text, sourceText, context.sourceName);
      addSource(context.fieldSources, context.fieldOrigins, `forms.${index}.main_table_name`, text, sourceText, context.sourceName);
      if (form.archive_location) addSource(context.fieldSources, context.fieldOrigins, `forms.${index}.archive_location`, text, sourceText, context.sourceName);
      if (form.retention_period) addSource(context.fieldSources, context.fieldOrigins, `forms.${index}.retention_period`, text, sourceText, context.sourceName);
      if (form.responsible_department_name) addSource(context.fieldSources, context.fieldOrigins, `forms.${index}.responsible_department_name`, text, sourceText, context.sourceName);
      if (form.responsible_role) addSource(context.fieldSources, context.fieldOrigins, `forms.${index}.responsible_role`, text, sourceText, context.sourceName);
    }
  }
  return forms;
}

function extractFields(text, forms, context) {
  const fields = [];
  const seen = new Set();
  function addField(form, name, sourceText, note = null) {
    const fieldName = normalizeLine(name);
    if (!form || !fieldName) return;
    const key = `${form.form_ref}:${fieldName}`;
    if (seen.has(key)) return;
    seen.add(key);
    const index = fields.length;
    fields.push({
      field_ref: `field_${index + 1}`,
      draft_ref: null,
      form_ref: form.form_ref,
      field_name_cn: fieldName,
      field_name_en: null,
      data_object: null,
      field_type: '文本',
      enum_options: null,
      evidence_note: note,
      status: 'suggested',
      evidence_refs: ['EV-DOC-001']
    });
    addSource(context.fieldSources, context.fieldOrigins, `form_fields.${index}.field_name_cn`, text, sourceText || fieldName, context.sourceName);
  }

  for (const match of String(text || '').matchAll(/包含字段[：:]\s*([^\n\r]+)/g)) {
    for (const name of splitList(match[1])) {
      addField(forms[0], name, match[0]);
    }
  }

  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((line, index) => ({ line: normalizeLine(line), index }));
  const nonEmpty = lines.filter(item => item.line);
  const titleIndexes = forms.map(form => {
    const titleIndex = nonEmpty.findIndex(item => item.line === form.form_name);
    return { form, titleIndex };
  }).filter(item => item.titleIndex >= 0);

  function isFieldName(line, formNames) {
    if (!line || line.length > 32) return false;
    if (formNames.includes(line)) return false;
    if (/^[A-Z]{2,}[-A-Z0-9]+/.test(line)) return false;
    if (/^□|^（|^\(|^第?\d+|^\d/.test(line)) return false;
    if (/[。；;：:？?]/.test(line)) return false;
    if (/^(?:签字|签名|日期|编号|项目编号|完成时间|责任人)$/.test(line)) return false;
    if (!/[\u4e00-\u9fa5]/.test(line)) return false;
    return true;
  }

  const formNames = forms.map(form => form.form_name);
  for (let i = 0; i < titleIndexes.length; i += 1) {
    const current = titleIndexes[i];
    const end = i < titleIndexes.length - 1 ? titleIndexes[i + 1].titleIndex : nonEmpty.length;
    for (let j = current.titleIndex + 1; j < end; j += 1) {
      const line = nonEmpty[j].line;
      if (!isFieldName(line, formNames)) continue;
      const next = nonEmpty[j + 1]?.line || '';
      const note = next && !isFieldName(next, formNames) && next.length <= 80 ? next : null;
      addField(current.form, line, line, note);
    }
  }
  return fields;
}

function likelyDetailTableTitle(value) {
  const title = normalizeTableTitle(value);
  return title.length >= 4 && /(名单|明细表|明细清单|清单)$/.test(title);
}

function likelyDetailFieldName(value) {
  const fieldName = normalizeLine(value);
  if (!fieldName || fieldName.length > 24) return false;
  if (/^[A-Z]{2,}[-A-Z0-9]+/.test(fieldName)) return false;
  if (/^□|^（|^\(|^第?\d+|^\d/.test(fieldName)) return false;
  if (/[。；;：:？?]/.test(fieldName)) return false;
  if (!/[\u4e00-\u9fa5]/.test(fieldName)) return false;
  return true;
}

function detectDetailTables(forms, context) {
  if (!forms.length) return [];
  const details = [];
  for (const table of context.sourceTables || []) {
    const rows = table.rows || [];
    for (let index = 0; index < rows.length - 1; index += 1) {
      const row = rows[index];
      const titleCells = row.filter(cell => cell.text);
      if (titleCells.length !== 1 || !likelyDetailTableTitle(titleCells[0].text)) continue;
      const fieldCells = rows[index + 1]
        .filter(cell => likelyDetailFieldName(cell.text))
        .map(cell => ({ fieldName: normalizeLine(cell.text), sourceText: cell.text }));
      if (fieldCells.length < 2) continue;
      const title = normalizeTableTitle(titleCells[0].text);
      if (details.some(item => item.table_name === title)) continue;
      details.push({
        form_ref: forms[0].form_ref,
        table_name: title,
        sourceText: titleCells[0].text,
        fields: fieldCells
      });
    }
  }
  return details;
}

function buildFormTables(forms, fields, context, text) {
  const formTables = [];
  const tableFields = [];
  const detailTables = detectDetailTables(forms, context);
  const detailTitleNames = new Set(detailTables.map(table => normalizeTableTitle(table.table_name)));
  const detailFieldNames = new Set(detailTables.flatMap(table => table.fields.map(field => normalizeTableTitle(field.fieldName))));
  forms.forEach((form, index) => {
    const tableRef = `table_${index + 1}`;
    formTables.push({
      table_ref: tableRef,
      form_ref: form.form_ref,
      table_kind: 'main',
      table_no: null,
      table_code: form.main_table_code || null,
      table_name: form.main_table_name || `${form.form_name || '未命名表单'}主表`
    });
    addSource(context.fieldSources, context.fieldOrigins, `form_tables.${index}.table_name`, text, form.form_name || '', context.sourceName);
    fields
      .filter(field => field.form_ref === form.form_ref)
      .filter(field => {
        const name = normalizeTableTitle(field.field_name_cn);
        return !detailTitleNames.has(name) && !detailFieldNames.has(name);
      })
      .forEach(field => {
        const fieldIndex = tableFields.length;
        tableFields.push({
          table_field_ref: `table_field_${fieldIndex + 1}`,
          table_ref: tableRef,
          structure_kind: 'main',
          field_no: null,
          field_code: null,
          field_name: field.field_name_cn,
          field_type: field.field_type || '文本',
          required: false,
          description: field.evidence_note || null
        });
        addSource(context.fieldSources, context.fieldOrigins, `form_table_fields.${fieldIndex}.field_name`, text, field.field_name_cn, context.sourceName);
      });
  });
  for (const detail of detailTables) {
    const tableIndex = formTables.length;
    const tableRef = `table_${tableIndex + 1}`;
    formTables.push({
      table_ref: tableRef,
      form_ref: detail.form_ref,
      table_kind: 'detail',
      table_no: null,
      table_code: null,
      table_name: detail.table_name
    });
    addSource(context.fieldSources, context.fieldOrigins, `form_tables.${tableIndex}.table_name`, text, detail.sourceText || detail.table_name, context.sourceName);
    for (const field of detail.fields) {
      const fieldIndex = tableFields.length;
      tableFields.push({
        table_field_ref: `table_field_${fieldIndex + 1}`,
        table_ref: tableRef,
        structure_kind: 'detail',
        field_no: null,
        field_code: null,
        field_name: field.fieldName,
        field_type: '文本',
        required: false,
        description: null
      });
      addSource(context.fieldSources, context.fieldOrigins, `form_table_fields.${fieldIndex}.field_name`, text, field.sourceText || field.fieldName, context.sourceName);
    }
  }
  return { formTables, tableFields };
}

function buildProjection(data) {
  const d = data.draft;
  const evidenceCatalog = data.evidence_catalog.map(item => ({
    id: item.evidence_ref,
    source_type: item.evidence_type || null,
    source_file: item.source_file || item.source_name || null,
    locator: item.locator || item.source_anchor || null,
    locate_method: item.locate_method || null,
    status: item.status || 'pending_review'
  }));
  const l3KeyByProcessRef = new Map();
  const l3Catalog = data.processes.map((process, index) => {
    const l3Key = process.l3_key || process.process_code || `${d.document_no || 'DOC'}.L3.${String(index + 1).padStart(3, '0')}`;
    l3KeyByProcessRef.set(process.process_ref, l3Key);
    return {
      l1: process.l1_name || '',
      l2: process.l2_name || '',
      l3_key: l3Key,
      l3_name: process.l3_name || '',
      document_no: d.document_no || null,
      document_title: d.document_title || null,
      document_edition: d.planned_edition || 'A',
      system: process.system || '',
      owner: process.owner || null,
      evidence_refs: process.evidence_refs || []
    };
  });
  const a1Catalog = data.steps.map((step, index) => ({
    a1_code: step.a1_code || `${d.document_no || 'DOC'}-A1-DRAFT-${String(index + 1).padStart(3, '0')}`,
    l3_key: l3KeyByProcessRef.get(step.process_ref) || l3Catalog[0]?.l3_key || '',
    behavior: step.step_name || '',
    document_no: d.document_no || null,
    document_title: d.document_title || null,
    document_edition: d.planned_edition || 'A',
    role: step.actor_role || null,
    entry: step.entry || null,
    system: step.system || '',
    evidence_refs: step.evidence_refs || []
  }));
  return {
    meta: {
      document_no: d.document_no || '',
      document_title: d.document_title || '',
      document_edition: d.planned_edition || 'A',
      document_version_status: null,
      dept_code: d.department.department_code || null,
      dept_name: d.department.department_name || '',
      domain: d.department.domain || null,
      maintainer: null,
      version: '1.0.0',
      status: d.status || 'draft',
      parser_schema_version: 1
    },
    l3_catalog: l3Catalog,
    a1_catalog: a1Catalog,
    evidence_catalog: evidenceCatalog,
    work_role_bindings: (data.work_role_bindings || [])
      .filter(item => item.status === 'confirmed')
      .map(item => ({
        binding_ref: item.binding_ref,
        process_ref: item.process_ref,
        step_ref: item.step_ref == null ? null : item.step_ref,
        participant_department: item.participant_department,
        source_role_text: item.source_role_text || null,
        work_role_code: item.work_role_code,
        participation_type: item.participation_type,
        status: 'confirmed',
        evidence_refs: item.evidence_refs || [],
        confirmation_basis: item.confirmation_basis
      })),
    mdm_requirement_catalog: data.mdm_requirement_catalog.map(item => ({
      object: item.object,
      key_fields: item.key_fields || [],
      owner_dept: item.owner_dept || null,
      requirement: item.requirement || null,
      evidence_refs: item.evidence_refs || []
    }))
  };
}

function buildMarkdownDraft(data) {
  const lines = [
    `# ${data.draft.document_title || '未命名制度'}`,
    '',
    `- 制度编号：${data.draft.document_no || '待补'}`,
    `- 版次：${data.draft.planned_edition || 'A'}`,
    `- 归口部门：${data.draft.department.department_name || '待补'}`,
    '',
    '## 目的',
    data.document_profile.purpose || '待补',
    '',
    '## 适用范围',
    data.document_profile.scope || '待补',
    '',
    '## 流程步骤'
  ];
  data.steps.forEach((step, index) => lines.push(`${index + 1}. ${step.step_name || '待补'}`));
  return lines.join('\n');
}

function getValue(data, pathKey) {
  return pathKey.split('.').reduce((target, part) => target == null ? undefined : target[part], data);
}

function statsFrom(data) {
  return {
    processes: (data.processes || []).length,
    steps: (data.steps || []).length,
    behaviorDetails: (data.behavior_details || []).length,
    handoffs: (data.cross_dept_handoffs || []).length,
    forms: (data.forms || []).length,
    tables: (data.form_tables || []).length,
    tableFields: (data.form_table_fields || []).length,
    fields: (data.form_fields || []).length,
    evidence: (data.evidence_catalog || []).length,
    workRoleBindings: (data.work_role_bindings || []).length,
    mdmRequirements: (data.mdm_requirement_catalog || []).length,
    terms: (data.terms || []).length
  };
}

async function extractFromText(rawText, options = {}) {
  const text = rawText || '';
  const data = createEmptyDocument();
  const context = {
    sourceName: options.sourceName || null,
    sourceHints: buildSourceHints(options.sourceName, options.sourcePath),
    sourceTables: Array.isArray(options.sourceTables) ? options.sourceTables : [],
    fieldSources: {},
    fieldOrigins: {},
    fieldWarnings: {},
    fieldSuggestions: {}
  };
  const d = data.draft;

  for (const [pathKey, labels, fieldOptions] of [
    ['draft.document_no', ['文件编号', '文档编号', '制度编号', '编号'], { pattern: /^[A-Z]{2,10}(?:-[A-Z0-9]+)+$/ }],
    ['draft.document_title', ['文件名称', '文档名称', '制度名称', '标题'], { reject: /^(程序文件|管理文件|文件名称)$/ }],
    ['draft.planned_edition', ['版次', '版本', '版号'], { pattern: /^[A-Z]+$/ }],
    ['draft.department.department_name', ['发文部门', '责任部门', '所属部门', '归口部门', '主管部门'], {}]
  ]) {
    const found = extractKeyValue(text, labels, fieldOptions || {});
    if (found) {
      if (pathKey === 'draft.department.department_name') {
        d.department = normalizeDepartment(found.value);
      } else {
        setValue(data, pathKey, found.value);
      }
      addSource(context.fieldSources, context.fieldOrigins, pathKey, text, found.sourceText, context.sourceName);
    }
  }
  if (!d.process_name) d.process_name = d.document_title || '';
  markDefault(context.fieldOrigins, 'draft.basis_type');

  const relatedDept = extractKeyValue(text, ['相关部门', '涉及部门', '协作部门']);
  const relatedDeptText = relatedDept?.value || flattenBlock(extractLabeledBlock(text, ['相关部门', '涉及部门', '协作部门']));
  d.related_departments = splitList(relatedDeptText).filter(dept => dept !== d.department.department_name);
  d.involves_other_departments = d.related_departments.length > 0;
  if (relatedDept) addSource(context.fieldSources, context.fieldOrigins, 'draft.related_departments', text, relatedDept.sourceText, context.sourceName);

  const purposeBlock = extractLabeledBlock(text, ['目的', '目标', '设立原因']);
  const purposeText = flattenBlock(purposeBlock);
  if (purposeText) {
    d.reason = purposeText;
    addSource(context.fieldSources, context.fieldOrigins, 'draft.reason', text, purposeBlock, context.sourceName);
    addSource(context.fieldSources, context.fieldOrigins, 'document_profile.purpose', text, purposeBlock, context.sourceName);
  }

  const scopeBlock = extractLabeledBlock(text, ['范围', '适用范围']);
  const scopeText = flattenBlock(scopeBlock);
  if (scopeText) {
    addSource(context.fieldSources, context.fieldOrigins, 'document_profile.scope', text, scopeBlock, context.sourceName);
  }

  const basisBlock = extractLabeledBlock(text, ['依据', '引用文件', '引用标准']);
  const basisText = flattenBlock(basisBlock);
  if (basisText) {
    d.basis_description = basisText;
    d.basis_type = ENUMS.basisType.find(value => basisText.includes(value)) || '制度 / 规程';
    addSource(context.fieldSources, context.fieldOrigins, 'draft.basis_description', text, basisBlock, context.sourceName);
    addSource(context.fieldSources, context.fieldOrigins, 'draft.basis_type', text, basisBlock, context.sourceName);
  }

  data.document_profile = {
    profile_ref: null,
    draft_ref: null,
    document_title: d.document_title,
    document_no: d.document_no,
    purpose: d.reason || '',
    scope: scopeText || '',
    inheritance_relation: null
  };
  if (d.document_title) addSource(context.fieldSources, context.fieldOrigins, 'document_profile.document_title', text, d.document_title, context.sourceName);
  if (d.document_no) addSource(context.fieldSources, context.fieldOrigins, 'document_profile.document_no', text, d.document_no, context.sourceName);

  const mapping = applyProcessMapping(data, text, context);
  data.terms = extractTerms(text, context);
  context.workflowProcessBaseName = d.l3_name || d.process_name || d.document_title || '';
  data.steps = extractWorkflowSteps(text, context);
  data.forms = extractForms(text, context, d.department.department_name);
  data.form_fields = extractFields(text, data.forms, context);
  const { formTables, tableFields } = buildFormTables(data.forms, data.form_fields, context, text);
  data.form_tables = formTables;
  data.form_table_fields = tableFields;

  if (data.steps.length > 0 || mapping) {
    const l3Name = d.l3_name || d.process_name || d.document_title || '';
    const workflowProcessGroups = context.workflowProcessGroups?.length
      ? context.workflowProcessGroups
      : [{ process_ref: 'proc_1', l3_name: l3Name, sourceText: d.process_name || d.document_title }];
    data.processes = workflowProcessGroups.map((group, index) => ({
      process_ref: group.process_ref || `proc_${index + 1}`,
      draft_ref: null,
      process_code: null,
      l3_key: d.document_no ? `${d.document_no}.L3.${String(index + 1).padStart(3, '0')}` : null,
      process_type: d.base_version_ref ? 'inherit' : 'new',
      l1_name: d.l1_name || '待确认',
      l2_name: d.l2_name || '待确认',
      l3_name: group.l3_name || l3Name,
      description: d.reason || null,
      owner: d.department.department_name || null,
      system: mapping?.system?.split(/[、,，/]/).map(item => item.trim()).filter(Boolean)[0] || '',
      evidence_refs: ['EV-DOC-001']
    }));
    if (!d.l3_name) d.l3_name = l3Name || null;
    data.processes.forEach((process, index) => {
      if (mapping) {
        addExternalSource(context.fieldSources, context.fieldOrigins, `processes.${index}.l1_name`, mapping.sourceText, mapping.sourceName, mapping.sourceAnchor, 'external_reference');
        addExternalSource(context.fieldSources, context.fieldOrigins, `processes.${index}.l2_name`, mapping.sourceText, mapping.sourceName, mapping.sourceAnchor, 'external_reference');
        addExternalSource(context.fieldSources, context.fieldOrigins, `processes.${index}.l3_name`, mapping.sourceText, mapping.sourceName, mapping.sourceAnchor, 'external_reference');
        addExternalSource(context.fieldSources, context.fieldOrigins, `processes.${index}.system`, mapping.sourceText, mapping.sourceName, mapping.sourceAnchor, 'external_reference');
      } else {
        addSource(context.fieldSources, context.fieldOrigins, `processes.${index}.l3_name`, text, workflowProcessGroups[index]?.sourceText || process.l3_name, context.sourceName);
      }
    });
  }

  data.behavior_details = data.steps.map((step, index) => {
    const sourceText = context.fieldSources[`steps.${index}.step_name`]?.source_text || step.step_name;
    const explicitDetail = context.explicitBehaviorDetails?.[index] || null;
    const executionStandardInfo = explicitDetail
      ? {
          value: explicitDetail.execution_standard,
          sourceText: explicitDetail.sources?.execution_standard || null
        }
      : extractExecutionStandardInfo(sourceText, step, text);
    const executionStandard = executionStandardInfo.value;
    const precondition = explicitDetail ? explicitDetail.precondition : extractPrecondition(sourceText);
    const triggerScene = explicitDetail ? explicitDetail.trigger_scene : extractTriggerScene(sourceText);
    const detail = {
      detail_ref: `detail_${index + 1}`,
      step_ref: step.step_ref,
      precondition,
      trigger_scene: triggerScene,
      execution_standard: executionStandard,
      delivery_object: step.output_result || null,
      requires_approval: detectApproval(step.step_name),
      approval_note: detectApproval(step.step_name) ? step.step_name : null,
      is_cross_department: detectCrossDepartment(step, d.department.department_name, d.related_departments)
    };
    if (precondition) {
      addSource(
        context.fieldSources,
        context.fieldOrigins,
        `behavior_details.${index}.precondition`,
        text,
        explicitDetail?.sources?.precondition || sourceText,
        context.sourceName,
        explicitDetail?.sourceAnchors?.precondition
      );
    }
    if (triggerScene) {
      addSource(
        context.fieldSources,
        context.fieldOrigins,
        `behavior_details.${index}.trigger_scene`,
        text,
        explicitDetail?.sources?.trigger_scene || sourceText,
        context.sourceName,
        explicitDetail?.sourceAnchors?.trigger_scene
      );
    }
    if (executionStandard) {
      addSource(
        context.fieldSources,
        context.fieldOrigins,
        `behavior_details.${index}.execution_standard`,
        text,
        executionStandardInfo.sourceText || sourceText || executionStandard,
        context.sourceName,
        explicitDetail?.sourceAnchors?.execution_standard
      );
    }
    return detail;
  });

  data.cross_dept_handoffs = d.related_departments.map((dept, index) => ({
    handoff_ref: `handoff_${index + 1}`,
    step_ref: data.steps.find(step => [step.step_name, step.actor_role].filter(Boolean).join(' ').includes(dept))?.step_ref || data.steps[data.steps.length - 1]?.step_ref || 'step_1',
    target_department: dept,
    target_process_code: null,
    target_process_name: null,
    target_behavior_code: null,
    target_behavior_name: null,
    handoff_standard: null,
    status: 'pending_review'
  }));

  if (text.trim()) {
    data.evidence_catalog.push({
      evidence_ref: 'EV-DOC-001',
      draft_ref: null,
      object_type: 'draft',
      object_ref: d.document_no || d.document_title || null,
      evidence_type: d.basis_type === '表单 / 台账' ? '表单样例' : '制度条款',
      description: '导入制度文件中的原文片段。',
      source_name: options.sourceName || d.document_title || null,
      source_anchor: '导入文件',
      source_file: options.sourceName || null,
      locator: '导入文件',
      locate_method: 'template_text',
      confirmer: null,
      record_time: null,
      missing_reason: null,
      expected_provider: d.department.department_name || null,
      expected_at: null,
      maturity: '可保存草稿',
      status: 'pending_review'
    });
  }

  context.fieldSuggestions = {};
  applyActorRoleWarnings(data, context);
  addRoleEvidenceAndReviewItems(data, context);
  addClassificationReviewItems(data, context);
  data.structure_block_projection = buildProjection(data);
  data.markdown_draft = buildMarkdownDraft(data);
  data.generated_at = new Date().toISOString();
  normalizeOptionalContractValues(data, STANDARD_SCHEMA);

  return {
    data,
    fieldSources: context.fieldSources,
    fieldOrigins: context.fieldOrigins,
    fieldWarnings: context.fieldWarnings,
    fieldSuggestions: context.fieldSuggestions,
    stats: statsFrom(data)
  };
}

async function sourceFromUpload(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.docx') {
    inspectDocxArchive(file.buffer);
    return parseDocxInWorker(file.buffer);
  }
  if (ext === '.txt' || ext === '.md') return { text: decodeTextBuffer(file.buffer), tables: [] };
  throw Object.assign(new Error('上传文件类型不受支持'), {
    publicCode: 'UNSUPPORTED_FILE_TYPE',
    publicMessage: '文件类型不受支持。请上传.docx、.txt或.md文件。',
    statusCode: 415
  });
}

function referenceMaterialFromSource({ sourceName, rawText, fileBuffer = null, parsedData = null }) {
  const basisType = parsedData?.draft?.basis_type;
  const extension = path.extname(sourceName || '').toLowerCase();
  const materialType = basisType === '表单 / 台账'
    ? '表单或记录'
    : extension === '.txt' || extension === '.md'
      ? '现行业务操作说明'
      : '现有制度';
  return {
    material_ref: `material_${crypto.randomBytes(8).toString('hex')}`,
    material_type: materialType,
    material_name: sourceName || '',
    document_no: parsedData?.draft?.document_no || null,
    version: parsedData?.draft?.planned_edition || null,
    file_sha256: fileBuffer ? crypto.createHash('sha256').update(fileBuffer).digest('hex') : null,
    readable_text: rawText || '',
    provider_department: '',
    provider_name: '',
    as_of_date: null
  };
}

app.get('/vendor/cytoscape.min.js', (_req, res) => {
  res.type('application/javascript').sendFile(cytoscapeBrowserPath);
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const rid = requestId(req.body.requestId || req.headers['x-request-id']);
    if (!req.file) {
      return res.status(400).json({
        error: '未收到文件。请选择一个.docx、.txt或.md文件后重试。',
        code: 'FILE_REQUIRED'
      });
    }

    const normalizedFileName = normalizeUploadedFileName(req.file.originalname);
    const source = await sourceFromUpload({ ...req.file, originalname: normalizedFileName });
    const rawText = source.text;
    if (!rawText.trim()) {
      return res.status(400).json({
        error: '文件内容为空。请补充内容或重新选择文件。',
        code: 'FILE_CONTENT_EMPTY'
      });
    }

    const result = await extractFromText(rawText, {
      sourceName: normalizedFileName,
      sourcePath: req.body.sourcePath || normalizedFileName,
      sourceTables: source.tables
    });
    res.json({
      requestId: rid,
      documentName: normalizedFileName,
      data: result.data,
      fieldSources: result.fieldSources,
      fieldOrigins: result.fieldOrigins,
      fieldWarnings: result.fieldWarnings,
      fieldSuggestions: result.fieldSuggestions,
      referenceMaterial: referenceMaterialFromSource({
        sourceName: normalizedFileName,
        rawText,
        fileBuffer: req.file.buffer,
        parsedData: result.data
      }),
      enums: publicEnums(),
      stats: result.stats
    });
  } catch (error) {
    if (error?.publicCode) {
      return res.status(error.statusCode || 422).json({
        error: error.publicMessage || '文件无法处理。请检查文件后重试。',
        code: error.publicCode
      });
    }
    res.status(422).json({
      error: '文件无法读取或内容不符合支持的格式。请检查文件后重试。',
      code: 'FILE_PARSE_FAILED'
    });
  }
});

app.post('/api/paste', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const rid = requestId(body.requestId || req.headers['x-request-id']);
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return res.status(400).json({
        error: '粘贴内容为空。请粘贴需要整理的文字后重试。',
        code: 'PASTED_CONTENT_EMPTY'
      });
    }
    const result = await extractFromText(text, { sourceName: '粘贴文本' });
    res.json({
      requestId: rid,
      documentName: '粘贴文本',
      data: result.data,
      fieldSources: result.fieldSources,
      fieldOrigins: result.fieldOrigins,
      fieldWarnings: result.fieldWarnings,
      fieldSuggestions: result.fieldSuggestions,
      referenceMaterial: referenceMaterialFromSource({
        sourceName: '粘贴文本',
        rawText: text,
        parsedData: result.data
      }),
      enums: publicEnums(),
      stats: result.stats
    });
  } catch (error) {
    res.status(422).json({
      error: '粘贴内容无法整理。请检查内容后重试。',
      code: 'PASTED_CONTENT_PARSE_FAILED'
    });
  }
});

app.post('/api/validate', (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({
      error: '缺少待校验的结构化文件内容。请提供data对象后重试。',
      code: 'VALIDATION_DATA_REQUIRED'
    });
  }
  const safetyProblem = jsonSafetyProblem(data);
  if (safetyProblem) return res.status(400).json(safetyProblem);
  const schemaVersion = data.schema_version;
  if (!schemaVersion) {
    return res.status(400).json({
      error: '结构化文件缺少schema_version。请从原系统重新导出后重试。',
      code: 'SCHEMA_VERSION_REQUIRED'
    });
  }
  const validationProfile = req.body?.validation_profile || '';
  if (validationProfile && validationProfile !== 'early-v7-data-fields') {
    return res.status(400).json({ error: '不支持的校验方式', code: 'UNSUPPORTED_VALIDATION_PROFILE' });
  }
  if (validationProfile === 'early-v7-data-fields' && schemaVersion !== 'process-governance-v7') {
    return res.status(400).json({ error: '早期V7兼容校验只适用于process-governance-v7', code: 'VALIDATION_PROFILE_VERSION_MISMATCH' });
  }
  if (['process-governance-v1', 'process-governance-v2', 'process-governance-v3', 'process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(schemaVersion)) {
    const normalizedData = JSON.parse(JSON.stringify(data));
    return res.json({
      ...processGovernanceValidationResult(normalizedData, { validationProfile }),
      data: normalizedData
    });
  }
  if (schemaVersion !== 'document-structured-output-v2') {
    return res.status(400).json({
      error: '结构化文件版本不受支持。请使用3001明确支持的版本。',
      code: 'UNSUPPORTED_SCHEMA_VERSION'
    });
  }
  const normalizedData = JSON.parse(JSON.stringify(data));
  return res.json({
    ...contractValidationResult(normalizedData),
    data: normalizedData
  });
});

app.all(['/api/session', '/api/data', '/api/export'], (_req, res) => {
  res.status(404).json({
    error: '当前工具不保存页面内容。需要保留结果时，请在当前页面下载结构化文件。',
    code: 'STATELESS_ENDPOINT_DISABLED'
  });
});

app.get('/api/schema', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.query.version === 'document-structured-output-v2') return res.json(STANDARD_SCHEMA);
  if (req.query.version === 'process-governance-v1') return res.json(PROCESS_GOVERNANCE_V1_SCHEMA);
  if (req.query.version === 'process-governance-v2') return res.json(PROCESS_GOVERNANCE_V2_SCHEMA);
  if (req.query.version === 'process-governance-v3') return res.json(PROCESS_GOVERNANCE_V3_SCHEMA);
  if (req.query.version === 'process-governance-v4') return res.json(PROCESS_GOVERNANCE_V4_SCHEMA);
  if (req.query.version === 'process-governance-v5') {
    res.set('X-Infomat-Schema-Digest', PROCESS_GOVERNANCE_V5_SCHEMA_DIGEST);
    return res.json(PROCESS_GOVERNANCE_V5_SCHEMA);
  }
  if (req.query.version === 'process-governance-v6') {
    res.set('X-Infomat-Schema-Digest', PROCESS_GOVERNANCE_V6_SCHEMA_DIGEST);
    return res.json(PROCESS_GOVERNANCE_V6_SCHEMA);
  }
  if (req.query.version === 'process-governance-v7') {
    res.set('X-Infomat-Schema-Digest', PROCESS_GOVERNANCE_SCHEMA_DIGEST);
    return res.json(PROCESS_GOVERNANCE_V7_SCHEMA);
  }
  if (req.query.version) {
    return res.status(400).json({
      error: '不支持的结构规则版本。请从版本历史中选择3001明确支持的版本。',
      code: 'UNSUPPORTED_SCHEMA_VERSION'
    });
  }
  res.set('X-Infomat-Schema-Digest', PROCESS_GOVERNANCE_SCHEMA_DIGEST);
  return res.json(PROCESS_GOVERNANCE_SCHEMA);
});
app.get('/api/template', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const version = req.query.version || 'process-governance-v7';
  if (!['process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(version)) {
    return res.status(400).json({
      error: '空白模板版本不受支持。请从版本历史中选择3001明确支持的版本。',
      code: 'UNSUPPORTED_SCHEMA_VERSION'
    });
  }
  if (version === 'process-governance-v7') {
    return res.json({
      app_commit: APP_COMMIT,
      schema_version: 'process-governance-v7',
      schema_digest: PROCESS_GOVERNANCE_SCHEMA_DIGEST,
      data: createEmptyProcessGovernanceV7Document()
    });
  }
  if (version === 'process-governance-v6') {
    return res.json({
      app_commit: APP_COMMIT,
      schema_version: 'process-governance-v6',
      schema_digest: PROCESS_GOVERNANCE_V6_SCHEMA_DIGEST,
      data: createEmptyProcessGovernanceV6Document()
    });
  }
  return res.json({
    app_commit: APP_COMMIT,
    schema_version: 'process-governance-v5',
    schema_digest: PROCESS_GOVERNANCE_V5_SCHEMA_DIGEST,
    data: createEmptyProcessGovernanceV5Document()
  });
});
app.get('/api/version-history', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(PROCESS_GOVERNANCE_VERSION_HISTORY);
});
app.get('/api/ui-config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(structuredOutputUiConfig());
});
app.get('/api/enums', (_req, res) => res.json(publicEnums()));
app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const version = req.query.version || 'process-governance-v7';
  if (!['process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(version)) {
    return res.status(400).json({
      error: '健康检查结构版本不受支持。请使用v5、v6或v7。',
      code: 'UNSUPPORTED_SCHEMA_VERSION'
    });
  }
  const schemaDigest = version === 'process-governance-v5'
    ? PROCESS_GOVERNANCE_V5_SCHEMA_DIGEST
    : version === 'process-governance-v6'
      ? PROCESS_GOVERNANCE_V6_SCHEMA_DIGEST
      : PROCESS_GOVERNANCE_SCHEMA_DIGEST;
  res.json({
    status: 'ok',
    service: 'structured-output-service',
    app_commit: APP_COMMIT,
    schema_version: version,
    release_status: PROCESS_GOVERNANCE_VERSION_HISTORY.current_status || 'released',
    schema_digest: schemaDigest,
    port: PORT,
    host: HOST,
    uptime: process.uptime()
  });
});
app.all('/api/*', (_req, res) => {
  res.status(404).json({
    error: '接口不存在。请检查请求路径和方法后重试。',
    code: 'API_NOT_FOUND'
  });
});
app.use((error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: '请求内容不是有效的JSON。请检查文件或请求内容后重试。',
      code: 'INVALID_JSON'
    });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({
      error: '请求内容超过10MB，系统未处理该内容。请缩小文件后重试。',
      code: 'REQUEST_TOO_LARGE'
    });
  }
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '文件超过10MB，未读取任何内容。', code: 'FILE_TOO_LARGE' });
  }
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: '文件上传失败，请检查文件数量和上传方式。', code: 'UPLOAD_REJECTED' });
  }
  if (res.headersSent) return next(error);
  return res.status(500).json({
    error: '请求处理失败。请保持当前页面内容，并联系维护人员。',
    code: 'INTERNAL_ERROR'
  });
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`structured-output-service listening on http://${HOST}:${PORT}`);
    console.log('stateless: request data is not stored');
  });
}

module.exports = {
  app,
  createEmptyDocument,
  createEmptyProcessGovernanceDocument,
  createEmptyProcessGovernanceV5Document,
  createEmptyProcessGovernanceV6Document,
  createEmptyProcessGovernanceV7Document,
  processGovernanceValidationResult,
  decodeTextBuffer,
  extractFromText,
  buildProjection,
  statsFrom,
  APP_COMMIT,
  PROCESS_GOVERNANCE_SCHEMA_DIGEST,
  structuredOutputUiConfig,
  inspectDocxArchive
};
