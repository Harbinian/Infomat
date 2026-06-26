# MDM Person Identity RBAC Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the first-round MySQL target state for MDM person identity, RBAC, department responsibility, management guidance workflow, and frontend operation controls.

**Architecture:** Keep `person` as the runtime identity and keep `user_accounts` as login-only credentials. Treat old `users` and `*_user_id` paths as migration compatibility only during this round, while adding person-based MySQL columns, repository helpers, permission seeds, workflow events, and backend affordance checks. Do not modify `docs/norms/`, PMO assets, or process truth sources.

**Tech Stack:** Node.js, Express, MySQL via `mysql2`, single-file frontend in `apps/mdm-platform/public/index.html`, script-based tests under `apps/mdm-platform/scripts/`.

---

## Scope And Boundaries

- Primary implementation directory: `apps/mdm-platform/`.
- Planning artifact directory: `docs/superpowers/plans/`.
- Do not change `docs/norms/`, `pmo/`, `docs/company-sankey-data.json`, or PMO generated assets.
- Do not delete SQLite legacy code in this round. Do not add new SQLite identity/RBAC features.
- Keep `users`, `user_roles`, and old `*_user_id` fields only as migration compatibility aliases until the second-round SQLite and legacy identity cleanup.
- New MySQL tests must not depend on SQLite as the identity or RBAC truth source.

## File Map

- Modify: `apps/mdm-platform/package.json`
  - Add focused test scripts for RBAC matrix, person responsibility migration, guidance workflow, and frontend controls.
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
  - Add missing person-based columns and guidance event tables.
  - Keep legacy user columns during this round, but stop using them as target write fields.
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
  - Add MySQL role/permission seed helpers.
  - Add position/data scope payload reads.
  - Add migration helpers that copy legacy user-based responsibility fields into person-based columns.
- Modify: `apps/mdm-platform/server/roleDefinitions.js`
  - Expand built-in permissions, dangerous flags, default scopes, protected-core metadata, and role groups.
- Modify: `apps/mdm-platform/server/governanceGuidanceMysqlRepository.js`
  - Implement guidance state machine, delegation checks, event recording, and response/final-confirm rules.
- Modify: `apps/mdm-platform/server/routes/governanceGuidance.js`
  - Add action endpoints for respond, clarify, object, assign executor, delegate, and final confirm.
- Modify: `apps/mdm-platform/server/routes/org.js`
  - Keep person-based session and admin assignment semantics.
  - Expose `/api/org/me` fields as target contract.
- Modify: `apps/mdm-platform/public/index.html`
  - Drive guidance action visibility from backend affordances and local permission state.
- Create: `apps/mdm-platform/scripts/test-person-rbac-matrix-mysql.js`
  - Locks MySQL permission metadata and protected role behavior.
- Create: `apps/mdm-platform/scripts/test-department-responsibility-mysql.js`
  - Locks person-based department responsibility migration and company-leader exclusion.
- Create: `apps/mdm-platform/scripts/test-person-identity-payload-mysql.js`
  - Locks `/api/org/me` person, account, positions, roles, permissions, and data scopes.
- Create: `apps/mdm-platform/scripts/test-guidance-workflow-mysql-api.js`
  - Locks guidance state machine, final responsible response, delegation, and admin limitation.
- Create: `apps/mdm-platform/scripts/test-person-operation-controls-frontend.js`
  - Locks frontend permissions, state-based disabled reasons, and responsibility labels.
- Create: `apps/mdm-platform/scripts/test-no-new-user-identity-fields.js`
  - Static guard preventing new target MySQL identity writes from introducing fresh `users.id` foreign-key semantics.

---

### Task 1: RBAC Matrix Seed And Protected Core

**Files:**
- Modify: `apps/mdm-platform/package.json`
- Modify: `apps/mdm-platform/server/roleDefinitions.js`
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
- Create: `apps/mdm-platform/scripts/test-person-rbac-matrix-mysql.js`

- [ ] **Step 1: Write the failing RBAC matrix test**

Create `apps/mdm-platform/scripts/test-person-rbac-matrix-mysql.js` with assertions for these exact contracts:

```js
const assert = require('assert');
const { ROLE_GUIDES } = require('../server/roleDefinitions');

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

const projectRoles = new Set(['it_lead', 'project_lead', 'workgroup_lead', 'business_contact', 'data_quality', 'decision_group']);
const dangerousPermissions = new Set(['rbac:manage', 'account:manage', 'person:manage', 'position:manage']);

const allPermissionCodes = new Set(
  ROLE_GUIDES.flatMap(role => (role.permissions || []).map(permission => permission.code || permission[0]))
);

for (const permission of requiredPermissions) {
  assert.ok(allPermissionCodes.has(permission), `built-in permission missing: ${permission}`);
}

for (const role of ROLE_GUIDES.filter(role => projectRoles.has(role.code))) {
  const rolePermissionCodes = new Set((role.permissions || []).map(permission => permission.code || permission[0]));
  for (const permission of dangerousPermissions) {
    assert.ok(!rolePermissionCodes.has(permission), `${role.code} must not receive dangerous permission ${permission}`);
  }
}

const admin = ROLE_GUIDES.find(role => role.code === 'admin');
assert.ok(admin, 'admin role guide must exist');
const adminPermissions = new Set((admin.permissions || []).map(permission => permission.code || permission[0]));
for (const permission of dangerousPermissions) {
  assert.ok(adminPermissions.has(permission), `admin should own system maintenance permission ${permission}`);
}

const decision = ROLE_GUIDES.find(role => role.code === 'decision_group');
const decisionPermissions = new Set((decision.permissions || []).map(permission => permission.code || permission[0]));
assert.ok(decisionPermissions.has('process_governance:view_global'), 'decision_group can read global process governance material');
assert.ok(decisionPermissions.has('guidance:create'), 'decision_group can create guidance');
assert.ok(decisionPermissions.has('major_change:advise'), 'decision_group can advise major changes');
assert.ok(!decisionPermissions.has('guidance:respond'), 'decision_group must not respond for responsible department');
assert.ok(!decisionPermissions.has('guidance:final_confirm'), 'decision_group must not close department responsibility');

console.log('Person RBAC matrix MySQL contract test passed');
```

