const assert = require('assert');
const express = require('express');
const auth = require('../server/auth');
const {
  setDataMapRepositoryFactory,
  resetDataMapRepositoryFactory
} = require('../server/dataMapMysqlRepository');
const fieldEntriesRouter = require('../server/routes/fieldEntries');
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
    'governance:draft-department',
    'governance:submit-department'
  ]);
  let contextDepartmentId = 9;
  const fields = [{
    id: 101,
    context_id: 51,
    field_name_cn: '客户名称',
    field_name_en: 'customer_name'
  }];
  const repository = {
    async getContext(contextId) {
      return Number(contextId) === 51 ? { id: 51, dept_id: contextDepartmentId, title: '客户主数据' } : null;
    },
    async getFieldsByContext() {
      return fields;
    },
    async getField(fieldId) {
      return fields.find(field => Number(field.id) === Number(fieldId)) || null;
    },
    async createField(payload, actorPersonId) {
      assert.strictEqual(actorPersonId, 42);
      const created = { ...payload, id: 102, context_id: 51 };
      fields.push(created);
      return created;
    },
    async updateField(fieldId, payload, actorPersonId) {
      assert.strictEqual(actorPersonId, 42);
      return { ...fields.find(field => Number(field.id) === Number(fieldId)), ...payload };
    },
    async deleteField() {
      return true;
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
  app.use('/api/field-entries', fieldEntriesRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const listRes = await fetch(`${baseUrl}/api/field-entries/mapping/51`);
    const list = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(list));
    assert.strictEqual(list[0].id, 101);

    const createRes = await fetch(`${baseUrl}/api/field-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context_id: 51,
        field_name_cn: '客户编号',
        field_name_en: 'customer_code'
      })
    });
    const created = await createRes.json();
    assert.strictEqual(createRes.status, 200, JSON.stringify(created));
    assert.strictEqual(created.id, 102);

    contextDepartmentId = 10;
    const crossDepartmentRes = await fetch(`${baseUrl}/api/field-entries/mapping/51`);
    assert.strictEqual(crossDepartmentRes.status, 403);

    permissions = new Set(['governance:read-global']);
    const globalReadRes = await fetch(`${baseUrl}/api/field-entries/mapping/51`);
    assert.strictEqual(globalReadRes.status, 200);
    const adminWriteRes = await fetch(`${baseUrl}/api/field-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_id: 51, field_name_cn: '禁止写入' })
    });
    assert.strictEqual(adminWriteRes.status, 403);

    console.log('Field entries fixed identity and department scope API test passed');
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
