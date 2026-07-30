const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const conflictsRouter = require('../server/routes/conflicts');

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

function makeFakeConflictRepository() {
  const state = {
    calls: [],
    conflicts: [
      {
        id: 801,
        conflict_type: 'field',
        dept_a: 9,
        dept_b: 10,
        severity: 'error',
        status: 'pending',
        assignee_person_id: null
      },
      {
        id: 802,
        conflict_type: 'field',
        dept_a: 9,
        dept_b: 10,
        severity: 'warn',
        status: 'pending',
        assignee_person_id: null
      },
      {
        id: 803,
        conflict_type: 'field',
        dept_a: 9,
        dept_b: 10,
        severity: 'error',
        status: 'escalated',
        assignee_person_id: 77
      }
    ]
  };

  function inScope(conflict, scope = {}) {
    if (scope.canViewAll || scope.mode === 'global') return true;
    if (scope.mode === 'assigned') {
      return Number(conflict.assignee_person_id) === Number(scope.userId);
    }
    if (scope.mode === 'escalated') return conflict.status === 'escalated';
    if (scope.mode === 'department') {
      return [conflict.dept_a, conflict.dept_b].some(id => Number(id) === Number(scope.departmentId));
    }
    return false;
  }

  function findConflict(id, type = 'field') {
    return state.conflicts.find(row =>
      Number(row.id) === Number(id) && row.conflict_type === type
    ) || null;
  }

  return {
    state,
    async listConflicts(filters, scope) {
      state.calls.push(['listConflicts', filters, scope]);
      return state.conflicts.filter(row =>
        (!filters.type || row.conflict_type === filters.type) &&
        (!filters.status || row.status === filters.status) &&
        inScope(row, scope)
      );
    },
    async getConflict(id, type, scope) {
      state.calls.push(['getConflict', Number(id), type, scope]);
      const conflict = findConflict(id, type);
      return conflict && inScope(conflict, scope) ? conflict : null;
    },
    async assignConflict(id, type, payload) {
      state.calls.push(['assignConflict', Number(id), type, payload]);
      const conflict = findConflict(id, type);
      if (!conflict) return { ok: false, statusCode: 404, error: '冲突不存在' };
      conflict.assignee_person_id = payload.assignee_user_id;
      conflict.status = 'coordinating';
      return { ok: true };
    },
    async resolveFieldConflict(id, payload) {
      state.calls.push(['resolveFieldConflict', Number(id), payload]);
      const conflict = findConflict(id, 'field');
      if (!conflict) return { ok: false, statusCode: 404, error: '冲突不存在' };
      if (
        payload.requireAssignment &&
        Number(conflict.assignee_person_id) !== Number(payload.actor_person_id)
      ) {
        return { ok: false, statusCode: 403, error: '只能处理本人被分派的冲突' };
      }
      conflict.status = 'resolved';
      return { ok: true };
    },
    async escalateConflict(id, type, payload) {
      state.calls.push(['escalateConflict', Number(id), type, payload]);
      const conflict = findConflict(id, type);
      if (!conflict) return { ok: false, statusCode: 404, error: '冲突不存在' };
      if (Number(conflict.assignee_person_id) !== Number(payload.actor_person_id)) {
        return { ok: false, statusCode: 403, error: '只能升级本人被分派的冲突' };
      }
      conflict.status = 'escalated';
      return { ok: true };
    }
  };
}

async function requestJson(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function main() {
  let currentPersonId = 42;
  let currentDepartmentId = 9;
  const permissionsByPerson = new Map([
    [42, new Set([
      'governance:read-global',
      'governance:assign-work',
      'governance:structure-gate',
      'governance:escalate-conflict'
    ])],
    [77, new Set([
      'governance:read-assigned-context',
      'governance:handle-assigned-conflict',
      'governance:escalate-conflict'
    ])],
    [88, new Set([
      'governance:read-escalated-context',
      'governance:decide-escalation'
    ])],
    [99, new Set([
      'identity:read',
      'identity:manage-account',
      'identity:assign-role',
      'identity:read-audit',
      'governance:read-global'
    ])]
  ]);
  let permissionCalls = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(personId) {
      permissionCalls += 1;
      return {
        permSet: permissionsByPerson.get(Number(personId)) || new Set(),
        fieldConstraints: {}
      };
    },
    async getUserById(personId) {
      if (Number(personId) !== 77) return null;
      return { id: 77, personId: 77, name: '数据冲突处理人', department_id: 10 };
    },
    async getUserRoleCodes(personId) {
      return Number(personId) === 77
        ? [{ code: 'data_conflict_handler', name: '数据冲突处理人' }]
        : [];
    }
  }));

  const repo = makeFakeConflictRepository();
  conflictsRouter.setConflictRepositoryFactory(async () => repo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: currentPersonId,
      userId: currentPersonId,
      userName: '测试人员',
      departmentId: currentDepartmentId
    };
    next();
  });
  app.use('/api/conflicts', conflictsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    let result = await requestJson(baseUrl, '/api/conflicts?type=field');
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    assert.deepStrictEqual(result.body.map(row => row.id), [801, 802, 803], 'MDM工作组组长可读取全局冲突');

    result = await requestJson(baseUrl, '/api/conflicts/801/assign?type=field', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_user_id: 77 })
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));

    result = await requestJson(baseUrl, '/api/conflicts/802/assign?type=field', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_user_id: 66 })
    });
    assert.strictEqual(result.response.status, 422, '只能分派给当前有效的数据冲突处理人');

    currentPersonId = 77;
    currentDepartmentId = 10;
    result = await requestJson(baseUrl, '/api/conflicts?type=field');
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    assert.deepStrictEqual(
      result.body.map(row => row.id).sort((a, b) => a - b),
      [801, 803],
      '数据冲突处理人只能读取本人被分派的事项'
    );

    result = await requestJson(baseUrl, '/api/conflicts/802/resolve?type=field', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'adopt_a', adopted_value: 'A' })
    });
    assert.strictEqual(result.response.status, 403, '数据冲突处理人不能处理未分派事项');

    result = await requestJson(baseUrl, '/api/conflicts/801/resolve?type=field', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'adopt_a', adopted_value: 'A' })
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));

    currentPersonId = 88;
    currentDepartmentId = null;
    result = await requestJson(baseUrl, '/api/conflicts?type=field');
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    assert.deepStrictEqual(result.body.map(row => row.id), [803], '项目决策组只能读取已升级事项');

    result = await requestJson(baseUrl, '/api/conflicts/803/resolve?type=field', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'adopt_b', adopted_value: 'B' })
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));

    currentPersonId = 99;
    result = await requestJson(baseUrl, '/api/conflicts/802/assign?type=field', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_user_id: 77 })
    });
    assert.strictEqual(result.response.status, 403, 'MDM系统管理员不能分派治理事项');

    result = await requestJson(baseUrl, '/api/conflicts/802/resolve?type=field', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'adopt_a', adopted_value: 'A' })
    });
    assert.strictEqual(result.response.status, 403, 'MDM系统管理员不能处理治理事项');

    assert.ok(permissionCalls > 0, '冲突权限检查应读取 MySQL 身份权限');
    assert.ok(repo.state.calls.some(call => call[0] === 'assignConflict'));
    assert.ok(repo.state.calls.some(call => call[0] === 'resolveFieldConflict'));
    console.log('Conflicts MySQL identity API test passed');
  } finally {
    await closeServer(server);
    conflictsRouter.resetConflictRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
  }
});
