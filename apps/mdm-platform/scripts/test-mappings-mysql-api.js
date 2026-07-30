const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
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
    nextId: 201,
    mappings: [
      {
        id: 200,
        process_id: 31,
        process_name: '客户主数据维护',
        cap_name: '流程治理读模型',
        description: '既有映射',
        approval_dept_id: 9,
        owner_dept_id: 9,
        owner_dept_name: '经营发展部',
        status: 'draft',
        submitted_by: 42,
        current_step: 1,
        systems: 'MDM平台',
        systemLinks: [{ system_name: 'MDM平台', system_role: 'primary', sort_order: 1 }],
        fields: [],
        relatedDepts: [],
        approvalTasks: []
      }
    ]
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function findMapping(id) {
    return state.mappings.find(mapping => Number(mapping.id) === Number(id));
  }

  return {
    state,
    async listMappings(filters, scope) {
      state.calls.push(['listMappings', filters, scope]);
      return state.mappings
        .filter(mapping => !filters.status || mapping.status === filters.status)
        .filter(mapping => !filters.dept_id || Number(mapping.owner_dept_id) === Number(filters.dept_id))
        .map(mapping => ({ ...clone(mapping), systems: mapping.systems }));
    },
    async getMapping(id, scope) {
      state.calls.push(['getMapping', Number(id), scope]);
      const mapping = findMapping(id);
      if (!mapping) return null;
      return clone({
        ...mapping,
        systems: mapping.systemLinks,
        fields: mapping.fields,
        relatedDepts: mapping.relatedDepts,
        approvalTasks: mapping.approvalTasks
      });
    },
    async createMapping(payload, actorUserId) {
      state.calls.push(['createMapping', payload, actorUserId]);
      const id = state.nextId++;
      const mapping = {
        id,
        process_id: payload.process_id,
        process_name: '供应商主数据维护',
        cap_name: '流程治理读模型',
        description: payload.description || null,
        approval_dept_id: payload.approval_dept_id || null,
        owner_dept_id: payload.owner_dept_id,
        owner_dept_name: '经营发展部',
        status: 'draft',
        submitted_by: actorUserId,
        current_step: 1,
        systems: (payload.systems || []).map(system => system.system_name || system.name || `system-${system.system_id}`).join(', '),
        systemLinks: payload.systems || [],
        relatedDepts: payload.related_departments || [],
        fields: [],
        approvalTasks: []
      };
      state.mappings.push(mapping);
      return mapping;
    },
    async updateMapping(id, payload, actorUserId) {
      state.calls.push(['updateMapping', Number(id), payload, actorUserId]);
      const mapping = findMapping(id);
      if (!mapping) return null;
      Object.assign(mapping, {
        process_id: payload.process_id,
        description: payload.description || null,
        approval_dept_id: payload.approval_dept_id || null,
        owner_dept_id: payload.owner_dept_id,
        systemLinks: payload.systems || [],
        relatedDepts: payload.related_departments || []
      });
      return clone(mapping);
    },
    async deleteMapping(id, actorUserId) {
      state.calls.push(['deleteMapping', Number(id), actorUserId]);
      const mapping = findMapping(id);
      if (!mapping) return { deleted: false, reason: 'missing' };
      if (mapping.status !== 'draft') return { deleted: false, reason: 'status' };
      state.mappings = state.mappings.filter(item => Number(item.id) !== Number(id));
      return { deleted: true };
    },
    async submitMapping(id, actorUserId) {
      state.calls.push(['submitMapping', Number(id), actorUserId]);
      const mapping = findMapping(id);
      if (!mapping) return { ok: false, statusCode: 403, error: '无权限或映射不存在' };
      mapping.status = 'submitted';
      mapping.current_step = 2;
      mapping.approvalTasks = [
        { id: 1, mapping_id: mapping.id, step: 2, step_name: '部门内审', assignee_user_id: 43, assigned_dept_id: mapping.owner_dept_id, status: 'in_progress' },
        { id: 2, mapping_id: mapping.id, step: 5, step_name: '信息化项目组终审', assignee_user_id: 42, assigned_dept_id: null, status: 'pending' }
      ];
      return { ok: true };
    },
    async reviewMapping(id, payload) {
      state.calls.push(['reviewMapping', Number(id), payload]);
      const mapping = findMapping(id);
      if (!mapping) return { ok: false, statusCode: 404, error: '映射不存在' };
      if (payload.action === 'reject') {
        mapping.status = 'draft';
        mapping.current_step = 1;
        return { ok: true };
      }
      if (Number(payload.step) === 5) {
        mapping.status = 'final_reviewed';
        mapping.current_step = 5;
        return { ok: true };
      }
      mapping.status = 'dept_reviewed';
      mapping.current_step = Number(payload.step) + 1;
      return { ok: true };
    },
    async publishMapping(id, actorUserId) {
      state.calls.push(['publishMapping', Number(id), actorUserId]);
      const mapping = findMapping(id);
      if (!mapping) return { ok: false, statusCode: 404, error: '映射不存在' };
      mapping.status = 'published';
      return { ok: true };
    },
    async rejectMapping(id, payload, actorUserId) {
      state.calls.push(['rejectMapping', Number(id), payload, actorUserId]);
      const mapping = findMapping(id);
      if (!mapping) return { ok: false, statusCode: 404, error: '映射不存在' };
      mapping.status = 'draft';
      mapping.rejectionDetails = payload.rejections || [];
      return { ok: true };
    },
    async getRejectionDetails(id, scope) {
      state.calls.push(['getRejectionDetails', Number(id), scope]);
      const mapping = findMapping(id);
      return mapping ? mapping.rejectionDetails || [] : [];
    }
  };
}