- [ ] **Step 2: Add the test script and verify it fails**

Modify `apps/mdm-platform/package.json`:

```json
"test:person-rbac-matrix": "node scripts/test-person-rbac-matrix-mysql.js"
```

Run:

```powershell
cd apps/mdm-platform
npm run test:person-rbac-matrix
```

Expected before implementation: FAIL with missing permission metadata such as `rbac:manage` or `guidance:respond`.

- [ ] **Step 3: Expand permission definitions**

In `apps/mdm-platform/server/roleDefinitions.js`, change `BASE_PERMISSIONS` entries to object-shaped records while preserving compatibility with existing tuple reads:

```js
const BASE_PERMISSIONS = {
  rbacManage: { code: 'rbac:manage', resource: 'rbac', action: 'manage', description: '维护角色与权限', isDangerous: true, defaultScope: 'global', protectedCore: true },
  accountManage: { code: 'account:manage', resource: 'account', action: 'manage', description: '维护登录账号', isDangerous: true, defaultScope: 'global', protectedCore: true },
  personManage: { code: 'person:manage', resource: 'person', action: 'manage', description: '维护人员主数据', isDangerous: true, defaultScope: 'global', protectedCore: true },
  positionManage: { code: 'position:manage', resource: 'position', action: 'manage', description: '维护岗位任职', isDangerous: true, defaultScope: 'global', protectedCore: true },
  processGovernanceViewGlobal: { code: 'process_governance:view_global', resource: 'process_governance', action: 'view_global', description: '查看全局流程治理材料', isDangerous: false, defaultScope: 'global', protectedCore: true },
  processGovernanceViewDepartment: { code: 'process_governance:view_department', resource: 'process_governance', action: 'view_department', description: '查看本部门流程治理材料', isDangerous: false, defaultScope: 'department', protectedCore: true },
  processGovernanceSubmit: { code: 'process_governance:submit', resource: 'process_governance', action: 'submit', description: '提交流程治理材料', isDangerous: false, defaultScope: 'department', protectedCore: true },
  processGovernanceReview: { code: 'process_governance:review', resource: 'process_governance', action: 'review', description: '复核流程治理材料', isDangerous: false, defaultScope: 'department', protectedCore: true },
  guidanceCreate: { code: 'guidance:create', resource: 'guidance', action: 'create', description: '形成管理层指导意见', isDangerous: false, defaultScope: 'global', protectedCore: true },
  guidanceRespond: { code: 'guidance:respond', resource: 'guidance', action: 'respond', description: '响应本部门指导意见', isDangerous: false, defaultScope: 'department', protectedCore: true },
  guidanceDelegate: { code: 'guidance:delegate', resource: 'guidance', action: 'delegate', description: '维护指导意见响应代理授权', isDangerous: true, defaultScope: 'department', protectedCore: true },
  guidanceFinalConfirm: { code: 'guidance:final_confirm', resource: 'guidance', action: 'final_confirm', description: '确认重大指导意见闭环', isDangerous: true, defaultScope: 'department', protectedCore: true },
  majorChangeAdvise: { code: 'major_change:advise', resource: 'major_change', action: 'advise', description: '提出重大变更建议', isDangerous: false, defaultScope: 'global', protectedCore: true }
};
```

Keep existing non-listed permissions by converting them to the same object shape with explicit `isDangerous`, `defaultScope`, and `protectedCore` values.

- [ ] **Step 4: Assign roles conservatively**

Update `ROLE_GUIDES`:

- `decision_group`: keep `process_governance:view_global`, `guidance:create`, and `major_change:advise`; do not grant `guidance:respond`, `guidance:delegate`, `guidance:final_confirm`, `rbac:manage`, `account:manage`, `person:manage`, or `position:manage`.
- `owner`: grant `guidance:respond`.
- `reviewer`: grant `process_governance:review`.
- `admin`: grant `rbac:manage`, `account:manage`, `person:manage`, `position:manage`, and global read permissions; do not grant `guidance:respond` or `guidance:final_confirm` merely because it is admin.

- [ ] **Step 5: Seed metadata in MySQL**

In `apps/mdm-platform/server/identityMysqlRepository.js`, add an `ensureMysqlBuiltInRolesAndPermissions(pool)` helper and call it from `initSchema()` after DDL and before migration:

```js
async function ensureMysqlBuiltInRolesAndPermissions(pool) {
  for (const role of ROLE_GUIDES) {
    await pool.execute(`
      INSERT INTO roles (role_code, role_name, description, is_system, role_group, protected_core)
      VALUES (?, ?, ?, 1, ?, 1)
      ON DUPLICATE KEY UPDATE
        role_name=VALUES(role_name),
        description=VALUES(description),
        is_system=1,
        role_group=VALUES(role_group),
        protected_core=1,
        updated_at=CURRENT_TIMESTAMP
    `, [role.code, role.name, role.description || null, role.group || 'basic']);

    for (const permission of role.permissions || []) {
      await pool.execute(`
        INSERT INTO permissions (perm_code, resource, action, description, is_dangerous, default_scope, protected_core)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          resource=VALUES(resource),
          action=VALUES(action),
          description=VALUES(description),
          is_dangerous=VALUES(is_dangerous),
          default_scope=VALUES(default_scope),
          protected_core=VALUES(protected_core)
      `, [
        permission.code,
        permission.resource,
        permission.action,
        permission.description,
        permission.isDangerous ? 1 : 0,
        permission.defaultScope || 'self_task',
        permission.protectedCore ? 1 : 0
      ]);

      await pool.execute(`
        INSERT IGNORE INTO role_permissions (role_id, perm_id, effect)
        SELECT r.role_id, p.perm_id, 'allow'
        FROM roles r
        JOIN permissions p ON p.perm_code=?
        WHERE r.role_code=?
      `, [permission.code, role.code]);
    }
  }
}
```

