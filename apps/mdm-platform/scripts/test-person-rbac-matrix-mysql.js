const assert = require('assert');
const { ROLE_GUIDES } = require('../server/roleDefinitions');

function permissionCode(permission) {
  return permission && (permission.code || permission[0]);
}

const requiredPermissions = [
  'rbac:manage',
  'account:manage',
  'person:manage',
  'position:manage',
  'process_governance:view_global',
  'process_governance:view_department',
  'process_governance:submit',
  'process_governance:review',
  'guidance:create',
  'guidance:respond',
  'guidance:delegate',
  'guidance:final_confirm',
  'major_change:advise'
];

const projectRoles = new Set([
  'it_lead',
  'project_lead',
  'workgroup_lead',
  'business_contact',
  'data_quality',
  'decision_group'
]);
const dangerousPermissions = new Set(['rbac:manage', 'account:manage', 'person:manage', 'position:manage']);

const allPermissionCodes = new Set(
  ROLE_GUIDES.flatMap(role => (role.permissions || []).map(permissionCode))
);

for (const permission of requiredPermissions) {
  assert.ok(allPermissionCodes.has(permission), `built-in permission missing: ${permission}`);
}

for (const role of ROLE_GUIDES.filter(role => projectRoles.has(role.code))) {
  const rolePermissionCodes = new Set((role.permissions || []).map(permissionCode));
  for (const permission of dangerousPermissions) {
    assert.ok(!rolePermissionCodes.has(permission), `${role.code} must not receive dangerous permission ${permission}`);
  }
}

const admin = ROLE_GUIDES.find(role => role.code === 'admin');
assert.ok(admin, 'admin role guide must exist');
const adminPermissions = new Set((admin.permissions || []).map(permissionCode));
for (const permission of dangerousPermissions) {
  assert.ok(adminPermissions.has(permission), `admin should own system maintenance permission ${permission}`);
}

const decision = ROLE_GUIDES.find(role => role.code === 'decision_group');
assert.ok(decision, 'decision_group role guide must exist');
const decisionPermissions = new Set((decision.permissions || []).map(permissionCode));
assert.ok(decisionPermissions.has('process_governance:view_global'), 'decision_group can read global process governance material');
assert.ok(decisionPermissions.has('guidance:create'), 'decision_group can create guidance');
assert.ok(decisionPermissions.has('major_change:advise'), 'decision_group can advise major changes');
assert.ok(!decisionPermissions.has('guidance:respond'), 'decision_group must not respond for responsible department');
assert.ok(!decisionPermissions.has('guidance:final_confirm'), 'decision_group must not close department responsibility');

console.log('Person RBAC matrix MySQL contract test passed');