async function main() {
  assert.strictEqual(
    typeof mappingsRouter.setMappingRepositoryFactory,
    'function',
    'mappings route should allow MySQL mapping repository injection'
  );

  const repo = makeFakeMappingRepository();
  mappingsRouter.setMappingRepositoryFactory(async () => repo);
  mappingsRouter.setGovernanceRepositoryFactory(async () => ({
    async getPublicationResponsibilityReadiness() {
      return { ready: true, missingDepartmentIds: [] };
    }
  }));
  let effectivePermissions = new Set([
    'governance:read-department',
    'governance:draft-department',
    'governance:submit-department'
  ]);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      return { permSet: effectivePermissions, fieldConstraints: {} };
    },
    async getDepartmentById(id) {
      return { id, name: id === 9 ? '经营发展部' : '未知部门' };
    },
    async getUserById(id) {
      return { id, name: id === 42 ? '映射管理员' : '审核人', department_id: 9 };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      userId: 42,
      userName: '映射治理人员',
      departmentId: 9
    };
    next();
  });
  app.use('/api/mappings', mappingsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${baseUrl}/api/mappings?status=draft`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.strictEqual(listBody.length, 1);
    assert.strictEqual(listBody[0].process_name, '客户主数据维护');

    const detailRes = await fetch(`${baseUrl}/api/mappings/200`);
    const detailBody = await detailRes.json();
    assert.strictEqual(detailRes.status, 200, JSON.stringify(detailBody));
    assert.strictEqual(detailBody.systems[0].system_name, 'MDM平台');

    const createRes = await fetch(`${baseUrl}/api/mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        process_id: 31,
        description: '供应商映射',
        owner_dept_id: 9,
        approval_dept_id: 9,
        systems: [{ system_name: 'MDM平台', system_role: 'primary' }],
        related_departments: [{ department_id: 10, relation: 'consumer' }]
      })
    });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 200, JSON.stringify(createBody));
    assert.ok(createBody.id);

    const updateRes = await fetch(`${baseUrl}/api/mappings/${createBody.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        process_id: 31,
        description: '供应商映射更新',
        owner_dept_id: 9,
        approval_dept_id: 9,
        systems: [{ system_name: 'ERP', system_role: 'secondary' }],
        related_departments: []
      })
    });
    const updateBody = await updateRes.json();
    assert.strictEqual(updateRes.status, 200, JSON.stringify(updateBody));

    const submitRes = await fetch(`${baseUrl}/api/mappings/${createBody.id}/submit`, { method: 'POST' });
    const submitBody = await submitRes.json();
    assert.strictEqual(submitRes.status, 200, JSON.stringify(submitBody));

    effectivePermissions = new Set([
      'governance:read-department',
      'governance:review-department',
      'governance:record-department-decision'
    ]);
    const reviewRes = await fetch(`${baseUrl}/api/mappings/${createBody.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 2, action: 'approve', opinion: '通过' })
    });
    const reviewBody = await reviewRes.json();
    assert.strictEqual(reviewRes.status, 200, JSON.stringify(reviewBody));

    const rejectRes = await fetch(`${baseUrl}/api/mappings/200/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        opinion: '补充字段说明',
        rejections: [{ field_entry_id: 7, reason: '字段说明不足' }]
      })
    });
    const rejectBody = await rejectRes.json();
    assert.strictEqual(rejectRes.status, 200, JSON.stringify(rejectBody));

    const rejectionDetailsRes = await fetch(`${baseUrl}/api/mappings/200/rejection-details`);
    const rejectionDetailsBody = await rejectionDetailsRes.json();
    assert.strictEqual(rejectionDetailsRes.status, 200, JSON.stringify(rejectionDetailsBody));
    assert.strictEqual(rejectionDetailsBody[0].reason, '字段说明不足');

    effectivePermissions = new Set([
      'governance:read-global',
      'governance:assign-work',
      'governance:structure-gate',
      'governance:publish'
    ]);
    const gateRes = await fetch(`${baseUrl}/api/mappings/${createBody.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 5, action: 'approve', opinion: '结构检查通过' })
    });
    const gateBody = await gateRes.json();
    assert.strictEqual(gateRes.status, 200, JSON.stringify(gateBody));

    const publishRes = await fetch(`${baseUrl}/api/mappings/${createBody.id}/publish`, { method: 'POST' });
    const publishBody = await publishRes.json();
    assert.strictEqual(publishRes.status, 200, JSON.stringify(publishBody));

    effectivePermissions = new Set([
      'governance:read-department',
      'governance:draft-department',
      'governance:submit-department'
    ]);
    const deleteRes = await fetch(`${baseUrl}/api/mappings/200`, { method: 'DELETE' });
    const deleteBody = await deleteRes.json();
    assert.strictEqual(deleteRes.status, 200, JSON.stringify(deleteBody));

    const callNames = repo.state.calls.map(call => call[0]);
    for (const expected of ['listMappings', 'getMapping', 'createMapping', 'updateMapping', 'submitMapping', 'reviewMapping', 'publishMapping', 'rejectMapping', 'getRejectionDetails', 'deleteMapping']) {
      assert.ok(callNames.includes(expected), `mappings route should call repository method ${expected}`);
    }

    console.log('Mappings MySQL API test passed');
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
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
});
