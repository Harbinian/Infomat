const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  LEGACY_ROLE_CODES,
  ROLE_GUIDES,
  getAccessModel,
  permissionSetHas
} = require('../server/roleDefinitions');

const rolePermissions = {
  admin: [
    'identity:read',
    'identity:manage-account',
    'identity:assign-role',
    'identity:read-audit',
    'governance:read-global'
  ],
  mdm_lead: [
    'governance:read-global',
    'governance:assign-work',
    'governance:structure-gate',
    'governance:publish',
    'governance:escalate-conflict'
  ],
  department_contact: [
    'governance:read-department',
    'governance:draft-department',
    'governance:submit-department'
  ],
  department_mdm_reviewer: [
    'governance:read-department',
    'governance:review-department',
    'governance:record-department-decision'
  ],
  data_conflict_handler: [
    'governance:read-assigned-context',
    'governance:handle-assigned-conflict',
    'governance:escalate-conflict'
  ],
  data_quality_auditor: [
    'governance:read-global',
    'governance:quality-audit'
  ],
  decision_group: [
    'governance:read-escalated-context',
    'governance:decide-escalation'
  ]
};

function main() {
  const model = getAccessModel();
  assert.strictEqual(ROLE_GUIDES.length, 7);
  assert.deepStrictEqual(model.roles.map(role => role.code), Object.keys(rolePermissions));

  for (const [roleCode, expectedPermissions] of Object.entries(rolePermissions)) {
    const actual = model.roles.find(role => role.code === roleCode);
    assert.ok(actual, `missing fixed role ${roleCode}`);
    assert.deepStrictEqual(actual.permissions, expectedPermissions);
  }

  for (const retired of LEGACY_ROLE_CODES) {
    assert.ok(!model.roles.some(role => role.code === retired), `${retired} must be retired`);
  }

  const adminPermissions = new Set(rolePermissions.admin);
  for (const forbidden of [
    'governance:draft-department',
    'governance:submit-department',
    'governance:review-department',
    'governance:record-department-decision',
    'governance:assign-work',
    'governance:structure-gate',
    'governance:publish',
    'governance:quality-audit',
    'governance:handle-assigned-conflict',
    'governance:decide-escalation'
  ]) {
    assert.strictEqual(permissionSetHas(adminPermissions, forbidden), false, `admin must not receive ${forbidden}`);
  }
  assert.strictEqual(permissionSetHas(adminPermissions, 'admin:access'), false);

  const departmentRoles = new Set(['department_contact', 'department_mdm_reviewer']);
  const repositorySource = fs.readFileSync(
    path.join(__dirname, '../server/governanceAccessMysqlRepository.js'),
    'utf8'
  );
  for (const roleCode of departmentRoles) {
    assert.ok(repositorySource.includes(`'${roleCode}'`));
  }
  assert.ok(repositorySource.includes('ROLE_SCOPE_DEPARTMENT_MISMATCH'));
  assert.ok(repositorySource.includes('LAST_ACTIVE_ADMIN'));
  assert.ok(repositorySource.includes('LAST_ACTIVE_ROLE_REQUIRES_DISABLE'));

  const conflictSource = fs.readFileSync(path.join(__dirname, '../server/routes/conflicts.js'), 'utf8');
  assert.ok(conflictSource.includes("'governance:handle-assigned-conflict'"));
  assert.ok(conflictSource.includes("'governance:decide-escalation'"));
  assert.ok(conflictSource.includes('data_conflict_handler'));
  assert.ok(!conflictSource.includes("'admin:access'"));

  const processSource = fs.readFileSync(path.join(__dirname, '../server/routes/processDesignMysql.js'), 'utf8');
  assert.ok(processSource.includes("'governance:publish'"));
  assert.ok(processSource.includes('RESPONSIBILITY_CHAIN_INCOMPLETE'));
  assert.ok(!processSource.includes("'admin:access'"));

  console.log('Fixed MDM role access contract test passed');
}

main();
