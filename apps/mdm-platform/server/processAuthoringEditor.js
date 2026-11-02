// Pure editing contracts reused in-process; never starts or requests the 3001 service.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const authoring = require('../../../scripts/process-governance/authoring-contracts')
  .createAuthoringContracts({ Ajv2020: require('ajv/dist/2020') });
const contracts = path.resolve(__dirname, '../../../docs/contracts');
const publicRoot = path.resolve(__dirname, '../../structured-output-service/public');
const SCHEMAS = Object.freeze(['document-structured-output-v2', ...Array.from({ length: 9 }, (_, i) => `process-governance-v${i + 1}`)]);
const ASSET_FILES = Object.freeze([
  'graph-editor-state.js', 'edit-session-manager.js', 'graph-edit-commands.js', 'form-field-reuse.js',
  'process-governance-migration.js', 'import-compatibility.js', 'web-grid-core.js',
  'process-v7-grid-adapter.js', 'native-web-grid.js', 'element-references.js',
  'process-diagram.js', 'data-relation-diagram.js', 'lifecycle-analyzer.js',
  'process-data-availability.js', 'structure-score.js'
]);
function problem(code, error) { return Object.assign(new Error(error), { code, statusCode: 400 }); }
function schema(version = 'process-governance-v9') {
  if (!SCHEMAS.includes(version)) throw problem('UNSUPPORTED_SCHEMA_VERSION', '结构规则版本不受支持。');
  const name = version === 'document-structured-output-v2' ? 'document-structured-output.schema.json' : version + '.schema.json';
  const bytes = fs.readFileSync(path.join(contracts, name));
  return { data: JSON.parse(bytes), digest: crypto.createHash('sha256').update(bytes).digest('hex') };
}
function template(version = 'process-governance-v9') {
  if (!['process-governance-v5', 'process-governance-v6', 'process-governance-v7', 'process-governance-v8', 'process-governance-v9'].includes(version)) {
    throw problem('UNSUPPORTED_SCHEMA_VERSION', '空白模板版本不受支持。');
  }
  const data = version === 'process-governance-v9' ? authoring.createEmptyProcessGovernanceDocument()
    : version === 'process-governance-v5' ? authoring.createEmptyProcessGovernanceV5Document()
    : version === 'process-governance-v6' ? authoring.createEmptyProcessGovernanceV6Document()
    : authoring.createEmptyProcessGovernanceV7Document();
  data.schema_version = version;
  if (data.migration) data.migration.source_schema_version = version;
  return { schema_version: version, schema_digest: schema(version).digest, data };
}
function validate(body) {
  const data = body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw problem('VALIDATION_DATA_REQUIRED', '请提供待检查的JSON对象。');
  const unsafe = authoring.jsonSafetyProblem(data);
  if (unsafe) throw Object.assign(problem(unsafe.code, unsafe.error), { path: unsafe.path });
  if (!SCHEMAS.includes(data.schema_version)) throw problem('UNSUPPORTED_SCHEMA_VERSION', '文件版本不受支持。');
  const profile = body.validation_profile || '';
  if (profile && profile !== 'early-v7-data-fields') throw problem('UNSUPPORTED_VALIDATION_PROFILE', '校验方式不受支持。');
  if (profile && data.schema_version !== 'process-governance-v7') throw problem('VALIDATION_PROFILE_VERSION_MISMATCH', '早期V7校验只能检查V7文件。');
  const copy = JSON.parse(JSON.stringify(data));
  return { ...(data.schema_version === 'document-structured-output-v2'
    ? authoring.contractValidationResult(copy) : authoring.processGovernanceValidationResult(copy, { validationProfile: profile })), data: copy };
}
function enums(departments) {
  const names = [...new Set(departments.map(row => row.name).filter(Boolean))];
  return {
    departments: names.map(department_name => ({ department_name, domain: '' })),
    rosterRolesByDepartment: Object.fromEntries(names.map(name => [name, []])),
    organizationCatalogMode: 'departments_only', organizationCatalogSource: { source: '3000', status: 'current_departments' },
    positionInfo: { status: 'unavailable', message: '部门取自3000有效目录；岗位请按实际业务填写并核对，不代表人员任命或授权。' },
    fieldType: ['文本', '长文本', '数字', '日期', '日期时间', '金额', '枚举', '布尔', '部门', '人员', '文件编号', '签名', '图片', '附件', '二维码']
  };
}
function asset(file) {
  return ASSET_FILES.includes(file) ? path.join(publicRoot, file) : null;
}
module.exports = { schema, template, validate, enums, asset, ASSET_FILES };
