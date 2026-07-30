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
        owner_dept_id: 601,
        owner_dept_name: 'MySQL 会话部门',
        approval_dept_id: 601,
        submitted_by: 42,
        status: 'draft',
        current_step: 1,
        relatedDepts: []
      },
      {
        id: 202,
        process_id: 32,
        process_mapping_record_id: 32,
        process_name: '其他部门映射流程',
        owner_dept_id: 602,
        owner_dept_name: '其他部门',
        approval_dept_id: 602,
        submitted_by: 77,
        status: 'draft',
        current_step: 1,
        relatedDepts: []
      }
    ]
  };

  return {
    state,
    async listMappings(filters, scope) {
      state.calls.push(['listMappings', filters, scope]);
      if (scope.canViewAll) return state.mappings;
      return state.mappings.filter(mapping =>
        Number(mapping.owner_dept_id) === Number(scope.departmentId)
      );
    },
    async getMapping(id, scope = { canViewAll: true }) {
      const mapping = state.mappings.find(row => Number(row.id) === Number(id)) || null;
      if (!mapping || scope.canViewAll) return mapping;
      return Number(mapping.owner_dept_id) === Number(scope.departmentId) ? mapping : null;
    },
    async createMapping(payload, actorPersonId) {
      state.calls.push(['createMapping', payload, actorPersonId]);
      const mapping = {
        id: state.nextId++,
        process_id: payload.process_id,
        process_mapping_record_id: payload.process_id,
        process_name: '新建映射',
        owner_dept_id: payload.owner_dept_id,
        owner_dept_name: 'MySQL 会话部门',
        approval_dept_id: payload.approval_dept_id,
        submitted_by: actorPersonId,
        status: 'draft',
        current_step: 1,
        relatedDepts: []
      };
      state.mappings.push(mapping);
      return mapping;
    },
    async updateMapping(id, payload) {
      const mapping = await this.getMapping(id);
      if (!mapping) return { ok: false, statusCode: 404, error: '映射不存在' };
      Object.assign(mapping, payload);
      return { ok: true };
    },
    async submitMapping(id) {
      const mapping = await this.getMapping(id);
      mapping.status = 'reviewing';
      mapping.current_step = 2;
      return { ok: true };
    },
    async reviewMapping(id, payload) {
      state.calls.push(['reviewMapping', Number(id), payload]);
      return { ok: true };
    },
    async publishMapping(id) {
      const mapping = await this.getMapping(id);
      mapping.status = 'published';
      return { ok: true };
    }
  };
}

async function requestJson(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function main() {
  assert.strictEqual(typeof mappingsRouter.setMappingRepositoryFactory, 'function');
  assert.strictEqual(typeof mappingsRouter.setGovernanceRepositoryFactory, 'function');

  let effectivePermissions = new Set([
    'governance:read-department',
    'governance:draft-department',
    'governance:submit-department'
  ]);
  let permissionCalls = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(personId) {
      permissionCalls += 1;
      assert.strictEqual(personId, 42);
      return { permSet: effectivePermissions, fieldConstraints: {} };
    },
    async getDepartmentById(departmentId) {
      return {
        id: departmentId,
        name: Number(departmentId) === 601 ? 'MySQL 会话部门' : '其他部门'
      };
    }
  }));

  const mappingRepo = makeFakeMappingRepository();
  mappingsRouter.setMappingRepositoryFactory(async () => mappingRepo);
  mappingsRouter.setGovernanceRepositoryFactory(async () => ({
    async getPublicationResponsibilityReadiness() {
      return { ready: true, missingDepartmentIds: [] };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      userId: 42,
      userName: '测试人员',
      departmentId: 601
    };
    next();
  });
  app.use('/api/mappings', mappingsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    let result = await requestJson(baseUrl, '/api/mappings');
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    assert.deepStrictEqual(result.body.map(row => row.id), [201], '部门主对接人只能读取本部门映射');

    result = await requestJson(baseUrl, '/api/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        process_id: 31,
        description: '本部门新建映射',
        owner_dept_id: 602,
        systems: [],
        related_departments: []
      })
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    const created = await mappingRepo.getMapping(result.body.id);
    assert.strictEqual(created.owner_dept_id, 601, '服务端必须将映射范围固定为当前人员部门');

    result = await requestJson(baseUrl, '/api/mappings/202', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: '越权修改' })
    });
    assert.strictEqual(result.response.status, 403, '部门主对接人不能修改其他部门映射');

    result = await requestJson(baseUrl, '/api/mappings/201/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));

    effectivePermissions = new Set([
      'governance:read-department',
      'governance:review-department',
      'governance:record-department-decision'
    ]);
    result = await requestJson(baseUrl, '/api/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ process_id: 31 })
    });
    assert.strictEqual(result.response.status, 403, '部门MDM审核员不能创建映射草稿');

    result = await requestJson(baseUrl, '/api/mappings/201/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 2, action: 'approve', opinion: '部门决定已另行记录' })
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));

    result = await requestJson(baseUrl, '/api/mappings/202/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 2, action: 'approve' })
    });
    assert.strictEqual(result.response.status, 403, '部门MDM审核员不能审核其他部门映射');

    effectivePermissions = new Set([
      'governance:read-global',
      'governance:assign-work',
      'governance:structure-gate',
      'governance:publish'
    ]);
    result = await requestJson(baseUrl, '/api/mappings');
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));
    assert.deepStrictEqual(
      result.body.map(row => row.id).sort((a, b) => a - b),
      [201, 202, 301],
      'MDM工作组组长可读取全局映射'
    );

    result = await requestJson(baseUrl, '/api/mappings/201/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 5, action: 'approve', opinion: '结构检查通过' })
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));

    result = await requestJson(baseUrl, '/api/mappings/201/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.strictEqual(result.response.status, 200, JSON.stringify(result.body));

    effectivePermissions = new Set([
      'identity:read',
      'identity:manage-account',
      'identity:assign-role',
      'identity:read-audit',
      'governance:read-global'
    ]);
    result = await requestJson(baseUrl, '/api/mappings/202/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.strictEqual(result.response.status, 403, 'MDM系统管理员不能发布治理版本');

    assert.ok(permissionCalls > 0, '映射可见性和操作权限应读取 MySQL 身份权限');
    assert.ok(mappingRepo.state.calls.some(call => call[0] === 'createMapping'));
    console.log('Mappings MySQL identity API test passed');
  } finally {
    await closeServer(server);
    mappingsRouter.resetGovernanceRepositoryFactory();
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
