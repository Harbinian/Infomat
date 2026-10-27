// Pure configuration and injected identity-reader checks only. Run with
// blockRealMysql preload and --test; no private config, real DB or publication.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config/department-role-requirements.json');
const { departmentRoleRequirements } = require('../server/departmentRoleRequirements');
const { getAccessModel } = require('../server/roleDefinitions');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { makeGovernanceAccessMysqlRepository } = require('../server/governanceAccessMysqlRepository');

const clone = value => JSON.parse(JSON.stringify(value));
const departmentCodes = ['department_contact', 'department_mdm_reviewer'];
const allCodes = ['admin', 'mdm_lead', 'mdm_steward', ...departmentCodes, 'data_conflict_handler', 'data_quality_auditor', 'decision_group', 'hr_directory_manager'];

test('confirmed departments require the existing two roles without people, identities or grants', () => {
  const beforeConfig = clone(config), beforeModel = getAccessModel();
  const result = departmentRoleRequirements(config);
  assert.equal(result.departments.length, 12);
  assert.equal(new Set(result.departments.map(item => item.name)).size, 12);
  assert.deepEqual(result.departments.map(item => item.name), config.departments.map(item => item.name));
  assert.equal(result.grants_permissions, false);
  assert.equal(result.binds_people, false);
  assert.equal(result.creates_department_records, false);
  for (const item of result.departments) {
    assert.deepEqual([...item.role_codes].sort(), [...departmentCodes].sort());
    assert.equal(item.scope_type, 'department');
    assert.equal(item.binds_people, false);
    assert.deepEqual(Object.keys(item).sort(), ['binds_people', 'name', 'role_codes', 'scope_type']);
  }
  assert.deepEqual(config, beforeConfig);
  assert.deepEqual(getAccessModel(), beforeModel, 'requirements must not change the fixed permission model');
  assert.deepEqual(beforeModel.roles.map(item => item.code), allCodes);
});

test('empty, padded and duplicate department names cannot become a requirement catalog', () => {
  for (const name of ['', ' ', '  合成部门', '合成部门  ', null, 91]) {
    const input = clone(config); input.departments[0].name = name;
    assert.throws(() => departmentRoleRequirements(input));
  }
  const duplicate = clone(config); duplicate.departments[1].name = duplicate.departments[0].name;
  assert.throws(() => departmentRoleRequirements(duplicate));
  for (const departments of [[], null, {}, undefined]) {
    assert.throws(() => departmentRoleRequirements({ ...config, departments }));
  }
});

test('unknown, non-department, missing and repeated role codes are refused', () => {
  for (const codes of [
    ['department_contact', 'unknown_role'],
    ['department_contact', 'admin'],
    ['department_contact', 'mdm_lead'],
    ['department_contact', 'mdm_steward'],
    ['department_contact', 'hr_directory_manager'],
    ['department_contact', 'data_conflict_handler'],
    ['department_contact', 'data_quality_auditor'],
    ['department_contact', 'decision_group'],
    ['department_contact', 'department_contact'],
    ['department_contact'], [], null,
    [...departmentCodes, 'admin']
  ]) {
    const input = clone(config); input.departments[0].role_codes = codes;
    assert.throws(() => departmentRoleRequirements(input));
  }
});

test('configuration and fixed-model versions and source digest must be valid', () => {
  for (const key of ['schema_version', 'access_model_version']) {
    for (const value of ['', 'unsupported-version', null, undefined]) {
      assert.throws(() => departmentRoleRequirements({ ...config, [key]: value }));
    }
  }
  for (const sha256 of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'A'.repeat(64), null]) {
    assert.throws(() => departmentRoleRequirements({ ...config, source: { ...config.source, sha256 } }));
  }
  assert.throws(() => departmentRoleRequirements({ ...config, source: undefined }));
  for (const file_name of ['', 'synthetic.csv', 'C:\\private\\synthetic.xlsx', '/private/synthetic.xlsx', '../synthetic.xlsx', 'https://synthetic.invalid/synthetic.xlsx']) {
    assert.throws(() => departmentRoleRequirements({ ...config, source: { ...config.source, file_name } }));
  }
});

test('permission sets and the seven other roles retain the fixed model', () => {
  const model = getAccessModel(), result = departmentRoleRequirements(config);
  assert.equal(result.model_version, model.modelVersion);
  assert.deepEqual(result.department_roles, model.roles.filter(item => departmentCodes.includes(item.code)));
  assert.deepEqual(result.other_roles, model.roles.filter(item => !departmentCodes.includes(item.code)));
  assert.equal(result.department_roles.length, 2);
  assert.equal(result.other_roles.length, 7);
  const role = code => [...result.department_roles, ...result.other_roles].find(item => item.code === code);
  assert.equal(role('admin').permissions.includes('governance:publish'), false);
  assert.deepEqual(role('data_conflict_handler').permissions, ['governance:read-assigned-context', 'governance:handle-assigned-conflict', 'governance:escalate-conflict']);
  assert.deepEqual(role('decision_group').permissions, ['governance:read-escalated-context', 'governance:decide-escalation']);
  const poisoned = clone(config);
  poisoned.departments[0].permissions = ['governance:publish'];
  assert.deepEqual(departmentRoleRequirements(poisoned).department_roles, result.department_roles);
});

test('response excludes supplied people, positions and local paths while retaining source provenance', () => {
  const input = clone(config), marker = 'SYNTHETIC_PRIVATE_METADATA';
  input.person_id = marker; input.employee_no = marker; input.position = marker; input.local_path = marker;
  Object.assign(input.source, { absolute_path: marker, person_name: marker, position_name: marker });
  Object.assign(input.departments[0], { person_id: marker, person_name: marker, employee_no: marker, position_id: marker, position_name: marker, source_path: marker });
  const result = departmentRoleRequirements(input);
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.deepEqual(result.source, config.source);
  assert.equal(/[\\/]/.test(result.source.file_name), false, 'published source metadata must be a filename, not a local path');
  assert.deepEqual(Object.keys(result.source).sort(), ['confirmed_date', 'file_name', 'sha256']);
});

test('requirements never supply default roles or permissions to an unassigned identity', async () => {
  const queries = [], reader = { async execute(sql) { queries.push(sql); return [[]]; } };
  const identity = makeIdentityMysqlRepository(reader);
  const before = await identity.getUserEffectivePermissions(91);
  assert.equal(before.permSet.size, 0);
  departmentRoleRequirements(config);
  assert.deepEqual(await identity.getUserRoleCodes(91), []);
  const after = await identity.getUserEffectivePermissions(91);
  assert.equal(after.permSet.size, 0);
  assert(queries.every(sql => /^\s*SELECT\b/i.test(sql)), 'the empty identity stays read-only');
  const repo = makeGovernanceAccessMysqlRepository({ async getConnection() { throw new Error('UNEXPECTED_TRANSACTION'); } });
  await assert.rejects(repo.createAccount({
    loginName: 'synthetic', employeeNo: 'synthetic', name: 'synthetic', departmentId: 91,
    pendingPasswordHash: 'synthetic-unused', roleAssignments: []
  }), { code: 'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED' });
});
