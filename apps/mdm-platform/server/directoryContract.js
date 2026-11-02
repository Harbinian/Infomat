const crypto = require('node:crypto');
const { identityInteger, sameIdentityInteger } = require('./sessionSubject');
const { normalizePublication, failure } = require('./publicationSpreadsheet');
const { directoryChangeReason } = require('./publicationRepository');

const SCHEMA_VERSION = 'organization-person-directory-v1';
const FIELDS = Object.freeze({
  department: ['code', 'name', 'parent_id', 'department_type', 'status'],
  person: ['employee_no', 'person_name', 'current_department_id', 'employment_status', 'mobile', 'email', 'office_ids'],
  office: ['code', 'name', 'department_id', 'manager_person_id', 'status']
});
const key = value => String(value || '').trim().toLowerCase();
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error = (message, code = 'DIRECTORY_INPUT_INVALID', status = 422) => Object.assign(failure(message, code), {statusCode:status});
function id(value, optional = false) {
  if (optional && (value === null || value === '')) return null;
  const result = identityInteger(value);
  if (result === null) throw error('目录标识无效');
  return String(result);
}
function normalizeChange(input) {
  if (!input || !FIELDS[input.entity] || !['create', 'update'].includes(input.operation)) throw error('请选择有效的目录对象和创建或修改操作');
  if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values)) throw error('缺少明确的单条目录信息');
  const unknown = Object.keys(input.values).filter(field => !FIELDS[input.entity].includes(field));
  if (unknown.length) throw error('目录请求包含不支持的字段：' + unknown.join('、'));
  if (input.operation === 'create' && input.id != null) throw error('新增目录记录不能指定已有标识');
  const values = {};
  for (const field of FIELDS[input.entity]) {
    if (!Object.prototype.hasOwnProperty.call(input.values, field)) continue;
    const value = input.values[field];
    if (field === 'office_ids') {
      if (!Array.isArray(value)) throw error('办公室标识必须是数组');
      values[field] = value.map(item => id(item)).sort((a,b) => BigInt(a) < BigInt(b) ? -1 : 1);
      if (new Set(values[field]).size !== values[field].length) throw error('办公室标识重复');
    } else if (field.endsWith('_id')) values[field] = id(value, ['parent_id','manager_person_id'].includes(field));
    else {
      if (typeof value !== 'string' && value !== null) throw error('目录文字字段必须是字符串');
      values[field] = String(value ?? '').trim();
      if (field === 'status' && !['active','inactive','archived'].includes(values[field])) throw error('目录状态无效');
      if (field === 'employment_status' && !['active','leave','suspended','inactive'].includes(values[field])) throw error('在职状态无效');
    }
  }
  const expected = String(input.expected_snapshot_hash || '');
  if (!/^[0-9a-f]{64}$/.test(expected)) throw error('请先读取当前目录再办理', 'DIRECTORY_SNAPSHOT_REQUIRED');
  return {entity:input.entity, operation:input.operation, id:input.operation === 'update' ? id(input.id) : null,
    values, reason:directoryChangeReason(input.reason), expected_snapshot_hash:expected};
}

function rowFor(snapshot, entity, targetId) {
  const rows = snapshot[entity === 'person' ? 'persons' : entity === 'department' ? 'departments' : 'offices'];
  return rows.find(row => sameIdentityInteger(entity === 'person' ? row.person_id : row.id, targetId)) || null;
}

// Stable IDs select existing records. Display names never select update targets.
function prepareChange(snapshot, input) {
  const change = normalizeChange(input);
  const existing = change.id ? rowFor(snapshot, change.entity, change.id) : null;
  if (change.id && !existing) throw error('目标目录记录已不存在，请刷新', 'DIRECTORY_TARGET_CHANGED', 409);
  const codeField = change.entity === 'person' ? 'employee_no' : 'code';
  if (existing && Object.prototype.hasOwnProperty.call(change.values,codeField) && change.values[codeField] !== existing[codeField]) {
    throw error('已有工号或组织编码不能通过普通修改变更', 'DIRECTORY_STABLE_KEY_REQUIRED');
  }
  const values = {...existing, ...change.values};
  if (!existing) {
    const rows = change.entity === 'person' ? snapshot.persons : [...snapshot.departments, ...snapshot.offices];
    if (rows.some(row => key(row[codeField]) === key(values[codeField]))) throw error('工号或组织编码已经存在，请选择现有记录修改', 'DIRECTORY_DUPLICATE_KEY', 409);
  }
  const department = targetId => {
    const result = snapshot.departments.find(row => sameIdentityInteger(row.id,targetId));
    if (!result || result.status !== 'active') throw error('所属或上级部门不存在或未启用', 'DIRECTORY_ACTIVE_DEPARTMENT_REQUIRED');
    return result;
  };
  let kind, record;
  if (change.entity === 'person') {
    const dep = department(values.current_department_id);
    const officeIds = values.office_ids || [];
    const codes = officeIds.map(targetId => {
      const office = snapshot.offices.find(row => sameIdentityInteger(row.id,targetId));
      if (!office || office.status !== 'active') throw error('办公室不存在或未启用');
      return office.code;
    });
    kind = 'roster';
    record = {employee_no:values.employee_no,person_name:values.person_name,department_code:dep.code,
      employment_status:values.employment_status || 'active',office_codes:codes.join(';'),mobile:values.mobile || '',email:values.email || ''};
    if (existing && (record.employment_status !== 'active' || !sameIdentityInteger(existing.current_department_id,dep.id))) {
      if (snapshot.departments.some(row => sameIdentityInteger(row.final_responsible_person_id,existing.person_id) || sameIdentityInteger(row.data_owner_person_id,existing.person_id))) {
        throw error('此人员仍有部门负责人或数据负责人职责，请先办理职责调整', 'DIRECTORY_RESPONSIBILITY_IN_USE');
      }
    }
  } else if (change.entity === 'department') {
    kind = 'organization';
    const parent = values.parent_id ? department(values.parent_id) : null;
    record = {unit_type:'department',code:values.code,name:values.name,parent_code:parent?.code || '',department_type:values.department_type || '',status:values.status || 'active'};
    if (existing && record.status !== 'active' && snapshot.departments.some(row => sameIdentityInteger(row.parent_id,existing.id) && row.status === 'active')) {
      throw error('部门仍有启用的下级部门，请先调整下级部门', 'DIRECTORY_CHILD_DEPARTMENT_IN_USE');
    }
  } else {
    kind = 'organization';
    const dep = department(values.department_id);
    const manager = values.manager_person_id ? snapshot.persons.find(row => sameIdentityInteger(row.person_id,values.manager_person_id)) : null;
    if (values.manager_person_id && !manager) throw error('办公室负责人不存在');
    record = {unit_type:'office',code:values.code,name:values.name,owning_department_code:dep.code,manager_employee_no:manager?.employee_no || '',status:values.status || 'active'};
  }
  const headers = Object.keys(record), mapping = Object.fromEntries(headers.map(field => [field,field]));
  const normalized = normalizePublication({kind,title:change.entity === 'person' ? '人员目录直接维护' : '组织目录直接维护',sourceFileName:'directory-change.json',headers,rows:[headers.map(field => record[field] ?? '')],mapping});
  return {change, existing, normalized, requestHash:hash(change)};
}

module.exports = {SCHEMA_VERSION,FIELDS,hash,error,id,normalizeChange,rowFor,prepareChange};
