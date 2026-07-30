const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const terminologyRouter = require('../server/routes/terminology');

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

function makeFakeTerminologyRepository() {
  const state = {
    calls: [],
    processes: [
      { id: 10, name: '本部门术语流程', owner_dept_id: 8, dept_name: '会话部门', cap_name: '流程治理读模型' },
      { id: 11, name: '其他部门术语流程', owner_dept_id: 9, dept_name: '其他部门', cap_name: '流程治理读模型' }
    ],
    terms: [],
    nextId: 1
  };

  return {
    state,
    async listProcesses(scope) {
      state.calls.push(['listProcesses', scope]);
      return scope.canViewAll
        ? state.processes
        : state.processes.filter(process => Number(process.owner_dept_id) === Number(scope.departmentId));
    },
    async getProcess(processId, scope) {
      state.calls.push(['getProcess', Number(processId), scope]);
      const visible = await this.listProcesses(scope);
      return visible.find(process => Number(process.id) === Number(processId)) || null;
    },
    async processExists(processId) {
      return state.processes.some(process => Number(process.id) === Number(processId));
    },
    async listTermTypes() {
      return [{ code: 'noun', name: '名词', description: '业务名词', sort_order: 10 }];
    },
    async getTermType(code) {
      return code === 'noun' ? { code, name: '名词' } : null;
    },
    async createTerm(payload, actorPersonId) {
      state.calls.push(['createTerm', payload, actorPersonId]);
      const process = state.processes.find(row => Number(row.id) === Number(payload.process_id));
      const term = {
        id: state.nextId++,
        ...payload,
        process_owner_dept_id: process.owner_dept_id,
        created_by: actorPersonId,
        status: 'pending'
      };
      state.terms.push(term);
      return term;
    },
    async listTerms(filters) {
      state.calls.push(['listTerms', filters]);
      return filters.canViewAll
        ? state.terms
        : state.terms.filter(term => Number(term.process_owner_dept_id) === Number(filters.departmentId));
    },
    async getTerm(id) {
      return state.terms.find(term => Number(term.id) === Number(id)) || null;
    },
    async updateTerm(id, payload) {
      const term = await this.getTerm(id);
      if (!term) return null;
      Object.assign(term, payload);
      return term;
    },
    async reviewTerm(id, action, actorPersonId) {
      const term = await this.getTerm(id);
      if (!term) return null;
      term.status = action === 'approve' ? 'approved' : 'returned';
      term.reviewed_by = actorPersonId;
      return term;
    },
    async deleteTerm(id) {
      const index = state.terms.findIndex(term => Number(term.id) === Number(id));
      if (index < 0) return false;
      state.terms.splice(index, 1);
      return true;
    }
  };
}

async function requestJson(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function main() {
  assert.strictEqual(typeof auth.setIdentityRepositoryFactory, 'function');
  assert.strictEqual(typeof terminologyRouter.setTerminologyRepositoryFactory, 'function');

  let effectivePermissions = new Set([
    'governance:read-department',
    'governance:draft-department'
  ]);
  let permissionCalls = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(personId) {
      permissionCalls += 1;
      assert.strictEqual(personId, 42);
      return { permSet: effectivePermissions, fieldConstraints: {} };
    },
    async getDepartmentById(id) {
      return { id, name: Number(id) === 8 ? '会话部门' : '其他部门' };
    }
  }));

  const terminologyRepo = makeFakeTerminologyRepository();
  terminologyRouter.setTerminologyRepositoryFactory(async () => terminologyRepo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      userId: 42,
      userName: '测试人员',
      departmentId: 8
    };
    next();
  });
  app.use('/api/terminology', terminologyRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    let result = await requestJson(baseUrl, '/api/terminology/processes');
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    assert.deepStrictEqual(result.body.map(row => row.id), [10], '部门主对接人只能看到本部门流程');

    result = await requestJson(baseUrl, '/api/terminology', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: '缺少流程', term_type_code: 'noun', definition: '测试' })
    });
    assert.strictEqual(result.response.status, 400, JSON.stringify(result.body));

    result = await requestJson(baseUrl, '/api/terminology', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: '跨部门术语', term_type_code: 'noun', definition: '测试', process_id: 11 })
    });
    assert.strictEqual(result.response.status, 403, JSON.stringify(result.body));

    result = await requestJson(baseUrl, '/api/terminology', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: '本部门术语', term_type_code: 'noun', definition: '测试', process_id: 10 })
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    const termId = result.body.id;

    result = await requestJson(baseUrl, `/api/terminology/${termId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' })
    });
    assert.strictEqual(result.response.status, 403, '部门主对接人不能审核术语');

    effectivePermissions = new Set([
      'governance:read-department',
      'governance:review-department'
    ]);
    result = await requestJson(baseUrl, `/api/terminology/${termId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' })
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));

    result = await requestJson(baseUrl, `/api/terminology/${termId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: '审核员修改', term_type_code: 'noun', definition: '测试', process_id: 10 })
    });
    assert.strictEqual(result.response.status, 403, '部门MDM审核员不能修改术语源数据');

    effectivePermissions = new Set([
      'governance:read-global',
      'governance:quality-audit'
    ]);
    result = await requestJson(baseUrl, '/api/terminology/processes');
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    assert.deepStrictEqual(
      result.body.map(row => row.id).sort((a, b) => a - b),
      [10, 11],
      '质量审计人可全局读取术语治理上下文'
    );

    result = await requestJson(baseUrl, '/api/terminology', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: '审计人修改', term_type_code: 'noun', definition: '测试', process_id: 10 })
    });
    assert.strictEqual(result.response.status, 403, '质量审计人不能修改术语源数据');

    assert.ok(permissionCalls > 0, '术语路由应读取 MySQL 身份权限');
    assert.ok(terminologyRepo.state.calls.some(call => call[0] === 'createTerm'));
    console.log('Terminology MySQL identity API test passed');
  } finally {
    await closeServer(server);
    terminologyRouter.resetTerminologyRepositoryFactory();
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
