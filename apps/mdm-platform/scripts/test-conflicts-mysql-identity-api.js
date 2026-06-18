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
        conflict_field: 'authoritative_system',
        value_a: 'CRM',
        value_b: 'ERP',
        dept_a: 9,
        dept_b: 10,
        severity: 'error',
        status: 'pending'
      },
      {
        id: 802,
        conflict_type: 'field',
        conflict_field: 'business_definition',
        value_a: 'A',
        value_b: 'B',
        dept_a: 9,
        dept_b: 10,
        severity: 'warn',
        status: 'silenced'
      }
    ]
  };

  return {
    state,
    async listConflicts(filters, scope) {
      state.calls.push(['listConflicts', filters, scope]);
      return state.conflicts.filter(row => !filters.type || row.conflict_type === filters.type);
    },
    async getConflict(id, type, scope) {
      state.calls.push(['getConflict', Number(id), type, scope]);
      return state.conflicts.find(row => Number(row.id) === Number(id) && row.conflict_type === type) || null;
    },
    async assignConflict(id, type, payload) {
      state.calls.push(['assignConflict', Number(id), type, payload]);
      const conflict = state.conflicts.find(row => Number(row.id) === Number(id) && row.conflict_type === type);
      if (!conflict) return { ok: false, statusCode: 404, error: 'missing' };
      conflict.status = 'coordinating';
      return { ok: true };
    }
  };
}

async function main() {
  let permissionCalls = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      permissionCalls += 1;
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['data:view_all', 'conflict:manage']), fieldConstraints: {} };
    },
    async getUserById(userId) {
      return { id: userId, name: userId === 77 ? 'Assignee' : 'Requester', department_id: userId === 77 ? 10 : 9 };
    }
  }));

  const repo = makeFakeConflictRepository();
  conflictsRouter.setConflictRepositoryFactory(async () => repo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'submitter',
      userName: 'MySQL identity user',
      departmentId: 9
    };
    next();
  });
  app.use('/api/conflicts', conflictsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${baseUrl}/api/conflicts?type=field`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.ok(
      listBody.some(row => row.id === 802),
      'MySQL identity global view permission should allow silenced conflicts'
    );

    const assignRes = await fetch(`${baseUrl}/api/conflicts/801/assign?type=field`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_user_id: 77 })
    });
    const assignBody = await assignRes.json();
    assert.strictEqual(assignRes.status, 200, JSON.stringify(assignBody));
    assert.strictEqual(assignBody.success, true);
    assert.ok(permissionCalls > 0, 'conflict permission checks should read MySQL identity permissions');

    const callNames = repo.state.calls.map(call => call[0]);
    assert.ok(callNames.includes('listConflicts'));
    assert.ok(callNames.includes('assignConflict'));

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