- [ ] **Step 6: Run RBAC tests**

Run:

```powershell
cd apps/mdm-platform
npm run test:person-rbac-matrix
npm run test:identity-mysql
npm run test:roles-mysql
```

Expected after implementation: all pass.

- [ ] **Step 7: Commit task checkpoint**

After tests pass and only intended files changed:

```powershell
git add apps/mdm-platform/package.json apps/mdm-platform/server/roleDefinitions.js apps/mdm-platform/server/identityMysqlRepository.js apps/mdm-platform/scripts/test-person-rbac-matrix-mysql.js
git commit -m "feat(mdm): harden person RBAC permission matrix"
```

---

### Task 2: Person Identity Payload, Positions, And Data Scopes

**Files:**
- Modify: `apps/mdm-platform/package.json`
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
- Modify: `apps/mdm-platform/server/routes/org.js`
- Create: `apps/mdm-platform/scripts/test-person-identity-payload-mysql.js`

- [ ] **Step 1: Write failing payload test**

Create `apps/mdm-platform/scripts/test-person-identity-payload-mysql.js` with assertions that `getCurrentUserPayload()` returns these target fields:

```js
const assert = require('assert');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');

function makePool() {
  const state = { statements: [] };
  return {
    state,
    async execute(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      state.statements.push({ sql: normalized, params });

      if (normalized.includes('FROM person p') && normalized.includes('WHERE p.person_id=?')) {
        return [[{
          person_id: 501,
          account_id: 9001,
          employee_no: 'A001',
          person_name: '池炳辉',
          current_department_id: 20,
          department_name: '工程技术部',
          login_name: 'A001',
          account_status: 'active',
          status: 'active'
        }], undefined];
      }

      if (normalized.includes('FROM person_position_assignment')) {
        return [[{
          position_id: 7,
          position_code: 'ENG_RESP',
          position_name: '工程技术部最终响应责任人',
          department_admin_level: 2,
          department_admin_title: '部门级负责人',
          responsibility_scope: '本部门流程治理响应'
        }], undefined];
      }

      if (normalized.includes('SELECT r.role_code as code')) {
        return [[{ code: 'owner', name: '业务负责人' }, { code: 'data_quality', name: '数据质量员' }], undefined];
      }

      if (normalized === 'SELECT role_id FROM person_roles WHERE person_id=?') {
        return [[{ role_id: 1 }, { role_id: 2 }], undefined];
      }

      if (normalized === 'SELECT parent_role_id FROM roles WHERE role_id=?') {
        return [[{ parent_role_id: null }], undefined];
      }

      if (normalized.includes('FROM role_permissions rp JOIN permissions p')) {
        return [[
          { perm_code: 'process_governance:view_department', effect: 'allow', field_constraints: null },
          { perm_code: 'guidance:respond', effect: 'allow', field_constraints: null }
        ], undefined];
      }

      throw new Error(`Unhandled SQL: ${normalized}`);
    }
  };
}

(async () => {
  const pool = makePool();
  const repo = makeIdentityMysqlRepository(pool);
  const payload = await repo.getCurrentUserPayload({ personId: 501, accountId: 9001, userRole: 'owner' });

  assert.strictEqual(payload.id, 501);
  assert.strictEqual(payload.personId, 501);
  assert.strictEqual(payload.accountId, 9001);
  assert.strictEqual(payload.employeeNo, 'A001');
  assert.strictEqual(payload.personName, '池炳辉');
  assert.strictEqual(payload.departmentId, 20);
  assert.strictEqual(payload.departmentName, '工程技术部');
  assert.deepStrictEqual(payload.roleCodes, ['owner', 'data_quality']);
  assert.ok(payload.permissions.includes('guidance:respond'));
  assert.strictEqual(payload.positions[0].positionCode, 'ENG_RESP');
  assert.deepStrictEqual(payload.dataScopes, ['department:20']);

  console.log('Person identity payload MySQL test passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add script and run red**

Modify `apps/mdm-platform/package.json`:

```json
"test:person-identity-payload": "node scripts/test-person-identity-payload-mysql.js"
```

Run:

```powershell
cd apps/mdm-platform
npm run test:person-identity-payload
```

Expected before implementation: FAIL because `positions` and `dataScopes` are currently empty.

- [ ] **Step 3: Implement position reads**

In `apps/mdm-platform/server/identityMysqlRepository.js`, add:

```js
async function listPersonPositions(personId) {
  try {
    const positionRows = await rows(pool, `
      SELECT p.position_id, p.position_code, p.position_name,
             p.department_admin_level, p.department_admin_title, p.responsibility_scope
      FROM person_position_assignment ppa
      JOIN position p ON ppa.position_id = p.position_id
      WHERE ppa.person_id=?
        AND ppa.status='active'
      ORDER BY p.department_admin_level IS NULL, p.department_admin_level, p.position_name
    `, [personId]);
    return positionRows.map(row => ({
      positionId: row.position_id,
      positionCode: row.position_code,
      positionName: row.position_name,
      departmentAdminLevel: row.department_admin_level,
      departmentAdminTitle: row.department_admin_title,
      responsibilityScope: row.responsibility_scope
    }));
  } catch (error) {
    if (!shouldFallbackFromPersonIdentity(error)) throw error;
    return [];
  }
}
```

- [ ] **Step 4: Implement data scopes**

Add:

```js
function deriveDataScopes(user, permissions = []) {
  const scopes = new Set();
  if (permissions.includes('*:*') || permissions.includes('process_governance:view_global') || permissions.includes('data:view_all')) {
    scopes.add('global');
  }
  if (user.department_id) scopes.add(`department:${user.department_id}`);
  scopes.add(`person:${user.personId}`);
  return Array.from(scopes);
}
```

Call `listPersonPositions(user.personId)` and `deriveDataScopes(user, Array.from(permSet))` inside `getCurrentUserPayload()`.

- [ ] **Step 5: Ensure org route preserves payload**

In `apps/mdm-platform/server/routes/org.js`, keep `/api/org/me` and `/api/org/session` returning `personId`, `accountId`, `employeeNo`, `positions`, `rbacRoles`, `roleCodes`, `permissions`, and `dataScopes` from the repository payload without dropping fields.

- [ ] **Step 6: Run payload and org tests**

Run:

```powershell
cd apps/mdm-platform
npm run test:person-identity-payload
npm run test:identity-mysql
npm run test:role-workbench-mysql
```

Expected after implementation: all pass.

- [ ] **Step 7: Commit task checkpoint**

```powershell
git add apps/mdm-platform/package.json apps/mdm-platform/server/identityMysqlRepository.js apps/mdm-platform/server/routes/org.js apps/mdm-platform/scripts/test-person-identity-payload-mysql.js
git commit -m "feat(mdm): complete person identity payload contract"
```

---

### Task 3: Department Responsibility And Person-Based Business Fields

**Files:**
- Modify: `apps/mdm-platform/package.json`
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
- Modify: selected MySQL repositories that currently write user-semantic fields:
  - `apps/mdm-platform/server/processGovernanceMysqlRepository.js`
  - `apps/mdm-platform/server/dataMapMysqlRepository.js`
  - `apps/mdm-platform/server/conflictMysqlRepository.js`
- Create: `apps/mdm-platform/scripts/test-department-responsibility-mysql.js`
- Create: `apps/mdm-platform/scripts/test-no-new-user-identity-fields.js`

- [ ] **Step 1: Write department responsibility test**

Create `apps/mdm-platform/scripts/test-department-responsibility-mysql.js` covering:

```js
const assert = require('assert');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');

