const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
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
        id: 500,
        conflict_type: 'field',
        conflict_field: 'authoritative_system',
        field_entry_a_id: 101,
        field_entry_b_id: 102,
        field_name_a: 'customer_code',
        field_name_b: 'customer_code',
        value_a: 'CRM',
        value_b: 'ERP',
        dept_a: 9,
        dept_b: 10,
        severity: 'error',
        status: 'pending',
        escalated: 0
      },
      {
        id: 600,
        conflict_type: 'term',
        term: 'customer',
        dept_a: 9,
        dept_a_meaning: 'sales customer',
        dept_b: 10,
        dept_b_meaning: 'billing customer',
        severity: 'warn',
        status: 'coordinating',
        escalated: 0
      }
    ],
    assignments: [],
    history: []
  };

  function findConflict(id, type) {
    return state.conflicts.find(row => Number(row.id) === Number(id) && row.conflict_type === type);
  }

  return {
    state,
    async listConflicts(filters, scope) {
      state.calls.push(['listConflicts', filters, scope]);
      return state.conflicts
        .filter(row => !filters.type || row.conflict_type === filters.type)
        .filter(row => !filters.status || row.status === filters.status)
        .filter(row => !filters.severity || row.severity === filters.severity);
    },
    async conflictStats(scope) {
      state.calls.push(['conflictStats', scope]);
      return { coordinating: 1, escalated: 0, silenced: 0, resolved: 0, resolvedThisMonth: 0, byStatus: { coordinating: 1 } };
    },
    async getConflict(id, type, scope) {
      state.calls.push(['getConflict', Number(id), type, scope]);
      const conflict = findConflict(id, type);
      if (!conflict) return null;
      return {
        ...conflict,
        currentAssignee: state.assignments.find(row => Number(row.conflict_id) === Number(id) && row.conflict_type === type) || null,
        coordinationHistory: state.history.filter(row => Number(row.conflict_id) === Number(id) && row.conflict_type === type),
        assignmentHistory: state.assignments.filter(row => Number(row.conflict_id) === Number(id) && row.conflict_type === type),
        bothSubmitted: false
      };
    },
    async detectConflicts(filters, actor) {
      state.calls.push(['detectConflicts', filters, actor]);
      return { detected: 2 };
    },
    async assignConflict(id, type, payload) {
      state.calls.push(['assignConflict', Number(id), type, payload]);
      const conflict = findConflict(id, type);
      if (!conflict) return { ok: false, statusCode: 404, error: 'missing' };
      conflict.status = 'coordinating';
      state.assignments.push({ conflict_id: Number(id), conflict_type: type, assignee_user_id: payload.assignee_user_id });
      return { ok: true };
    },
    async reassignConflict(id, type, payload) {
      state.calls.push(['reassignConflict', Number(id), type, payload]);
      state.assignments.push({ conflict_id: Number(id), conflict_type: type, assignee_user_id: payload.assignee_user_id });
      return { ok: true };
    },
    async submitCoordination(id, type, payload) {
      state.calls.push(['submitCoordination', Number(id), type, payload]);
      state.history.push({ conflict_id: Number(id), conflict_type: type, result: payload.result, note: payload.note });
      return { ok: true };
    },
    async finalDecideConflict(id, type, payload) {
      state.calls.push(['finalDecideConflict', Number(id), type, payload]);
      const conflict = findConflict(id, type);
      if (conflict) {
        conflict.status = 'resolved';
        conflict.resolution = payload.resolution;
      }
      return { ok: true };
    },
    async escalateConflict(id, type, payload) {
      state.calls.push(['escalateConflict', Number(id), type, payload]);
      const conflict = findConflict(id, type);
      if (conflict) {
        conflict.status = 'escalated';
        conflict.escalated = 1;
      }
      return { ok: true };
    },
    async reopenConflict(id, type, payload) {
      state.calls.push(['reopenConflict', Number(id), type, payload]);
      return { ok: true };
    },
    async archiveConflict(id, type, payload) {
      state.calls.push(['archiveConflict', Number(id), type, payload]);
      return { ok: true };
    },
    async resolveFieldConflict(id, payload) {
      state.calls.push(['resolveFieldConflict', Number(id), payload]);
      const conflict = findConflict(id, 'field');
      if (conflict) conflict.status = 'resolved';
      return { ok: true };
    },
    async resolveTermConflict(id, payload) {
      state.calls.push(['resolveTermConflict', Number(id), payload]);
      const conflict = findConflict(id, 'term');
      if (conflict) conflict.status = 'resolved';
      return { ok: true };
    }
  };
}

