const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const { setDataMapRepositoryFactory, resetDataMapRepositoryFactory } = require('../server/dataMapMysqlRepository');
const fieldEntriesRouter = require('../server/routes/fieldEntries');

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
    contexts: [{ id: 10, mapping_id: 10, context_id: 10, dept_id: 9, dept_name: '经营发展部', owner_user_id: 42, created_by: 42, title: '客户字段上下文', status: 'active' }],
    fields: [{
      id: 20,
      context_id: 10,
      mapping_id: 10,
      data_object: '客户',
      field_name_cn: '客户名称',
      field_name_en: 'customer_name',
      field_type: '文本',
      data_type: '文本',
      consume_systems: JSON.stringify(['CRM']),
      sync_mode: '实时',
      submitted_by: 42,
      status: 'draft'
    }],
    calls: []
  };

  return {
    state,
    async getContext(id) {
      state.calls.push(['getContext', Number(id)]);
      return state.contexts.find(context => context.id === Number(id)) || null;
    },
    async getFieldsByContext(contextId) {
      state.calls.push(['getFieldsByContext', Number(contextId)]);
      return state.fields.filter(field => field.context_id === Number(contextId));
    },
    async createField(payload, actorUserId) {
      state.calls.push(['createField', payload, actorUserId]);
      if (payload.field_name_cn === '客户编号') {
        const error = new Error('字段名命中禁用词：客户编号，请使用 客户编码');
        error.statusCode = 400;
        throw error;
      }
      const id = state.fields.length + 21;
      const field = {
        id,
        context_id: Number(payload.context_id || payload.mapping_id),
        mapping_id: Number(payload.context_id || payload.mapping_id),
        data_object: payload.data_object,
        field_name_cn: payload.field_name_cn,
        field_name_en: payload.field_name_en,
        field_type: payload.field_type || payload.data_type,
        data_type: payload.field_type || payload.data_type,
        consume_systems: JSON.stringify(payload.consume_systems || []),
        sync_mode: payload.sync_mode || null,
        submitted_by: actorUserId,
        status: 'draft'
      };
      state.fields.push(field);
      return field;
    },
    async updateField(fieldId, payload, actorUserId) {
      state.calls.push(['updateField', Number(fieldId), payload, actorUserId]);
      const field = state.fields.find(item => item.id === Number(fieldId));
      if (!field) return null;
      Object.assign(field, {
        data_object: payload.data_object || field.data_object,
        field_name_cn: payload.field_name_cn || field.field_name_cn,
        field_name_en: payload.field_name_en || field.field_name_en,
        field_type: payload.field_type || payload.data_type || field.field_type,
        data_type: payload.field_type || payload.data_type || field.data_type
      });
      return field;
    },
    async getField(fieldId) {
      state.calls.push(['getField', Number(fieldId)]);
      return state.fields.find(field => field.id === Number(fieldId)) || null;
    },
    async deleteField(fieldId, actorUserId) {
      state.calls.push(['deleteField', Number(fieldId), actorUserId]);
      const before = state.fields.length;
      state.fields = state.fields.filter(field => field.id !== Number(fieldId));
      return before !== state.fields.length;
    }
  };
}

async function main() {
  const routeSource = fs.readFileSync(path.join(__dirname, '../server/routes/fieldEntries.js'), 'utf8');
  assert.ok(!routeSource.includes("require('../db')"), 'field entries route must not import SQLite db');
  assert.ok(!routeSource.includes('field_entries'), 'field entries route must not query SQLite field_entries');
  assert.ok(!routeSource.includes('terms'), 'field entries route must not query SQLite terms');

  const repo = makeFakeDataMapRepository();
  setDataMapRepositoryFactory(async () => repo);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['admin:access']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      return [{ code: legacyRole, name: '基础角色' }, { code: 'admin', name: '管理员' }].filter(role => role.code);
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'submitter',
      userName: '数据地图用户',
      departmentId: 9
    };
    next();
  });
  app.use('/api/field-entries', fieldEntriesRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${baseUrl}/api/field-entries/mapping/10`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.strictEqual(listBody[0].mapping_id, 10);
    assert.strictEqual(listBody[0].context_id, 10);

    const createRes = await fetch(`${baseUrl}/api/field-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapping_id: 10,
        data_object: '客户',
        field_name_cn: '客户简称',
        field_name_en: 'customer_short_name',
        field_type: '文本',
        consume_systems: ['CRM', 'ERP'],
        sync_mode: '实时'
      })
    });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 200, JSON.stringify(createBody));
    assert.strictEqual(createBody.mapping_id, 10);
    assert.strictEqual(createBody.context_id, 10);

    const blockedRes = await fetch(`${baseUrl}/api/field-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context_id: 10,
        data_object: '客户',
        field_name_cn: '客户编号',
        field_type: '文本'
      })
    });
    const blockedBody = await blockedRes.json();
    assert.strictEqual(blockedRes.status, 400, JSON.stringify(blockedBody));
    assert.ok(blockedBody.error.includes('禁用词'));

    const updateRes = await fetch(`${baseUrl}/api/field-entries/20`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_name_cn: '客户全称', data_object: '客户', field_type: '文本' })
    });
    const updateBody = await updateRes.json();
    assert.strictEqual(updateRes.status, 200, JSON.stringify(updateBody));
    assert.strictEqual(updateBody.success, true);

    const deleteRes = await fetch(`${baseUrl}/api/field-entries/20`, { method: 'DELETE' });
    const deleteBody = await deleteRes.json();
    assert.strictEqual(deleteRes.status, 200, JSON.stringify(deleteBody));
    assert.strictEqual(deleteBody.success, true);

    assert.ok(repo.state.calls.some(call => call[0] === 'createField'), 'route should create fields through Data Map repository');
    console.log('Field entries MySQL API test passed');
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
