const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const { setDataMapRepositoryFactory, resetDataMapRepositoryFactory } = require('../server/dataMapMysqlRepository');
const fieldIdentitiesRouter = require('../server/routes/fieldIdentities');

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

function makeFakeDataMapRepository() {
  const state = {
    fields: [{ id: 20, context_id: 10, mapping_id: 10, dept_id: 9, submitted_by: 43 }],
    contexts: [{ id: 10, dept_id: 9, owner_user_id: 42, created_by: 43 }],
    identities: new Map(),
    calls: []
  };

  return {
    state,
    async getField(fieldId) {
      state.calls.push(['getField', Number(fieldId)]);
      return state.fields.find(field => field.id === Number(fieldId)) || null;
    },
    async getContext(contextId) {
      state.calls.push(['getContext', Number(contextId)]);
      return state.contexts.find(context => context.id === Number(contextId)) || null;
    },
    async getFieldIdentity(fieldId) {
      state.calls.push(['getFieldIdentity', Number(fieldId)]);
      return state.identities.get(Number(fieldId)) || null;
    },
    async upsertFieldIdentity(fieldId, payload) {
      state.calls.push(['upsertFieldIdentity', Number(fieldId), payload]);
      const identity = {
        id: 30,
        field_id: Number(fieldId),
        authoritative_system: payload.authoritative_system,
        authoritative_system_name: payload.authoritative_system,
        authoritative_system_code: payload.authoritative_system_code || null,
        maintain_dept_id: payload.maintain_dept_id || null,
        owner_user_id: payload.owner_user_id || null,
        confidence_level: payload.confidence_level || 'medium',
        confirmed: payload.confirmed ? 1 : 0,
        note: payload.note || null,
        status: 'needs_review'
      };
      state.identities.set(Number(fieldId), identity);
      return identity;
    },
    async confirmFieldIdentity(fieldId, payload, actorUserId) {
      state.calls.push(['confirmFieldIdentity', Number(fieldId), payload, actorUserId]);
      const identity = state.identities.get(Number(fieldId));
      if (!identity) return null;
      identity.authoritative_system = payload.authoritative_system || identity.authoritative_system;
      identity.authoritative_system_name = payload.authoritative_system || identity.authoritative_system_name;
      identity.authoritative_system_code = payload.authoritative_system_code || identity.authoritative_system_code;
      identity.confirmed = 1;
      identity.confirmed_by = actorUserId;
      identity.status = 'confirmed';
      return identity;
    }
  };
}

async function main() {
  const routeSource = fs.readFileSync(path.join(__dirname, '../server/routes/fieldIdentities.js'), 'utf8');
  assert.ok(!routeSource.includes("require('../db')"), 'field identities route must not import SQLite db');
  assert.ok(!routeSource.includes('field_identities'), 'field identities route must not query SQLite field_identities');
  assert.ok(!routeSource.includes('field_entries'), 'field identities route must not query SQLite field_entries');

  const repo = makeFakeDataMapRepository();
  setDataMapRepositoryFactory(async () => repo);
  let effectivePermissions = new Set([
    'governance:read-department',
    'governance:draft-department'
  ]);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      return { permSet: effectivePermissions, fieldConstraints: {} };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      userId: 42,
      userName: '字段治理人员',
      departmentId: 9
    };
    next();
  });
  app.use('/api/field-identities', fieldIdentitiesRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const emptyRes = await fetch(`${baseUrl}/api/field-identities/field/20`);
    const emptyBody = await emptyRes.json();
    assert.strictEqual(emptyRes.status, 200, JSON.stringify(emptyBody));
    assert.deepStrictEqual(emptyBody, {});

    const upsertRes = await fetch(`${baseUrl}/api/field-identities/20`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authoritative_system: 'CRM',
        authoritative_system_code: 'CRM',
        maintain_dept_id: 9,
        owner_user_id: 42,
        confidence_level: 'high',
        confirmed: false,
        note: '待确认黄金源'
      })
    });
    const upsertBody = await upsertRes.json();
    assert.strictEqual(upsertRes.status, 200, JSON.stringify(upsertBody));
    assert.strictEqual(upsertBody.authoritative_system, 'CRM');
    assert.strictEqual(upsertBody.confirmed, 0);

    effectivePermissions = new Set([
      'governance:read-department',
      'governance:review-department',
      'governance:record-department-decision'
    ]);
    const confirmRes = await fetch(`${baseUrl}/api/field-identities/20/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authoritative_system: 'CRM', authoritative_system_code: 'CRM' })
    });
    const confirmBody = await confirmRes.json();
    assert.strictEqual(confirmRes.status, 200, JSON.stringify(confirmBody));
    assert.strictEqual(confirmBody.success, true);
    assert.strictEqual(confirmBody.identity.confirmed, 1);
    assert.strictEqual(confirmBody.identity.confirmed_by, 42);
    assert.ok(repo.state.calls.some(call => call[0] === 'confirmFieldIdentity'), 'route should confirm through Data Map repository');

    console.log('Field identities MySQL API test passed');
  } finally {
    await closeServer(server);
    resetDataMapRepositoryFactory();
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
