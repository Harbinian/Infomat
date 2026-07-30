const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousProcessReadModel = process.env.PROCESS_GOVERNANCE_READ_MODEL;
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const processGovernanceRouter = require('../server/routes/processGovernance');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function main() {
  assert.strictEqual(
    typeof processGovernanceRouter.setProcessGovernanceRepositoryFactory,
    'function',
    '流程治理路由应支持注入 MySQL 仓储'
  );
  assert.strictEqual(
    typeof auth.setIdentityRepositoryFactory,
    'function',
    '身份模块应支持注入 MySQL 仓储'
  );

  const identityCalls = { permissions: 0, roles: 0, users: 0, departments: 0 };
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      identityCalls.permissions += 1;
      assert.strictEqual(userId, 42);
      return {
        permSet: new Set([
          'governance:read-global',
          'governance:assign-work',
          'governance:structure-gate',
          'governance:publish'
        ]),
        fieldConstraints: {}
      };
    },
    async getUserRoleCodes(userId, legacyRole) {
      identityCalls.roles += 1;
      assert.strictEqual(userId, 42);
      return [{ code: 'mdm_lead', name: 'MDM工作组组长' }];
    },
    async getUserById(userId) {
      identityCalls.users += 1;
      if (userId === 501) {
        return { id: 501, name: 'MySQL 责任人', department_id: 601 };
      }
      return null;
    },
    async getDepartmentById(departmentId) {
      identityCalls.departments += 1;
      if (departmentId === 601) {
        return { id: 601, name: 'MySQL 质量管理部' };
      }
      return null;
    }
  }));

  let qualityListFilters = null;
  let qualityAssignPayload = null;
  let mappingListFilters = null;
  let mappingAssignPayload = null;

  processGovernanceRouter.setProcessGovernanceRepositoryFactory(() => ({
    async getQualityCases(filters = {}) {
      qualityListFilters = filters;
      assert.strictEqual(filters.canViewAll, true, '质量问题列表应使用 MySQL 身份权限判断全量查看');
      assert.strictEqual(filters.departmentName, 'MySQL 质量管理部');
      return { summary: { total: 1 }, items: [{ id: 11, status: 'open' }] };
    },
    async getQualityCase(caseId) {
      assert.strictEqual(caseId, 11);
      return {
        id: 11,
        severity: 'WARN',
        area: 'source',
        dept_name: '其他部门',
        status: 'open',
        priority: 'medium',
        owner_user_id: null,
        owner_dept_id: null
      };
    },
    async assignQualityCase(caseId, payload = {}) {
      assert.strictEqual(caseId, 11);
      qualityAssignPayload = payload;
      assert.strictEqual(payload.owner_user_id, 501);
      assert.strictEqual(payload.owner_dept_id, 601);
      return { case: { id: 11, status: 'assigned', owner_user_id: 501, owner_dept_id: 601 }, events: [] };
    },
    async getMappingTodos(filters = {}) {
      mappingListFilters = filters;
      assert.strictEqual(filters.canViewAll, true, '映射待办列表应使用 MySQL 身份权限判断全量查看');
      assert.strictEqual(filters.departmentName, 'MySQL 质量管理部');
      return { summary: { total: 1 }, items: [{ id: 21, status: 'open' }] };
    },
    async getMappingTodo(todoId) {
      assert.strictEqual(todoId, 21);
      return {
        id: 21,
        todo_type: 'cross_dept',
        status: 'open',
        priority: 'medium',
        dept_name: '其他部门',
        target_dept_name: '另一部门',
        owner_user_id: null,
        owner_dept_id: null
      };
    },
    async assignMappingTodo(todoId, payload = {}) {
      assert.strictEqual(todoId, 21);
      mappingAssignPayload = payload;
      assert.strictEqual(payload.owner_user_id, 501);
      assert.strictEqual(payload.owner_dept_id, 601);
      return { todo: { id: 21, status: 'assigned', owner_user_id: 501, owner_dept_id: 601 }, events: [] };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      userId: 42,
      userName: 'MySQL 会话用户',
      departmentId: 601
    };
    next();
  });
  app.use('/api/process-governance', processGovernanceRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const casesRes = await fetch(`${baseUrl}/api/process-governance/quality-cases?status=open`);
    const casesBody = await casesRes.json();
    assert.strictEqual(casesRes.status, 200, JSON.stringify(casesBody));
    assert.ok(qualityListFilters, '应调用质量问题 MySQL 仓储');

    const assignCaseRes = await fetch(`${baseUrl}/api/process-governance/quality-cases/11/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_user_id: 501, priority: 'high', note: '交给 MySQL 身份责任人' })
    });
    const assignCaseBody = await assignCaseRes.json();
    assert.strictEqual(assignCaseRes.status, 200, JSON.stringify(assignCaseBody));
    assert.ok(qualityAssignPayload, '应调用质量问题分派 MySQL 仓储');

    const todosRes = await fetch(`${baseUrl}/api/process-governance/mapping-todos?type=cross_dept`);
    const todosBody = await todosRes.json();
    assert.strictEqual(todosRes.status, 200, JSON.stringify(todosBody));
    assert.ok(mappingListFilters, '应调用映射待办 MySQL 仓储');

    const assignTodoRes = await fetch(`${baseUrl}/api/process-governance/mapping-todos/21/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_user_id: 501, priority: 'high', note: '交给 MySQL 身份责任人' })
    });
    const assignTodoBody = await assignTodoRes.json();
    assert.strictEqual(assignTodoRes.status, 200, JSON.stringify(assignTodoBody));
    assert.ok(mappingAssignPayload, '应调用映射待办分派 MySQL 仓储');

    assert.ok(identityCalls.permissions > 0, '权限判断应读取 MySQL 身份仓储');
    assert.ok(identityCalls.users > 0, '责任人校验应读取 MySQL 身份仓储');
    assert.ok(identityCalls.departments > 0, '部门校验应读取 MySQL 身份仓储');

    console.log('Process governance MySQL identity API test passed');
  } finally {
    await closeServer(server);
    processGovernanceRouter.resetProcessGovernanceRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousProcessReadModel === undefined) {
    delete process.env.PROCESS_GOVERNANCE_READ_MODEL;
  } else {
    process.env.PROCESS_GOVERNANCE_READ_MODEL = previousProcessReadModel;
  }
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
  cleanupDb({ ignoreErrors: true });
});
