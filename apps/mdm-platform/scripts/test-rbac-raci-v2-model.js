const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  ACCESS_MODEL_VERSION,
  LEGACY_ROLE_CODES,
  getAccessModel,
  permissionSetHas
} = require('../server/roleDefinitions');

const expectedRoles = [
  'admin',
  'mdm_lead',
  'department_contact',
  'department_mdm_reviewer',
  'data_conflict_handler',
  'data_quality_auditor',
  'decision_group'
];

const expectedPermissions = [
  'identity:read',
  'identity:manage-account',
  'identity:assign-role',
  'identity:read-audit',
  'governance:read-global',
  'governance:read-department',
  'governance:read-assigned-context',
  'governance:read-escalated-context',
  'governance:draft-department',
  'governance:submit-department',
  'governance:review-department',
  'governance:record-department-decision',
  'governance:assign-work',
  'governance:structure-gate',
  'governance:publish',
  'governance:quality-audit',
  'governance:handle-assigned-conflict',
  'governance:escalate-conflict',
  'governance:decide-escalation'
];

function role(model, code) {
  return model.roles.find(item => item.code === code);
}

function main() {
  const model = getAccessModel();
  assert.strictEqual(model.modelVersion, ACCESS_MODEL_VERSION);
  assert.deepStrictEqual(model.roles.map(item => item.code), expectedRoles);
  assert.deepStrictEqual(
    model.permissions.map(item => item.code).sort(),
    expectedPermissions.slice().sort()
  );
  assert.strictEqual(model.activities.length, 8);

  for (const legacyRole of LEGACY_ROLE_CODES) {
    assert.ok(!role(model, legacyRole), `${legacyRole} must not appear in the effective model`);
  }

  const admin = role(model, 'admin');
  assert.deepStrictEqual(admin.permissions.slice().sort(), [
    'governance:read-global',
    'identity:assign-role',
    'identity:manage-account',
    'identity:read',
    'identity:read-audit'
  ].sort());
  assert.ok(!admin.permissions.includes('governance:publish'));
  assert.ok(!admin.permissions.includes('governance:review-department'));
  assert.ok(!admin.permissions.includes('governance:draft-department'));

  assert.deepStrictEqual(role(model, 'data_conflict_handler').permissions, [
    'governance:read-assigned-context',
    'governance:handle-assigned-conflict',
    'governance:escalate-conflict'
  ]);
  assert.deepStrictEqual(role(model, 'decision_group').permissions, [
    'governance:read-escalated-context',
    'governance:decide-escalation'
  ]);
  assert.strictEqual(permissionSetHas(new Set(admin.permissions), 'admin:access'), false);
  assert.strictEqual(permissionSetHas(new Set(admin.permissions), 'governance:publish'), false);
  assert.strictEqual(
    permissionSetHas(new Set(['governance:draft-department']), 'mapping:create'),
    true
  );

  const publishActivity = model.activities.find(item => item.activityCode === 'governance.version.publish');
  assert.deepStrictEqual(publishActivity.responsible, ['mdm_lead']);
  assert.deepStrictEqual(publishActivity.accountable, ['mdm_lead']);

  const departmentDecision = model.activities.find(item => item.activityCode === 'department.decision.record');
  assert.deepStrictEqual(departmentDecision.responsible, ['department_mdm_reviewer']);
  assert.deepStrictEqual(departmentDecision.accountable, ['department_final_responsible_person']);

  const schema = fs.readFileSync(path.join(__dirname, '../server/mysqlSchema.js'), 'utf8');
  for (const table of [
    'identity_access_events',
    'governance_decision_records',
    'identity_migration_batches',
    'identity_migration_account_backup',
    'identity_migration_role_backup'
  ]) {
    assert.ok(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must be in MySQL schema`);
  }

  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const rbacSection = html.match(/<!-- Fixed RBAC \/ RACI administration -->([\s\S]*?)<!-- Detail Page/);
  assert.ok(rbacSection, 'fixed RBAC administration section should exist');
  assert.ok(rbacSection[1].includes('账号管理'));
  assert.ok(rbacSection[1].includes('角色与责任'));
  assert.ok(rbacSection[1].includes('访问审计'));
  assert.ok(!rbacSection[1].includes('批量导入'));
  assert.ok(!rbacSection[1].includes('权限矩阵'));
  assert.ok(!html.includes('data-roles='));
  assert.ok(html.includes('data-permissions='));
  assert.ok(!html.includes('注册账号'));

  console.log('RBAC/RACI v2 fixed model contract test passed');
}

main();
