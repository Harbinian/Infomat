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
      state.calls.push(['processExists', Number(processId)]);
      return state.processes.some(process => Number(process.id) === Number(processId));
    },
    async listTermTypes() {
      return [{ code: 'noun', name: '名词', description: '业务名词', sort_order: 10 }];
    },
    async getTermType(code) {
      return code === 'noun' ? { code, name: '名词' } : null;
    },
    async createTerm(payload, actorUserId) {
      state.calls.push(['createTerm', payload, actorUserId]);
      const term = {
        id: state.nextId++,
        ...payload,
        created_by: actorUserId,
        status: 'pending'
      };
      state.terms.push(term);
      return term;
    },
    async listTerms(filters) {
      state.calls.push(['listTerms', filters]);
      return state.terms;
    },
    async getTerm(id) {
      return state.terms.find(term => Number(term.id) === Number(id)) || null;
    }
  };
}

async function main() {
  assert.strictEqual(
    typeof auth.setIdentityRepositoryFactory,
    'function',
    'auth should allow MySQL identity repository injection'
  );
  assert.strictEqual(
    typeof terminologyRouter.setTerminologyRepositoryFactory,
    'function',
    'terminology should allow MySQL terminology repository injection'
  );

  let permissionCalls = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      permissionCalls += 1;
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['*:*']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      assert.strictEqual(userId, 42);
      return [{ code: legacyRole || 'admin', name: '管理员' }];
    },
    async getDepartmentById(id) {
      return { id, name: '会话部门' };
    }
  }));

  const terminologyRepo = makeFakeTerminologyRepository();
  terminologyRouter.setTerminologyRepositoryFactory(async () => terminologyRepo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'submitter',
      userName: 'MySQL 身份管理员',
      departmentId: 8
    };
    next();
  });
  app.use('/api/terminology', terminologyRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const processRes = await fetch(`${baseUrl}/api/terminology/processes`);
    const processBody = await processRes.json();
    assert.strictEqual(processRes.status, 200, JSON.stringify(processBody));
    assert.deepStrictEqual(
      processBody.map(row => row.id).sort((a, b) => a - b),
      [10, 11],
      'MySQL 身份管理员应能看到全部术语治理流程'
    );

    const createGlobalRes = await fetch(`${baseUrl}/api/terminology`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: '全局术语',
        term_type_code: 'noun',
        definition: '不绑定具体流程的全局术语'
      })
    });
    const createGlobalBody = await createGlobalRes.json();
    assert.strictEqual(createGlobalRes.status, 200, JSON.stringify(createGlobalBody));
    assert.ok(createGlobalBody.id);
    assert.ok(permissionCalls > 0, '术语路由管理员判断应读取 MySQL 身份权限');
    assert.ok(
      terminologyRepo.state.calls.some(call => call[0] === 'createTerm'),
      '术语创建应通过 MySQL terminology repository'
    );

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
