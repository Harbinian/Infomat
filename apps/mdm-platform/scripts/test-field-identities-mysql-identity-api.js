const assert = require('assert');
const express = require('express');
const auth = require('../server/auth');
const {
  setDataMapRepositoryFactory,
  resetDataMapRepositoryFactory
} = require('../server/dataMapMysqlRepository');
const fieldIdentitiesRouter = require('../server/routes/fieldIdentities');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

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
  let permissions = new Set([
    'governance:read-department',
    'governance:draft-department'
  ]);
  let identity = null;
  const repository = {
    async getField(fieldId) {
      return Number(fieldId) === 101 ? { id: 101, context_id: 51 } : null;
    },
    async getContext(contextId) {
      return Number(contextId) === 51 ? { id: 51, dept_id: 9 } : null;
    },
    async getFieldIdentity() {
      return identity;
    },
    async upsertFieldIdentity(fieldId, payload) {
      identity = { id: 201, field_entry_id: Number(fieldId), ...payload, confirmed: 0 };
      return identity;
    },
    async confirmFieldIdentity(fieldId, payload, actorPersonId) {
      assert.strictEqual(actorPersonId, 42);
      identity = { ...identity, ...payload, field_entry_id: Number(fieldId), confirmed: 1, confirmed_by: actorPersonId };
      return identity;
    }
  };
  setDataMapRepositoryFactory(async () => repository);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(personId) {
      assert.strictEqual(personId, 42);
      return { permSet: new Set(permissions), fieldConstraints: {} };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      userId: 42,
      departmentId: 9
    };
    next();
  });
  app.use('/api/field-identities', fieldIdentitiesRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const upsertRes = await fetch(`${baseUrl}/api/field-identities/101`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authoritative_system: 'CRM',
        maintain_dept_id: 9,
        note: '部门主对接人维护'
      })
    });
    const upsert = await upsertRes.json();
    assert.strictEqual(upsertRes.status, 200, JSON.stringify(upsert));
    assert.strictEqual(upsert.authoritative_system, 'CRM');

    const contactConfirmRes = await fetch(`${baseUrl}/api/field-identities/101/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authoritative_system: 'CRM' })
    });
    assert.strictEqual(contactConfirmRes.status, 403);

    permissions = new Set([
      'governance:read-department',
      'governance:review-department'
    ]);
    const reviewerWriteRes = await fetch(`${baseUrl}/api/field-identities/101`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authoritative_system: 'ERP' })
    });
    assert.strictEqual(reviewerWriteRes.status, 403);

    const confirmRes = await fetch(`${baseUrl}/api/field-identities/101/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authoritative_system: 'CRM' })
    });
    const confirmed = await confirmRes.json();
    assert.strictEqual(confirmRes.status, 200, JSON.stringify(confirmed));
    assert.strictEqual(confirmed.identity.confirmed, 1);
    assert.strictEqual(confirmed.identity.confirmed_by, 42);

    permissions = new Set(['governance:read-global']);
    const auditorWriteRes = await fetch(`${baseUrl}/api/field-identities/101`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authoritative_system: 'ERP' })
    });
    assert.strictEqual(auditorWriteRes.status, 403);

    console.log('Field identities fixed role separation API test passed');
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
  if (previousReadModel === undefined) delete process.env.MDM_IDENTITY_READ_MODEL;
  else process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
  cleanupDb({ ignoreErrors: true });
});
