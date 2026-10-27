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
  'mdm_steward',
  'department_contact',
  'department_mdm_reviewer',
  'data_conflict_handler',
  'data_quality_auditor',
  'decision_group',
  'hr_directory_manager'
];

const expectedPermissions = [
  'directory:read',
  'directory:maintain',
  'identity:read',
  'identity:manage-account',
  'identity:assign-role',
  'identity:read-audit',
  'governance:read-global',
  'governance:read-department',
  'governance:read-assigned-context',
  'governance:read-escalated-context',
  'governance:handle-assigned-work',
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
  assert.strictEqual(model.activities.length, 12);
  model.roles.forEach(roleDefinition => {
    assert.ok(Array.isArray(roleDefinition.visibleTabs) && roleDefinition.visibleTabs.length > 0);
  });

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
  assert.deepStrictEqual(role(model, 'mdm_steward').permissions, [
    'governance:read-assigned-context', 'governance:handle-assigned-work'
  ]);
  assert.deepStrictEqual(role(model, 'hr_directory_manager').permissions, [
    'identity:read', 'directory:read', 'directory:maintain'
  ]);
  assert.deepStrictEqual(role(model, 'hr_directory_manager').visibleTabs.map(tab => tab.code), [
    'roleWorkbench', 'orgUnits', 'persons', 'roleGuide'
  ]);
  assert.equal(role(model, 'hr_directory_manager').group, 'directory');
  assert.ok(!admin.permissions.includes('directory:maintain'));

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

  console.log('RBAC/RACI v2 fixed model contract test passed');
}

main();
