// Synthetic HTTP sessions and SQL doubles only; no private configuration or real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.MDM_SYSTEM_ADMIN_ENABLED = '1';
process.env.PROCESS_V7_PREVIEW_ENABLED = '0';
process.env.PROCESS_V7_FORMAL_ENABLED = '0';
process.env.PROCESS_DATA_GOVERNANCE_ENABLED = '0';

const auth = require('../server/auth');
const workbench = require('../server/routes/roleWorkbench');
const offices = require('../server/routes/offices');
const preview = require('../server/routes/processPreviewReview');
const closure = require('../server/analysisClosureWorkbench');

async function withServer(session, action) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/role-workbench', workbench);
  app.use('/api/process-v7-preview', preview);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

auth.setIdentityRepositoryFactory(() => ({
  async validateSession(session) { return { valid: true, user: { personId: session.personId, must_change_password: false } }; }
}));

test('closure projection never queries for an absent, invalid or system administrator person', async () => {
  const pool = { execute() { assert.fail('a personless session must not reach MySQL'); } };
  for (const session of [{}, { identityKind: 'system_admin', accountId: 1, userId: 'system-admin:1' }, { personId: 'invalid' }]) {
    assert.deepEqual(await closure(pool, session), []);
  }
});

test('closure keeps the exact person identifier and a missing migration stays an empty optional source', async () => {
  const calls = [];
  const personId = '9007199254740993';
  const pool = { async execute(sql, params) {
    assert(params.every(value => value !== undefined));
    calls.push({ sql, params });
    return [sql.includes('schema_migrations') ? [{ migration_key: 'synthetic' }] : []];
  } };
  assert.deepEqual(await closure(pool, { personId }), []);
  assert.deepEqual(calls[1].params, [personId, personId]);
  assert.deepEqual(await closure({ async execute() { return [[]]; } }, { personId: 42 }), []);
});

test('administrator workbench skips all personal office and closure sources', async () => {
  workbench.setIdentityRepositoryFactory(() => ({ async getCurrentUserPayload(session) {
    return { id: session.personId || 'system-admin:1', personId: session.personId || null,
      roleCodes: ['admin', 'mdm_lead'], permissions: ['identity:read', 'governance:read-global'] };
  } }));
  offices.setRepositoryFactory(() => ({
    personalWorkItems() { assert.fail('administrator cannot have personal office work'); },
    closureWorkItems() { assert.fail('administrator cannot have personal closure work'); }
  }));
  try {
    for (const session of [
      { identityKind: 'system_admin', accountId: 1, authVersion: 1, userId: 'system-admin:1' },
      { personId: 42, accountId: 42, authVersion: 1 }
    ]) await withServer(session, async base => {
      const response = await fetch(base + '/api/role-workbench?mode=todo');
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.summary.actionableCount, 0);
      assert.equal(body.summary.governance.officeTasks, 0);
    });
  } finally { workbench.resetIdentityRepositoryFactory(); workbench.clearWorkbenchCaches(); }
});

test('person workbench still queries live sources and refuses a failed enabled source', async () => {
  let personalCalls = 0, closureCalls = 0, fail = false;
  workbench.setIdentityRepositoryFactory(() => ({ async getCurrentUserPayload() {
    return { id: 42, personId: 42, roleCodes: ['department_contact'], permissions: ['governance:draft-department'] };
  } }));
  offices.setRepositoryFactory(() => ({
    async personalWorkItems() { personalCalls++; if (fail) throw Object.assign(new Error('synthetic'), { code: 'MYSQL_DEADLINE' }); return []; },
    async closureWorkItems() { closureCalls++; return []; }
  }));
  try {
    await withServer({ personId: 42, accountId: 42, authVersion: 1 }, async base => {
      assert.equal((await fetch(base + '/api/role-workbench?mode=todo')).status, 200);
      assert.equal(personalCalls, 1); assert.equal(closureCalls, 1);
      fail = true;
      assert.equal((await fetch(base + '/api/role-workbench?mode=todo')).status, 503);
    });
  } finally { workbench.resetIdentityRepositoryFactory(); workbench.clearWorkbenchCaches(); }
});

test('preview status remains readable when disabled while cases keep their refusal contract', async () => {
  await withServer({ personId: 42, accountId: 42, authVersion: 1 }, async base => {
    const status = await fetch(base + '/api/process-v7-preview/status');
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.enabled, false); assert.equal(body.formal_enabled, false);
    assert.equal(body.preview_only, true); assert.equal(body.publishable, false);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    const cases = await fetch(base + '/api/process-v7-preview/cases');
    assert.equal(cases.status, 503); assert.equal((await cases.json()).code, 'V7_PREVIEW_DISABLED');
    process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
    assert.equal((await (await fetch(base + '/api/process-v7-preview/status')).json()).enabled, true);
    process.env.PROCESS_V7_PREVIEW_ENABLED = '0';
  });
  await withServer({}, async base => {
    assert.equal((await fetch(base + '/api/process-v7-preview/status')).status, 401);
  });
});