function makePool() {
  const state = {
    departments: [
      { id: 20, name: '工程技术部', manager_user_id: 1, data_owner_user_id: 1, final_responsible_person_id: null, data_owner_person_id: null },
      { id: 21, name: '公司领导', manager_user_id: 9, data_owner_user_id: 9, final_responsible_person_id: null, data_owner_person_id: null }
    ],
    users: [
      { id: 1, name: '池炳辉', employee_no: 'A001', department_id: 20, role: 'owner', password_hash: 'hash', must_change_password: 0, created_at: '2026-06-01' },
      { id: 9, name: '总经理', employee_no: 'LEADER001', department_id: 21, role: 'owner', password_hash: 'hash', must_change_password: 0, created_at: '2026-06-01' }
    ],
    persons: [{ person_id: 501, employee_no: 'A001', person_name: '池炳辉', current_department_id: 20 }]
  };

  return {
    state,
    async execute(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('ALTER TABLE')) return [[], undefined];
      if (normalized.startsWith('INSERT INTO person')) return [{ affectedRows: 0 }, undefined];
      if (normalized.startsWith('INSERT INTO user_accounts')) return [{ affectedRows: 0 }, undefined];
      if (normalized.startsWith('INSERT IGNORE INTO person_roles')) return [{ affectedRows: 0 }, undefined];
      if (normalized.startsWith('UPDATE departments d JOIN person p ON p.person_name=?')) {
        const [personName, departmentName] = params;
        const person = state.persons.find(row => row.person_name === personName);
        const department = state.departments.find(row => row.name === departmentName);
        if (person && department && departmentName !== '公司领导') department.final_responsible_person_id = person.person_id;
        return [{ affectedRows: person && department ? 1 : 0 }, undefined];
      }
      throw new Error(`Unhandled SQL: ${normalized}`);
    }
  };
}

