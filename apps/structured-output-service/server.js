const express = require('express');

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const Ajv2020 = require('ajv/dist/2020');
const { validateProcessGovernanceV7, validateProcessGovernanceV8 } = require('../../scripts/process-governance/v7-validator');

const app = express();
const PORT = Number(process.env.STRUCTURED_OUTPUT_PORT || process.env.PORT || 3001);
const HOST = process.env.STRUCTURED_OUTPUT_HOST || '0.0.0.0';

const MAX_JSON_DEPTH = 64;
const MAX_JSON_STRING_LENGTH = 1024 * 1024;
const MAX_JSON_NODES = 100000;

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
const processGovernanceV8SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v8.schema.json');
const processGovernanceVersionHistoryPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-version-history.json');
const PROCESS_GOVERNANCE_V1_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV1SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V2_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV2SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V3_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV3SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V4_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV4SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V5_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV5SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V6_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV6SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V7_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV7SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_SCHEMA_SOURCE = fs.readFileSync(processGovernanceV8SchemaPath);
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
const validateProcessGovernanceV7Document = processGovernanceAjv.compile(PROCESS_GOVERNANCE_V7_SCHEMA);
const validateProcessGovernanceV8Document = processGovernanceAjv.compile(PROCESS_GOVERNANCE_SCHEMA);
const earlyV7CompatibilitySchema = JSON.parse(JSON.stringify(PROCESS_GOVERNANCE_V7_SCHEMA));
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
  if (process.env.STRUCTURED_OUTPUT_APP_COMMIT) return process.env.STRUCTURED_OUTPUT_APP_COMMIT;
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
    compact_task_ui_enabled: env?.STRUCTURED_OUTPUT_COMPACT_TASK_UI_ENABLED == null
      || String(env.STRUCTURED_OUTPUT_COMPACT_TASK_UI_ENABLED) === '1',
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

let rosterRoleCatalogCache = null;
let workRoleCatalogCache = null;

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
  const document = createEmptyProcessGovernanceV7Document();
  document.schema_version = 'process-governance-v8';
  document.migration.source_schema_version = 'process-governance-v8';
  return document;
}

function normalizeLine(line) {
  return String(line || '').replace(/\u3000/g, ' ').trim();
}

function parseMarkdownRow(line) {
  const trimmed = normalizeLine(line);
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  if (/^\|\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|$/.test(trimmed)) return null;
  return trimmed.slice(1, -1).split('|').map(cell => normalizeLine(cell));
}

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
  if (data?.schema_version === 'process-governance-v8') {
    return validateProcessGovernanceV8(data, { schemaValidator: validateProcessGovernanceV8Document });
  }
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

app.get('/vendor/cytoscape.min.js', (_req, res) => {
  res.type('application/javascript').sendFile(cytoscapeBrowserPath);
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

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
  if (['process-governance-v1', 'process-governance-v2', 'process-governance-v3', 'process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7', 'process-governance-v8'].includes(schemaVersion)) {
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
  if (req.query.version === 'process-governance-v8') {
    res.set('X-Infomat-Schema-Digest', PROCESS_GOVERNANCE_SCHEMA_DIGEST);
    return res.json(PROCESS_GOVERNANCE_SCHEMA);
  }
  if (req.query.version === 'process-governance-v7') {
    res.set('X-Infomat-Schema-Digest', crypto.createHash('sha256').update(fs.readFileSync(processGovernanceV7SchemaPath)).digest('hex'));
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
  const version = req.query.version || 'process-governance-v8';
  if (!['process-governance-v5', 'process-governance-v6', 'process-governance-v7', 'process-governance-v8'].includes(version)) {
    return res.status(400).json({
      error: '空白模板版本不受支持。请从版本历史中选择3001明确支持的版本。',
      code: 'UNSUPPORTED_SCHEMA_VERSION'
    });
  }
  if (version === 'process-governance-v8') {
    const data = createEmptyProcessGovernanceV7Document();
    data.schema_version = version;
    data.migration.source_schema_version = version;
    return res.json({ app_commit: APP_COMMIT, schema_version: version, schema_digest: PROCESS_GOVERNANCE_SCHEMA_DIGEST, data });
  }
  if (version === 'process-governance-v7') {
    return res.json({
      app_commit: APP_COMMIT,
      schema_version: 'process-governance-v7',
      schema_digest: crypto.createHash('sha256').update(fs.readFileSync(processGovernanceV7SchemaPath)).digest('hex'),
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
  const version = req.query.version || 'process-governance-v8';
  if (!['process-governance-v5', 'process-governance-v6', 'process-governance-v7', 'process-governance-v8'].includes(version)) {
    return res.status(400).json({
      error: '健康检查结构版本不受支持。请使用v5、v6或v7。',
      code: 'UNSUPPORTED_SCHEMA_VERSION'
    });
  }
  const schemaDigest = version === 'process-governance-v5'
    ? PROCESS_GOVERNANCE_V5_SCHEMA_DIGEST
    : version === 'process-governance-v6'
      ? PROCESS_GOVERNANCE_V6_SCHEMA_DIGEST
      : version === 'process-governance-v7' ? crypto.createHash('sha256').update(fs.readFileSync(processGovernanceV7SchemaPath)).digest('hex') : PROCESS_GOVERNANCE_SCHEMA_DIGEST;
  res.json({
    status: 'ok',
    service: 'structured-output-service',
    app_commit: APP_COMMIT,
    schema_version: version,
    release_status: version === 'process-governance-v8' ? 'candidate' : 'released',
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
  createEmptyProcessGovernanceDocument,
  createEmptyProcessGovernanceV5Document,
  createEmptyProcessGovernanceV6Document,
  createEmptyProcessGovernanceV7Document,
  processGovernanceValidationResult,
  APP_COMMIT,
  PROCESS_GOVERNANCE_SCHEMA_DIGEST,
  structuredOutputUiConfig,
};
