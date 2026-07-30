const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const { setDataMapRepositoryFactory, resetDataMapRepositoryFactory } = require('../server/dataMapMysqlRepository');
const dataMapRouter = require('../server/routes/dataMap');

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
    contexts: [{
      id: 10,
      context_id: 10,
      mapping_id: 10,
      context_key: 'ctx-customer',
      context_type: 'process',
      title: '客户字段上下文',
      dept_id: 9,
      dept_name: '经营发展部',
      owner_user_id: 42,
      status: 'active',
      created_by: 42
    }, {
      id: 11,
      context_id: 11,
      mapping_id: 11,
      context_key: 'ctx-other',
      context_type: 'process',
      title: '其他部门字段上下文',
      dept_id: 10,
      dept_name: '工程技术部',
      owner_user_id: 77,
      status: 'active',
      created_by: 77
    }],
    calls: []
  };

  return {
    state,
    async listContexts() {
      state.calls.push(['listContexts']);
      return state.contexts;
    },
    async getContext(id) {
      state.calls.push(['getContext', Number(id)]);
      return state.contexts.find(context => context.id === Number(id)) || null;
    },
    async createContext(payload, actorUserId) {
      state.calls.push(['createContext', payload, actorUserId]);
      const id = state.contexts.length + 11;
      const context = {
        ...payload,
        id,
        context_id: id,
        mapping_id: id,
        created_by: actorUserId,
        updated_by: actorUserId,
        status: payload.status || 'active'
      };
      state.contexts.push(context);
      return context;
    },
    async updateContext(id, payload, actorUserId) {
      state.calls.push(['updateContext', Number(id), payload, actorUserId]);
      const context = state.contexts.find(item => item.id === Number(id));
      if (!context) return null;
      Object.assign(context, payload, { updated_by: actorUserId });
      return context;
    }
  };
}

async function main() {
  const repo = makeFakeDataMapRepository();
  setDataMapRepositoryFactory(async () => repo);
  let currentPersonId = 42;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(personId) {
      if (personId === 42) {
        return {
          permSet: new Set([
            'identity:read',
            'identity:manage-account',
            'identity:assign-role',
            'identity:read-audit',
            'governance:read-global'
          ]),
          fieldConstraints: {}
        };
      }
      if (personId === 43) {
        return {
          permSet: new Set([
            'governance:read-department',
            'governance:draft-department'
          ]),
          fieldConstraints: {}
        };
      }
      throw new Error(`unexpected person id ${personId}`);
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: currentPersonId,
      userId: currentPersonId,
      userName: currentPersonId === 42 ? '数据地图管理员' : '部门主对接人',
      departmentId: 9
    };
    next();
  });
  app.use('/api/data-map', dataMapRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${baseUrl}/api/data-map/contexts`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.strictEqual(listBody[0].mapping_id, 10);
    assert.strictEqual(listBody[0].context_id, 10);

    const adminCreateRes = await fetch(`${baseUrl}/api/data-map/contexts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context_key: 'ctx-supplier',
        context_type: 'process',
        title: '供应商字段上下文',
        dept_id: 9,
        dept_name: '经营发展部',
        l3_name: '供应商资料维护',
        a1_code: 'A1-009'
      })
    });
    const adminCreateBody = await adminCreateRes.json();
    assert.strictEqual(adminCreateRes.status, 403, JSON.stringify(adminCreateBody));

    currentPersonId = 43;
    const contactListRes = await fetch(`${baseUrl}/api/data-map/contexts`);
    const contactListBody = await contactListRes.json();
    assert.strictEqual(contactListRes.status, 200, JSON.stringify(contactListBody));
    assert.deepStrictEqual(contactListBody.map(row => row.id), [10], '部门主对接人只能读取本部门数据地图');

    const contactCreate = await fetch(`${baseUrl}/api/data-map/contexts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context_key: 'ctx-contact-own-dept',
        context_type: 'process',
        title: '部门主对接人本部门字段上下文',
        dept_id: 9,
        dept_name: '经营发展部'
      })
    });
    const contactBody = await contactCreate.json();
    assert.strictEqual(contactCreate.status, 201, JSON.stringify(contactBody));
    assert.strictEqual(contactBody.dept_id, 9);

    const updateRes = await fetch(`${baseUrl}/api/data-map/contexts/${contactBody.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '本部门字段上下文更新', status: 'active' })
    });
    const updateBody = await updateRes.json();
    assert.strictEqual(updateRes.status, 200, JSON.stringify(updateBody));
    assert.strictEqual(updateBody.title, '本部门字段上下文更新');

    const crossDeptCreate = await fetch(`${baseUrl}/api/data-map/contexts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context_key: 'ctx-contact-cross-dept',
        context_type: 'process',
        title: '部门主对接人跨部门字段上下文',
        dept_id: 10,
        dept_name: '工程技术部'
      })
    });
    const crossDeptBody = await crossDeptCreate.json();
    assert.strictEqual(crossDeptCreate.status, 403, JSON.stringify(crossDeptBody));

    assert.ok(repo.state.calls.some(call => call[0] === 'createContext'), 'contexts route should create through Data Map repository');
    console.log('Data Map contexts API test passed');
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
