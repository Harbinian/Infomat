const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
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
    processes: [
      { id: 31, name: '客户主数据维护', owner_dept_id: 9, dept_name: '经营发展部', cap_name: '数据地图' },
      { id: 32, name: '应付账款维护', owner_dept_id: 10, dept_name: '财务部', cap_name: '数据地图' }
    ],
    termTypes: [
      { code: 'noun', name: '名词', description: '业务对象、字段和交付物', sort_order: 10 },
      { code: 'role', name: '角色词', description: '流程角色', sort_order: 30 }
    ],
    terms: [
      {
        id: 100,
        term: '既有术语',
        term_type_code: 'noun',
        term_type_name: '名词',
        definition: '既有定义',
        scope: '集团',
        forbidden: '',
        status: 'approved',
        process_id: 31,
        process_name: '客户主数据维护',
        process_owner_dept_id: 9,
        process_dept_name: '经营发展部',
        created_by: 42
      }
    ],
    calls: [],
    nextId: 101
  };

  function scopeProcesses(scope) {
    if (scope.canViewAll) return state.processes;
    return state.processes.filter(process => Number(process.owner_dept_id) === Number(scope.departmentId));
  }

  return {
    state,
    async initSchema() {
      state.calls.push(['initSchema']);
    },
    async listProcesses(scope) {
      state.calls.push(['listProcesses', scope]);
      return scopeProcesses(scope);
    },
    async getProcess(processId, scope) {
      state.calls.push(['getProcess', Number(processId), scope]);
      return scopeProcesses(scope).find(process => Number(process.id) === Number(processId)) || null;
    },
    async processExists(processId) {
      state.calls.push(['processExists', Number(processId)]);
      return state.processes.some(process => Number(process.id) === Number(processId));
    },
    async listTermTypes() {
      state.calls.push(['listTermTypes']);
      return state.termTypes;
    },
    async getTermType(code) {
      state.calls.push(['getTermType', code]);
      return state.termTypes.find(type => type.code === code) || null;
    },
    async listTerms(filters) {
      state.calls.push(['listTerms', filters]);
      return state.terms.filter(term => !filters.status || term.status === filters.status);
    },
    async getTerm(id) {
      state.calls.push(['getTerm', Number(id)]);
      return state.terms.find(term => Number(term.id) === Number(id)) || null;
    },
    async createTerm(payload, actorUserId) {
      state.calls.push(['createTerm', payload, actorUserId]);
      const process = state.processes.find(item => Number(item.id) === Number(payload.process_id));
      const term = {
        id: state.nextId++,
        term: payload.term,
        term_type_code: payload.term_type_code,
        term_type_name: payload.term_type_code === 'role' ? '角色词' : '名词',
        definition: payload.definition || null,
        scope: payload.scope || null,
        forbidden: payload.forbidden || null,
        status: 'pending',
        process_id: payload.process_id || null,
        process_name: process ? process.name : null,
        process_owner_dept_id: process ? process.owner_dept_id : null,
        process_dept_name: process ? process.dept_name : null,
        created_by: actorUserId
      };
      state.terms.push(term);
      return term;
    },
    async updateTerm(id, payload) {
      state.calls.push(['updateTerm', Number(id), payload]);
      const term = state.terms.find(item => Number(item.id) === Number(id));
      if (!term) return null;
      Object.assign(term, payload, {
        process_id: payload.process_id || null,
        term_type_name: payload.term_type_code === 'role' ? '角色词' : '名词'
      });
      return term;
    },
    async reviewTerm(id, action, reviewerId) {
      state.calls.push(['reviewTerm', Number(id), action, reviewerId]);
      const term = state.terms.find(item => Number(item.id) === Number(id));
      if (!term) return null;
      term.status = action === 'approve' ? 'approved' : 'rejected';
      term.approved_by = reviewerId;
      return term;
    },
    async deleteTerm(id) {
      state.calls.push(['deleteTerm', Number(id)]);
      const before = state.terms.length;
      state.terms = state.terms.filter(term => Number(term.id) !== Number(id));
      return state.terms.length !== before;
    }
  };
}

async function main() {
  assert.strictEqual(
    typeof terminologyRouter.setTerminologyRepositoryFactory,
    'function',
    'terminology route should allow MySQL terminology repository injection'
  );

  const repo = makeFakeTerminologyRepository();
  terminologyRouter.setTerminologyRepositoryFactory(async () => repo);

  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['admin:access', 'data:view_all']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      return [{ code: legacyRole || 'admin', name: '管理员' }, { code: 'admin', name: '管理员' }];
    },
    async getDepartmentById(departmentId) {
      return { id: departmentId, name: departmentId === 9 ? '经营发展部' : '未知部门' };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'admin',
      userName: '术语管理员',
      departmentId: 9
    };
    next();
  });
  app.use('/api/terminology', terminologyRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const processesRes = await fetch(`${baseUrl}/api/terminology/processes`);
    const processesBody = await processesRes.json();
    assert.strictEqual(processesRes.status, 200, JSON.stringify(processesBody));
    assert.deepStrictEqual(processesBody.map(row => row.id), [31, 32]);

    const typesRes = await fetch(`${baseUrl}/api/terminology/types`);
    const typesBody = await typesRes.json();
    assert.strictEqual(typesRes.status, 200, JSON.stringify(typesBody));
    assert.deepStrictEqual(typesBody.map(row => row.code), ['noun', 'role']);

    const listRes = await fetch(`${baseUrl}/api/terminology?status=approved`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.strictEqual(listBody.length, 1);
    assert.strictEqual(listBody[0].term, '既有术语');
    assert.strictEqual(listBody[0].process_name, '客户主数据维护');

    const createRes = await fetch(`${baseUrl}/api/terminology`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: '客户',
        term_type_code: 'noun',
        definition: '购买产品或服务的对象',
        scope: '集团',
        forbidden: '客商',
        process_id: 31
      })
    });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 200, JSON.stringify(createBody));
    assert.ok(createBody.id);

    const updateRes = await fetch(`${baseUrl}/api/terminology/${createBody.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: '客户',
        term_type_code: 'role',
        definition: '与集团发生业务关系的外部对象',
        scope: '主数据域',
        forbidden: '客户资料',
        process_id: 31
      })
    });
    const updateBody = await updateRes.json();
    assert.strictEqual(updateRes.status, 200, JSON.stringify(updateBody));

    const reviewRes = await fetch(`${baseUrl}/api/terminology/${createBody.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' })
    });
    const reviewBody = await reviewRes.json();
    assert.strictEqual(reviewRes.status, 200, JSON.stringify(reviewBody));

    const deleteRes = await fetch(`${baseUrl}/api/terminology/${createBody.id}`, { method: 'DELETE' });
    const deleteBody = await deleteRes.json();
    assert.strictEqual(deleteRes.status, 200, JSON.stringify(deleteBody));

    const callNames = repo.state.calls.map(call => call[0]);
    for (const expected of ['listProcesses', 'listTermTypes', 'listTerms', 'createTerm', 'updateTerm', 'reviewTerm', 'deleteTerm']) {
      assert.ok(callNames.includes(expected), `terminology route should call repository method ${expected}`);
    }

    console.log('Terminology MySQL API test passed');
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
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
});
