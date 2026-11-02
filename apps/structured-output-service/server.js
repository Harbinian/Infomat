const express = require('express');

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const {
  STANDARD_SCHEMA,
  PROCESS_GOVERNANCE_V1_SCHEMA,
  PROCESS_GOVERNANCE_V2_SCHEMA,
  PROCESS_GOVERNANCE_V3_SCHEMA,
  PROCESS_GOVERNANCE_V4_SCHEMA,
  PROCESS_GOVERNANCE_V5_SCHEMA,
  PROCESS_GOVERNANCE_V6_SCHEMA,
  PROCESS_GOVERNANCE_V7_SCHEMA,
  PROCESS_GOVERNANCE_V8_SCHEMA,
  PROCESS_GOVERNANCE_SCHEMA,
  PROCESS_GOVERNANCE_VERSION_HISTORY,
  PROCESS_GOVERNANCE_SCHEMA_DIGEST,
  PROCESS_GOVERNANCE_V5_SCHEMA_DIGEST,
  PROCESS_GOVERNANCE_V6_SCHEMA_DIGEST,
  PROCESS_GOVERNANCE_V8_SCHEMA_DIGEST,
  processGovernanceV7SchemaPath,
  createEmptyProcessGovernanceDocument,
  createEmptyProcessGovernanceV5Document,
  createEmptyProcessGovernanceV6Document,
  createEmptyProcessGovernanceV7Document,
  processGovernanceValidationResult,
  contractValidationResult,
  jsonSafetyProblem
} = require('../../scripts/process-governance/authoring-contracts').createAuthoringContracts({ Ajv2020: require('ajv/dist/2020') });

const app = express();
const PORT = Number(process.env.STRUCTURED_OUTPUT_PORT || process.env.PORT || 3001);
const HOST = process.env.STRUCTURED_OUTPUT_HOST || '0.0.0.0';

const cytoscapeBrowserPath = require.resolve('cytoscape/dist/cytoscape.min.js');

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
  const organizationCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'organization-catalog.json'), 'utf8'));
  return {
    ...ENUMS,
    departments: Object.keys(organizationCatalog.roles_by_department).map(department_name => ({ department_name, domain: '' })),
    rosterRolesByDepartment: organizationCatalog.roles_by_department,
    organizationCatalogSource: organizationCatalog.source,
    workRoles: workRoleCatalog.workRoles,
    workRolesByDepartment: workRoleCatalog.workRolesByDepartment,
    workRoleDataVersion: workRoleCatalog.schemaVersion
  };
}

app.get('/vendor/cytoscape.min.js', (_req, res) => {
  res.type('application/javascript').sendFile(cytoscapeBrowserPath);
});
// Keep the legacy page directly available while making the workbench the entry point.
app.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store').redirect(302, '/workbench/');
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
  if (['process-governance-v1', 'process-governance-v2', 'process-governance-v3', 'process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7', 'process-governance-v8', 'process-governance-v9'].includes(schemaVersion)) {
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
    res.set('X-Infomat-Schema-Digest', PROCESS_GOVERNANCE_V8_SCHEMA_DIGEST);
    return res.json(PROCESS_GOVERNANCE_V8_SCHEMA);
  }
  if (req.query.version === 'process-governance-v9') {
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
  const version = req.query.version || 'process-governance-v9';
  if (!['process-governance-v5', 'process-governance-v6', 'process-governance-v7', 'process-governance-v8', 'process-governance-v9'].includes(version)) {
    return res.status(400).json({
      error: '空白模板版本不受支持。请从版本历史中选择3001明确支持的版本。',
      code: 'UNSUPPORTED_SCHEMA_VERSION'
    });
  }
  if (version === 'process-governance-v9') {
    return res.json({ app_commit: APP_COMMIT, schema_version: version, schema_digest: PROCESS_GOVERNANCE_SCHEMA_DIGEST, data: createEmptyProcessGovernanceDocument() });
  }
  if (version === 'process-governance-v8') {
    const data = createEmptyProcessGovernanceV7Document();
    data.schema_version = version;
    data.migration.source_schema_version = version;
    return res.json({ app_commit: APP_COMMIT, schema_version: version, schema_digest: PROCESS_GOVERNANCE_V8_SCHEMA_DIGEST, data });
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
  const version = req.query.version || 'process-governance-v9';
  if (!['process-governance-v5', 'process-governance-v6', 'process-governance-v7', 'process-governance-v8', 'process-governance-v9'].includes(version)) {
    return res.status(400).json({
      error: '健康检查结构版本不受支持。请使用版本历史中的受支持版本。',
      code: 'UNSUPPORTED_SCHEMA_VERSION'
    });
  }
  const schemaDigest = version === 'process-governance-v5'
    ? PROCESS_GOVERNANCE_V5_SCHEMA_DIGEST
    : version === 'process-governance-v6'
      ? PROCESS_GOVERNANCE_V6_SCHEMA_DIGEST
      : version === 'process-governance-v7' ? crypto.createHash('sha256').update(fs.readFileSync(processGovernanceV7SchemaPath)).digest('hex') : version === 'process-governance-v8' ? PROCESS_GOVERNANCE_V8_SCHEMA_DIGEST : PROCESS_GOVERNANCE_SCHEMA_DIGEST;
  res.json({
    status: 'ok',
    service: 'structured-output-service',
    app_commit: APP_COMMIT,
    schema_version: version,
    release_status: ['process-governance-v8', 'process-governance-v9'].includes(version) ? 'candidate' : 'released',
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
  contractValidationResult,
  jsonSafetyProblem,
  APP_COMMIT,
  PROCESS_GOVERNANCE_SCHEMA_DIGEST,
  PROCESS_GOVERNANCE_V8_SCHEMA_DIGEST,
  structuredOutputUiConfig,
};
