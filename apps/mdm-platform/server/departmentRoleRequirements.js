// Organization role requirements never grant permissions or create identities.
// Names and permission descriptions remain owned by the existing fixed model.
const { getAccessModel } = require('./roleDefinitions');

const DEPARTMENT_ROLES = ['department_contact', 'department_mdm_reviewer'];

function departmentRoleRequirements(config) {
  const model = getAccessModel();
  if (config?.schema_version !== 'department-role-requirements-v1' ||
      config.access_model_version !== model.modelVersion ||
      !/^[a-f0-9]{64}$/.test(config.source?.sha256 || '') ||
      typeof config.source?.file_name !== 'string' || !/^[^/\\]+\.xlsx$/i.test(config.source.file_name) ||
      !Array.isArray(config.departments) || !config.departments.length) {
    throw new Error('部门角色配置及其来源不完整');
  }
  const names = new Set();
  const departments = config.departments.map(department => {
    const name = department.name;
    if (typeof name !== 'string' || !name.trim() || name !== name.trim() || names.has(name) ||
        !Array.isArray(department.role_codes) || department.role_codes.length !== DEPARTMENT_ROLES.length ||
        new Set(department.role_codes).size !== DEPARTMENT_ROLES.length ||
        department.role_codes.some(code => !DEPARTMENT_ROLES.includes(code))) {
      throw new Error('部门名称或必要角色不符合固定模型');
    }
    names.add(name);
    return { name, scope_type: 'department', role_codes: [...department.role_codes], binds_people: false };
  });
  return {
    schema_version: config.schema_version, model_version: model.modelVersion,
    source: { file_name: config.source.file_name, sha256: config.source.sha256, confirmed_date: config.source.confirmed_date },
    departments,
    department_roles: model.roles.filter(role => DEPARTMENT_ROLES.includes(role.code)),
    other_roles: model.roles.filter(role => !DEPARTMENT_ROLES.includes(role.code)),
    grants_permissions: false, binds_people: false, creates_department_records: false
  };
}

module.exports = { departmentRoleRequirements };