(async () => {
  const pool = makePool();
  await makeIdentityMysqlRepository(pool).initSchema();
  assert.strictEqual(pool.state.departments.find(row => row.name === '工程技术部').final_responsible_person_id, 501);
  assert.strictEqual(pool.state.departments.find(row => row.name === '公司领导').final_responsible_person_id, null);
  console.log('Department responsibility MySQL test passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Write static no-new-user-field guard**

Create `apps/mdm-platform/scripts/test-no-new-user-identity-fields.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'server', 'mysqlSchema.js');
const schema = fs.readFileSync(schemaPath, 'utf8');

const allowedLegacyFields = [
  'manager_user_id',
  'data_owner_user_id',
  'user_id BIGINT NOT NULL',
  'assigned_by BIGINT NULL'
];

const targetPersonFields = [
  'owner_person_id BIGINT NULL',
  'actor_person_id BIGINT NULL',
  'assignee_person_id BIGINT',
  'submitted_by_person_id BIGINT NULL',
  'reviewed_by_person_id BIGINT NULL',
  'created_by_person_id BIGINT',
  'updated_by_person_id BIGINT',
  'operator_person_id BIGINT NULL'
];

for (const field of targetPersonFields) {
  assert.ok(schema.includes(field), `target schema missing person field: ${field}`);
}

assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS user_roles'), 'legacy user_roles may remain only as compatibility in round one');
for (const field of allowedLegacyFields) assert.ok(schema.includes(field), `legacy compatibility field missing unexpectedly: ${field}`);

console.log('No-new-user identity field guard passed');
```

- [ ] **Step 3: Add scripts and run red**

Modify `apps/mdm-platform/package.json`:

```json
"test:department-responsibility": "node scripts/test-department-responsibility-mysql.js",
"test:no-new-user-identity-fields": "node scripts/test-no-new-user-identity-fields.js"
```

Run:

```powershell
cd apps/mdm-platform
npm run test:department-responsibility
npm run test:no-new-user-identity-fields
```

Expected before implementation: static guard fails until person-based aliases are added.

- [ ] **Step 4: Add person-based MySQL columns**

In `apps/mdm-platform/server/mysqlSchema.js`, add person-based columns alongside legacy user columns for active MySQL tables. Keep old names for compatibility but write target code to person columns.

Minimum additions:

```sql
owner_person_id BIGINT NULL
actor_person_id BIGINT NULL
assignee_person_id BIGINT NULL
assigned_by_person_id BIGINT NULL
submitted_by_person_id BIGINT NULL
reviewed_by_person_id BIGINT NULL
created_by_person_id BIGINT NULL
updated_by_person_id BIGINT NULL
closed_by_person_id BIGINT NULL
operator_person_id BIGINT NULL
steward_person_id BIGINT NULL
generated_by_person_id BIGINT NULL
decided_by_person_id BIGINT NULL
```

Apply only where the table already has the corresponding user-semantic field or where the spec requires person responsibility semantics. Do not remove legacy fields in this round.

- [ ] **Step 5: Add migration helper for legacy user fields**

In `apps/mdm-platform/server/identityMysqlRepository.js`, extend `migrateLegacyIdentityToPersonIdentity(pool)` with guarded updates:

```js
const personFieldMigrations = [
  ['departments', 'manager_user_id', 'final_responsible_person_id'],
  ['departments', 'data_owner_user_id', 'data_owner_person_id'],
  ['process_governance_quality_cases', 'owner_user_id', 'owner_person_id'],
  ['process_governance_quality_case_events', 'actor_user_id', 'actor_person_id'],
  ['process_mapping_todos', 'owner_user_id', 'owner_person_id'],
  ['process_mapping_todo_events', 'actor_user_id', 'actor_person_id'],
  ['process_governance_issue_participants', 'user_id', 'person_id'],
  ['process_governance_issue_events', 'actor_user_id', 'actor_person_id'],
  ['mdm_mapping_records', 'submitted_by', 'submitted_by_person_id'],
  ['mdm_mapping_approval_tasks', 'assignee_user_id', 'assignee_person_id'],
  ['mdm_mapping_approval_tasks', 'operated_by', 'operated_by_person_id'],
  ['mdm_mapping_approval_history', 'operator_user_id', 'operator_person_id'],
  ['field_entries', 'submitted_by', 'submitted_by_person_id'],
  ['field_entries', 'reviewed_by', 'reviewed_by_person_id'],
  ['field_identities', 'owner_user_id', 'owner_person_id'],
  ['mdm_conflict_assignments', 'assignee_user_id', 'assignee_person_id'],
  ['mdm_conflict_assignments', 'assigned_by', 'assigned_by_person_id'],
  ['mdm_conflict_events', 'actor_user_id', 'actor_person_id']
];

for (const [table, userField, personField] of personFieldMigrations) {
  await executeIfSupported(pool, `
    UPDATE ${table} target
    JOIN users u ON target.${userField}=u.id
    JOIN person p ON p.employee_no=u.employee_no
    SET target.${personField}=p.person_id
    WHERE target.${userField} IS NOT NULL
      AND target.${personField} IS NULL
  `);
}
```

- [ ] **Step 6: Update active repository writes**

In MySQL repositories, when writing person-responsibility data, write both target and legacy fields during this round:

```js
const actorPersonId = payload.actor_person_id || payload.actorUserId || payload.actor_user_id || null;
const actorUserId = payload.actor_user_id || actorPersonId;
```

Use the target person column in new SQL filters and returned payloads. Keep legacy alias in response only where existing frontend or tests still consume it.

- [ ] **Step 7: Run responsibility and mainline tests**

Run:

```powershell
cd apps/mdm-platform
npm run test:department-responsibility
npm run test:no-new-user-identity-fields
npm run test:process-governance
npm run test:mainline
```

Expected after implementation: all pass.

- [ ] **Step 8: Commit task checkpoint**

```powershell
git add apps/mdm-platform/package.json apps/mdm-platform/server/mysqlSchema.js apps/mdm-platform/server/identityMysqlRepository.js apps/mdm-platform/server/processGovernanceMysqlRepository.js apps/mdm-platform/server/dataMapMysqlRepository.js apps/mdm-platform/server/conflictMysqlRepository.js apps/mdm-platform/scripts/test-department-responsibility-mysql.js apps/mdm-platform/scripts/test-no-new-user-identity-fields.js
git commit -m "feat(mdm): migrate business responsibility to person identity"
```

---

### Task 4: Guidance Workflow State Machine, Events, And Delegation

**Files:**
- Modify: `apps/mdm-platform/package.json`
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
- Modify: `apps/mdm-platform/server/governanceGuidanceMysqlRepository.js`
- Modify: `apps/mdm-platform/server/routes/governanceGuidance.js`
- Create: `apps/mdm-platform/scripts/test-guidance-workflow-mysql-api.js`

- [ ] **Step 1: Write failing guidance workflow test**

Create `apps/mdm-platform/scripts/test-guidance-workflow-mysql-api.js` with route-level coverage for:

```js
const assert = require('assert');
const express = require('express');

const guidanceRouter = require('../server/routes/governanceGuidance');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

(async () => {
  const events = [];
  const guidanceRouterPermissions = new Map([
    [701, new Set(['guidance:create', 'process_governance:view_global'])],
    [501, new Set(['guidance:respond', 'guidance:final_confirm'])],
    [601, new Set(['guidance:respond'])],
    [999, new Set(['admin:access', 'process_governance:view_global'])]
  ]);

  let sessionPersonId = 701;
  guidanceRouter.setIdentityRepositoryFactory(() => ({
    async getUserEffectivePermissions(personId) {
      return { permSet: guidanceRouterPermissions.get(Number(personId)) || new Set(), fieldConstraints: {} };
    }
  }));

  guidanceRouter.setGuidanceRepositoryFactory(() => {
    const guidance = {
      guidance_id: 77,
      related_department_id: 20,
      final_responsible_person_id: 501,
      current_handler_person_id: 501,
      is_major: true,
      status: 'pending_response'
    };

    return {
      async createGuidance(payload) {
        events.push({ type: 'created', actor: payload.created_by_person_id });
        return Object.assign({}, guidance, payload, { status: 'pending_response' });
      },
      async listGuidanceForPerson() { return [guidance]; },
      async respondGuidance(id, personId, payload) {
        if (Number(personId) === 999) return { updated: false, reason: 'not_responsible' };
        if (Number(personId) === 601 && payload.final_confirm) return { updated: false, reason: 'final_confirm_denied' };
        events.push({ type: payload.final_confirm ? 'final_confirmed' : 'responded', actor: personId });
        return { updated: true, status: payload.final_confirm ? 'closed' : 'pending_final_confirm' };
      },
      async clarifyGuidance(id, personId) {
        events.push({ type: 'clarification_requested', actor: personId });
        return { updated: true, status: 'clarification_requested' };
      },
      async objectGuidance(id, personId) {
        events.push({ type: 'objected', actor: personId });
        return { updated: true, status: 'objected' };
      }
    };
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: sessionPersonId, personId: sessionPersonId, userRole: 'owner' };
    next();
  });
  app.use('/api/process-governance/guidance', guidanceRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const createRes = await fetch(`${baseUrl}/api/process-governance/guidance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ related_entity_type: 'process_mapping_record', related_entity_id: 3001, related_department_id: 20, content: '请补充跨部门输入输出。', is_major: true })
    });
    assert.strictEqual(createRes.status, 201);

    sessionPersonId = 501;
    const respondRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_content: '已组织补充材料。' })
    });
    assert.strictEqual(respondRes.status, 200);
    assert.strictEqual((await respondRes.json()).status, 'pending_final_confirm');

    sessionPersonId = 999;
    const adminCloseRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/final-confirm`, { method: 'POST' });
    assert.strictEqual(adminCloseRes.status, 403);

    sessionPersonId = 601;
    const delegateCloseRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/final-confirm`, { method: 'POST' });
    assert.strictEqual(delegateCloseRes.status, 403);

    sessionPersonId = 501;
    const closeRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/final-confirm`, { method: 'POST' });
    assert.strictEqual(closeRes.status, 200);
    assert.ok(events.some(event => event.type === 'final_confirmed' && event.actor === 501));

    console.log('Guidance workflow MySQL API test passed');
  } finally {
    await closeServer(server);
    guidanceRouter.resetGuidanceRepositoryFactory();
    guidanceRouter.resetIdentityRepositoryFactory();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add script and run red**

Modify `apps/mdm-platform/package.json`:

```json
"test:guidance-workflow": "node scripts/test-guidance-workflow-mysql-api.js"
```

Run:

```powershell
cd apps/mdm-platform
npm run test:guidance-workflow
```

Expected before implementation: FAIL because `/final-confirm`, `/clarify`, `/object`, and event behavior are missing.

- [ ] **Step 3: Add event table**

In `apps/mdm-platform/server/mysqlSchema.js`, add:

```sql
CREATE TABLE IF NOT EXISTS process_governance_guidance_events (
  event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  guidance_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_person_id BIGINT NULL,
  from_status VARCHAR(64) NULL,
  to_status VARCHAR(64) NULL,
  note TEXT NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_guidance_events_guidance (guidance_id, created_at),
  CHECK (event_type IN ('created','responded','clarification_requested','objected','executor_assigned','delegated','final_confirmed','commented')),
  CONSTRAINT fk_guidance_events_guidance FOREIGN KEY (guidance_id)
    REFERENCES process_governance_guidance(guidance_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Implement repository state transitions**

In `apps/mdm-platform/server/governanceGuidanceMysqlRepository.js`, implement a single action helper:

```js
async function recordGuidanceEvent(guidanceId, eventType, actorPersonId, fromStatus, toStatus, note, payload = {}) {
  await pool.execute(`
    INSERT INTO process_governance_guidance_events
      (guidance_id, event_type, actor_person_id, from_status, to_status, note, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [guidanceId, eventType, actorPersonId || null, fromStatus || null, toStatus || null, note || null, JSON.stringify(payload || {})]);
}
```

Implement:

- `respondGuidance(guidanceId, personId, payload)`
  - Allowed if current handler, final responsible, or valid delegate for response.
  - For `is_major=1`, response moves to `pending_final_confirm`.
  - For `is_major=0`, response can move to `responded`.
- `finalConfirmGuidance(guidanceId, personId, payload)`
  - Allowed only for final responsible person, or valid delegate where `can_final_confirm=1`.
  - Admin global read does not satisfy this action.
  - Moves to `closed`.
- `clarifyGuidance(guidanceId, personId, payload)`
  - Allowed for final responsible or current handler.
  - Moves to `clarification_requested`.
- `objectGuidance(guidanceId, personId, payload)`
  - Allowed for final responsible or current handler.
  - Moves to `objected`.
- `delegateGuidance(guidanceId, personId, payload)`
  - Creates or updates `department_responsibility_delegations`.
  - Does not change `final_responsible_person_id`.

- [ ] **Step 5: Add route endpoints**

In `apps/mdm-platform/server/routes/governanceGuidance.js`, add:

```js
function sendGuidanceActionResult(res, result) {
  if (!result.updated && result.reason === 'missing') return res.status(404).json({ error: '指导意见不存在' });
  if (!result.updated && result.reason === 'invalid_status') return res.status(409).json({ error: '当前状态不允许该操作' });
  if (!result.updated && result.reason === 'not_responsible') return res.status(403).json({ error: '不是当前责任人或授权处理人' });
  if (!result.updated && result.reason === 'delegate_out_of_scope') return res.status(403).json({ error: '代理授权范围不包含该事项' });
  if (!result.updated && result.reason === 'final_confirm_denied') return res.status(403).json({ error: '重大闭环需要最终响应责任人确认' });
  return res.json({ success: true, status: result.status });
}

router.post('/:id/clarify', requireAuth, requireGuidancePermission('guidance:respond'), async (req, res) => {
  try {
    const repo = await guidanceRepository();
    const result = await repo.clarifyGuidance(Number(req.params.id), requestPersonId(req), req.body || {});
    return sendGuidanceActionResult(res, result);
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见写入模型不可用' });
  }
});

router.post('/:id/object', requireAuth, requireGuidancePermission('guidance:respond'), async (req, res) => {
  try {
    const repo = await guidanceRepository();
    const result = await repo.objectGuidance(Number(req.params.id), requestPersonId(req), req.body || {});
    return sendGuidanceActionResult(res, result);
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见写入模型不可用' });
  }
});

router.post('/:id/delegate', requireAuth, requireGuidancePermission('guidance:delegate'), async (req, res) => {
  try {
    const repo = await guidanceRepository();
    const result = await repo.delegateGuidance(Number(req.params.id), requestPersonId(req), req.body || {});
    return sendGuidanceActionResult(res, result);
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见写入模型不可用' });
  }
});

router.post('/:id/final-confirm', requireAuth, requireGuidancePermission('guidance:final_confirm'), async (req, res) => {
  try {
    const repo = await guidanceRepository();
    const result = await repo.finalConfirmGuidance(Number(req.params.id), requestPersonId(req), req.body || {});
    return sendGuidanceActionResult(res, result);
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见写入模型不可用' });
  }
});
```

Each route maps repository reasons to HTTP statuses:

- `missing` -> `404`
- `not_responsible` -> `403`
- `delegate_out_of_scope` -> `403`
- `final_confirm_denied` -> `403`
- `invalid_status` -> `409`

- [ ] **Step 6: Run guidance workflow tests**

Run:

```powershell
cd apps/mdm-platform
npm run test:guidance-workflow
npm run test:person-identity-rbac
npm run test:process-governance
```

Expected after implementation: all pass.

- [ ] **Step 7: Commit task checkpoint**

```powershell
git add apps/mdm-platform/package.json apps/mdm-platform/server/mysqlSchema.js apps/mdm-platform/server/governanceGuidanceMysqlRepository.js apps/mdm-platform/server/routes/governanceGuidance.js apps/mdm-platform/scripts/test-guidance-workflow-mysql-api.js
git commit -m "feat(mdm): complete guidance workflow state machine"
```

---

### Task 5: Frontend Operation Controls And Backend Affordances

**Files:**
- Modify: `apps/mdm-platform/package.json`
- Modify: `apps/mdm-platform/server/governanceGuidanceMysqlRepository.js`
- Modify: `apps/mdm-platform/server/routes/governanceGuidance.js`
- Modify: `apps/mdm-platform/public/index.html`
- Create: `apps/mdm-platform/scripts/test-person-operation-controls-frontend.js`

- [ ] **Step 1: Write failing frontend contract test**

Create `apps/mdm-platform/scripts/test-person-operation-controls-frontend.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const requiredTokens = [
  'data-permission="guidance:create"',
  'data-permission="guidance:respond"',
  'data-permission="guidance:final_confirm"',
  'data-requires-guidance-state',
  'data-requires-responsibility="finalResponsible"',
  'data-requires-responsibility="currentHandler"',
  'applyGuidanceAffordances',
  'guidanceActions',
  'finalResponsiblePerson',
  'currentHandlerPerson',
  'delegatePerson',
  'executorPerson'
];

for (const token of requiredTokens) {
  assert.ok(html.includes(token), `frontend guidance operation contract missing: ${token}`);
}

assert.ok(!html.includes('window.prompt('), 'guidance actions must not use prompt');

console.log('Person operation controls frontend test passed');
```

- [ ] **Step 2: Add script and run red**

Modify `apps/mdm-platform/package.json`:

```json
"test:person-operation-controls": "node scripts/test-person-operation-controls-frontend.js"
```

Run:

```powershell
cd apps/mdm-platform
npm run test:person-operation-controls
```

Expected before implementation: FAIL because response/final-confirm affordance tokens are missing.

- [ ] **Step 3: Return backend affordances with guidance objects**

In `normalizeGuidance(row)` or route response mapping, add:

```js
guidanceActions: {
  canCreate: false,
  canRespond: false,
  canClarify: false,
  canObject: false,
  canDelegate: false,
  canFinalConfirm: false,
  disabledReasons: {}
}
```

When listing guidance, compute actions from:

- effective permissions,
- status,
- `personId`,
- `final_responsible_person_id`,
- `current_handler_person_id`,
- valid delegation row,
- `is_major`.

- [ ] **Step 4: Add frontend controls**

In `apps/mdm-platform/public/index.html`, add a guidance action area with controls:

```html
<button class="btn secondary" id="pgRespondGuidanceBtn" data-permission="guidance:respond" data-requires-guidance-state="pending_response" data-requires-responsibility="currentHandler">响应</button>
<button class="btn secondary" id="pgClarifyGuidanceBtn" data-permission="guidance:respond" data-requires-guidance-state="pending_response" data-requires-responsibility="currentHandler">申请澄清</button>
<button class="btn secondary" id="pgObjectGuidanceBtn" data-permission="guidance:respond" data-requires-guidance-state="pending_response" data-requires-responsibility="currentHandler">提出异议</button>
<button class="btn secondary" id="pgFinalConfirmGuidanceBtn" data-permission="guidance:final_confirm" data-requires-guidance-state="pending_final_confirm" data-requires-responsibility="finalResponsible">确认闭环</button>
```

Add labels for final responsible, delegate, executor, current handler, and next action in the process governance workspace.

- [ ] **Step 5: Implement affordance application**

Add:

```js
function applyGuidanceAffordances(guidance) {
  var actions = guidance && guidance.guidanceActions || {};
  document.querySelectorAll('[data-requires-guidance-state]').forEach(function(button) {
    var actionName = button.id.replace(/^pg/, '').replace(/GuidanceBtn$/, '');
    var camelAction = 'can' + actionName;
    var allowed = Boolean(actions[camelAction]);
    button.hidden = !allowed && !button.getAttribute('data-disabled-reason');
    button.disabled = !allowed;
    button.title = actions.disabledReasons && actions.disabledReasons[camelAction] || '';
  });
}
```

Wire buttons to `/respond`, `/clarify`, `/object`, and `/final-confirm` endpoints.

- [ ] **Step 6: Run frontend controls tests**

Run:

```powershell
cd apps/mdm-platform
npm run test:person-operation-controls
npm run test:frontend
npm run test:guidance-workflow
```

Expected after implementation: all pass.

- [ ] **Step 7: Commit task checkpoint**

```powershell
git add apps/mdm-platform/package.json apps/mdm-platform/public/index.html apps/mdm-platform/server/governanceGuidanceMysqlRepository.js apps/mdm-platform/server/routes/governanceGuidance.js apps/mdm-platform/scripts/test-person-operation-controls-frontend.js
git commit -m "feat(mdm): add guidance operation controls"
```

---

### Task 6: Consolidated Verification And Round-Two Handoff

**Files:**
- Modify: `apps/mdm-platform/package.json`
- Modify: `docs/superpowers/specs/2026-06-26-mdm-person-identity-rbac-redesign.md` only if the user explicitly asks to update the spec status.
- No changes to `docs/norms/` or PMO assets.

- [ ] **Step 1: Add aggregate test script**

Modify `apps/mdm-platform/package.json`:

```json
"test:person-identity-rbac-completion": "npm run test:person-identity-rbac && npm run test:person-rbac-matrix && npm run test:person-identity-payload && npm run test:department-responsibility && npm run test:no-new-user-identity-fields && npm run test:guidance-workflow && npm run test:person-operation-controls"
```

- [ ] **Step 2: Run target verification**

Run:

```powershell
cd apps/mdm-platform
npm run test:person-identity-rbac-completion
npm run test:identity-mysql
npm run test:role-workbench-mysql
npm run test:project-roles
npm run test:frontend
npm run test:process-governance
npm run test:mainline
```

Expected: all commands exit 0.

- [ ] **Step 3: Run repository-level guards**

Run from repo root:

```powershell
npm run test:infomat-services-config
git diff --check
git status --short --branch
```

Expected:

- fixed service config test exits 0,
- `git diff --check` has no whitespace errors,
- only intended `apps/mdm-platform/` implementation and `docs/superpowers/plans/` planning changes are present.

- [ ] **Step 4: Record second-round cleanup boundaries**

Create a short execution note in the final response, not in `docs/norms/`, covering:

- SQLite deletion remains Round 2.
- `users` and `user_roles` compatibility remains until Round 2.
- Old user-named API parameters may remain as UI compatibility labels, but new backend writes use person fields.
- No PMO or process truth-source changes were made.

- [ ] **Step 5: Commit verification checkpoint**

```powershell
git add apps/mdm-platform/package.json
git commit -m "test(mdm): add person identity completion regression suite"
```

---

## Self-Review

- Spec Section 2 decisions are covered by Task 1, Task 4, and Task 5.
- Spec Section 4 data model is covered by Task 1, Task 2, and Task 3.
- Spec Section 5 department final responsibility is covered by Task 3.
- Spec Section 6 management guidance and delegation are covered by Task 4.
- Spec Section 7 frontend and backend operation controls are covered by Task 5.
- Spec Section 8 `/api/org/me` target payload is covered by Task 2.
- Spec Section 9 migration design is covered by Task 3 and Task 6.
- Spec Section 10 tests are covered by Tasks 1 through 6.
- Spec Section 11 acceptance is covered by Task 6 verification.
- Round 2 SQLite deletion is explicitly out of scope in this plan.
