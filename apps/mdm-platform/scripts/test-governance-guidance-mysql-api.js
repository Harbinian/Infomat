const assert = require('assert');
const express = require('express');

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
  const guidanceRouter = require('../server/routes/governanceGuidance');
  assert.strictEqual(
    typeof guidanceRouter.setGuidanceRepositoryFactory,
    'function',
    'guidance route should allow repository injection'
  );
  assert.strictEqual(
    typeof guidanceRouter.setIdentityRepositoryFactory,
    'function',
    'guidance route should allow identity injection'
  );

  const createdPayloads = [];
  let allowCreate = true;
  guidanceRouter.setIdentityRepositoryFactory(() => ({
    async getUserEffectivePermissions(personId) {
      assert.strictEqual(personId, 701);
      return {
        permSet: new Set(allowCreate ? ['guidance:create', 'process_governance:view_global'] : ['admin:access']),
        fieldConstraints: {}
      };
    }
  }));
  guidanceRouter.setGuidanceRepositoryFactory(() => ({
    async createGuidance(payload) {
      createdPayloads.push(payload);
      return {
        guidance_id: 77,
        guidance_code: 'GUID-20260626-0001',
        ...payload,
        status: 'pending_response'
      };
    },
    async listGuidanceForPerson() {
      return [];
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 701,
      personId: 701,
      accountId: 8801,
      userName: '公司领导',
      userRole: 'decision_group',
      departmentId: 1
    };
    next();
  });
  app.use('/api/process-governance/guidance', guidanceRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const createRes = await fetch(`${baseUrl}/api/process-governance/guidance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        related_entity_type: 'process_mapping_record',
        related_entity_id: 3001,
        related_department_id: 20,
        guidance_type: '指导',
        content: '请责任部门补充跨部门输入输出说明。',
        is_major: true
      })
    });
    const createBody = await createRes.json();
    assert.strictEqual(createRes.status, 201, JSON.stringify(createBody));
    assert.strictEqual(createBody.guidance_id, 77);
    assert.strictEqual(createdPayloads[0].created_by_person_id, 701);
    assert.strictEqual(createdPayloads[0].related_department_id, 20);
    assert.strictEqual(createdPayloads[0].status, 'pending_response');

    allowCreate = false;
    const deniedRes = await fetch(`${baseUrl}/api/process-governance/guidance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        related_entity_type: 'process_mapping_record',
        related_entity_id: 3001,
        related_department_id: 20,
        guidance_type: '指导',
        content: '管理员不能替代决策组直接形成指导意见。'
      })
    });
    const deniedBody = await deniedRes.json();
    assert.strictEqual(deniedRes.status, 403, JSON.stringify(deniedBody));
    assert.strictEqual(deniedBody.error, '权限不足');

    console.log('Governance guidance MySQL API test passed');
  } finally {
    await closeServer(server);
    guidanceRouter.resetGuidanceRepositoryFactory();
    guidanceRouter.resetIdentityRepositoryFactory();
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
