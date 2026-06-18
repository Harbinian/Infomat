const assert = require('assert');
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

function makeFakeRepository() {
  const state = {
    context: { id: 10, context_id: 10, mapping_id: 10, dept_id: 8, owner_user_id: 42, created_by: 42, title: '销售订单字段上下文' },
    field: null,
    calls: []
  };
  return {
    state,
    async getContext(id) {
      state.calls.push(['getContext', Number(id)]);
      return Number(id) === state.context.id ? state.context : null;
    },
    async createField(payload, actorUserId) {
      state.calls.push(['createField', payload, actorUserId]);
      state.field = {
        id: 100,
        context_id: Number(payload.context_id),
        mapping_id: Number(payload.context_id),
        data_object: payload.data_object,
        field_name_cn: payload.field_name_cn,
        field_name_en: payload.field_name_en,
        note: payload.note,
        process_governance_node_key: payload.process_governance_node_key,
        process_governance_a1_code: payload.process_governance_a1_code,
        submitted_by: actorUserId
      };
      return state.field;
    },
    async getField(id) {
      state.calls.push(['getField', Number(id)]);
      return state.field && Number(id) === state.field.id ? state.field : null;
    },
    async updateField(id, payload, actorUserId) {
      state.calls.push(['updateField', Number(id), payload, actorUserId]);
      if (!state.field || Number(id) !== state.field.id) return null;
      state.field = {
        ...state.field,
        ...payload,
        id: state.field.id,
        context_id: state.field.context_id,
        mapping_id: state.field.mapping_id
      };
      return state.field;
    },
    async deleteField(id) {
      state.calls.push(['deleteField', Number(id)]);
      if (!state.field || Number(id) !== state.field.id) return false;
      state.field = null;
      return true;
    }
  };
}

async function main() {
  const repo = makeFakeRepository();
  setDataMapRepositoryFactory(async () => repo);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['admin:access']), fieldConstraints: {} };
    },
    async getUserRoleCodes() {
      return [{ code: 'admin', name: '管理员' }];
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'admin',
      userName: '数据地图管理员',
      departmentId: 8
    };
    next();
  });
  app.use('/api/field-entries', fieldEntriesRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const createRes = await fetch(`${baseUrl}/api/field-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context_id: 10,
        field_name_cn: '订单编号',
        field_name_en: 'order_no',
        data_object: '销售订单',
        note: '订单主数据字段',
        process_governance_node_key: '销售订单评审和执行管理',
        process_governance_a1_code: 'JY-L3-01-A1-001'
      })
    });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 200, JSON.stringify(createBody));
    assert.strictEqual(createBody.context_id, 10);
    assert.strictEqual(createBody.process_governance_node_key, '销售订单评审和执行管理');
    assert.strictEqual(createBody.process_governance_a1_code, 'JY-L3-01-A1-001');

    const updateRes = await fetch(`${baseUrl}/api/field-entries/${createBody.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note: '已关联 A1',
        process_governance_a1_code: 'JY-L3-01-A1-002'
      })
    });
    const updateBody = await updateRes.json();
    assert.strictEqual(updateRes.status, 200, JSON.stringify(updateBody));
    assert.strictEqual(updateBody.field.note, '已关联 A1');
    assert.strictEqual(updateBody.field.process_governance_node_key, '销售订单评审和执行管理');
    assert.strictEqual(updateBody.field.process_governance_a1_code, 'JY-L3-01-A1-002');

    assert.ok(repo.state.calls.some(call => call[0] === 'createField'), 'field link creation should go through Data Map repository');
    assert.ok(repo.state.calls.some(call => call[0] === 'updateField'), 'field link update should go through Data Map repository');
    console.log('Process governance field link test passed');
  } finally {
    await closeServer(server);
    resetDataMapRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
    if (previousIdentityReadModel === undefined) {
      delete process.env.MDM_IDENTITY_READ_MODEL;
    } else {
      process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
