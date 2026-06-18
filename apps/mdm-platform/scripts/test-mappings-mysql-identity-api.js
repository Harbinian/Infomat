const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const mappingsRouter = require('../server/routes/mappings');

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

function makeFakeMappingRepository() {
  const state = {
    calls: [],
    nextId: 301,
    mappings: [
      {
        id: 201,
        process_id: 31,
        process_mapping_record_id: 31,
        process_name: '本部门映射流程',
        cap_name: '流程治理读模型',
        description: '本部门映射',
        owner_dept_id: 601,
        owner_dept_name: 'MySQL 会话部门',
        approval_dept_id: 601,
        submitted_by: 42,
        status: 'draft',
        current_step: 1,
        systems: ''
      },
      {
        id: 202,
        process_id: 32,
        process_mapping_record_id: 32,
        process_name: '其他部门映射流程',
        cap_name: '流程治理读模型',
        description: '其他部门映射',
        owner_dept_id: 602,
        owner_dept_name: '其他部门',
        approval_dept_id: 602,
        submitted_by: 77,
        status: 'draft',
        current_step: 1,
        systems: ''
      }
    ]
  };

  return {
    state,
    async listMappings(filters, scope) {
      state.calls.push(['listMappings', filters, scope]);
      assert.strictEqual(scope.canViewAll, true, 'MySQL 身份全局查看权限应传入映射 repository');
      assert.strictEqual(scope.departmentName, 'MySQL 会话部门');
      return state.mappings;
    },
    async getMapping(id) {
      return state.mappings.find(mapping => Number(mapping.id) === Number(id)) || null;
    },
    async createMapping(payload, actorUserId) {
      state.calls.push(['createMapping', payload, actorUserId]);
      assert.strictEqual(actorUserId, 42);
      const mapping = {
        id: state.nextId++,
        process_id: payload.process_id,
        process_mapping_record_id: payload.process_id,
        process_name: 'MySQL 身份报送人创建映射',
        cap_name: '流程治理读模型',
        description: payload.description,
        owner_dept_id: payload.owner_dept_id,
        owner_dept_name: 'MySQL 会话部门',
        approval_dept_id: payload.approval_dept_id || null,
        submitted_by: actorUserId,
        status: 'draft',
        current_step: 1,
        systems: ''
      };
      state.mappings.push(mapping);
      return mapping;
    }
  };
}

async function main() {
  assert.strictEqual(
    typeof mappingsRouter.setMappingRepositoryFactory,
    'function',
    '映射路由应支持注入 MySQL 映射 repository'
  );

  let permissionCalls = 0;
  let roleCalls = 0;
  let departmentCalls = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      permissionCalls += 1;
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['data:view_all']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      roleCalls += 1;
      assert.strictEqual(userId, 42);
      return [{ code: legacyRole, name: '基础角色' }, { code: 'submitter', name: '报送人' }].filter(role => role.code);
    },
    async getDepartmentById(departmentId) {
      departmentCalls += 1;
      assert.strictEqual(departmentId, 601);
      return { id: 601, name: 'MySQL 会话部门' };
    }
  }));

  const mappingRepo = makeFakeMappingRepository();
  mappingsRouter.setMappingRepositoryFactory(async () => mappingRepo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'reviewer',
      userName: 'MySQL 身份报送人',
      departmentId: 601
    };
    next();
  });
  app.use('/api/mappings', mappingsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${baseUrl}/api/mappings`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.deepStrictEqual(
      listBody.map(row => row.id).sort((a, b) => a - b),
      [201, 202],
      'MySQL 身份全局查看权限应能看到全部映射'
    );

    const createRes = await fetch(`${baseUrl}/api/mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        process_id: 31,
        description: 'MySQL 身份报送人创建映射',
        owner_dept_id: 601,
        systems: [],
        related_departments: []
      })
    });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 200, JSON.stringify(createBody));
    assert.ok(createBody.id);
    assert.ok(permissionCalls > 0, '映射可见性应读取 MySQL 身份权限');
    assert.ok(roleCalls > 0, '映射创建权限应读取 MySQL 身份角色');
    assert.ok(departmentCalls > 0, '映射可见性应读取 MySQL 部门信息');
    assert.ok(
      mappingRepo.state.calls.some(call => call[0] === 'createMapping'),
      '映射创建应通过 MySQL mapping repository'
    );

    console.log('Mappings MySQL identity API test passed');
  } finally {
    await closeServer(server);
    mappingsRouter.resetMappingRepositoryFactory();
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