async function main() {
  assert.strictEqual(
    typeof conflictsRouter.setConflictRepositoryFactory,
    'function',
    'conflicts route should allow MySQL conflict repository injection'
  );

  const repo = makeFakeConflictRepository();
  conflictsRouter.setConflictRepositoryFactory(async () => repo);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      return {
        permSet: new Set([
          'governance:read-global',
          'governance:assign-work',
          'governance:structure-gate',
          'governance:handle-assigned-conflict',
          'governance:escalate-conflict',
          'governance:decide-escalation'
        ]),
        fieldConstraints: {}
      };
    },
    async getUserRoleCodes(userId) {
      return Number(userId) === 77
        ? [{ code: 'data_conflict_handler', name: '数据冲突处理人' }]
        : [{ code: 'mdm_lead', name: 'MDM工作组组长' }];
    },
    async getDepartmentById(id) {
      return { id, name: id === 9 ? 'Sales' : 'Finance' };
    },
    async getUserById(id) {
      return {
        id,
        personId: id,
        name: id === 42 ? 'MDM工作组组长' : '数据冲突处理人',
        department_id: id === 77 ? 10 : 9
      };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      userId: 42,
      userName: 'MDM工作组组长',
      departmentId: 9
    };
    next();
  });
  app.use('/api/conflicts', conflictsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    let res = await fetch(`${baseUrl}/api/conflicts?type=field`);
    let body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].conflict_type, 'field');

    res = await fetch(`${baseUrl}/api/conflicts/stats`);
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.coordinating, 1);

    res = await fetch(`${baseUrl}/api/conflicts/500?type=field`);
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.id, 500);

    res = await fetch(`${baseUrl}/api/conflicts/detect?field_name_cn=customer_code`, { method: 'POST' });
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.detected, 2);

    res = await fetch(`${baseUrl}/api/conflicts/500/assign?type=field`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_user_id: 77 })
    });
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.success, true);

    res = await fetch(`${baseUrl}/api/conflicts/500/coordination?type=field`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: 'A', note: 'use side A' })
    });
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.success, true);

    res = await fetch(`${baseUrl}/api/conflicts/500/final-decide?type=field`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'use MDM', adopted_value: 'MDM' })
    });
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.success, true);

    res = await fetch(`${baseUrl}/api/conflicts/600/escalate?type=term`, { method: 'POST' });
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.success, true);

    res = await fetch(`${baseUrl}/api/conflicts/500/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'field resolved', adopted_value: 'MDM' })
    });
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.success, true);

    res = await fetch(`${baseUrl}/api/conflicts/term/600/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: 'term resolved' })
    });
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.success, true);

    const callNames = repo.state.calls.map(call => call[0]);
    for (const expected of [
      'listConflicts',
      'conflictStats',
      'getConflict',
      'detectConflicts',
      'assignConflict',
      'submitCoordination',
      'finalDecideConflict',
      'escalateConflict',
      'resolveFieldConflict',
      'resolveTermConflict'
    ]) {
      assert.ok(callNames.includes(expected), `conflicts route should call repository method ${expected}`);
    }

    console.log('Conflicts MySQL API test passed');
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
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
});
